---
type: architecture
title: "Task Execution: Strategy, Request and Tracing"
description: What happens to a task message inside a worker — the default strategy (protocol conversion, revocation, ETA and rate limiting), the Request object and its pool callbacks, acknowledgement semantics (early ack, acks_late, reject, requeue, worker lost, time limits), revocation and termination, and the tracer that runs the task, maps exceptions to states, dispatches callbacks and stores results.
tags: [worker, execution, request, tracer, acks-late, time-limits]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T09:27:53.075Z
sources:
  - id: openwiki-source-3795aa577fa7b0f3bd2af81a
    resource: repo://celery/app/task.py
  - id: openwiki-source-4a982797c89fcb3ea5c5d0ee
    resource: repo://celery/app/trace.py
  - id: openwiki-source-328c66e40eb163230ad26cbc
    resource: repo://celery/worker/request.py
  - id: openwiki-source-5b05690e7e13e9bff2a56054
    resource: repo://celery/worker/strategy.py
generated: { by: "claude-code", at: "2026-11-15T09:27:53.075Z" }
---

# Task Execution: Strategy, Request and Tracing

This page follows a message from the moment the consumer dispatches it (see [Worker Consumer and Event Loop](consumer.md)) until its result is stored. Three modules cooperate:

- `celery/worker/strategy.py` — per-task **strategy**: admits a message into the worker.
- `celery/worker/request.py` — **`Request`**: one task invocation inside the worker process (parent side), owning ack/reject and pool callbacks.
- `celery/app/trace.py` — the **tracer**: runs the task body (in the pool child for prefork) and records the outcome.

## 1. Strategy (`default`)

`Task.start_strategy()` instantiates `task.Strategy` (default `celery.worker.strategy:default`) once per task when the consumer starts. It pre-binds hot-path lookups and creates a task-specific `Request` subclass via `create_request_cls`. For each message, `task_message_handler`:

1. Normalises the payload to protocol v2 `(args, kwargs, embed)` + headers. v2 bodies are **not decoded here** (`decoded=False`) — decoding is deferred to the pool child. v1 and hybrid messages are converted (`proto1_to_proto2`, `hybrid_to_proto2`), raising `InvalidTaskError` for missing args or non-mapping kwargs.
2. Builds the `Request` with ack/reject promises from the consumer and logs "Received task".
3. Drops it immediately if expired or in the revoked set (`req.revoked()` acks the message and marks it `REVOKED`).
4. Sends `task_received` and a `task-received` event.
5. ETA/countdown: converts `eta` to a timestamp (invalid ETAs are logged and rejected without requeue), increments prefetch (`qos.increment_eventually()`) and schedules `apply_eta_task` on the timer — or the rate-limit path if the task also has a bucket.
6. Rate limit: puts the request into the task's token bucket.
7. Otherwise: `task_reserved(req)`, runs `on_task_message` callbacks (e.g. autoscaler), and calls `handle(req)` = `WorkController.process_task`.

## 2. Request and the pool

`WorkController._process_task(req)` calls `req.execute_using_pool(pool)` (the semaphore-guarded variant `_process_task_sem` is used with prefork + event loop). It:

- Raises `TaskRevokedError` (swallowed by the worker) if revoked meanwhile.
- Takes hard/soft time limits from the message `timelimit` header, falling back to the task's `time_limit`/`soft_time_limit` (which default to `task_time_limit`/`task_soft_time_limit`).
- Submits `fast_trace_task` (when `setup_worker_optimizations` ran) or `trace_task_ret` with `(task_name, id, request_dict, body, content_type, content_encoding)` and callbacks `on_accepted`, `on_success`, `on_failure`, `on_timeout`.

`Request.execute()` is the in-process variant used by some tools; it acks early (unless `acks_late`), runs `trace_task` synchronously and acks or rejects based on the outcome.

### Pool callbacks

| Callback | When | Behaviour |
| --- | --- | --- |
| `on_accepted(pid, time)` | A pool worker starts the job | Records `worker_pid`/`time_start`, `task_accepted()` (moves to active set), **acks the message unless `acks_late`**, sends `task-started`; if a terminate was requested before start, terminates now |
| `on_success((failed, retval, runtime))` | Job returned | If the tracer reported failure, delegates to `on_failure`; else `task_ready(successful=True)`, ack if `acks_late`, `task-succeeded` event |
| `on_failure(exc_info)` | Job raised / worker lost | See below |
| `on_timeout(soft, timeout)` | Time limit hit | Soft: warning only (the task sees `SoftTimeLimitExceeded`). Hard: marks `FAILURE` with `TimeLimitExceeded`, calls `on_failure`/`after_return` hooks, `task_failure` signal and `task-failed` event (skipped during cold shutdown); with `acks_late`, acks if `acks_on_timeout` else rejects with requeue |

### Failure handling and acknowledgement (`Request.on_failure`)

