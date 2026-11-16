---
title: "Task Retries and Failure Handling"
---
## Overview

Execution failure involves two decisions: what outcome Celery records and what happens to the delivered message. The trace classifies function exceptions; the worker request acknowledges or rejects delivery according to task policy. [[Worker Lifecycle and Execution]] explains where both objects run. A task retry resubmits work through [[Task Publishing and Routing]], while redelivery requests another delivery of the existing broker message.

Sources: [celery/app/trace.py:580-605](repo://celery/app/trace.py#L580-L605), [celery/app/task.py:818-867](repo://celery/app/task.py#L818-L867), [celery/worker/request.py:677-710](repo://celery/worker/request.py#L677-L710)

## Request an execution retry

A bound task can call `self.retry`. The method reads the active request, increments its retry count, and chooses `default_retry_delay` if neither ETA nor countdown was supplied. `signature_from_request` preserves request execution options and delivery details while allowing replacement arguments, keyword arguments, or a queue. For anonymous-exchange deliveries, it reconstructs the queue name from the original routing key.

Sources: [celery/app/task.py:731-753](repo://celery/app/task.py#L731-L753), [celery/app/task.py:818-839](repo://celery/app/task.py#L818-L839)

If the new count exceeds `max_retries`, the method raises the supplied exception with context, or `MaxRetriesExceededError` when none was supplied. A per-call retry limit applies to that execution; infinite retry requires the task's `max_retries` attribute to be `None`. Calling retry directly outside worker or emulated task execution takes a separate branch that raises an exception instead of publishing.

Sources: [celery/app/task.py:781-799](repo://celery/app/task.py#L781-L799), [celery/app/task.py:818-850](repo://celery/app/task.py#L818-L850)

For ordinary worker execution, retry applies the reconstructed signature asynchronously and then raises the `Retry` control exception. If that publication raises, retry raises `Reject(requeue=False)`. With `throw=False`, it returns the `Retry` object instead; the original task can continue and eventually be recorded as successful or failed based on what it does afterward. Eager execution returns or raises a retry object for the local apply machinery.

Sources: [celery/app/task.py:803-807](repo://celery/app/task.py#L803-L807), [celery/app/task.py:852-867](repo://celery/app/task.py#L852-L867)

## Configure automatic retries

Autoretry wraps `task.run` once when `autoretry_for` is nonempty. It preserves `Ignore` and existing `Retry` exceptions, then checks `dont_autoretry_for` before the retryable exception list. A matching exception causes `task.retry(exc=exc, **retry_kwargs)`. This ordering prevents broad retry categories from swallowing the explicit control exceptions or exclusions.

Sources: [celery/app/autoretry.py:8-20](repo://celery/app/autoretry.py#L8-L20), [celery/app/autoretry.py:33-66](repo://celery/app/autoretry.py#L33-L66)

With `retry_backoff`, the wrapper derives countdown from the current request's retry count and an exponential-backoff helper. The numeric factor is at least one, `retry_backoff_max` defaults to 600 seconds, and `retry_jitter` defaults to true. `retry_kwargs` carries options such as retry limits. Application task construction installs this wrapper after binding the new task, as described in [[Application and Configuration]].

Sources: [celery/app/autoretry.py:18-30](repo://celery/app/autoretry.py#L18-L30), [celery/app/autoretry.py:47-66](repo://celery/app/autoretry.py#L47-L66), [celery/app/base.py:628-630](repo://celery/app/base.py#L628-L630)

## Classify exceptions and record state

| Function outcome | Trace/request behavior |
| --- | --- |
| Normal return | Dispatch continuations and mark the result done |
| `Retry` | Record retry metadata when enabled, invoke `on_retry`, and send `task_retry` |
| Ordinary exception | Mark failure, invoke `on_failure`, and send `task_failure` |
| `Ignore` | Take the ignored control path; the request acknowledges |
| `Reject` | Reject with its `requeue` flag; a non-requeued rejection records terminal failure in the request handler |

Sources: [celery/app/trace.py:212-227](repo://celery/app/trace.py#L212-L227), [celery/app/trace.py:242-272](repo://celery/app/trace.py#L242-L272), [celery/app/trace.py:580-627](repo://celery/app/trace.py#L580-L627), [celery/worker/request.py:649-675](repo://celery/worker/request.py#L649-L675)

Error storage respects the effective ignore-result setting, `store_errors_even_if_ignored`, eager execution, and `store_eager_result`. A retry stores its underlying reason rather than treating `Retry` as a business failure. [[Results and Backends]] explains how those recorded values are encoded and read; a task lifecycle signal does not itself guarantee that a result was persisted.

Sources: [celery/app/trace.py:188-227](repo://celery/app/trace.py#L188-L227)

## Acknowledge or requeue delivery

Without `acks_late`, the pool-acceptance callback acknowledges before execution finishes. With late acknowledgment, successful completion acknowledges afterward, and a requested retry also acknowledges the current delivery because its replacement has been submitted. These transitions explain why task retry and message requeue are different recovery operations.

Sources: [celery/worker/request.py:515-523](repo://celery/worker/request.py#L515-L523), [celery/worker/request.py:596-618](repo://celery/worker/request.py#L596-L618), [celery/app/task.py:861-867](repo://celery/app/task.py#L861-L867)

For late-acknowledged failures, the request chooses `acks_on_timeout` for `TimeLimitExceeded` and `acks_on_failure` otherwise. A lost worker with `reject_on_worker_lost`, or a timeout with acknowledgment disabled, causes requeue. Other failures acknowledge when their flag is true and reject without requeue when it is false. The binding logic fills unset failure and timeout flags from the older combined flag, falling back to true.

Sources: [celery/worker/request.py:677-696](repo://celery/worker/request.py#L677-L696), [celery/app/task.py:432-443](repo://celery/app/task.py#L432-L443)

The request avoids marking a requeued lost-worker task as failed in its final failure-storage branch. This preserves the possibility of another delivery completing the task. Explicit `Reject(requeue=False)` instead marks failure and emits failure notification before rejecting, preventing a task that will not run again from remaining indefinitely in `PENDING` or `STARTED`.

Sources: [celery/worker/request.py:649-671](repo://celery/worker/request.py#L649-L671), [celery/worker/request.py:704-717](repo://celery/worker/request.py#L704-L717)

## Timeouts, expiration, and revocation

A soft pool timeout logs a warning. A hard timeout marks failure outside cold shutdown, invokes failure hooks and signals, and emits a failed event; for late acknowledgment, `acks_on_timeout` decides between acknowledging and requeuing. These are execution limits, while the timeout passed to `AsyncResult.get` only bounds client waiting and does not terminate the task.

Sources: [celery/worker/request.py:529-594](repo://celery/worker/request.py#L529-L594), [celery/result.py:209-215](repo://celery/result.py#L209-L215)

Expiration adds the ID to the revoked set when the current time exceeds the request's deadline. `revoked` checks expiration, revoked IDs, and stamped headers; a match marks the task ready and revoked, records backend revocation according to error-storage policy, acknowledges, and sends revocation notification. [[Monitoring and Worker Control]] explains how operator commands populate these revocation sets.

Sources: [celery/worker/request.py:408-414](repo://celery/worker/request.py#L408-L414), [celery/worker/request.py:457-508](repo://celery/worker/request.py#L457-L508)

## Limits of duplicate suppression

The trace's successful-task deduplication requires late acknowledgment, `worker_deduplicate_successful_tasks`, a persistent backend, and a redelivered message. It checks an in-memory success set or backend `SUCCESS` metadata. For a stored success with missing child metadata, it can dispatch callbacks and chain steps using the stored return value. An error in that recovery path raises `Reject(requeue=True)`.

Sources: [celery/app/trace.py:379-382](repo://celery/app/trace.py#L379-L382), [celery/app/trace.py:508-560](repo://celery/app/trace.py#L508-L560)

The continuation dispatcher explicitly documents non-atomic publication: already-sent callbacks can be sent again if a later publication fails and delivery is retried. [[Canvas Workflows]] therefore inherits this delivery boundary even when the original function is skipped by deduplication. The recovery comment identifies broker dead-letter or maximum-delivery policies as the circuit breaker for permanent continuation errors.

Sources: [celery/app/trace.py:426-438](repo://celery/app/trace.py#L426-L438), [celery/app/trace.py:549-560](repo://celery/app/trace.py#L549-L560)
