---
type: workflow
title: Canvas workflows and chord coordination
description: Serializable task signatures, argument propagation, chain and group preparation, chord synchronization, task replacement and workflow failure handling.
tags: [canvas, workflows, chains, groups, chords]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:48:42.195Z
sources:
  - id: openwiki-source-5a0b6982dd7ddb0fabfabd0c
    resource: repo://celery/app/amqp.py
  - id: openwiki-source-3795aa577fa7b0f3bd2af81a
    resource: repo://celery/app/task.py
  - id: openwiki-source-4a982797c89fcb3ea5c5d0ee
    resource: repo://celery/app/trace.py
  - id: openwiki-source-98fa58283cefff1b0e071bbe
    resource: repo://celery/backends/base.py
  - id: openwiki-source-c4f10fd82ae03f7290951812
    resource: repo://celery/canvas.py
  - id: openwiki-source-a85d69622d5baa166a82e6c1
    resource: repo://celery/worker/control.py
  - id: openwiki-source-0b9447f10bfc26b3cde788ba
    resource: repo://t/unit/tasks/test_trace.py
generated: { by: "codex", at: "2026-11-16T06:48:42.195Z" }
---

# Canvas workflows and chord coordination

Canvas represents work as serializable signatures rather than waiting for subtasks inside a running task. A signature contains a task name, positional and keyword arguments, and execution options. Dispatch still uses the ordinary task publishing and worker execution paths.

## Argument flow is part of the workflow contract

`task.s(...)` creates a partial signature; extra positional arguments are prepended, keyword arguments are merged and new execution options normally override stored options. `task.si(...)` creates an immutable signature: normal application does not inject new arguments, though options can still change. Some execution metadata and stamped options are protected independently from argument immutability.

For tasks `add(x, y)` and `total(values)`:

```python
from celery import chain, chord, group

sequential = chain(add.s(2, 3), add.s(10))
parallel = group(add.s(i, i) for i in range(3))
aggregate = chord(parallel, total.s())
result = aggregate.apply_async()
```

The chain's second task receives `5` before its stored `10`. The chord body receives the list of header results. Use an immutable body if it should ignore that list and run only with its own stored arguments.

## Preparing a chain does not execute every step

Chain preparation clones and freezes signatures, creates result IDs and parent relationships, unpacks nested chains and handles groups and chords. It prepares continuation metadata, then publishes the first task. The worker tracer dispatches the next step after success, passing the result onward. Protocol v2 stores the remaining chain on the request; the tracer selects its last element and passes the preceding elements as a slice, leaving the request's list unchanged.

The result returned for a multi-step chain represents its terminal result. Group followed by a task is upgraded into a chord during preparation so the following task waits for all header results. A chain task ID is associated with the last task; grouping and chord metadata must attach to the completion that enclosing workflows actually wait on.

Freezing allocates identifiers and result handles; it does not publish work. Clone templates before preparing independent invocations so IDs and mutated options do not accidentally carry across uses.

## Groups and chords have different completion contracts

A group publishes its members and returns a `GroupResult`. Passing `link` to `group.apply_async()` is rejected with guidance to use a chord; it is not a single all-members-completed callback.

A chord freezes a body result, freezes the header with chord metadata, calls the backend's `apply_chord()` and publishes the header. It returns the body result with the header group as its parent. Empty headers dispatch the body immediately with an empty list.

Backend support is essential. Redis counts completed parts using backend keys, while the base fallback schedules `celery.chord_unlock` to check readiness. RPC rejects chords, including workflows implicitly upgraded from group-to-task composition. Keep header results available and choose a backend that supports the required coordination; see [result backend contracts](../integrations/result-backends.md).

## Failures, replacement and stamps

The tracer separates success continuations from errors. Backend failure handling marks identifiable downstream chain results and notifies enclosing chords, including descending into a chord's body so a failed predecessor does not leave its terminal result unresolved. Errbacks have two calling forms: request/exception/traceback handlers may run directly, while older single-ID-style handlers are scheduled as tasks. Design them to tolerate the actual workflow's number of failing members.

`Task.replace(sig)` substitutes a signature for the current task while preserving its completion identity. It rejects incompatible chord options and empty chains, carries links and errbacks forward, increments replacement nesting and connects remaining chain work. In asynchronous execution, replacement publication ends the original task path through `Ignore`; use replacement as a terminal operation.

Stamping visitors attach workflow metadata across composed signatures. Stamps travel with protocol headers and can support header-based revocation. They are metadata, not a substitute for business-level idempotency or authorization.

## Verify composition and distributed completion

`t/unit/tasks/test_canvas.py` covers normalization, freezing, immutability, links and stamps; `test_tasks.py` covers task replacement. `t/integration/test_canvas.py` covers execution, and `t/smoke/tests/test_canvas.py` adds container-backed scenarios. Test nested and empty structures, dependency failures, backend choice and redelivery when changing composition. [Execution semantics](execution.md) explains retries and acknowledgement boundaries that also apply to every Canvas member.
