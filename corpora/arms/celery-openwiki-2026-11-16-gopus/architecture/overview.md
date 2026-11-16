---
type: architecture
title: Architecture Overview
description: System map of Celery — the app object, kombu broker transport, worker, execution pools, result backends, beat, events and remote control — and the end-to-end lifecycle of one task message.
tags: [architecture, overview, worker, broker, backend, lifecycle]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:57:55.789Z
sources:
  - id: openwiki-source-5a0b6982dd7ddb0fabfabd0c
    resource: repo://celery/app/amqp.py
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
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
generated: { by: "claude-code", at: "2026-11-16T06:57:55.789Z" }
---

# Architecture Overview

Celery (`celery` package, version declared in `celery/__init__.py`) is a
distributed task queue. Producers serialize *task messages* and publish them to
a message broker; worker processes consume those messages, execute the
registered task function in an execution pool, and optionally store the result
in a *result backend*. Celery is built on a small set of sibling libraries
declared in `requirements/default.txt`:

| Dependency | Used for |
|------------|----------|
| `kombu` | Broker transports (AMQP/RabbitMQ, Redis, SQS, ...), connections, producers/consumers, queues, serialization registry, event loop (`kombu.asynchronous.Hub`) |
| `billiard` | Fork of `multiprocessing` used by the prefork pool, plus `register_after_fork` and process utilities |
| `vine` | Promises (`promise`, `barrier`) used by async result handling, the consumer and canvas |
| `click` (+ plugins) | The `celery` command-line interface |
| `python-dateutil`, `tzlocal` | Time zone and date handling |

## Major subsystems

```
          ┌──────────── Celery app (celery/app/base.py) ────────────┐
          │ conf · loader · tasks registry · amqp · backend · control │
          └──────────────┬───────────────────────────┬───────────────┘
   client: task.delay()  │                           │ celery beat
                         ▼                           ▼
                 app.send_task ── amqp.create_task_message / send_task_message
                         │  (routing → queue/exchange; kombu Producer)
                         ▼
                   ┌──────────┐
                   │  Broker  │  (RabbitMQ, Redis, SQS, ...)
                   └────┬─────┘
                        ▼
   Worker: WorkController ─ bootsteps ─ Hub · Timer · Pool · Consumer
           Consumer → strategy → Request → Pool → trace_task → task.run()
                        │                                 │
                        ▼ events / pidbox                  ▼ store_result
                  monitors, `celery inspect`        Result backend ← AsyncResult.get()
```

| Subsystem | Code | Wiki page |
|-----------|------|-----------|
| Application object, config, loaders | `celery/app/base.py`, `celery/app/utils.py`, `celery/app/defaults.py`, `celery/loaders/` | [App and configuration](app-and-configuration.md) |
| Task definition and invocation | `celery/app/task.py` | [Tasks](../concepts/tasks.md) |
| Message construction and routing | `celery/app/amqp.py`, `celery/app/routes.py` | [Publishing and routing](../workflows/task-publishing-and-routing.md) |
| Worker startup | `celery/worker/worker.py`, `celery/bootsteps.py`, `celery/worker/components.py` | [Worker bootsteps](worker/worker-bootsteps.md) |
| Message consumption | `celery/worker/consumer/`, `celery/worker/strategy.py`, `celery/worker/request.py` | [Consumer](worker/consumer.md) |
| Task execution | `celery/app/trace.py`, `celery/signals.py` | [Execution tracing](worker/task-execution-trace.md) |
| Execution pools | `celery/concurrency/` | [Concurrency pools](worker/concurrency-pools.md) |
| Workflows | `celery/canvas.py` | [Canvas](../concepts/canvas.md) |
| Results | `celery/backends/`, `celery/result.py` | [Result backends](result-backends.md) |
| Periodic tasks | `celery/beat.py`, `celery/schedules.py` | [Beat](beat-scheduler.md) |
| Monitoring and control | `celery/events/`, `celery/app/control.py`, `celery/worker/control.py` | [Remote control and events](remote-control-and-events.md) |
| CLI and daemons | `celery/bin/`, `celery/apps/`, `celery/platforms.py` | [CLI](../operations/cli-and-daemonization.md) |
| Security / serialization | `celery/security/` | [Message signing](../integrations/security-and-serialization.md) |
| Django | `celery/fixups/django.py` | [Django](../integrations/django.md) |

