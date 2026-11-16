---
type: architecture
title: Tasks and Tracing
description: The Task base class and its per-call Context, the options that shape execution (acknowledgement, result storage, retries, time limits), the retry and autoretry mechanics, and build_tracer, the function that wraps every execution and decides the final state.
tags: [celery, task, trace, tracer, retry, autoretry, context, state]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:42:35.525Z
sources:
  - id: openwiki-source-f43ee4204a66938ed7ddea4f
    resource: repo://celery/app/autoretry.py
  - id: openwiki-source-868b95b69384872926804a54
    resource: repo://celery/app/builtins.py
  - id: openwiki-source-3795aa577fa7b0f3bd2af81a
    resource: repo://celery/app/task.py
  - id: openwiki-source-4a982797c89fcb3ea5c5d0ee
    resource: repo://celery/app/trace.py
generated: { by: "claude-code", at: "2026-11-16T10:42:35.525Z" }
---

# Tasks and Tracing

A task is a `Task` subclass (or a function wrapped by `@app.task`). Calling it directly runs the function as an ordinary call; running it under a worker goes through a *tracer*, a function built by `build_tracer` in `celery/app/trace.py`. The tracer runs the task body, classifies the outcome (success, retry, ignore, reject, or failure), stores the state through the backend, and fires the signals. The `Task` class in `celery/app/task.py` supplies the publishing side (`apply_async`, `retry`, `signature`) and the per-execution `Context` the tracer reads.

## The Task class

`Task` (`celery/app/task.py`, class at line 206) holds class-level options that control execution. The main ones, with their defaults from the class body, are:

- `max_retries = 3` and `default_retry_delay = 3 * 60` seconds for `retry`;
- `ignore_result`, `store_errors_even_if_ignored`, and `track_started` for result storage;
- `acks_late`, `acks_on_failure_or_timeout`, `acks_on_failure`, `acks_on_timeout`, and `reject_on_worker_lost` for acknowledgement behaviour;
- `time_limit`, `soft_time_limit`, `rate_limit`, `expires`, `priority`, and `serializer`;
- `resultrepr_maxsize = 1024`, which truncates the stored textual representation of a return value;
- `send_events = True`, which controls whether the worker emits task events for this task.

Task classes are created per app. `Task.bind(app)` (around line 419) attaches the task to an app and `app` is a class property that resolves the current app. `on_bound` runs after binding, and `add_around` lets extensions wrap `run` or other methods.

`apply_async` (around line 536) builds the message through the app's AMQP component and publishes it. `signature`, `s`, `si`, `chunks`, `map`, and `starmap` (around lines 962–1000) return canvas objects that compose with the rest of the workflow ([canvas](canvas.md)).

## The per-call Context

When the worker runs a task, it builds a `Context` (`celery/app/task.py`, class at line 75) from the message headers and body. `Context` is the object exposed as `self.request` inside a bound task. It holds the task ID, `args` and `kwargs`, `retries`, `callbacks`, `errbacks`, `chain`, `chord`, `group`, `parent_id`, `root_id`, `delivery_info`, `headers`, and stamps. The `called_directly` attribute is true when the task is invoked as a plain function, which lets `retry` raise the original exception instead of scheduling a retry.

## Retrying

`Task.retry(...)` (around lines 756–868) re-publishes the task and then signals the tracer:

1. It increments `retries` and computes `countdown` (default `default_retry_delay`) or `eta`.
2. If `called_directly` is true, it re-raises the supplied exception (or a fresh `Retry`) rather than publishing.
3. If `max_retries` is exceeded, it raises the original `exc`, or `MaxRetriesExceededError` when there is no exception.
4. Otherwise it builds a `Retry` exception carrying the new signature and calls `S.apply_async()`. If publication fails, it raises `Reject(exc, requeue=False)`.
5. It raises the `Retry` exception unless `throw=False`.

`celery/app/autoretry.py` wraps `run` for tasks configured with `autoretry_for` (a tuple of exception classes), with optional `retry_kwargs`, `retry_backoff` (exponential backoff with `retry_backoff_max`, default 600 seconds), and `dont_autoretry_for`. The wrapper calls `task.retry(exc=exc, **retry_kwargs)` for matching exceptions and lets the others propagate.

## build_tracer

`build_tracer(name, task, ...)` (`celery/app/trace.py`, line 344) returns a `trace_task` closure specialised for one task. The closure captures the task's options (store-errors policy, success and failure hooks, signal receivers) once, so the hot path does no per-call configuration lookup. The closure is the function the pool actually runs; `trace_task` (line 689) is the generic wrapper, and `trace_task_ret` and `fast_trace_task` (lines 735 and 757) are the optimised entry points used by the worker.

Inside `trace_task` the order is:

1. Build the request context and, if `track_started` is on, store the `STARTED` state.
2. Send `task_prerun` (through `send_prerun`) and call `fun(*args, **kwargs)`.
3. Classify the outcome:
   - a normal return sets `SUCCESS`; callbacks (`callbacks` and chained tasks) are dispatched before the result is stored, so `result.children` is populated, then `mark_as_done` writes the result, `task_on_success` runs, and `task_success` is sent;
   - `Reject` sets `REJECTED`, handled by `handle_reject`;
   - `Ignore` sets `IGNORED`, handled by `handle_ignore`;
   - `Retry` sets `RETRY` through `on_error` with errbacks disabled, and `handle_retry` stores the retry state when `store_errors` allows it;
   - any other exception goes through `on_error`, which calls `handle_failure`, marks the failure in the backend (and, through `mark_as_failure`, downstream chained steps), and fires errbacks.
4. Send `task_postrun` and log the outcome.

`traceback_clear` is called on exceptions after they are handled to release frames and avoid retaining memory; the code comments cite a memory-leak issue for this.

## State classification

`Info` (`TraceInfo`, line 179) carries the state, the result, and the traceback for the outcome. `handle_error_state` (line 188) chooses `store_errors` from `store_errors_even_if_ignored` and the eager flag, so a task can be ignored yet still have its failure recorded. `get_log_policy` (line 137) decides the logging level for a failure, using the task's `throws` declaration (expected exceptions are logged without tracebacks).

## Built-in tasks

`celery/app/builtins.py` defines the tasks that canvas and backends rely on, registered per app with `connect_on_app_finalize` and `shared=False`: `celery.backend_cleanup`, `celery.accumulate`, `celery.chord_unlock` (retries indefinitely, `max_retries=None`), `celery.map`, `celery.starmap`, `celery.chunks`, `celery.group`, and `celery.chain`. Their names are part of the protocol and should not be changed.

## Invariants and failure behaviour

- The tracer always ends in exactly one state for each execution, and the state is written to the backend unless `ignore_result` or the store policy suppresses it.
- A `Retry` is not a failure: it is recorded as `RETRY` and the message is re-published before the tracer finishes.
- `Reject` with `requeue=False` is how a retry publication failure is reported without re-queuing the message forever.
- `task_success` and `task_failure` signals fire after the state is decided, so receivers observe the final outcome.

## Extension seams

- Set class options on a `Task` subclass, or pass them to `@app.task`.
- Use `autoretry_for` for declarative retries, or call `self.retry` for manual control.
- Connect to the signals in [events and signals](events-and-signals.md) to observe outcomes without changing them.
- Override `Task.__call__` or wrap `run` with `add_around` to add behaviour around the task body.

## Representative tests

`t/unit/tasks/test_tasks.py` covers `Task` behaviour and retries, `t/unit/tasks/test_trace.py` and `t/unit/app/test_trace.py` cover the tracer, and `t/unit/tasks/test_context.py` covers the request `Context`.
