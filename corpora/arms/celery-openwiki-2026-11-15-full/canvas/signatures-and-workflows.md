---
type: subsystem
title: "Canvas: Signatures and Workflows"
description: How celery.canvas composes tasks — Signature, chain, group, chord, chunks, xmap/xstarmap — including option merging, freezing, the chain/group→chord upgrade rules, how chains travel in message headers, chord execution via the result backend, stamping, and failure propagation through chains and chords.
tags: [canvas, signature, chain, group, chord, stamping, workflows]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T09:27:53.075Z
sources:
  - id: openwiki-source-4a982797c89fcb3ea5c5d0ee
    resource: repo://celery/app/trace.py
  - id: openwiki-source-98fa58283cefff1b0e071bbe
    resource: repo://celery/backends/base.py
  - id: openwiki-source-c4f10fd82ae03f7290951812
    resource: repo://celery/canvas.py
generated: { by: "claude-code", at: "2026-11-15T09:27:53.075Z" }
---

# Canvas: Signatures and Workflows

`celery/canvas.py` implements Celery's workflow primitives. Everything is built on **`Signature`**, a `dict` subclass describing one task invocation (`task`, `args`, `kwargs`, `options`, `subtask_type`, `immutable`). Because signatures are plain dicts they serialize into message headers and can be reconstructed on the worker with `Signature.from_dict`, which dispatches on `subtask_type` to the classes registered with `@Signature.register_type` (`chain`, `group`, `chord`, `chunks`, `xmap`, `xstarmap`).

## Signatures

- Created with `task.s(*a, **kw)` (partial), `task.si(...)` (immutable), `task.signature(...)` or `celery.signature(name, ...)`.
- `clone(args, kwargs, **opts)` / `_merge()` combine partial arguments: new args are **prepended**, kwargs and options merged. For immutable signatures only options merge. Options listed in `_IMMUTABLE_OPTIONS` (`group_id`, `stamped_headers`) and any stamped headers already present cannot be overridden by merging.
- `freeze(_id, group_id, chord, root_id, parent_id, group_index)` assigns a concrete `task_id` (reusing an existing one), sets `reply_to` and grouping options, and returns the `AsyncResult` *before* anything is sent. Freezing is how canvases build result trees up front. Sending a frozen signature twice produces two messages with the same id.
- `link(callback)` / `link_error(errback)` append to the `link` / `link_error` options; callbacks receive the parent's return value as the first argument (unless immutable), errbacks receive the request/exception.
- `apply_async()` merges options and calls `task.apply_async`; `delay()`, `apply()` and `__call__` behave like their task counterparts.
- `sig1 | sig2` builds a chain; `~sig` is shorthand for `sig.delay().get()`.

## Chains

`chain(a, b, c)` (class `_chain`, with a `chain` subclass whose `__new__` may simplify inputs) runs tasks sequentially, passing each result to the next.

### Composition (`|`) rules

| Expression | Result |
| --- | --- |
| `task \| task` | chain |
| `task \| chain` | flattened chain |
| `chain \| chain` | concatenated chain |
| `chain \| group` | chain ending in the group (single-member groups are unrolled to the task) |
| `chain[... , group] \| task` | the trailing group becomes `chord(group, task)`; if the previous step is also a chord, the new chord is merged into that chord's body |
| `chain[... , chord] \| task` | the task is appended to the chord's **body** |
| `group \| task` | `chord(group, task)` |

### Execution (`_chain.run` / `prepare_steps`)

`prepare_steps` walks the tasks **from last to first**, cloning each (only the first task receives the partial args), flattening nested chains, and **upgrading a group that is followed by another step into a chord** whose body is that following step. Each step is frozen so `result.parent` links form a chain of results; `link_error` is applied to every step (and chord bodies). Chord steps trigger `backend.ensure_chords_allowed()`.

With message protocol v2 (the default) the chain is **not** expressed with `link` callbacks. Instead, the first task is sent with a `chain` option containing the remaining signatures in reverse order (`_prepare_chain_from_options`, built with a `ChainMap` to avoid mutating options shared across group members). When a task succeeds, the tracer's `_dispatch_callbacks_and_chain` pops the last element and sends it with `chain=chain[:-1]`, after first dispatching any `link` callbacks. With `task_protocol=1` links are used instead.

Under `task_always_eager`, chains run synchronously through `apply()`.

## Groups

