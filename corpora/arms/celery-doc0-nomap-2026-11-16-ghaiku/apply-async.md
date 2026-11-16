---
title: "Sending a Task Message"
---
## Overview

Calling a task by name does not run it. `Task.apply_async` checks the arguments, merges the options and hands the call to `Celery.send_task`, which builds the message and publishes it through a broker producer. This page follows that path in order. The queue choice is covered in [[Routing and Queues]], and the layout of the message body and headers is covered in [[Message Format and Serialization]].

Sources: [celery/app/task.py:536-545](repo://celery/app/task.py#L536-L545), [celery/app/base.py:846-860](repo://celery/app/base.py#L846-L860)

## From the task to the app

`delay` takes positional and keyword arguments and forwards them to `apply_async` with no extra options. `apply_async` is where the options arrive: `countdown`, `eta`, `expires`, `link`, `link_error`, `shadow`, `producer` and `task_id`, plus any keyword that `kombu` accepts for publishing.

Sources: [celery/app/task.py:523-535](repo://celery/app/task.py#L523-L535), [celery/app/task.py:536-580](repo://celery/app/task.py#L536-L580)

Before anything is sent, `apply_async` checks the arguments against the task's signature when type checking is on, and it rejects a `soft_time_limit` larger than `time_limit`. The execution options that the task class declares are read with `_get_exec_options`, and the call's own options override them.

Sources: [celery/app/task.py:660-676](repo://celery/app/task.py#L660-L676)

When `task_always_eager` is set, `apply_async` does not publish. It serializes the arguments, deserializes them again, and calls `apply` in the same process. Otherwise it calls `send_task` with `task_type=self`, which tells `send_task` that the execution options were already merged.

Sources: [celery/app/task.py:682-708](repo://celery/app/task.py#L682-L708)

## Merging options in send_task

A caller of `send_task` may pass only a name. When `task_type` is not passed, `send_task` looks the name up in the local registry and takes that task's non-`None` execution options as defaults, so a keyword the caller passes still wins.

Sources: [celery/app/base.py:886-910](repo://celery/app/base.py#L886-L910)

`time_limit`, `soft_time_limit` and `expires` are also explicit arguments of the message builder. `send_task` pops them from the options, so an explicit `None` clears a task-level default and no value is passed twice.

Sources: [celery/app/base.py:911-930](repo://celery/app/base.py#L911-L930)

`ignore_result` is popped the same way. The options then go through the router, which returns the queue and exchange values that the publish call needs.

Sources: [celery/app/base.py:930-932](repo://celery/app/base.py#L930-L932)

## Parent and root ids

When the call is made inside a running task, `send_task` fills in the `root_id` and `parent_id` of the new message from the running task's request. When `task_inherit_parent_priority` is set, the child also takes the parent's delivery priority.

Sources: [celery/app/base.py:994-1005](repo://celery/app/base.py#L994-L1005)

The new result is added to the running task's trail, so a parent can later find the children it started.

Sources: [celery/app/base.py:1036-1041](repo://celery/app/base.py#L1036-L1041)

## Building the message

`create_task_message` picks the builder for the `task_protocol` setting. The protocol 2 builder, `as_task_v2`, turns a `countdown` into an absolute ETA using the app's clock and timezone, and it does the same for `expires`.

Sources: [celery/app/amqp.py:266-267](repo://celery/app/amqp.py#L266-L267), [celery/app/amqp.py:326-353](repo://celery/app/amqp.py#L326-L353)

```python
if countdown:
    self._verify_seconds(countdown, 'countdown')
    now = now or self.app.now()
    timezone = timezone or self.app.timezone
    eta = maybe_make_aware(
        now + timedelta(seconds=countdown), tz=timezone,
    )
```

Sources: [celery/app/amqp.py:266-267](repo://celery/app/amqp.py#L266-L267), [celery/app/amqp.py:342-349](repo://celery/app/amqp.py#L342-L349)

The body is a tuple of `(args, kwargs, extras)`, where the extras hold the callbacks, error callbacks, chain and chord. Routing and tracking fields such as `retries`, `timelimit`, `root_id` and `parent_id` go in the headers.

Sources: [celery/app/amqp.py:376-406](repo://celery/app/amqp.py#L376-L406)

## Publishing

When the caller passes a `connection`, `send_task` builds a producer on that connection without auto-declaring. Otherwise `producer_or_acquire` takes a producer from the pool, or uses the one passed in. The publish runs inside a reraise context, so broker errors come out as the library's error type.

Sources: [celery/app/base.py:1022-1026](repo://celery/app/base.py#L1022-L1026), [celery/app/base.py:1176-1190](repo://celery/app/base.py#L1176-L1190)

Before the send, the result backend is told that the task is being called, unless the task ignores its result.

Sources: [celery/app/base.py:1027-1029](repo://celery/app/base.py#L1027-L1029)

`send_task_message` is built once per AMQP object. It chooses the exchange and routing key from the queue, declares the queue when it was given, applies the publish retry policy, and fires the `before_task_publish` and `after_task_publish` signals around the publish.

Sources: [celery/app/amqp.py:485-576](repo://celery/app/amqp.py#L485-L576)

A delayed message on a quorum-queue driver takes a different route. When the driver reports quorum queues and the exchange is not direct, `send_task` computes a routing key from the delay and publishes to a topic exchange named `celery_delayed_27` instead of the task's own queue. The worker side of that path is covered in [[Routing and Queues]].

Sources: [celery/app/base.py:934-958](repo://celery/app/base.py#L934-L958)

A direct exchange gets a warning in the same branch. The warning says the delayed-delivery exchange needs a topic or fanout exchange, and that with quorum queues the worker process may block until the ETA arrives.

Sources: [celery/app/base.py:961-966](repo://celery/app/base.py#L961-L966)

## What the caller gets back

`send_task` returns an `AsyncResult` for the task id, after the publish call has returned. It sets `ignored` from `ignore_result`. The call does not wait for the task to run.

Sources: [celery/app/base.py:1030-1034](repo://celery/app/base.py#L1030-L1034), [celery/app/base.py:1041](repo://celery/app/base.py#L1041)
