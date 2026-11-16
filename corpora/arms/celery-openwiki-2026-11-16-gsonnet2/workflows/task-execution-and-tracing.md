---
type: workflow
title: Task Execution, Tracing, Retry and States
description: What happens when a pool process runs a task. Covers the tracer (build_tracer and trace_task), task states and their precedence, success, failure, retry, ignore and reject paths, auto-retry and Task.retry, Task.replace, time limits, acknowledgement interplay, signals and the Task hook methods.
tags: [celery, tracing, task-states, retry, errors, signals, acks-late, time-limits]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:56:17.091Z
sources:
  - id: openwiki-source-f43ee4204a66938ed7ddea4f
    resource: repo://celery/app/autoretry.py
  - id: openwiki-source-3795aa577fa7b0f3bd2af81a
    resource: repo://celery/app/task.py
  - id: openwiki-source-4a982797c89fcb3ea5c5d0ee
    resource: repo://celery/app/trace.py
  - id: openwiki-source-30739e9c6aac84ef121d58dc
    resource: repo://celery/states.py
  - id: openwiki-source-328c66e40eb163230ad26cbc
    resource: repo://celery/worker/request.py
generated: { by: "claude-code", at: "2026-11-16T17:56:17.091Z" }
---

# Task Execution, Tracing, Retry and States

When the worker's pool picks up a job, the function it runs is the **tracer** from `celery/app/trace.py`. The tracer is the heart of task semantics. It builds the request context, runs the body, decides the final state, stores results, and triggers follow-on work. The worker-side bookkeeping around it (acknowledgement, events, timeouts) lives in `celery/worker/request.py` (see [Worker and consumer](../architecture/worker-and-consumer.md)).

## Entry points into the tracer

- `trace_task_ret(name, uuid, request, body, content_type, content_encoding, ...)` is the generic pool target. It deserializes the body with the app's accepted content types, merges `args`, `kwargs` and the embedded `callbacks/errbacks/chain/chord` into the request dict, then runs `trace_task`.
- `fast_trace_task` does the same through a prebuilt per-process lookup (`_localized`, filled by `setup_worker_optimizations`), using the task's cached `__trace__`. `Request.execute_using_pool` chooses it when `app.use_fast_trace_task` is set. In a process spawned instead of forked (for example prefork on Windows), the lookup is empty, and it raises a `RuntimeError` that suggests using the `solo` or `threads` pool.
- `Task.apply()` (eager mode, `task_always_eager`) calls `build_tracer(..., eager=True, propagate=throw)` directly and wraps the outcome in an `EagerResult`. Retries in eager mode are applied recursively in `apply`.
- `Consumer.update_strategies` and the pool process initializer build `task.__trace__ = build_tracer(...)` for every registered task (see [Concurrency pools](../architecture/concurrency-pools.md)).

## `build_tracer`: preparing the closure

`build_tracer(name, task, ...)` returns `trace_task(uuid, args, kwargs, request)`, a deliberately long, unrolled function, optimized for speed. At build time it binds things that do not change per call:

- `fun`: the task's `run`, or the task object itself if it overrides `__call__` (`task_has_custom`).
- Optional hooks, only if overridden: `before_start`, `on_success`, `after_return`.
- Whether signal receivers exist (`task_prerun`, `task_postrun`, `task_success`), so it skips dispatch when nobody listens.
- `deduplicate_successful_tasks`: true only if the task is `acks_late` **and** `worker_deduplicate_successful_tasks` is set **and** the backend is persistent.

## The run, step by step (`trace_task`)

1. **Context.** Build `task_request = Context(request, args, kwargs, called_directly=False)`. Work out `ignore_result` (request value overrides task value) and whether to `track_started` (`task_track_started` and not ignoring results).
2. **Redelivery de-duplication.** If the message was redelivered and de-duplication is on, the tracer checks the in-memory `successful_requests` set and the backend state. If the task already succeeded, it skips execution. If the stored metadata has no `children`, it re-dispatches the callbacks and chain from the stored result, because the original run may have died between finishing and dispatching. A failure while doing so raises `Reject(requeue=True)`, so the message is retried.
3. **Push context.** Push the task on the task stack and the request on the request stack, so `current_task` and `task.request` work.
4. **Pre-run.** Send `task_prerun`, call the loader's `on_task_init`, and if tracking is on, store the `STARTED` state with pid and hostname.
5. **Execute.** Call `before_start` if overridden, then `R = retval = fun(*args, **kwargs)`.
6. **Outcome.** The outcome of the body decides everything that follows:

