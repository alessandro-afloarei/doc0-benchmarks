---
type: "Reference"
title: "System Overview"
openwiki_generated: true
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:56:17.091Z
sources:
  - id: openwiki-source-39b293cb4d26aec690dfc284
    resource: repo://celery/__init__.py
  - id: openwiki-source-5a0b6982dd7ddb0fabfabd0c
    resource: repo://celery/app/amqp.py
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-ac404435efa758dad4bbfc83
    resource: repo://celery/app/defaults.py
  - id: openwiki-source-3795aa577fa7b0f3bd2af81a
    resource: repo://celery/app/task.py
  - id: openwiki-source-4a982797c89fcb3ea5c5d0ee
    resource: repo://celery/app/trace.py
  - id: openwiki-source-7c9db0d3259470539a2d0756
    resource: repo://celery/bootsteps.py
  - id: openwiki-source-94b60a38fd26082deb41f979
    resource: repo://celery/worker/consumer/consumer.py
  - id: openwiki-source-328c66e40eb163230ad26cbc
    resource: repo://celery/worker/request.py
  - id: openwiki-source-5b05690e7e13e9bff2a56054
    resource: repo://celery/worker/strategy.py
  - id: openwiki-source-12d3bd623a53e489a785c641
    resource: repo://celery/worker/worker.py
  - id: openwiki-source-9fe3a610596da7b7f2c71115
    resource: repo://setup.py
generated: { by: "claude-code", at: "2026-11-16T17:56:17.091Z" }
---


# System Overview