`group(sigs)` runs tasks in parallel and returns a `GroupResult`.

- `apply_async` rejects `link`/`link_error` (`TypeError`: use a chord, or link individual tasks).
- A group id is taken from the `task_id` option or generated; each member is frozen with `group_id` and its `group_index`.
- `_apply_tasks` publishes members over one producer, using a `vine.barrier` so the `GroupResult` becomes ready when all members do. Tasks may be a generator: it looks one item ahead so it can call `backend.set_chord_size(group_id, size)` when the last member of a chord header is sent, without consuming the generator early.
- An empty group returns its frozen result without publishing.
- `group.skew(start, stop, step)` assigns increasing countdowns.

## Chords

`chord(header, body)` runs a group, then calls `body` with the list of header results.

`_chord.run`:

1. Uses the header's `task_id` as the group id and freezes the body (with `group_id` and `root_id`).
2. Strips `chain`, `chord` and `task_id` from options passed to header tasks (nested chains/chords must not leak into the header).
3. Freezes header tasks with `chord=body`.
4. If the header is non-empty, calls `backend.apply_chord(...)` (backend-specific setup) and then applies the header group. If the header is empty, the body is sent immediately with `[]`.
5. Returns the body's `AsyncResult`, with `parent` set to the header's `GroupResult`.

How the body is triggered depends on the backend (see [Result Backends](../results/result-backends.md)):

- **Native join** (Redis and other key/value backends with `supports_native_join`): each header task calls `backend.on_chord_part_return`, which increments a counter; the task that completes the set gathers results and applies the body.
- **Polling fallback**: `apply_chord` schedules the built-in `celery.chord_unlock` task, which retries (`countdown`, `max_retries=None` by default) until the header `GroupResult` is ready, then sends the body.

Callbacks linked to a chord go to the **body** only. Errbacks go to the body, and — when `task_allow_error_cb_on_chord_header` is enabled — also to each header task (otherwise a `CPendingDeprecationWarning` is emitted). Nested chords in the header handle their own errback linking.

## chunks, xmap, xstarmap

- `xmap(task, it)` / `xstarmap(task, it)` send **one** message to the built-in `celery.map` / `celery.starmap` task that calls `task` for every item in a single worker.
- `chunks(task, it, n)` splits `it` into chunks of size `n`; `chunks.group()` turns it into a group of `xstarmap` (`celery.starmap`) signatures, and `chunks.apply_async()` applies that group, routed by the wrapped task's name. The built-in `celery.chunks` task exists for messages that carry a serialized `chunks` signature.

## Failure propagation

When a task fails, `Backend.mark_as_failure` (`celery/backends/base.py`) stores the failure and then:

- Calls `on_chord_part_return` if the task itself is a chord member (so the chord can fail with `ChordError` rather than stall).
- Walks `request.chain` and, for propagating states, stores the same failure on **every remaining chain element** that has a task id, calling `on_chord_part_return` for elements that belong to a chord.
- For a chained step that is itself a chord (`subtask_type == 'chord'`), descends into its **body** as well, because the body's result is what later steps and enclosing chords wait on. This prevents an outer chord whose header contains `chain(failing_task, group(...))` from waiting forever on a `PENDING` body.
- Finally calls the task's errbacks (`_call_task_errbacks`).

## Stamping

Stamping attaches custom headers to every task in a canvas. A `StampingVisitor` subclass implements `on_signature` (required) and optionally `on_group_start/end`, `on_chain_start/end`, `on_chord_header_start/end`, `on_chord_body`, `on_callback`, `on_errback`, each returning a dict of headers. `sig.stamp(visitor, append_stamps=False, **headers)` walks the canvas; stamped header names are recorded in `stamped_headers` and treated as immutable during option merging. On the worker, stamps appear in `task.request.stamps`; `Context.as_execution_options()` copies them into the options used for retries, so retried tasks keep their stamps.

## Related tests

- `t/unit/tasks/test_canvas.py`, `t/unit/tasks/test_chord.py`, `t/unit/tasks/test_stamping.py`.
- `t/integration/test_canvas.py` — large end-to-end matrix of nested chains/groups/chords against real brokers/backends.
- `t/smoke/tests/test_canvas.py`, `t/smoke/tests/stamping/`.

See also [Tasks, Task Registry and Retries](../app/tasks-and-registry.md) (replace, add_to_chord) and [Result Objects](../results/result-objects.md).
