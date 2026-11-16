---
type: subsystem
title: Events and Monitoring
description: Celery's monitoring event stream — event format and the celeryev exchange, EventDispatcher buffering and groups, EventReceiver and logical clocks, worker heartbeats and liveness, the in-memory cluster State, snapshot cameras, and the celery events tools.
tags: [events, monitoring, heartbeat, state, flower]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T09:27:53.075Z
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
  - id: openwiki-source-e8992bfabcddb8fdcad7cadf
    resource: repo://celery/worker/heartbeat.py
generated: { by: "claude-code", at: "2026-11-15T09:27:53.075Z" }
---

# Events and Monitoring

Celery workers (and optionally clients) publish **events** describing task and worker lifecycle. Monitors such as `celery events`, Flower, and custom tools consume them. The code is in `celery/events/`, exposed through `app.events` (`celery/app/events.py`) which provides `Dispatcher`, `Receiver` and `State` bound to the app.

## Event format and transport

- An event is a plain dict with a `type` such as `task-succeeded` or `worker-heartbeat` and a `timestamp` (`Event()` in `celery/events/event.py`). The group is the prefix before the first dash (`task`, `worker`, or custom).
- Events are published to the `celeryev` exchange (configurable with `event_exchange`), a **topic** exchange, with routing key `type` with dashes replaced by dots (`task.succeeded`). For Redis and Google Pub/Sub transports the exchange is switched to **fanout**.
- The dispatcher adds `hostname`, `utcoffset`, `pid` and a Lamport `clock` value to every event.

### Event types

| Group | Types |
| --- | --- |
| task | `task-sent` (client, only with `task_send_sent_event`), `task-received`, `task-started`, `task-succeeded`, `task-failed`, `task-rejected`, `task-revoked`, `task-retried` |
| worker | `worker-online`, `worker-heartbeat`, `worker-offline` |

Task events are only sent when enabled (`worker_send_task_events` / `-E`, or the `enable_events` remote-control command).

## EventDispatcher

`EventDispatcher` (`celery/events/dispatcher.py`) wraps a kombu `Producer`:

- `send(type, **fields)` is a no-op when disabled or when the event's group is not in `groups`.
- Transports listed in `DISABLED_TRANSPORTS` (`sql`) disable events entirely.
- If a publish fails and `buffer_while_offline` is true (default), the event is stored in an outbound buffer; `flush()` re-sends it after reconnecting.
- Groups listed in `buffer_group` are batched: events accumulate until `buffer_limit` (24) and are then published as a list with routing key `<group>.multi`.
- `on_enabled`/`on_disabled` callbacks let dependent services (e.g. heartbeats) start and stop with it.

In the worker, the consumer's `Events` bootstep (`celery/worker/consumer/events.py`) creates the dispatcher on each (re)connection. It enables only the `worker` group unless task events are on, and buffers the `task` group when the async event loop (hub) is used. On reconnect the previous dispatcher's buffer is transferred and flushed, and reserved requests are pointed at the new dispatcher; group changes made by remote control survive reconnects.

## Heartbeats and liveness

`celery/worker/heartbeat.py:Heart` sends `worker-online` when the dispatcher is enabled, then `worker-heartbeat` every `interval` seconds (worker setting `--heartbeat-interval`, default 2.0s) including `freq`, `active` (number of active requests), `processed` (total count), `loadavg` and software info; `worker-offline` on stop. The consumer's `Heart` step wires it up (see [Worker Consumer](../worker/consumer.md)).

Monitors treat a worker as alive while `now < last_heartbeat + freq * (HEARTBEAT_EXPIRE_WINDOW / 100)`, with `HEARTBEAT_EXPIRE_WINDOW = 200` — i.e. twice the advertised frequency (`heartbeat_expires` in `celery/events/state.py`).

(These *event* heartbeats are distinct from AMQP connection heartbeats, configured with `broker_heartbeat`.)

## EventReceiver

`EventReceiver` (`celery/events/receiver.py`) is a kombu `ConsumerMixin`:

- Declares a queue `<event_queue_prefix>.<uuid>` (prefix default `celeryev`) bound to the event exchange with routing key `#` by default. It is auto-delete unless `event_queue_durable`; `event_queue_ttl`/`event_queue_expires` set message TTL and queue expiry. Exclusive + durable together raises `ImproperlyConfigured`.
- Consumes with `no_ack=True`, accepting the event serializer and JSON.
- Dispatches to `handlers[type]` or the `'*'` catch-all.
- On consume start it broadcasts a `heartbeat` remote-control command so workers immediately announce themselves.
- Synchronises the local Lamport clock: `task-sent` events (from clients, which never sync) get a synthetic clock; other events adjust the clock to the received value. Timestamps are optionally localized using the event's `utcoffset`.

## Cluster State

`celery/events/state.py:State` is an in-memory model built from events, used by `celery events`, Flower and cameras:

- `workers` and `tasks` are `LRUCache`s bounded by `max_workers_in_memory` (5000) and `max_tasks_in_memory` (10000).
- `State.event(event)` dispatches by group. Worker events create or update `Worker` objects (removed on `worker-offline`), firing `on_node_join`/`on_node_leave` callbacks. Task events create or update `Task` objects and link them to their worker, and keep `tasks_by_type`/`tasks_by_worker` indexes.
- `Task.event()` applies state **precedence** (`celery.states.precedence`): an event that logically happened *before* the current state (arriving out of order) only merges selected fields (`merge_rules`) instead of regressing the state. `RETRY` is handled specially.
- A heap of `(clock, timestamp, origin, task-ref)` keeps tasks ordered for `tasks_by_time()`.
- `freeze_while(fun)` runs a function with the state locked — used by snapshot cameras.

## Snapshots and tools

- **Cameras** (`celery/events/snapshot.py`): subclass `Polaroid` and implement `on_shutter(state)`. `evcam` installs the camera on a timer (`freq`, optional `maxrate` token bucket, periodic `cleanup`) and feeds a `State` from an `EventReceiver`. `celery events --camera=module.Camera --frequency=...` runs it (django-celery-results/monitor-style persistence plug in here).
- **Dumper** (`celery/events/dumper.py`): `celery events --dump` prints every event in a human-readable form.
- **Curses monitor** (`celery/events/cursesmon.py`): the default `celery events` UI showing live tasks and workers, with keys to revoke tasks, view tracebacks and change rate limits via remote control.

## Related

- Remote control commands `enable_events`/`disable_events`/`heartbeat`: [Remote Control and Inspection](../worker/remote-control.md).
- Tests: `t/unit/events/` (`test_events.py`, `test_state.py`, `test_snapshot.py`, `test_cursesmon.py`, `test_dumper.py`), `t/unit/worker/test_heartbeat.py`.