| Outcome | State | What the tracer does |
|---|---|---|
| returns | `SUCCESS` | Dispatch `link` callbacks and the next `chain` step, **then** `backend.mark_as_done`. Then `on_success`, signal `task_success`, and an info log. |
| `Retry` raised | `RETRY` | `handle_retry`: store `RETRY` (`mark_as_retry`), call `task.on_retry`, send `task_retry`, log. Errbacks are **not** called. |
| `Ignore` raised | `IGNORED` | Log only. Nothing is stored and the worker acknowledges the message. |
| `Reject` raised | `REJECTED` | Log only. The worker's request handling rejects (and optionally requeues) the message. |
| any other `Exception` | `FAILURE` | `handle_failure`: make the exception picklable, `mark_as_failure` (runs errbacks), `task.on_failure`, `task_failure` signal, and an error log. |
| `BaseException` (such as `SystemExit`) | n/a | Propagates out of the tracer so the pool treats it as a worker issue. |
| `EncodeError` while storing | `FAILURE` | Treated as a task failure. |

7. **Post-run.** Call `after_return` (for states not in `IGNORE_STATES`), send `task_postrun`, pop the stacks, and call `backend.process_cleanup()` and the loader's `on_process_cleanup()` (not in eager mode). Cleanup errors are logged and swallowed.
8. Exceptions raised from the tracer machinery itself (not the task body) trigger `task_internal_error`, are reported, and are turned into a failure through `on_error`. `Reject` and `MemoryError` propagate.

**Order matters on success:** callbacks and the next chain step are published *before* the result is stored, so that `result.children` is populated by the time the parent's metadata is saved. The code comment notes that dispatch is not atomic: if callbacks succeed but a later step fails, a redelivery may re-dispatch them (hence at-least-once semantics). See [Canvas](../architecture/canvas-workflows.md) for what the chain and callbacks contain.

