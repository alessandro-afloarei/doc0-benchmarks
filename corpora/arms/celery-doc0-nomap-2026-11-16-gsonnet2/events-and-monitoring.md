---
title: "Events and Monitoring"
---
## Overview

Events are Celery's real-time monitoring stream. Workers (and optionally clients) publish small dictionary messages, such as `task-received`, `task-succeeded` and `worker-heartbeat`, to a dedicated exchange; any number of receivers can consume them without affecting task delivery. Tools like `celery events` and external monitors build a picture of the cluster by folding that stream into a `State` object. This page covers the three halves: the `EventDispatcher` that sends, the `EventReceiver` that consumes, and the `State` that reconstructs workers and tasks.

Sources: [celery/events/dispatcher.py:19-57](repo://celery/events/dispatcher.py#L19-L57), [celery/events/receiver.py:23-35](repo://celery/events/receiver.py#L23-L35), [celery/events/state.py:398-401](repo://celery/events/state.py#L398-L401)

## What an event is

An event is a plain dictionary: `Event(type, **fields)` requires only `type` and fills `timestamp` with the current time if none is given. The event type's prefix before the first dash is its group (`group_from('task-sent')` is `task`), and the routing key is the type with dashes turned into dots (`task.sent`), so receivers can bind to a subset such as `task.*`.

Sources: [celery/events/event.py:18-43](repo://celery/events/event.py#L18-L43), [celery/events/dispatcher.py:116-141](repo://celery/events/dispatcher.py#L116-L141)

## Sending: EventDispatcher

`EventDispatcher(connection, hostname, enabled, groups, buffer_while_offline, serializer, buffer_group, buffer_limit, ...)` publishes to the exchange named by `event_exchange` using a producer with `auto_declare=False`. It disables itself on the `sql` transport. Its main behaviours:

| Behaviour | How it works |
| --- | --- |
| Enable/disable | `enable()` creates the producer and calls `on_enabled` callbacks; `disable()` closes it and calls `on_disabled`. Receivers of these callbacks include the heartbeat |
| Group filter | `send` ignores events whose group is not in `groups` (empty means all) |
| Logical clock | Each event is stamped with `clock.forward()` unless `blind=True` |
| Buffering offline | If publish fails and `buffer_while_offline` is on, `(event, routing_key)` goes to an outbound buffer; `flush` republishes it after reconnection |
| Group buffering | Events of groups in `buffer_group` are collected up to `buffer_limit` (default 24) and published together under `<group>.multi`; `on_send_buffered` is called per buffered event |
| Custom producer | `publish(type, fields, producer)` sends using a producer you provide, as the task publisher does for `task-sent` |

Sources: [celery/events/dispatcher.py:58-115](repo://celery/events/dispatcher.py#L58-L115), [celery/events/dispatcher.py:142-222](repo://celery/events/dispatcher.py#L142-L222)

## What the worker sends

The consumer's `Events` step creates the worker's dispatcher with `enabled` set if task events, gossip or heartbeats are wanted. When task events are off, it limits groups to `worker`. When an event loop (hub) is in use, the `task` group is buffered, which is why the step passes `buffer_group=['task']` and the consumer's `on_send_event_buffered` flush hook. On a restart it flushes events buffered while the connection was down into the new dispatcher and re-points reserved requests at it.

Sources: [celery/worker/consumer/events.py:15-52](repo://celery/worker/consumer/events.py#L15-L52), [celery/worker/consumer/consumer.py:624-631](repo://celery/worker/consumer/consumer.py#L624-L631)

The task lifecycle events come from the places described elsewhere: `task-sent` from the publisher (when `task_send_sent_event` is on, see [[Calling Tasks: apply_async and send_task]]); `task-received` from the strategy; `task-started`, `task-succeeded`, `task-failed`, `task-retried`, `task-revoked` and `task-cancelled` from `Request`. A task opts out with `send_events = False`; `Request.send_event` checks both the dispatcher and the task flag.

Sources: [celery/worker/strategy.py:176-186](repo://celery/worker/strategy.py#L176-L186), [celery/worker/request.py:511-527](repo://celery/worker/request.py#L511-L527), [celery/worker/request.py:439-468](repo://celery/worker/request.py#L439-L468)

The worker's liveness comes from `Heart`: when the dispatcher is enabled it sends `worker-online` and then `worker-heartbeat` every 2 seconds by default, with `freq`, the number of active requests, the processed total, the load average and software information. A `heartbeat_sent` signal is sent if it has receivers. The heart is wired to start and stop when the dispatcher is enabled or disabled, which is how the `enable_events` and `disable_events` remote commands (see [[Remote Control: Inspect and Control]]) turn monitoring on and off at runtime.

Sources: [celery/worker/heartbeat.py:19-61](repo://celery/worker/heartbeat.py#L19-L61), [celery/worker/consumer/heart.py:10-36](repo://celery/worker/consumer/heart.py#L10-L36), [celery/worker/control.py:345-370](repo://celery/worker/control.py#L345-L370)

## Receiving: EventReceiver

`EventReceiver` is a kombu `ConsumerMixin`. It creates a queue named `<event_queue_prefix>.<node_id>` bound to the event exchange with a routing key (default `#`, everything). Queue lifetime comes from `event_queue_ttl`, `event_queue_expires`, `event_queue_exclusive` and `event_queue_durable`; asking for a queue that is both exclusive and durable raises `ImproperlyConfigured`. It accepts the event serializer plus JSON, consumes without acknowledgement, and dispatches each event by type to the `handlers` dict, falling back to the `"*"` handler.

Sources: [celery/events/receiver.py:23-90](repo://celery/events/receiver.py#L23-L90)

`capture(limit, timeout, wakeup)` runs the consume loop, and with `wakeup` it first broadcasts a `heartbeat` control command so workers announce themselves immediately. `event_from_message` adjusts the receiver's logical clock from the event's clock (for `task-sent` it uses its own value, since clients never synchronize clocks), converts the timestamp using the sender's UTC offset and stamps `local_received`. A list body (the grouped form from the dispatcher) is processed event by event.

Sources: [celery/events/receiver.py:95-146](repo://celery/events/receiver.py#L95-L146)

## Rebuilding state: events.state

`State` keeps recent workers and tasks in LRU caches (defaults 5000 workers and 10000 tasks) and a time-ordered heap of tasks, indexed by task name and by worker. `State.event(event)` is the handler to give a receiver: for a `worker-*` event it updates the `Worker` (heartbeat times, clock, active/processed counts, load) and calls `on_node_join` and `on_node_leave`; for a `task-*` event it gets or creates the `Task` and merges the fields.

Sources: [celery/events/state.py:398-436](repo://celery/events/state.py#L398-L436), [celery/events/state.py:493-512](repo://celery/events/state.py#L493-L512), [celery/events/state.py:540-634](repo://celery/events/state.py#L540-L634)

`Worker` stores the last few heartbeat times (at most 4), warns when the difference between local receipt and the sender's timestamp exceeds a drift limit, clears them on an `offline` event, and `alive()` is true while the current time is before the heartbeat expiry. `Task` holds per-state timestamps (`received`, `sent`, `started`, `succeeded`, `failed`, `retried`, `revoked`, `rejected`) and fields such as `name`, `args`, `kwargs`, `eta`, `worker`, `result`, `exception`, `root_id` and `parent_id`; events can arrive out of order, and the task merges them using the state precedence from [[Results, AsyncResult and the Result Backend]].

Sources: [celery/events/state.py:149-240](repo://celery/events/state.py#L149-L240), [celery/events/state.py:242-262](repo://celery/events/state.py#L242-L262)

## Snapshots and the events command

`Polaroid` is a camera over a `State`: `install` schedules `capture` every `freq` seconds (default 1.0) and `cleanup` every `cleanup_freq`. A `maxrate` token bucket can limit snapshots. `capture` freezes the state while calling `shutter`, which sends a `shutter_signal` and `on_shutter`. Subclass it and implement `on_shutter` to persist the state. `evcam(camera, freq, maxrate, ...)` runs a camera against a receiver on the event stream.

Sources: [celery/events/snapshot.py:24-84](repo://celery/events/snapshot.py#L24-L84), [celery/events/snapshot.py:86-98](repo://celery/events/snapshot.py#L86-L98)

`celery events` exposes three modes: `--dump` prints events as they arrive (`evdump`), `--camera` runs `evcam` with the named camera class (optionally detached, with frequency and rate options), and with neither it opens the curses monitor `evtop`, which needs the `curses` module. See [[The celery Command Line]].

Sources: [celery/bin/events.py:20-60](repo://celery/bin/events.py#L20-L60), [celery/bin/events.py:61-98](repo://celery/bin/events.py#L61-L98)
