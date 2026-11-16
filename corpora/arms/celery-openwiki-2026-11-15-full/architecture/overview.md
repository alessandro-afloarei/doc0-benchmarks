---
type: architecture
title: Architecture Overview
description: End-to-end map of Celery's subsystems — app, messaging, worker blueprint, consumer, pools, tracer, result backends, canvas, beat, events, remote control and CLI — and the path a task takes from apply_async to a stored result.
tags: [architecture, overview, task-lifecycle, worker, messaging]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T09:27:53.075Z
sources:
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-41d293d3c7e3c875eed1b7ef
    resource: repo://celery/app/control.py
  - id: openwiki-source-4a982797c89fcb3ea5c5d0ee
    resource: repo://celery/app/trace.py
  - id: openwiki-source-3fcc726af565b7ddfc0ea693
    resource: repo://celery/events/event.py
  - id: openwiki-source-94b60a38fd26082deb41f979
    resource: repo://celery/worker/consumer/consumer.py
  - id: openwiki-source-328c66e40eb163230ad26cbc
    resource: repo://celery/worker/request.py
  - id: openwiki-source-5b05690e7e13e9bff2a56054
    resource: repo://celery/worker/strategy.py
  - id: openwiki-source-12d3bd623a53e489a785c641
    resource: repo://celery/worker/worker.py
generated: { by: "claude-code", at: "2026-11-15T09:27:53.075Z" }
---

# Architecture Overview

