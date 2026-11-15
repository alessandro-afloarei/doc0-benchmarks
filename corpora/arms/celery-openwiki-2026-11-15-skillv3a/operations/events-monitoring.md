---
type: subsystem
title: Events and Monitoring
description: How Celery's monitoring event stream works. Covers EventDispatcher publishing task-* and worker-* events to the celeryev exchange (with buffering and groups), worker heartbeats, EventReceiver's transient queues, the in-memory State model with out-of-order merging, snapshot cameras, and the curses/dump monitors.
tags: [events, monitoring, heartbeat, state, flower, cursesmon]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:49.645Z
sources:
  - id: openwiki-source-ac404435efa758dad4bbfc83
    resource: repo://celery/app/defaults.py
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
generated: { by: "claude-code", at: "2026-11-15T17:08:49.645Z" }
---

# Events and Monitoring

Celery workers and clients can publish **events**, which are small JSON dicts describing task and worker lifecycle changes. Monitors such as `celery events`, Flower, and custom cameras consume them. Events travel on the broker but are separate from task messages. They are fire-and-forget, use transient delivery, and are not persisted.

Code: `celery/events/` (`event.py`, `dispatcher.py`, `receiver.py`, `state.py`, `snapshot.py`, `cursesmon.py`, `dumper.py`), `celery/app/events.py` (the `app.events` factory), `celery/worker/consumer/events.py` (the Events bootstep), `celery/worker/heartbeat.py`, and `celery/worker/consumer/heart.py`.

## Event format and exchange

- `Event(type, **fields)` is just a dict with `type` and `timestamp`. The dispatcher adds `hostname`, `utcoffset`, `pid`, and a Lamport `clock`.
- The **group** is the part of the type before the first dash: `task-succeeded` is in group `task`, `worker-heartbeat` in group `worker`.
- Events are published to the `event_exchange` (default `celeryev`), a **topic** exchange. The routing key is the type with dashes replaced by dots (`task.succeeded`). On Redis and GCP Pub/Sub transports the exchange is switched to **fanout** (`get_exchange`).
- Serializer: `event_serializer` (default `json`). The dispatcher uses `delivery_mode=1` (non-persistent).

## Publishing (`EventDispatcher`)

- Created via `app.events.Dispatcher(connection, hostname, enabled, groups, ...)`.
- Disabled automatically for transports in `DISABLED_TRANSPORTS` (`sql`).
- `send(type, **fields)` drops events whose group is not in `groups`, when `groups` is set. Events in a `buffer_group` are accumulated and published together as `<group>.multi` once `buffer_limit` (24) is reached or on `flush()`. Other events are published immediately under a mutex.
- If publishing fails and `buffer_while_offline=True` (the default), the event is put in `_outbound_buffer` and re-sent on `flush()`, so events aren't lost during short broker outages.

### Worker side

The consumer's `Events` bootstep (`worker/consumer/events.py`) creates the dispatcher once the broker connection is up.

- Events are enabled if task events (`-E` / `worker_send_task_events`) are on, **or** if gossip or heartbeats are enabled. Without `-E` the dispatcher is restricted to `groups=['worker']`.
- With the async event loop (prefork, solo), `task` events are buffered (`buffer_group=['task']`) and flushed from the hub. Eventlet and gevent do not buffer.
- On reconnect, the previous dispatcher's buffer is carried over, flushed, and reattached to reserved requests.
- Remote control `enable_events` and `disable_events` add or remove `task` from the dispatcher's groups at run time (`worker/control.py`). The Events step remembers group changes across reconnects.

Task events and where they are sent:

| Event | Sender |
|---|---|
| `task-sent` | client, in `amqp.send_task_message`, when `task_send_sent_event` is enabled |
| `task-received` | worker strategy, when a message is accepted |
| `task-started` | `Request.on_accepted` (pool picked it up) |
| `task-succeeded` / `task-failed` / `task-retried` | `Request` result handlers, or the fast path in `request.py` |
| `task-revoked` / `task-rejected` / `task-cancelled` | revocation, rejection, or cancellation in `Request` |

### Heartbeats

