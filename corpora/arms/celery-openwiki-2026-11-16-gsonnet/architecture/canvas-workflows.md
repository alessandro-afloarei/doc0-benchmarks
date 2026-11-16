---
type: architecture
title: "Canvas: Signatures, Chains, Groups and Chords"
description: How Celery composes tasks into workflows — Signature dicts, chain preparation (reverse-ordered chain header, group-to-chord uplift), group and chord execution, chord completion through result backends, error propagation (including the nested-chain chord-body fix), stamping and built-in tasks.
tags: [celery, canvas, chain, group, chord, signature, workflows, stamping]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:22:47.483Z
sources:
  - id: openwiki-source-868b95b69384872926804a54
    resource: repo://celery/app/builtins.py
  - id: openwiki-source-98fa58283cefff1b0e071bbe
    resource: repo://celery/backends/base.py
  - id: openwiki-source-a4d1ab266bef232afaa055d8
    resource: repo://celery/backends/rpc.py
  - id: openwiki-source-c4f10fd82ae03f7290951812
    resource: repo://celery/canvas.py
  - id: openwiki-source-754e3969a848da57c6a89f3e
    resource: repo://t/integration/test_canvas.py
generated: { by: "claude-code", at: "2026-11-16T09:22:47.483Z" }
---

# Canvas: Signatures, Chains, Groups and Chords

`celery/canvas.py` implements the workflow primitives. Everything is a `Signature`, a `dict` subclass that wraps a task name, args, kwargs and options so it can be serialized, stored in a message, and rebuilt on the other side (`Signature.from_dict` dispatches on a `subtask_type` key that classes register with `@Signature.register_type`). Composite types — `chain`, `group`, `chord`, `chunks`, `xmap`, `xstarmap` — are signatures themselves, which is what allows arbitrary nesting. Completion tracking is delegated to the result backend; see [[/openwiki/architecture/result-backends.md]].

## Signature

`Signature` (`celery/canvas.py#L233`) provides:

- **Creation/derivation**: `clone`, `set`, `replace`, partial-argument merging via `__call__`/`delay`/`apply_async`, and `freeze`, which pre-assigns the task id (and `group_id`, `chord`, `root_id`, `parent_id`) so the caller can obtain an `AsyncResult` before anything is sent. Freezing is how chains and chords know the ids of steps that have not run yet.
- **Callbacks**: `link` (success callbacks) and `link_error` (errbacks) are stored as list options; `|` builds a chain (`__or__` has special cases for group/chord operands).
- **Immutability**: `.si()` / `set_immutable` stops a step from receiving the previous step's result.
- **Stamping**: `stamp(visitor, append_stamps, **headers)` attaches custom headers to every message of a workflow. A `StampingVisitor` (`#L119`) overrides hooks such as `on_group_start/end`, `on_chain_start/end`, `on_signature` to compute headers per node; the stamped header names are recorded in `stamped_headers` and are readable on the worker via `Request.stamps`.

## Chain

A `chain` runs steps sequentially. Instead of nesting callbacks, protocol 2 passes the *remaining* steps in the message's `chain` field (reversed, so the worker can `pop()` the next one). `_chain.run` (`#L1048-L1094`) calls `prepare_steps`, pops the first task, and `apply_async`s only that task with the rest of the chain in its options; it returns the result of the *last* task, whose parent links lead back through the chain.

`prepare_steps` (`#L1120-L1292`) is the core of composition:

- It walks the steps **in reverse**, cloning each, **splicing nested chains** into the flat list, and unrolling single-task groups (`maybe_unroll_group`).
- A `group` followed by another step is automatically **upgraded to a chord**: `group(...) | task` becomes `chord(group, body=task)`, reusing the previous step's task id when it has one (the `AttributeError` branch handles a `GroupResult`, which has no `task_id`).
- Only the last task in the chain receives the `group_id`/`chord` options of an enclosing group/chord, so an outer group or chord synchronizes on the chain's final step.
- Chain-level errbacks are applied to every step, and to the body of any chord step, so `chord_error_from_stack` can call them.
- Whenever a chord appears, `app.backend.ensure_chords_allowed()` is called, which raises `NotImplementedError` on backends without chord support (e.g. the RPC and disabled backends).
- Under `task_always_eager`, `apply_async` runs the whole thing synchronously through `apply`.

## Group

`group` sends all member tasks in parallel and returns a `GroupResult`. `group.apply_async` freezes members with a shared `group_id`, then publishes them through a single producer (`_apply_tasks`), optionally respecting `skew` for staggered countdowns. Nested groups are unrolled so all leaf tasks run in parallel. Empty groups publish nothing and return the frozen group. A group refuses `link`/`link_error` (`TypeError`): callbacks on a group require a chord, and errbacks belong on the individual tasks.

