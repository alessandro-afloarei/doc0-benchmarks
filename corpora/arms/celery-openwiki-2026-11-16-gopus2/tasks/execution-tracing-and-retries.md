---
type: subsystem
title: Task Execution, Tracing and Retries
description: How celery/app/trace.py executes a task inside a worker or eagerly — building the per-task tracer, state transitions and result storage, callback/chain dispatch, signals and hooks, error handling for Retry/Reject/Ignore/exceptions, duplicate-delivery deduplication, and how Task.retry and autoretry_for re-publish tasks; plus task states and precedence from celery/states.py.
tags: [trace, execution, retry, autoretry, states, exceptions, signals]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:05:29.073Z
sources:
  - id: openwiki-source-f43ee4204a66938ed7ddea4f
    resource: repo://celery/app/autoretry.py
  - id: openwiki-source-3795aa577fa7b0f3bd2af81a
    resource: repo://celery/app/task.py
  - id: openwiki-source-4a982797c89fcb3ea5c5d0ee
    resource: repo://celery/app/trace.py
  - id: openwiki-source-30739e9c6aac84ef121d58dc
    resource: repo://celery/states.py
generated: { by: "claude-code", at: "2026-11-16T17:05:29.073Z" }
---

# Task Execution, Tracing and Retries

`celery/app/trace.py` is the code path that actually runs a task function. It is used by the worker pool (via `trace_task_ret` / `fast_trace_task`, see [Request Lifecycle](../worker/request-lifecycle.md)) and by eager execution (`Task.apply`). It is written as a heavily unrolled closure for speed.

## Building the tracer

`build_tracer(name, task, loader, hostname, store_errors, eager, propagate, app)` returns `trace_task(uuid, args, kwargs, request)`. Once per task it precomputes:

- `fun` — `task.run` directly unless the task class overrides `__call__` (saving a stack frame);
- which hooks are overridden (`before_start`, `on_success`, `after_return`);
- signal receivers lists for `task_prerun`, `task_postrun`, `task_success` (send is skipped when there are none);
- `deduplicate_successful_tasks` — true only if the task is `acks_late`, `worker_deduplicate_successful_tasks` is on, and the backend is `persistent`.

`trace_task(task, ...)` caches the tracer on `task.__trace__`. In the worker, `setup_worker_optimizations(app, hostname)` (called by `celery.apps.worker` and prefork child init) finalizes the app, makes it current *and* default, stores the registry/accept list/hostname in a module-level `_localized`, patches `Task.__call__` for stack protection, and enables `app.use_fast_trace_task`; `fast_trace_task` then deserialises the message body and calls the cached tracer without app lookups.

## Execution sequence

For each invocation the tracer:

1. Validates kwargs is a mapping (`InvalidTaskError` otherwise) and builds a `Context` request (`called_directly=False`).
2. Computes `ignore_result` (request overrides task), `track_started` (not eager, `task.track_started`, results not ignored) and whether to publish the result (not eager and not ignored, or eager with `store_eager_result`).
3. **Deduplication:** for a *redelivered* message with deduplication enabled, if the id is in the worker's `successful_requests` or the backend reports `SUCCESS`, the task is not run again. If the stored result has no children but the request has callbacks/chain, they are dispatched from the stored return value (so a crash between storing and dispatching does not stall the workflow); failures to dispatch raise `Reject(requeue=True)`.
4. Pushes the task onto the current-task stack and the request onto `task.request_stack`.
5. Sends `task_prerun`, calls `loader.on_task_init`, and stores `STARTED` (with pid and hostname) if tracking.
6. Calls `before_start`, then the task function.
7. Outcome handling:

| Raised / returned | State | Handling |
|-------------------|-------|----------|
| Return value | `SUCCESS` | **Callbacks (`link`) and the next chain step are sent first**, then `backend.mark_as_done` stores the result (so `children` is populated); `EncodeError` during storing turns into a failure. Then `on_success`, `task_success` signal, and the "succeeded in" log line. |
| `Retry` | `RETRY` | `mark_as_retry` (if storing errors), `on_retry`, `task_retry` signal; errbacks are **not** called. |
| `Reject` | `REJECTED` | Logged; the worker request rejects/requeues the message. |
| `Ignore` | `IGNORED` | Logged; nothing stored. |
| Other `Exception` | `FAILURE` | Exception made pickleable, `mark_as_failure` (stores, propagates through chords/chains, calls errbacks), `on_failure`, `task_failure` signal, logged. |
| `BaseException` (e.g. `SystemExit`) | — | Re-raised. |

