---
title: "Task Execution and Retries"
---
## Overview

Execution begins when the worker request submits a prepared trace function to its pool. [[Worker Lifecycle and Concurrency]] explains that submission boundary. The tracer establishes task context, invokes the body and handles success, retry and failure; the parent request handles delivery acknowledgements and pool-level failures. [[Results and State]] describes how clients observe the stored outcome after these decisions.

Sources: [celery/worker/request.py:341-372](repo://celery/worker/request.py#L341-L372), [celery/app/trace.py:344-377](repo://celery/app/trace.py#L344-L377), [celery/worker/request.py:596-620](repo://celery/worker/request.py#L596-L620)

## Establish the execution context

The tracer validates keyword arguments and creates a task `Context` containing the request plus arguments. This context carries IDs, retry count, callbacks, chain, chord, delivery information and other execution fields. It pushes the task and request before running hooks, then sends `task_prerun`, initializes the loader's task lifecycle and optionally stores `STARTED` with process and hostname metadata. Started-state storage requires tracking to be enabled and results not to be ignored.

Sources: [celery/app/task.py:69-130](repo://celery/app/task.py#L69-L130), [celery/app/trace.py:490-506](repo://celery/app/trace.py#L490-L506), [celery/app/trace.py:563-578](repo://celery/app/trace.py#L563-L578)

`before_start` runs before the function. The tracer calls `task.run` directly unless the task overrides `__call__`, in which case it uses that custom callable. Direct Python calling has its own task/request stack handling and runs inline. These boundaries explain why task hooks belong on the task implementation while process management belongs to [[Worker Lifecycle and Concurrency]].

Sources: [celery/app/trace.py:374-377](repo://celery/app/trace.py#L374-L377), [celery/app/trace.py:580-585](repo://celery/app/trace.py#L580-L585), [celery/app/task.py:495-502](repo://celery/app/task.py#L495-L502)

## Complete successfully or record an error

A normal return selects `SUCCESS`. Before marking the result done, the tracer dispatches callbacks and the remaining chain so child-result trails are populated. It then invokes `on_success`, emits the success signal and later runs `after_return` for states outside the ignore-state set. [[Canvas Workflows]] explains continuation composition; the execution boundary here is responsible for dispatch order and result publication.

Sources: [celery/app/trace.py:585-586](repo://celery/app/trace.py#L585-L586), [celery/app/trace.py:610-654](repo://celery/app/trace.py#L610-L654)

An ordinary exception is converted into a pickleable exception representation, passed to `backend.mark_as_failure`, then delivered to `on_failure` and the `task_failure` signal. Error storage depends on eager mode, ignored-result policy and `store_errors_even_if_ignored`. `Reject`, `Ignore` and `Retry` have dedicated branches rather than the ordinary-failure branch. The tracer finally emits `task_postrun`, pops context stacks and, outside eager execution, runs backend and loader cleanup.

Sources: [celery/app/trace.py:188-204](repo://celery/app/trace.py#L188-L204), [celery/app/trace.py:242-274](repo://celery/app/trace.py#L242-L274), [celery/app/trace.py:587-608](repo://celery/app/trace.py#L587-L608), [celery/app/trace.py:655-672](repo://celery/app/trace.py#L655-L672)

## Request another attempt

`Task.retry` increments the request retry count, chooses the supplied countdown/ETA or `default_retry_delay`, and constructs a signature from the current request. That signature preserves the task ID and request execution options, including delivery information. It checks the effective retry limit before sending. Exhaustion re-raises the supplied exception when available or raises `MaxRetriesExceededError`; setting the task's `max_retries=None` permits unlimited attempts.

Sources: [celery/app/task.py:729-753](repo://celery/app/task.py#L729-L753), [celery/app/task.py:794-807](repo://celery/app/task.py#L794-L807), [celery/app/task.py:818-850](repo://celery/app/task.py#L818-L850)

After republishing, `retry` normally raises the `Retry` control exception. The tracer records `RETRY` where error storage is enabled, invokes `on_retry` and emits `task_retry`. With `throw=False`, execution continues, so a subsequent return or exception can produce success or failure for the current attempt. If retry publication itself raises, `retry` converts that into `Reject(requeue=False)`. The transport retry policy in [[Task Publishing and Routing]] governs a separate producer operation.

Sources: [celery/app/task.py:803-807](repo://celery/app/task.py#L803-L807), [celery/app/task.py:852-867](repo://celery/app/task.py#L852-L867), [celery/app/trace.py:212-227](repo://celery/app/trace.py#L212-L227)

Autoretry wraps `run` only when `autoretry_for` is configured. It re-raises `Ignore`, existing `Retry` exceptions and `dont_autoretry_for` matches before handling configured retryable exceptions. Optional exponential backoff calculates countdown from the current retry count, a maximum and jitter policy, then delegates to `Task.retry`. Defaults include a 600-second backoff maximum and enabled jitter; the wrapper's defaults apply only when the corresponding behavior is selected.

Sources: [celery/app/autoretry.py:8-66](repo://celery/app/autoretry.py#L8-L66)

## Decide acknowledgement and redelivery

| Outcome | Request behavior |
| --- | --- |
| Pool acceptance with early acknowledgements | Acknowledges when accepted |
| Successful completion with `acks_late` | Acknowledges on success |
| Retry with `acks_late` | Acknowledges the current delivery; the retry was republished separately |
| Hard timeout with `acks_late` | Acknowledges if `acks_on_timeout`; otherwise rejects with requeue |
| Worker loss with `reject_on_worker_lost` and late acknowledgement | Rejects with requeue |
| Other late-ack failure | Uses `acks_on_failure`; otherwise rejects without requeue |

Sources: [celery/worker/request.py:511-523](repo://celery/worker/request.py#L511-L523), [celery/worker/request.py:590-620](repo://celery/worker/request.py#L590-L620), [celery/worker/request.py:670-721](repo://celery/worker/request.py#L670-L721)

Hard timeouts are handled in the parent request. Unless the worker is in the cold-shutdown termination case, the handler marks failure, invokes failure and custom after-return hooks, emits `task_failure` and a failed event, and clears synthetic traceback references. A non-requeued `Reject` also records terminal failure and emits the failure signal in this checkout. Interpret those outcomes together with the acknowledgement table instead of assuming every exception causes redelivery.

Sources: [celery/worker/request.py:529-594](repo://celery/worker/request.py#L529-L594), [celery/worker/request.py:649-670](repo://celery/worker/request.py#L649-L670)

## Handle successful-task redelivery

Deduplication is gated by late acknowledgement, `worker_deduplicate_successful_tasks` and a persistent backend. For redelivered requests, the tracer checks its successful-request cache and stored `SUCCESS` state. When stored metadata indicates no children, it can redispatch missing callbacks or a chain using the stored return value. Dispatch failure raises `Reject(requeue=True)`; comments identify broker dead-letter or maximum-delivery policies as the circuit breaker for permanent dispatch errors. This is conditional recovery, not a general exactly-once execution contract.

Sources: [celery/app/trace.py:379-382](repo://celery/app/trace.py#L379-L382), [celery/app/trace.py:508-561](repo://celery/app/trace.py#L508-L561)
