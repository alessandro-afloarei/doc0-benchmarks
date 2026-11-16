---
type: architecture
title: System Architecture Overview
description: End-to-end map of Celery's runtime pieces — the client-side app, the message broker accessed through kombu, the worker with its consumer and execution pool, result backends, the beat scheduler and the event stream — and how a single task call flows through them.
tags: [architecture, overview, task-flow, worker, broker, result-backend, beat, events]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:05:29.073Z
sources:
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-3795aa577fa7b0f3bd2af81a
    resource: repo://celery/app/task.py
  - id: openwiki-source-94b60a38fd26082deb41f979
    resource: repo://celery/worker/consumer/consumer.py
  - id: openwiki-source-328c66e40eb163230ad26cbc
    resource: repo://celery/worker/request.py
  - id: openwiki-source-5b05690e7e13e9bff2a56054
    resource: repo://celery/worker/strategy.py
  - id: openwiki-source-12d3bd623a53e489a785c641
    resource: repo://celery/worker/worker.py
  - id: openwiki-source-a33e87501bc6e99159549e28
    resource: repo://requirements/default.txt
generated: { by: "claude-code", at: "2026-11-16T17:05:29.073Z" }
---

# System Architecture Overview

Celery is a distributed task queue for Python (version `5.6.2`, series "recovery", per `celery/__init__.py`). Application code calls tasks; Celery serialises the call into a message, publishes it to a broker; worker processes consume, execute and optionally store results in a result backend. Periodic tasks are published by the beat scheduler, and every component can emit monitoring events.

The core library builds on a few sibling projects declared in `requirements/default.txt`:

| Dependency | Role |
|------------|------|
| `kombu` | Messaging abstraction: connections, producers, consumers, transports (AMQP, Redis, SQS, ...), serialization registry |
| `billiard` | Fork of `multiprocessing` used by the prefork pool |
| `vine` | Promises used by asynchronous code paths and canvas callbacks |
| `click` (+ plugins) | Command-line interface |

## Components

```text
            ┌──────────────── client process ────────────────┐
            │  Celery app ── Task.apply_async ── app.amqp    │
            │      │                               │ publish │
            │  AsyncResult ◄── result backend ◄┐   ▼         │
            └──────────────────────────────────┼───────────────┘
                                               │   Broker (via kombu)
   beat ── publishes periodic tasks ───────────┼──►  queues / exchanges
                                               │        │ consume
            ┌──────────────── worker ─────────┼────────▼──────────────┐
            │ WorkController (bootsteps)       │                       │
            │  ├─ Hub (event loop)  ├─ Timer  │                       │
            │  ├─ Pool (prefork/threads/gevent/eventlet/solo)          │
            │  └─ Consumer: Connection, Mingle, Events, Gossip, Heart, │
            │               Control (pidbox), Tasks, DelayedDelivery   │
            │      message → strategy → Request → pool → trace_task ──┘ store result
            └──────────────────────────────────────────────────────────┘
                   events ──► monitors (celery events, flower, State)
```

| Area | Main code | Wiki page |
|------|-----------|-----------|
| Application object and config | `celery/app/base.py`, `celery/app/utils.py`, `celery/app/defaults.py` | [Application Object](application-object.md), [Configuration](configuration.md) |
| Task API | `celery/app/task.py`, `celery/app/registry.py` | [Task Definition and Invocation](../tasks/task-definition-and-invocation.md) |
| Messaging and routing | `celery/app/amqp.py`, `celery/app/routes.py` | [Message Protocol, Queues and Routing](../tasks/messaging-and-routing.md) |
| Execution and tracing | `celery/app/trace.py`, `celery/states.py` | [Task Execution, Tracing and Retries](../tasks/execution-tracing-and-retries.md) |
| Workflows | `celery/canvas.py` | [Canvas](../canvas/workflows.md) |
| Results | `celery/result.py`, `celery/backends/` | [Result Objects](../results/result-objects.md), [Result Backends](../results/backends.md) |
| Worker | `celery/worker/`, `celery/bootsteps.py`, `celery/concurrency/` | [Worker Architecture](../worker/worker-architecture.md), [Consumer](../worker/consumer.md), [Request Lifecycle](../worker/request-lifecycle.md), [Pools](../worker/concurrency-pools.md) |
| Remote control | `celery/app/control.py`, `celery/worker/control.py` | [Remote Control](../worker/remote-control.md) |
| Periodic tasks | `celery/beat.py`, `celery/schedules.py` | [Beat](../scheduling/beat.md) |
| Events | `celery/events/` | [Events and Monitoring](../events/monitoring.md) |
| CLI | `celery/bin/`, `celery/apps/` | [CLI and Deployment](../operations/cli.md) |
| Security | `celery/security/` | [Message Signing](../operations/security.md) |
| Django | `celery/fixups/django.py`, `celery/contrib/django/` | [Django Integration](../integrations/django.md) |
| Extension seams | `celery/signals.py`, `celery/bootsteps.py` | [Signals and Extension Points](signals-and-extension-points.md) |

