---
type: architecture
title: Worker Consumer, Strategies and Requests
description: How the worker's Consumer connects to the broker, consumes task messages under prefetch/QoS control, dispatches them through per-task strategies into Request objects, handles ETA, rate limits, revocation, acknowledgement and failure, and recovers from connection loss.
tags: [worker, consumer, qos, prefetch, request, strategy, eta, connection-recovery]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:57:55.789Z
sources:
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-ac404435efa758dad4bbfc83
    resource: repo://celery/app/defaults.py
  - id: openwiki-source-3795aa577fa7b0f3bd2af81a
    resource: repo://celery/app/task.py
  - id: openwiki-source-94b60a38fd26082deb41f979
    resource: repo://celery/worker/consumer/consumer.py
  - id: openwiki-source-e05a13d8343387f57526f632
    resource: repo://celery/worker/consumer/delayed_delivery.py
  - id: openwiki-source-337ca17b51d3603b5a2c09ec
    resource: repo://celery/worker/consumer/tasks.py
  - id: openwiki-source-1a5a653f1e0dc794a3d6d553
    resource: repo://celery/worker/loops.py
  - id: openwiki-source-328c66e40eb163230ad26cbc
    resource: repo://celery/worker/request.py
  - id: openwiki-source-5b05690e7e13e9bff2a56054
    resource: repo://celery/worker/strategy.py
generated: { by: "claude-code", at: "2026-11-16T06:57:55.789Z" }
---

# Worker Consumer, Strategies and Requests

The **Consumer** (`celery/worker/consumer/consumer.py`) is the part of the
worker that talks to the broker. It is created by the worker's `Consumer`
bootstep and is itself a [bootsteps](worker-bootsteps.md) blueprint. It
receives task messages, turns them into `Request` objects
(`celery/worker/request.py`) through *strategies* (`celery/worker/strategy.py`)
and hands them to the worker for execution in the
[pool](concurrency-pools.md).

## Consumer blueprint

Default consumer steps, in dependency order:

| Step | Module | Responsibility |
|------|--------|----------------|
| `Connection` | `consumer/connection.py` | Open the broker connection (`connection_for_read`) with retry |
| `Mingle` | `consumer/mingle.py` | On startup ask other workers (`hello`) for their logical clock and revoked ids; only for `amqp`, `redis`, `gcpubsub` transports; disable with `--without-mingle` |
| `Events` | `consumer/events.py` | Create the `EventDispatcher` ([events](../remote-control-and-events.md)) |
| `Gossip` | `consumer/gossip.py` | Subscribe to other workers' `worker-*` events for clock sync, leader election and node join/leave callbacks; `--without-gossip` |
| `Heart` | `consumer/heart.py` | Send `worker-heartbeat` events; `--without-heartbeat` |
| `Control` | `consumer/control.py` | Start the remote-control pidbox (`Pidbox` or `gPidbox`) |
| `Tasks` | `consumer/tasks.py` | Build strategies, set QoS, start the task consumer |
| `DelayedDelivery` | `consumer/delayed_delivery.py` | Only when quorum queues are detected: declare RabbitMQ native delayed-delivery exchanges and bind queues |
| `Evloop` | `consumer/consumer.py` | Run the consume loop (last step) |
| `Agent` | `consumer/agent.py` | Optional `cell` actor agent (`worker_agent`) |

Extensions can add steps via `app.steps['consumer']`.

### Start and connection recovery

`Consumer.start()` loops `blueprint.start(self)` until the blueprint is
stopped. When a *recoverable* error escapes (connection errors, plus channel
errors if `broker_channel_error_retry`):

- if retry is disabled (`broker_connection_retry_on_startup` for the first
  attempt — when set — otherwise `broker_connection_retry`), the worker
  raises `WorkerShutdown(1)`;
