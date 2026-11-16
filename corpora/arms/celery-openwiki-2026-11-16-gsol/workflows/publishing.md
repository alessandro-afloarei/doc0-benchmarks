---
type: workflow
title: Publishing, routing and the task protocol
description: Task execution option precedence, named-task publication, queue routing, protocol v2 encoding, producer acquisition and publication failure boundaries.
tags: [publishing, routing, protocol, brokers, queues]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:34:04.042Z
sources:
  - id: openwiki-source-5a0b6982dd7ddb0fabfabd0c
    resource: repo://celery/app/amqp.py
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-51bdc9f790e9afc683dd8164
    resource: repo://celery/app/routes.py
  - id: openwiki-source-3795aa577fa7b0f3bd2af81a
    resource: repo://celery/app/task.py
  - id: openwiki-source-4a74724fd0043fb3763dcbaf
    resource: repo://celery/utils/collections.py
generated: { by: "codex", at: "2026-11-16T06:34:04.042Z" }
---

# Publishing, routing and the task protocol

Publishing transforms a Python task invocation into a named, serialized message. The producer chooses execution options and a destination; the worker must independently have the named task registered and consume the destination queue.

## Choose the calling surface

`task.delay(*args, **kwargs)` delegates to `apply_async(args, kwargs)` and accepts no separate execution options. Use `apply_async(args=(...), countdown=..., queue=...)` for scheduling and routing controls. The registered-task path checks arguments when typing is enabled, rejects a soft time limit greater than the hard limit, merges task execution defaults with caller options and supplies the task type to `send_task()`.

`app.send_task('package.task', ...)` can publish a name without its implementation being imported locally. In this checkout, it also looks in the underlying local registry without auto-finalizing the app. When it finds a registered task and no `task_type` was supplied, it uses non-`None` task execution defaults beneath explicit caller options. When `apply_async()` already passed a task type, it avoids merging the defaults a second time.

`time_limit`, `soft_time_limit` and `expires` use omission sentinels on `send_task()`: an omitted argument can inherit a task default, while explicit `None` clears it. These keys are removed from the options mapping before constructing the message, preventing duplicate keyword arguments.

Registered tasks in eager mode serialize and deserialize arguments before local `apply()`. Plain `send_task()` warns that eager mode does not apply. Eager tests do not exercise broker publication or worker delivery.

## Routing resolves names into queue declarations

The router expands an explicitly selected queue, asks configured routers in order and uses the first non-`None` answer. Matching routes are merged with invocation options, with non-`None` invocation values taking precedence. If no queue is selected, it uses `task_default_queue`. Map routes support exact task names, glob patterns and regular expressions; custom routers can inspect task arguments and options.

```python
from kombu import Queue

app.conf.task_queues = (Queue('reports', routing_key='reports'),)
app.conf.task_routes = {'proj.tasks.report': {'queue': 'reports'}}
```

A worker must consume `reports`, for example with `celery -A proj worker -Q reports -l INFO`. A valid producer route alone does not start a consumer.

The queue registry may create unknown queues when `task_create_missing_queues` is enabled. Missing-queue type and exchange-type settings control those declarations; supported automatic queue types include classic and quorum. With automatic creation disabled, an unknown queue fails routing. The same registry can retain queues for routing while restricting the subset a worker consumes.

## Protocol and delayed delivery

Protocol v2 headers carry the task name and ID, ETA/expiry, group index, retries, time limits, parent/root IDs, display representations and stamps. Message properties hold correlation and reply IDs. The body contains arguments, keyword arguments and embedded callbacks, errbacks, chain and chord metadata.

The message builder requires list/tuple positional arguments and mapping keyword arguments. It converts countdown and numeric expiry to timestamps. `send_task()` separately computes broker expiration, clamping an already-past expiration to zero. For ETA/countdown with detected quorum queues and a non-direct exchange, it can route through Kombu's native delayed-delivery topology; direct exchanges warn and can leave workers holding tasks until their ETA.

Task payload encoding and content acceptance must agree across producers and workers. See [serialization and message trust](../operations/security.md), especially the limits of `argsrepr` redaction and body signing.

## Producer acquisition and publish failures

`send_task()` acquires a producer unless one is supplied, notifies the result backend when appropriate, publishes and returns the result handle. Pool acquisition uses `broker_pool_acquire_timeout`; exhausted connection or producer pools raise an `OperationalError` with pool-limit context. A handle returned after publication is not an execution acknowledgement.

The AMQP sender resolves exchange, routing key and declarations, merges retry policies, emits before/after publish signals and invokes Kombu `Producer.publish()` with serializer, compression and delivery mode. `task_publish_retry` and `task_publish_retry_policy` govern publication recovery; this differs from [task execution retry](execution.md), which creates another invocation after a task has begun execution.

## Focused verification

Use `t/unit/app/test_app.py` for named-task defaults, explicit `None`, pool exhaustion and delayed-delivery selection; `test_amqp.py` for protocol and publication; `test_routes.py` for precedence. Consumer behavior is covered by [worker tests](../architecture/worker.md), with native delay scenarios under `t/smoke/tests/quorum_queues/`.
