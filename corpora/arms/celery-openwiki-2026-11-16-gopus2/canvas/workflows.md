---
type: subsystem
title: "Canvas: Signatures, Chains, Groups and Chords"
description: How celery/canvas.py composes task workflows — Signature merging and freezing, chain unrolling into a reversed chain message field, group publishing with barriers, chord execution through backend counters or the chord_unlock polling task, stamping, and how errors propagate through chains and chords.
tags: [canvas, signature, chain, group, chord, workflow, stamping]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:05:29.073Z
sources:
  - id: openwiki-source-868b95b69384872926804a54
    resource: repo://celery/app/builtins.py
  - id: openwiki-source-3795aa577fa7b0f3bd2af81a
    resource: repo://celery/app/task.py
  - id: openwiki-source-4a982797c89fcb3ea5c5d0ee
    resource: repo://celery/app/trace.py
  - id: openwiki-source-98fa58283cefff1b0e071bbe
    resource: repo://celery/backends/base.py
  - id: openwiki-source-841e21137490a3db7a509f92
    resource: repo://celery/backends/cache.py
  - id: openwiki-source-6b95f00dc919dfdb3eec1511
    resource: repo://celery/backends/redis.py
  - id: openwiki-source-c4f10fd82ae03f7290951812
    resource: repo://celery/canvas.py
generated: { by: "claude-code", at: "2026-11-16T17:05:29.073Z" }
---

# Canvas: Signatures, Chains, Groups and Chords

The canvas (`celery/canvas.py`) lets callers describe workflows as data. All primitives are `Signature` subclasses — `dict`s that serialise as plain JSON — so they can travel inside task messages as callbacks, chain continuations and chord bodies. The worker side of the protocol lives in `celery/app/trace.py` (dispatching callbacks/chain steps) and in the result backends (joining chords).

## Signature

`Signature(task, args, kwargs, options, subtask_type, immutable)` stores `task` (name), `args`, `kwargs`, `options` (any `apply_async` option) and `subtask_type`. Created via `task.s(...)`, `task.si(...)` (immutable), `task.signature(...)` or `celery.signature(...)`.

- **Partial application.** `_merge()` *prepends* new positional args to stored args and merges kwargs and options. For immutable signatures only options are merged. Options listed in `_IMMUTABLE_OPTIONS` (`group_id`, `stamped_headers`) and any stamped header keys are never overridden — changing them would stall parent completion tracking.
- **Calling.** `sig()` runs the task in-process; `sig.delay()/apply_async()` publish; `sig.apply()` runs eagerly.
- **Freezing.** `freeze()` assigns a concrete `task_id` (reusing an existing one), sets `root_id`, `parent_id`, `group_id`, `chord`, `group_index`, defaults `reply_to` to the app's thread oid, and returns the future `AsyncResult` — without publishing. Freezing is how canvases know result ids before anything runs. Applying a frozen signature twice publishes two messages with the same id.
- **Linking.** `link(callback)` / `link_error(errback)` append to the `link`/`link_error` options. Callbacks receive the parent's return value as first argument (unless immutable).
- **Composition.** `a | b` builds a chain; a group followed by a task becomes a chord; `~sig` is `sig.delay().get()`.
- **Type registry.** `@Signature.register_type()` records subclasses in `Signature.TYPES`, so `Signature.from_dict()`/`maybe_signature()` can rebuild the right class from a deserialised dict using `subtask_type`.

## Chain

`chain(a, b, c)` (`_chain`, created via `chain.__new__`, which may reduce trivial cases) executes tasks sequentially, feeding each result into the next.

`_chain.run()` calls `prepare_steps()`, which walks the tasks **in reverse**:

- Nested chains are spliced inline; nested single-item groups are unrolled; empty groups in the middle are skipped.
- The first task gets the chain's partial args (all tasks are cloned first).
- **A group followed by another step is upgraded to a chord** with that step as body.
- Every step is frozen with the chain's `root_id`; only the last step gets the outer `group_id`/`chord`/`task_id`, so enclosing groups and chords synchronise on the chain's final result.
- Each result's `parent` points to the previous step's result, which is why `AsyncResult.parent` lets you walk a chain backwards.
- `link_error` is applied to every step (and to chord bodies).

With protocol 2 (default), the first task is published with the rest of the steps in the **`chain` message field**, reversed so the worker can pop the next step from the end. When a task succeeds, `trace.py`'s `_dispatch_callbacks_and_chain` sends the `link` callbacks and then applies `chain[-1]` with the return value as argument and `chain[:-1]` as the remaining chain. Protocol 1 instead links each step as a callback. `_prepare_chain_from_options` uses a `ChainMap` so the shared options dict is never mutated, avoiding cross-contamination when chains are applied inside groups (issue #5354).

## Group

`group(sigs)` runs signatures in parallel and returns a `GroupResult`.

