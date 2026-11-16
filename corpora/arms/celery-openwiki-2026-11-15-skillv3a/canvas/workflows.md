---
type: subsystem
title: "Canvas: Signatures, Chains, Groups and Chords"
description: How celery/canvas.py represents task invocations as serializable Signature dicts and composes them into chains, groups, chords, chunks and map/starmap; how chains travel in the message, how chords are joined (chord_unlock polling, counter-based incr, Redis native join), stamping, and how errors propagate.
tags: [canvas, signature, chain, group, chord, stamping, workflows]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:49.645Z
sources:
  - id: openwiki-source-868b95b69384872926804a54
    resource: repo://celery/app/builtins.py
  - id: openwiki-source-4a982797c89fcb3ea5c5d0ee
    resource: repo://celery/app/trace.py
  - id: openwiki-source-98fa58283cefff1b0e071bbe
    resource: repo://celery/backends/base.py
  - id: openwiki-source-6b95f00dc919dfdb3eec1511
    resource: repo://celery/backends/redis.py
  - id: openwiki-source-a4d1ab266bef232afaa055d8
    resource: repo://celery/backends/rpc.py
  - id: openwiki-source-c4f10fd82ae03f7290951812
    resource: repo://celery/canvas.py
generated: { by: "claude-code", at: "2026-11-15T17:08:49.645Z" }
---

# Canvas: Signatures, Chains, Groups and Chords

`celery/canvas.py` implements Celery's workflow primitives. Every primitive is a **`Signature`**, which is a `dict` subclass with the keys `task`, `args`, `kwargs`, `options`, `subtask_type`, and `immutable`. Signatures can therefore be serialized in JSON task messages and rebuilt on the worker side with `Signature.from_dict`. That method dispatches on `subtask_type` to the classes registered with `@Signature.register_type` (`chain`, `group`, `chord`, `chunks`, `xmap`, `xstarmap`).

| Primitive | Build with | Dispatch | Result |
|---|---|---|---|
| `Signature` | `task.s()`, `task.si()` (immutable), `task.signature()`, `celery.signature()` | `apply_async` → `Task.apply_async` | `AsyncResult` |
| `chain` | `chain(a, b, c)` or `a \| b \| c` | first task published with remaining steps in the `chain` message field | `AsyncResult` of last task, with `.parent` links |
| `group` | `group(a, b, ...)` | each member published separately with a shared `group_id` | `GroupResult` |
| `chord` | `chord(header_group, body)`, or `group \| sig` inside a chain | header published, body triggered by the backend when the header completes | `AsyncResult` of body, with `.parent` = header `GroupResult` |
| `chunks` / `xmap` / `xstarmap` | `task.chunks(it, n)`, `task.map(it)`, `task.starmap(it)` | built-in tasks `celery.chunks` / `celery.map` / `celery.starmap` | single task (chunks can become a group) |

## Signatures: partial application and options

- `Signature._merge()` prepends partial `args`, merges `kwargs`, and overlays `options`. Immutable signatures (`.si()`, `set_immutable(True)`) keep their own `args` and `kwargs` and only merge options. Some options are never overwritten during merging: `group_id`, `stamped_headers`, and any header listed in `stamped_headers` (`_IMMUTABLE_OPTIONS`). Overwriting them would break completion tracking of the parent.
- `freeze()` assigns a task ID, and optionally `group_id`, `chord`, `root_id`, `parent_id`, and `group_index`, before sending. It returns the `AsyncResult` that the task will produce. Workflows freeze their members up front so that callers get result objects immediately.
- `link()` and `link_error()` append callbacks and errbacks to the `link` and `link_error` options. `on_error()` is a chaining-friendly alias. The `|` operator builds chains: `sig | sig`, `sig | chain`, and `sig | group` (a single-member group is unrolled).

## Chains

`_chain.run()` calls `prepare_steps()`. That method walks the tasks **in reverse**:

- Nested chains are spliced inline.
- Nested single-task groups are unrolled. Empty groups in the middle of a chain are skipped.
- A group followed by another step is **automatically upgraded to a chord** (`group(...) | s` → `chord(group, s)`). The backend must support chords (`ensure_chords_allowed`).
- Every task is cloned and frozen with the chain's `root_id`. The last task gets the chain's requested task ID, `group_id`, and chord body, so an enclosing group or chord synchronizes on the chain's final step.
- `link_error` is attached to every step. When a step is a chord, the errback is also attached to the chord **body**. This lets `chord_error_from_stack` call it when the header fails.
- Results are chained through `.parent`, so the returned `AsyncResult` (last task) can walk back to the first.

With protocol 2 (the default), the remaining steps are not nested as `link` callbacks. They are carried as a reversed list in the message's `chain` field. `_prepare_chain_from_options()` uses a `ChainMap` so that the shared `options` dict is never mutated. Mutating it caused wrong results when chains ran inside groups (issues #5354 and #3379). In the worker, the tracer's `_dispatch_callbacks_and_chain` pops the last element of `chain` and calls `apply_async((retval,), chain=chain[:-1], ...)` once the step succeeds (`celery/app/trace.py`). Callback dispatch is not atomic, so a redelivery may re-send callbacks, which is consistent with at-least-once semantics. Protocol 1 falls back to `link` chaining.