Celery is a distributed task queue: **clients** publish task messages to a **broker** (RabbitMQ, Redis, SQS, ... via the [kombu](https://github.com/celery/kombu) messaging library), **workers** consume and execute them, and an optional **result backend** stores return values and states. The package version is declared in `celery/__init__.py` (`__version__`, release series name `SERIES`), which also lazily re-exports the public API (`Celery`, `Task`, `shared_task`, `signature`, `chain`, `group`, `chord`, `chunks`, `xmap`, `xstarmap`, `current_app`, `current_task`).

## Subsystem map

| Subsystem | Main code | Wiki page |
| --- | --- | --- |
| Application object, configuration, loaders | `celery/app/base.py`, `celery/app/utils.py`, `celery/app/defaults.py`, `celery/loaders/`, `celery/_state.py` | [Application Object and Configuration](../app/application-and-configuration.md) |
| Task classes, registry, retry | `celery/app/task.py`, `celery/app/registry.py`, `celery/app/autoretry.py` | [Tasks, Task Registry and Retries](../app/tasks-and-registry.md) |
| Message creation, routing, producers | `celery/app/amqp.py`, `celery/app/routes.py` | [Message Publishing, Protocol and Routing](../messaging/publishing-and-routing.md) |
| Worker process skeleton | `celery/bootsteps.py`, `celery/worker/worker.py`, `celery/worker/components.py`, `celery/apps/worker.py` | [Worker Bootsteps and WorkController](../worker/bootsteps-and-workcontroller.md) |
| Broker consumption | `celery/worker/consumer/`, `celery/worker/loops.py` | [Worker Consumer and Event Loop](../worker/consumer.md) |
| Executing a request | `celery/worker/strategy.py`, `celery/worker/request.py`, `celery/app/trace.py` | [Task Execution](../worker/task-execution.md) |
| Execution pools | `celery/concurrency/` | [Concurrency Pools and Autoscaling](../worker/concurrency-pools.md) |
| Remote control | `celery/app/control.py`, `celery/worker/control.py`, `celery/worker/pidbox.py` | [Remote Control and Inspection](../worker/remote-control.md) |
| Native delayed delivery / quorum queues | `celery/worker/consumer/delayed_delivery.py`, `celery/utils/quorum_queues.py` | [Native Delayed Delivery and Quorum Queues](../worker/delayed-delivery-and-quorum-queues.md) |
| Workflows | `celery/canvas.py` | [Canvas: Signatures and Workflows](../canvas/signatures-and-workflows.md) |
| Results | `celery/result.py`, `celery/backends/` | [Result Objects](../results/result-objects.md), [Result Backends](../results/result-backends.md) |
| Periodic tasks | `celery/beat.py`, `celery/schedules.py` | [Beat and Periodic Scheduling](../beat/periodic-tasks.md) |
| Monitoring events | `celery/events/` | [Events and Monitoring](../events/monitoring-events.md) |
| CLI | `celery/bin/` | [Command-Line Interface](../cli/command-line.md) |
| Message signing | `celery/security/` | [Message Signing Security](../security/message-signing.md) |
| Django | `celery/fixups/django.py`, `celery/contrib/django/` | [Django Integration](../integrations/django.md) |
| Signals, logging, OS support | `celery/signals.py`, `celery/app/log.py`, `celery/platforms.py` | [Signals, Logging and Platform Support](../operations/signals-logging-and-platforms.md) |

## Life of a task

```text
client process                         broker                 worker process
--------------                         ------                 --------------
task.apply_async()
  └─ app.send_task()
       ├─ router.route()  ──────────►  exchange/queue  ──►  Consumer (kombu) on_task_received
       ├─ amqp.create_task_message()                         └─ strategy[task_name](message)
       ├─ backend.on_task_call()                                  ├─ Request(...)
       └─ amqp.send_task_message()                                 ├─ ETA? -> timer / rate-limit bucket
  returns AsyncResult(task_id)                                     └─ WorkController._process_task(req)
                                                                        └─ req.execute_using_pool(pool)
                                                                              └─ pool child: trace_task()
                                                                                   ├─ task.run(...)
result.get() ◄──── result backend ◄──────────────────────────────────────────────── backend.mark_as_done()
```

1. **Publish.** `Task.apply_async` validates arguments and merges task options, then calls `Celery.send_task`. `send_task` resolves routing options, converts `expires` into a message TTL, inherits `root_id`/`parent_id` from the currently executing worker task, builds the message with `amqp.create_task_message` (protocol v2 by default), lets the backend prepare for the result (`backend.on_task_call`, e.g. the RPC backend subscribes to replies), and publishes it through a pooled producer. It returns an `AsyncResult` and, when called inside a task, appends it to the parent's `request.children` trail.
2. **Consume.** In the worker, the `Consumer` blueprint owns the broker connection. Its `Tasks` step starts a kombu consumer on the selected queues whose callback (`create_task_handler`) reads the `task` header (v2) or decodes the body (v1) and dispatches to a per-task **strategy**. Unknown task names and undecodable messages are rejected/logged rather than crashing the worker.
3. **Admit.** The default strategy (`celery/worker/strategy.py`) builds a `Request`, drops revoked/expired requests, sends `task_received` / `task-received`, and either schedules ETA tasks on the timer (incrementing prefetch so the worker can keep consuming), routes them through a rate-limit token bucket, or hands them to `WorkController._process_task`.
4. **Execute.** `Request.execute_using_pool` submits `trace_task_ret`/`fast_trace_task` to the pool with time limits and callbacks (`on_accepted`, `on_success`, `on_failure`, `on_timeout`). In the pool child, the tracer built by `build_tracer` pushes the task/request context, sends `task_prerun`, optionally stores `STARTED`, runs the task, interprets `Retry`/`Ignore`/`Reject`/exceptions, dispatches callbacks and chain continuations, stores the result with `backend.mark_as_done`, and sends `task_success`/`task_postrun`.
5. **Acknowledge.** By default messages are acked when the pool accepts the task; with `acks_late` they are acked after completion (see [Task Execution](../worker/task-execution.md)).
6. **Collect.** `AsyncResult.get()` waits on the backend — polling for key/value stores or consuming reply messages for async backends such as RPC and Redis pub/sub.

## Cross-cutting design patterns

- **Lazy everything.** Apps, configuration, task classes, backends and many components are created on first use; this keeps imports cheap and lets configuration be applied after the app object is defined.
- **Bootsteps.** Both the worker (`WorkController.Blueprint`) and its consumer (`Consumer.Blueprint`) are dependency graphs of `Step`s with `create/start/stop/shutdown` hooks, extensible via `app.steps['worker'|'consumer']`.
- **Async I/O hub.** With transports that support it (AMQP, Redis), the worker runs a kombu `Hub` event loop (`asynloop`) and the prefork pool communicates with children over non-blocking pipes (`AsynPool`). Other transports fall back to a blocking `synloop`.
- **Signals.** `celery/signals.py` exposes hooks at every lifecycle point (task, worker, beat, import, logging setup).
- **Events and control are separate channels.** Monitoring events go to the `celeryev` exchange; remote-control commands use a fanout kombu `Mailbox` named by `control_exchange` (default `celery`, which kombu turns into the `celery.pidbox` exchange with replies on `reply.celery.pidbox`).

## Process roles

- **Client** — any process that imports the app and calls tasks.
- **Worker** — `celery -A proj worker` (`celery/bin/worker.py` → `app.Worker` in `celery/apps/worker.py` → `WorkController`).
- **Beat** — `celery -A proj beat`, or embedded in a worker with `-B`; publishes due periodic tasks.
- **Monitors** — `celery events`, Flower and other consumers of the event stream; `celery inspect/control` for remote control.

## Repository layout beyond the package

- `t/` — unit, integration, smoke and benchmark tests ([Testing](../testing/test-suite.md)).
- `docs/` — Sphinx documentation sources.
- `extra/`, `docker/`, `helm-chart/` — deployment assets ([Deployment and Daemonization](../operations/deployment.md)).
- `requirements/` — per-extra requirement files used by `setup.py`.
