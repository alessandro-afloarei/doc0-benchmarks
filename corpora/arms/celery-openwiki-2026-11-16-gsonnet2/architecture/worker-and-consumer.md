---
type: architecture
title: Worker, Bootsteps and Consumer
description: How a Celery worker is assembled from bootsteps (WorkController and Consumer blueprints), how messages flow from the broker through strategy and Request into the pool, and how ETA, rate limits, prefetch/QoS, acknowledgements, autoscale, reconnection and shutdown behave.
tags: [celery, worker, bootsteps, consumer, qos, prefetch, acks, shutdown, autoscale]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:56:17.091Z
sources:
  - id: openwiki-source-7c9db0d3259470539a2d0756
    resource: repo://celery/bootsteps.py
  - id: openwiki-source-e160c8ef896234d60dbce1c5
    resource: repo://celery/worker/autoscale.py
  - id: openwiki-source-cd5b25b412e425989370ceb9
    resource: repo://celery/worker/components.py
  - id: openwiki-source-94b60a38fd26082deb41f979
    resource: repo://celery/worker/consumer/consumer.py
  - id: openwiki-source-337ca17b51d3603b5a2c09ec
    resource: repo://celery/worker/consumer/tasks.py
  - id: openwiki-source-1a5a653f1e0dc794a3d6d553
    resource: repo://celery/worker/loops.py
  - id: openwiki-source-328c66e40eb163230ad26cbc
    resource: repo://celery/worker/request.py
  - id: openwiki-source-7a844ae59c546297a34da340
    resource: repo://celery/worker/state.py
  - id: openwiki-source-5b05690e7e13e9bff2a56054
    resource: repo://celery/worker/strategy.py
  - id: openwiki-source-12d3bd623a53e489a785c641
    resource: repo://celery/worker/worker.py
generated: { by: "claude-code", at: "2026-11-16T17:56:17.091Z" }
---

# Worker, Bootsteps and Consumer

The worker is the long-running process that consumes task messages and runs them. It is built from two layers of *bootsteps*, small start/stop components arranged in a dependency graph:

- **`WorkController`** (`celery/worker/worker.py`) is the process-level service: timer, event loop hub, pool, optional embedded beat, state DB, autoscaler, and the consumer.
- **`Consumer`** (`celery/worker/consumer/consumer.py`) is the broker-facing service. It owns the broker connection and is restarted as a whole whenever the connection drops.

`celery.apps.worker.Worker` subclasses `WorkController` to add banner, logging and signal handlers (see [CLI and process management](cli-and-process-management.md)).

## Bootsteps (`celery/bootsteps.py`)

A `Blueprint` collects `Step` classes by dotted name. Each step lists `requires` (other steps). `Blueprint.apply` loads all steps, closes over their transitive requirements (`_firstpass`), builds a `DependencyGraph` and topologically sorts it. A step marked `last = True` is made to depend on all others, so it starts last. Steps are instantiated and then `include`d, which skips them if `enabled` or `include_if` says no.

Lifecycle operations are broadcast with `send_all`: `start` runs in order, while `stop`, `close`, `terminate` and `shutdown` run in reverse. During a stop, one failing step is logged but does not prevent the others from running (`propagate=False`). `Blueprint.stop` returns early if the blueprint did not finish starting. `StartStopStep` is the common base (the created object gets `start`/`stop`/`terminate`), and `ConsumerStep` additionally manages kombu consumers on a channel. Apps and plugins add steps with `app.steps['worker']` and `app.steps['consumer']`.

### WorkController steps

`WorkController.Blueprint.default_steps` (`celery/worker/worker.py`):

| Step | Module | Role |
|---|---|---|
| `Timer` | `components.py` | Scheduler for ETA tasks, heartbeats, and periodic work. Uses a hub-integrated timer when an event loop is used, otherwise the pool's timer class. |
| `Hub` | `components.py` | Creates the kombu event loop (only when `use_eventloop`). Replaces some locks with dummy ones, since all work is on one thread. |
| `Pool` | `components.py` | Builds the execution pool; see [Concurrency pools](concurrency-pools.md). |
| `Beat` | `components.py` | Optional embedded beat (`-B`); see [Beat scheduler](beat-scheduler.md). |
| `StateDB` | `components.py` | Persists revoked ids and the clock between restarts (`--statedb`), saved at exit. |
| `Autoscaler` | `autoscale.py` | Optional pool grow/shrink. |
| `Consumer` | `components.py` | `last = True`. Creates the `Consumer` with the initial prefetch count. |

