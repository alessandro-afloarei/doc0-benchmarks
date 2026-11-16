---
type: subsystem
title: Events and Monitoring
description: Celery's monitoring event stream — how workers and clients publish task/worker events through EventDispatcher to the celeryev exchange, how EventReceiver consumes them with Lamport clock adjustment, how events.State rebuilds cluster state, and the bundled consumers (snapshot cameras, curses monitor, dumper).
tags: [events, monitoring, heartbeat, state, evcam, celery-events]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:05:29.073Z
sources:
  - id: openwiki-source-4be6cca2c9164c478933a960
    resource: repo://celery/events/dispatcher.py
  - id: openwiki-source-3fcc726af565b7ddfc0ea693
    resource: repo://celery/events/event.py
  - id: openwiki-source-615baded4198a1e9794a8bb1
    resource: repo://celery/events/receiver.py
  - id: openwiki-source-42ea84090e3e2292a97a3a4d
    resource: repo://celery/events/snapshot.py
  - id: openwiki-source-2f1a7c2fcace441b360b3f19
    resource: repo://celery/events/state.py
  - id: openwiki-source-dd622d1d70314bce53103492
    resource: repo://celery/worker/consumer/events.py
  - id: openwiki-source-a85d69622d5baa166a82e6c1
    resource: repo://celery/worker/control.py
  - id: openwiki-source-e8992bfabcddb8fdcad7cadf
    resource: repo://celery/worker/heartbeat.py
generated: { by: "claude-code", at: "2026-11-16T17:05:29.073Z" }
---

# Events and Monitoring

Celery emits structured events describing task and worker lifecycle so that external tools (`celery events`, Flower, custom monitors) can observe a cluster without querying the result backend. The implementation lives in `celery/events/`, with the app-level entry point `app.events` (`celery/app/events.py`) exposing `Dispatcher`, `Receiver` and `State` classes bound to the app.

## Event model

An event is a plain dict created by `celery.events.event.Event(type, **fields)`. `type` is required; `timestamp` defaults to `time.time()`. Dispatchers add `hostname`, `utcoffset`, `pid` and a Lamport `clock`.

Event types are `<group>-<name>`; `group_from(type)` returns the prefix (`task`, `worker`, or any custom group). Main types:

| Group | Types | Emitted by |
|-------|-------|-----------|
| task | `task-sent` | client publisher (`app.amqp.send_task_message`) when `task_send_sent_event` is on |
| task | `task-received` | worker strategy on message receipt |
| task | `task-started`, `task-succeeded`, `task-failed`, `task-retried`, `task-revoked`, `task-rejected`, `task-cancelled` | `celery/worker/request.py` |
| worker | `worker-online`, `worker-heartbeat`, `worker-offline` | `celery/worker/heartbeat.py` |

Tasks can send custom events with `Task.send_event(type_, **fields)`.

## Publishing: `EventDispatcher`

`celery/events/dispatcher.py`:

- Publishes to the exchange from `get_exchange()`: `celeryev` (configurable via `event_exchange`) of type **topic**, switched to **fanout** for Redis and Google Pub/Sub transports. The routing key is the event type with `-` replaced by `.` (e.g. `task.succeeded`).
- Disabled automatically on transports in `DISABLED_TRANSPORTS` (`sql`).
- `groups` filters what is sent: `send()` drops events whose group is not in a non-empty `groups` set.
- `buffer_while_offline=True` keeps events in `_outbound_buffer` if publishing fails, to be flushed later. A `buffer_group`/`buffer_limit` lets the worker batch task events and send them as a list in one message (receivers accept lists since Celery 4).
- `publish(..., blind=True)` skips the logical clock.
- Delivery mode defaults to non-persistent (`delivery_mode=1`); events are best-effort monitoring data.

### In the worker

The consumer's `Events` bootstep (`celery/worker/consumer/events.py`) creates the dispatcher on (re)connect:

- With task events enabled (`-E` / `worker_send_task_events`), all groups are sent; otherwise `groups=['worker']`, so only heartbeats/online/offline go out.
- The dispatcher is enabled if task events, gossip or heartbeats are enabled.
- When the event loop (hub) is used, task events are buffered and flushed by the loop.
- On reconnect, the old dispatcher's buffer and group selection (which remote control may have changed) are transferred to the new one, and reserved requests are pointed at it.

