---
type: architecture
title: System boundaries and task flow
description: How Celery applications, brokers, workers, result backends, Canvas workflows and beat cooperate to execute distributed tasks.
tags: [architecture, tasks, messaging, lifecycle]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:34:04.042Z
sources:
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-3795aa577fa7b0f3bd2af81a
    resource: repo://celery/app/task.py
  - id: openwiki-source-4a982797c89fcb3ea5c5d0ee
    resource: repo://celery/app/trace.py
  - id: openwiki-source-98fa58283cefff1b0e071bbe
    resource: repo://celery/backends/base.py
  - id: openwiki-source-2a32c4e613bc7be1d621d647
    resource: repo://celery/beat.py
  - id: openwiki-source-5b05690e7e13e9bff2a56054
    resource: repo://celery/worker/strategy.py
generated: { by: "codex", at: "2026-11-16T06:34:04.042Z" }
---

# System boundaries and task flow

Celery separates the Python application that describes work from the worker that executes it. A task name and serialized invocation cross the broker boundary; the producer does not send the Python function itself. Both sides therefore need compatible task names and serialization settings, and workers must import the implementations they execute.

## Owners and boundaries

| Component | Responsibility | Main implementation |
| --- | --- | --- |
| Application | Configuration, task registry, loaders, connections and service factories | `celery/app/base.py` |
| Publishing layer | Execution options, routes, queue selection and task protocol | `celery/app/task.py`, `celery/app/amqp.py` |
| Kombu and broker | Message transport, exchanges, queues and delivery | Kombu dependency and configured transport |
| Worker controller and consumer | Runtime resources, incoming-message dispatch, ETA/rate limiting and pool submission | `celery/worker/` |
| Execution tracer | Calling the task, task-local context, callbacks, state reporting and cleanup | `celery/app/trace.py` |
| Result backend | Result metadata and backend-specific workflow coordination | `celery/backends/` |
| Canvas | Serializable signatures and composition into chains, groups and chords | `celery/canvas.py` |
| Beat | Deciding when a periodic invocation is due and publishing it | `celery/beat.py` |

The application lazily constructs services such as its loader and backend. Accessing `app.tasks` also finalizes pending task definitions. Application configuration and task registration are related startup stages; see [application lifecycle](../concepts/application.md).

## One invocation, end to end

1. A registered task's `delay()` delegates to `apply_async()`. The latter merges execution options, checks arguments when typing is enabled, and normally calls `app.send_task()`.
2. `send_task()` selects a route, constructs a protocol message, acquires a producer and publishes through the application's AMQP layer. It returns a result handle identified by the task ID.
3. The worker consumer finds a strategy by the incoming task name. The strategy builds a `Request`, checks expiry/revocation, handles ETA or rate limiting, and passes eligible work to the controller.
4. The request submits execution to the pool. The tracer establishes the task context, invokes the callable and handles ordinary failures and Celery control exceptions.
5. On success the tracer dispatches callbacks and the next chain step before marking the result done, so child-result metadata can be recorded. Backend completion can also advance a chord.
6. Result readers use the task ID and configured backend to retrieve state or values. Message acknowledgement is managed separately by the request and its pool callbacks.

See [publishing](../workflows/publishing.md), [worker lifecycle](worker.md), [execution semantics](../workflows/execution.md) and [result contracts](../integrations/result-backends.md) for the individual boundaries.

## Consequences for correctness

Publishing, user side effects, callback dispatch, backend writes and broker acknowledgements happen in separate operations. Design task side effects to tolerate redelivery and retries; a result handle alone does not prove execution has finished. A publish failure belongs to a different stage from a task exception reported by the tracer.

`task_always_eager` changes registered-task invocation into local execution after a serialization round trip. Plain `send_task()` explicitly ignores that setting. Local eager tests consequently do not exercise consumer delivery, pool behavior or broker acknowledgement.

Beat uses the same publishing boundary as other producers. Canvas distributes continuation metadata across task messages and delegates chord synchronization to the backend; neither is a separate executor that bypasses workers.

## Where to verify a change

Start with `t/unit/app/test_app.py` and `t/unit/app/test_amqp.py` for producer behavior, `t/unit/worker/test_strategy.py` for receive handling, and `t/unit/tasks/test_trace.py` for execution and continuation behavior. Service-backed scenarios live in `t/integration/`, including workflow tests in `test_canvas.py`; the [development guide](../testing/development.md) explains the suite boundaries.