`use_eventloop` is chosen by `should_use_eventloop`: default environment (not eventlet/gevent), a transport that implements asynchronous I/O, and not Windows. This single decision changes the pool type (AsynPool vs. thread-based), the QoS locking, and the consumer loop (`asynloop` vs. `synloop`).

### Consumer steps

`Consumer.Blueprint.default_steps`: `Connection`, `Mingle`, `Events`, `Gossip`, `Heart`, `Control`, `Tasks`, `DelayedDelivery`, `Evloop`, `Agent`. `Evloop` is `last`, so it starts the actual event loop after everything else has been set up. `Mingle`, `Gossip`, `Heart`, `Events` and `Control` are described in [Events and remote control](events-and-remote-control.md). `DelayedDelivery` sets up native delayed-delivery exchanges when quorum queues are in use.

`Connection.start` calls `Consumer.connect`, which obtains a read connection (with the AMQP heartbeat when an event loop is used) and registers it with the hub. `Tasks.start` does the following:

1. It calls `update_strategies()`, which builds one strategy per registered task and one tracer per task (`build_tracer`).
2. It sets the initial `basic_qos` prefetch.
3. It creates the task consumer with `app.amqp.TaskConsumer`.
4. It wraps the prefetch in a `QoS` object (`max_prefetch` from `worker_eta_task_limit`).

With `worker_disable_prefetch` (honoured only for Redis), it patches `can_consume` so a new message is not fetched while the reserved count equals the pool size.

## From message to pool

The consumer callback `create_task_handler().on_task_received` (see the code path in `consumer.py`):

1. Reads the `task` header (protocol 2). If it is missing, it decodes the body and tries protocol 1.
2. Looks up `strategies[task_name]`. Unknown messages and invalid or disallowed content are **rejected** (`on_unknown_message`, `on_invalid_task`). Unknown task names additionally mark the task `FAILURE` with `NotRegistered` in the backend and emit `task-failed`. Decode errors acknowledge the message so it is not redelivered forever.
3. Calls the strategy with promise-wrapped `ack` and `reject` functions, which may be deferred until a safe point in the loop.

The default strategy (`celery/worker/strategy.py::default`) builds a `Request` and then:

- discards the task if it is expired or revoked (`req.revoked()`), recording the revocation;
- sends the `task_received` signal and, if enabled, the `task-received` event;
- computes the ETA. A task with an ETA is **held on the worker timer** (`call_at(eta, apply_eta_task, ...)`) while counting against prefetch through `qos.increment_eventually`, so a worker is not flooded with far-future tasks (`worker_eta_task_limit` bounds this);
- applies the per-task-type `TokenBucket` rate limit (`rate_limit`): if no token is available the request is queued on the bucket and re-tried by the timer;
- otherwise calls `task_reserved(req)` (it enters `worker.state.requests` and `reserved_requests`) and hands the request to the controller's `process_task`.

`WorkController._process_task` calls `req.execute_using_pool(pool)`, which submits the tracer to the pool with the callbacks (see [Concurrency pools](concurrency-pools.md)). When a semaphore is used (`_process_task_sem`), it acquires a slot first and releases it when the job finishes, so the number of outstanding pool jobs is bounded.

### Request lifecycle (`celery/worker/request.py`)

`Request` wraps the message, parsed headers and lazily decoded body. It tracks the acknowledged flag and the process that runs it. Callbacks invoked from the pool:

- `on_accepted`: record start time and pid, call `task_accepted` (moves it to `active_requests`), **acknowledge unless `acks_late`**, emit `task-started`.
- `on_success`: if the tracer reported failure, delegate to `on_failure`; else `task_ready(successful=True)`, acknowledge if `acks_late`, emit `task-succeeded`.
- `on_failure`: branches on the exception. `Terminated` is announced as revoked. `Reject` stores a terminal `FAILURE` if not requeued, then rejects the message. `Ignore` acknowledges. `Retry` emits `task-retried`. For other failures the message is acknowledged or rejected depending on `acks_late`, `acks_on_failure` and `acks_on_timeout`, `reject_on_worker_lost` and whether the failure is a timeout or `WorkerLostError`. Failure then goes through the backend and signals.
- `on_timeout`: handles soft and hard time limits (`SoftTimeLimitExceeded`/`TimeLimitExceeded`).

