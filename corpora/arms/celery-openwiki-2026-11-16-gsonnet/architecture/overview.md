---
type: architecture
title: Architecture Overview
description: System-level map of Celery 5.6 — the app object, producer-side publishing through AMQP/kombu, the worker's bootstep-driven consumer and pool, result backends, beat, events and remote control — with the global state helpers (current_app, proxies) that tie them together.
tags: [celery, architecture, overview, worker, broker, backend]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:22:47.483Z
sources:
  - id: openwiki-source-5112943b291f75d67ab0c888
    resource: repo://celery/_state.py
  - id: openwiki-source-5a0b6982dd7ddb0fabfabd0c
    resource: repo://celery/app/amqp.py
  - id: openwiki-source-94b60a38fd26082deb41f979
    resource: repo://celery/worker/consumer/consumer.py
  - id: openwiki-source-12d3bd623a53e489a785c641
    resource: repo://celery/worker/worker.py
generated: { by: "claude-code", at: "2026-11-16T09:22:47.483Z" }
---

# Architecture Overview

Celery is a distributed task queue: *clients* publish task messages to a **broker**, *workers* consume and execute them, and an optional **result backend** stores outcomes. This repository is the whole `celery` Python package (version `5.6.2`, `celery/__init__.py`); transports and message primitives come from the sibling libraries **kombu** (messaging), **billiard** (multiprocessing pool) and **vine** (promises). Celery itself contains no broker.

```
 client / beat / task ──apply_async──▶  broker (queues)  ──▶  worker ─▶ pool child ─▶ task code
        │                                  ▲   ▲                │                         │
        │                                  │   └── events ◀─────┤                         ▼
        └── AsyncResult.get ◀── result backend ◀────── store_result / chord counters ─────┘
                                  control (pidbox) ◀──▶ app.control / celery inspect
```

## Subsystems and where they live

| Subsystem | Code | Wiki page |
|---|---|---|
| App object, config, loaders, registry, signals | `celery/app/base.py`, `defaults.py`, `celery/loaders/`, `celery/signals.py` | [[/openwiki/architecture/application.md]] |
| Task class, publishing, routing, AMQP protocol | `celery/app/task.py`, `amqp.py`, `routes.py` | [[/openwiki/architecture/tasks.md]] |
| Worker: bootsteps, consumer, strategy, request | `celery/bootsteps.py`, `celery/worker/` | [[/openwiki/architecture/worker.md]] |
| Execution pools | `celery/concurrency/` | [[/openwiki/architecture/concurrency-pools.md]] |
| Result backends and result objects | `celery/backends/`, `celery/result.py` | [[/openwiki/architecture/result-backends.md]] |
| Workflows (chain/group/chord) | `celery/canvas.py`, `celery/app/builtins.py` | [[/openwiki/architecture/canvas-workflows.md]] |
| Periodic scheduling | `celery/beat.py`, `celery/schedules.py` | [[/openwiki/architecture/beat-scheduler.md]] |
| Events, remote control | `celery/events/`, `celery/app/control.py`, `celery/worker/control.py` | [[/openwiki/architecture/events-and-monitoring.md]] |
| Command line | `celery/bin/`, `celery/apps/` | [[/openwiki/architecture/cli.md]] |
| Message signing | `celery/security/` | [[/openwiki/architecture/security.md]] |

The end-to-end path of one task is in [[/openwiki/workflows/task-lifecycle.md]]; testing and CI are in [[/openwiki/operations/testing.md]].

## The app is the hub

Everything hangs off one `Celery` instance (`celery/app/base.py`): `app.conf`, `app.amqp` (queues, router, message factory, producer pool), `app.backend`, `app.loader`, `app.control`, `app.events`, `app.log`, `app.tasks`, `app.clock`. Most are lazily created `cached_property`s, which keeps import cheap and lets configuration be set after the app is instantiated. See [[/openwiki/architecture/application.md]].

Because library code and task bodies rarely receive the app explicitly, `celery/_state.py` provides **ambient lookup**:

- `current_app` is a `Proxy` (from `celery/local.py`) over `get_current_app()`, which returns the thread-local app set by `app.set_current()` or, failing that, a process-wide `default_app`. If none exists a fallback app named `default` is created on demand. Env vars `C_STRICT_APP` / `C_WARN_APP` / `CELERY_TRACE_APP` turn silent use of the implicit app into an error, a stack-trace print, or tracing — useful to find code that should be passing an app explicitly.
- `current_task` is a proxy to the top of a thread-local task stack (`push_current_task`/`pop_current_task`), maintained by the tracer so code can reach `current_task.request`. `get_current_worker_task` skips tasks that were merely called directly, not applied by a worker.
- `celery/local.py` supplies `Proxy`/`PromiseProxy` (lazy evaluation: the real object is created on first attribute access) and the lazy module machinery that makes `from celery import Celery, group, chord` cheap. `@app.task` returns a `PromiseProxy` before finalization for the same reason.
- `connect_on_app_finalize` / `_announce_app_finalized` let modules (built-in tasks, `@shared_task`) register tasks that every app receives at finalization.

