---
type: workflow
title: Task execution, retries, and acknowledgements
description: Trace a worker request through pool execution, state updates, retries, acknowledgement decisions, and successful-task deduplication.
tags: [tasks, execution, retries, acknowledgements, redelivery]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:38:41.370Z
sources:
  - id: openwiki-source-f43ee4204a66938ed7ddea4f
    resource: repo://celery/app/autoretry.py
  - id: openwiki-source-3795aa577fa7b0f3bd2af81a
    resource: repo://celery/app/task.py
  - id: openwiki-source-4a982797c89fcb3ea5c5d0ee
    resource: repo://celery/app/trace.py
  - id: openwiki-source-328c66e40eb163230ad26cbc
    resource: repo://celery/worker/request.py
generated: { by: "codex", at: "2026-11-16T16:38:41.370Z" }
---

# Task execution, retries, and acknowledgements

Execution spans two owners. The worker's `Request` manages delivery metadata, pool callbacks, local worker state, and broker acknowledgements. The task tracer manages the Python invocation, request context, hooks/signals, workflow continuation, and backend transitions. Pool callback “success” means the tracing call returned; that returned value can still describe a task failure.

## From message to task body

The [consumer strategy](../architecture/workers.md) creates a request and checks revocation, expiration, ETA, and rate limits. `Request.execute_using_pool()` checks revocation again and submits `trace_task_ret` or `fast_trace_task` to the pool, wiring acceptance, timeout, success, and error callbacks. A protocol-2 body can remain encoded until this execution path.

`build_tracer()` binds frequently used task/loader/backend operations into a per-task execution closure. It establishes task/request stacks, sends prerun, calls the loader's task-init hook, optionally stores `STARTED`, and invokes `before_start` followed by the task body. It calls `run()` directly unless the task customizes `__call__`.

On ordinary success, the tracer publishes callbacks and the next chain step before storing completion, so child-result trails can be included in backend metadata. It then calls success hooks/signals and applicable after-return handling. Finally it sends postrun, pops context stacks, and performs backend/loader process cleanup for non-eager execution. `ignore_result`, eager-result settings, and error-storage settings affect which states reach the backend.

## Retry means another execution attempt

`self.retry()` builds a signature from the current request, increments retry count, preserves task identity and relevant delivery options, and selects ETA/countdown. It checks retry limits, publishes the retry signature, and normally raises the `Retry` control exception. In eager mode it returns/raises retry information for the local apply loop instead. A directly called task follows a different exception path because it has no worker request.

The tracer treats `Retry` as a state transition, records it when configured, and invokes retry hooks/signals without normal failure errbacks. The request acknowledges the original late-ack message on retry. This is separate from a broker redelivering an unacknowledged message: retry publishes a new attempt with updated retry metadata.

`autoretry_for` wraps `run()` and delegates matching exceptions to `retry()`. `dont_autoretry_for` exclusions take precedence, and `Ignore`/`Retry` pass through. Backoff uses the request retry count, a maximum delay, and optional jitter. Use a bound task for explicit request-aware retry logic, and avoid retrying irreversible effects without an application-level repeat policy.

## Acknowledgement decisions in this checkout

Early acknowledgement happens when the pool accepts the request. With `acks_late`, success and retry acknowledge after processing. For late-ack failures, this checkout has separate `acks_on_failure` and `acks_on_timeout` options. Each falls back to the legacy `acks_on_failure_or_timeout` value when unset, then to true when that legacy value is also unset.

| Request outcome | Delivery decision |
| --- | --- |
| Success with late acknowledgement | Acknowledge |
| `Retry` | Acknowledge the original late-ack message; the retry was separately published |
| `Ignore` | Acknowledge without normal completion storage by the tracer |
| `Reject(requeue=True)` | Reject and request redelivery if the delivery is still unacknowledged |
| `Reject(requeue=False)` | Reject without requeue; record terminal failure when error storage is enabled |
| Ordinary late-ack failure | Acknowledge if `acks_on_failure`; otherwise reject without requeue |
| Late-ack hard timeout | Acknowledge if `acks_on_timeout`; otherwise reject with requeue |
| Lost pool process with late ack and `reject_on_worker_lost` | Reject with requeue |

The low-level acknowledgement/rejection methods act once on an unacknowledged delivery. Raising `Reject` after an early acknowledgement cannot undo the broker acknowledgement. `Reject(requeue=False)` additionally stores failure and emits failure observations in this checkout, preventing a result from remaining indefinitely pending solely because the task rejected its delivery.

Hard-timeout handling in the parent records failure and invokes failure hooks/signals because the task process may not be able to do so. These paths depend on the [pool's capabilities](../architecture/workers.md). Client-side `AsyncResult.get(timeout=...)` has a different meaning: it only stops the wait.

## Redelivery and limited deduplication

Late acknowledgement permits repeats when a worker finishes an external effect but loses the connection or exits before acknowledgement. It does not promise exactly-once execution. Connection-loss cancellation, broker redelivery, task retry, result-storage retry, and producer retry are separate mechanisms.

`worker_deduplicate_successful_tasks` applies when late acknowledgement and a persistent backend are in use, and only to redelivered messages. The tracer checks a local successful-ID cache, then backend `SUCCESS`. In the backend-success path it can dispatch pending callbacks/chain using the stored return value when stored children are absent; existing children suppress that dispatch. Failures during this recovery dispatch raise `Reject(requeue=True)` so work can be redelivered. Permanent dispatch errors can therefore loop until broker delivery/dead-letter policy intervenes.

This is a targeted recovery mechanism, not a general task-ID uniqueness guarantee. Callback/chain publication is not atomic across all messages. Preserve idempotence where side effects or downstream dispatch can repeat, and retain result metadata long enough for the intended recovery window.

## Source and tests

Read [request handling](../../celery/worker/request.py), [tracing](../../celery/app/trace.py), [retry API](../../celery/app/task.py), and [autoretry wrapper](../../celery/app/autoretry.py). [Request tests](../../t/unit/worker/test_request.py) cover rejection, lost workers, and timeout acknowledgement; [trace tests](../../t/unit/tasks/test_trace.py) cover state/hook ordering and deduplicated continuation; [task tests](../../t/unit/tasks/test_tasks.py) cover retry behavior. Follow [results](../architecture/results.md) for persistence and [Canvas](canvas.md) for continuation and chord ownership.
