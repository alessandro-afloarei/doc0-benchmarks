---
title: "Events and Monitoring"
---
## Overview

Events are Celery's monitoring stream. Workers publish a message every time a task is received, started, succeeds, fails, is retried, rejected or revoked, and every couple of seconds a heartbeat saying they are alive; clients can publish `task-sent`. Monitors such as Flower, `celery events` or your own consumer subscribe to the stream and reconstruct the state of the cluster in memory. Events are separate from results: they are not stored, they are only seen by monitors that are listening, and they are off for tasks by default. Asking workers questions on demand is covered on [[Remote Control and Inspection]].

Sources: [celery/events/dispatcher.py:14-82](repo://celery/events/dispatcher.py#L14-L82), [celery/events/receiver.py:21-80](repo://celery/events/receiver.py#L21-L80)

`app.events` gives app-bound versions of the three parts: `Dispatcher` (sending), `Receiver` (consuming) and `State` (the in-memory model), plus `default_dispatcher()`, a context manager that borrows a producer from the pool.

Sources: [celery/app/events.py:7-40](repo://celery/app/events.py#L7-L40)

## Event messages

An event is a plain dict with a `type` such as `task-succeeded` and a `timestamp`; the dispatcher adds `hostname`, `utcoffset`, `pid` and `clock`, the sender's Lamport clock value that receivers use to order events from different hosts. The part of the type before the first dash is the group (`task`, `worker`, or anything custom). Events are published to the `celeryev` exchange (`event_exchange`) with the type as routing key, dashes replaced by dots; the exchange is a topic exchange, except on Redis and Google Pub/Sub where it is fanout.

Sources: [celery/events/event.py:1-63](repo://celery/events/event.py#L1-L63), [celery/events/dispatcher.py:104-145](repo://celery/events/dispatcher.py#L104-L145)

| Event | Sent by | Main fields |
| --- | --- | --- |
| `task-sent` | Client, with `task_send_sent_event` | name, args, kwargs, retries, eta, expires, queue, exchange, routing_key, root_id, parent_id |
| `task-received` | Worker strategy | name, args, kwargs, retries, eta, expires, root_id, parent_id |
| `task-started` | Request when the pool accepts it | |
| `task-succeeded` | Request | result (repr), runtime |
| `task-failed` | Request or consumer | exception, traceback |
| `task-retried` | Request | exception, traceback |
| `task-rejected` | Request | requeue |
| `task-revoked` | Request | terminated, signum, expired |
| `worker-online`, `worker-heartbeat`, `worker-offline` | Worker heart | freq, active, processed, loadavg, sw_ident, sw_ver, sw_sys |

Sources: [celery/app/amqp.py:401-416](repo://celery/app/amqp.py#L401-L416), [celery/worker/strategy.py:166-177](repo://celery/worker/strategy.py#L166-L177), [celery/worker/request.py:457-527](repo://celery/worker/request.py#L457-L527), [celery/worker/request.py:596-627](repo://celery/worker/request.py#L596-L627), [celery/worker/heartbeat.py:30-61](repo://celery/worker/heartbeat.py#L30-L61)

## Sending events

### EventDispatcher

`EventDispatcher(connection, hostname, enabled, groups, ...)` creates a producer on the event exchange. It disables itself on the `sql` transport, which cannot carry events. `send(type, **fields)` drops events whose group is not in `groups` (when set), then either publishes at once or appends to a per-group buffer. `publish` takes a lock, forwards the Lamport clock, builds the event and publishes it with the event serializer (`event_serializer`, JSON).

Sources: [celery/events/dispatcher.py:43-103](repo://celery/events/dispatcher.py#L43-L103), [celery/events/dispatcher.py:147-175](repo://celery/events/dispatcher.py#L147-L175)

Two kinds of buffering keep events cheap and safe. Groups listed in `buffer_group` are collected in lists and published together as one `<group>.multi` message when `buffer_limit` (24) events have accumulated or `flush()` is called; the worker buffers `task` events this way when it runs an event loop, and the hub flushes them on its next iteration. With `buffer_while_offline` (the default), a publish that fails is kept in an outbound buffer and resent on `flush()`, which the worker calls after reconnecting.

Sources: [celery/events/dispatcher.py:147-208](repo://celery/events/dispatcher.py#L147-L208), [celery/worker/consumer/events.py:35-54](repo://celery/worker/consumer/events.py#L35-L54)

### Enabling events in the worker

The consumer's `Events` bootstep creates the dispatcher when task events, gossip or heartbeats are on. Task events are off unless the worker runs with `-E` or `worker_send_task_events`; otherwise the dispatcher is limited to the `worker` group. The `enable_events` and `disable_events` control commands switch task events at run time, and the step keeps the groups across reconnects. Each task can opt out with `send_events = False`.

Sources: [celery/worker/consumer/events.py:12-71](repo://celery/worker/consumer/events.py#L12-L71), [celery/worker/request.py:511-513](repo://celery/worker/request.py#L511-L513)

### Heartbeats

The `Heart` bootstep starts `celery.worker.heartbeat.Heart`, which sends `worker-online` when started, `worker-heartbeat` every 2 seconds on the worker timer (with the number of active tasks, total processed and the load average), and `worker-offline` when stopped. It follows the dispatcher: disabling events stops heartbeats. These are monitoring events, unrelated to AMQP connection heartbeats.

Sources: [celery/worker/heartbeat.py:1-61](repo://celery/worker/heartbeat.py#L1-L61), [celery/worker/consumer/heart.py:1-36](repo://celery/worker/consumer/heart.py#L1-L36)

## Receiving events

`EventReceiver(channel, handlers, routing_key='#')` declares its own queue named `celeryev.<uuid>` bound to the event exchange. The queue is exclusive and auto-deleted by default, with messages expiring after 5 seconds and the queue after 60 seconds idle (`event_queue_*` settings), so a monitor that disconnects does not leave a growing queue behind. Exclusive and durable together is refused.

Sources: [celery/events/receiver.py:21-80](repo://celery/events/receiver.py#L21-L80), [celery/app/defaults.py:179-189](repo://celery/app/defaults.py#L179-L189)

`capture()` consumes until interrupted; `itercapture()` yields as it goes. On connect it broadcasts the `heartbeat` control command so workers announce themselves immediately instead of after the next interval. Each message (or each element of a `.multi` batch) passes through `event_from_message`, which adjusts the local Lamport clock, converts the timestamp to local time using the sender's `utcoffset`, and adds `local_received`, then goes to the handler for its type or to the `'*'` handler.

Sources: [celery/events/receiver.py:82-149](repo://celery/events/receiver.py#L82-L149)

```python
def on_event(event):
    print(event['type'], event.get('uuid'), event.get('hostname'))

with app.connection() as conn:
    recv = app.events.Receiver(conn, handlers={'*': on_event})
    recv.capture(limit=None, timeout=None, wakeup=True)
```

Sources: [celery/events/receiver.py:82-111](repo://celery/events/receiver.py#L82-L111)

## Cluster state

### State

`app.events.State()` turns the event stream into objects. Passing `state.event` as the receiver's `'*'` handler updates two LRU caches: `workers` (up to 5,000) and `tasks` (up to 10,000), plus a time-ordered heap of task events and indexes `tasks_by_type` and `tasks_by_worker`. Custom handlers can be registered per group in `state.handlers`.

Sources: [celery/events/state.py:398-440](repo://celery/events/state.py#L398-L440), [celery/events/state.py:513-560](repo://celery/events/state.py#L513-L560)

A `Worker` keeps its fields and a list of recent heartbeat receive times. It is `alive` while the latest heartbeat is younger than `freq × 2` (the 200% expire window), so a worker is reported offline after missing about two heartbeats. A difference of more than 16 seconds between the sender's timestamp and the receive time logs a clock-drift warning once per host.

Sources: [celery/events/state.py:48-52](repo://celery/events/state.py#L48-L52), [celery/events/state.py:107-125](repo://celery/events/state.py#L107-L125), [celery/events/state.py:149-241](repo://celery/events/state.py#L149-L241)

A `Task` maps each event type to a state (`task-received` to `RECEIVED`, `task-succeeded` to `SUCCESS`, and so on; unknown types become upper-case custom states) and records the timestamp of each. Events can arrive out of order across hosts, so a task only moves to a state of higher precedence, except that fields listed in `merge_rules` (name, args, kwargs, retries, eta, expires, root and parent ids) are always taken from `task-received`. Tasks link to their parent, root and children as those tasks appear.

Sources: [celery/events/state.py:67-76](repo://celery/events/state.py#L67-L76), [celery/events/state.py:243-333](repo://celery/events/state.py#L243-L333), [celery/events/state.py:560-640](repo://celery/events/state.py#L560-L640)

Queries include `tasks_by_time()`, `tasks_by_type(name)`, `tasks_by_worker(hostname)`, `task_types()` and `alive_workers()`. `freeze_while(fun, clear_after=False)` runs `fun` under the state lock so a snapshot sees a consistent state. The `Gossip` consumer step in the worker uses the same `State` to track its peers ([[Consumer and Event Loop]]).

Sources: [celery/events/state.py:442-450](repo://celery/events/state.py#L442-L450), [celery/events/state.py:650-710](repo://celery/events/state.py#L650-L710)

## Snapshots and the events command

### Cameras

A camera is a `Polaroid` subclass that receives the `State` at a fixed frequency. `install()` schedules `capture` every `freq` seconds, which calls `shutter` under the state lock, optionally limited by `maxrate`, and `cleanup` every hour. Subclasses override `on_shutter(state)`, for example to write the state to a database, and `on_cleanup()`. `evcam(camera, freq, maxrate)` wires a camera, a `State` and a receiver together and captures until interrupted.

Sources: [celery/events/snapshot.py:1-111](repo://celery/events/snapshot.py#L1-L111)

```python
from celery.events.snapshot import Polaroid


class DumpCam(Polaroid):
    clear_after = True   # clear state after each shutter

    def on_shutter(self, state):
        print(f'Workers: {len(state.alive_workers())}, tasks: {state.task_count}')
```

Sources: [celery/events/snapshot.py:21-77](repo://celery/events/snapshot.py#L21-L77)

### celery events

`celery events` chooses one of three tools. With no options it runs the curses monitor (`evtop`), a terminal UI listing tasks and workers that can revoke tasks and change rate limits. `--dump` runs `evdump`, which prints every event in a readable form. `--camera=<class>` runs `evcam` with that camera, with `--frequency` and `--maxrate`, and supports `--detach`, `--pidfile` and `--logfile` for running a camera as a daemon.

Sources: [celery/bin/events.py:1-98](repo://celery/bin/events.py#L1-L98), [celery/events/dumper.py:1-103](repo://celery/events/dumper.py#L1-L103)

```bash
celery -A proj worker -E -l INFO            # send task events
celery -A proj events                        # curses monitor
celery -A proj events --dump                 # print raw events
celery -A proj events --camera=proj.cams.DumpCam --frequency=2.0
```

Sources: [celery/bin/events.py:36-81](repo://celery/bin/events.py#L36-L81)