- `Terminated` (task was revoked with terminate) → announced as revoked (unless already cancelled/revoked).
- `MemoryError` → re-raised in the worker.
- `Reject(requeue)` raised by the task → without requeue the failure is stored, `task_failure` and `task-failed` are emitted; then the message is rejected (requeued or not).
- `Ignore` → just acknowledged.
- `Retry` → `on_retry`: acks if `acks_late`, sends `task-retried` (the new message was already published by `Task.retry`).
- Other exceptions, with **`acks_late`**:
  - `WorkerLostError` and `reject_on_worker_lost` → reject **with requeue** (no failure event).
  - `TimeLimitExceeded` and not `acks_on_timeout` → reject with requeue.
  - Otherwise ack if `acks_on_failure` (default) else reject without requeue.
- Unless requeued, the failure is stored (`mark_as_failure`, also for `WorkerLostError` which the child couldn't record) and `task_failure` is sent; the `task-failed` event follows. During a cold shutdown (`should_terminate`), failure storage/events are suppressed.

Without `acks_late`, messages were already acked on accept, so a crash or worker loss means the task is **not** redelivered — at-most-once. With `acks_late`, a crash before ack leads to redelivery — at-least-once (tasks should be idempotent).

### Revocation, termination and cancellation

- `revoked()` checks expiry (`expires` passed → added to the revoked set), the revoked id set, and revoked stamped headers. If revoked, `_announce_revoked` marks the task `REVOKED` in the backend, sends `task-revoked` and the `task_revoked` signal, and **acks** the message.
- `terminate(pool, signal)` (remote `revoke(terminate=True)`) signals the pool process if the task has started, otherwise defers until `on_accepted`.
- `cancel(pool, emit_retry)` (shutdown / connection loss) terminates the job and announces `task-cancelled`, optionally recording a `RETRY` state.

## 3. Tracer (`celery/app/trace.py`)

### Entry points in the pool child

- `trace_task_ret(name, uuid, request, body, content_type, content_encoding)` decodes the body with `accept_content` (raising on disallowed content) and calls `trace_task(app.tasks[name], ...)`.
- `fast_trace_task(...)` does the same using the pre-localised registry/accept list set by `setup_worker_optimizations()` (which also installs a stack-protection patch on `Task.__call__` and sets `app.use_fast_trace_task`). If that setup never ran in a spawned process it raises a `RuntimeError` explaining how to fix it (e.g. on Windows prefork).
- Both return `(failed_flag, retval_or_repr, runtime)` to the parent.

### `build_tracer(name, task, ...)` → `trace_task(uuid, args, kwargs, request)`

Built once per task (and cached on `task.__trace__`), with hooks resolved only if the task overrides them (`before_start`, `on_success`, `after_return`) and signal sends skipped when there are no receivers. Per call:

1. Builds a `Context` from the request (`called_directly=False`), computing `ignore_result` and whether to publish results (`track_started` only stores `STARTED` when results aren't ignored and not eager).
2. **Deduplication**: when `acks_late` and `worker_deduplicate_successful_tasks` are on and the backend is persistent, a **redelivered** message whose id is already `SUCCESS` (locally cached or in the backend) is skipped. If the stored meta shows no children but the request has callbacks/chain, those are dispatched (once) so a crash between store and dispatch doesn't stall the workflow; dispatch failures raise `Reject(requeue=True)`.
3. Pushes the task and request onto the stacks; sends `task_prerun`; `loader.on_task_init`; optionally stores `STARTED`.
4. Calls `before_start`, then the task (`task.run`, or `task.__call__` if customised).
5. Outcome mapping:
   - `Reject` → state `REJECTED` (logged); `Ignore` → `IGNORED`; neither stores a result.
   - `Retry` → `RETRY`: `mark_as_retry`, `on_retry`, `task_retry` signal (errbacks not called).
   - Other `Exception` → `FAILURE`: `handle_failure` makes the exception picklable, `mark_as_failure` (which also propagates through chains/chords and calls errbacks — see [Canvas](../canvas/signatures-and-workflows.md#failure-propagation)), `on_failure`, `task_failure` signal.
   - Success → **first** dispatch link callbacks and the next chain step (`_dispatch_callbacks_and_chain`), **then** `mark_as_done` (so `result.children` is populated), then `on_success`, `task_success`, "Task succeeded" log. An `EncodeError` while storing turns into a failure.
6. `after_return` (except for ignored/rejected states), `task_postrun`, pop stacks, then `backend.process_cleanup()` and `loader.on_process_cleanup()` (non-eager).
7. Errors **outside** the task body are reported via `task_internal_error` and returned as an internal failure (re-raised in eager mode).

`Task.apply()` uses the same tracer with `eager=True` (see [Tasks](../app/tasks-and-registry.md#calling-a-task)).

## Worker state bookkeeping

`task_reserved` → `task_accepted` → `task_ready` (`celery/worker/state.py`) maintain `reserved_requests`, `active_requests`, `requests`, per-task totals and `successful_requests`; these feed `inspect active/reserved/stats`, autoscaling, `worker_disable_prefetch` and shutdown cancellation.

## Related tests

`t/unit/worker/test_strategy.py`, `test_request.py`, `test_revoke.py`; `t/unit/tasks/test_trace.py`; `t/unit/app/test_trace.py`; `t/integration/test_tasks.py`; `t/smoke/tests/test_tasks.py`.