## Chord

A `chord(header, body)` runs the header group and, once **all** header tasks have completed, calls the body with the list of header results. `chord.run` (`#L2226-L2286`):

1. Allocates `group_id` and a body task id; freezes the body (so `bodyres` is known) and drops `chain`, `chord` and `task_id` options from what is passed to header tasks (needed for deeply nested chords).
2. Freezes the header tasks with `chord=body` so each header message carries the body signature.
3. Calls `app.backend.apply_chord(...)` **before** sending the header, giving the backend a chance to register the chord (set its size, or schedule the polling fallback).
4. Publishes the header; the body result's `parent` is set to the header `GroupResult`.
5. If the header is empty, nothing could ever trigger the body, so it is called immediately with `[]`.

`chord._descend` / `__length_hint__` computes how many completions the chord needs: each simple signature counts as one, a group counts each member, a chain counts only its last non-empty element, and a nested chord counts through its **body**.

### How completion is detected

There are two strategies, chosen by the backend:

- **Counter-based (Redis and other backends that `implements_incr`)**: every header task, when it finishes, calls `backend.on_chord_part_return`. `BaseKeyValueStoreBackend.on_chord_part_return` (`celery/backends/base.py#L1188-L1257`) restores the `GroupResult`, increments a counter key, and when the count equals the chord size (taken from `request.chord['chord_size']` or the group length) joins the results (`result_chord_join_timeout`) and calls `callback.delay(results)`. Join failures and callback publish failures are turned into `ChordError` and routed to `chord_error_from_stack`; the counter and saved group are deleted in a `finally`. Otherwise the counter key's expiry is refreshed.
- **Polling fallback**: `Backend.apply_chord` → `fallback_chord_unlock` (`#L838-L866`) schedules the built-in `celery.chord_unlock` task on the body's queue/priority with a countdown. `unlock_chord` (`celery/app/builtins.py#L36-L98`) rebuilds the `GroupResult`, retries itself (`self.retry(countdown=interval, max_retries=...)`) while `deps.ready()` is false, then joins and calls the body, or reports a `ChordError` through `chord_error_from_stack`.

## Failure propagation

When a task fails, the tracer calls `backend.mark_as_failure` (see [[/openwiki/workflows/task-lifecycle.md]]). `mark_as_failure` (`celery/backends/base.py#L188-L252`) does three things beyond storing the failure state:

1. If the task is a chord header member (`request.chord`), it calls `on_chord_part_return` with the failure so the chord can error instead of hanging.
2. It **walks the remaining `request.chain` steps**, reconstructing a `Context` for each from its serialized options, and stores the same failure under each step's `task_id` (only for `states.PROPAGATE_STATES`). This is what lets a caller waiting on the *last* task of a chain observe the failure of an earlier step. Chain steps that are chord members also get `on_chord_part_return`.
3. **Chord steps inside the chain (fix for #9674)**: a chord step finishes only when its *body* does, so the id that later steps and any enclosing chord poll is the body's, not the chord step's own id. When the chain element has `subtask_type == 'chord'`, its `body` is appended to the work queue so the failure is stored on the body result too. Without this, a header member such as `chain(fail, group(...), identity)` inside an outer chord left the inner body `PENDING`, `chord_unlock` retried indefinitely and the outer callback never ran. Regression coverage: `t/integration/test_canvas.py` (`test_chord_unlock_with_failed_task_in_nested_chain_member`) and `t/unit/backends/test_base.py` (`test_mark_as_failure__chained_chord_propagates_to_body`).
4. Finally errbacks are invoked (`_call_task_errbacks`) when `call_errbacks` is true.

`chord_error_from_stack` (`#L325`) marks the chord body as failed with a `ChordError`, generating a body task id if missing, and runs `link_error` callbacks using a fake request; group bodies are handled separately so their member tasks are not left hanging.

## Built-in tasks

`celery/app/builtins.py` registers canvas support tasks on every app via `connect_on_app_finalize`: `celery.backend_cleanup`, `celery.accumulate`, `celery.chord_unlock`, `celery.map`, `celery.starmap`, `celery.chunks`, `celery.group`, `celery.chain` and `celery.chord`. They are non-shared and eager (`lazy=False`) so they exist as soon as the app finalizes (see [[/openwiki/architecture/application.md]]).

## Related

- [[/openwiki/architecture/tasks.md]] — `Task.replace`, `add_to_chord` and `apply_async` that signatures delegate to.
- [[/openwiki/architecture/result-backends.md]] — `AsyncResult`/`GroupResult` and the backend chord hooks.
