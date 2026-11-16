---
type: workflow
title: Task Lifecycle End to End
description: Step-by-step trace of one task from delay() through the broker, the worker's strategy and Request, the pool child's tracer, result-backend writes, callbacks and chains, to acknowledgement — including retry, failure, reject, ignore, revoke, timeout and redelivery semantics and the signals fired at each step.
tags: [celery, workflow, task-lifecycle, tracer, acks, retry, signals]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:22:47.483Z
sources:
  - id: openwiki-source-4a982797c89fcb3ea5c5d0ee
    resource: repo://celery/app/trace.py
  - id: openwiki-source-328c66e40eb163230ad26cbc
    resource: repo://celery/worker/request.py
  - id: openwiki-source-5b05690e7e13e9bff2a56054
    resource: repo://celery/worker/strategy.py
generated: { by: "claude-code", at: "2026-11-16T09:22:47.483Z" }
---

# Task Lifecycle End to End

This page follows a single task through every component. Each stage links to the page that explains the component in depth.

```
client                 broker            worker main process                pool child                   backend
apply_async ─publish──▶ queue ──▶ Consumer.on_task_received ─▶ strategy ─▶ Request ─▶ pool.apply_async ─▶ trace_task ─▶ run()
                                                                               ▲            │                 │   │
                                                                  on_success/on_failure ◀──┘                  ▼   ▼
                                                                    ack, events, state                mark_as_done/…  callbacks/chain
```

## 1. Publish (client side)

1. `task.delay(...)` / `apply_async(...)` merges task-level options, checks arguments and time limits; `app.send_task` routes the message, builds the protocol-2 message and publishes it (signals `before_task_publish` / `after_task_publish`; optional `task-sent` event). Under `task_always_eager`, the task runs locally instead (see [[/openwiki/architecture/tasks.md]]).
2. Unless `ignore_result`, `backend.on_task_call` runs and an `AsyncResult(task_id)` is returned immediately — the task is `PENDING` as far as any backend is concerned (the backend has no record until a worker writes one).
3. Called inside another task, `root_id`/`parent_id` are stamped from the current task and the result is added to the parent's `children` trail.

The message header carries the task name, id, eta/expires, retries, time limits, root/parent/group ids, stamps and `ignore_result`; the body carries `(args, kwargs, {callbacks, errbacks, chain, chord})`.

## 2. Receive and schedule (worker main process)

4. The `Tasks` consumer step delivers the message to `Consumer.on_task_received`. The task name is read from headers; unknown tasks are rejected and marked failed (`NotRegistered`, signal `task_unknown`); undecodable messages are logged and acknowledged (see [[/openwiki/architecture/worker.md]]).
5. The per-task **strategy** creates a `Request`, drops revoked/expired tasks, fires `task_received` (+ `task-received` event) and then:
   - holds **ETA/countdown** tasks on the worker timer *unacknowledged*,
   - passes **rate-limited** tasks through a token bucket,
   - otherwise reserves the request (`task_reserved`) and submits it.
6. `WorkController._process_task` calls `Request.execute_using_pool`, which re-checks revocation and sends `trace_task_ret`/`fast_trace_task` plus the **undecoded** body to the pool with accept/success/failure/timeout callbacks and the soft/hard time limits (see [[/openwiki/architecture/concurrency-pools.md]]).

## 3. Execute (pool child)

