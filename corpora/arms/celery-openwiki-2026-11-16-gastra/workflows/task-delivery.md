---
type: workflow
title: Publishing tasks, routing and retries
description: Calling APIs, execution option precedence, task envelopes, routing, eager execution, and the distinct retry mechanisms involved in task delivery.
tags: [tasks, publishing, routing, protocol, retry]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:55:28.912Z
sources:
  - id: openwiki-source-5a0b6982dd7ddb0fabfabd0c
    resource: repo://celery/app/amqp.py
  - id: openwiki-source-f43ee4204a66938ed7ddea4f
    resource: repo://celery/app/autoretry.py
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-51bdc9f790e9afc683dd8164
    resource: repo://celery/app/routes.py
  - id: openwiki-source-3795aa577fa7b0f3bd2af81a
    resource: repo://celery/app/task.py
  - id: openwiki-source-3c48ca17f7af44d5bc6fff98
    resource: repo://t/unit/app/test_app.py
generated: { by: "codex", at: "2026-11-16T07:55:28.912Z" }
---

# Publishing tasks, routing and retries

Task submission crosses a broker boundary. A successful call to the publishing API returns a result handle, while a worker later resolves the task name and executes its implementation. The producer must know the message contract; the worker must have the task registered.

## Select the calling API

| Call | Behavior |
| --- | --- |
| `task(...)` | Calls the task implementation in the current process |
| `task.delay(*args, **kwargs)` | Convenience wrapper over `apply_async(args, kwargs)`; arguments are task inputs |
| `task.apply_async(args=..., kwargs=..., countdown=..., queue=...)` | Publishes with execution options, or executes eagerly when configured |
| `app.send_task("module.task", args=...)` | Publishes by name without requiring a local task implementation |

`Task.apply_async` validates arguments when task typing is enabled, merges task execution defaults with caller options, and delegates non-eager publication to `send_task`. In eager mode it round-trips arguments through the chosen serializer and calls local `apply`. `send_task` ignores `task_always_eager` and warns, so eager tests of task objects do not cover this name-based path.

This checkout's `send_task` consults the underlying local registry when no task type was supplied. It merges non-None registered task execution defaults without auto-finalizing the application, and caller values override them. For `time_limit`, `soft_time_limit`, and `expires`, omitted arguments inherit defaults while explicit `None` clears them. Remote or unregistered names remain publishable.

## Routing and envelope creation

The router expands queue names, queries configured routes, and merges routing options. Without a selected queue, it uses `task_default_queue`. Missing named queues raise `QueueNotFound` when the queue mapping cannot resolve/create them. Mapping routes support exact names and patterns; callable routers can inspect task arguments and options.

The protocol-v2 envelope places task identity, ETA/expiry, retry count, limits, root/parent relationships, and stamps in headers. The body contains arguments, keyword arguments, and embedded callbacks, errbacks, chain, and chord data. Message properties include correlation ID and reply destination. Arguments must be a list/tuple and keyword arguments a mapping.

The AMQP layer resolves exchange/routing key and declarations, merges producer retry policy, emits publish signals, and calls Kombu's producer. Result-backend `on_task_call` may prepare reply handling before the message is sent. `send_task` then returns the task-ID result handle.

```python
result = add.apply_async(args=(2, 3), queue="arithmetic", countdown=10)
```

A worker must consume `arithmetic` and register `add`. A task name, queue name, and routing key serve different roles; [worker operations](../operations/workers.md) explains queue selection.

## Delays and expiry

Normal countdowns become ETAs in the task envelope and can be held by worker timers. When quorum queues are detected, `send_task` can rewrite positive countdown/ETA routing through native delayed-delivery exchanges for non-direct exchanges. Direct exchanges trigger a warning because that native path is unsupported and the worker may hold the delayed task.

Expiry is translated into broker expiration and task-header expiry. It limits when a task is eligible to run; it is not the same as a hard execution time limit or result expiration.

## Three independent retry paths

1. **Publication retry** retries sending through Kombu according to `task_publish_retry` and its retry policy. It handles transport failure during sending.
2. **Task retry** uses `self.retry()` to increment request retries and publish a signature carrying the task ID and delivery context. It normally raises `Retry` so the tracer records RETRY instead of ordinary failure. The request then acknowledges the old delivery under late acknowledgement.
3. **Backend retry** retries safe result-storage/retrieval operations according to backend configuration; it does not rerun user code. See [result backends](../integrations/result-backends.md).

Task retry enforces `max_retries`, uses the default retry delay when no ETA/countdown was provided, and handles eager execution locally. Failure to publish the replacement raises `Reject(requeue=False)` in this implementation. Avoid assuming every retry failure requeues the original message.

`autoretry_for` wraps the task's run method and delegates matching exceptions to `retry`, with optional bounded exponential backoff and jitter. It excludes `Ignore`, existing `Retry`, and `dont_autoretry_for` exceptions.

Broker redelivery is a fourth, separate event driven by delivery acknowledgement and connection behavior. None of these mechanisms alone guarantees exactly-once side effects. Read [worker acknowledgements](../architecture/worker.md) and [Canvas continuations](canvas.md) when choosing idempotency and failure recovery.

## Focused tests

[Application tests](../../t/unit/app/test_app.py) cover name-based publication, registered defaults, explicit None, producer exhaustion, and delayed delivery. [Task tests](../../t/unit/tasks/test_tasks.py) cover retry and eager behavior; [routing tests](../../t/unit/app/test_routes.py) and [AMQP tests](../../t/unit/app/test_amqp.py) cover destination and protocol construction.
