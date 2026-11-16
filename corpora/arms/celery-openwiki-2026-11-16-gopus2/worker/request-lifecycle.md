---
type: workflow
title: Task Request Lifecycle in the Worker
description: Step-by-step path of a task message inside the worker — strategy dispatch, Request creation, revocation/expiry checks, ETA and rate-limit scheduling, pool submission, acceptance and acknowledgement rules (acks_late, acks_on_failure/timeout, reject_on_worker_lost), time limits, failures and termination, and the global worker state that tracks reserved and active requests.
tags: [worker, request, strategy, acks-late, eta, rate-limit, revoke, time-limits, worker-state]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:05:29.073Z
sources:
  - id: openwiki-source-328c66e40eb163230ad26cbc
    resource: repo://celery/worker/request.py
  - id: openwiki-source-7a844ae59c546297a34da340
    resource: repo://celery/worker/state.py
  - id: openwiki-source-5b05690e7e13e9bff2a56054
    resource: repo://celery/worker/strategy.py
  - id: openwiki-source-12d3bd623a53e489a785c641
    resource: repo://celery/worker/worker.py
generated: { by: "claude-code", at: "2026-11-16T17:05:29.073Z" }
---

# Task Request Lifecycle in the Worker

This page follows a task message from the moment the [consumer](consumer.md) receives it until it is acknowledged. The main code is `celery/worker/strategy.py` (per-task message handler), `celery/worker/request.py` (`Request`), `celery/worker/state.py` (global bookkeeping) and the pool callbacks; execution inside the pool is covered in [Task Execution, Tracing and Retries](../tasks/execution-tracing-and-retries.md).

## 1. Strategy: message → Request

Each registered task has a strategy, by default `celery.worker.strategy.default`, created once per consumer start via `task.start_strategy(app, consumer)`. It builds a task-specific `Request` subclass (`create_request_cls`) with precomputed defaults (time limits, `acks_late`, event flags, trace function) and returns `task_message_handler(message, body, ack, reject, callbacks)`:

1. **Normalise protocol.** Protocol 2 messages keep the raw body (not decoded yet). Protocol 1 and "hybrid" messages are converted to protocol-2 form (`proto1_to_proto2`, `hybrid_to_proto2`).
2. **Create the `Request`** with `on_ack`/`on_reject` promises, the eventer and connection errors. Headers give id, name, ETA, expiry, time limits, root/parent ids etc. without unpickling arguments.
3. Log `Received task ...` (INFO).
4. **Revocation/expiry check** — if the request has `expires` or its id is in the revoked set, `req.revoked()` runs; if revoked or expired the request is announced as revoked (state `REVOKED` stored, `task-revoked` event, `task_revoked` signal, message **acked**) and processing stops.
5. Send `task_received` signal and a `task-received` event (if the task sends events).
6. **ETA/countdown** — the ETA is converted to a timestamp (an unconvertible ETA rejects the message without requeue). The consumer QoS is incremented (so other messages can still be prefetched while this one waits in memory) and the request is scheduled on the worker timer with `call_at(eta, apply_eta_task)`; if the task is also rate-limited it goes to the rate-limit bucket after the ETA instead.
7. **Rate limit** — with a bucket, `consumer._limit_task` queues it until a token is available.
8. Otherwise mark it **reserved** (`task_reserved`), run the consumer's `on_task_message` callbacks (e.g. autoscaler), and call the worker's `_process_task` (possibly guarded by the pool semaphore when the event loop is used).

Messages remain unacknowledged while waiting for ETA or rate limits; if the worker dies they are redelivered. ETA tasks therefore count toward broker visibility/ack timeouts (relevant for SQS/Redis `visibility_timeout`).

## 2. Submitting to the pool

`WorkController._process_task(req)` → `req.execute_using_pool(pool)`:

- Re-checks `revoked()` and raises `TaskRevokedError` (the worker then releases the semaphore slot).
- Calls `pool.apply_async(trace_fn, args=(task_name, id, request_dict, body, content_type, content_encoding), accept_callback=on_accepted, timeout_callback=on_timeout, callback=on_success, error_callback=on_failure, soft_timeout=..., timeout=..., correlation_id=id)`. Per-message time limits from the `timelimit` header override task defaults. `trace_fn` is `fast_trace_task` when worker optimizations are installed, else `trace_task_ret`.

## 3. Accepted

When a pool process starts the job, `on_accepted(pid, time_accepted)`:

- Records `worker_pid` and `time_start`, moves the request to **active** (`task_accepted`, updating per-task and total counters).
- **Acknowledges the message now unless `acks_late`** — so by default a task that crashes mid-run is *not* redelivered.
- Sends `task-started`. If a terminate was requested before the job started, it is applied now.

## 4. Completion paths

