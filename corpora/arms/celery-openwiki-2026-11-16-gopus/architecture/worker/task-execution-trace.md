---
type: architecture
title: Task Execution Tracing, States and Signals
description: How build_tracer/trace_task run a task body inside the pool, record STARTED/SUCCESS/FAILURE/RETRY states, dispatch link callbacks and the next chain step, deduplicate redelivered successes, and fire the task lifecycle signals; plus the state constants and the signal dispatcher.
tags: [trace, execution, states, signals, callbacks, worker]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:57:55.789Z
sources:
  - id: openwiki-source-4a982797c89fcb3ea5c5d0ee
    resource: repo://celery/app/trace.py
  - id: openwiki-source-30739e9c6aac84ef121d58dc
    resource: repo://celery/states.py
  - id: openwiki-source-7ef2718c0e261f897e55c1de
    resource: repo://celery/utils/dispatch/signal.py
generated: { by: "claude-code", at: "2026-11-16T06:57:55.789Z" }
---

# Task Execution Tracing, States and Signals

`celery/app/trace.py` is the code that actually runs a task in the execution
environment (a prefork child, a thread, a greenlet, or inline for eager
calls). It turns the raw task function into a *tracer* that manages the
request context, result storage, callbacks and signals.

## Entry points

| Function | Used by | Notes |
|----------|---------|-------|
| `build_tracer(name, task, loader, hostname, eager=False, propagate=False, app=...)` | Consumer `update_strategies`, prefork child initializer, `Task.apply` | Returns the closure `trace_task(uuid, args, kwargs, request)`; cached as `task.__trace__` |
| `trace_task(task, uuid, args, kwargs, request)` | `Request.execute`, eager `apply` | Builds `__trace__` lazily; turns internal errors into a `FAILURE` `TraceInfo` |
| `trace_task_ret(name, uuid, request, body, content_type, content_encoding)` | Pool target from `Request.execute_using_pool` | **Deserializes the protocol v2 body in the child** with `accept_content`, merges `embed` (callbacks, errbacks, chain, chord, group) into the request and looks the task up in `app.tasks` |
| `fast_trace_task(...)` | Same, when `app.use_fast_trace_task` | Uses the registry/accept/hostname cached by `setup_worker_optimizations`; raises a clear `RuntimeError` if that never ran (e.g. spawned rather than forked children) |

Pool targets return `(failed_flag, retval_or_repr, runtime)` to the parent,
which `Request.on_success` interprets ([consumer](consumer.md)).

`setup_worker_optimizations(app)` (called by the worker) installs stack
protection for custom `Task.__call__`, makes the app current **and default**
for every thread (so a worker process effectively serves one app), finalizes
it, fills the fast-trace cache, and sets `use_fast_trace_task = True`.

## What the tracer does

`build_tracer` precomputes everything it can (custom `before_start`,
`on_success`, `after_return` hooks; signal receiver lists; whether to call
`task.run` directly when `__call__` is not overridden). Each call then:

1. **Validates** that kwargs is a mapping (`InvalidTaskError` otherwise) and
   builds a `Context` from the request dict (`called_directly=False`).
2. **Result policy.** `ignore_result` comes from the request, falling back to
   the task. `track_started` stores `STARTED` with `{pid, hostname}` only for
   non-eager runs whose results are not ignored. Eager calls publish results
   only if `store_eager_result`.
3. **Deduplication.** If the task is `acks_late`,
   `worker_deduplicate_successful_tasks` is on, and the backend is
   persistent, a **redelivered** message whose id is in the local
   `successful_requests` set or whose stored state is `SUCCESS` is not run
   again. Callbacks/chain are re-dispatched only if the stored meta has no
   `children` (which requires `result_extended`), and failures doing so raise
   `Reject(requeue=True)`.
4. **Pre-run.** Pushes the task on `_task_stack` (`current_task`) and the
   request on `task.request_stack`; sends `task_prerun`; calls
   `loader.on_task_init`; stores `STARTED` if tracked.
