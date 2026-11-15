---
type: subsystem
title: Task Execution Tracing
description: How celery/app/trace.py runs a task body inside the worker. Covers the tracer built per task, request/task stacks, the order of signals, hooks, state writes and callback/chain dispatch, error-state handling (Retry, Reject, Ignore, failures), logging policy, deduplication of redelivered successes, fast_trace_task optimizations, internal errors, and memory-leak safeguards.
tags: [trace, execution, signals, retry, failure, worker]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:49.645Z
sources:
  - id: openwiki-source-4a982797c89fcb3ea5c5d0ee
    resource: repo://celery/app/trace.py
generated: { by: "claude-code", at: "2026-11-15T17:08:49.645Z" }
---

# Task Execution Tracing

`celery/app/trace.py` is the code that actually **calls your task function** and records the outcome. It runs inside a pool worker process or thread, or inline for eager `Task.apply()`. It sits between the worker's `Request` (see [Consumer, Strategies and Task Requests](../worker/consumer-and-requests.md)) and the [result backend](../results/backends.md).

## Entry points

| Function | Used by | Notes |
|---|---|---|
| `build_tracer(name, task, eager=False, propagate=False, app=...)` | everyone | Returns a closure `trace_task(uuid, args, kwargs, request)` with lookups prebound for speed. Cached as `task.__trace__`. |
| `trace_task(task, uuid, args, kwargs, request)` | generic path | Builds or caches the tracer and turns errors outside the body into an internal error result. |
| `trace_task_ret(name, uuid, request, body, content_type, ...)` | pool (non-optimized) | Deserializes the message body with `accept_content`, merges `args`, `kwargs`, `hostname`, `is_eager=False` and the embedded options into the request, then traces. Returns `(failed_flag, R, runtime)`. |
| `fast_trace_task(...)` | pool when `app.use_fast_trace_task` | Same as above but uses the prebuilt `_localized` registry, accept list, and hostname. |
| `Task.apply()` | eager mode | Calls `build_tracer(..., eager=True, propagate=throw)` (`celery/app/task.py`). |

**Worker optimizations.** `setup_worker_optimizations(app, hostname)` is called by `apps/worker.py` and again in each prefork child (`concurrency/prefork.py`). It:

- makes the app current **and** default;
- finalizes it;
- fills `_localized`;
- sets `app.use_fast_trace_task = True`;
- installs a stack-protecting `Task.__call__`, so that tasks overriding `__call__` and calling `super()` don't double-push the request stack.

If a process was *spawned* rather than forked and `_localized` is empty, `fast_trace_task` raises a `RuntimeError` that suggests `--pool=solo` or `--pool=threads`.

When a task does not override `__call__`, the tracer calls `task.run` directly to save a frame. In that case `task.__call__` is skipped in the worker.

## Order of operations in one trace

```
check kwargs is a mapping (else InvalidTaskError)
build Context(request) → ignore_result, track_started, publish_result
[dedup check for redelivered acks_late tasks]
push task & request stacks
  task_prerun signal
  loader.on_task_init
  [track_started → backend.store_result(STARTED, {pid, hostname})]
  task.before_start(...)            (if overridden)
  R = fun(*args, **kwargs)
  ├─ success:
  │    dispatch link callbacks + next chain step   (before storing!)
  │    backend.mark_as_done(...)                    (stores, chord part return)
  │    task.on_success(...)  →  task_success signal → INFO log "succeeded in Ns"
  ├─ Retry   → on_error(RETRY, call_errbacks=False)
  ├─ Reject  → state REJECTED, log; Request acks/requeues accordingly
  ├─ Ignore  → state IGNORED, log; nothing stored
  └─ Exception → on_error(FAILURE)
  task.after_return(...)            (unless state in IGNORED/RETRY/REJECTED)
finally:
  task_postrun signal
  pop stacks
  backend.process_cleanup(); loader.on_process_cleanup()   (not when eager)
```

Notes:

