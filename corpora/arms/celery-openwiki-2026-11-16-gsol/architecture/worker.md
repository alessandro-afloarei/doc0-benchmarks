---
type: architecture
title: Worker lifecycle and concurrency
description: Worker bootsteps, pool ownership, consumer dispatch, prefetch accounting, broker reconnection and shutdown behavior.
tags: [worker, concurrency, bootsteps, operations]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:34:04.042Z
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
generated: { by: "codex", at: "2026-11-16T06:34:04.042Z" }
---

# Worker lifecycle and concurrency

The worker has two nested lifecycles. `WorkController` owns process resources such as the pool, timer, hub and consumer. The consumer owns broker-facing services, including its connection, task consumer, events, heartbeats and remote control. This split lets broker services restart without constructing a new application or treating each reconnect as a fresh worker process.

## Dependency-ordered startup

`celery/bootsteps.py` builds a dependency graph from each step's `requires`, adds transitive dependencies and topologically sorts it. Steps are constructed and included in that order. Start follows the resulting list; stop and terminate normally traverse it in reverse. Optional steps can decline inclusion.

Worker steps are defined in `celery/worker/components.py`; the consumer blueprint lists its services in `celery/worker/consumer/consumer.py`. Add extensions through `app.steps['worker']` or `app.steps['consumer']` and declare resource dependencies explicitly. A step using the pool must require the pool step rather than relying on incidental ordering.

## Receiving work and choosing a pool

At task-consumer startup, `update_strategies()` builds one strategy and execution tracer per registered task. Protocol v2 dispatch reads the task name from headers, allowing body deserialization to be deferred to pool execution. A missing task name in the registry takes the unknown-task failure path; importing code on a producer does not register it in an already-running worker.

The strategy checks revocation and expiry, schedules ETA work through the timer, applies task rate limits and passes eligible requests to the controller. The request then submits work through the selected pool; [execution and acknowledgements](../workflows/execution.md) explains its callbacks.

Pool aliases include `prefork`, `solo`, `threads`, `eventlet` and `gevent`. Prefork wraps Billiard's multiprocessing pools. Pool capabilities differ, so test changes against the pool that will execute them. Green pools need `-P eventlet` or `-P gevent` on the command line so patching happens early; worker configuration explicitly warns against selecting them too late. Embedded beat is rejected for these green pools.

## Prefetch and reconnects

The ordinary maximum prefetch count is pool size multiplied by `worker_prefetch_multiplier`. The task-consumer step installs broker QoS and maintains an ETA-aware `QoS` object using `worker_eta_task_limit`. `worker_disable_prefetch` adds a reservation-capacity check for Redis brokers; other transports log a warning and ignore that setting.

Recoverable connection failures restart the consumer blueprint. `broker_connection_retry_on_startup` controls initial connection retry when explicitly set; otherwise the consumer uses `broker_connection_retry`. Channel errors enter this recovery path only when `broker_channel_error_retry` is enabled.

On connection loss, `worker_cancel_long_running_tasks_on_connection_loss` can cancel active, unacknowledged late-acknowledged requests. With prefetch reduction enabled, the consumer accounts for active work while restoring QoS after reconnect. This checkout explicitly skips reduction for per-consumer QoS, because updates cannot safely restore existing consumers in that mode. Reconnect behavior must therefore be tested with the broker's effective QoS mode, especially quorum queues.

## Shutdown and validation

`WorkController.stop()` initiates warm shutdown; `terminate()` initiates cold shutdown. Both close consumption first, then stop or terminate the blueprint. Prefork's graceful stop closes and joins its pool and keeps hub timers firing while the pool drains. The controller also exposes a bounded soft-shutdown wait through `worker_soft_shutdown_timeout`, with an idle opt-in for cases such as pending ETA work.

Use `t/unit/worker/test_bootsteps.py`, `test_components.py`, `test_consumer.py`, `test_worker.py`, and `test_autoscale.py` for focused checks. Broker disconnects and process termination also need [integration or smoke tests](../testing/development.md). For live diagnosis, follow [monitoring and control](../operations/monitoring.md).