Process-wide bookkeeping lives in `celery/worker/state.py`: `requests`, `reserved_requests` and `active_requests` (the latter two are weak sets), `successful_requests`, per-task counters, the bounded `revoked` set, and `should_stop`/`should_terminate` flags that signal handlers set and the loop polls (`maybe_shutdown` raises `WorkerShutdown` or `WorkerTerminate`).

## The event loop (`celery/worker/loops.py`)

`Evloop.start` calls `Consumer.loop`:

- **`asynloop`** is a non-blocking loop on the kombu hub. It enables AMQP heartbeats on the hub timer, sets `consumer.on_message` to the task handler, registers all steps' sockets with the hub (`register_with_event_loop`), starts consuming, verifies the pool started, and iterates the hub. Each iteration checks the shutdown flags and heartbeat errors. QoS updates are applied only when there are no more messages to read, which groups qos calls and lets control commands be handled ahead of tasks. If it dies by exception, the hub and its timers are reset so stale callbacks do not fire against a dead connection.
- **`synloop`** is the blocking fallback (`connection.drain_events(timeout=2)`), used for transports that are not asynchronous, and for the green pools. Green pools drive AMQP heartbeats from the timer.

## Connection loss and restart

`Consumer.start` loops `blueprint.start` until the blueprint reaches a stop condition:

- A recoverable error (connection errors, plus channel errors when `broker_channel_error_retry` is on) is handled according to `broker_connection_retry` (or `broker_connection_retry_on_startup` for the first attempt). If retries are disabled the worker shuts down with `WorkerShutdown(1)`. `EMFILE` ("too many open files") is fatal (`WorkerTerminate`).
- Otherwise it cleans up the dead connection with a bounded socket timeout, optionally cancels active `acks_late` requests that were not yet acknowledged (`worker_cancel_long_running_tasks_on_connection_loss`; their acknowledgement can no longer be sent on the dead channel, so the broker will redeliver them), and calls `on_close`. That clears the internal queues, token buckets and semaphore. Reserved requests that are not active are dropped, since their delivery tags belong to the dead channel. Then `blueprint.restart` re-runs the steps.
- A restart-frequency limiter logs "Frequent restarts detected" and sleeps to avoid hot loops.
- **Prefetch reduction.** After reconnection the broker redelivers unacked tasks. To avoid over-fetching while old tasks are still running, `worker_enable_prefetch_count_reduction` lowers the prefetch to `max_prefetch - active * multiplier` (not below the multiplier) and restores it gradually as tasks complete (`_restore_prefetch_count_after_connection_restart`). It is skipped for per-consumer QoS (quorum queues).

## Autoscale

`Autoscaler` (`celery/worker/autoscale.py`, enabled by `--autoscale=max,min`) compares `len(reserved_requests)` with the pool size. It grows toward `max_concurrency` immediately, and shrinks toward `min_concurrency` only after the `AUTOSCALE_KEEPALIVE` period (30 s by default) has passed since the last growth. In event-loop mode it is driven by `on_task_message` and a repeating hub timer, otherwise by a background thread. `update()` (used by the `autoscale` remote command) also adjusts the consumer's prefetch count. Pool resizing itself is done by `pool.grow` and `pool.shrink`.

## Shutdown

- **Warm** (`stop`, SIGTERM): closes the consumer, which stops receiving, runs the blueprint stop so the pool drains running tasks, then sends `worker_shutdown`.
- **Cold** (`terminate`, SIGQUIT or second Ctrl+C): terminates the pool.
- **Soft shutdown** (`worker_soft_shutdown_timeout > 0`): `wait_for_soft_shutdown` waits for that period before the cold shutdown proceeds, but only if there are active requests (or `worker_enable_soft_shutdown_on_idle` is set). If a second signal arrives while waiting, `Consumer.cancel_active_requests` cancels requests that are not late-acked (or are late-acked but not yet acknowledged and not already successful), and the hard-shutdown handler is installed. Late-acked tasks cancelled this way are not marked retried, as the broker redelivers them.
- `StateDB` saves revoked ids and the clock at exit (`atexit`).

## Tests

`t/unit/worker/` (`test_worker.py`, `test_consumer.py`, `test_request.py`, `test_strategy.py`, `test_autoscale.py`, `test_control.py`, `test_state.py`, `test_components.py`, `test_bootsteps.py`), `t/unit/test_loops.py`, `t/unit/contrib/test_worker.py` for the embedded test worker, plus `t/integration/test_worker.py`, `t/integration/test_connection_recovery.py` and `t/smoke/tests/test_worker.py`/`test_consumer.py`. See [Testing, CI and development workflow](../testing/test-strategy.md).
