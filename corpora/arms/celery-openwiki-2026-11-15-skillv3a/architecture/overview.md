---
type: architecture
title: Architecture Overview
description: System-level map of Celery's runtime pieces (app/producer, broker via kombu, worker, result backend, beat, events, remote control) and how one task travels from apply_async to a stored result.
tags: [architecture, overview, task-flow, broker, worker, backend]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:49.645Z
sources:
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-3795aa577fa7b0f3bd2af81a
    resource: repo://celery/app/task.py
  - id: openwiki-source-2a32c4e613bc7be1d621d647
    resource: repo://celery/beat.py
  - id: openwiki-source-328c66e40eb163230ad26cbc
    resource: repo://celery/worker/request.py
  - id: openwiki-source-5b05690e7e13e9bff2a56054
    resource: repo://celery/worker/strategy.py
  - id: openwiki-source-12d3bd623a53e489a785c641
    resource: repo://celery/worker/worker.py
generated: { by: "claude-code", at: "2026-11-15T17:08:49.645Z" }
---

# Architecture Overview

Celery (`celery/__init__.py`, version series "recovery", 5.6.x) is a distributed task queue. User code defines **tasks** on an **app**. Calling a task publishes a **message** to a **broker** through [kombu](https://github.com/celery/kombu). **Workers** consume and execute the message, and the outcome is stored in an optional **result backend**. Other parts work around this core:

| Component | Role | Main code |
|---|---|---|
| App | Configuration, task registry, factory for every subsystem | `celery/app/base.py`, see [Application Object](application.md) |
| Messaging (`app.amqp`) | Builds task messages (protocol v2), queues, routing, producer pool | `celery/app/amqp.py`, `celery/app/routes.py` |
| Broker transport | AMQP (RabbitMQ), Redis, SQS, and others, all via kombu | external `kombu` package |
| Worker | Consumes messages, schedules and executes tasks in a pool | `celery/worker/`, `celery/concurrency/` |
| Tracer | Runs the task function, records state, fires signals and callbacks | `celery/app/trace.py` |
| Result backend | Stores task state and results, implements chord joins | `celery/backends/` |
| Result API | `AsyncResult`/`GroupResult` handles held by callers | `celery/result.py` |
| Canvas | Signatures and workflows (chain, group, chord) | `celery/canvas.py` |
| Beat | Periodic scheduler that publishes tasks on a schedule | `celery/beat.py`, `celery/schedules.py` |
| Events | Monitoring event stream (task-*/worker-*) and in-memory cluster state | `celery/events/` |
| Remote control | Broadcast commands and inspection over a pidbox mailbox | `celery/app/control.py`, `celery/worker/control.py` |
| CLI | The click-based `celery` command | `celery/bin/` |

## End-to-end task flow

```
caller                         broker                     worker                          backend
------                         ------                     ------                          -------
task.delay()/apply_async()
  └─ app.send_task()
       ├─ router.route()  ─────► queue/exchange
       ├─ amqp.create_task_message()  (headers + body, protocol v2)
       ├─ backend.on_task_call()      (e.g. RPC/Redis result subscription)
       └─ amqp.send_task_message() ──► message ──► Consumer (kombu)
  ◄─ AsyncResult(task_id)                           └─ strategy.default()
                                                         ├─ Request(message)
                                                         ├─ ETA? → timer.call_at
                                                         ├─ rate limit bucket?
                                                         └─ WorkController._process_task
                                                              └─ pool.apply_async(trace_task)
                                                                   └─ build_tracer → task.run()
                                                                        └─ backend.mark_as_done/... ──► state+result
AsyncResult.get() ◄───────────────────────────────────────────────────────────────────── poll / pubsub / reply queue
```

1. **Publish.** `Task.apply_async` (`celery/app/task.py`) merges task-level options and calls `app.send_task`. If `task_always_eager` is set, it instead round-trips the arguments through the serializer and runs the task in-process with `Task.apply`, returning an `EagerResult`. `send_task` resolves routing options with the router, builds the message with `amqp.create_task_message`, lets the backend prepare for the result (`backend.on_task_call`), publishes with `amqp.send_task_message`, and returns an `AsyncResult`. When called from inside a running worker task, the new result is added to the parent's trail. See [Task Messages, Protocol and Routing](../tasks/messaging-and-routing.md).
2. **Consume.** The worker's `Consumer` (`celery/worker/consumer/`) receives the message on a kombu connection and passes it to the per-task strategy (`celery/worker/strategy.py`). The strategy builds a `Request`, sends `task-received` events, and then does one of three things: holds the request in the timer if it has an ETA or countdown, puts it in a rate-limit token bucket, or hands it straight to `WorkController._process_task`. See [Consumer, Strategies and Task Requests](../worker/consumer-and-requests.md).
3. **Execute.** `Request.execute_using_pool` submits `trace_task` (or `fast_trace_task`) to the concurrency pool: prefork, threads, eventlet, gevent, or solo. Inside the pool, `build_tracer` runs the task, updates state in the backend, applies callbacks and errbacks and the next step of a chain, and sends the `task_prerun`/`task_postrun`/`task_success`/`task_failure` signals. See [Task Execution Tracing](../tasks/execution-tracing.md) and [Concurrency Pools](../worker/concurrency-pools.md).
4. **Acknowledge.** The message is acked before execution by default, or after execution with `acks_late`. Rejection and redelivery follow the request's failure handling.
5. **Collect.** The caller's `AsyncResult.get()` waits on the backend. Key-value backends poll or subscribe (Redis pub/sub), and the RPC backend uses a reply queue. See [Results API](../results/result-api.md) and [Result Backends](../results/backends.md).

Beat (`celery/beat.py`) is just another producer. On each tick, `Scheduler.apply_async` calls `task.apply_async` for registered tasks, or `app.send_task` for unknown names. See [Beat Scheduler](../operations/beat-scheduler.md).

## Worker internals in one paragraph

`celery worker` builds a `WorkController` (`celery/worker/worker.py`) whose start-up order comes from a **bootsteps** dependency graph (`celery/bootsteps.py`): Hub (event loop), Pool, Timer, Beat (embedded, optional), StateDB, Autoscaler, and Consumer. The Consumer is a second blueprint with steps for Connection, Events, Mingle, Gossip, Heart, Tasks, Control (pidbox), Agent, and DelayedDelivery. See [Worker Architecture and Bootsteps](../worker/worker-architecture.md).

## Package map

- `celery/app/`: the app, Task class, tracing, AMQP and routing, control client, settings defaults, logging, built-in tasks.
- `celery/worker/`: WorkController, consumer and its bootsteps, requests, strategies, worker-side control commands, global worker state.
- `celery/concurrency/`: execution pools (`prefork` and `asynpool`, `eventlet`, `gevent`, `thread`, `solo`).
- `celery/backends/`: result backends (Redis, RPC, SQLAlchemy database, MongoDB, cache, S3, DynamoDB, Elasticsearch, Cassandra, Azure, GCS, and others).
- `celery/events/`: event dispatcher and receiver, cluster state model, curses monitor, snapshot cameras.
- `celery/bin/` and `celery/apps/`: the CLI and the long-running program wrappers (`apps/worker.py`, `apps/beat.py`, `apps/multi.py`).
- `celery/security/`: the `auth` message-signing serializer.
- `celery/fixups/` and `celery/contrib/`: Django integration, pytest plugin and testing helpers, abortable tasks, rdb, migrate, sphinx.
- `celery/utils/`: shared helpers (time and timezones, collections such as `LimitedSet`, dispatch/signals, imports, logging, serialization).
- `t/`: unit, integration, and smoke tests. `docs/`: Sphinx documentation. `docker/` and `helm-chart/`: development and deployment assets.

## Key design properties

- **Lazy everything.** Configuration, the backend, the AMQP layer, and tasks are created on first use. This keeps importing user modules cheap and lets configuration change before finalization.
- **Pluggable through strings.** Subsystems, pools, backends, loaders, routers, and Request classes are referenced as `module:Class` strings and resolved with `symbol_by_name`.
- **Message-level contract.** Workers need only the message headers and body (protocol v2) plus a registered task of the same name. `send_task` can publish tasks whose code is not importable by the caller.
- **At-least-once semantics are opt-in.** Early ack is the default, while `task_acks_late` and `task_reject_on_worker_lost` move toward redelivery on failure.

## See also

- [The Celery Application Object](application.md)
- [Tasks: Definition, Invocation, Retries](../tasks/task-lifecycle.md)
- [Worker Architecture and Bootsteps](../worker/worker-architecture.md)
- [Result Backends](../results/backends.md)