Several places call `traceback_clear` and delete exception references after handling. These were added to stop frame locals from being retained in long-running worker processes (issue #8882 in the source comments).

### How `store_errors` is decided

`TraceInfo.handle_error_state` computes whether to persist the error: if results are ignored, only when `store_errors_even_if_ignored`; in eager mode only when `store_eager_result`; otherwise always for real workers. This is why `ignore_result` tasks can still end up with no recorded failure.

## States (`celery/states.py`)

Built-in states: `PENDING` (also the answer for unknown ids), `RECEIVED` and `REJECTED` (events only), `STARTED` (opt-in), `RETRY`, `SUCCESS`, `FAILURE`, `REVOKED`, and `IGNORED` (not stored).

- `READY_STATES = {SUCCESS, FAILURE, REVOKED}`. These are final.
- `EXCEPTION_STATES = {RETRY, FAILURE, REVOKED}`.
- `PROPAGATE_STATES = {FAILURE, REVOKED}`: these re-raise on `AsyncResult.get()` and propagate to chained tasks (see `mark_as_failure` in [Result backends](../architecture/result-backends.md)).
- `state` is a `str` subclass with ordering by *precedence* (`SUCCESS` > `FAILURE` > custom states > `REVOKED` > `STARTED` > `RECEIVED` > `REJECTED` > `RETRY` > `PENDING`). Custom states, for example `PROGRESS` through `Task.update_state`, rank above the in-progress built-ins but below final states. Event-stream consumers use this to merge out-of-order events (see [Events and remote control](../architecture/events-and-remote-control.md)).

## Retry

### `Task.retry(...)` (`celery/app/task.py`)

Called inside a task body, normally as `raise self.retry(exc=exc, countdown=...)`:

1. If the task was **called directly** (not by a worker), it just raises the original exception.
2. Default delay is `default_retry_delay` (180 s) unless `eta` or `countdown` is given.
3. Builds a new signature from the current request (`signature_from_request`) with `retries = request.retries + 1`.
4. If `retries > max_retries` (default 3; `None` means unlimited), it raises the original `exc` (chained) or `MaxRetriesExceededError`.
5. In eager mode it returns or raises `Retry` and `apply` re-runs the signature.
6. Otherwise it **publishes the new message** with `apply_async` (a publish failure becomes `Reject(requeue=False)`), then raises the `Retry` exception (unless `throw=False`).

The tracer sees `Retry`, records `RETRY`, and the worker acknowledges the *original* message (acks happen in `Request.on_retry` when late-acked, and on accept otherwise). The retry is a **brand-new message**, with the same task id and an incremented `retries` header. It is not a redelivery.

### Auto-retry (`celery/app/autoretry.py`)

`add_autoretry_behaviour` is applied when a task is created (`autoretry_for`, `dont_autoretry_for`, `retry_kwargs`, `retry_backoff`, `retry_backoff_max` (default 600 s), `retry_jitter` (default true)). It wraps `task.run`: exceptions in `autoretry_for` (but not `Ignore`, `Retry` or `dont_autoretry_for`) trigger `task.retry(exc=exc, **retry_kwargs)`. With `retry_backoff`, the countdown is an exponential backoff by retry number with optional full jitter.

## Acknowledgement semantics (cross-reference)

By default the message is acknowledged when execution **starts** (`on_accepted`). With `acks_late` it is acknowledged after success or retry, or per the failure policy: `acks_on_failure` and `acks_on_timeout` (falling back to the combined `acks_on_failure_or_timeout`), and `reject_on_worker_lost` for a lost process. A late-acked task whose process dies is redelivered. See [Worker and consumer](../architecture/worker-and-consumer.md).

## Time limits

Limits come from `task.time_limit` and `soft_time_limit` (or per-call options), delivered in the message's `timelimit` header, and enforced by the pool (see [Concurrency pools](../architecture/concurrency-pools.md)).

- **Soft limit:** the child process raises `SoftTimeLimitExceeded` inside the task body, so the task can clean up. `Request.on_timeout(soft=True)` only logs a warning.
- **Hard limit:** the pool kills the process. `Request.on_timeout(soft=False)` marks the task failed in the backend with `TimeLimitExceeded` and calls `on_failure`, `after_return` and the `task_failure` signal so hooks and errbacks fire for hard timeouts too. It skips this during cold shutdown. Then acknowledgement follows the `acks_on_timeout` policy.
- Task attributes `soft_time_limit` must not exceed `time_limit`: `apply_async` raises `ValueError` otherwise.

## `Task.replace` and other task-level controls

`self.replace(sig)` ends the current task and substitutes a new signature that **inherits the task id**, group and chord membership, root id, callbacks and errbacks, and the remaining chain. A replaced group is uplifted to a chord with `celery.accumulate`. The replacement must not itself be part of a chord. In an asynchronous context it raises `Ignore`, so the original task's execution ends. `add_to_chord(sig)` adds a task to the chord the current task belongs to, `update_state(state, meta)` stores a custom state, and `request` exposes `retries`, `id`, `root_id`, `parent_id`, `group`, `chain`, `callbacks`, `errbacks`, `delivery_info`, and stamps.

## Hooks and signals

Task methods (override in a custom base class; the tracer only calls them if overridden): `before_start`, `on_success`, `on_retry`, `on_failure`, `after_return`, `on_replace`. Signals (see [Django integration and contrib](../integrations/django-and-contrib.md) for the dispatcher): `task_prerun`, `task_postrun`, `task_success`, `task_failure`, `task_retry`, `task_revoked`, `task_rejected`, `task_unknown`, `task_internal_error`. Exceptions in signal receivers are logged and do not break the task.

## Exceptions that carry meaning (`celery/exceptions.py`)

- Control-flow "predicates" derive from `TaskPredicate`: `Retry`, `Ignore` and `Reject` (with `requeue`).
- Billiard exceptions re-exported: `SoftTimeLimitExceeded`, `TimeLimitExceeded`, `WorkerLostError`, `Terminated`.
- Task errors: `NotRegistered`, `MaxRetriesExceededError`, `TaskRevokedError`, `InvalidTaskError`, `ChordError`.
- Infrastructure: `ImproperlyConfigured`, `SecurityError`, `BackendError`, `BackendGetMetaError` and `BackendStoreError`.
- `Task.throws` lists exceptions that are "expected": they are logged at a lower severity and without traceback (`get_log_policy`).

## Tests

`t/unit/tasks/test_trace.py` and `t/unit/app/test_trace.py` (tracer), `t/unit/tasks/test_tasks.py` (retry, replace, hooks), `t/unit/worker/test_request.py` (request-side callbacks and timeouts), `t/unit/tasks/test_states.py`, and `t/integration/test_tasks.py`. See [Testing, CI and development workflow](../testing/test-strategy.md).
