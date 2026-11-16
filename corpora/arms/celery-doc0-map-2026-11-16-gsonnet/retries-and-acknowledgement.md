---
title: "Retries, Failures and Acknowledgement"
---
## Overview

Celery delivers a task message at least once, so what the worker does with the message when a task does not return normally decides whether the work is lost, repeated or recorded as failed. Three layers share that decision. The task body can ask for a retry or rejection by raising `Retry`, `Reject` or `Ignore`. The tracer in the pool process turns exceptions into states and stores them. The `Request` in the main worker process then acknowledges, rejects or requeues the broker message according to `acks_late` and its companions.

Sources: [celery/app/task.py:756-866](repo://celery/app/task.py#L756-L866), [celery/app/trace.py:586-639](repo://celery/app/trace.py#L586-L639), [celery/worker/request.py:596-621](repo://celery/worker/request.py#L596-L621), [celery/worker/request.py:677-699](repo://celery/worker/request.py#L677-L699)

The normal path of a successful task is on [[Receiving and Executing Tasks]]; this page follows the other branches.

Sources: [celery/app/trace.py:475-535](repo://celery/app/trace.py#L475-L535)

## Retrying a task

`Task.retry` does not re-run the function. It sends a new message for the same task and then raises `Retry` to tell the tracer to record the state as `RETRY`. The defaults are `max_retries = 3` and `default_retry_delay = 3 * 60` seconds. A call in a task that was invoked directly (not by a worker) re-raises the original exception, or a `Retry`, so a retry outside the worker cannot silently loop.

Sources: [celery/app/task.py:241-245](repo://celery/app/task.py#L241-L245), [celery/app/task.py:756-760](repo://celery/app/task.py#L756-L760), [celery/app/task.py:815-830](repo://celery/app/task.py#L815-L830)

The steps inside `retry` are:

Sources: [celery/app/task.py:819-866](repo://celery/app/task.py#L819-L866)

1. `retries = request.retries + 1`, and an explicit `max_retries` argument overrides the class value for this execution through `override_max_retries`.
2. If neither `eta` nor `countdown` is given, `countdown` becomes `default_retry_delay`.
3. A signature for the retry is built with `signature_from_request`, which copies the current request's arguments and execution options, the priority and the queue the message came from. A message sent to the anonymous exchange is sent back to the queue named by its routing key.
4. When `retries > max_retries`, it raises `exc` if one was given and otherwise `MaxRetriesExceededError` carrying the task arguments.
5. For an eager task the `Retry` is raised or returned for `apply` to handle. Otherwise it calls `S.apply_async()`. A failure to publish the retry raises `Reject(exc, requeue=False)`, so the original message is dropped rather than looping.
6. With `throw=True` the `Retry` exception is raised.

Sources: [celery/app/task.py:731-754](repo://celery/app/task.py#L731-L754), [celery/app/task.py:819-866](repo://celery/app/task.py#L819-L866)

`Retry` keeps the original exception in a pickleable form (`get_pickleable_exception`) alongside its repr, and `when` holds the countdown or ETA used in its message. `Reject` carries a `reason` and a `requeue` flag, and `Ignore` has no state.

Sources: [celery/exceptions.py:145-200](repo://celery/exceptions.py#L145-L200)

## Automatic retries

`add_autoretry_behaviour` is applied when a task is created or registered. If `autoretry_for` is non-empty it replaces `task.run` with a wrapper around the original, stored as `_orig_run`. The wrapper lets `Ignore`, `Retry` and anything in `dont_autoretry_for` propagate, and for any exception in `autoretry_for` calls `task.retry(exc=exc, **retry_kwargs)`. With `retry_backoff`, the countdown comes from `get_exponential_backoff_interval` using the current retry count, capped by `retry_backoff_max` (default 600) and with jitter on by default.

Sources: [celery/app/autoretry.py:8-66](repo://celery/app/autoretry.py#L8-L66)

## How the tracer records a failure

The tracer maps exceptions raised by the task to states. `Reject` and `Ignore` become `REJECTED` and `IGNORED` and are only logged. `Retry` calls `on_error` with state `RETRY` and `call_errbacks=False`. Any other `Exception` calls `on_error` as `FAILURE`. Each branch calls `traceback_clear` to release frames and avoid keeping large objects alive.

Sources: [celery/app/trace.py:417-424](repo://celery/app/trace.py#L417-L424), [celery/app/trace.py:586-615](repo://celery/app/trace.py#L586-L615)

`TraceInfo.handle_error_state` decides whether to store the error: if the result is ignored, only when `store_errors_even_if_ignored` is set; for eager tasks only when `store_eager_result` is set; otherwise whenever the task is not eager. It then calls `handle_retry` or `handle_failure`.

Sources: [celery/app/trace.py:188-204](repo://celery/app/trace.py#L188-L204)

`handle_retry` stores the `RETRY` state with `mark_as_retry`, calls `task.on_retry`, sends `task_retry` and logs. `handle_failure` converts the exception to a pickleable one (`get_pickleable_exception`, so the parent process can always receive it), calls `backend.mark_as_failure` with the errbacks, then `task.on_failure`, sends `task_failure` and logs through `_log_error`, which applies the logging policy for the exception type. Failure storage also drives chord error propagation; see [[Groups and Chords]].

Sources: [celery/app/trace.py:212-282](repo://celery/app/trace.py#L212-L282)

## Acknowledgement in the Request

The broker message is acknowledged by the `Request`, in the worker's main process, not by the tracer. By default it is acknowledged before the task runs. In `execute`, and in `on_accepted` when the pool starts a job, an early-ack task is acknowledged immediately; with `acks_late` the acknowledgement waits for the outcome.

Sources: [celery/worker/request.py:374-406](repo://celery/worker/request.py#L374-L406), [celery/worker/request.py:515-527](repo://celery/worker/request.py#L515-L527)

The pool reports an outcome to one of three handlers, so each case acknowledges differently:

Sources: [celery/worker/request.py:596-621](repo://celery/worker/request.py#L596-L621)

| Outcome | Handler | Acknowledgement |
| --- | --- | --- |
| Task returned | `on_success` | Acknowledged now if `acks_late`; `task-succeeded` event sent |
| Task raised `Retry` | `on_retry` | Acknowledged now if `acks_late`; `task-retried` event sent |
| Task raised anything else, or the process died | `on_failure` | Depends on the flags below |

Sources: [celery/worker/request.py:596-621](repo://celery/worker/request.py#L596-L621), [celery/worker/request.py:622-735](repo://celery/worker/request.py#L622-L735)

`on_success` also receives a tracer result that says it failed: the tracer returns `(1, R, T)` for an internal failure, and `on_success` forwards that to `on_failure` with `return_ok=True` so the failure is handled once, and re-raises `SystemExit` and `KeyboardInterrupt`.

Sources: [celery/worker/request.py:596-612](repo://celery/worker/request.py#L596-L612)

`on_failure` examines the exception in order:

Sources: [celery/worker/request.py:622-676](repo://celery/worker/request.py#L622-L676)

- `Terminated` means the process was killed on purpose; unless it was already cancelled or revoked, the request is announced as revoked, and nothing else happens.
- `MemoryError` is re-raised as a worker-level error.
- `Reject` rejects the message with its `requeue` flag. When `requeue` is false it also stores a terminal `FAILURE` state, sends `task_failure` and a `task-failed` event, so the task does not stay pending forever.
- `Ignore` acknowledges.
- `Retry` calls `on_retry`.

Sources: [celery/worker/request.py:622-676](repo://celery/worker/request.py#L622-L676)

Any other exception then goes through the late-acknowledgement rules. These apply only when `acks_late` is set, in this order:

Sources: [celery/worker/request.py:677-699](repo://celery/worker/request.py#L677-L699)

- With `reject_on_worker_lost` and a `WorkerLostError`, or a time limit that is not configured to acknowledge (`acks_on_timeout` false), the message is rejected with `requeue=True`, and the failure is not recorded or announced because the task will run again.
- Otherwise if the flag for the failure kind is true (`acks_on_failure`, or `acks_on_timeout` for a time-limit error), the message is acknowledged.
- Otherwise the message is rejected without requeue, which removes it from the local prefetch queue.

Sources: [celery/worker/request.py:677-699](repo://celery/worker/request.py#L677-L699)

If the message was not requeued, `on_failure` then calls `backend.mark_as_failure` and sends `task_failure` when the process was lost or the failure was not already handled by the tracer (`return_ok` false). During a cold shutdown (`state.should_terminate`) it skips the event and the duplicate handling. The `Task` flags `acks_on_failure` and `acks_on_timeout` default to true and fall back to `acks_on_failure_or_timeout`.

Sources: [celery/worker/request.py:700-728](repo://celery/worker/request.py#L700-L728), [celery/app/task.py:432-443](repo://celery/app/task.py#L432-L443)

`acknowledge` and `reject` both set `acknowledged` so a message is settled only once; `reject` also sends a `task-rejected` event.

Sources: [celery/worker/request.py:730-740](repo://celery/worker/request.py#L730-L740)

## Time limits

A hard time limit reaches `Request.on_timeout` from the pool. A soft limit only logs a warning in `on_timeout`. For a hard limit, the request is marked ready, and unless the worker is in a cold shutdown, the failure is stored with `TimeLimitExceeded` and the same hooks run as for a normal failure: `task.on_failure`, `after_return` if overridden, the `task_failure` signal and a `task-failed` event.

Sources: [celery/worker/request.py:529-590](repo://celery/worker/request.py#L529-L590)

With `acks_late`, a hard timeout then either acknowledges (`acks_on_timeout`) or rejects with requeue.

Sources: [celery/worker/request.py:590-594](repo://celery/worker/request.py#L590-L594)

## Revoked, terminated and cancelled tasks

`terminate` kills the pool process with a signal when the job has started, otherwise it remembers to terminate on accept (`_terminate_on_ack`). `cancel` is what the consumer calls for unacknowledged late-ack tasks after a connection loss: after killing the process it stores a `RETRY` state with the message `cancelled by Celery` and sends `task_retry`, so the task shows as retried while the broker redelivers its unacknowledged message. `_announce_revoked` stores `REVOKED`, acknowledges the message and sends `task_revoked`. How revoke commands arrive is described on [[Remote Control and Revoking]].

Sources: [celery/worker/request.py:416-468](repo://celery/worker/request.py#L416-L468), [celery/worker/consumer/consumer.py:440-448](repo://celery/worker/consumer/consumer.py#L440-L448)

## Duplicate protection on redelivery

When a message is redelivered after the worker died after finishing but before acknowledging, the tracer can skip running the task again. This is enabled only when the task uses late acknowledgement, `worker_deduplicate_successful_tasks` is on and the backend is persistent.

Sources: [celery/app/trace.py:380-382](repo://celery/app/trace.py#L380-L382)

For a redelivered request it first checks the in-memory `successful_requests` set, and otherwise reads the state from the backend. If the stored state is `SUCCESS`, it logs that the task already completed. If the request has callbacks or a chain but the stored metadata shows no children, it dispatches them again from the stored return value, since the first run may have died before dispatching; with children present they were already sent. It then adds the id to `successful_requests` and returns without running the task. A failure while dispatching raises `Reject(exc, requeue=True)`, leaving the broker's own dead-letter or delivery-count policy as the only limit.

Sources: [celery/app/trace.py:506-561](repo://celery/app/trace.py#L506-L561)
