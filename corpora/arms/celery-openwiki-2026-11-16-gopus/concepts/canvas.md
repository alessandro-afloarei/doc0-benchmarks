---
type: concept
title: "Canvas: Signatures, Chains, Groups and Chords"
description: How Celery composes workflows from serializable task signatures — Signature merging, cloning and freezing; chain unrolling and upgrades to chords; group publishing; chord execution via backend counters or the polling chord_unlock task; error propagation; and stamping.
tags: [canvas, signature, chain, group, chord, stamping, workflow]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:57:55.789Z
sources:
  - id: openwiki-source-868b95b69384872926804a54
    resource: repo://celery/app/builtins.py
  - id: openwiki-source-98fa58283cefff1b0e071bbe
    resource: repo://celery/backends/base.py
  - id: openwiki-source-c4f10fd82ae03f7290951812
    resource: repo://celery/canvas.py
generated: { by: "claude-code", at: "2026-11-16T06:57:55.789Z" }
---

# Canvas: Signatures, Chains, Groups and Chords

`celery/canvas.py` implements workflow primitives. Everything is a
**`Signature`** — a `dict` subclass with keys `task`, `args`, `kwargs`,
`options`, `subtask_type`, `immutable` — so whole workflows serialize as JSON
inside task messages and can be rebuilt on the worker with
`Signature.from_dict` / `maybe_signature`. Subclasses register themselves
under a `subtask_type` (`chain`, `group`, `chord`, `xmap`, `xstarmap`,
`chunks`) through `Signature.register_type`.

## Signature

- Created with `task.s(*a, **kw)`, `task.si(...)` (immutable),
  `task.signature(args, kwargs, options)` or `celery.signature(name, ...)`.
- `_merge(args, kwargs, options)` implements **partial application**: extra
  args are *prepended* (`args + self.args`), kwargs are merged, options
  override existing ones — except `group_id` and stamped header keys, which
  are never overwritten because changing them would stall the parent
  group/chord. Immutable signatures ignore new args/kwargs.
- `clone()` deep-copies options; `set(**options)`, `link(callback)`,
  `link_error(errback)`, `on_error()` adjust options in place.
- `freeze(_id, group_id, chord, root_id, parent_id, group_index)` assigns a
  task id (keeping an existing `task_id`), default `reply_to`
  (`app.thread_oid`) and group/chord metadata, and returns the
  `AsyncResult` before anything is sent. Calling a frozen signature twice
  would publish two messages with the same id.
- `apply_async()` → `task.apply_async(args, kwargs, **options)` after
  merging; `delay()` is the star-args shortcut; `apply()` runs eagerly.
- `|` creates chains; `~sig` is `sig.delay().get()`.

## Chains

`chain(a, b, c)` (or `a | b | c`) runs tasks sequentially, passing each
result as the first argument of the next (unless the next is immutable).

**Composition rules** (`Signature.__or__`, `_chain.__or__`):

| Expression | Result |
|------------|--------|
| `task \| task` | chain |
| `task \| chain` / `chain \| chain` | flattened chain |
| `task \| group` | chain (a one-element group is unrolled to its task) |
| `chain[... , group] \| task` | the trailing group becomes **`chord(group, task)`** |
| `chain[..., chord] \| task` | the task is appended to the chord **body** |

**Execution** (`_chain.run` → `prepare_steps`): nested chains are unrolled,
a group followed by another step is upgraded to a chord, each step is cloned
and frozen from the last to the first so ids and `parent_id`/`root_id` are
known in advance. Only the **first** task is published; the remaining steps
travel in its `chain` message option (stored **reversed**, so the worker
pops `chain[-1]` as the next step — see
[execution tracing](../architecture/worker/task-execution-trace.md)). With
protocol 1 the legacy `link`-based chaining is used instead. The chain's
`AsyncResult` is the last task's result, whose `.parent` links back
through the chain. `task_always_eager` runs the chain locally with
`apply()`.

`_prepare_chain_from_options` uses a `ChainMap` and never mutates the shared
options dictionary, because groups reuse one options dict for every member
(fix for a historical bug where chains leaked between group members).

## Groups

`group(sigs)` publishes all members in parallel and returns a
`GroupResult(group_id, results)`:

