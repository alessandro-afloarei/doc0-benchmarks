---
title: "Events and Monitoring"
---
## Overview

Workers and clients can publish events, small messages that say what just happened: a task was sent, received, started, succeeded or failed; a worker came online, sent a heartbeat or went offline. Events go to a dedicated `celeryev` exchange, separate from task queues, and anything that wants to watch the cluster binds its own queue to it. `celery.events` contains the publishing side (`EventDispatcher`), the consuming side (`EventReceiver`), an in-memory model of the cluster built from events (`State`), and three consumers: the dumper, the curses monitor and the snapshot camera. This page covers them all; [[Remote Control and Inspection]] covers the other monitoring channel, request/reply commands.

Sources: [celery/events/event.py:1-63](repo://celery/events/event.py#L1-L63), [celery/app/events.py:7-40](repo://celery/app/events.py#L7-L40)

## Event format

### Structure and routing

An event is a plain dict with a `type` such as `task-succeeded` and a `timestamp`; `Event(type, **fields)` adds the timestamp if missing. The part of the type before the first dash is its group (`task`, `worker`, or a custom prefix), and the dispatcher publishes with the type as routing key, dashes replaced by dots (`task.succeeded`). Every published event also carries `hostname`, `utcoffset`, `pid` and `clock`, the sender's Lamport clock value.

Sources: [celery/events/event.py:18-43](repo://celery/events/event.py#L18-L43), [celery/events/dispatcher.py:116-140](repo://celery/events/dispatcher.py#L116-L140)

The exchange is a topic exchange named by `event_exchange` (default `celeryev`). On Redis and Google Pub/Sub transports it is a fanout exchange instead, because those transports' topic routing does not work for this; consumers then filter by type themselves.

Sources: [celery/events/event.py:11-63](repo://celery/events/event.py#L11-L63), [celery/app/defaults.py:179-189](repo://celery/app/defaults.py#L179-L189)

### Events Celery sends

| Event | Sent by | Fields beyond the standard ones |
| --- | --- | --- |
| `task-sent` | Client, with `task_send_sent_event` | `uuid`, `name`, `args`, `kwargs`, `retries`, `eta`, `expires`, `queue`, `exchange`, `routing_key`, `root_id`, `parent_id` |
| `task-received` | Worker, when the message arrives | `uuid`, `name`, `args`, `kwargs`, `retries`, `eta`, `expires`, `root_id`, `parent_id` |
| `task-started` | Worker, when a pool process accepts it | `uuid` |
| `task-succeeded` | Worker | `uuid`, `result`, `runtime` |
| `task-failed` | Worker | `uuid`, `exception`, `traceback` |
| `task-retried` | Worker | `uuid`, `exception`, `traceback` |
| `task-rejected` | Worker | `uuid`, `requeue` |
| `task-revoked` | Worker | `uuid`, `terminated`, `signum`, `expired` |
| `worker-online`, `worker-heartbeat`, `worker-offline` | Worker | `freq`, `active`, `processed`, `loadavg`, `sw_ident`, `sw_ver`, `sw_sys` |

Sources: [celery/app/amqp.py:404-418](repo://celery/app/amqp.py#L404-L418), [celery/worker/strategy.py:173-182](repo://celery/worker/strategy.py#L173-L182), [celery/worker/request.py:457-469](repo://celery/worker/request.py#L457-L469), [celery/worker/request.py:596-620](repo://celery/worker/request.py#L596-L620), [celery/worker/heartbeat.py:39-61](repo://celery/worker/heartbeat.py#L39-L61)

Task events are sent only when the worker runs with `-E` (`worker_send_task_events`) and the task's `send_events` is true; the `enable_events` remote command turns them on at run time. Worker events are sent whenever the dispatcher is enabled, which the consumer's `Events` step does if task events, heartbeats or gossip are on. A task can send its own events with `self.send_event(type, **fields)`.

Sources: [celery/worker/consumer/events.py:12-71](repo://celery/worker/consumer/events.py#L12-L71), [celery/worker/request.py:511-513](repo://celery/worker/request.py#L511-L513), [celery/app/task.py:1003-1027](repo://celery/app/task.py#L1003-L1027)

## Publishing: EventDispatcher

`app.events.Dispatcher(connection, hostname, enabled=True, groups=None, ...)` creates a producer on the event exchange with the `event_serializer` (JSON by default). It disables itself on transports that cannot carry events (the SQL transport). With `groups` set, `send()` drops events whose group is not listed; the worker uses `groups=['worker']` when task events are off.

Sources: [celery/events/dispatcher.py:20-114](repo://celery/events/dispatcher.py#L20-L114)

`send(type, **fields)` publishes immediately, or buffers the event when its group is in `buffer_group`. The worker buffers task events when it runs an event loop: buffered events are published together as one list message with routing key `task.multi` when the buffer reaches `buffer_limit` (24) or when the loop flushes it. If publishing fails and `buffer_while_offline` is on, the event is kept in an outbound buffer and sent by the next `flush()`; when the consumer reconnects, the new dispatcher takes over the old one's buffer.

Sources: [celery/events/dispatcher.py:142-217](repo://celery/events/dispatcher.py#L142-L217), [celery/worker/consumer/events.py:39-58](repo://celery/worker/consumer/events.py#L39-L58), [celery/worker/consumer/consumer.py:624-630](repo://celery/worker/consumer/consumer.py#L624-L630)

`app.events.default_dispatcher()` is a context manager that borrows a producer from the app's pool, for code that sends a few events and has no dispatcher of its own.

Sources: [celery/app/events.py:32-40](repo://celery/app/events.py#L32-L40)

## Worker heartbeats

The consumer's `Heart` step (disabled with `--without-heartbeat`) starts a `Heart` on the worker's timer. It sends `worker-online` when the dispatcher is enabled, `worker-heartbeat` every `interval` seconds (2 by default), and `worker-offline` when stopped. Each heartbeat reports the frequency, number of active requests, total processed tasks, load average and software info, and sends the `heartbeat_sent` signal if anything listens to it.

Sources: [celery/worker/heartbeat.py:14-61](repo://celery/worker/heartbeat.py#L14-L61), [celery/worker/consumer/heart.py:1-36](repo://celery/worker/consumer/heart.py#L1-L36)

## Consuming: EventReceiver

`app.events.Receiver(connection, handlers={...}, routing_key='#')` declares a queue named `<event_queue_prefix>.<uuid>` bound to the event exchange. By default the queue is exclusive and auto-deleted, with a 5-second message TTL (`event_queue_ttl`) and a 60-second expiry (`event_queue_expires`), so an abandoned monitor leaves nothing behind. Asking for an exclusive and durable queue at once raises `ImproperlyConfigured`. Handlers map event types to callables, and `'*'` catches any type without its own handler.

Sources: [celery/events/receiver.py:23-88](repo://celery/events/receiver.py#L23-L88), [celery/app/defaults.py:179-189](repo://celery/app/defaults.py#L179-L189)

`capture(limit=None, timeout=None, wakeup=True)` consumes until stopped. When it starts it broadcasts the `heartbeat` remote command, so every worker sends a heartbeat at once and a new monitor sees the cluster immediately. Each message, a single event or a list of buffered ones, passes through `event_from_message`. That function synchronizes the receiver's Lamport clock with the event's clock; for `task-sent` events from clients, which do not keep a synchronized clock, it uses the receiver's clock minus one. It converts the timestamp to local time with the sender's UTC offset and records `local_received`.

Sources: [celery/events/receiver.py:95-145](repo://celery/events/receiver.py#L95-L145)

```python
def on_event(event):
    print(event['type'], event.get('uuid'))

with app.connection() as connection:
    recv = app.events.Receiver(connection, handlers={'*': on_event})
    recv.capture(limit=None, timeout=None, wakeup=True)
```

Sources: [celery/events/receiver.py:36-45](repo://celery/events/receiver.py#L36-L45), [celery/events/receiver.py:98-106](repo://celery/events/receiver.py#L98-L106)

## Cluster state: State

### Workers and tasks

`app.events.State()` turns a stream of events into objects. Pass `state.event` as the receiver's `'*'` handler. It keeps `workers` and `tasks` in LRU caches (5,000 workers and 10,000 tasks by default), a time-ordered heap of task events, and indexes `tasks_by_type` and `tasks_by_worker`.

Sources: [celery/events/state.py:398-437](repo://celery/events/state.py#L398-L437)

A `Worker` keeps the fields of its latest event and the last four heartbeat receive times. `alive` is true while the newest heartbeat is younger than `freq × 200%`, so a worker with the default 2-second frequency is considered offline after 4 seconds without heartbeats. A difference of more than 16 seconds between an event's timestamp and its receive time logs a clock-drift warning, once per host.

Sources: [celery/events/state.py:43-56](repo://celery/events/state.py#L43-L56), [celery/events/state.py:114-123](repo://celery/events/state.py#L114-L123), [celery/events/state.py:149-240](repo://celery/events/state.py#L149-L240)

A `Task` records the state from `TASK_EVENT_TO_STATE` (`task-received` → `RECEIVED`, `task-failed` → `FAILURE`, and so on) and a timestamp attribute per event (`received`, `started`, `succeeded`, ...). Unknown event types become custom upper-case states. Events can arrive out of order, so a task event that logically precedes the current state, by `states.precedence`, does not overwrite it. Only the fields in `merge_rules` are merged from it, for example name, args and kwargs from `RECEIVED`. Tasks are linked to their parents and children by `parent_id`, and children seen before their parent are attached when the parent appears.

Sources: [celery/events/state.py:66-76](repo://celery/events/state.py#L66-L76), [celery/events/state.py:243-332](repo://celery/events/state.py#L243-L332), [celery/events/state.py:620-642](repo://celery/events/state.py#L620-L642)

### Processing events and queries

The event handler is built once by `_create_dispatcher`. It calls the optional `callback(state, event)`, routes events whose group has a custom handler in `state.handlers`, and otherwise updates worker or task objects. It calls `on_node_join` when a worker appears or comes online and `on_node_leave` when it goes offline. The heap is capped at four events per task in memory.

Sources: [celery/events/state.py:513-578](repo://celery/events/state.py#L513-L578), [celery/events/state.py:579-634](repo://celery/events/state.py#L579-L634)

Queries: `tasks_by_time(limit)` walks the heap newest first; `tasks_by_type[name]` and `tasks_by_worker[hostname]` are sets, and calling them as functions returns time-ordered generators; `task_types()` lists the names seen; `alive_workers()` filters by heartbeat. `freeze_while(fun, clear_after=False)` runs `fun` while holding the state's lock, optionally clearing finished tasks afterwards.

Sources: [celery/events/state.py:442-449](repo://celery/events/state.py#L442-L449), [celery/events/state.py:650-708](repo://celery/events/state.py#L650-L708)

The worker's `Gossip` step uses this same `State`, keeping one task in memory, to track the other workers ([[The Consumer]]).

Sources: [celery/worker/consumer/gossip.py:36-70](repo://celery/worker/consumer/gossip.py#L36-L70)

## Monitors

### The celery events command

`celery events` runs one of three consumers. With no option it starts the curses monitor (`celery.events.cursesmon`), an interactive table of recent tasks and workers built on `State`. `--dump` (`-d`) prints every event as a human-readable line. `--camera` (`-c`) runs a snapshot camera.

Sources: [celery/bin/events.py:12-98](repo://celery/bin/events.py#L12-L98), [celery/events/dumper.py:36-80](repo://celery/events/dumper.py#L36-L80)

### Snapshot cameras

A camera is a `Polaroid` subclass that periodically records the state somewhere, for example a database. `evcam(camera, freq, maxrate)` creates a `State`, attaches a receiver that feeds it, and installs the camera. Every `freq` seconds the camera calls `capture()`, which runs `shutter()` under `freeze_while` so the state does not change mid-snapshot. If the `maxrate` token bucket allows it, `shutter()` sends `shutter_signal` and calls `on_shutter(state)`, the method to override. Every hour, `cleanup()` sends `cleanup_signal` and calls `on_cleanup()`. Setting `clear_after = True` empties finished tasks after each snapshot.

Sources: [celery/events/snapshot.py:24-111](repo://celery/events/snapshot.py#L24-L111)

```python
from celery.events.snapshot import Polaroid

class DumpCam(Polaroid):
    clear_after = True

    def on_shutter(self, state):
        print(f'{len(state.tasks)} tasks, workers: {list(state.workers)}')
```

Sources: [celery/events/snapshot.py:24-66](repo://celery/events/snapshot.py#L24-L66)

Run it with `celery -A proj events -c myapp.DumpCam --frequency=2.0`. `--maxrate` limits snapshots, and `--detach` runs the camera as a daemon.

Sources: [celery/bin/events.py:24-81](repo://celery/bin/events.py#L24-L81)