- `EMFILE` (too many open files) raises `WorkerTerminate(1)`;
- otherwise it logs, closes the broken connection, optionally cancels
  unacknowledged `acks_late` tasks
  (`worker_cancel_long_running_tasks_on_connection_loss`; they are marked
  for retry because their message will be redelivered), temporarily reduces the
  prefetch count by the number of active requests
  (`worker_enable_prefetch_count_reduction`; skipped with per-consumer QoS such
  as quorum queues), and calls `blueprint.restart()`.
- `restart_state(maxR=5, maxT=1)` detects restart storms and sleeps 1 s when
  restarts are too frequent.

After reconnecting, each ack/reject of an in-flight task gradually raises the
prefetch count back to the maximum
(`_restore_prefetch_count_after_connection_restart`).

## QoS and prefetch

The `Tasks` step sets `basic_qos(prefetch_count=initial_prefetch_count)` and
wraps it in a kombu `QoS` object:

- `initial_prefetch_count = concurrency × worker_prefetch_multiplier`
  (default multiplier **4**); a multiplier of 0 disables the limit.
- Global vs per-consumer QoS is detected (`qos_global`); quorum queues need
  per-consumer QoS.
- ETA/countdown tasks are held in worker memory, so the strategy calls
  `qos.increment_eventually()` for each one (and `apply_eta_task`
  decrements it when it runs) so they do not block new deliveries.
  `worker_eta_task_limit` caps this increase.
- `worker_disable_prefetch` (Redis only) patches the channel's `can_consume`
  so the worker fetches no more messages than it has free pool slots.
- Autoscaling and pool grow/shrink adjust prefetch through
  `_update_prefetch_count`.

QoS updates are batched: the event loop applies `qos.update()` only when the
value changed, between reads.

## Event loops

`celery/worker/loops.py` provides two loops chosen at construction:

- **`asynloop`** – used when the worker has a kombu `Hub` (prefork/solo/threads
  on asynchronous transports). It installs `on_task_received` as the
  consumer's `on_message`, registers the controller and consumer with the hub,
  starts consuming, verifies pool children started (`did_start_ok`,
  otherwise `WorkerLostError`), enables AMQP heartbeat checks, and iterates
  `hub.create_loop()` while running. On an exception it resets the hub and
  clears stale timers before the error propagates to the restart logic.
- **`synloop`** – blocking `connection.drain_events(timeout=2.0)` loop used
  by green pools and transports without async support; deferred callbacks
  are run between drains via `perform_pending_operations`. Ack/reject
  callbacks use `call_soon_ack`, which executes immediately in this mode to
  avoid latency with `acks_late` and prefetch 1.

## Message dispatch

`Consumer.create_task_handler()` returns `on_task_received(message)`:

1. Reads `message.headers['task']` (protocol v2). If headers lack it, the
   body is decoded as protocol v1; undecodable messages go to
   `on_decode_error`, and malformed ones to `on_unknown_message` (rejected,
   `task_rejected` signal).
2. Looks up `strategies[name]`. Missing → `on_unknown_task`: logs, rejects
   the message, **stores a `NotRegistered` failure** in the backend, sends a
   `task-failed` event and the `task_unknown` signal.
3. Calls the strategy with `ack` / `reject` promises. `InvalidTaskError` or
   `ContentDisallowed` → `on_invalid_task` (rejected).

`update_strategies()` builds, for every registered task,
`strategies[name] = task.start_strategy(app, consumer)` and
`task.__trace__ = build_tracer(...)`. `Task.Strategy` defaults to
`celery.worker.strategy:default`, so the strategy is a per-task-class
extension seam.

### Default strategy

`strategy.default` (`celery/worker/strategy.py`) creates a specialised
`Request` subclass per task (`create_request_cls`) and returns
`task_message_handler`, which:

1. converts hybrid/v1 messages to v2 if needed and builds the `Request`;
2. logs `Received task`;
3. returns early if the request is expired or its id is in the revoked set
   (`req.revoked()` marks it `REVOKED` and acks);