## Producer side

`task.delay()`/`apply_async()` (or `app.send_task` by name) builds a message with `app.amqp.as_task_v2` — **protocol 2**: routing and bookkeeping live in message *headers* (`task`, `id`, `eta`, `expires`, `retries`, `timelimit`, `root_id`, `parent_id`, `group`, stamps, `argsrepr`...), while the *body* is `(args, kwargs, {callbacks, errbacks, chain, chord})`. This lets a worker route, revoke, or reject a task without deserializing its arguments. `countdown` and relative `expires` are converted to absolute ISO-8601 times with the app timezone before sending.

`AMQP._create_task_sender` returns the publisher: it resolves the queue (default queue when none/exchange given), derives exchange/routing key (anonymous exchange for direct queues), merges the publish retry policy, fires `before_task_publish` and `after_task_publish`, calls `producer.publish(...)` with the configured serializer and compression, and optionally emits a `task-sent` event. Routing rules (`task_routes`, `task_queues`) are applied by `Router` before this step. See [[/openwiki/architecture/tasks.md]].

## Worker side

`celery worker` ends up building a `WorkController` (`celery/worker/worker.py`), whose `Blueprint` is a graph of **bootsteps** (`celery/bootsteps.py`) with `requires` dependencies: `Timer`, `Hub` (event loop), `Pool`, `Beat` (optional embedded), `StateDB`, `Autoscaler` and `Consumer`. `WorkController.__init__` loads the loader's `init_worker`, applies queue selection (`-Q`, `-X`, `worker_direct`), imports task modules, sends `worker_init`, instantiates the pool class and applies the blueprint; `start()` runs the blueprint and maps failures to exit codes (`WorkerTerminate` → terminate, unhandled exception → critical log and `EX_FAILURE`).

The `Consumer` bootstep contains its own blueprint (Connection, Mingle, Events, Gossip, Heart, Control, Tasks, DelayedDelivery, the event loop and Agent) that connects to the broker, subscribes to queues, and turns each message into a `Request` via a per-task *strategy*. Requests are then either delayed (ETA), rate limited, or handed to the pool. Connection loss restarts the consumer blueprint without restarting the pool. Details in [[/openwiki/architecture/worker.md]] and [[/openwiki/architecture/concurrency-pools.md]].

Inside a pool child the **tracer** (`celery/app/trace.py`) runs the task, invokes signals and callbacks, and writes state/results through the backend.

## Results, workflows and chords

A result backend (`celery/backends/`) persists task meta (state, result, traceback, children) keyed by task id; `AsyncResult` polls or subscribes. Canvas workflows are data structures (signatures) whose runtime coordination — passing results along a chain, counting header completions for a chord — is implemented partly in the message `chain`/`chord` fields and partly in backend hooks such as `on_chord_part_return`. See [[/openwiki/architecture/result-backends.md]] and [[/openwiki/architecture/canvas-workflows.md]].

## Side channels

- **Beat** is a separate process (or embedded in the worker) that publishes due periodic tasks.
- **Events** carry monitoring data from workers; **pidbox** carries commands to workers (revoke, rate limit, inspect). They share the broker connection settings but use their own exchanges. See [[/openwiki/architecture/events-and-monitoring.md]].

## Key design characteristics

- **At-least-once by default with early acks**: workers acknowledge on task *start* unless `acks_late` is set; combined with `reject_on_worker_lost` this governs redelivery. Tasks should be idempotent.
- **Lazy everything**: config, finalization, task creation and backends are deferred; the `app.finalize()` step is the point where decorators become real tasks.
- **Pluggability by name**: pool, loader, scheduler, backend, serializer, and bootsteps are all resolved with `symbol_by_name` strings from configuration or entry points, so third-party packages extend Celery without patching it.
- **Signals as the extension surface** for lifecycle events (see the application page), with bootsteps (`app.steps['worker']`, `app.steps['consumer']`) for structural additions.
- **Serialization boundary**: message bodies use kombu serializers limited by `accept_content` (default JSON); pickle is available but is a remote-code-execution risk (see [[/openwiki/architecture/security.md]]).