5. **Run** `before_start` then the function.
6. **Outcome handling:**
   - `Reject` → state `REJECTED`, logged; the parent rejects the message.
   - `Ignore` → state `IGNORED`, logged; nothing stored.
   - `Retry` → `handle_retry`: `mark_as_retry`, `task.on_retry`,
     `task_retry` signal. Errbacks are **not** called.
   - other `Exception` → `handle_failure`: converts to a pickleable exception
     (`get_pickleable_exception`), `mark_as_failure` (which also propagates to
     chord/chain and calls errbacks — see
     [result backends](../result-backends.md)), `task.on_failure`, and the
     `task_failure` signal.
   - `BaseException` (e.g. `SystemExit`) is re-raised.
   - Success → **dispatch callbacks and the next chain step first**, then
     `backend.mark_as_done`, so `result.children` is populated when the
     result becomes visible. Multiple `link` callbacks are sent as a group;
     linked groups are applied separately. The chain's next step is
     `chain[-1]` with the remaining `chain[:-1]` passed along (the chain list
     is stored reversed). An `EncodeError` while storing the result turns the
     outcome into a failure. Then `task.on_success`, the `task_success`
     signal and the `Task ... succeeded in ...s` log line.
7. **Post-run.** For states other than `IGNORED`/`REJECTED`/`RETRY`
   (`IGNORE_STATES`) calls `after_return`; always sends `task_postrun`, pops
   the stacks, and (non-eager) runs `backend.process_cleanup()` and
   `loader.on_process_cleanup()`.
8. **Internal errors** raised outside the task body are reported through the
   `task_internal_error` signal and `report_internal_error`, and recorded as
   a failure; `MemoryError` and `Reject` propagate.

`task_inherit_parent_priority` makes callbacks and chain steps inherit the
delivery priority of the current message. With `propagate=True` (eager mode
with `task_eager_propagates`) exceptions are re-raised to the caller instead
of being stored.

The tracer explicitly clears traceback frames (`traceback_clear`) after
handling exceptions to avoid memory leaks from retained frames.

## Task states

`celery/states.py` defines `PENDING`, `RECEIVED`, `STARTED`, `SUCCESS`,
`FAILURE`, `REVOKED`, `REJECTED`, `RETRY`, `IGNORED`, and sets:

| Set | Members |
|-----|---------|
| `READY_STATES` | SUCCESS, FAILURE, REVOKED |
| `UNREADY_STATES` | PENDING, RECEIVED, STARTED, REJECTED, RETRY |
| `EXCEPTION_STATES` | RETRY, FAILURE, REVOKED |
| `PROPAGATE_STATES` | FAILURE, REVOKED |

`PRECEDENCE` orders states from most to least final
(`SUCCESS, FAILURE, None(custom), REVOKED, STARTED, RECEIVED, REJECTED, RETRY,
PENDING`); `state` is a `str` subclass whose comparisons use this order. It is
used by the events `State` to merge out-of-order events. Custom states
(e.g. from `task.update_state(state='PROGRESS')`) rank as `None`.

## Signals

`celery/signals.py` declares module-level `Signal` objects:

- **Publishing:** `before_task_publish`, `after_task_publish`.
- **Task execution:** `task_received`, `task_prerun`, `task_postrun`,
  `task_success`, `task_retry`, `task_failure`, `task_internal_error`,
  `task_revoked`, `task_rejected`, `task_unknown`.
- **Worker:** `celeryd_init`, `celeryd_after_setup`, `worker_init`,
  `worker_before_create_process`, `worker_process_init`,
  `worker_process_shutdown`, `worker_ready`, `worker_shutting_down`,
  `worker_shutdown`, `heartbeat_sent`.
- **Other:** `import_modules`, `setup_logging`, `after_setup_logger`,
  `after_setup_task_logger`, `beat_init`, `beat_embedded_init`,
  eventlet pool signals, `user_preload_options`.

The dispatcher (`celery/utils/dispatch/signal.py`, derived from Django's) holds
receivers as weak references by default (bound methods via `WeakMethod`),
keyed by `dispatch_uid` or receiver id plus sender id, with a per-sender
receiver cache. `connect(sender=..., weak=..., dispatch_uid=..., retry=...)`
can wrap a receiver to retry on failure. `send()` calls every live receiver;
an exception raised by a receiver is **logged and returned in the responses
list instead of propagating**, so one faulty handler cannot break task
execution. (`import_modules` is the exception the loader re-raises
explicitly.)

Note that the task-execution signals fire **in the process that runs the
task** (pool child), while `task_received` and request-level signals such as
`task_revoked` fire in the worker's main process.

## Tests

- `t/unit/tasks/test_trace.py` – tracer states, callbacks, chain dispatch,
  deduplication, internal errors.
- `t/unit/tasks/test_states.py`, `t/unit/utils/test_dispatcher.py`.
- `t/integration/test_mem_leak_in_exception_handling.py` – traceback cleanup.
- `t/smoke/tests/test_signals.py`.

See also: [Tasks](../../concepts/tasks.md), [Consumer](consumer.md).
