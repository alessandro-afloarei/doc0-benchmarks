---
type: workflow
title: Canvas workflows and chord coordination
description: Compose serializable task signatures into chains, groups, and chords, with explicit argument, result, and failure semantics.
tags: [canvas, signatures, chains, groups, chords, stamping]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:38:41.370Z
sources:
  - id: openwiki-source-868b95b69384872926804a54
    resource: repo://celery/app/builtins.py
  - id: openwiki-source-3795aa577fa7b0f3bd2af81a
    resource: repo://celery/app/task.py
  - id: openwiki-source-98fa58283cefff1b0e071bbe
    resource: repo://celery/backends/base.py
  - id: openwiki-source-6b95f00dc919dfdb3eec1511
    resource: repo://celery/backends/redis.py
  - id: openwiki-source-a4d1ab266bef232afaa055d8
    resource: repo://celery/backends/rpc.py
  - id: openwiki-source-c4f10fd82ae03f7290951812
    resource: repo://celery/canvas.py
generated: { by: "codex", at: "2026-11-16T16:38:41.370Z" }
---

# Canvas workflows and chord coordination

Canvas represents distributed work as serializable signatures. A signature records a task name, arguments, keyword arguments, and execution options. Calling it publishes work using the selected application's task machinery. Composition constructs message-level dependencies and result relationships; it does not put all tasks inside a single transactional execution.

## Signatures and argument forwarding

`task.s(...)` creates a mutable signature and `task.si(...)` creates an immutable one. Incoming partial positional arguments are prepended to stored arguments, keyword arguments are merged, and execution options are combined. An immutable signature keeps its stored arguments/kwargs while still allowing applicable execution-option changes. Group identity and stamped fields have additional merge protections independent of signature immutability.

For tasks `add(x, y)` and `total(values)`, defined in the application:

```python
from celery import chain, chord, group

serial = chain(add.s(2, 3), add.s(10))   # second call receives (5, 10)
parallel = group(add.s(1, 2), add.s(3, 4))
aggregate = chord(parallel, total.s())  # body receives [3, 7]
```

Use immutable signatures when a step should ignore its predecessor's value, such as a notification with fixed arguments. Cloning/freeze behavior matters when reusing signatures: freezing assigns IDs for result relationships, and workflow preparation can clone and normalize signatures before sending them.

## Chains and groups

A chain normalizes nested steps and prepares result/parent relationships in reverse order. For protocol 2, remaining steps travel in the message's `chain` field; the worker publishes the next step after a successful result, passing that result as a partial argument. Protocol 1 uses callback links instead. The chain's returned handle normally represents the final step, with parent relationships for earlier results.

A group publishes member signatures and returns a `GroupResult`. It is a fan-out container, not a barrier callback. Group-level `apply_async(link=...)` is rejected with guidance to use a chord. A group followed by a task can be upgraded to a chord during chain normalization. Single-member group unrolling and nested normalization mean argument/result shape deserves tests, especially when changing the number or nesting of group members.

## Chords require backend coordination

A chord has a header of parallel work and a body that receives the joined header results. It freezes identifiers, verifies backend chord support, installs completion metadata, and publishes the header. The result backend is responsible for recognizing completion and triggering the body; it is part of workflow correctness, not just optional reporting.

Backends without a native implementation can schedule `celery.chord_unlock`. That built-in task checks whether the header `GroupResult` is ready, retries when it is not, joins with propagation enabled, and then publishes the callback. Join failure or callback-publication failure is routed through `chord_error_from_stack`.

Redis implements native chord completion. It records each part with its group index, checks counts against the expected size, joins/restores nested structures when needed, and publishes the callback. Coordination keys expire and are cleaned after callback handling. RPC explicitly rejects chords. Header/body tasks must retain the results required for synchronization; ignored results and premature expiry can prevent completion. See [backend capabilities](../architecture/results.md).

## Errors, callbacks, and replacement

Success links receive the parent's return value. Error links have more than one invocation form: the backend directly calls compatible multi-argument errbacks with request, exception, and traceback, while older single-argument forms can be sent as tasks using the failed task ID. Match the intended errback signature to the tested path. A group's error link can be attached to multiple children, so one failing group can invoke it more than once.

Chord error linking also depends on `task_allow_error_cb_on_chord_header`: the default links the body; enabling the setting additionally links header work. Test failure behavior for the actual nested composition instead of assuming one callback per entire workflow.

`return self.replace(signature)` dynamically substitutes a task or workflow. It preserves the current task ID, callbacks/errbacks, group/chord context, lineage, and remaining chain. Empty replacement chains and already-chord-bound replacement signatures are rejected. In asynchronous execution the replacement ends the original task with `Ignore`; statements after replacement should not implement more business work.

## Stamping and delivery limits

Stamping uses a visitor to attach metadata across signatures, groups, chains, chords, and links. The message protocol carries stamp names and values, and worker revocation can match stamped headers. Stamps organize and identify workflow members; they do not create atomic cancellation or guarantee execution uniqueness.

Callback publication and backend completion are separate effects. Retries, redelivery, or a failure after an external side effect can repeat work. Design steps and errbacks to tolerate repeats, and inspect [execution/acknowledgement behavior](task-execution.md) when debugging a stalled or duplicated downstream step.

## Source and tests

Read [Canvas](../../celery/canvas.py), [built-in chord unlock](../../celery/app/builtins.py), [backend coordination](../../celery/backends/base.py), and [task replacement](../../celery/app/task.py). Focused tests include [Canvas tests](../../t/unit/tasks/test_canvas.py), [chord tests](../../t/unit/tasks/test_chord.py), [stamping tests](../../t/unit/tasks/test_stamping.py), and [live Canvas integration tests](../../t/integration/test_canvas.py). Use the [testing guide](../testing/development.md) to choose unit versus broker-backed coverage.