4. sends `task_received` and, if enabled, the `task-received` event;
5. **ETA**: converts `req.eta` to a timestamp (bad ETAs are rejected without
   requeue), increments QoS, and schedules `apply_eta_task` on the worker
   timer — or `_limit_post_eta` if a rate limit also applies;
6. **rate limit**: if the task has a `TokenBucket` (from `rate_limit`, unless
   `--without-rate-limits`), `_limit_task` queues the request in the bucket
   and schedules it on the timer when tokens are available;
7. otherwise marks the request reserved (`task_reserved`), runs
   `on_task_message` callbacks (e.g. autoscaler) and calls
   `on_task_request` → `WorkController._process_task` →
   `req.execute_using_pool(pool)`.

## Request lifecycle

`Request` wraps the message without deserializing the body in the parent
(protocol v2 keeps args/kwargs serialized until the pool child runs
`trace_task`). Key transitions:

| Callback | When | Effect |
|----------|------|--------|
| `execute_using_pool` | before submit | Raises `TaskRevokedError` if revoked; submits `trace_task_ret` (or `fast_trace_task`) with time limits from the message or task |
| `on_accepted(pid, t)` | child started the job | Records pid/start time, `task_accepted`, **acks unless `acks_late`**, sends `task-started`, applies a pending terminate |
| `on_success` | job returned | If the tracer reports failure, delegates to `on_failure`; else `task_ready`, ack if `acks_late`, `task-succeeded` event |
| `on_failure` | job raised / child lost | See below |
| `on_timeout(soft, t)` | time limit hit | Soft: warning; hard: mark `FAILURE` with `TimeLimitExceeded` and run failure hooks |
| `terminate` / `cancel` | revoke / connection loss | Kill the child job; announce `REVOKED` or (cancel) `RETRY` |

`on_failure` decides acknowledgement:

- `Terminated` → announce revoked (if not already).
- `Reject(requeue)` → reject/requeue; without requeue also store `FAILURE`.
- `Ignore` → ack. `Retry` → `on_retry` (event only; the retry message was
  already published by the task).
- With `acks_late`: if the worker was lost and `task_reject_on_worker_lost`,
  or a time limit hit and `task_acks_on_timeout` is false → **reject with
  requeue** (no failure stored); else ack if `task_acks_on_failure` (or
  `task_acks_on_timeout` for time limits) is true — both fall back to
  `task_acks_on_failure_or_timeout`, default true — or reject without
  requeue.
- Otherwise the failure is stored (`mark_as_failure`) when the child could
  not store it (worker lost / failure outside the tracer), and
  `task_failure` plus `task-failed` are emitted.

`Request.execute()` is the in-process variant used by tests and
`celery.contrib.testing`; it acks before or after `trace_task` according to
`acks_late`.

## Native delayed delivery (quorum queues)

RabbitMQ quorum queues do not support the global QoS increments that ETA
handling relies on. When `detect_quorum_queues` finds quorum queues:

- the `DelayedDelivery` consumer step declares kombu's native delayed
  delivery exchanges/queues and binds each application queue
  (`broker_native_delayed_delivery_queue_type`: `classic` or `quorum`);
- on publish, `send_task` rewrites tasks with `countdown`/`eta` on
  non-direct exchanges to go through the `celery_delayed_27` topic exchange
  with a routing key encoding the delay
  (`kombu.transport.native_delayed_delivery.calculate_routing_key`), so the
  broker, not the worker, holds the message until it is due.

## Tests

- `t/unit/worker/test_consumer.py` – blueprint, restarts, prefetch reduction,
  unknown/invalid messages.
- `t/unit/worker/test_strategy.py`, `test_request.py`, `test_loops.py`,
  `test_native_delayed_delivery.py`, `test_revoke.py`.
- `t/integration/test_connection_recovery.py`,
  `t/smoke/tests/test_consumer.py`, `t/smoke/tests/quorum_queues/`.

See also: [Execution tracing](task-execution-trace.md),
[Remote control and events](../remote-control-and-events.md).