- `apply_async` rejects `link` (use a chord instead) and `link_error` (add it to members). In eager mode it runs `apply()`.
- A group id is frozen (`_freeze_gid`); every member is cloned and frozen with that `group_id` and a `group_index`.
- `_apply_tasks` publishes members through one producer and attaches each result to a `vine.barrier`, so the `GroupResult` becomes ready when all members are. It iterates two at a time so it can detect the last item of a generator and call `backend.set_chord_size(group_id, size)` when the group is a chord header — tasks may be a lazy generator (`_regen`).
- The returned `GroupResult` is added to the parent task's trail when called from inside a task.

`chunks(task, it, n)` splits an iterable into a group of `celery.starmap` tasks; `xmap`/`xstarmap` run one `celery.map`/`celery.starmap` task over an iterable. These built-in tasks are registered by `celery/app/builtins.py`.

## Chord

`chord(header, body)` runs a header group and then the body with the list of header results.

`_chord.run()`:

1. Freezes the body with the header's `group_id`.
2. Freezes header tasks with `chord=body` so every header task knows its chord callback.
3. Calls `app.backend.apply_chord(header_result_args, body, ...)`, then publishes the header group.
4. An empty header triggers `body.delay([])` immediately.
5. Returns the body's result, whose `parent` is the header `GroupResult`.

`backend.ensure_chords_allowed()` raises for the disabled backend: **chords require a result backend**.

### How chords are joined

When a header task finishes, the tracer calls `backend.on_chord_part_return(request, state, result)` (via `mark_as_done`/`mark_as_failure`). Backends implement one of three strategies:

| Strategy | Backends | Mechanism |
|----------|----------|-----------|
| Atomic counter | KV backends with `implements_incr = True` (cache/memcached, DynamoDB, GCS) | `apply_chord` saves the `GroupResult`; each part `incr`s `chord-unlock-<gid>`; when the count equals `chord_size`, the group is joined and `callback.delay(results)` sent; keys deleted afterwards |
| Redis native | `RedisBackend` | Each part `ZADD`s (ordered by `group_index`, default) or `RPUSH`es its encoded result into `<gid>.j` in a pipeline with the size key `<gid>.s`; when the ready count equals the size, results are decoded (or a complex saved `GroupResult` joined) and the body is sent |
| Polling fallback | Everything else (`Backend.apply_chord`) | Publishes the `celery.chord_unlock` task, which retries every `result_chord_retry_interval` (unlimited retries) until the `GroupResult` is ready, then joins and calls the body |

If joining fails (a header task failed) or sending the body fails, the backend builds a `ChordError` and calls `chord_error_from_stack(callback, exc)`, which runs the body's errbacks with a fake request and stores the failure on the body id (group bodies are handled specially so they do not hang).

## Error propagation

`Backend.mark_as_failure` (`celery/backends/base.py`) is responsible for making failures visible down the workflow:

- If the failed task is part of a chord, `on_chord_part_return` is called so the chord resolves (as failed).
- Every remaining step in `request.chain` is also marked with the failure (for propagating states) so the chain's final result does not stay `PENDING`; chain elements that are chord members also trigger `on_chord_part_return`.
- If a chain element is a chord (from group-to-chord upgrading), the failure descends into the chord **body**, since that is the id enclosing chords poll (fix for issue #9674 in the latest commit).
- Finally the task's own errbacks run.

Errbacks receive either `(request, exc, traceback)` (new style, detected by signature) or the failed task id (old style).

## Stamping

`StampingVisitor` subclasses (methods `on_signature`, `on_group_start`, `on_chain_start`, `on_chord_header_start`, `on_chord_body`, `on_callback`, `on_errback`, ...) add custom headers to every signature in a canvas via `sig.stamp(visitor)`. Stamped header names are recorded in `stamped_headers` and treated as immutable options, so they survive merging and are forwarded on replaced/retried tasks. `append_stamps=True` accumulates values into lists. Smoke tests in `t/smoke/tests/stamping/` cover this end to end.

## Task.replace

Inside a task, `self.replace(sig)` ends the current task and substitutes a new signature: the replacement is frozen with the current task id and inherits its chord, `group_id`, `group_index` and `root_id`; groups are uplifted to chords, and any remaining steps from the current request's chain are appended so downstream workflow pieces are unaffected (`celery/app/task.py`). `self.add_to_chord(sig)` extends the chord the current task belongs to.

## Tests

- `t/unit/tasks/test_canvas.py`, `t/unit/tasks/test_stamping.py` — unit coverage of merging, freezing, unrolling and stamping.
- `t/unit/backends/test_base.py`, `t/unit/backends/test_redis.py` — chord counting and error propagation.
- `t/integration/test_canvas.py` — large end-to-end matrix of nested chains/groups/chords against real brokers/backends.
- `t/smoke/tests/test_canvas.py`, `t/smoke/tests/stamping/`.

## Related

- [Result Backends](../results/backends.md)
- [Result Objects](../results/result-objects.md)
- [Task Execution, Tracing and Retries](../tasks/execution-tracing-and-retries.md)
