---
type: "Reference"
title: "Canvas: Signatures, Chains, Groups and Chords"
openwiki_generated: true
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:56:17.091Z
sources:
  - id: openwiki-source-868b95b69384872926804a54
    resource: repo://celery/app/builtins.py
  - id: openwiki-source-4a982797c89fcb3ea5c5d0ee
    resource: repo://celery/app/trace.py
  - id: openwiki-source-98fa58283cefff1b0e071bbe
    resource: repo://celery/backends/base.py
  - id: openwiki-source-6b95f00dc919dfdb3eec1511
    resource: repo://celery/backends/redis.py
  - id: openwiki-source-c4f10fd82ae03f7290951812
    resource: repo://celery/canvas.py
generated: { by: "claude-code", at: "2026-11-16T17:56:17.091Z" }
---


# Canvas: Signatures, Chains, Groups and Chords

`celery/canvas.py` implements Celery's workflow primitives. A canvas is plain data. Every primitive is a `Signature`, which is a `dict` subclass, so it can be serialized into a message, stored as a callback, or sent to another worker. The worker and result backend cooperate with the canvas code at runtime: the worker advances chains and callbacks (see [Task execution and tracing](../workflows/task-execution-and-tracing.md)), and the backend counts chord completions (see [Result backends](result-backends.md)).

## Signature

A `Signature` wraps a task name (or task), `args`, `kwargs`, `options`, an `immutable` flag and an optional `subtask_type`.

- **Registry:** `Signature.TYPES` maps `subtask_type` names to subclasses, registered with `@Signature.register_type()`. `Signature.from_dict` dispatches on it, so a canvas round-trips through JSON. The built-in types are `chain`, `group`, `chord`, `chunks`, `xmap` and `xstarmap`.
- **Applying:** `apply_async` merges partial args and options (`_merge`) and delegates to the task's `apply_async`. If the task is not registered locally it uses `app.send_task` by name. `clone` makes a copy, and `set` adds options.
- **Freezing:** `freeze` assigns a concrete `task_id` (or reuses an existing one), plus `root_id`, `parent_id`, `group_id`, `chord` and `group_index`. It returns the `AsyncResult` for the signature without sending it. Freezing before sending is how the whole result tree is known up front.
- **Callbacks:** `link(sig)` appends to `options['link']` (run on success, with the return value prepended to the args). `link_error(sig)` appends to `options['link_error']` (run on failure). `on_error` is the chaining variant. `immutable=True` (`.si()`) stops a callback from receiving the parent's return value.
- **Operators:** `a | b` builds a `chain`. A `group | task` pair is later upgraded to a chord. `~sig` applies and waits for the result.
- **Immutable options:** `group_id` and `stamped_headers` are protected during freezing and merging (`_IMMUTABLE_OPTIONS`), because changing them would disrupt completion of parent tasks.

## Chain

`chain` (`_chain`) holds a list of tasks. `chain.run` does **not** send every task:

1. `prepare_steps` walks the steps in **reverse**, freezing each one and building the list of signatures in reverse order. This list becomes the `chain` message option, so a worker can simply `pop()` the next step.
2. `run` pops the first step, passes `chain=<remaining steps>` to its `apply_async`, and returns the result of the last step. The parent links on the returned results are wired together, so `result.parent` walks back through the chain.
3. When a worker finishes a step, `_dispatch_callbacks_and_chain` in `celery/app/trace.py` sends the `link` callbacks. It then takes the last element of `chain`, applies it with the return value as its first argument, and passes along the rest of the chain. Dispatch is not atomic. A redelivery can re-dispatch callbacks that were already sent, which the code comment accepts as part of at-least-once delivery.

`prepare_steps` also normalizes the structure:

- Nested chains are flattened.
- A group with a single member is unrolled.
- A `group` followed by another step is automatically **upgraded to a chord**, with the following step as the body.
- `link_error` handlers are propagated to every step, and to the body of an uplifted chord.

