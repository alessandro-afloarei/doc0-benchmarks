---
title: "Events and Monitoring"
---
## Overview

Workers and clients can publish *events*: small JSON messages describing what happened to a task (`task-received`, `task-started`, `task-succeeded` …) or a worker (`worker-online`, `worker-heartbeat`, `worker-offline`). Monitors consume them from a dedicated exchange and build an in-memory picture of the cluster. `celery.events` provides the three parts: `EventDispatcher` sends events, `EventReceiver` consumes them, and `State` folds them into worker and task records. The `celery events` command builds a curses monitor, a dumper and a snapshot camera on top. Task events are off by default and are enabled per worker with `-E` or `worker_send_task_events`, or at run time with the `enable_events` remote command ([[Remote Control and Inspection]]).

Sources: [celery/events/dispatcher.py:19-92](repo://celery/events/dispatcher.py#L19-L92), [celery/events/receiver.py:23-79](repo://celery/events/receiver.py#L23-L79), [celery/events/state.py:398-438](repo://celery/events/state.py#L398-L438), [celery/worker/worker.py:377-377](repo://celery/worker/worker.py#L377-L377), [celery/app/defaults.py:366-368](repo://celery/app/defaults.py#L366-L368)

## The event format

An event is a plain dict whose only required field is `type`; `Event()` adds a `timestamp` when none is given. The type's group is the part before the first dash (`task-sent` → `task`), and the dispatcher adds `hostname`, `utcoffset`, `pid` and the sender's logical `clock`. Events travel on the `celeryev` exchange (setting `event_exchange`), a topic exchange with routing keys like `task.succeeded`, except on Redis and Google Pub/Sub where it is a fanout exchange (Issue #436).

Sources: [celery/events/event.py:9-62](repo://celery/events/event.py#L9-L62), [celery/events/dispatcher.py:116-140](repo://celery/events/dispatcher.py#L116-L140)

| Event | Sent by | Main fields |
| --- | --- | --- |
| `task-sent` | client, with `task_send_sent_event` | `uuid`, `name`, `args`, `kwargs`, `retries`, `eta`, `expires`, `queue`, `exchange`, `routing_key` |
| `task-received` | worker strategy | `uuid`, `name`, `args`, `kwargs`, `root_id`, `parent_id`, `retries`, `eta`, `expires` |
| `task-started` | `Request.on_accepted` | `uuid` |
| `task-succeeded` | `Request.on_success` | `uuid`, `result`, `runtime` |
| `task-failed` | `Request.on_failure`, hard timeout | `uuid`, `exception`, `traceback` |
| `task-retried` | `Request.on_retry` | `uuid`, `exception`, `traceback` |
| `task-revoked` | revoke announcement | `uuid`, `terminated`, `signum`, `expired` |
| `task-rejected` | `Request.reject` | `uuid`, `requeue` |
| `task-cancelled` | `Request.cancel` | `uuid` |
| `worker-online`, `worker-heartbeat`, `worker-offline` | `Heart` | `freq`, `active`, `processed`, `loadavg`, `sw_ident`, `sw_ver`, `sw_sys` |

Sources: [celery/app/amqp.py:404-418](repo://celery/app/amqp.py#L404-L418), [celery/app/amqp.py:593-605](repo://celery/app/amqp.py#L593-L605), [celery/worker/strategy.py:165-175](repo://celery/worker/strategy.py#L165-L175), [celery/worker/request.py:439-527](repo://celery/worker/request.py#L439-L527), [celery/worker/request.py:596-620](repo://celery/worker/request.py#L596-L620), [celery/worker/heartbeat.py:15-60](repo://celery/worker/heartbeat.py#L15-L60)

Tasks can send custom events with `self.send_event('task-progress', ...)` ([[Defining Tasks]]); any type name works, and `State` records an unknown task event type as a custom state.

Sources: [celery/app/task.py:1003-1027](repo://celery/app/task.py#L1003-L1027), [celery/events/state.py:305-332](repo://celery/events/state.py#L305-L332)

## Sending: EventDispatcher

`app.events.Dispatcher(connection, hostname, enabled=True, groups=None, buffer_while_offline=True, ...)` creates a producer on the events exchange when enabled, with `event_serializer` (JSON by default). Transports listed in `DISABLED_TRANSPORTS` (`sql`) disable it. `on_enabled` and `on_disabled` callbacks let other parts follow it; the worker's heartbeat starts and stops this way.

Sources: [celery/events/dispatcher.py:48-114](repo://celery/events/dispatcher.py#L48-L114), [celery/worker/heartbeat.py:24-32](repo://celery/worker/heartbeat.py#L24-L32)

`send(type, **fields)` drops events whose group is not in `groups` when that set is non-empty; the worker uses `groups=['worker']` when task events are off, so heartbeats still flow. Groups in `buffer_group` are collected and published together as one `<group>.multi` message once `buffer_limit` (24) is reached or when the event loop flushes; the worker buffers task events this way when it runs the event loop. A publish error is re-raised unless `buffer_while_offline` is on, in which case the event waits in an outbound buffer that `flush()` sends after reconnecting.

Sources: [celery/events/dispatcher.py:142-217](repo://celery/events/dispatcher.py#L142-L217), [celery/worker/consumer/events.py:35-52](repo://celery/worker/consumer/events.py#L35-L52)

## Receiving: EventReceiver

`app.events.Receiver(connection, handlers={...})` declares its own queue `celeryev.<uuid>` (prefix `event_queue_prefix`) bound to the events exchange with routing key `#`. By default the queue is exclusive, auto-deleted, has a 5-second message TTL and expires after 60 seconds unused; asking for a queue both exclusive and durable raises `ImproperlyConfigured`. It accepts the event serializer plus JSON.

Sources: [celery/events/receiver.py:36-78](repo://celery/events/receiver.py#L36-L78), [celery/app/defaults.py:179-188](repo://celery/app/defaults.py#L179-L188)

`capture(limit=None, timeout=None, wakeup=True)` consumes until stopped. When consuming starts it broadcasts a `heartbeat` command so every worker sends a heartbeat at once and appears immediately. Each message is one event or, from 4.0 on, a list of buffered events. `event_from_message` maintains the logical clock: `task-sent` events come from clients that never synchronize, so their clock is replaced with the receiver's own clock minus one; other events adjust the receiver's clock. Timestamps are converted with the sender's `utcoffset`, and `local_received` is added before the event goes to `handlers[type]` or the `'*'` handler.

Sources: [celery/events/receiver.py:80-146](repo://celery/events/receiver.py#L80-L146), [celery/events/receiver.py:18-18](repo://celery/events/receiver.py#L18-L18)

## Cluster state: State

### Records

`State(callback=None, max_workers_in_memory=5000, max_tasks_in_memory=10000, on_node_join, on_node_leave)` keeps `workers` and `tasks` in LRU caches and a heap of task events ordered by `(clock, timestamp, origin)`. `state.event(event)` is the handler to give a receiver, usually as `handlers={'*': state.event}`. Custom handlers for a group can be added through `state.handlers`.

Sources: [celery/events/state.py:398-438](repo://celery/events/state.py#L398-L438), [celery/events/state.py:513-560](repo://celery/events/state.py#L513-L560)

For `worker-*` events it creates or updates a `Worker` with the event fields and keeps its last four heartbeat receive times, warning when the sender's timestamp drifts from the receive time by more than 16 seconds. `worker.alive` is true while the last heartbeat is within the heartbeat frequency times 200%. `worker-offline` clears the heartbeats, calls `on_node_leave` and removes the worker; a new or `online` worker calls `on_node_join`.

Sources: [celery/events/state.py:43-57](repo://celery/events/state.py#L43-L57), [celery/events/state.py:114-124](repo://celery/events/state.py#L114-L124), [celery/events/state.py:149-240](repo://celery/events/state.py#L149-L240), [celery/events/state.py:561-588](repo://celery/events/state.py#L561-L588)

For `task-*` events it creates or updates a `Task`, attaches its worker (or, for `task-sent`, its client hostname), and adds an entry to the time heap, dropping the oldest when the heap exceeds four entries per task allowed in memory.

Sources: [celery/events/state.py:589-634](repo://celery/events/state.py#L589-L634)

### Out-of-order events

Events from different hosts can arrive in any order. `TASK_EVENT_TO_STATE` maps event names to states, and `Task.event` records the event time in an attribute of the same name (`task.succeeded`). It only moves `task.state` forward: when an event's state has lower precedence than the current one (it happened earlier), the event's fields are merged but the state is kept, and the `merge_rules` say that for `RECEIVED` only `name`, `args`, `kwargs`, `parent_id`, `root_id`, `retries`, `eta` and `expires` are taken. `RETRY` is exempt from the comparison. The precedence order is the one in `celery.states` ([[Task Results and States]]).

Sources: [celery/events/state.py:66-77](repo://celery/events/state.py#L66-L77), [celery/events/state.py:243-284](repo://celery/events/state.py#L243-L284), [celery/events/state.py:305-332](repo://celery/events/state.py#L305-L332)

### Queries

`tasks_by_time(limit)` walks the heap newest first, yielding each task once; `tasks_by_type[name]` and `tasks_by_worker[hostname]` hold weak sets, and calling them returns time-ordered results; `alive_workers()` filters live workers; `task_types()` lists names seen. `freeze_while(fun, clear_after=False)` runs `fun` under the state's lock, optionally clearing afterwards, and `clear_tasks(ready=True)` drops finished tasks.

Sources: [celery/events/state.py:442-475](repo://celery/events/state.py#L442-L475), [celery/events/state.py:650-712](repo://celery/events/state.py#L650-L712)

The worker's own `Gossip` step uses a `State` with `max_tasks_in_memory=1` to track other workers ([[The Consumer and Event Loop]]).

Sources: [celery/worker/consumer/gossip.py:52-60](repo://celery/worker/consumer/gossip.py#L52-L60)

## Monitoring tools

### celery events

`celery events` runs one of three tools: with `--dump` the dumper, with `-c/--camera` the snapshot camera (`-F/--frequency`, `-r/--maxrate`, `--detach`), and otherwise the curses monitor.

Sources: [celery/bin/events.py:18-46](repo://celery/bin/events.py#L18-L46), [celery/bin/events.py:83-96](repo://celery/bin/events.py#L83-L96)

The dumper prints every event in a readable line per event as it arrives, caching task names so later events for the same id show the name. The curses monitor (`CursesMonitor`) keeps a `State` and shows a scrollable list of recent tasks with their worker, time and state, with key bindings to inspect, revoke or rate-limit the selected task.

Sources: [celery/events/dumper.py:15-100](repo://celery/events/dumper.py#L15-L100), [celery/events/cursesmon.py:34-125](repo://celery/events/cursesmon.py#L34-L125), [celery/events/cursesmon.py:239-310](repo://celery/events/cursesmon.py#L239-L310)

### Snapshot cameras

Some uses need periodic snapshots rather than a stream. `Polaroid(state, freq=1.0, maxrate=None, cleanup_freq=3600)` installs timers that call `capture` every `freq` seconds, which runs `shutter` under `state.freeze_while`; `shutter` sends `shutter_signal` and calls `on_shutter(state)`, rate-limited by `maxrate`. `cleanup` runs hourly through `cleanup_signal` and `on_cleanup`. Subclasses override `on_shutter` to write the state somewhere, such as a database. `evcam(camera, ...)` creates the state and camera, takes a pidfile lock if asked, and captures all events into the state until interrupted.

Sources: [celery/events/snapshot.py:1-84](repo://celery/events/snapshot.py#L1-L84), [celery/events/snapshot.py:86-111](repo://celery/events/snapshot.py#L86-L111)

## App shortcuts

`app.events` exposes app-bound `Receiver`, `Dispatcher` and `State` classes, and `default_dispatcher()`, a context manager that takes a producer from the pool and yields a dispatcher on its connection and channel.

Sources: [celery/app/events.py:1-40](repo://celery/app/events.py#L1-L40)
