---
type: workflow
title: Canvas workflows and chord coordination
description: Composing task signatures into chains, groups and chords, including argument propagation, backend coordination, and failure semantics.
tags: [canvas, workflows, chain, group, chord]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:55:28.912Z
sources:
  - id: openwiki-source-868b95b69384872926804a54
    resource: repo://celery/app/builtins.py
  - id: openwiki-source-3795aa577fa7b0f3bd2af81a
    resource: repo://celery/app/task.py
  - id: openwiki-source-98fa58283cefff1b0e071bbe
    resource: repo://celery/backends/base.py
  - id: openwiki-source-c4f10fd82ae03f7290951812
    resource: repo://celery/canvas.py
  - id: openwiki-source-850e39c4d2e9d1dcda465690
    resource: repo://docs/userguide/canvas.rst
generated: { by: "codex", at: "2026-11-16T07:55:28.912Z" }
---

# Canvas workflows and chord coordination

Canvas describes future task calls as serializable signatures and combines them into distributed workflows. It carries task names, arguments, and execution options rather than moving Python function implementations between workers.

## Signatures and argument flow

`task.s(...)` creates a mutable signature; `task.si(...)` creates an immutable one. Additional positional arguments are prepended to a mutable signature's stored arguments, keyword arguments are merged, and execution options override existing options except protected fields. Immutable signatures retain their arguments while still allowing execution-option changes.

```python
from celery import chain, group, chord

# Assuming registered add, total, and notify tasks:
chain(add.s(2, 3), add.s(10)).apply_async()  # add(2, 3), then add(5, 10)
chain(add.s(2, 3), notify.si()).apply_async()  # notify receives no prior result
group(add.s(i, i) for i in range(3)).apply_async()
chord(group(add.s(i, i) for i in range(3)), total.s()).apply_async()
```

The final example calls `total` with a list of header results. The tasks must accept those shapes.

`clone()` copies a signature and deep-copies its options. `freeze()` allocates task/correlation IDs and returns a result handle without publishing. Reusing a frozen signature for multiple independent submissions reuses IDs; clone the intended template before constructing independent workflows.

## Composition and execution

| Primitive | Execution relationship | Returned handle |
| --- | --- | --- |
| Chain | Each successful step passes its result into the next mutable signature | Final step's result, with parent relationships |
| Group | Publishes independent member signatures | GroupResult containing member results |
| Chord | Runs a group header, then dispatches a body after coordinated completion | Body result with the header result as parent |

Chain preparation normalizes nested structures, freezes identifiers, and arranges remaining signatures in reverse order for worker continuation dispatch. The first task is published immediately; the tracer publishes the next step after success. A group followed by a task is upgraded to a chord, so adding a downstream task can introduce a result-backend dependency. Single-member groups and empty structures have normalization rules; test the resulting argument shape when nesting primitives.

A group is not a barrier callback. Links attached through group linking APIs are passed to members and do not aggregate their results. Passing `link` directly to `group.apply_async` is rejected with guidance to use a chord. Group errbacks can run more than once when multiple members fail.

## Chord coordination

Chord execution freezes the body and header, asks the backend to establish coordination, then publishes the header. An empty header dispatches the body immediately with an empty list.

A chord requires a compatible result backend and result-producing tasks. Do not ignore results for tasks participating in chord synchronization. RPC does not support chords. Redis has native completion accounting; the base fallback schedules `celery.chord_unlock`, which checks readiness, retries while incomplete, joins results, and dispatches the callback. See [backend contracts](../integrations/result-backends.md) for storage and expiration dependencies.

Header failures become chord errors rather than successful aggregate input. The fallback unlock path records dependency or callback-publication errors through `chord_error_from_stack`. This checkout also handles a group-shaped chord body by freezing its members, revoking them, and marking failures/errbacks, avoiding a body group that remains pending indefinitely.

Errback calling convention matters: registered errbacks that accept multiple arguments can be called directly with request, exception, and traceback; legacy single-argument forms are dispatched as tasks with the failing task ID. Errback failures are logged in the direct-call path. Design these handlers to tolerate repeated invocation.

## Extending workflows safely

`Task.replace(sig)` substitutes a workflow for the executing task while preserving its task ID and links, carrying forward enclosing chord/chain information. This supports dynamic composition without blocking on a child result. Signature stamping provides visitor-driven metadata across nested structures and links; use it when correlation metadata needs to follow composition.

Neither Canvas nor backend coordination makes task side effects and continuation publication one atomic transaction. Use idempotent task behavior and avoid synchronous `get()` calls from tasks; [delivery and retries](task-delivery.md) explains the independent retry paths.

[Unit Canvas tests](../../t/unit/tasks/test_canvas.py), [chord tests](../../t/unit/tasks/test_chord.py), [stamping tests](../../t/unit/tasks/test_stamping.py), and [integration Canvas tests](../../t/integration/test_canvas.py) cover normalization, failure propagation, and actual worker execution. See [testing](../testing/contributing.md) for the appropriate validation layer.
