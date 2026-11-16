---
type: workflow
title: Execution, acknowledgements and retries
description: Request and tracer responsibilities, acknowledgement decisions, task retry publication, terminal failures and successful redelivery deduplication.
tags: [execution, retries, acknowledgements, failures, deduplication]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:34:04.042Z
sources:
  - id: openwiki-source-f43ee4204a66938ed7ddea4f
    resource: repo://celery/app/autoretry.py
  - id: openwiki-source-3795aa577fa7b0f3bd2af81a
    resource: repo://celery/app/task.py
  - id: openwiki-source-4a982797c89fcb3ea5c5d0ee
    resource: repo://celery/app/trace.py
  - id: openwiki-source-30739e9c6aac84ef121d58dc
    resource: repo://celery/states.py
  - id: openwiki-source-328c66e40eb163230ad26cbc
    resource: repo://celery/worker/request.py
generated: { by: "codex", at: "2026-11-16T06:34:04.042Z" }
---

# Execution, acknowledgements and retries

The worker request owns broker delivery and pool callbacks. The execution tracer owns the Python call, task context, lifecycle hooks, result reporting and success continuations. These are distinct boundaries: completing a side effect, storing a result and acknowledging a message are not one atomic action.

## Request versus tracer

`Request.execute_using_pool()` submits the selected trace function with acceptance, timeout, success and error callbacks. `on_accepted()` marks work active and acknowledges early-ack tasks. The tracer pushes task/request context, emits prerun signals, optionally stores `STARTED`, runs the callable and handles `Retry`, `Reject`, `Ignore` and ordinary exceptions. Its cleanup pops context and invokes backend and loader process cleanup.

`RECEIVED` is an event state. Backend `STARTED` depends on tracking and result policy; it is not written for every task. `SUCCESS`, `FAILURE` and `REVOKED` are ready states; `RETRY` remains unready. `AsyncResult.get()` waits on these backend semantics, separately from worker events.

## Acknowledgement decisions

For the pool request path:

| Condition | Delivery action |
| --- | --- |
| `acks_late=False` | Acknowledge when the pool accepts work |
| Late-ack task succeeds | Acknowledge on success |
| Late-ack task requests retry | Acknowledge the current delivery; the retry was separately published |
| `Reject(requeue=True)` | Reject and requeue the current delivery |
| `Reject(requeue=False)` | Reject without requeue; this checkout also records terminal failure and emits failure signaling when configured to store errors |
| `Ignore` | Acknowledge without ordinary success-result handling |
| Ordinary late-ack failure | Acknowledge if `acks_on_failure`, otherwise reject without requeue |
| Late-ack timeout | Use `acks_on_timeout`; false requeues |
| Worker loss with `reject_on_worker_lost` | Requeue late-ack delivery |

Task binding resolves `acks_on_failure` and `acks_on_timeout` independently, falling back to deprecated `acks_on_failure_or_timeout`, then true. Their application settings use the `task_` prefix. This checkout has distinct timeout and failure behavior, so do not assume disabling failure acknowledgement automatically requeues ordinary failures.

Hard timeouts also run failure hooks and signaling from the request path because the child may be unable to finish tracer cleanup. Time-limit support and process termination depend on pool capabilities. Revocation and expiry are checked before execution; active termination cannot reverse completed side effects. See [worker lifecycle](../architecture/worker.md) and [remote control](../operations/monitoring.md).

## Retrying publishes another invocation

For a bound task, use `raise self.retry(exc=exc, countdown=...)` to publish from its request context. `retry()` increments the retry count, reconstructs execution options and delivery information, checks the retry limit and normally raises the `Retry` control exception after publishing. A publish failure is converted to `Reject(requeue=False)`. Direct calls and eager execution have separate paths.

The default retry delay applies when no ETA or countdown is supplied. Exceeding the limit raises the supplied exception when available, otherwise `MaxRetriesExceededError`. `throw=False` lets task code continue, so its eventual return or exception can determine the current execution's state even though another invocation has been scheduled.

Automatic retries wrap `run()` only for configured `autoretry_for` exceptions. `Ignore`, `Retry` and `dont_autoretry_for` are excluded. Optional exponential backoff uses the request retry count, a maximum delay and jitter. This execution retry is separate from the producer's connection/publication retry policy.

## Successful redelivery deduplication

Deduplication requires late acknowledgements, `worker_deduplicate_successful_tasks`, a persistent backend and a delivery marked redelivered. The tracer first checks the successful-request cache, then backend state. An already-successful task can skip its callable.

The backend-success branch reads the stored result and child metadata. It dispatches callbacks or remaining chain work if needed and no stored children indicate previous dispatch, then caches the success. The code notes `result_extended=True` for persisted child metadata. Continuation recovery failures raise `Reject(requeue=True)`; `MemoryError` is re-raised. A `BackendGetMetaError` while initially checking state instead allows the ordinary execution path.

Continuation publication is not atomic: partial success followed by a redelivery can duplicate an already-sent callback. Permanent recovery errors can also repeat requeues; the implementation identifies broker dead-letter or delivery-count policies as the circuit breaker. Keep both task side effects and [Canvas continuations](canvas.md) tolerant of repeated execution.

## Focused verification

`t/unit/worker/test_request.py` covers acknowledgement, hard-timeout and rejection branches. `t/unit/tasks/test_trace.py` covers result policy, control exceptions and deduplication continuation recovery; `test_tasks.py` covers manual and automatic retries. `t/smoke/tests/test_dedup_chain_dispatch.py` exercises distributed recovery. Pair these with the selected [backend](../integrations/result-backends.md) and [publication path](publishing.md) when changing completion behavior.
