---
type: architecture
title: Worker execution and acknowledgement
description: How worker bootsteps, consumer strategies, execution pools, and tracing cooperate to schedule tasks and resolve broker deliveries.
tags: [worker, execution, acknowledgement, qos, failure]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:55:28.912Z
sources:
  - id: openwiki-source-4a982797c89fcb3ea5c5d0ee
    resource: repo://celery/app/trace.py
  - id: openwiki-source-7c9db0d3259470539a2d0756
    resource: repo://celery/bootsteps.py
  - id: openwiki-source-94b60a38fd26082deb41f979
    resource: repo://celery/worker/consumer/consumer.py
  - id: openwiki-source-337ca17b51d3603b5a2c09ec
    resource: repo://celery/worker/consumer/tasks.py
  - id: openwiki-source-328c66e40eb163230ad26cbc
    resource: repo://celery/worker/request.py
  - id: openwiki-source-5b05690e7e13e9bff2a56054
    resource: repo://celery/worker/strategy.py
  - id: openwiki-source-12d3bd623a53e489a785c641
    resource: repo://celery/worker/worker.py
  - id: openwiki-source-612deff05867580f53464f18
    resource: repo://t/unit/worker/test_request.py
generated: { by: "codex", at: "2026-11-16T07:55:28.912Z" }
---

# Worker execution and acknowledgement

The worker separates service orchestration, delivery management, and task execution. `WorkController` builds a worker blueprint; its consumer builds another blueprint for connections, task consumption, events, control, gossip, heartbeats, and delayed delivery. Bootstep dependencies determine initialization order. Custom services belong in `app.steps['worker']` or `app.steps['consumer']` with declared dependencies.

## From delivery to user code

The consumer creates one strategy and tracer per registered task. Protocol v2 selects the task through message headers and can defer body deserialization to pool execution; the v1 path decodes the body to find the task name. Malformed and unknown tasks are rejected through distinct handlers.

The default strategy creates a Request, checks revocation/expiry, emits receipt information, and chooses immediate execution, an ETA timer, or a per-task rate-limit bucket. ETA reservations adjust QoS while waiting. Immediate work is marked reserved and forwarded to the worker's request handler.

`Request.execute_using_pool()` submits a tracer invocation with acceptance, timeout, success, and error callbacks. The pool owns its concurrency mechanism; the request owns the corresponding delivery callbacks. Pool aliases include prefork, threads, solo, gevent, and eventlet. Their process and timeout capabilities are not interchangeable.

The tracer pushes task and request context, invokes initialization hooks, optionally stores STARTED, calls user code, and classifies `Retry`, `Ignore`, `Reject`, and ordinary exceptions. On success it publishes continuations before backend completion. See [system flow](system.md) and [Canvas](../workflows/canvas.md).

## Acknowledgement and failure semantics

The following describes the pool/request callback path. Early acknowledgement occurs when the pool accepts work. With `acks_late=True`, completion callbacks decide the delivery's outcome.

| Outcome with late acknowledgements | Delivery action |
| --- | --- |
| Success | Acknowledge |
| Retry | Acknowledge the current delivery; the retry API publishes its replacement |
| Ordinary failure, `acks_on_failure=True` | Acknowledge |
| Ordinary failure, `acks_on_failure=False` | Reject without requeue |
| Hard timeout, `acks_on_timeout=True` | Acknowledge |
| Hard timeout, `acks_on_timeout=False` | Reject with requeue |
| Worker process lost, `reject_on_worker_lost=True` | Reject with requeue |
| Explicit `Reject` | Use the exception's requeue flag |
| Explicit `Ignore` | Acknowledge |

Separate failure and timeout switches are implemented in this checkout; do not assume disabling failure acknowledgement automatically means requeue. Task binding supplies compatibility defaults described in [application lifecycle](application.md). Hard-timeout handling also records failure and invokes failure hooks/signals, except for its cold-shutdown special case. Retrying task bodies and requeued deliveries must tolerate repeated side effects.

## Capacity, ETA, and redelivery

The Tasks bootstep sets broker prefetch and constructs QoS with `worker_eta_task_limit`. Effective global QoS depends on transport and quorum-queue detection. `worker_disable_prefetch` gates consumption against reserved work only for Redis; other brokers receive a warning and ignore that switch.

Successful-task deduplication requires late acknowledgement, `worker_deduplicate_successful_tasks`, and a persistent backend, and applies to redelivered messages. It checks a local success cache or backend SUCCESS state. The backend-success path may restore missing callbacks/chain dispatch when child metadata is absent; dispatch failure rejects with requeue. This is conditional recovery, not atomic execution of side effects and continuations.

## Focused verification

[Request tests](../../t/unit/worker/test_request.py) explicitly distinguish failure rejection from timeout requeue and cover hard-timeout hooks. [Strategy tests](../../t/unit/worker/test_strategy.py) cover ETA, rate limits, and revocation; [consumer tests](../../t/unit/worker/test_consumer.py) cover dispatch and reconnect; [trace tests](../../t/unit/tasks/test_trace.py) cover task lifecycle and deduplication. Use [worker operations](../operations/workers.md) for shutdown and connection recovery, and [result backends](../integrations/result-backends.md) for completion persistence.