| Outcome (reported to parent) | Handler | Acknowledgement | State/events |
|-----------------------------|---------|-----------------|--------------|
| Success | `on_success` | ack if `acks_late` | `task_ready(successful=True)` (id added to `successful_requests`), `task-succeeded` event with runtime |
| Exception in task (already stored by the tracer in the child) | `on_success(failed=True)` → `on_failure(return_ok=True)` | see table below | `task-failed` event |
| `Retry` | `on_retry` | ack if `acks_late` | `task-retried` event |
| `Ignore` | `on_failure` | ack | — |
| `Reject(requeue)` | `on_failure` | reject (requeue per flag) | if not requeued: stored as `FAILURE`, `task_failure` signal, `task-failed` event |
| Process killed / lost (`WorkerLostError`) | `on_failure` | see below | stored as `FAILURE` unless requeued |
| Terminated by revoke (`Terminated`) | `on_failure` | ack (via revoke) | announced as revoked |
| `MemoryError` | `on_failure` | — | re-raised in the parent |

### `acks_late` failure policy

When `acks_late` is set, `on_failure` decides between ack and reject:

- `TimeLimitExceeded` uses `acks_on_timeout`; other failures use `acks_on_failure` (both default to the deprecated `acks_on_failure_or_timeout`, default `True`).
- **Requeue** if `reject_on_worker_lost` and the child process was lost, or for a timeout with `acks_on_timeout=False`. Requeued tasks are *not* marked as failed, and no `task-failed` event is sent.
- Otherwise ack if the flag is true, or reject *without* requeue if false (removes it from the prefetched queue without redelivery).

Failures that the child could not record (worker lost, or errors in the handler) are stored here with `mark_as_failure` and the `task_failure` signal. During a cold shutdown (`state.should_terminate`) failure reporting is suppressed.

### Time limits

- **Soft limit**: the pool raises `SoftTimeLimitExceeded` inside the task; `on_timeout(soft=True)` only logs a warning — the task may catch it and clean up.
- **Hard limit**: the pool kills the child; `on_timeout(soft=False)` marks the task `FAILURE` with `TimeLimitExceeded`, invokes `on_failure`/`after_return` hooks, the `task_failure` signal and a `task-failed` event, then (if `acks_late`) acks or requeues per `acks_on_timeout`.
- Limits come from `task_time_limit`/`task_soft_time_limit`, the task's attributes, per-call `time_limit`/`soft_time_limit`, or the `time_limit` control command. Hard limits require a pool that can kill work (prefork; gevent has its own timeout support) — see [Concurrency Pools](concurrency-pools.md).

## 5. Revocation and termination

- `revoked()` checks: an already-revoked flag, expiry (`maybe_expire` adds expired ids to the revoked set), membership of the id in `state.revoked`, and stamped headers matching `state.revoked_stamps`. It is evaluated on receipt (when relevant) and before execution, so revoking a task that is waiting for an ETA or sitting in the prefetch buffer prevents it from running.
- `terminate(pool, signal)` kills the running job's process (or defers until accepted) and announces it as revoked; `cancel(pool)` (used on connection loss for `acks_late` tasks) kills it and records a `RETRY` with "cancelled by Celery" so the redelivered message can run again.

See [Remote Control](remote-control.md) for the `revoke` command.

## Worker state (`celery/worker/state.py`)

Module-level, per-process structures shared by consumer, control commands and pool callbacks:

| Name | Meaning |
|------|---------|
| `requests` | id → Request for reserved/active requests |
| `reserved_requests` | WeakSet of requests received but not finished (includes active) |
| `active_requests` | WeakSet of requests running in the pool |
| `successful_requests` | LimitedSet (1000, 3 h) used for duplicate-delivery detection |
| `revoked` / `revoked_stamps` | LimitedSet (50 000, 3 h) of revoked ids; revoked stamp values |
| `total_count`, `all_total_count` | Per-task and overall counters for `stats` and heartbeats |
| `should_stop`, `should_terminate` | Shutdown flags checked by `maybe_shutdown()` in the event loop |

`Persistent` (enabled by `--statedb`) saves the revoked set (compressed) and the logical clock to a `shelve` file at shutdown and merges it on startup. `inspect active/reserved/scheduled` read these structures, and `on_close()` after a connection loss drops reserved-but-not-active requests because their delivery tags are no longer valid.

## Tests

- `t/unit/worker/test_strategy.py` — ETA, rate limits, revoked on receipt, protocol conversion.
- `t/unit/worker/test_request.py` — acceptance, ack policies, time limits, worker lost, revoke/terminate/cancel, stamped revocation.
- `t/unit/worker/test_state.py`, `test_revoke.py`.
- `t/smoke/tests/test_worker.py`, `t/smoke/tests/failover/` — acks_late and worker-kill behaviour with real workers.

## Related

- [Worker Consumer](consumer.md)
- [Task Execution, Tracing and Retries](../tasks/execution-tracing-and-retries.md)
- [Concurrency Pools](concurrency-pools.md)
