---
title: "Events and Monitoring"
---
## Overview

Workers, and optionally clients, publish events describing what happens in the cluster: a task was sent, received, started, succeeded or failed; a worker came online, sent a heartbeat or went offline. Events are small dictionaries published to a dedicated exchange, separate from task messages. Monitors (`celery events`, Flower, or custom code) consume them and keep an in-memory picture of the cluster. Nothing in Celery's execution depends on events; they exist for observation.

Sources: [celery/events/event.py:1-50](repo://celery/events/event.py#L1-L50), [celery/events/dispatcher.py:15-40](repo://celery/events/dispatcher.py#L15-L40)

`app.events` gives access to the three building blocks, each bound to the app: `Dispatcher` (sending), `Receiver` (consuming) and `State` (aggregating). Worker heartbeats are also events, and the worker's own `Gossip` step uses them to track other workers ([[The Consumer]]).

Sources: [celery/app/events.py:1-40](repo://celery/app/events.py#L1-L40)

## Event messages

An event is created by `Event(type, **fields)`: a dict with `type` and, unless given, `timestamp` set to the current time. The dispatcher adds `hostname`, `utcoffset`, `pid` and the Lamport `clock`. The part of the type before the first dash is its group (`task-succeeded` is in group `task`), and the routing key is the type with dashes turned into dots, so a consumer can bind to `task.#` or `worker.#`.

Sources: [celery/events/event.py:17-46](repo://celery/events/event.py#L17-L46), [celery/events/dispatcher.py:114-142](repo://celery/events/dispatcher.py#L114-L142)

Events go to the `celeryev` topic exchange (the `event_exchange` setting). On Redis and Google Pub/Sub transports `get_exchange` switches it to a fanout exchange, a workaround noted in the code for issue #436.

Sources: [celery/events/event.py:9-13](repo://celery/events/event.py#L9-L13), [celery/events/event.py:48-63](repo://celery/events/event.py#L48-L63), [celery/app/defaults.py:179-189](repo://celery/app/defaults.py#L179-L189)

| Event | Sent by | Main fields |
| --- | --- | --- |
| `task-sent` | Client, with `task_send_sent_event` | `uuid`, `name`, `args`, `kwargs`, `retries`, `eta`, `expires`, `queue`, `exchange`, `routing_key` |
| `task-received` | Worker strategy | `uuid`, `name`, `args`, `kwargs`, `root_id`, `parent_id`, `retries`, `eta`, `expires` |
| `task-started` | `Request.on_accepted` | `uuid` |
| `task-succeeded` | `Request.on_success` | `uuid`, `result`, `runtime` |
| `task-failed` | `Request.on_failure`, `on_timeout`, unknown tasks | `uuid`, `exception`, `traceback` |
| `task-retried` | `Request.on_retry` | `uuid`, `exception`, `traceback` |
| `task-rejected` | `Request.reject` | `uuid`, `requeue` |
| `task-revoked` | Revocation | `uuid`, `terminated`, `signum`, `expired` |
| `worker-online`, `worker-heartbeat`, `worker-offline` | `Heart` | `freq`, `active`, `processed`, `loadavg`, `sw_ident`, `sw_ver`, `sw_sys` |

Sources: [celery/app/amqp.py:405-417](repo://celery/app/amqp.py#L405-L417), [celery/app/amqp.py:589-603](repo://celery/app/amqp.py#L589-L603), [celery/worker/strategy.py:165-176](repo://celery/worker/strategy.py#L165-L176), [celery/worker/request.py:457-468](repo://celery/worker/request.py#L457-L468), [celery/worker/request.py:510-620](repo://celery/worker/request.py#L510-L620), [celery/worker/request.py:730-740](repo://celery/worker/request.py#L730-L740), [celery/worker/heartbeat.py:13-61](repo://celery/worker/heartbeat.py#L13-L61)

A task can send its own events with `self.send_event(type_, **fields)`, which uses a temporary dispatcher from the producer pool and the task's id as `uuid`; the docstring mentions custom event types for Flower and other monitors.

Sources: [celery/app/task.py:1003-1027](repo://celery/app/task.py#L1003-L1027), [celery/app/events.py:33-40](repo://celery/app/events.py#L33-L40)

## Sending events from the worker

The consumer's `Events` step creates the worker's dispatcher on its own write connection ([[The Consumer]]). It is enabled when task events (`-E`, `worker_send_task_events`), gossip or heartbeats are on; without `-E` its `groups` is `['worker']`, so only worker events are sent, and task events are dropped by `send()`. Task-level `send_events = False` also suppresses a task's events.

Sources: [celery/worker/consumer/events.py:16-56](repo://celery/worker/consumer/events.py#L16-L56), [celery/worker/request.py:510-513](repo://celery/worker/request.py#L510-L513)

`EventDispatcher.send(type, **fields)` drops events from groups not in `groups` when `groups` is set. With an event loop, events of the `task` group are buffered and sent together as a list on routing key `task.multi` once 24 have accumulated, or when the hub is next idle, which reduces the number of messages. Other events are published immediately. When publishing fails and `buffer_while_offline` is on (the default), the event goes to an outbound buffer that `flush()` resends after reconnecting; the `Events` step carries the old dispatcher's buffer and its groups (which remote control may have changed) over to the new one. The dispatcher is disabled on the `sql` transport.

Sources: [celery/events/dispatcher.py:44-86](repo://celery/events/dispatcher.py#L44-L86), [celery/events/dispatcher.py:144-206](repo://celery/events/dispatcher.py#L144-L206), [celery/worker/consumer/events.py:40-71](repo://celery/worker/consumer/events.py#L40-L71)

The `enable_events` and `disable_events` control commands add or remove the `task` group on a running worker's dispatcher ([[Remote Control and Revocation]]).

Sources: [celery/worker/control.py:344-367](repo://celery/worker/control.py#L344-L367)

## Heartbeats

The consumer's `Heart` step (disabled by `--without-heartbeat`) runs `worker.heartbeat.Heart`, which on start sends `worker-online` and then `worker-heartbeat` every `interval` seconds (2 by default, `--heartbeat-interval`) on the worker's timer, and sends `worker-offline` on stop. Each heartbeat carries the number of active requests, the number of tasks processed, the load average and the software identity, and fires the `heartbeat_sent` signal when it has receivers. The heart starts and stops with the dispatcher's enable and disable callbacks. The `heartbeat` control command sends one at once, and `EventReceiver` broadcasts it on startup so monitors learn about workers immediately.

Sources: [celery/worker/consumer/heart.py:10-36](repo://celery/worker/consumer/heart.py#L10-L36), [celery/worker/heartbeat.py:13-61](repo://celery/worker/heartbeat.py#L13-L61), [celery/worker/control.py:370-376](repo://celery/worker/control.py#L370-L376), [celery/events/receiver.py:93-106](repo://celery/events/receiver.py#L93-L106)

These are event-level heartbeats; the `Heart` docstring stresses they are not AMQP protocol heartbeats, which the consumer handles separately.

Sources: [celery/worker/consumer/heart.py:10-17](repo://celery/worker/consumer/heart.py#L10-L17)

## Receiving events

`EventReceiver(channel, handlers=None, routing_key='#', node_id=None, ...)` is a Kombu `ConsumerMixin` that consumes from a queue named `<event_queue_prefix>.<node_id>` bound to the event exchange. The queue's TTL (5 s), expiry (60 s), exclusivity (true) and durability (false) come from the `event_queue_*` settings; exclusive and durable together raise `ImproperlyConfigured`. Messages are consumed without acknowledgement, accepting the event serializer and JSON.

Sources: [celery/events/receiver.py:18-80](repo://celery/events/receiver.py#L18-L80), [celery/app/defaults.py:179-189](repo://celery/app/defaults.py#L179-L189)

`capture(limit=None, timeout=None, wakeup=True)` consumes until stopped. Each message, or each item of a batched list, passes through `event_from_message`, which keeps the receiver's Lamport clock in step with the event's clock (for `task-sent` events, which come from clients that "never sync", it assigns one just below the current value), converts the timestamp using the sender's `utcoffset`, and records `local_received`. The event is then passed to `handlers[type]`, or to the `'*'` handler.

Sources: [celery/events/receiver.py:82-146](repo://celery/events/receiver.py#L82-L146)

## Cluster state

`State` turns the event stream into objects: `state.workers` maps host names to `Worker` objects and `state.tasks` maps ids to `Task` objects, both LRU caches bounded by `max_workers_in_memory` (5,000) and `max_tasks_in_memory` (10,000). Passing `state.event` as the receiver's `'*'` handler keeps it up to date. Handlers registered in `state.handlers` by group take over processing for that group.

Sources: [celery/events/state.py:398-440](repo://celery/events/state.py#L398-L440), [celery/events/state.py:501-555](repo://celery/events/state.py#L501-L555)

For worker events, the `Worker` object keeps a sorted list of recent heartbeat receive times and warns when an event's timestamp differs from its receive time by more than 16 seconds ("clocks may be out of sync"). A worker is `alive` while the last heartbeat is younger than `freq * 200%` (`HEARTBEAT_EXPIRE_WINDOW`); `worker-offline` clears its heartbeats and removes it, calling `on_node_leave`, while a first event or `worker-online` calls `on_node_join`.

Sources: [celery/events/state.py:44-124](repo://celery/events/state.py#L44-L124), [celery/events/state.py:183-240](repo://celery/events/state.py#L183-L240), [celery/events/state.py:557-578](repo://celery/events/state.py#L557-L578)

For task events, the `Task` object records the timestamp of each event type (`received`, `started`, `succeeded`, ...) and its fields. Because events can arrive out of order, it compares states by precedence ([[Task States and AsyncResult]]): an event whose state logically happened before the current one does not change the state, and only the fields its merge rule allows are taken (from `task-received`: name, args, kwargs, ids, retries, ETA and expiry). Every task event also updates the sending worker's heartbeat list, links the task to its parent and children by `parent_id`, and is pushed onto a heap ordered by `(clock, timestamp, origin)`, used by `tasks_by_time()`; `tasks_by_type` and `tasks_by_worker` index tasks by name and host.

Sources: [celery/events/state.py:243-333](repo://celery/events/state.py#L243-L333), [celery/events/state.py:579-634](repo://celery/events/state.py#L579-L634), [celery/events/state.py:650-708](repo://celery/events/state.py#L650-L708)

## Monitoring tools

`celery events` chooses one of three tools ([[Command Line Interface]]):

Sources: [celery/bin/events.py:83-98](repo://celery/bin/events.py#L83-L98)

| Option | Tool | Behaviour |
| --- | --- | --- |
| none | `evtop` | Curses monitor: a `CursesMonitor` display over a `State`, refreshed by a display thread, reconnecting on connection loss |
| `-d`/`--dump` | `evdump` | Prints each event as a line: host, time, type and fields, with task name and arguments remembered from `task-received`/`task-sent` |
| `-c`/`--camera <class>` | `evcam` | Takes periodic snapshots of a `State` with a camera class; supports `--detach`, `-F`/`--frequency` and `-r`/`--maxrate` |

Sources: [celery/bin/events.py:1-98](repo://celery/bin/events.py#L1-L98), [celery/events/cursesmon.py:492-530](repo://celery/events/cursesmon.py#L492-L530), [celery/events/dumper.py:36-100](repo://celery/events/dumper.py#L36-L100)

A camera subclasses `Polaroid(state, freq=1.0, maxrate=None, cleanup_freq=3600.0)`: every `freq` seconds it calls `on_shutter(state)` while the state is frozen (and sends `shutter_signal`), limited to `maxrate` snapshots per period by a token bucket, and every `cleanup_freq` seconds it calls `on_cleanup()`. The module docstring explains the purpose, taking snapshots of the cluster at regular intervals because "consuming the events as a stream isn't always suitable". `evcam` instantiates the camera, installs its timers, and captures all events into the state until interrupted.

Sources: [celery/events/snapshot.py:1-111](repo://celery/events/snapshot.py#L1-L111)