If `task_always_eager` is set, `apply_async` on a chain, group, or chord runs it synchronously through `.apply()` under `allow_join_result()`.

## Groups

`group.apply_async()`:

1. rejects `link` and `link_error` (use a chord, or link individual tasks instead);
2. freezes a group ID (`_freeze_gid`) and prepares members (`_prepared`), unrolling nested groups;
3. publishes each member through `_apply_tasks()` on one shared producer. It counts the chord size with `_chord._descend()` and, on the last member of a chord header, calls `backend.set_chord_size(group_id, size)`. It does this without exhausting generator inputs, by peeking one task ahead;
4. returns `app.GroupResult(group_id, results, ready_barrier=p)`, where a `vine.barrier` is fulfilled as member results become ready.

A group is not a task. Its members just share `group_id`, and `group_index` preserves ordering in results.

## Chords: header, body, and join strategies

`_chord.run()` freezes the body with the header's group ID, freezes the header tasks with `chord=body`, calls `app.backend.apply_chord(header_result_args, body, ...)`, and then publishes the header group. An empty header runs `body.delay([])` immediately. Every header task carries the body signature in its `chord` request field. When a header task finishes, the tracer calls `backend.on_chord_part_return()`.

How the join completes depends on the result backend:

| Strategy | Backends | Mechanism |
|---|---|---|
| **Polling (`celery.chord_unlock`)** | default `BaseBackend.apply_chord` (for example database, MongoDB) | `fallback_chord_unlock` publishes the built-in `celery.chord_unlock` task to the body's queue. It retries every `result_chord_retry_interval` until `GroupResult.ready()`, then joins (`join_native` if supported) and calls `callback.delay(results)`. |
| **Counter (`implements_incr`)** | key-value backends with atomic `incr`, such as cache/memcached | `apply_chord` becomes `_apply_chord_incr`, which saves the `GroupResult`. Each `on_chord_part_return` increments `chord-unlock-<gid>`, and when the counter reaches `chord_size` it joins and fires the body. |
| **Native Redis** | `RedisBackend` (`supports_native_join`) | Each part `ZADD`s (or `RPUSH`es) its encoded result to `<gid>.j` in a pipeline and reads `<gid>.t`/`<gid>.s` (size). When the ready count equals the total, it reads all results (ordered by `group_index` using a sorted set unless `result_backend_transport_options['result_chord_ordered']` is set to `False`, in which case a list is used), fires the body, and deletes the keys. Complex headers (nested `GroupResult`) are saved and restored so their structure is kept. |
| **Not supported** | RPC backend | `ensure_chords_allowed()` raises `NotImplementedError`. |

## Error propagation

- If a header task fails, the join raises. The backend builds a `ChordError` ("Dependency <id> raised ...") and calls `chord_error_from_stack(callback, exc)`. That method calls the body's errbacks through a fake request, then marks the body as failed in the body task's backend. A group body is handled specially (`_handle_group_chord_error`) so its members don't hang.
- If the callback itself cannot be published, the backend records `ChordError('Callback error: ...')` the same way.
- In a chain, a failing step stops the chain because later steps are never dispatched. Its `link_error` errbacks run, and chained errbacks are also attached to chord bodies, so a failed chain step propagates to the body of a later chord.

## Stamping

Stamping (since 5.3) attaches custom headers to every task in a canvas. `sig.stamp(visitor=None, append_stamps=False, **headers)` merges stamps into options and records their names in `stamped_headers`. Stamped headers are immutable during later merges. A `StampingVisitor` subclass receives callbacks (`on_signature`, `on_group_start`/`end`, `on_chain_start`/`end`, `on_chord_header_start`/`end`, `on_chord_body`, `on_callback`, `on_errback`) and returns headers to apply. Composite types override `stamp()` to recurse into members, links, and errbacks. On the worker, stamps appear in the task request and are forwarded when tasks are replaced (see `t/smoke/tests/stamping/`).

## Other helpers

- `chunks(task, it, n)` splits an iterable into `n`-sized `xstarmap` calls. Calling `.group()` turns it into a group.
- `Signature.election()` uses broadcast control to elect one worker to run a task.
- `maybe_signature(d, app)` and `signature(varies, ...)` rebuild signatures from dicts, for example from message fields.

## Tests

- `t/unit/test_canvas.py`: construction, freezing, merging, and stamping.
- `t/unit/tasks/test_canvas.py`, `t/unit/tasks/test_chord.py`, `t/unit/tasks/test_stamping.py`: canvas, chord join, and stamping unit tests.
- `t/integration/test_canvas.py`: real end-to-end chains and chords against Redis and RabbitMQ.
- `t/smoke/tests/test_canvas.py` and `t/smoke/tests/stamping/`: docker-based workers.

## See also

- [Results API](../results/result-api.md)
- [Result Backends](../results/backends.md)
- [Task Execution Tracing](../tasks/execution-tracing.md)