## End-to-end lifecycle of a task

1. **Definition.** `@app.task` / `@shared_task` turns a function into a
   `Task` subclass registered by name in the app's `TaskRegistry`. Producer and
   worker must import the same task names.
2. **Invocation.** `task.delay(*a)` → `Task.apply_async()` → `app.send_task()`
   (`celery/app/base.py`). `send_task` resolves routing through
   `amqp.router.route(...)`, builds a protocol-v2 message with
   `amqp.create_task_message` (headers carry the task name, id, eta, expires,
   retries, root/parent ids; the body carries args, kwargs and canvas
   `embed`), lets the backend observe the call (`backend.on_task_call`, used by
   the RPC backend to set `reply_to`), and publishes through
   `amqp.send_task_message` with a pooled kombu producer. Publishing sends the
   `before_task_publish` / `after_task_publish` signals. The returned
   `AsyncResult` holds only the task id and a reference to the backend.
3. **Transport.** The broker stores the message in the chosen queue. With
   `task_always_eager` the broker is skipped entirely and `apply()` runs
   the task locally.
4. **Consumption.** In the worker, the consumer blueprint's `Tasks` step
   consumes from the selected queues. `Consumer.create_task_handler` reads
   `message.headers['task']` (protocol v2; v1 payloads are decoded) and calls
   the per-task *strategy* (`celery/worker/strategy.py:default`). The strategy
   builds a `Request`, drops revoked/expired tasks, sends `task_received`
   and the `task-received` event, and then either schedules ETA/countdown
   tasks on the timer, applies the per-task rate-limit bucket, or hands the
   request to `WorkController._process_task`.
5. **Execution.** `Request.execute_using_pool(pool)` submits
   `trace_task` to the pool (prefork child process, thread, greenlet or inline).
   `build_tracer` in `celery/app/trace.py` sets the request context, sends
   `task_prerun`, runs the function, stores the state (`SUCCESS`, `FAILURE`,
   `RETRY`, ...) in the backend, applies callbacks/errbacks and chord
   bookkeeping, and sends `task_postrun`.
6. **Acknowledgement.** By default the message is acked when execution
   starts; with `acks_late` it is acked after execution, so a crashed worker
   lets the broker redeliver it.
7. **Result retrieval.** `AsyncResult.get()` waits on the backend (polling
   for key/value backends, or a pub/sub / reply-queue consumer for Redis and
   RPC backends).

## Cross-cutting mechanisms

- **Bootsteps** (`celery/bootsteps.py`) – a dependency graph of start/stop
  steps used to compose both the worker and its consumer; extensions add
  steps through `app.steps['worker']` / `app.steps['consumer']`.
- **Signals** (`celery/signals.py`) – a lightweight dispatcher
  (`celery/utils/dispatch/signal.py`) with hooks for the app lifecycle, task
  publish/execute, worker lifecycle, beat, logging and import events.
- **Events** – workers optionally broadcast `task-*` and `worker-*` events to
  an event exchange; monitors (Flower, `celery events`) rebuild cluster state
  from them.
- **Remote control** – broadcast "pidbox" mailbox commands (`inspect`,
  `revoke`, `rate_limit`, `shutdown`, ...) handled by every worker.
- **Fixups** – pluggable environment integrations applied when an app is
  created; Django is the built-in one.
- **Lazy app binding** – `current_app`/`current_task` proxies and shared
  tasks allow libraries to define tasks without importing a concrete app.

## Repository layout

| Path | Contents |
|------|----------|
| `celery/` | Library source |
| `t/unit`, `t/integration`, `t/smoke` | Test suites ([testing](../testing/test-suite.md)) |
| `docs/` | Sphinx documentation (user guide, reference, internals such as `docs/internals/protocol.rst`) |
| `examples/` | Sample projects (Django, eventlet, gevent, tutorials) |
| `extra/` | Init scripts and supervisor/systemd examples |
| `helm-chart/`, `docker/` | Deployment and development containers |
| `requirements/` | Dependency and extras requirement files |

See also: [Quickstart](../quickstart.md).
