---
title: "Retries, Failures and Time Limits"
---
## Overview

A task run can end in more ways than success: the task can ask to be retried, raise an error, ask the worker to ignore or reject its message, exceed a time limit, or lose its worker process. Celery treats some of these as control flow rather than errors. `Retry`, `Ignore` and `Reject` are `TaskPredicate` exceptions that tell the worker what to do with the message; anything else is a failure.

Sources: [celery/exceptions.py:1-60](repo://celery/exceptions.py#L1-L60), [celery/exceptions.py:141-203](repo://celery/exceptions.py#L141-L203)

Outcomes are handled in two places. The tracer, inside the pool process, stores state, calls task hooks and sends signals ([[Task Execution Pipeline]]). The `Request`, in the worker's main process, decides whether to acknowledge, reject or requeue the message once the pool reports back.

Sources: [celery/app/trace.py:179-282](repo://celery/app/trace.py#L179-L282), [celery/worker/request.py:622-728](repo://celery/worker/request.py#L622-L728)

## Retrying with Task.retry

`self.retry(args=None, kwargs=None, exc=None, throw=True, eta=None, countdown=None, max_retries=None, **options)` re-sends the current task and raises `Retry` to end the current run. Its steps:

Sources: [celery/app/task.py:756-757](repo://celery/app/task.py#L756-L757)

1. Increment `request.retries`. A `max_retries` argument overrides the task's limit for this call only.
2. If the task was called directly (not by a worker or `apply`), re-raise `exc` or a `Retry` at once; there is nothing to re-send.
3. Without `eta` or `countdown`, use `default_retry_delay` (180 seconds by default).
4. Build the new signature with `signature_from_request`, which reuses the request's execution options (ids, group, chain, links, time limits, headers, stamps) and keeps the message on the same queue: the original priority is kept, and a message that came through the anonymous exchange is sent to the queue named by its routing key.
5. When the limit is exceeded, raise `exc` if given (chained to the current exception), else `MaxRetriesExceededError` with the task's args and kwargs.
6. In eager mode, raise (or return) the `Retry` without sending; `apply` handles it.
7. Otherwise send the signature. If sending fails, raise `Reject(exc, requeue=False)`. Raise the `Retry` unless `throw=False`.

Sources: [celery/app/task.py:756-867](repo://celery/app/task.py#L756-L867), [celery/app/task.py:731-754](repo://celery/app/task.py#L731-L754), [celery/app/task.py:168-196](repo://celery/app/task.py#L168-L196)

```python
@app.task(bind=True)
def tweet(self, auth, message):
    twitter = Twitter(oauth=auth)
    try:
        twitter.post_status_update(message)
    except twitter.FailWhale as exc:
        # Retry in 5 minutes.
        raise self.retry(countdown=60 * 5, exc=exc)
```

Sources: [celery/app/task.py:761-771](repo://celery/app/task.py#L761-L771)

`Retry(message=None, exc=None, when=None, is_eager=False, sig=None)` stores a pickleable copy of the cause and its `repr`, and the delay; `str()` gives `Retry in 300s: <exc>`. When the tracer catches it, `TraceInfo.handle_retry` stores the `RETRY` state with the cause (unless results are ignored), calls `task.on_retry`, sends `task_retry` and logs `Task ... retry: ...`. Errbacks are not called for a retry. On the worker, `Request.on_retry` acknowledges the original message if `acks_late` and sends a `task-retried` event, so the old message is gone and only the newly sent one remains.

Sources: [celery/exceptions.py:145-185](repo://celery/exceptions.py#L145-L185), [celery/app/trace.py:212-240](repo://celery/app/trace.py#L212-L240), [celery/app/trace.py:567-571](repo://celery/app/trace.py#L567-L571), [celery/worker/request.py:613-620](repo://celery/worker/request.py#L613-L620)

## Automatic retries

Declaring `autoretry_for=(SomeError,)` makes `add_autoretry_behaviour` replace `task.run` with a wrapper (once; the original is kept as `_orig_run`). The wrapper calls `task.retry(exc=exc, **retry_kwargs)` for listed exceptions, but re-raises `Ignore`, `Retry` and anything in `dont_autoretry_for` untouched.

Sources: [celery/app/autoretry.py:8-66](repo://celery/app/autoretry.py#L8-L66)

| Option | Default | Effect |
| --- | --- | --- |
| `autoretry_for` | `()` | Exception classes that trigger a retry |
| `dont_autoretry_for` | `()` | Exceptions that are never retried, even if they match |
| `retry_kwargs` | `{}` | Passed to `retry`, for example `{'max_retries': 5}` |
| `retry_backoff` | `False` | Exponential backoff; a number sets the base factor in seconds |
| `retry_backoff_max` | `600` | Upper bound of the backoff delay |
| `retry_jitter` | `True` | Randomize the delay between 0 and the computed value |

Sources: [celery/app/autoretry.py:10-31](repo://celery/app/autoretry.py#L10-L31)

With backoff, the countdown is `min(retry_backoff_max, factor * 2 ** retries)`, where `factor` is `retry_backoff` (at least 1), and with jitter a random integer between 0 and that value. The options can be decorator arguments or class attributes; decorator arguments win.

Sources: [celery/app/autoretry.py:46-59](repo://celery/app/autoretry.py#L46-L59), [celery/utils/time.py:463-477](repo://celery/utils/time.py#L463-L477)

## Ignore and Reject

Raising `Ignore` from a task stops it without storing a state. The tracer records `IGNORED`, which is in `IGNORE_STATES`, so `after_return` is not called, and logs at INFO. On the worker, `on_failure` simply acknowledges the message. `Task.replace` uses `Ignore` this way after sending the replacement ([[Defining Tasks]]).

Sources: [celery/exceptions.py:190-191](repo://celery/exceptions.py#L190-L191), [celery/app/trace.py:555-566](repo://celery/app/trace.py#L555-L566), [celery/app/trace.py:115-115](repo://celery/app/trace.py#L115-L115), [celery/worker/request.py:675-676](repo://celery/worker/request.py#L675-L676)

`Reject(reason=None, requeue=False)` asks the worker to reject the message. With `requeue=True` the message goes back to the queue. With `requeue=False` it will never run again, so the worker stores a `FAILURE` result, sends `task_failure` and a `task-failed` event, "instead of leaving the task stuck in PENDING/STARTED forever" (issue #4222), and then rejects it.

Sources: [celery/exceptions.py:194-203](repo://celery/exceptions.py#L194-L203), [celery/worker/request.py:653-674](repo://celery/worker/request.py#L653-L674)

## Failures in the tracer

Any other exception goes through `TraceInfo.handle_failure`. It converts the exception to a pickleable one (so it can cross back from a pool process), stores it with `backend.mark_as_failure(...)` (which also runs chord handling, chain propagation and errbacks, [[Result Backend Interface]]), calls `task.on_failure`, sends `task_failure`, and logs. Whether the failure is stored at all depends on results: with `ignore_result`, only if `store_errors_even_if_ignored`; in eager mode, only with `store_eager_result`.

Sources: [celery/app/trace.py:188-204](repo://celery/app/trace.py#L188-L204), [celery/app/trace.py:242-282](repo://celery/app/trace.py#L242-L282)

The log level depends on the exception. `get_log_policy` picks:

Sources: [celery/app/trace.py:137-148](repo://celery/app/trace.py#L137-L148)

| Case | Level | Traceback | Description |
| --- | --- | --- | --- |
| `Reject` | WARNING | yes | rejected |
| `Ignore` | INFO | no | ignored |
| Error outside the task body | CRITICAL | yes | INTERNAL ERROR |
| Exception in the task's `throws` | INFO | no | raised expected |
| Any other exception | ERROR | yes | raised unexpected |

Sources: [celery/app/trace.py:137-148](repo://celery/app/trace.py#L137-L148), [celery/app/trace.py:87-104](repo://celery/app/trace.py#L87-L104), [celery/app/trace.py:284-312](repo://celery/app/trace.py#L284-L312)

## Acknowledging failed messages

`Request.on_failure(exc_info, send_failed_event=True, return_ok=False)` runs in the main process when the pool reports an error. For an ordinary failure of a task without `acks_late`, the message was already acknowledged when the task started; for `acks_late` tasks it decides now:

Sources: [celery/worker/request.py:622-626](repo://celery/worker/request.py#L622-L626)

| Condition (`acks_late`) | Message |
| --- | --- |
| `WorkerLostError` and `reject_on_worker_lost` | Rejected with requeue; no failure stored |
| `TimeLimitExceeded` and `acks_on_timeout` false | Rejected with requeue; no failure stored |
| Timeout with `acks_on_timeout`, or failure with `acks_on_failure` | Acknowledged |
| Otherwise | Rejected without requeue |

Sources: [celery/worker/request.py:680-700](repo://celery/worker/request.py#L680-L700)

`acks_on_failure` and `acks_on_timeout` both default to `True`, falling back to the older combined `acks_on_failure_or_timeout` when it is set ([[Defining Tasks]]). The `reject_on_worker_lost` docstring warns that requeueing on a lost worker "can cause message loops". Unless the message was requeued, the worker stores the failure itself when the worker process was lost, because the process "would not have had time to write the result", and sends `task_failure`; it then sends a `task-failed` event and logs `Task handler raised error` for failures the pool reported directly. During a cold shutdown it skips the event.

Sources: [celery/app/task.py:323-370](repo://celery/app/task.py#L323-L370), [celery/app/task.py:428-440](repo://celery/app/task.py#L428-L440), [celery/worker/request.py:700-728](repo://celery/worker/request.py#L700-L728)

A `Terminated` exception (the job was killed by revoke with `terminate`) is reported as revoked unless the request was already cancelled or revoked, and a `MemoryError` is re-raised in the main process.

Sources: [celery/worker/request.py:631-652](repo://celery/worker/request.py#L631-L652)

## Time limits

Each task has a soft and a hard limit, from the task's `soft_time_limit` and `time_limit` attributes (defaulting to the `task_soft_time_limit` and `task_time_limit` settings), the worker's `--soft-time-limit` and `--time-limit`, or the message's `timelimit` header set by `apply_async(time_limit=..., soft_time_limit=...)`. The request passes the message's values, falling back to the task's, to the pool. A class whose soft limit exceeds its hard limit is refused in `apply_async` with `ValueError`.

Sources: [celery/worker/request.py:818-845](repo://celery/worker/request.py#L818-L845), [celery/app/task.py:398-412](repo://celery/app/task.py#L398-L412), [celery/app/task.py:658-661](repo://celery/app/task.py#L658-L661), [celery/bin/worker.py:221-232](repo://celery/bin/worker.py#L221-L232)

When the soft limit passes, the pool raises `SoftTimeLimitExceeded` inside the task, which can catch it to clean up; the request only logs a warning. When the hard limit passes, the pool kills the job and `on_timeout(soft=False, timeout)` marks the request ready, logs `Hard time limit ... exceeded`, stores `TimeLimitExceeded` as the failure, and runs the same hooks a normal failure would: `task.on_failure`, `after_return` if overridden, the `task_failure` signal and a `task-failed` event. During a cold shutdown it skips storing. For `acks_late` tasks it then acknowledges if `acks_on_timeout`, and otherwise requeues the message.

Sources: [celery/worker/request.py:529-594](repo://celery/worker/request.py#L529-L594), [celery/exceptions.py:56-60](repo://celery/exceptions.py#L56-L60)

Which pools enforce limits, and how, is covered in [[Concurrency Pools]].

Sources: [celery/worker/components.py:150-158](repo://celery/worker/components.py#L150-L158)

## Exceptions reference

`celery.exceptions` documents the hierarchy in its docstring. The ones met most often:

Sources: [celery/exceptions.py:1-10](repo://celery/exceptions.py#L1-L10)

| Exception | Raised when |
| --- | --- |
| `Retry`, `Ignore`, `Reject` | By tasks, as described above |
| `MaxRetriesExceededError` | `retry()` beyond `max_retries` |
| `TimeLimitExceeded`, `SoftTimeLimitExceeded` | Hard and soft limits (from billiard) |
| `WorkerLostError`, `Terminated` | The pool process died or was killed (from billiard) |
| `TaskRevokedError` | A revoked request reaches the pool, or is stored as the revoked result |
| `NotRegistered` | A message names a task the worker does not know |
| `InvalidTaskError` | A message is malformed (bad args, kwargs, ETA or expiry) |
| `ChordError` | A chord's header failed or its body could not be sent |
| `TimeoutError` | A client wait on a result timed out |
| `ImproperlyConfigured`, `SecurityError` | Bad configuration; unsafe content or privileges |
| `BackendGetMetaError`, `BackendStoreError` | Backend reads or writes failed after retries |
| `WorkerShutdown`, `WorkerTerminate` | `SystemExit` subclasses used to stop the worker warm or cold |
| `OperationalError` | A broker connection error while sending (from Kombu) |

Sources: [celery/exceptions.py:1-60](repo://celery/exceptions.py#L1-L60), [celery/exceptions.py:206-305](repo://celery/exceptions.py#L206-L305)