- `apply_async` freezes a group id, prepares each member (cloning with
  `group_id`, `group_index`, partial args), and publishes them with one
  producer, using a `vine.barrier` to resolve the result when all members
  have been sent.
- `link` / `link_error` on a group raise `TypeError` — use a chord to run
  something after a group, and add errbacks to individual tasks.
- Generators are supported as group members (`_regen`) for lazy, very large
  groups.
- When called from inside a task, the `GroupResult` is added to the parent
  task's trail (`add_trail`) so it appears in `result.children`.
- `xmap`, `xstarmap` and `chunks(task, it, n)` are helpers built on the
  built-in `celery.map`, `celery.starmap` and `celery.chunks` tasks;
  `chunks.group()` splits an iterable into a group of starmap chunks.

## Chords

`chord(header_group, body)` runs the header in parallel and then calls the
body with the list of header results.

`_chord.run`:

1. freezes the body with a fresh id, `group_id` = header id, and the
   body's `root_id`;
2. freezes the header tasks with `chord=body` (every header task carries the
   chord body in its request);
3. calls `backend.apply_chord(header_result_args, body, ...)`, then publishes
   the header group;
4. for an **empty header** calls `body.delay([])` immediately;
5. returns the body's `AsyncResult` with `.parent` set to the header's
   `GroupResult`.

Chords require a result backend (`DisabledBackend` and RPC raise in
`ensure_chords_allowed`). How completion is detected depends on the backend
([result backends](../architecture/result-backends.md)):

- **Native counting** – Redis (sorted set + size key) and other key/value
  backends with atomic `incr`: each header task's `on_chord_part_return`
  (called by `mark_as_done` / `mark_as_failure`) increments a counter; the
  final one joins the results and calls the body.
- **Polling fallback** – other backends: `apply_chord` →
  `fallback_chord_unlock` schedules the built-in `celery.chord_unlock` task
  (routed to the body's queue). It checks `GroupResult.ready()` and retries
  itself every `result_chord_retry_interval` (default 1 s, unlimited retries)
  until ready, then joins (`result_chord_join_timeout`) and calls the body.

### Error propagation

- If a header task fails, the join raises; the backend builds a `ChordError`
  (`"Dependency <id> raised ..."`) and `chord_error_from_stack` marks the body
  failed and runs the body's errbacks. `chord.link_error(errback)` attaches
  the errback to the body, and also (as an immutable clone) to every header
  task when `task_allow_error_cb_on_chord_header` is enabled (default off,
  with a pending-deprecation warning).
- A failing task in a chain marks every remaining chain element with an id as
  failed, and descends into chord bodies that are chain steps, so neither the
  chain's final result nor an enclosing chord waits forever (see
  `Backend.mark_as_failure`).
- Errbacks whose task signature accepts more than one positional argument
  are **called inline** in the failing worker with `(request, exc,
  traceback)`; other errbacks are published as a group with the old
  `(task_id)` argument (`Backend._call_task_errbacks`).

## Stamping

Stamping attaches custom headers to every task in a canvas, e.g. to revoke a
whole workflow by stamp:

- Implement a `StampingVisitor` (`on_signature`, `on_group_start`,
  `on_chain_start`, `on_chord_header_start`, `on_chord_body`, `on_callback`,
  `on_errback`, ...) returning header dicts.
- `sig.stamp(visitor, append_stamps=False, **headers)` walks the canvas;
  stamps are stored in options and listed in `stamped_headers`, which the
  message carries as `stamps` / `stamped_headers` headers.
- Stamped header values are immutable under `_merge`.
- The worker revokes by stamp via `revoke_by_stamped_headers`, matched in
  `Request.revoked()` ([remote control](../architecture/remote-control-and-events.md)).
- Task-level stamping is also possible in `before_task_publish` handlers or
  through `Task.on_replace` / `Task.replace`.

## Tests

- `t/unit/tasks/test_canvas.py`, `t/unit/test_canvas.py` – composition rules,
  freezing, prepare_steps.
- `t/unit/tasks/test_chord.py`, `t/unit/tasks/test_stamping.py`.
- `t/integration/test_canvas.py` – large end-to-end suite of nested
  workflows against real brokers/backends.
- `t/smoke/tests/test_canvas.py`, `t/smoke/tests/stamping/`.

See also: [Tasks](tasks.md),
[Result backends](../architecture/result-backends.md).