- **Callbacks are dispatched before the result is stored**, so `result.children` already contains them when a waiter sees `SUCCESS`. `_dispatch_callbacks_and_chain` sends a single `link` with `apply_async((retval,))`. Several links are grouped, with group signatures applied separately (Issue #1936). The next chain element is popped from `request.chain` and sent with `chain=chain[:-1]`. Priority is inherited when `task_inherit_parent_priority` is set.
- An `EncodeError` raised while storing the result (an unserializable return value) is turned into a task failure.
- `publish_result` is false when eager (unless `store_eager_result`) or when `ignore_result` is in effect. `get_actual_ignore_result` lets an explicit per-call `ignore_result` override the task attribute. It checks the request's `__dict__` so that the class-level default isn't mistaken for an override.
- `track_started` writes `STARTED` with the PID and hostname only when the task opts in and results aren't ignored.

## Error states (`TraceInfo`)

`on_error()` re-raises when `propagate` is true (eager `apply(throw=True)`). Otherwise it builds `TraceInfo(state, exc)` and calls `handle_error_state`, which first decides whether to store anything:

| Condition | Store errors? |
|---|---|
| `ignore_result` | only if `store_errors_even_if_ignored` |
| eager and `store_eager_result` | yes |
| otherwise | yes when not eager |

- **Retry** (`handle_retry`): `backend.mark_as_retry(req.id, reason.exc, traceback)`, then `task.on_retry`, the `task_retry` signal, and an INFO log. Errbacks are **not** called. The new attempt was already published by `Task.retry()` (see [Tasks](task-lifecycle.md)).
- **Failure** (`handle_failure`): converts the exception into a pickleable equivalent (`get_pickleable_exception`), then `backend.mark_as_failure(...)`, which stores the failure, propagates it to chained tasks and chords, and calls errbacks. It then calls `task.on_failure`, sends the `task_failure` signal, and logs.
- **Logging policy** (`get_log_policy`):
  - `Reject` → WARNING with traceback;
  - `Ignore` → INFO;
  - internal errors → CRITICAL;
  - exceptions listed in `task.throws` → INFO "raised expected", without a traceback;
  - anything else → ERROR "raised unexpected", with a traceback.
  Log records include `extra={'data': context}` for structured handlers. `argsrepr`/`kwargsrepr` from the message hide sensitive arguments.

## Deduplicating redelivered successes

`deduplicate_successful_tasks` is enabled only when acks are late (`task_acks_late` or `task.acks_late`), `worker_deduplicate_successful_tasks` is on, **and** the backend is persistent. When a **redelivered** message arrives:

- If the ID is in the worker-local `successful_requests` `LimitedSet`, or the backend reports `SUCCESS`, the body is **not** executed again.
- If the stored metadata has no `children` but the request has callbacks or a chain, the callbacks and chain are re-dispatched with the stored return value. The original run may have stored success but crashed before acking. This relies on `result_extended` metadata.
- If that re-dispatch fails, the tracer raises `Reject(requeue=True)`. Broker dead-lettering is the intended circuit breaker against infinite requeues.

## Internal errors

Exceptions raised **outside** the task body, for example in signal handlers, backend writes, or loader hooks, go to `_signal_internal_error` (the `task_internal_error` signal) and `report_internal_error`. The latter emits a `RuntimeWarning` "Exception raised outside body" and returns an internal `ExceptionInfo`. When possible, the task is still marked as failed. `MemoryError` and `Reject` are always re-raised.

## Memory-leak safeguards (Issue #8882)

Tracebacks keep frames and their locals alive, which can retain large objects in long-lived workers. The tracer therefore:

- calls `traceback_clear(exc)` after every handled exception, which walks `exc.__traceback__` and calls `frame.clear()` on frames that are no longer executing;
- deletes local `tb` references in `handle_retry`, `handle_failure`, and `_signal_internal_error`.

`t/integration/test_mem_leak_in_exception_handling.py` guards this behaviour.

## Tests

- `t/unit/tasks/test_trace.py`: tracer states, signals, callbacks and chains, dedup, internal errors, logging policy.
- `t/unit/app/test_trace.py`.
- `t/integration/test_tasks.py`.

## See also

- [Tasks: Definition, Invocation, Retries](task-lifecycle.md)
- [Canvas](../canvas/workflows.md)
- [Result Backends](../results/backends.md)
- [Consumer, Strategies and Task Requests](../worker/consumer-and-requests.md)