8. `after_return` runs unless the state is in `IGNORE_STATES` (`IGNORED`, `RETRY`, `REJECTED`) — i.e. only for `SUCCESS` and `FAILURE`; then `task_postrun` is sent, stacks are popped, and (when not eager) `backend.process_cleanup()` and `loader.on_process_cleanup()` run.
9. Any exception escaping the tracer itself is an **internal error**: `task_internal_error` is sent, the error is reported, and the task is marked failed (or re-raised when eager).

When errors are stored: if results are ignored, errors are stored only with `store_errors_even_if_ignored`; eager tasks store only with `store_eager_result`.

Log severity is chosen by `get_log_policy`: exceptions listed in `Task.throws` are logged as expected (INFO, no traceback), `Reject` logs a WARNING and `Ignore` an INFO line, internal errors are CRITICAL, and everything else is an ERROR with traceback. Tracebacks are cleared from frames after handling to avoid memory leaks (issue #8882).

## Retrying

### `Task.retry(args=None, kwargs=None, exc=None, throw=True, eta=None, countdown=None, max_retries=None, **options)`

- Increments `request.retries`. If the task was called directly (not by a worker or `apply`), it simply re-raises `exc` (or a `Retry`).
- Default delay is `default_retry_delay` (180 s) when neither `eta` nor `countdown` is given.
- Builds a new signature from the current request (`signature_from_request`), preserving id, root/parent ids, group/chord membership, chain, callbacks/errbacks and stamped headers.
- If `retries > max_retries` (default 3; `None` means forever) it raises `exc` if provided, otherwise `MaxRetriesExceededError`.
- Otherwise publishes the new message (failure to publish becomes `Reject(requeue=False)`) and raises `Retry` so the tracer records `RETRY`. Eagerly executed tasks raise/return the `Retry` so `apply()` re-runs locally.

Because the retry is a *new message with the same task id*, results, chords and chains continue to track it.

### `autoretry_for`

`add_autoretry_behaviour` (`celery/app/autoretry.py`) is applied when tasks are created or registered. If `autoretry_for` is set, `task.run` is wrapped so that matching exceptions (excluding `dont_autoretry_for`, `Ignore` and `Retry`) call `task.retry(exc=exc, **retry_kwargs)`:

- `retry_backoff` enables exponential backoff: countdown = `get_exponential_backoff_interval(factor=retry_backoff, retries, maximum=retry_backoff_max (600), full_jitter=retry_jitter (True))`.
- `retry_kwargs` supplies `max_retries`, `countdown`, etc.; a `max_retries` passed to an explicit `self.retry()` inside the task is honoured via `override_max_retries`.

## States

`celery/states.py` defines `PENDING`, `RECEIVED`, `STARTED`, `SUCCESS`, `FAILURE`, `RETRY`, `REVOKED`, `REJECTED`, `IGNORED`, and sets:

- `READY_STATES = {SUCCESS, FAILURE, REVOKED}`
- `UNREADY_STATES = {PENDING, RECEIVED, STARTED, REJECTED, RETRY}`
- `EXCEPTION_STATES = {RETRY, FAILURE, REVOKED}`
- `PROPAGATE_STATES = {FAILURE, REVOKED}` (re-raised by `get()`)

`PRECEDENCE` orders states (`SUCCESS`, `FAILURE`, *custom/unknown*, `REVOKED`, `STARTED`, `RECEIVED`, `REJECTED`, `RETRY`, `PENDING`); `state` objects compare by it. Event-state reconstruction uses this to ignore out-of-order events (see [Events](../events/monitoring.md)). Custom states set via `task.update_state(state='PROGRESS', meta=...)` rank between `FAILURE` and `REVOKED`.

## Exceptions

`celery/exceptions.py` defines the control-flow predicates `Retry`, `Ignore`, `Reject(reason, requeue)` (all `TaskPredicate`), task errors (`MaxRetriesExceededError`, `TaskRevokedError`, `TimeLimitExceeded`/`SoftTimeLimitExceeded` re-exported from billiard, `ChordError`, `NotRegistered`, `InvalidTaskError`, `QueueNotFound`, `TimeoutError`), backend errors (`BackendGetMetaError`, `BackendStoreError`), configuration/security errors, and worker control exceptions (`WorkerShutdown`, `WorkerTerminate`).

## Tests

- `t/unit/tasks/test_trace.py` — tracer outcomes, hooks, deduplication, internal errors, callbacks before storing.
- `t/unit/tasks/test_tasks.py` — `retry`, `autoretry_for`, backoff, `max_retries` overrides.
- `t/unit/tasks/test_states.py` — precedence.
- `t/integration/test_tasks.py` — retries and failures against live brokers.

## Related

- [Task Request Lifecycle in the Worker](../worker/request-lifecycle.md)
- [Result Backends](../results/backends.md)
- [Canvas](../canvas/workflows.md)