`_prepare_chain_from_options` uses a `ChainMap` so that the shared options dict is never mutated. Mutating it once caused cross-contamination between group members (issues #5354 and #3379, documented in the source). With `task_always_eager`, `apply` runs the steps synchronously.

## Group

`group.apply_async` (`celery/canvas.py`) freezes a `group_id` (reusing a `task_id` if one is given), prepares the tasks, and publishes each member inside one acquired producer. It returns a `GroupResult` backed by a `barrier`, and registers the result on the parent task's trail (`add_trail`). Links on a group itself are rejected (`TypeError`: "use a chord"). Errbacks must be set on the individual members.

When a group is being run as a chord header, `_apply_tasks` also totals the chord size across members with `_chord._descend` and calls `backend.set_chord_size(group_id, size)` as the last member is published. This is why chord counts remain correct when members are chains or nested chords.

## Chord

A chord is a `group` header plus a body that receives the list of header results.

- `chord.run` freezes the body (with the header's `group_id`), freezes the header tasks with `chord=body`, and calls `app.backend.apply_chord(...)`. It then publishes the header, and sets `bodyres.parent` to the header result. If the header is empty, the body runs immediately with `[]`.
- `_descend` counts how many completions a signature contributes. A group counts the sum of its members. A chain counts only its last non-empty element. A chord contributes its body. A plain signature counts as 1.
- `chord.link` and `link_error` apply to the **body**, so the body's errbacks are what fire when the chord fails.

### How a backend finishes a chord

How the body fires depends on the backend:

- **Backends with native counting** (for example Redis, and `BaseKeyValueStoreBackend` where `implements_incr` is set) have each header task call `on_chord_part_return` as it finishes. The backend counts completions against the chord size. When the count matches, it joins the header results and calls `callback.delay(results)`. Redis stores encoded results in a sorted set (`result_chord_ordered`, default true) or a list, keyed per group.
- **Other backends** use `BaseBackend.apply_chord`, which calls `fallback_chord_unlock`. That schedules the built-in task `celery.chord_unlock` (`celery/app/builtins.py`). The task polls `GroupResult.ready()` with retries and fires the body once the header is complete.
- `DisabledBackend.ensure_chords_allowed` raises, so chords require a result backend.

### Failure propagation

When a header member fails, `mark_as_failure` (`celery/backends/base.py`) stores the failure and also calls `on_chord_part_return` so the chord is not left waiting. Both completion paths turn a failed join into `chord_error_from_stack`. That calls the body's errbacks with a synthetic request and marks the body task as failed, so the body result becomes terminal.

`mark_as_failure` also walks `request.chain`. For each remaining step it stores the failure under that step's id, and calls `on_chord_part_return` if the step is a chord member. Since the latest fix (#10323), if a chain step is itself a chord, it also descends into that chord's **body** and marks the body failed. A chord step only finishes when its body does, so an enclosing chord polls the body's id, not the step's own id. Without this, an inner chord whose chain failed would leave the outer chord pending forever.

## map, starmap and chunks

`xmap` and `xstarmap` call built-in tasks (`celery.map` and `celery.starmap`) that loop over an iterable inside one worker task. `chunks` splits an iterable into groups of `n` and builds a `group` of `xstarmap` parts, so it parallelizes across workers while each message carries a batch. The built-in task definitions are registered at app finalization (see [App and configuration](app-and-configuration.md)).

## Stamping

Stamping (added in 5.3) attaches custom headers, "stamps", to every signature in a canvas. `Signature.stamp(visitor, append_stamps, **headers)` calls into a `StampingVisitor`. The visitor has hooks per primitive: `on_signature`, `on_group_start` and `on_group_end`, `on_chain_start` and `on_chain_end`, `on_chord_header_start`, `on_chord_header_end`, `on_chord_body`, `on_callback` and `on_errback`. Each hook returns a dict of headers.

`_stamp_headers` merges visitor headers, explicit headers and the signature's own `stamped_headers`. With `append_stamps=False` a later value replaces an earlier one. With `True`, duplicate stamps are aggregated into lists. The `stamped_headers` key records which options are stamps. Stamps travel as message headers and are exposed on the task request. They are tested in `t/unit/tasks/test_stamping.py` and `t/smoke/tests/stamping`.

## Related pages

- [Task publishing](../workflows/task-publishing.md): what `apply_async` does for each member.
- [Result backends](result-backends.md): `GroupResult`, `ResultSet`, and chord counters.
- [Task execution and tracing](../workflows/task-execution-and-tracing.md): how the worker dispatches links and chain steps.
- Tests: `t/unit/tasks/test_canvas.py`, `t/unit/tasks/test_chord.py`, `t/integration/test_canvas.py`.
