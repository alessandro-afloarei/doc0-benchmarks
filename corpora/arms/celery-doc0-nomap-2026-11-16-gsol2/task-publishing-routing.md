---
title: "Task Publishing and Routing"
---
## Overview

Publishing connects the registered task from [[Applications and Configuration]] to a broker delivery. `Task.delay` delegates to `apply_async`, which validates arguments, merges execution options and normally calls `Celery.send_task`. The application routes the invocation, builds a protocol message, publishes through a producer and returns a result handle. [[Worker Lifecycle and Concurrency]] starts at the consuming side of this boundary.

Sources: [celery/app/task.py:523-538](repo://celery/app/task.py#L523-L538), [celery/app/task.py:659-705](repo://celery/app/task.py#L659-L705), [celery/app/base.py:1006-1034](repo://celery/app/base.py#L1006-L1034)

## Choose the invocation interface

Use `delay` for the task's positional and keyword arguments. Its signature has no independent execution-options parameter: it forwards both collections as the task arguments. `apply_async` accepts those collections separately from controls such as countdown, expiry, links, serializer and routing options. Before sending, it validates the configured soft/hard time-limit relationship and, when task typing is enabled, invokes the generated argument-checking header.

Sources: [celery/app/task.py:523-546](repo://celery/app/task.py#L523-L546), [celery/app/task.py:646-668](repo://celery/app/task.py#L646-L668)

`send_task` accepts a task name without requiring a local task object. It generates a task ID when one is absent. In this checkout, a plain call can inherit execution defaults from an already registered local task by consulting the underlying registry directly; that lookup deliberately avoids auto-finalization. Supplying `task_type`, as `apply_async` does, skips this extra merge because the task interface already applied its defaults.

Sources: [celery/app/base.py:846-909](repo://celery/app/base.py#L846-L909)

## Resolve execution options

`apply_async` combines task execution defaults with explicit call options, then supplies `ignore_result` and task priority when needed. For a named send, only non-`None` local defaults are merged. Time limits and expiry have explicit omitted-value handling: an omitted argument can inherit its default, while an explicit `None` clears it. These values are removed from the generic options dictionary before message construction to avoid duplicate arguments.

Sources: [celery/app/task.py:675-680](repo://celery/app/task.py#L675-L680), [celery/app/base.py:897-932](repo://celery/app/base.py#L897-L932)

With `task_always_eager`, the task interface round-trips its arguments through the selected serializer and calls local `apply` inside `denied_join_result`. It does not publish that invocation. A direct `send_task` instead warns that eager mode has no effect and continues its send path. [[Task Execution and Retries]] describes execution outcomes; eager invocation exercises a different delivery boundary from a running worker.

Sources: [celery/app/task.py:682-705](repo://celery/app/task.py#L682-L705), [celery/app/base.py:869-872](repo://celery/app/base.py#L869-L872)

## Select a route and queue

`MapRoute` keeps exact task-name matches separately from ordered regular-expression and glob patterns. Exact lookup precedes pattern matching. `Router.lookup_route` evaluates routers in order and returns the first non-`None` answer. Routers can be mappings, callable objects or lazily imported classes; legacy `route_for_task` implementations also have an adapter path. This makes route ordering significant when several rules can describe one task.

Sources: [celery/app/routes.py:26-53](repo://celery/app/routes.py#L26-L53), [celery/app/routes.py:98-136](repo://celery/app/routes.py#L98-L136)

The router expands queue names into queue objects before merging the chosen route with invocation options. Explicit non-`None` invocation options win in the merge. If no route supplies a queue, it expands `task_default_queue`. Unknown names are looked up in the application's queue collection, whose missing-queue behavior either constructs a queue or raises; a missing destination that cannot be resolved becomes `QueueNotFound`. Queue creation policy therefore participates in routing rather than being a consumer-side fallback.

Sources: [celery/app/routes.py:66-96](repo://celery/app/routes.py#L66-L96), [celery/app/amqp.py:55-115](repo://celery/app/amqp.py#L55-L115), [celery/utils/collections.py:47-55](repo://celery/utils/collections.py#L47-L55)

## Build timing and protocol metadata

Protocol v2 validates that positional arguments are a list or tuple and keyword arguments are a mapping. Countdown becomes an aware ETA; numeric expiry becomes an aware expiration time, and datetime metadata is serialized in ISO format. The message separates headers such as task name, ID, retry count and workflow ancestry from its body of arguments and embedded callbacks, errbacks, chain and chord metadata. [[Canvas Workflows]] follows those embedded continuations.

Sources: [celery/app/amqp.py:326-360](repo://celery/app/amqp.py#L326-L360), [celery/app/amqp.py:370-416](repo://celery/app/amqp.py#L370-L416)

For quorum queues, `send_task` checks the transport and may convert positive countdown delivery into a native delayed-routing key and topic exchange. Direct exchanges take a warning path because native delayed delivery is unsupported there and the task may block the worker until ETA. Expiration also produces the transport's `expiration` option; past expiration is warned about and clamped to zero. Worker-side ETA and revocation decisions are described in [[Task Execution and Retries]].

Sources: [celery/app/base.py:934-992](repo://celery/app/base.py#L934-L992)

## Publish and observe failure boundaries

The AMQP sender resolves exchange, routing key, delivery mode and queue declaration. For a direct exchange with missing exchange or routing-key information, it uses the anonymous exchange with the queue name. It combines the default publish retry policy with per-call overrides and passes the effective serializer, compression, retry policy, headers, timeouts and properties to `producer.publish`. [[Message Security]] explains how accepted serializers constrain the receiving side.

Sources: [celery/app/amqp.py:506-576](repo://celery/app/amqp.py#L506-L576)

Publication sends `before_task_publish` before the producer call and `after_task_publish` after it returns. The application invokes the backend's `on_task_call` first when results are enabled, publishes within the connection's library-error wrapper and only then constructs the `AsyncResult`. A returned handle identifies the submitted task; completion must be observed through [[Results and State]]. Publish retry is controlled at the transport call and is separate from the task retry mechanism after execution.

Sources: [celery/app/amqp.py:553-579](repo://celery/app/amqp.py#L553-L579), [celery/app/base.py:1025-1034](repo://celery/app/base.py#L1025-L1034), [celery/app/task.py:652-653](repo://celery/app/task.py#L652-L653)

When publishing from inside another task, `send_task` fills missing root and parent IDs from the current worker task and can inherit its priority. It may add the returned result to that parent's trail. This records relationships for workflow and result inspection without requiring the caller to construct ancestry fields manually; [[Results and State]] covers the client-side representation of those relationships.

Sources: [celery/app/base.py:994-1004](repo://celery/app/base.py#L994-L1004), [celery/app/base.py:1036-1040](repo://celery/app/base.py#L1036-L1040)
