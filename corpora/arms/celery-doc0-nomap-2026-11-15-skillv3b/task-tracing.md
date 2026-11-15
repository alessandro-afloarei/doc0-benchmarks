---
title: "Task Tracing and Execution"
---
## Overview

The tracer is the code that actually calls a task's function. It runs inside the pool (a child process, a thread or a green thread), deserializes the arguments, pushes the request context, calls the function, and turns the outcome into a state: `SUCCESS`, `FAILURE`, `RETRY`, or one of the internal `IGNORED` and `REJECTED`. It stores that state through the result backend, calls the task's handler hooks, sends signals, and sends the next tasks of the workflow. The worker side that handed it the job, and that acknowledges the message afterwards, is on [[Task Requests and Strategies]]; the storage itself is on [[Result Backends]].

Sources: [celery/app/trace.py:344-370](repo://celery/app/trace.py#L344-L370)

## Entry points

`Request.execute_using_pool` submits one of two functions to the pool, both returning `(failed, value, runtime)` to the parent: `(1, ExceptionInfo, runtime)` on failure, `(0, result repr, runtime)` on success. Only the repr goes back on success, which keeps large return values out of the pipe between processes.

Sources: [celery/app/trace.py:735-789](repo://celery/app/trace.py#L735-L789), [celery/worker/request.py:354-368](repo://celery/worker/request.py#L354-L368)

| Function | Used when | What it does |
| --- | --- | --- |
| `fast_trace_task` | Worker optimizations are installed (the normal worker) | Uses the registry, accepted content types and hostname cached in `_localized`, decodes the body, and calls `task.__trace__` |
| `trace_task_ret` | Otherwise | Reads the same from `current_app`, then calls `trace_task` |
| `trace_task` | Both, and `Request.execute` | Builds `task.__trace__` with `build_tracer` on first use, calls it, and turns errors outside the task into an internal-error result |

Sources: [celery/app/trace.py:689-701](repo://celery/app/trace.py#L689-L701), [celery/app/trace.py:735-789](repo://celery/app/trace.py#L735-L789)

Decoding happens here, not in the worker's main process: `loads_message` decodes the body with the content type and encoding from the message and refuses anything not in `accept_content`. The decoded `args`, `kwargs` and embedded `callbacks`, `errbacks`, `chain` and `chord` are merged into the request dict.

Sources: [celery/app/trace.py:735-755](repo://celery/app/trace.py#L735-L755), [celery/app/trace.py:770-789](repo://celery/app/trace.py#L770-L789)

`fast_trace_task` raises a `RuntimeError` explaining the problem when `_localized` is empty, which happens when pool processes are spawned instead of forked (the prefork pool on Windows) and so never ran `setup_worker_optimizations`.

Sources: [celery/app/trace.py:757-769](repo://celery/app/trace.py#L757-L769)

## Building a tracer

`build_tracer(name, task, ...)` returns a closure specialised for one task. It is called for every task when the consumer starts ([[Consumer and Event Loop]]), and by `Task.apply` with `eager=True`. The closure captures everything that does not change between calls: the function to call (`task.run`, unless the task overrides `__call__`), the hooks the task actually overrides (`before_start`, `on_success`, `after_return`, found with `task_has_custom` so unused hooks cost nothing), the loader's `on_task_init` and `on_process_cleanup`, the signal receiver lists, and whether redelivered tasks should be deduplicated.

Sources: [celery/app/trace.py:344-404](repo://celery/app/trace.py#L344-L404), [celery/app/trace.py:131-134](repo://celery/app/trace.py#L131-L134)

The traced function is deliberately one long body with calls inlined, because it runs once per task and every function call shows up in throughput.

Sources: [celery/app/trace.py:464-477](repo://celery/app/trace.py#L464-L477)

## The traced call

### Preparing

The tracer checks that `kwargs` is a mapping, builds the `Context` with `called_directly=False`, and decides whether to publish a result: not when results are ignored (the request's `ignore_result` overrides the task's), and not for eager calls unless `store_eager_result` is set. `track_started` stores a `STARTED` state with the pid and hostname before the call, for tasks that ask for it.

Sources: [celery/app/trace.py:478-494](repo://celery/app/trace.py#L478-L494), [celery/app/trace.py:157-176](repo://celery/app/trace.py#L157-L176)

It then pushes the task on the global task stack and the context on the task's request stack, sends `task_prerun`, calls the loader's `on_task_init`, stores `STARTED` if tracked, calls `before_start`, and finally calls the function.

Sources: [celery/app/trace.py:550-570](repo://celery/app/trace.py#L550-L570)

### Outcomes

```mermaid
flowchart TD
    call["fun(*args, **kwargs)"] -->|returns| ok["dispatch callbacks and chain"]
    ok --> done["backend.mark_as_done"]
    done -->|EncodeError| fail
    done --> success["on_success, task_success, log 'succeeded'"]
    call -->|Reject| rejected["REJECTED: log, no state stored"]
    call -->|Ignore| ignored["IGNORED: log, no state stored"]
    call -->|Retry| retry["RETRY: mark_as_retry, on_retry, task_retry"]
    call -->|Exception| fail["FAILURE: mark_as_failure, on_failure, task_failure, errbacks"]
    success --> after["after_return"]
    retry --> post
    fail --> after
    after --> post["task_postrun, pop stacks, cleanup"]
    rejected --> post
    ignored --> post
```

Sources: [celery/app/trace.py:568-653](repo://celery/app/trace.py#L568-L653)

On success, callbacks and the next chain step are sent before the result is stored, so `result.children` already contains them when the result is written. If the result cannot be serialized (`EncodeError`), the task is recorded as a failure instead. The success path then calls `on_success`, sends `task_success`, and logs `Task <name>[<id>] succeeded in <runtime>s: <result>`, with the result truncated to `resultrepr_maxsize`.

Sources: [celery/app/trace.py:596-638](repo://celery/app/trace.py#L596-L638)

`after_return` runs for `SUCCESS` and `FAILURE` but not for the states in `IGNORE_STATES` (`IGNORED`, `RETRY`, `REJECTED`). In a `finally` block, `task_postrun` is sent with the final state, both stacks are popped, and for non-eager calls the backend's `process_cleanup` and the loader's `on_process_cleanup` run; an exception in cleanup is logged and does not change the outcome.

Sources: [celery/app/trace.py:639-670](repo://celery/app/trace.py#L639-L670)

### Exceptions that steer the outcome

Celery defines three exceptions a task raises on purpose, all subclasses of `TaskPredicate`.

Sources: [celery/exceptions.py:141-204](repo://celery/exceptions.py#L141-L204)

| Exception | Raised by | Tracer result | Worker result |
| --- | --- | --- | --- |
| `Retry` | `task.retry()` | `RETRY` stored with the original exception; `on_retry` and `task_retry` | Message acked if late-ack; `task-retried` event |
| `Ignore` | `task.replace()`, or the task | Nothing stored; logged at `INFO` | Message acked |
| `Reject(reason, requeue)` | The task, or `retry()` when it cannot publish | Nothing stored; logged at `WARNING` | Message rejected, optionally requeued |

Sources: [celery/app/trace.py:571-590](repo://celery/app/trace.py#L571-L590), [celery/worker/request.py:657-677](repo://celery/worker/request.py#L657-L677)

### Failures

Any other exception goes to `on_error`, which re-raises when the tracer was built with `propagate=True` (eager calls with `task_eager_propagates`) and otherwise calls `TraceInfo.handle_failure`. That converts the exception into one that can be pickled with `get_pickleable_exception` (custom exception classes that the caller cannot import or unpickle are wrapped), stores it with the traceback through `mark_as_failure`, calls `on_failure`, sends `task_failure`, and logs it. The traceback frames are then cleared so local variables of the failed call do not stay in memory.

Sources: [celery/app/trace.py:404-410](repo://celery/app/trace.py#L404-L410), [celery/app/trace.py:230-269](repo://celery/app/trace.py#L230-L269), [celery/app/trace.py:314-341](repo://celery/app/trace.py#L314-L341)

The log level follows a policy: `Reject` is a warning, `Ignore` is info, errors outside the task body are critical, exceptions listed in the task's `throws` are logged at `INFO` as "raised expected" without a traceback, and everything else is an error with a traceback.

Sources: [celery/app/trace.py:80-148](repo://celery/app/trace.py#L80-L148), [celery/app/trace.py:270-311](repo://celery/app/trace.py#L270-L311)

`handle_error_state` decides whether failures are stored at all: when results are ignored, only if `store_errors_even_if_ignored`; for eager calls, only with `store_eager_result`.

Sources: [celery/app/trace.py:186-200](repo://celery/app/trace.py#L186-L200)

### Internal errors

An exception raised outside the task body (for example while building the context or in a signal handler) is caught by the outer handler. It sends the `task_internal_error` signal, re-raises for eager calls, and otherwise returns an `ExceptionInfo` marked internal and records a failure if a context exists. `MemoryError` and `Reject` always propagate.

Sources: [celery/app/trace.py:671-687](repo://celery/app/trace.py#L671-L687), [celery/app/trace.py:703-733](repo://celery/app/trace.py#L703-L733), [celery/app/trace.py:791-801](repo://celery/app/trace.py#L791-L801)

## Callbacks, chains and chords

`_dispatch_callbacks_and_chain` sends the follow-up work with the return value as the first argument, the current task as `parent_id`, and the same `root_id`. A single `link` callback is applied directly. Several callbacks are sent together: group callbacks each as their own group, the rest bundled into one group. The chain is carried in the message as a list in reverse order, so the next step is `chain[-1]`, sent with `chain[:-1]` as its own remaining chain; [[Chains, Groups and Chords at Runtime]] shows how `chain` prepares this list.

Sources: [celery/app/trace.py:412-462](repo://celery/app/trace.py#L412-L462)

Chord membership is handled in the backend: `mark_as_done` and `mark_as_failure` call `on_chord_part_return` when the request has a `chord`, which counts finished header tasks and starts the chord body when the last one completes. On failure, `mark_as_failure` also walks the rest of the chain, marking each later step (and the body of a chord step) with the same failure so callers waiting on the end of the chain do not hang, then calls the `link_error` errbacks. Errbacks whose task takes `(request, exc, traceback)` run in the worker; older single-argument errbacks are sent as a group with the failed task id.

Sources: [celery/backends/base.py:180-252](repo://celery/backends/base.py#L180-L252), [celery/backends/base.py:253-300](repo://celery/backends/base.py#L253-L300)

## Redelivered tasks

With late acknowledgement a task can be delivered twice, for example when a worker dies after finishing but before acknowledging. When `worker_deduplicate_successful_tasks` is on, the task is late-ack, and the backend is persistent, the tracer checks redelivered messages: if the id is in this worker's `successful_requests`, or the backend already holds `SUCCESS` for it, the task is skipped. Callbacks and the chain are still dispatched from the stored result when the stored metadata shows no children (needs `result_extended`), and a failure to dispatch them raises `Reject(requeue=True)`.

Sources: [celery/app/trace.py:371-373](repo://celery/app/trace.py#L371-L373), [celery/app/trace.py:495-548](repo://celery/app/trace.py#L495-L548)

## Worker optimizations

`setup_worker_optimizations(app, hostname)`, called by the worker at start-up, makes the app current and default for every thread (so a single app serves the whole process), finalizes it, caches the task registry, the accepted content types and the hostname in `_localized` for `fast_trace_task`, and sets `app.use_fast_trace_task`. Because forked pool children inherit this module state, they skip all of these lookups per task.

Sources: [celery/app/trace.py:804-844](repo://celery/app/trace.py#L804-L844)

It also installs stack protection. The tracer calls `task.run` directly instead of `Task.__call__`, which would push the request again. When a custom task class overrides `__call__` and calls `super().__call__`, the patched `Task.__call__` sees that the tracer already pushed the request and calls `run` without pushing a second one.

Sources: [celery/app/trace.py:847-873](repo://celery/app/trace.py#L847-L873)

## Task states

States are strings with an ordering. `states.state` compares by precedence, so a backend can refuse to overwrite a final state with an earlier one, and custom states (such as `PROGRESS` from `update_state`) rank above the built-in unready states but below `SUCCESS` and `FAILURE`.

Sources: [celery/states.py:60-100](repo://celery/states.py#L60-L100)

| Set | States |
| --- | --- |
| `READY_STATES` | `SUCCESS`, `FAILURE`, `REVOKED` |
| `UNREADY_STATES` | `PENDING`, `RECEIVED`, `STARTED`, `REJECTED`, `RETRY` |
| `EXCEPTION_STATES` | `RETRY`, `FAILURE`, `REVOKED` |
| `PROPAGATE_STATES` | `FAILURE`, `REVOKED` (re-raised by `AsyncResult.get`) |

Sources: [celery/states.py:102-151](repo://celery/states.py#L102-L151)

`PENDING` is never stored: it is what a backend reports for an id it knows nothing about. `RECEIVED` and `REJECTED` appear only in events. [[Task Results and AsyncResult]] shows how callers read these states.

Sources: [celery/states.py:102-120](repo://celery/states.py#L102-L120)