`worker/heartbeat.py:Heart` sends `worker-online` at start, then `worker-heartbeat` every `heartbeat_interval` seconds (2.0 by default) on the worker timer, and `worker-offline` on stop. Each heartbeat includes `freq`, active and processed counts, and load average. The `heartbeat_sent` signal fires only if it has receivers. Disable with `--without-heartbeat`. These are **event** heartbeats and have nothing to do with AMQP connection heartbeats (`broker_heartbeat`). Gossip and Mingle (see [Consumer](../worker/consumer-and-requests.md)) use worker events to track peers.

## Receiving (`EventReceiver`)

`app.events.Receiver(connection, handlers={'task-succeeded': fn, '*': fallback})` is a kombu `ConsumerMixin`. It:

- declares a per-receiver queue `<event_queue_prefix>.<node_id>` (`celeryev.<uuid>`) bound with `routing_key` (default `#`). The queue is **exclusive** and auto-delete by default, with `x-message-ttl=event_queue_ttl` (5s) and `x-expires=event_queue_expires` (60s). `event_queue_durable=True` cannot be combined with exclusive (`ImproperlyConfigured`);
- on `capture()`, optionally sends a `heartbeat` broadcast to wake workers so they send heartbeats immediately (`wakeup_workers`);
- converts each message into an event, localizing timestamps with `utcoffset`, adjusts the local Lamport clock, and dispatches by type. A message body that is a list (a buffered `*.multi` batch) is processed event by event. `task-sent` events come from clients that never sync clocks, so the receiver assigns them its own clock plus a skew instead of trusting their value.

## Cluster state model (`events/state.py`)

`State` (`app.events.State()`) is the in-memory model used by monitors. It is fed with `state.event(event)`, typically as the receiver's `'*'` handler.

- `state.workers`: an LRU of `Worker` objects keyed by hostname (default limit 5000). A worker is `alive` while `now < last_heartbeat + freq * expire_window/100`, with `HEARTBEAT_EXPIRE_WINDOW=200`, so a worker counts as offline after missing roughly two heartbeat intervals.
- `state.tasks`: an LRU of `Task` objects keyed by UUID (default limit 10000). Each has a lifecycle timestamp (`received`, `started`, `succeeded`, ...), `state`, `args`, `result`, `runtime`, and parent/root/children links.
- **Out-of-order handling:** events may arrive out of order across workers. `Task.event()` compares state precedence (`celery.states.precedence`). If an incoming state logically happens before the current one, for example a late `task-received` after `task-succeeded`, only the fields listed in `merge_rules` (name, args, kwargs, eta, ...) are merged and the newer state is kept.
- `state.tasks_by_time()`, `tasks_by_type`, `tasks_by_worker`, `alive_workers()`, and `task_types()` serve queries. Time ordering uses a heap capped at `max_tasks_in_memory * heap_multiplier`.
- `freeze_while(fun)` runs a function while event processing is blocked, which cameras use.

## Tools built on events

- **`celery events`** (`bin/events.py`):
  - default: the curses monitor (`cursesmon.py`), an interactive task list with details, revoke, and rate-limit actions;
  - `--dump`: `dumper.py`, which prints a human-readable line per event;
  - `--camera cls --frequency N [--maxrate R]`: runs a **snapshot camera** (`snapshot.py:Polaroid`). Every `freq` seconds the camera calls `on_shutter(state)` with a frozen state, for example to persist to a database. Every `cleanup_freq` seconds (default 3600) it sends a cleanup signal and calls the `on_cleanup()` hook. With `clear_after=True`, state is cleared after each shutter. `--detach` daemonizes the camera.
- **Flower** and other external dashboards use the same `EventReceiver` + `State` API.

## Settings

- `worker_send_task_events` (`-E`): enables the `task` group.
- `task_send_sent_event`: the client emits `task-sent`.
- `event_queue_ttl`, `event_queue_expires`, `event_queue_prefix`, `event_queue_exclusive`, `event_queue_durable`, `event_exchange`, `event_serializer`.

## Tests

`t/unit/events/`: `test_events.py` (dispatcher and receiver), `test_state.py` (merge rules, heartbeats, LRU), `test_snapshot.py`, `test_cursesmon.py`, `test_dumper.py`.

## See also

- [Remote Control and Inspection](../worker/remote-control.md)
- [Command-Line Interface](cli.md)
