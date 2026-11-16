---
type: architecture
title: Worker lifecycle and concurrency
description: Worker and consumer bootsteps, execution pools, prefetch and ETA scheduling, reconnect behavior, and shutdown ownership.
tags: [workers, bootsteps, concurrency, qos, lifecycle]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:38:41.370Z
sources:
  - id: openwiki-source-7c9db0d3259470539a2d0756
    resource: repo://celery/bootsteps.py
  - id: openwiki-source-09faa18a62432ea5464530cc
    resource: repo://celery/concurrency/prefork.py
  - id: openwiki-source-cd5b25b412e425989370ceb9
    resource: repo://celery/worker/components.py
  - id: openwiki-source-94b60a38fd26082deb41f979
    resource: repo://celery/worker/consumer/consumer.py
  - id: openwiki-source-337ca17b51d3603b5a2c09ec
    resource: repo://celery/worker/consumer/tasks.py
  - id: openwiki-source-12d3bd623a53e489a785c641
    resource: repo://celery/worker/worker.py
generated: { by: "codex", at: "2026-11-16T16:38:41.370Z" }
---

# Worker lifecycle and concurrency

`WorkController` coordinates the worker's infrastructure. It imports task modules through the application loader, chooses queues and concurrency, resolves the execution pool, and applies a worker blueprint. The CLI-facing `celery.apps.worker.Worker` adds command-line logging, signals, and presentation around this controller.

## Bootsteps define dependency order

There are two nested blueprints. The worker blueprint owns the hub, pool, timer, optional embedded Beat, state database, autoscaler, and consumer. The consumer blueprint owns connection-facing services such as task consumption, events, heartbeat, remote control, peer synchronization, and delayed-delivery setup.

Bootstep `requires` relationships form a dependency graph. The blueprint topologically orders steps, creates/includes their objects, then starts included steps in order. Stop/terminate generally traverse steps in reverse. A step's inclusion can be conditional, and the consumer worker step is marked last. Extend `app.steps['worker']` or `app.steps['consumer']` with explicit dependencies rather than assuming directory or declaration order defines startup order.

## The receiving path

The task consumer builds strategies from the registered tasks. Its message handler reads the protocol 2 task name from headers, or decodes protocol 1 to find the task. Unknown task names go to a separate failure path; valid messages invoke the task-specific strategy with acknowledgement and rejection callbacks. Protocol 2 defers body decoding to the execution path when possible.

The strategy constructs a `Request`, applies revocation/expiration checks, emits receive observations, and chooses immediate dispatch, timer scheduling for ETA, or a rate-limit bucket. Reserved and active requests are local worker state, separate from messages still in the broker and from stored results. Follow [task execution](../workflows/task-execution.md) for the pool/tracer and acknowledgement boundary.

## Concurrency is an adapter boundary

Pool aliases select prefork, threads, solo, eventlet, or gevent implementations; a custom adapter can be selected through `CELERY_CUSTOM_WORKER_POOL` and `--pool custom`. The prefork adapter uses Billiard-backed pools. Child initialization sets the active application, initializes loader/process hooks, finalizes tasks, rebuilds tracers, and enables the synchronous-subtask join guard.

The worker passes concurrency, time limits, maximum tasks per child, maximum memory per child, and process-loss settings to the pool. These are adapter capabilities: changing `--pool` changes process isolation, scheduling, and available timeout/termination behavior. Greenlet pools require early patching, which is why the executable patches concurrency before importing the umbrella CLI. Verify a pool's implementation and focused tests before relying on a prefork-specific behavior elsewhere.

## Prefetch, ETA, and reconnects

Initial prefetch is based on concurrency (or autoscale maximum) times `worker_prefetch_multiplier`. The task bootstep installs Kombu QoS and determines whether the broker uses global or per-consumer QoS. Quorum detection disables global QoS. `worker_eta_task_limit` is passed to the QoS wrapper as a maximum prefetch constraint for ETA scheduling.

`worker_disable_prefetch` has a Redis-specific implementation that limits consumption using reserved requests and available pool capacity; other broker transports log a warning and ignore it. It is not a transport-independent switch.

On recoverable connection errors the consumer tears down connection services and restarts its blueprint. Startup retry policy can differ from retry after an established connection; `broker_channel_error_retry` determines whether channel errors enter the recoverable set. `worker_cancel_long_running_tasks_on_connection_loss`, when enabled, terminates eligible active late-acknowledged tasks because the original channel cannot acknowledge them.

Prefetch reduction after reconnect is conditional. This checkout skips reduction and restores the maximum count when recorded `qos_global` is false: per-consumer broker QoS cannot support the gradual live restoration mechanism. With global QoS, active work can reduce the initial count and acknowledgement/rejection callbacks gradually restore it.

## Shutdown and verification

Warm shutdown closes consumption and gracefully stops the blueprint/pool. Cold termination selects termination instead. The application's signal handlers also support a configured soft-shutdown wait before cold shutdown; inspect `wait_for_soft_shutdown()` and signal handling together when changing deployment stop timeouts. A graceful shutdown path does not establish exactly-once task execution: [acknowledgement and redelivery policy](../workflows/task-execution.md) still controls unfinished messages.

Read [worker controller](../../celery/worker/worker.py), [blueprints](../../celery/bootsteps.py), [components](../../celery/worker/components.py), [consumer](../../celery/worker/consumer/consumer.py), and [task QoS setup](../../celery/worker/consumer/tasks.py). Tests under [worker tests](../../t/unit/worker/test_worker.py), [consumer tests](../../t/unit/worker/test_consumer.py), [strategy tests](../../t/unit/worker/test_strategy.py), and [prefork tests](../../t/unit/concurrency/test_prefork.py) isolate these contracts. Use [operations and monitoring](../operations/monitoring-control.md) to inspect a running worker.
