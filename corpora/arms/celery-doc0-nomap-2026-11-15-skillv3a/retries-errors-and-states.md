---
title: "Retries, Errors and Task States"
---
## Overview

A task run ends in one of a few outcomes: it returns, it raises an exception, it asks to be retried, it asks to be ignored, or it rejects its message. Celery models these as task states stored in the result backend and as a small set of exception classes ("semi-predicates") that a task raises to tell the worker which outcome it wants. This page describes the retry mechanism, the exception types and the state model. How the worker reacts to each outcome (acknowledging, requeueing, storing) is traced in [[Task Execution and Tracing]].

Sources: [celery/exceptions.py:1-52](repo://celery/exceptions.py#L1-L52), [celery/states.py:126-151](repo://celery/states.py#L126-L151)

## Retrying a task

### Task.retry

`self.retry()` re-sends the current task as a new message with the same task id and an incremented `retries` count, then raises `Retry` so the current execution stops and is recorded as `RETRY` rather than `FAILURE`. The idiom is `raise self.retry(exc=exc, countdown=60)` inside an `except` block of a bound task.

Sources: [celery/app/task.py:756-817](repo://celery/app/task.py#L756-L817)

Step by step, `retry` does the following:

Sources: [celery/app/task.py:818-867](repo://celery/app/task.py#L818-L867)

1. Computes `retries = request.retries + 1` and the effective `max_retries` (an argument overrides the class attribute for this attempt only).
2. If the task was called directly as a function, there is nothing to re-send: it re-raises `exc` (or a `Retry`) in the caller.
3. Uses `default_retry_delay` as `countdown` when neither `eta` nor `countdown` is given.
4. Builds the new signature with `signature_from_request`, which copies the request's execution options (id, group, chord, chain, callbacks, headers, time limits) and delivery info, so the retry lands on the same exchange and routing key, or the same queue for messages sent to the default exchange, with the same priority.
5. If `retries` exceeds `max_retries`, raises `exc` if given, else `MaxRetriesExceededError` carrying the task's args and kwargs.
6. Otherwise creates `Retry(exc=exc, when=eta or countdown, sig=S)`. In eager mode it raises that immediately (`Task.apply` then re-runs the signature); in a worker it calls `S.apply_async()` and raises it.

Sources: [celery/app/task.py:731-754](repo://celery/app/task.py#L731-L754), [celery/app/task.py:818-867](repo://celery/app/task.py#L818-L867)

If publishing the retry message fails, `retry` raises `Reject(exc, requeue=False)` instead, so the worker does not mark the task as waiting for a retry that will never arrive. Passing `throw=False` returns the `Retry` instead of raising it; the task then finishes normally and is marked successful or failed according to what it does next.

Sources: [celery/app/task.py:861-867](repo://celery/app/task.py#L861-L867)

```python
@app.task(bind=True, max_retries=5, default_retry_delay=30)
def charge(self, order_id):
    try:
        gateway.charge(order_id)
    except gateway.Timeout as exc:
        raise self.retry(exc=exc)
```

Sources: [celery/app/task.py:760-772](repo://celery/app/task.py#L760-L772)

### Automatic retries

Setting `autoretry_for=(SomeError,)` on a task makes `add_autoretry_behaviour` wrap `run`. When the wrapped function raises one of those exceptions (and not one in `dont_autoretry_for`, and not `Ignore` or `Retry`), the wrapper calls `task.retry(exc=exc, **retry_kwargs)` and raises the result. The wrapper is installed once per task, guarded by `_orig_run`.

Sources: [celery/app/autoretry.py:8-66](repo://celery/app/autoretry.py#L8-L66)

| Option | Default | Meaning |
| --- | --- | --- |
| `autoretry_for` | `()` | Exception classes that trigger a retry |
| `dont_autoretry_for` | `()` | Subclasses to exclude |
| `retry_kwargs` | `{}` | Passed to `retry` (`max_retries`, `countdown`…) |
| `retry_backoff` | `False` | `True` or a factor in seconds for exponential backoff |
| `retry_backoff_max` | `600` | Upper bound of the computed delay |
| `retry_jitter` | `True` | Randomize the delay in `[0, delay]` |

Sources: [celery/app/autoretry.py:10-31](repo://celery/app/autoretry.py#L10-L31)

With backoff enabled the countdown is `min(retry_backoff_max, factor * 2 ** retries)`, and with jitter a random integer between 0 and that value ("full jitter"), which spreads retries of many failing tasks over time instead of synchronizing them.

Sources: [celery/utils/time.py:463-477](repo://celery/utils/time.py#L463-L477), [celery/app/autoretry.py:48-54](repo://celery/app/autoretry.py#L48-L54)

## Exceptions a task can raise

### Semi-predicates

`Retry`, `Ignore` and `Reject` subclass `TaskPredicate`. They are not failures: the tracer catches each one separately and records a matching outcome.

Sources: [celery/exceptions.py:141-203](repo://celery/exceptions.py#L141-L203), [celery/app/trace.py:586-604](repo://celery/app/trace.py#L586-L604)

| Exception | Raised by | Effect |
| --- | --- | --- |
| `Retry(message, exc, when, sig)` | `Task.retry` | State `RETRY` stored with `exc`; `on_retry` and `task_retry` signal run; message acknowledged |
| `Ignore()` | The task, or `Task.replace` | No state stored, no handlers; the message is acknowledged |
| `Reject(reason, requeue=False)` | The task | The message is rejected (requeued if `requeue=True`); without requeue a `FAILURE` is stored |

Sources: [celery/app/trace.py:212-241](repo://celery/app/trace.py#L212-L241), [celery/worker/request.py:649-675](repo://celery/worker/request.py#L649-L675)

`Retry` keeps a pickleable copy of the causing exception and its `repr`, and its `__str__` renders as `Retry in 30s: ConnectionError(...)` in logs.

Sources: [celery/exceptions.py:145-184](repo://celery/exceptions.py#L145-L184)

### Failures

Any other exception is a failure. The tracer converts it to a pickleable exception (`get_pickleable_exception`), stores state `FAILURE` with the traceback, calls errbacks, runs `on_failure` and sends `task_failure`. Exceptions listed in the task's `throws` attribute are expected errors: they are logged at a lower level without a traceback but still stored as failures.

Sources: [celery/app/trace.py:242-283](repo://celery/app/trace.py#L242-L283), [celery/app/trace.py:137-147](repo://celery/app/trace.py#L137-L147)

Some exceptions come from the pool rather than the task code; they are re-exported from billiard.

Sources: [celery/exceptions.py:56](repo://celery/exceptions.py#L56), [celery/exceptions.py:86-88](repo://celery/exceptions.py#L86-L88)

| Exception | Cause |
| --- | --- |
| `SoftTimeLimitExceeded` | Raised inside the task when `soft_time_limit` passes; the task can catch it to clean up |
| `TimeLimitExceeded` | The hard `time_limit` passed and the child process was killed |
| `WorkerLostError` | The child process exited unexpectedly (signal, segfault, OOM) |
| `Terminated` | The task was revoked with `terminate=True` |

Sources: [celery/worker/request.py:622-697](repo://celery/worker/request.py#L622-L697)

With `acks_late`, `reject_on_worker_lost=True` requeues a task whose worker process was lost, and `acks_on_timeout=False` requeues one that hit the hard limit; otherwise the message is acknowledged and the failure stored.

Sources: [celery/worker/request.py:677-711](repo://celery/worker/request.py#L677-L711)

### Errors seen by callers and operators

| Exception | Meaning |
| --- | --- |
| `NotRegistered` | A message named a task the worker has not imported |
| `InvalidTaskError` | A message is malformed (bad args/kwargs, bad ETA) |
| `TaskRevokedError` | The task was revoked; raised by `get()` |
| `TimeoutError` | `AsyncResult.get(timeout=...)` expired |
| `ChordError` | A chord header task failed, so the body cannot run |
| `QueueNotFound` | A task was routed to a queue missing from `task_queues` |
| `BackendGetMetaError`, `BackendStoreError` | Reading or writing a result failed |
| `ImproperlyConfigured` | Invalid or inconsistent settings |
| `OperationalError` (kombu) | The broker connection failed while publishing |
| `WorkerShutdown`, `WorkerTerminate` | `SystemExit` subclasses that request warm or cold worker shutdown |

Sources: [celery/exceptions.py:206-305](repo://celery/exceptions.py#L206-L305)

## Task states

### Built-in states

States are plain strings. The built-in ones are listed below; tasks can store custom states (for example `PROGRESS`) with `update_state`.

Sources: [celery/states.py:126-142](repo://celery/states.py#L126-L142)

| State | Set by |
| --- | --- |
| `PENDING` | Default for any unknown id; never stored by Celery itself |
| `RECEIVED` | Events only: the worker received the message |
| `STARTED` | The worker began running it, if `track_started` is on |
| `RETRY` | The task raised `Retry` |
| `SUCCESS` | The task returned |
| `FAILURE` | The task raised, or rejected without requeue |
| `REVOKED` | The task was revoked or expired |
| `REJECTED` | Events only: the message was rejected |
| `IGNORED` | Internal outcome of `Ignore`; not stored |

Sources: [celery/states.py:126-142](repo://celery/states.py#L126-L142), [celery/app/trace.py:572-576](repo://celery/app/trace.py#L572-L576)

### State sets

The state sets drive the result API: `READY_STATES` (`SUCCESS`, `FAILURE`, `REVOKED`) end `AsyncResult.get()`, `EXCEPTION_STATES` mean the stored result is an exception, and `PROPAGATE_STATES` (`FAILURE`, `REVOKED`) are re-raised by `get(propagate=True)`. See [[Task Results]].

Sources: [celery/states.py:144-151](repo://celery/states.py#L144-L151), [celery/result.py:191-196](repo://celery/result.py#L191-L196)

### Precedence

States arrive out of order from different sources (events, the backend, retries), so the `state` class compares states by precedence rather than alphabetically: `SUCCESS` and `FAILURE` are highest, any custom state comes next, then `REVOKED`, `STARTED`, `RECEIVED`, `REJECTED`, `RETRY`, and `PENDING` lowest. Code that merges updates, such as the events state tracker in [[Events and Monitoring]], keeps the higher state so a late `STARTED` cannot overwrite `SUCCESS`.

Sources: [celery/states.py:61-123](repo://celery/states.py#L61-L123)
