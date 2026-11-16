---
title: "Sending Tasks"
---
## Overview

Sending a task turns a call into a message on a queue. `Task.apply_async` decides whether to send at all, `Celery.send_task` resolves the route and the options, and the AMQP object builds and publishes the message. This page follows that path; the call itself is in [[Tasks]], the message receipt in [[Task Execution]], and the signing of the body in [[Message Security]].

Sources: [celery/app/task.py:536-545](repo://celery/app/task.py#L536-L545)

Sources: [celery/app/base.py:846-858](repo://celery/app/base.py#L846-L858)

## Resolving the task and its options

`send_task` takes the router from the AMQP object unless one is passed. When the caller did not say which task type it is sending, the task is looked up in the local registry, and that task's execution options fill in the keys the caller left unset. A name with no local task is still sent: the lookup does not finalize the app.

Sources: [celery/app/base.py:867-868](repo://celery/app/base.py#L867-L868)

Sources: [celery/app/base.py:877-906](repo://celery/app/base.py#L877-L906)

`time_limit`, `soft_time_limit` and `expires` are taken from the options when the caller did not pass them as arguments; an explicit `None` clears the task default. These three are passed to the message builder as their own arguments, so they are removed from the options first to avoid a duplicate argument.

Sources: [celery/app/base.py:908-930](repo://celery/app/base.py#L908-L930)

## Routing

The router turns the options into a queue and routing key. `Router.route` first applies `task_routes` through `lookup_route`, merges the result with the caller's options (a non-`None` caller value wins), and falls back to `task_default_queue` when no queue was chosen. A route can be a queue name or a dictionary; a dictionary's `queue` key is looked up in the configured queues and raises `QueueNotFound` when it is missing.

Sources: [celery/app/base.py:931-933](repo://celery/app/base.py#L931-L933)

Sources: [celery/app/routes.py:56-86](repo://celery/app/routes.py#L56-L86)

Sources: [celery/app/routes.py:114-121](repo://celery/app/routes.py#L114-L121)

Sources: [celery/utils/collections.py:47-55](repo://celery/utils/collections.py#L47-L55)

A `MapRoute` built from a dictionary matches task names exactly first; a name containing `*` is compiled to a pattern, and the patterns are tried in the order they were written.

Sources: [celery/app/routes.py:26-40](repo://celery/app/routes.py#L26-L40)

Sources: [celery/app/routes.py:41-55](repo://celery/app/routes.py#L41-L55)

## Countdown, ETA and expiry

`countdown` is converted to an absolute ETA in the message builder: the app's current time plus the seconds, made timezone-aware. `expires` given as seconds becomes an absolute time the same way. ETA and expiry are then sent as ISO 8601 strings.

Sources: [celery/app/amqp.py:341-358](repo://celery/app/amqp.py#L341-L358)

When the broker uses quorum queues and the ETA or countdown is in the future, `send_task` sends the message to a topic exchange named `celery_delayed_27` with a routing key built from the delay, so the broker holds it until the time arrives. A direct exchange cannot do this, and the code logs a warning and keeps the original queue.

Sources: [celery/app/base.py:934-966](repo://celery/app/base.py#L934-L966)

An expiry in the past is set to zero with a warning, so the broker expires the message on arrival.

Sources: [celery/app/base.py:968-990](repo://celery/app/base.py#L968-L990)

## Building the message

The message builder is chosen by the `task_protocol` setting. Protocol 1 is the old layout; protocol 2 is the default, and the mapping sends each one to its builder.

Sources: [celery/app/amqp.py:259-267](repo://celery/app/amqp.py#L259-L267)

Sources: [celery/app/defaults.py:295](repo://celery/app/defaults.py#L295)

`as_task_v2` checks that `args` is a list or tuple and `kwargs` a mapping, builds the headers (task name, id, ETA, expires, group, retries, time limits, root and parent ids, the reprs of the arguments and the origin node), and puts the arguments and a dictionary of callbacks, errbacks, chain and chord into the body. Those four are the links the worker follows after the task.

Sources: [celery/app/amqp.py:326-409](repo://celery/app/amqp.py#L326-L409)

`send_task` gives the message to `send_task_message`, which publishes it with the producer. Before the publish, `send_task` records the task id on the result backend with `on_task_call`, unless the task ignores its result.

Sources: [celery/app/base.py:1005-1032](repo://celery/app/base.py#L1005-L1032)

The sender reads its retry settings from `task_publish_retry` and `task_publish_retry_policy`, its serializer from `task_serializer`, and its delivery mode from `task_default_delivery_mode`. It sends the `before_task_publish` and `after_task_publish` signals around the publish.

Sources: [celery/app/amqp.py:485-505](repo://celery/app/amqp.py#L485-L505)

Sources: [celery/app/amqp.py:509-571](repo://celery/app/amqp.py#L509-L571)

After publishing, `send_task` returns an `AsyncResult` for the task id, or the class the caller passed as `result_cls`.

Sources: [celery/app/base.py:1033-1036](repo://celery/app/base.py#L1033-L1036)
