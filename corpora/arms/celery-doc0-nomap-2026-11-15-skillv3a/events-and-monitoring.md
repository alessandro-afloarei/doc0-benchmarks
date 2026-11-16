---
title: "Events and Monitoring"
---
## Overview

Workers can publish a stream of small event messages describing what they do: a task was received, started, succeeded, failed or was revoked; a worker came online, is still alive, or went offline. Monitors consume this stream to show live cluster activity without polling workers or the result backend. Celery provides the three building blocks, reachable through `app.events`: an `EventDispatcher` that sends events, an `EventReceiver` that consumes them, and a `State` object that rebuilds an in-memory picture of workers and tasks from them. Tools such as `celery events` and Flower are built on these.

Sources: [celery/app/events.py:7-40](repo://celery/app/events.py#L7-L40)

Task events are off by default: start workers with `-E`/`--task-events` or set `worker_send_task_events`, or enable them at run time with the `enable_events` control command ([[Remote Control and Inspection]]). Worker heartbeats are sent whenever events are enabled at all.

Sources: [celery/app/defaults.py:366-368](repo://celery/app/defaults.py#L366-L368), [celery/worker/consumer/events.py:15-35](repo://celery/worker/consumer/events.py#L15-L35)

## Events on the wire

### Event format

An event is a plain dict with a `type` such as `task-succeeded`, a `timestamp`, and type-specific fields. The dispatcher adds `hostname`, `utcoffset`, `pid` and `clock` (the sender's Lamport clock). The part of the type before the first dash is its group (`task`, `worker`), which is used for filtering and buffering.

Sources: [celery/events/event.py:18-43](repo://celery/events/event.py#L18-L43), [celery/events/dispatcher.py:116-140](repo://celery/events/dispatcher.py#L116-L140)

Events are published to the `celeryev` exchange (`event_exchange`) with the type, dots instead of dashes, as routing key (`task.succeeded`). The exchange is a topic exchange, except on Redis and Google Pub/Sub, where it is a fanout.

Sources: [celery/events/event.py:11-63](repo://celery/events/event.py#L11-L63)

### Event types

| Event | Sent by | Key fields |
| --- | --- | --- |
| `task-sent` | Client, if `task_send_sent_event` | name, args, kwargs, eta, expires, queue, exchange, routing_key |
| `task-received` | Worker strategy | name, args, kwargs, root_id, parent_id, retries, eta, expires |
| `task-started` | Request accepted by pool | |
| `task-succeeded` | Request | result, runtime |
| `task-failed` | Request / tracer | exception, traceback |
| `task-retried` | Request | exception, traceback |
| `task-revoked` | Request | terminated, signum, expired |
| `task-rejected` | Request | requeue |
| `worker-online` / `worker-heartbeat` / `worker-offline` | `Heart` step | freq, active, processed, loadavg, sw_ident, sw_ver, sw_sys |

Sources: [celery/app/amqp.py:405-417](repo://celery/app/amqp.py#L405-L417), [celery/worker/strategy.py:174-183](repo://celery/worker/strategy.py#L174-L183), [celery/worker/request.py:457-460](repo://celery/worker/request.py#L457-L460), [celery/worker/request.py:515-523](repo://celery/worker/request.py#L515-L523), [celery/worker/request.py:596-620](repo://celery/worker/request.py#L596-L620), [celery/worker/request.py:736-740](repo://celery/worker/request.py#L736-L740), [celery/worker/heartbeat.py:39-61](repo://celery/worker/heartbeat.py#L39-L61)

Heartbeats go out every 2 seconds by default (`--heartbeat-interval`), carry the number of active and processed tasks and the load average, and `worker-offline` is sent on shutdown. They are separate from AMQP connection heartbeats.

Sources: [celery/worker/heartbeat.py:15-61](repo://celery/worker/heartbeat.py#L15-L61), [celery/worker/consumer/heart.py:10-36](repo://celery/worker/consumer/heart.py#L10-L36)

## Sending events

### EventDispatcher

`EventDispatcher(connection, hostname, enabled=True, groups=None, buffer_while_offline=True, ...)` creates a producer on the event exchange with `event_serializer` (JSON) and non-persistent delivery. `send(type, **fields)` drops events of groups not in `groups`, and does nothing when disabled; events are disabled automatically on the `sql` transport. Toggling `enable()`/`disable()` runs callbacks, which is how the heartbeat timer starts and stops with events.

Sources: [celery/events/dispatcher.py:19-114](repo://celery/events/dispatcher.py#L19-L114), [celery/events/dispatcher.py:164-199](repo://celery/events/dispatcher.py#L164-L199), [celery/worker/heartbeat.py:31-33](repo://celery/worker/heartbeat.py#L31-L33)

### Buffering

Two buffers reduce cost and loss. If publishing fails and `buffer_while_offline` is set, the event is kept in an outbound buffer and resent by `flush()`; the worker's `Events` step carries this buffer over to the new dispatcher after a reconnect. With the event loop, the worker also buffers the `task` group: events are collected and published as one list message (routing key `task.multi`) when 24 have accumulated or when the loop next becomes idle.

Sources: [celery/events/dispatcher.py:142-162](repo://celery/events/dispatcher.py#L142-L162), [celery/events/dispatcher.py:185-217](repo://celery/events/dispatcher.py#L185-L217), [celery/worker/consumer/events.py:35-55](repo://celery/worker/consumer/events.py#L35-L55), [celery/worker/consumer/consumer.py:624-630](repo://celery/worker/consumer/consumer.py#L624-L630)

Custom events from application code use the same dispatcher: `Task.send_event(type, **fields)` inside a task, or `with app.events.default_dispatcher() as d: d.send('custom-thing', ...)`.

Sources: [celery/app/events.py:32-40](repo://celery/app/events.py#L32-L40), [celery/app/task.py:1003-1027](repo://celery/app/task.py#L1003-L1027)

## Receiving events

### EventReceiver

`app.events.Receiver(connection, handlers={'task-failed': on_failed, '*': state.event})` declares its own queue, `celeryev.<uuid>` bound to the event exchange with routing key `#`. The queue is exclusive and auto-deleted by default, and its messages expire after `event_queue_ttl` (5 s) and the queue itself after `event_queue_expires` (60 s) of disuse, so a dead monitor does not make events pile up on the broker.

Sources: [celery/events/receiver.py:23-78](repo://celery/events/receiver.py#L23-L78), [celery/app/defaults.py:179-189](repo://celery/app/defaults.py#L179-L189)

`capture(limit=None, timeout=None, wakeup=True)` consumes until stopped. On start it broadcasts a `heartbeat` control command so every worker announces itself immediately rather than in up to two seconds. Each message, or each event in a batched list, goes through `event_from_message`, which adjusts the receiver's logical clock, converts the timestamp to local time using the sender's `utcoffset`, and records `local_received`; then the handler for the type, or the `*` handler, is called.

Sources: [celery/events/receiver.py:80-145](repo://celery/events/receiver.py#L80-L145)

`task-sent` events come from clients, which do not synchronize clocks, so the receiver assigns them its own clock value minus one instead of trusting theirs.

Sources: [celery/events/receiver.py:113-121](repo://celery/events/receiver.py#L113-L121)

## Cluster state

### The State object

`app.events.State()` turns the event stream into objects. Feed it events with `state.event(event)` (typically as the receiver's `*` handler). It keeps `workers` and `tasks` in LRU caches (5,000 workers and 10,000 tasks by default), a time-ordered heap of task events, and indexes of tasks by type and by worker.

Sources: [celery/events/state.py:398-436](repo://celery/events/state.py#L398-L436), [celery/events/state.py:501-511](repo://celery/events/state.py#L501-L511)

```python
state = app.events.State()

def on_failed(event):
    state.event(event)
    task = state.tasks.get(event['uuid'])
    print(f'{task.name}[{task.uuid}] failed: {task.exception}')

with app.connection() as conn:
    recv = app.events.Receiver(conn, handlers={'task-failed': on_failed, '*': state.event})
    recv.capture(limit=None, timeout=None, wakeup=True)
```

Sources: [celery/events/receiver.py:95-106](repo://celery/events/receiver.py#L95-L106), [celery/events/state.py:501-503](repo://celery/events/state.py#L501-L503)

### Workers

For `worker-*` events the dispatcher creates or updates a `Worker`, copies the fields onto it and records the local receive time in a short list of heartbeats (four entries). A worker is `alive` while the last heartbeat is younger than its frequency plus a 200% window; `worker-offline` clears the heartbeats and removes it. If a sender's timestamp and the local receive time differ by more than 16 seconds, a clock-drift warning is logged. Task events also count as signs of life for their worker. `on_node_join` and `on_node_leave` callbacks fire when workers appear and leave, which the worker's Gossip step uses.

Sources: [celery/events/state.py:45-60](repo://celery/events/state.py#L45-L60), [celery/events/state.py:148-239](repo://celery/events/state.py#L148-L239), [celery/events/state.py:554-574](repo://celery/events/state.py#L554-L574)

### Tasks

For `task-*` events it creates or updates a `Task` keyed by uuid, associates it with the sending worker (or with the client for `task-sent`), inserts the event into the heap ordered by `(clock, timestamp, origin)`, and links it to its parent, resolving children whose parent arrives later.

Sources: [celery/events/state.py:575-634](repo://celery/events/state.py#L575-L634)

Events from different workers can arrive out of order. `Task.event` maps the event type to a state (`task-received` to `RECEIVED`, `task-succeeded` to `SUCCESS`, any other suffix upper-cased as a custom state) and uses state precedence: an event whose state logically happens before the current one (a late `started` after `succeeded`) only contributes its non-state fields, according to the task's merge rules. This is the precedence order described in [[Retries, Errors and Task States]].

Sources: [celery/events/state.py:67-76](repo://celery/events/state.py#L67-L76), [celery/events/state.py:305-332](repo://celery/events/state.py#L305-L332)

Query helpers include `tasks_by_time()`, `tasks_by_type`, `tasks_by_worker`, `task_types()`, `alive_workers()`, and `clear_tasks(ready=True)` to drop finished tasks.

Sources: [celery/events/state.py:451-470](repo://celery/events/state.py#L451-L470), [celery/events/state.py:650-708](repo://celery/events/state.py#L650-L708)

## Monitoring tools

### celery events

`celery events` has three modes:

Sources: [celery/bin/events.py:18-48](repo://celery/bin/events.py#L18-L48), [celery/bin/events.py:51-83](repo://celery/bin/events.py#L51-L83)

| Invocation | Runs |
| --- | --- |
| `celery events` | `evtop`: a curses screen listing recent tasks and workers, with keys to inspect a task, revoke it or change rate limits |
| `celery events --dump` | `evdump`: prints every event as a readable line, reconnecting on connection loss |
| `celery events --camera=<cls> --frequency=1.0 [--maxrate=...]` | `evcam`: takes periodic snapshots of the State with a camera class |

Sources: [celery/events/cursesmon.py:34](repo://celery/events/cursesmon.py#L34), [celery/events/cursesmon.py:512](repo://celery/events/cursesmon.py#L512), [celery/events/dumper.py:79-99](repo://celery/events/dumper.py#L79-L99), [celery/events/snapshot.py:86-111](repo://celery/events/snapshot.py#L86-L111)

### Snapshot cameras

A camera subclasses `Polaroid` and overrides `on_shutter(state)`, for example to write task states to a database. `install()` schedules `capture` every `freq` seconds, which calls `on_shutter` while holding the State's lock (optionally clearing it afterwards with `clear_after`), rate-limited by `maxrate`, and `on_cleanup` every hour. `shutter_signal` and `cleanup_signal` are sent alongside, so cameras can also be composed from signal receivers.

Sources: [celery/events/snapshot.py:24-83](repo://celery/events/snapshot.py#L24-L83)

[[Signals]] describes the in-process hooks that complement these over-the-wire events.

Sources: [celery/events/snapshot.py:28-29](repo://celery/events/snapshot.py#L28-L29)
