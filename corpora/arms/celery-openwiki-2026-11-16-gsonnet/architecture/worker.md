---
type: architecture
title: "Worker: Bootsteps, Consumer and Request Handling"
description: How a Celery worker is assembled and run — the bootstep dependency framework, WorkController and Consumer blueprints, the message-to-strategy-to-Request-to-pool path, ETA and rate-limit scheduling, prefetch/QoS, the event loops, connection-loss recovery, autoscale, global worker state, and ack/revoke/expiry handling.
tags: [celery, worker, bootsteps, consumer, strategy, request, qos, autoscale, event-loop]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:22:47.483Z
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
generated: { by: "claude-code", at: "2026-11-16T09:22:47.483Z" }
---

# Worker: Bootsteps, Consumer and Request Handling

The worker (`celery/worker/`) turns broker messages into pool executions. It is built from small **bootsteps** arranged in two nested **blueprints**: the `WorkController` blueprint (process-level services) and the `Consumer` blueprint (broker-connection-level services) that can be restarted independently when the connection is lost. See [[/openwiki/architecture/overview.md]] for where the worker sits and [[/openwiki/architecture/concurrency-pools.md]] for what runs the tasks.

## Bootstep framework (`celery/bootsteps.py`)

- A `Step` declares `requires` (other steps), an optional `name`/`label`, `conditional`/`include_if`, and lifecycle methods. `StartStopStep` adds `create/start/stop/terminate/close`; `ConsumerStep` creates kombu consumers. `last = True` forces a step to run last.
- A `Blueprint` collects step types from `default_steps` plus `app.steps['worker']` / `app.steps['consumer']` (the extension point for third-party steps), pulls in dependencies transitively (`_firstpass`), and **topologically sorts** them with a `DependencyGraph` (`_finalize_steps`). `apply(parent)` instantiates each step with the parent object and calls `include`, which for start/stop steps appends the created service to `parent.steps`.
- `start` runs steps in order, tracking `started`; `stop(parent, close, terminate)` closes, then stops/terminates steps in **reverse** order with `propagate=False` (errors are logged, not raised); a blueprint that never fully started just flips to `TERMINATE`. States are `RUN`, `CLOSE`, `TERMINATE`. `celery graph bootsteps` renders the graph via `StepFormatter`.

## WorkController (`celery/worker/worker.py`)

The blueprint's steps (`worker.py#L76-L90`, `components.py`): **Timer** (a `timer2` scheduler, used for ETA tasks and heartbeats), **Hub** (kombu event loop, included only when `use_eventloop`; also swaps threading locks for dummy locks), **Pool** (see the pools page), **Beat** (optional embedded beat, [[/openwiki/architecture/beat-scheduler.md]]), **StateDB** (persists revoked ids when `--statedb` is set), **Autoscaler** (conditional), and **Consumer**.

`__init__` initializes the loader, runs `on_before_init`/`setup_defaults`/`on_after_init`, selects queues (`-Q`/`-X`, `worker_direct`), imports `--include` modules, defaults concurrency to `cpu_count()`, decides whether to use the event loop (`should_use_eventloop`), sends `worker_init`, resolves the pool class and applies the blueprint. `start()` runs the blueprint; `WorkerTerminate` → `terminate`, other exceptions → critical log and stop with `EX_FAILURE`, `SystemExit` → stop with its code, `KeyboardInterrupt` → stop. `_process_task` hands a `Request` to the pool (`req.execute_using_pool`) and releases the semaphore if the request turns out to be revoked. The CLI's `Worker` subclass adds banner/logging/signal handling ([[/openwiki/architecture/cli.md]]).

## Consumer (`celery/worker/consumer/consumer.py`)

The consumer blueprint (`#L171-L189`) has steps **Connection**, **Mingle**, **Events**, **Gossip**, **Heart**, **Control** (pidbox), **Tasks**, **DelayedDelivery**, **Evloop** and **Agent**. Their dependency order guarantees the connection exists before events and control start, and that task consumption (`Tasks`) starts only after mingle has synced revokes (`requires = (Mingle,)`).

### Connection loss and restart