Celery is a distributed task queue for Python. A *client* publishes task messages to a *broker* (RabbitMQ, Redis, SQS, ...). One or more *workers* consume the messages and execute the task functions in a *pool*. Task state and return values are optionally written to a *result backend*, which clients can read. Everything is configured through one `Celery` application object. The message transport is provided by the [kombu](https://kombu.readthedocs.io) library and process pooling by `billiard`, both external dependencies.

The code is one package, `celery/`. The package version is in `celery/__init__.py` (`__version__ = '5.6.2'`, series "recovery"), and the console script is `celery = celery.__main__:main` (`setup.py`). Python 3.10 or newer is required.

## The life of a task

```
 client process                broker                 worker (main process)            pool child         result backend
 ──────────────                ──────                 ─────────────────────            ──────────         ──────────────
 task.delay()/apply_async
   Task.apply_async ──► app.send_task
     router.route() picks queue
     amqp.as_task_v2() builds message
     producer.publish() ──────► queue ──────► Consumer.on_task_received
                                                 strategy → Request
                                                 ETA/rate-limit/prefetch (QoS)
                                                 pool.apply_async(trace_task_ret) ──► build_tracer → trace_task
                                                                                       run task body
                                                                                       dispatch links/chain ──► (publish next tasks)
                                                                                       backend.mark_as_done ──────────────────► store state/result
                                                 on_success / ack (late or early)
 AsyncResult.get() ◄──────────────────────────────────────────────────────────────────────────────────── read state/result
```

1. **Publish** (client side). `Task.apply_async` merges options and calls `Celery.send_task`. The router picks a queue, `AMQP.as_task_v2` builds the message (protocol 2: headers carry the metadata, the body is `(args, kwargs, {callbacks, errbacks, chain, chord})`), and a pooled kombu producer publishes it. An `AsyncResult` is returned immediately. With `task_always_eager` the task runs inline instead. Details: [Task publishing](../workflows/task-publishing.md).
2. **Receive** (worker main process). The consumer's `Tasks` step consumes from the task queues. `on_task_received` finds the per-task *strategy*, which builds a `Request`, applies the revoked and expiry checks, and handles ETA and rate limits. `Request` objects then go to the execution pool. Details: [Worker and consumer](worker-and-consumer.md).
3. **Execute** (pool). The pool runs `trace_task_ret` (or its optimized variant `fast_trace_task`) in a child process, thread or greenlet. `build_tracer` makes the function that deserializes arguments, runs the task body, handles retry, failure and `Reject` and `Ignore`, dispatches `link` callbacks and the next `chain` step, and stores the outcome through the backend. Details: [Task execution and tracing](../workflows/task-execution-and-tracing.md) and [Concurrency pools](concurrency-pools.md).
4. **Acknowledge.** By default the message is acknowledged when the pool *accepts* the task (`on_accepted`). With `acks_late` it is acknowledged after the task finishes, so a crashed worker's tasks are redelivered. This gives at-least-once delivery semantics in the late case.
5. **Result.** `Backend.mark_as_done` / `mark_as_failure` store state and value, and notify chords. A client reads them with `AsyncResult.get()`. Details: [Result backends](result-backends.md).

## Package map

| Area | Where | Role | Wiki page |
|---|---|---|---|
| App, config, registry | `celery/app/base.py`, `defaults.py`, `registry.py`, `celery/_state.py`, `celery/loaders/` | The `Celery` object, lazy config, task binding | [App and configuration](app-and-configuration.md) |
| Task class and publishing | `celery/app/task.py`, `amqp.py`, `routes.py` | `Task`, message building, queues and routing | [Task publishing](../workflows/task-publishing.md) |
| Tracer | `celery/app/trace.py`, `celery/app/autoretry.py`, `celery/states.py` | Execution wrapper, states, retries | [Task execution and tracing](../workflows/task-execution-and-tracing.md) |
| Canvas | `celery/canvas.py`, `celery/app/builtins.py` | `chain`, `group`, `chord`, signatures, stamping | [Canvas](canvas-workflows.md) |
| Worker | `celery/worker/`, `celery/bootsteps.py` | `WorkController`, consumer, strategy, request, control | [Worker and consumer](worker-and-consumer.md) |
| Pools | `celery/concurrency/` | prefork, solo, threads, eventlet, gevent | [Concurrency pools](concurrency-pools.md) |
| Result backends | `celery/backends/`, `celery/result.py`, `celery/app/backends.py` | Persistence, result handles, chord counting | [Result backends](result-backends.md) |
| Beat | `celery/beat.py`, `celery/schedules.py` | Periodic task scheduler | [Beat scheduler](beat-scheduler.md) |
| Events and control | `celery/events/`, `celery/app/control.py`, `celery/worker/control.py` | Monitoring stream, remote control | [Events and remote control](events-and-remote-control.md) |
| CLI | `celery/bin/`, `celery/apps/`, `celery/platforms.py` | `celery worker/beat/multi/inspect/...` | [CLI and process management](cli-and-process-management.md) |
| Security | `celery/security/` | Signed messages | [Message security](../operations/message-security.md) |
| Integrations | `celery/fixups/django.py`, `celery/contrib/`, `celery/utils/` | Django, pytest plugin, testing helpers, signals | [Django and contrib](../integrations/django-and-contrib.md) |

## Cross-cutting mechanisms

- **Signals** (`celery/signals.py`, `celery/utils/dispatch/signal.py`). A Django-style dispatcher with hooks such as `before_task_publish`, `task_prerun`, `task_postrun`, `task_failure`, `worker_init`, `worker_process_init`, `beat_init` and `celeryd_init`. It is the main extension point for observing the lifecycle.
- **Bootsteps** (`celery/bootsteps.py`). Both the worker (`WorkController.Blueprint`) and its `Consumer` are built as dependency-ordered graphs of steps. Applications can add steps through `app.steps['worker']` and `app.steps['consumer']`.
- **Lamport clock.** `app.clock` is advanced and adjusted by events and control messages, so that monitors can order events from different hosts.
- **Message protocol.** Protocol 2 is the default (`as_task_v2`). Protocol 1 messages are still parsed by the worker (`proto1_to_proto2`). The task id is the AMQP `correlation_id`, and `reply_to` carries the client's result queue for the RPC backend.
- **Serialization and trust.** Task messages use `task_serializer` (JSON by default, restricted by `accept_content`). The optional `auth` serializer signs messages. See [Message security](../operations/message-security.md).

## Failure and consistency model

- The broker connection can fail at any moment. The consumer is restartable. The blueprint restarts, queued unacked messages are redelivered by the broker, and prefetch counts are reduced and restored around the reconnect. See [Worker and consumer](worker-and-consumer.md).
- Delivery is at-least-once with `acks_late`, and at-most-once-ish otherwise. Tasks should be idempotent. The result backend refuses to overwrite a `SUCCESS` state, and when `acks_late` and `worker_deduplicate_successful_tasks` are both enabled, the tracer skips redelivered tasks that already succeeded.
- Chords depend on backend counters or polling, and canvas failure handling is delicate. See [Canvas](canvas-workflows.md).

## Where to start reading code

- Calling a task: `celery/app/task.py::Task.apply_async`, then `celery/app/base.py::send_task`.
- Worker startup: `celery/bin/worker.py`, `celery/apps/worker.py::Worker`, `celery/worker/worker.py::WorkController`.
- One task's execution: `celery/worker/consumer/consumer.py::create_task_handler`, `celery/worker/strategy.py::default`, `celery/worker/request.py::Request.execute_using_pool`, `celery/app/trace.py::build_tracer`.
- Tests mirror this layout under `t/unit/`. See [Testing, CI and development workflow](../testing/test-strategy.md).