The `Heart` bootstep runs `celery.worker.heartbeat.Heart`, which sends `worker-online` at start, `worker-heartbeat` every `heartbeat_interval` seconds (default 2.0) with `freq`, active/processed counts and load average, and `worker-offline` at stop. These are distinct from AMQP connection heartbeats.

Remote control commands `enable_events`, `disable_events` and `heartbeat` (`celery/worker/control.py`) toggle the `task` group at runtime and force an immediate heartbeat (see [Remote Control](../worker/remote-control.md)).

## Consuming: `EventReceiver`

`celery/events/receiver.py` is a kombu `ConsumerMixin`:

- Declares a queue named `<event_queue_prefix>.<uuid>` bound with routing key `#` by default. It is auto-delete unless `event_queue_durable`; `event_queue_exclusive`, `event_queue_ttl` and `event_queue_expires` apply. Exclusive and durable together is rejected.
- `handlers` maps event type to callable, with `'*'` as catch-all.
- `capture(limit, timeout, wakeup)` consumes; `wakeup=True` broadcasts a `heartbeat` control command so workers announce themselves immediately.
- `event_from_message()` adjusts the receiver's Lamport clock from the event clock (for `task-sent`, which comes from unsynchronised clients, it assigns a synthetic clock), converts timestamps to local time using `utcoffset`, and stamps `local_received`.

## Reconstructing cluster state: `events.State`

`celery/events/state.py` keeps an in-memory model fed by `state.event(event)`:

- `State.workers` and `State.tasks` are LRU caches bounded by `max_workers_in_memory` (5000) and `max_tasks_in_memory` (10000). A heap of events supports `tasks_by_time()`.
- `Worker` tracks the last heartbeats (receive times); `alive` is true while `now < last_heartbeat + freq * 2.0` (`HEARTBEAT_EXPIRE_WINDOW = 200` percent). Clock drift over 16 s between sender timestamp and receive time logs a warning.
- `Task.event()` maps event types to states and merges fields. Because events can arrive out of order, an event whose state has lower precedence than the current one (it "happened before") only contributes whitelisted fields (`merge_rules`, e.g. name/args/kwargs from `task-received`) and does not move the state backwards. `RETRY` always overwrites.
- Task objects link to parents/children/root through the shared state, enabling tree views.
- `freeze_while(fun)` holds the state lock while a snapshot function runs.

## Bundled consumers

| Tool | Code | CLI |
|------|------|-----|
| Curses monitor (`evtop`) | `celery/events/cursesmon.py` | `celery events` |
| Event dumper | `celery/events/dumper.py` (`evdump`) | `celery events --dump` |
| Snapshot camera | `celery/events/snapshot.py` (`Polaroid`, `evcam`) | `celery events --camera=<cls> --frequency=<s> --maxrate=<r>` |

`Polaroid` is the base for cameras: it schedules `capture()` every `freq` seconds on a timer, rate limits with a token bucket (`maxrate`), and calls `on_shutter(state)` inside `freeze_while`; `cleanup()` runs every `cleanup_freq`. Custom cameras that persist snapshots (for example to a database) subclass it and override `on_shutter`.

The `celery events` command lives in `celery/bin/events.py` and is described in [CLI and Deployment](../operations/cli.md).

## Operational notes

- Task events are **off by default** in workers; enable with `-E`, `worker_send_task_events`, or `celery control enable_events`. `task-sent` additionally needs `task_send_sent_event` on the client.
- With Redis the fanout exchange means every event receiver gets every event; routing key filters do not apply.
- Event queues are transient; a monitor that is not running misses events.
- Events are also used internally: Gossip (worker-to-worker presence) consumes worker events, see [Worker Consumer](../worker/consumer.md).

## Tests

- `t/unit/events/test_events.py`, `test_state.py`, `test_snapshot.py`, `test_cursesmon.py`, `test_dumper.py`.
- `t/unit/worker/test_heartbeat.py`, `t/unit/worker/test_consumer.py` (Events step).

## Related

- [Remote Control and Inspection](../worker/remote-control.md)
- [Worker Consumer](../worker/consumer.md)