`Consumer.start` (`#L366-L407`) loops until the blueprint is stopped: each iteration starts the blueprint; on a recoverable broker error it consults `broker_connection_retry` (or `broker_connection_retry_on_startup` for the first connection attempt). If retry is disabled it raises `WorkerShutdown(1)`; `EMFILE` ("too many open files") raises `WorkerTerminate`. Otherwise it logs, collects and closes the broken connection with a bounded socket timeout, optionally **cancels active acks-late requests that haven't acked** when `worker_cancel_long_running_tasks_on_connection_loss` is set (they will be redelivered), and restarts only the consumer blueprint — **the pool is untouched**. A `restart_state(maxR=5, maxT=1)` guard logs "Frequent restarts detected" and sleeps if restarts are too frequent.

With `worker_enable_prefetch_count_reduction`, the consumer temporarily lowers its prefetch count after a reconnect by the number of active tasks (to avoid over-fetching while they finish) and restores it step by step as tasks ack, skipped when per-consumer QoS is in effect (`qos_global` false, e.g. quorum queues).

### The Tasks step and QoS

`Tasks.start` (`consumer/tasks.py`) updates the per-task strategies, sets the initial `basic.qos` prefetch count, creates the task consumer (`app.amqp.TaskConsumer` over the selected queues) with `on_decode_error`, and wraps `set_prefetch_count` in a `QoS` object capped by `worker_eta_task_limit`. `initial_prefetch_count` is `concurrency × prefetch_multiplier` (`max_prefetch_count`). `worker_disable_prefetch` (Redis only) refuses to fetch more than the number of free pool slots. `Consumer._update_prefetch_count` keeps the prefetch value in sync when the pool grows or shrinks (autoscale or remote control).

## From message to Request

`Consumer.create_task_handler` returns `on_task_received(message)` (`#L723-L775`):

1. Read the task name from `message.headers['task']` (protocol 2 — the body is **not** deserialized in the main process). With protocol 1 (no header) the body is decoded here; undecodable messages go to `on_decode_error`, others to `on_unknown_message`.
2. Look up the **strategy** for the task name: `strategies[type_]`; a missing entry → `on_unknown_task`, which logs the error, rejects the message (no requeue), marks the task failed in the backend with `NotRegistered`, emits `task-failed` and sends the `task_unknown` signal.
3. Call the strategy with promise-wrapped `ack`/`reject` callbacks. `InvalidTaskError`/`ContentDisallowed` → `on_invalid_task`; `DecodeError` → `on_decode_error`.

`strategy.default` (`celery/worker/strategy.py#L99-L209`) is built once per task type in `update_strategies` (closing over the task, consumer, event dispatcher, rate-limit bucket...) as a micro-optimization. For each message it:

- converts protocol 1/hybrid bodies to the v2 shape (`proto1_to_proto2`, `hybrid_to_proto2`);
- creates a `Request` (the task's `Request` class, wired to the pool, hostname and eventer);
- logs receipt and, if the task is **already revoked or expired** (`req.expires` or id in `revoked_tasks` and `req.revoked()`), drops it;
- sends `task_received` signal and, when enabled, the `task-received` event;
- computes the ETA as a timestamp (a bad ETA rejects the message without requeue);
- chooses a path:
  - **ETA + rate limit**: `consumer.qos.increment_eventually()` (reserve a prefetch slot) then `timer.call_at(eta, limit_post_eta, ...)`;
  - **ETA only**: `timer.call_at(eta, apply_eta_task, (req,), priority=6)` — the message is held *unacknowledged* in worker memory until its ETA, which is why large countdowns inflate prefetch (hence `worker_eta_task_limit`);
  - **rate limit only**: `_limit_task` adds it to the task's `TokenBucket` (`bucket_for_task`: `rate_limit`, capacity 1) and `_schedule_bucket_request` releases requests as tokens become available, rescheduling the head of the queue if there are none;
  - otherwise `task_reserved(req)` and `handle(req)` → `WorkController._process_task` → pool.

## Request (`celery/worker/request.py`)

`Request` wraps the message and tracks execution: `execute_using_pool` submits the trace function to the pool with callbacks (`on_accepted`, `on_success`, `on_failure`, `on_timeout`), and `execute` is the in-process variant. Its lifecycle handling is where **acknowledgement semantics** live:

- By default the message is acked in `on_accepted` (when a pool child *starts* the task — "early ack"). With `acks_late` it is acked after the result is stored (`on_success`, `on_retry`, and in `on_failure` per `acks_on_failure_or_timeout`/`reject_on_worker_lost`).
- `revoked()` discards a request that is expired, in `revoked_tasks`, or whose stamp matches a revoked header, announces it (`task-revoked`, `task_revoked` signal) and returns true. Expiry marks the id as revoked.
- `terminate`/`cancel` kill a running job via `pool.terminate_job` (or remember to do so once the task is accepted), used by `revoke(terminate=True)` and by connection-loss cancellation.
- `on_failure` handles `Terminated`, `Reject` (a non-requeued reject now stores a terminal FAILURE), `Ignore`, `Retry`, `WorkerLostError` and time-limit failures, then stores/announces failure and signals.
- `on_timeout` logs soft-limit warnings and records `TimeLimitExceeded` for hard limits.

## Global worker state (`celery/worker/state.py`)

Process-wide registries: `requests` (id→Request), `reserved_requests` and `active_requests` (weak sets), `successful_requests` and `revoked` (`LimitedSet`s bounded by `CELERY_WORKER_SUCCESSFUL_MAX`/`CELERY_WORKER_REVOKES_MAX`, expiring after ~3 hours by default), `revoked_stamps`, and counters. `task_reserved`, `task_accepted` and `task_ready` maintain them; `maybe_shutdown` raises `WorkerTerminate`/`WorkerShutdown` when the `should_terminate`/`should_stop` flags are set (set by signal handlers) and is called every loop iteration. With a `statedb`, the `Persistent` wrapper stores revoked ids in a shelve file and merges them back on startup. `inspect active/reserved/scheduled` read from these structures ([[/openwiki/architecture/events-and-monitoring.md]]).

## Event loops (`celery/worker/loops.py`)

- **`asynloop`** (default with a hub): registers consumers and the pool's file descriptors on the kombu hub, starts AMQP heartbeats via `hub.timer`, verifies the pool started (`did_start_ok`), drains pending messages, then iterates the hub loop. It checks `maybe_shutdown()` and heartbeat errors each iteration and **only updates QoS when there are no more messages to read**, which batches `basic.qos` calls and lets control commands take priority over task messages. On error it resets the hub and clears stale timers before re-raising so the reconnect starts clean.
- **`synloop`**: fallback for transports/pools without async I/O (gevent/eventlet, or when `worker_pool` is green): blocking `connection.drain_events(timeout=2.0)` plus `perform_pending_operations`. Ack/reject callbacks use `call_soon_ack`, which runs immediately instead of waiting for the next iteration, avoiding added latency with `acks_late` and prefetch 1.

## Autoscale (`celery/worker/autoscale.py`)

`--autoscale=max,min` enables an `Autoscaler` (a background thread, or timer-driven on the event loop) that compares the number of in-flight requests (`qty`) with the pool's process count: it grows up to `max_concurrency` immediately and shrinks toward `min_concurrency` only after the `keepalive` (30s by default) since the last scale-up, calling `pool.maintain_pool()` and updating the consumer's prefetch count. `autoscale`, `pool_grow` and `pool_shrink` control commands adjust it at runtime.

## Remote control

The `Control` consumer step wires the pidbox (`celery/worker/control.py`, `pidbox.py`) — see [[/openwiki/architecture/events-and-monitoring.md]].

## Key tests

`t/unit/worker/` covers each part: `test_bootsteps.py`, `test_consumer.py`, `test_strategy.py`, `test_request.py`, `test_loops.py`, `test_autoscale.py`, `test_state.py`, `test_revoke.py` and `test_native_delayed_delivery.py`; `t/integration/test_worker.py` and `test_connection_recovery.py` exercise real brokers. See [[/openwiki/operations/testing.md]].
