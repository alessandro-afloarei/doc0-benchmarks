---
title: "Task Publishing and Routing"
---
## Overview

Task publication converts a call into a named message and a destination. Starting from the registered task described in [[Application and Configuration]], `Task.apply_async` validates and merges execution options, `Celery.send_task` resolves routing, and the AMQP service calls the producer. [[Worker Lifecycle and Execution]] begins when the resulting message reaches a consumer; successful publication alone does not establish execution.

Sources: [celery/app/task.py:659-708](repo://celery/app/task.py#L659-L708), [celery/app/base.py:930-932](repo://celery/app/base.py#L930-L932), [celery/app/base.py:1006-1041](repo://celery/app/base.py#L1006-L1041)

## Choose the submission interface

`delay(*args, **kwargs)` forwards to `apply_async(args, kwargs)` and offers no separate execution-options channel. Use `apply_async` for queue selection, countdown, expiration, serializer, time limits, links, or a supplied producer. Argument validation uses the task's generated header when typing is enabled. The implementation also rejects a task whose configured soft limit exceeds its hard limit before sending.

Sources: [celery/app/task.py:523-537](repo://celery/app/task.py#L523-L537), [celery/app/task.py:540-633](repo://celery/app/task.py#L540-L633), [celery/app/task.py:659-668](repo://celery/app/task.py#L659-L668)

`app.send_task(name, ...)` submits by string name and can send a remote task absent from the producer's registry. In this checkout, a plain name submission also checks the underlying local registry for task defaults without auto-finalizing the application. When it finds a task, it merges non-`None` execution defaults below explicit options. A call originating from `Task.apply_async` already supplies its task type and has performed that merge.

Sources: [celery/app/base.py:846-909](repo://celery/app/base.py#L846-L909)

An explicitly supplied `None` clears a task-level `time_limit`, `soft_time_limit`, or `expires` default; omitted arguments use the merged defaults. `send_task` uses a private omitted-value sentinel to preserve that distinction and removes duplicate option keys before constructing the message. This is useful when a named task's ordinary limits should not apply to one particular submission.

Sources: [celery/app/base.py:911-928](repo://celery/app/base.py#L911-L928)

## Resolve routes and queues

`Router.route` first expands an explicit destination, then queries routers in order. The first router returning something other than `None` wins lookup. Route values supply defaults while non-`None` call options overwrite them through `lpmerge`. If no queue is selected, the configured default queue is expanded. A router can implement the legacy `route_for_task` method or the callable interface receiving the task name, arguments, options, and task type.

Sources: [celery/app/routes.py:66-111](repo://celery/app/routes.py#L66-L111), [celery/utils/collections.py:47-55](repo://celery/utils/collections.py#L47-L55)

`MapRoute` keeps exact task names separately from ordered patterns. It tries exact lookup before regular expressions and glob-derived patterns. Route preparation accepts mappings, sequences, import strings, or router objects; import strings are resolved lazily. A pattern's position matters when several patterns could match the same task.

Sources: [celery/app/routes.py:26-53](repo://celery/app/routes.py#L26-L53), [celery/app/routes.py:114-136](repo://celery/app/routes.py#L114-L136)

Queue names become Kombu `Queue` objects. When automatic queue creation is enabled, an unknown name creates a queue; otherwise destination expansion raises `QueueNotFound`. The AMQP queue factory reads the missing-queue type and exchange settings and can construct a quorum default queue. Queue creation affects broker declarations, while which queues a worker consumes is selected independently in [[Worker Lifecycle and Execution]].

Sources: [celery/app/routes.py:78-96](repo://celery/app/routes.py#L78-L96), [celery/app/amqp.py:99-102](repo://celery/app/amqp.py#L99-L102), [celery/app/amqp.py:273-306](repo://celery/app/amqp.py#L273-L306)

## Construct the message

The default protocol is version 2. Its constructor requires positional arguments to be a list or tuple and keyword arguments to be a mapping. Headers carry the task name, ID, retry count, ETA, expiration, time limits, group identity, ancestry, display representations, and stamps. Properties carry correlation and reply information. The body contains arguments, keyword arguments, and embedded callbacks, errbacks, chain, and chord metadata.

Sources: [celery/app/defaults.py:293-295](repo://celery/app/defaults.py#L293-L295), [celery/app/amqp.py:326-405](repo://celery/app/amqp.py#L326-L405)

| Input | Transformation before dispatch |
| --- | --- |
| `countdown` | Converted into a timezone-aware ETA |
| Numeric `expires` | Converted into an absolute expiration timestamp |
| Datetime ETA or expiration | Serialized to an ISO-formatted string |
| Missing `root_id` | Defaults to this task's ID |
| Active parent task | Supplies missing root and parent IDs; can supply priority |

Sources: [celery/app/amqp.py:342-368](repo://celery/app/amqp.py#L342-L368), [celery/app/base.py:994-1004](repo://celery/app/base.py#L994-L1004)

`send_task` also calculates a broker expiration duration and clamps an expiration in the past to zero with a warning. Delayed publication has an additional quorum-queue branch: for supported non-direct exchanges, a positive delay rewrites the routing key and targets the delayed topic exchange. Direct exchanges generate a warning about native delayed delivery. [[Periodic Scheduling]] addresses recurring submission; ETA and countdown describe timing for one message.

Sources: [celery/app/base.py:934-992](repo://celery/app/base.py#L934-L992)

## Publish through a producer

`send_task` uses a supplied producer or acquires one from the application's producer pool. A configured `broker_pool_acquire_timeout` bounds acquisition; exhausting available slots raises `OperationalError` with the pool settings in its message. When a caller supplies a connection, the application builds a producer around it. Before sending, a non-ignored task gives its backend an `on_task_call` hook.

Sources: [celery/app/base.py:1022-1029](repo://celery/app/base.py#L1022-L1029), [celery/app/base.py:1162-1189](repo://celery/app/base.py#L1162-L1189)

The sender resolves delivery mode, exchange type, routing key, and declarations. For a direct exchange with missing exchange or routing key, it uses the anonymous exchange and queue name. Unless the caller supplied declarations, ordinary queues are declared. `producer.publish` receives the body, headers, properties, serializer, compression, retry policy, and confirmation timeout. Serializer and compression options fall back to application defaults.

Sources: [celery/app/amqp.py:502-575](repo://celery/app/amqp.py#L502-L575)

The sender emits publication signals around `producer.publish` and can publish a `task-sent` event with queue and routing metadata afterward. These describe producer activity; worker receipt and completion produce different observations in [[Monitoring and Worker Control]]. The resulting `AsyncResult` is constructed using the task ID and marked with the requested ignore-result policy.

Sources: [celery/app/amqp.py:558-604](repo://celery/app/amqp.py#L558-L604), [celery/app/base.py:1030-1041](repo://celery/app/base.py#L1030-L1041)

## Eager execution and publication failures

With `task_always_eager`, `Task.apply_async` serializes and deserializes arguments locally and invokes `apply` instead of publishing. `send_task` explicitly warns that eager mode has no effect on it. [[Development and Testing]] explains why eager tests exercise a different execution path from a real worker. Connection failures during ordinary publishing can surface as transport `OperationalError`.

Sources: [celery/app/task.py:643-653](repo://celery/app/task.py#L643-L653), [celery/app/task.py:682-708](repo://celery/app/task.py#L682-L708), [celery/app/base.py:869-872](repo://celery/app/base.py#L869-L872)

Publication retries are controlled by `task_publish_retry` and its policy, merged with any per-call policy before reaching the producer. The default policy allows three retries with a starting interval of zero, a step of 0.2 seconds, and a maximum interval of one second. [[Task Retries and Failure Handling]] describes retries requested by an executing task, which use task request metadata and a new submission path.

Sources: [celery/app/defaults.py:296-304](repo://celery/app/defaults.py#L296-L304), [celery/app/amqp.py:553-575](repo://celery/app/amqp.py#L553-L575), [celery/app/task.py:811-867](repo://celery/app/task.py#L811-L867)