## Life of a task call

1. **Call.** `task.delay(*args)` is shorthand for `task.apply_async(args, kwargs)`. `apply_async` merges task-level options (`_get_exec_options`, routing, priority, `ignore_result`). If `task_always_eager` is set it round-trips the arguments through the serializer and runs `task.apply()` locally, returning an `EagerResult`; otherwise it calls `app.send_task()`.
2. **Build the message.** `app.send_task()` resolves the route (queue/exchange/routing key) via `app.amqp.router`, applies parent/root ids from the currently executing task, computes ETA/expiry, then calls `app.amqp.create_task_message()` (protocol v2 by default: headers carry the task name, id, ETA, retries, root/parent ids, time limits; the body is `(args, kwargs, embed)` where `embed` holds callbacks, errbacks, chain and chord).
3. **Publish.** Using a pooled producer, the backend is told about the call (`backend.on_task_call`, e.g. so the RPC/Redis backends can subscribe for the result) unless the result is ignored, and `amqp.send_task_message()` publishes with retry policy and emits `before_task_publish`/`after_task_publish` signals. An `AsyncResult(task_id)` is returned immediately.
4. **Consume.** In the worker, the Consumer's `Tasks` step subscribes to the configured queues. Each message is dispatched by task name to a handler created by `celery/worker/strategy.py`, which builds a `Request`, emits `task-received`, and then either schedules it on the timer (ETA/countdown), passes it through a rate-limit token bucket, or hands it straight to the pool.
5. **Execute.** `Request.execute_using_pool()` submits `trace_task_ret` (or `fast_trace_task`) to the concurrency pool. In the pool, the tracer built by `celery.app.trace.build_tracer` runs the task, manages state transitions (`STARTED`, `SUCCESS`, `FAILURE`, `RETRY`), sends `task_prerun`/`task_postrun`/`task_success`/`task_failure` signals, applies `link` callbacks and chain continuations, and stores the result in the backend.
6. **Acknowledge.** By default the message is acked when execution starts; with `acks_late` it is acked after the task returns, so it is redelivered if the worker dies. Results/failures are reported back to the main worker process, which updates worker state and emits `task-succeeded`/`task-failed` events.
7. **Fetch the result.** The caller's `AsyncResult.get()` polls or subscribes through `app.backend` until a ready state arrives, then returns the value or re-raises the stored exception.

## Process model

- **Client**: any process that creates a `Celery` app and publishes tasks. It needs only the broker (and the backend if it reads results).
- **Worker** (`celery worker`): one main process running the event loop and consumer, plus a pool. With the default prefork pool, tasks run in child processes managed by billiard; thread, gevent, eventlet and solo pools run tasks in the main process.
- **Beat** (`celery beat`, or embedded in a worker with `-B`): a single scheduler process that publishes due periodic tasks. Running more than one beat duplicates schedules.
- **Monitors** (`celery events`, `celery inspect`, external tools): consume the event exchange and use broadcast remote-control commands.

## Cross-cutting design themes

- **Laziness.** The app defers configuration, task creation and backend construction until first use, so modules can be imported in any order and apps pickled into child processes.
- **Bootsteps.** Both the worker and the consumer are assembled from dependency-ordered steps (`celery/bootsteps.py`), which is also the public extension mechanism for adding worker components.
- **Signals everywhere.** Lifecycle hooks (`celery/signals.py`) let integrations observe publishing, execution, worker start/stop and logging setup.
- **Pluggable transports and backends.** Brokers come from kombu transports; result backends are selected by URL scheme from `celery/app/backends.py`.

## Repository layout

| Path | Contents |
|------|----------|
| `celery/` | The library |
| `t/unit`, `t/integration`, `t/smoke` | Test suites (see [Testing](../testing/test-suite.md)) |
| `docs/` | Sphinx documentation (user guide, reference, internals) |
| `examples/` | Example projects (Django, eventlet, gevent, periodic tasks, ...) |
| `extra/` | Init scripts, systemd/supervisord units, shell completions |
| `docker/`, `helm-chart/` | Development container and a Kubernetes Helm chart |
| `requirements/` | Pinned requirement sets, including `extras/*.txt` for optional backends/transports |

## Related

- [The Celery Application Object](application-object.md)
- [Task Definition and Invocation](../tasks/task-definition-and-invocation.md)
- [Worker Architecture and Bootsteps](../worker/worker-architecture.md)
- [Result Backends](../results/backends.md)
