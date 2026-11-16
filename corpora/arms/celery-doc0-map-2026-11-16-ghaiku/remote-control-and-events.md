---
title: "Remote Control and Events"
---
## Overview

Operators reach running workers in two ways. Remote control sends a command to some or all workers and waits for their replies, the way `inspect` and `revoke` work. Events are messages the worker publishes as it receives, starts and finishes tasks, and that a receiver can capture to build a picture of the cluster. Both use the broker: control commands go to a per-node mailbox, and events go to an events exchange. The app side is in `celery/app/control.py` and `celery/app/events.py`; the worker side is in `celery/worker/pidbox.py` and `celery/worker/control.py`.

Sources: [celery/app/control.py:426-440](repo://celery/app/control.py#L426-L440)

Sources: [celery/worker/pidbox.py:20-38](repo://celery/worker/pidbox.py#L20-L38)

## Sending a control command

`Control.broadcast` acquires a connection, merges the arguments with any extra keyword arguments, and sends the command through the mailbox's `_broadcast` with its destination, reply flag, timeout, limit and callback.

Sources: [celery/app/control.py:755-790](repo://celery/app/control.py#L755-L790)

`Inspect` is a view over the same call. Each inspect method (for example `active`, `stats`, `revoked`) calls `_request`, which broadcasts the command with `reply=True` and the inspect object's destination, timeout and limit, then passes the replies through `_prepare`.

Sources: [celery/app/control.py:73-118](repo://celery/app/control.py#L73-L118)

Sources: [celery/app/control.py:138-152](repo://celery/app/control.py#L138-L152)

`Control` exposes the commands directly. `revoke` takes the task ids and the destinations, and `terminate` is a shortcut for `revoke` with `terminate` enabled.

Sources: [celery/app/control.py:488-511](repo://celery/app/control.py#L488-L511)

Sources: [celery/app/control.py:548-559](repo://celery/app/control.py#L548-L559)

## The worker's mailbox

Each worker has a `Pidbox` bootstep. Its constructor creates a mailbox node whose handlers are the commands registered in `Panel.data`, and it carries the app, the hostname and the consumer as its state.

Sources: [celery/worker/pidbox.py:20-38](repo://celery/worker/pidbox.py#L20-L38)

Each received message is handed to the node's `handle_message`. The pidbox first advances its logical clock, because clients do not send a usable one. An unknown command name is logged as an error; any other exception is logged and the mailbox is reset, so one bad command does not stop the others.

Sources: [celery/worker/pidbox.py:39-50](repo://celery/worker/pidbox.py#L39-L50)

## Registering commands

`Panel` is a global registry: `Panel.register` stores the function in `data` under its name and records its help text and signature in `meta`. Two decorators feed it: `control_command` registers a command with type `control`, and `inspect_command` registers one with type `inspect`.

Sources: [celery/worker/control.py:39-70](repo://celery/worker/control.py#L39-L70)

Sources: [celery/worker/control.py:73-76](repo://celery/worker/control.py#L73-L76)

A command receives the worker state as its first argument and the arguments of the request as keyword arguments. `revoke` is an example of a control command with a variadic argument: it takes one or more task ids and an optional `terminate` flag with a signal name.

Sources: [celery/worker/control.py:134-158](repo://celery/worker/control.py#L134-L158)

An inspect command returns its result wrapped by `ok`; `report` is the example, returning `ok` of the app's bug report.

Sources: [celery/worker/control.py:78-82](repo://celery/worker/control.py#L78-L82)

## Events published by the worker

`EventDispatcher.send` checks that events are enabled; when a type belongs to a buffered group it collects the event in a buffer until the group is flushed, and otherwise it calls `publish`. `publish` sends the event with a producer and stamps it with the logical clock, unless `blind` is set.

Sources: [celery/events/dispatcher.py:164-200](repo://celery/events/dispatcher.py#L164-L200)

Sources: [celery/events/dispatcher.py:116-141](repo://celery/events/dispatcher.py#L116-L141)

The app's `Events` object is the factory for both sides: it holds the dispatcher class and the receiver class, so an application can change either.

Sources: [celery/app/events.py:7-26](repo://celery/app/events.py#L7-L26)

## Receiving events

`EventReceiver` is a consumer on the events exchange. Its `process` method looks the event type up in its handlers and falls back to a `*` handler; `event_from_message` turns the body into an event.

Sources: [celery/events/receiver.py:23-45](repo://celery/events/receiver.py#L23-L45)

Sources: [celery/events/receiver.py:80-84](repo://celery/events/receiver.py#L80-L84)

Sources: [celery/events/receiver.py:113-139](repo://celery/events/receiver.py#L113-L139)

The cluster view is kept by `State`, which holds `Worker` and `Task` records. `get_or_create_worker` and `get_or_create_task` return the record for a hostname or task id, creating it on first sight, and `event` applies one event to the record it names.

Sources: [celery/events/state.py:149-160](repo://celery/events/state.py#L149-L160)

Sources: [celery/events/state.py:243-258](repo://celery/events/state.py#L243-L258)

Sources: [celery/events/state.py:477-500](repo://celery/events/state.py#L477-L500)
