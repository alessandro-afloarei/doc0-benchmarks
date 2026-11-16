---
type: "Reference"
title: "Canvas: Signatures, Chains, Groups, and Chords"
openwiki_generated: true
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:42:35.525Z
sources:
  - id: openwiki-source-98fa58283cefff1b0e071bbe
    resource: repo://celery/backends/base.py
  - id: openwiki-source-c4f10fd82ae03f7290951812
    resource: repo://celery/canvas.py
generated: { by: "claude-code", at: "2026-11-16T10:42:35.525Z" }
---


# Canvas: Signatures, Chains, Groups, and Chords

The canvas is Celery's workflow layer. A task call is described as a `Signature` (a `dict` subclass holding the task name, arguments, and options), and the composition primitives combine signatures into larger graphs. Everything lives in `celery/canvas.py`. Completion and failure bookkeeping for composed workflows relies on the result backend, in `celery/backends/base.py`.

## Responsibility and ownership

- `Signature` describes one invocation and knows how to `apply_async`, `apply`, `freeze` (assign task IDs), `stamp` (attach headers), and link callbacks and error callbacks.
- `_chain`/`chain` runs signatures in sequence, `group` runs them in parallel, `_chord` runs a header group and then a body callback, and `xmap`, `xstarmap`, and `chunks` apply one task to many inputs.
- The backend records results for each step, and for chords it counts completed header members to decide when to run the body.

## Signatures

`Signature.__init__` (around line 323) stores `task`, `args`, `kwargs`, and `options` in the dict and sets `subtask_type` when the signature is a container. The main operations are:

- `apply_async` (around line 370) and `apply` for eager execution; `delay` is a shorthand.
- `clone`, `set`, and `replace` produce modified copies without mutating the original.
- `freeze` (around line 473) assigns the task IDs (`task_id`, `group_id`, `chord`, `root_id`, `parent_id`) that the rest of the workflow needs to refer to, so the IDs exist before anything is published.
- `link` and `link_error` (around lines 717 and 726) attach success and failure callbacks. `on_error` (around line 735) is a chaining variant of `link_error` that returns the original signature, so `add.s(2, 2).on_error(errback.s()).delay()` still calls `add`.
- `__or__` (around line 759) implements the `|` operator, which builds a chain.

## Stamping

`StampingVisitor` (line ~119) defines hooks for chain, group, chord-header, chord-body, callbacks, and error callbacks. `Signature.stamp` (around line 614) and `stamp_links` (around line 636) apply a visitor or a set of headers to a signature and its links. `append_stamps` controls whether new values are added to existing stamp lists. Stamps travel with messages as headers, so they can be observed by workers and by monitoring code.

## Chains

`_chain` (line ~935) holds the list of tasks. Calling `apply_async` or `run` (around lines 1036 and 1048) executes the chain by passing the next step's identity through the previous step's options. `prepare_steps` (around line 1120) unpacks nested chains, groups, and chords into a flat sequence of steps, and it performs the conversion of a group that is followed by another step into a chord (the "uplift" the canvas code refers to). `chain` (line ~1322) is the public constructor.

## Groups

`group` (line ~1492) runs its members in parallel. `apply_async` (around line 1616) computes a group ID and publishes each member. `_apply_tasks` (around line 1763) performs the publication. `freeze` (around line 1890) assigns IDs to all members before dispatch. A group's result is a `GroupResult` that tracks each member.

## Chords

`_chord` (line ~1971) combines a header (a group) with a body (a callback signature). Its `apply_async` (around line 2153) and `run` (around line 2226) publish the header and register the body so it runs once every header member has completed. The body is kept in the chord's `kwargs` under the key `body`.

When the backend supports incremental counting (`implements_incr`), `on_chord_part_return` (in `celery/backends/base.py`, around line 1188) is called as each header member returns. Other backends rely on `apply_chord` and a deferred unlock check instead.

## Failure propagation through chained chords

The result backend's `mark_as_failure` (`celery/backends/base.py`, lines ~188–250) is the entry point for recording a failed task. Beyond storing the failure for the task itself, it walks `request.chain` to mark every downstream chain step that has a task ID as failed, so later steps do not stall waiting for a result that will never arrive. For a step that belongs to a chord, it calls `on_chord_part_return` with the failure, so the chord counter advances.

A chain step that is itself a chord completes only when that chord's body completes. The result an enclosing chord or later step waits on is therefore the body's result, not the chord step's own ID. The loop in `mark_as_failure` handles this case: when a chained element has `subtask_type == 'chord'`, the loop appends the element's `body` from its kwargs to the work queue and propagates the failure to it. This is what allows an outer chord to resolve when one header member is a chain whose inner chord fails. Before this handling, the body result stayed `PENDING`, the outer chord's unlock check never completed, and the callback never ran (the case described by issue #9674 and fixed in commit `1432d9b`).

Errbacks attached to the failed request are called after the chain walk, through `_call_task_errbacks`.

## Invariants

- A signature's IDs are assigned by `freeze` before any step is published, so downstream steps can be addressed by ID even before they run.
- A chord's body runs only after every header member has completed; a failure in a member is reported to the chord counter so the count can still reach its total.
- Failure propagation marks downstream steps as failed rather than leaving them pending, which prevents indefinite stalls on the result an outer chord polls.

## Failure behaviour and limits

- Only `PROPAGATE_STATES` are written to downstream steps during failure propagation. Chain steps without a task ID (complex signatures) are skipped; the code assumes the final step controls completion.
- Chord correctness depends on the result backend. Backends without `implements_incr` use the unlock path, which retries until header results are available.

## Extension seams

- Custom visitors subclass `StampingVisitor` to add headers across a whole workflow.
- `Signature` subclasses can be registered with `Signature.register_type`, which the `from_dict` path uses to rebuild typed signatures.

## Representative tests

- `t/unit/tasks/test_canvas.py` and `t/unit/test_canvas.py` cover signature, chain, group, and chord behaviour.
- `t/integration/test_canvas.py` exercises canvas workflows against a real broker and backend.
- The backend-side failure path is tested under `t/unit/backends/`.
