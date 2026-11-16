---
title: "Task Execution Tracing"
---
## Overview

The tracer is the function that runs a task body and records what happened. `build_tracer` in `celery/app/trace.py` makes one closure per task. The worker calls that closure for each message it executes, and it does so in the process the pool gives it, which is a child process for the prefork pool. The tracer sends the lifecycle signals, writes the state to the result backend, and returns a summary to the parent. Message handling in the parent is covered in [[Task Requests in the Worker]].

Sources: [celery/app/trace.py:344-391](repo://celery/app/trace.py#L344-L391), [celery/app/trace.py:475-490](repo://celery/app/trace.py#L475-L490)

## Building the tracer

`build_tracer` reads the task's settings once, when the tracer is built, and keeps them as local names. These include `store_errors`, `ignore_result`, `track_started`, `task_on_success` and the custom hooks `before_start`, `on_success` and `after_return` when the task defines them.

Sources: [celery/app/trace.py:344-357](repo://celery/app/trace.py#L344-L357), [celery/app/trace.py:391-398](repo://celery/app/trace.py#L391-L398)

The signal receivers are also read once. `prerun`, `postrun` and `success` receivers are kept as lists, and the tracer checks each list before sending, so a signal with no receivers costs one test.

Sources: [celery/app/trace.py:410-415](repo://celery/app/trace.py#L410-L415)

## Running the body

Before the body runs, the tracer sends `task_prerun`, initializes the loader state for the task, and, when `track_started` is on, stores a `STARTED` state that includes the process id and the host name.

Sources: [celery/app/trace.py:568-579](repo://celery/app/trace.py#L568-L579)

The body is called as `fun(*args, **kwargs)`, and a normal return sets the state to `SUCCESS`. The exceptions the worker understands are handled separately, so each has its own state and bookkeeping.

Sources: [celery/app/trace.py:580-586](repo://celery/app/trace.py#L580-L586)

```python
R = retval = fun(*args, **kwargs)
state = SUCCESS
```

Sources: [celery/app/trace.py:580-586](repo://celery/app/trace.py#L580-L586)

`Reject` and `Ignore` are handled by their `Info` helpers, which set `REJECTED` or `IGNORED` and run the matching `handle_reject` or `handle_ignore` on the request. `Retry` is recorded as `RETRY` with error callbacks skipped, and any other exception goes to `on_error` with the `FAILURE` state. Each branch clears the traceback frames of the exception afterwards; the code comments name memory retention as the reason.

Sources: [celery/app/trace.py:587-609](repo://celery/app/trace.py#L587-L609), [celery/app/trace.py:417-424](repo://celery/app/trace.py#L417-L424)

## The success path

On success the tracer dispatches the callbacks and the chain before the result is stored. The comment in the code gives the reason: the callbacks must exist before the result is written, so that `result.children` is populated for a reader that sees the stored state.

Sources: [celery/app/trace.py:610-626](repo://celery/app/trace.py#L610-L626)

After the callbacks, `mark_as_done` writes the result and state through the backend. A value that cannot be encoded raises `EncodeError`, which is turned into a failure state rather than a crash in the worker.

Sources: [celery/app/trace.py:625-632](repo://celery/app/trace.py#L625-L632)

The success hook and the `task_success` signal then run, and the success line is logged with the return value, the runtime, and the argument representations taken from the request. The representations are used when present, so the log does not recompute them.

Sources: [celery/app/trace.py:634-648](repo://celery/app/trace.py#L634-L648)

## Redelivered messages

A message can arrive a second time after a worker was lost. When `deduplicate_successful_tasks` is set and the message is marked as redelivered, the tracer checks whether the task id is already in its record of successes. If not, it asks the backend for the state of the task id, and a task the backend reports as successful is not run again.

Sources: [celery/app/trace.py:505-520](repo://celery/app/trace.py#L505-L520)

## The post-run step

After the state is decided, the tracer sends `task_postrun` with the state and the return value. When the state is not one of the ignored states, the `after_return` hook runs first. For a run that is not eager, the tracer then calls the backend's `process_cleanup` and the loader's cleanup. An exception there is logged as a process-cleanup failure, so it does not end the worker.

Sources: [celery/app/trace.py:650-672](repo://celery/app/trace.py#L650-L672)

## Fast path

The worker can call a faster function than the closure. `setup_worker_optimizations` sets the current and default app to the worker's app, finalizes it, and stores the task registry, the accepted content types and the host name in a module-level list. It then sets `use_fast_trace_task`, which the request code checks before it chooses the fast function.

Sources: [celery/app/trace.py:804-831](repo://celery/app/trace.py#L804-L831)

`fast_trace_task` does the same job for a message body it receives directly. It decodes the body with the accepted content types, copies the arguments and the embedded callbacks into the request, and calls the task's tracer. It returns a tuple whose first item says whether the state was an exception.

Sources: [celery/app/trace.py:757-788](repo://celery/app/trace.py#L757-L788)

If the worker registry is empty, `fast_trace_task` raises a `RuntimeError` that names the cause. The message says the optimizations were never set up in that process, which happens when the process was spawned rather than forked. The message suggests the solo or threads pool.

Sources: [celery/app/trace.py:763-774](repo://celery/app/trace.py#L763-L774)

`reset_worker_optimizations` undoes the setup. It removes the stack-protection marker from the base task, restores the original `__call__` if it was patched, and sets `use_fast_trace_task` back to `False`. The request and the failure policy are explained in [[Task Requests in the Worker]] and [[Retries, Failures and Time Limits]].

Sources: [celery/app/trace.py:834-844](repo://celery/app/trace.py#L834-L844)
