---
title: "Events"
---
## Overview

Workers publish events as tasks move through them and as workers start, stop and send heartbeats. Monitors such as `celery events` and custom dashboards read those events and keep a model of the cluster. The publishing side is an `EventDispatcher` owned by the worker's consumer; the reading side is an `EventReceiver` feeding a `State` model. The commands that make the worker send events on request are in [[Remote Control and Revocation]].

Sources: [celery/events/dispatcher.py:19-57](repo://celery/events/dispatcher.py#L19-L57), [celery/events/receiver.py:23-35](repo://celery/events/receiver.py#L23-L35), [celery/events/state.py:398-406](repo://celery/events/state.py#L398-L406)

## Building an event

`Event` makes an event as a plain dictionary. The only required field is `type`, and a `timestamp` is added from the clock when the caller does not give one. Event types are named with a dash between the group and the name, such as `task-received`, and the group is taken from the part before the dash.

Sources: [celery/events/event.py:18-30](repo://celery/events/event.py#L18-L30)

`Events` in `celery/app/events.py` gives the app its three classes, `receiver`, `dispatcher` and `state`, each built with `subclass_with_self`, so each class is bound to the app that asks for it.

Sources: [celery/app/events.py:7-30](repo://celery/app/events.py#L7-L30)

## Dispatching

`EventDispatcher.send` builds the event with the dispatcher's host name, the UTC offset, the process id and a logical clock value. A buffered group is kept in a per-group buffer and flushed when the buffer is full, and an event that is not buffered is published directly through `publish`. The `blind` flag skips the clock, so a sender that must not move the logical clock can publish without changing it.

Sources: [celery/events/dispatcher.py:164-199](repo://celery/events/dispatcher.py#L164-L199)

`publish` sends the event on a producer, and the producer can be a custom one, in which case only its `publish` method is used. The retry flag and retry policy are passed on to the connection's `ensure` helper.

Sources: [celery/events/dispatcher.py:116-141](repo://celery/events/dispatcher.py#L116-L141), [celery/events/dispatcher.py:142-163](repo://celery/events/dispatcher.py#L142-L163)

The worker creates its dispatcher in the `Events` consumer step, which requires the connection step.

Sources: [celery/worker/consumer/events.py:15-40](repo://celery/worker/consumer/events.py#L15-L40)

## Receiving

`EventReceiver` is a consumer mixin. It binds a queue to the events exchange with a routing key that matches all types by default, and it passes each decoded message to `process`, which calls the handler registered for the event type.

Sources: [celery/events/receiver.py:36-84](repo://celery/events/receiver.py#L36-L84)

`capture` and `itercapture` run the receiver for a limited number of events or for a timeout. `event_from_message` converts a message body to an event, with the timestamp moved to local time when `localize` is set.

Sources: [celery/events/receiver.py:95-147](repo://celery/events/receiver.py#L95-L147)

## The state model

`State` keeps a `Worker` and a `Task` object for each host and task id it has seen. `get_or_create_worker` and `get_or_create_task` return the existing object or create one, and `event` routes each incoming event to the right object by its type.

Sources: [celery/events/state.py:398-412](repo://celery/events/state.py#L398-L412), [celery/events/state.py:477-505](repo://celery/events/state.py#L477-L505)

A `Worker` tracks a heartbeat. Its `heartbeat_expires` is the time of the last heartbeat plus a frequency, and `alive` compares that time with the current time. A worker that misses heartbeats past the frequency is therefore reported as not alive.

Sources: [celery/events/state.py:149-176](repo://celery/events/state.py#L149-L176), [celery/events/state.py:229-238](repo://celery/events/state.py#L229-L238)

A `Task` records its events in order and keeps its root and parent. Its `ready` property is true once the task has reached a final state, and the `info` method returns the fields a dashboard shows.

Sources: [celery/events/state.py:243-300](repo://celery/events/state.py#L243-L300), [celery/events/state.py:334-346](repo://celery/events/state.py#L334-L346), [celery/events/state.py:378-381](repo://celery/events/state.py#L378-L381)

The deprecated `task_event` and `worker_event` methods on `State` build the same events with the group name added, so older callers still produce the event types the new code expects.

Sources: [celery/events/state.py:501-512](repo://celery/events/state.py#L501-L512)
