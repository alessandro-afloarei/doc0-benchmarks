---
title: "Retries, Failures and Time Limits"
---
## Overview

A task body ends in one of five ways: it returns, it raises, it asks to be retried, it rejects its message, or it ignores its result. The worker also ends a task that runs past its time limit. The code that decides which of these happens and what is stored sits in three places: `Task.retry` in `celery/app/task.py`, the handlers in `celery/app/trace.py`, and the timeout handler in `celery/worker/request.py`. This page covers the decisions. The tracer's order of steps is in [[Task Execution Tracing]].

Sources: [celery/app/task.py:756-770](repo://celery/app/task.py#L756-L770), [celery/app/trace.py:187-205](repo://celery/app/trace.py#L187-L205), [celery/worker/request.py:529-536](repo://celery/worker/request.py#L529-L536)

## Retrying with Task.retry

`retry` builds the next message from the current request. It adds one to the retry count, uses `countdown` or `eta`, and falls back to `default_retry_delay` when neither is given. The class defaults are three retries and three minutes between them.

Sources: [celery/app/task.py:818-833](repo://celery/app/task.py#L818-L833), [celery/app/task.py:239-245](repo://celery/app/task.py#L239-L245)

Before it re-publishes, `retry` compares the new count with `max_retries`. When the count is over the limit, it raises `MaxRetriesExceededError`, or re-raises the exception it was given. An override passed as `max_retries=` replaces the task's value for this call only.

Sources: [celery/app/task.py:820-822](repo://celery/app/task.py#L820-L822), [celery/app/task.py:841-850](repo://celery/app/task.py#L841-L850)

`retry` then creates a `Retry` predicate that carries the new signature. A call made by `apply` runs the retry in the same process. In a worker it sends the signature with `apply_async`, and if the send fails it raises `Reject` with `requeue=False`, so the message is not kept for another try. When `throw` is true, the predicate is raised so that the tracer handles it; otherwise it is returned to the caller.

Sources: [celery/app/task.py:852-867](repo://celery/app/task.py#L852-L867)

## Automatic retries

`add_autoretry_behaviour` wraps `run` for tasks that list exceptions in `autoretry_for`. The backoff settings are read from the same place: `retry_backoff` turns on exponential backoff, capped by `retry_backoff_max` (600 seconds by default), and `retry_jitter` (true by default) adds jitter to the countdown.

Sources: [celery/app/autoretry.py:8-31](repo://celery/app/autoretry.py#L8-L31)

When an exception matches, the wrapper computes the countdown with `get_exponential_backoff_interval` from the current retry count, and it passes `max_retries` to `retry`. An exception in `dont_autoretry_for` is re-raised unchanged, and an `Ignore` raised inside the task is not retried even when it matches the list.

Sources: [celery/app/autoretry.py:33-60](repo://celery/app/autoretry.py#L33-L60)

## Retry, Ignore and Reject in the tracer

The tracer treats `Retry`, `Ignore` and `Reject` as predicates, not failures. `Retry` is recorded with the `RETRY` state. `handle_retry` writes it with `mark_as_retry`, calls `on_retry`, sends the `task_retry` signal and logs the retry, and it runs only when the body raised `Retry`.

Sources: [celery/app/trace.py:212-230](repo://celery/app/trace.py#L212-L230), [celery/app/trace.py:599-603](repo://celery/app/trace.py#L599-L603)

`Ignore` and `Reject` are defined in `exceptions.py` as subclasses of the predicate base. The tracer sets the `IGNORED` or `REJECTED` state and calls `handle_ignore` or `handle_reject` with the request.

Sources: [celery/exceptions.py:145-200](repo://celery/exceptions.py#L145-L200), [celery/app/trace.py:587-598](repo://celery/app/trace.py#L587-L598)

## What is stored on failure

The tracer decides whether to store a failure in `handle_error_state`. If the task ignores its result, the decision follows `store_errors_even_if_ignored`. An eager run stores when `store_eager_result` is set. Otherwise a failure is stored unless the run is eager.

Sources: [celery/app/trace.py:187-197](repo://celery/app/trace.py#L187-L197)

```python
if ignore_result:
    store_errors = task.store_errors_even_if_ignored
elif eager and task.store_eager_result:
    store_errors = True
else:
    store_errors = not eager
```

Sources: [celery/app/trace.py:187-205](repo://celery/app/trace.py#L187-L205)

`handle_failure` makes the exception picklable so that only a picklable value goes back to the parent. It calls `mark_as_failure` with `store_result` set from the decision above and with `call_errbacks`, so the error callbacks run from there. It then calls the task's `on_failure` hook.

Sources: [celery/app/trace.py:242-266](repo://celery/app/trace.py#L242-L266)

## Time limits

The `time_limit` and `soft_time_limit` attributes come from the `task_time_limit` and `task_soft_time_limit` settings when the task is bound. `apply_async` checks that the soft limit is not larger than the hard limit before sending.

Sources: [celery/app/task.py:400-401](repo://celery/app/task.py#L400-L401), [celery/app/task.py:660-661](repo://celery/app/task.py#L660-L661)

The pool calls the request's timeout handler with a flag that says which limit was hit. A soft timeout only logs a warning, and the task keeps running. The hard branch is the one that ends the request.

Sources: [celery/worker/request.py:529-536](repo://celery/worker/request.py#L529-L536)

A hard timeout is handled in the parent. The request marks itself ready, and unless the worker is shutting down cold it builds a `TimeLimitExceeded` error, stores it with `mark_as_failure` when `store_errors` allows, and then calls the task's `on_failure` and `after_return` hooks, so the same failure hooks run as for an exception raised by the body.

Sources: [celery/worker/request.py:537-560](repo://celery/worker/request.py#L537-L560)

Acknowledgement after a timeout is a separate setting. `acks_on_timeout` and `acks_on_failure` default to the combined `acks_on_failure_or_timeout` setting, which is described in [[Defining Tasks]].

Sources: [celery/app/task.py:432-443](repo://celery/app/task.py#L432-L443)

## Storage and signals

Every path above writes through the result backend, which is described in [[Result Backend Contract]], and sends a signal named after the event, which is listed in [[Signals]].

Sources: [celery/app/trace.py:625-627](repo://celery/app/trace.py#L625-L627), [celery/app/trace.py:226-227](repo://celery/app/trace.py#L226-L227)