7. The trace function decodes the body (with the app's accepted content types) and calls the task's **tracer** (`celery/app/trace.py`, `build_tracer`). `on_accepted` is invoked in the parent when the child picks up the job; this is where an early-ack task is acknowledged and the `task-started` event is sent.
8. `trace_task` (one deliberately long, unrolled function for speed) does, in order:
   1. Build a `Context` request (`called_directly=False`), resolve `ignore_result` (request overrides task) and `track_started`.
   2. **Redelivery de-duplication**: if `worker_deduplicate_successful_tasks` is on, the task is `acks_late`, the backend is persistent and the message is `redelivered`, a task already `SUCCESS` in the backend is not run again — missing callbacks/chain steps are dispatched from the stored result (only when `children` is empty, which requires extended results) and the message is acked. Dispatch failures raise `Reject(requeue=True)`.
   3. Push task and request on the thread-local stacks; send `task_prerun`; call `loader.on_task_init`; if `track_started`, store `STARTED` with pid/hostname.
   4. Call `before_start`, then the task body `fun(*args, **kwargs)` (`task.run`, or `__call__` when overridden).
9. Outcomes:

| Outcome | State | What happens |
|---|---|---|
| returns | `SUCCESS` | **Callbacks (`link`) and the next chain step are sent first**, then `backend.mark_as_done` stores the result (so `children` is populated), then `on_success`, `task_success` signal and a success log line. An encoding error while storing is turned into a failure. |
| raises `Retry` | `RETRY` | `mark_as_retry`, `on_retry`, `task_retry` signal; no errbacks. |
| raises an exception | `FAILURE` | `handle_failure`: exception made pickleable, `backend.mark_as_failure` (stores result per `store_errors`, notifies chords, propagates along the chain, runs errbacks), `on_failure`, `task_failure` signal, error log (severity by `throws`). |
| raises `Reject` | `REJECTED` | Logged; the main process rejects (optionally requeues) the message — see below. |
| raises `Ignore` | `IGNORED` | Logged; nothing is stored; message acked. |
| `BaseException` (e.g. `SystemExit`) | — | Propagates out of the child; the pool reports `WorkerLostError`. |

10. In `finally`: `after_return` (not for ignored/rejected), `task_postrun` signal, pop task/request stacks, and (non-eager) `backend.process_cleanup()` and `loader.on_process_cleanup()`. Errors raised *outside* the body are sent as `task_internal_error` and reported as an internal error instead of crashing the child.
11. The tracer returns `(failed?, value, runtime)`; `Rstr` is the truncated repr used for the success event.

## 4. Completion (back in the worker main process)

12. `Request.on_success(failed, retval, runtime)`: a failed flag routes to `on_failure`; otherwise `task_ready(successful=True)` updates worker state, an `acks_late` task is **now** acknowledged, and `task-succeeded` is emitted.
13. `Request.on_failure` decides the message's fate for every error type: `Terminated` (revoked/terminated), `Reject` (`requeue` honored; a non-requeued reject records a terminal `FAILURE`), `Ignore` (ack), `Retry` (`on_retry`, ack if late), `MemoryError` (re-raised), and ordinary failures — with `acks_late`, requeue only for `WorkerLostError` when `reject_on_worker_lost` is set or for timeouts when `acks_on_timeout` is false; otherwise ack or drop per `acks_on_failure`. It then emits `task-failed`/signals.
14. Time limits: the soft limit makes billiard raise `SoftTimeLimitExceeded` inside the task; the hard limit kills the child, and `Request.on_timeout` records `TimeLimitExceeded` through `mark_as_failure`.

## 5. Retrieval

15. The client calls `AsyncResult.get()`: it polls or subscribes through the backend (see [[/openwiki/architecture/result-backends.md]]), refuses to block inside a task unless explicitly allowed, follows parent failures, and re-raises stored exceptions (validated as exception classes) when `propagate=True`.

## Variants

- **Retries**: `self.retry()` publishes a new message for the same task with `retries+1` and countdown/eta, then raises `Retry` so the current attempt ends in `RETRY`. `autoretry_for` wraps `run` to do this automatically. When the limit is exceeded the original exception (or `MaxRetriesExceededError`) fails the task.
- **Early vs. late ack**: default acks on *start* (a crash loses the task); `acks_late` acks after completion (a crash redelivers it, so the task must be idempotent). Deduplication above softens at-least-once duplicates.
- **Revocation**: `app.control.revoke(id, terminate=True)` adds the id to the worker's revoked set, writes `REVOKED` to the backend, discards the task when it arrives, and kills it if running (see [[/openwiki/architecture/events-and-monitoring.md]]). Expired tasks are treated as revoked.
- **Workflows**: callbacks and chain steps are published by step 9's success branch; chord members additionally call `on_chord_part_return` in `mark_as_done`/`mark_as_failure` (see [[/openwiki/architecture/canvas-workflows.md]]).
- **Eager**: `apply()` runs the same tracer with `eager=True` in-process: results are not published to the backend unless `task_store_eager_result` is set, and exceptions propagate when `task_eager_propagates` is on.
- **Connection loss**: the consumer restarts without touching the pool; running `acks_late` tasks may be cancelled and redelivered if `worker_cancel_long_running_tasks_on_connection_loss` is set.

## Signals in order

`before_task_publish` → `after_task_publish` (client) → `task_received` (worker main) → `task_prerun` → (`task_success` | `task_retry` | `task_failure` | `task_rejected`/`task_revoked`) → `task_postrun`. Also `task_internal_error`, `task_unknown`. See [[/openwiki/architecture/application.md]] for the full list.

## Worker start-up optimizations that affect the lifecycle

`setup_worker_optimizations` (`celery/app/trace.py#L804-L831`) installs a stack-protection patch for tasks overriding `__call__`, makes the worker's app current and default, finalizes it (building every task), and fills `_localized` with the task registry, accepted content types and hostname so that `fast_trace_task` can skip per-call lookups. `reset_worker_optimizations` undoes this (used in tests).
