---
title: "Canvas: Signatures, Chains and Groups"
---
## Overview

The canvas is Celery's way of describing work before running it. A `Signature` captures one task call (name, arguments, options) as a plain dictionary, so it can be stored, sent in a message and used as a callback. `chain` runs signatures in sequence, passing each result to the next; `group` runs them in parallel; `chord` (see [[Chords: Header, Body and Completion]]) joins a group into a callback. `xmap`, `xstarmap` and `chunks` apply one task over an iterable. This page covers signatures, chains and groups, and the stamping API. All of them end up calling `apply_async` as described on [[Calling Tasks: apply_async and send_task]].

Sources: [celery/canvas.py:233-296](repo://celery/canvas.py#L233-L296), [celery/canvas.py:935-956](repo://celery/canvas.py#L935-L956)

## Signatures

`Signature` subclasses `dict` with the keys `task`, `args`, `kwargs`, `options`, `subtask_type` and `immutable`, so it serializes with any content type and can be passed through a message. It accepts a task name, a task object or a whole dict; given a task object it remembers it in `_type` to avoid a registry lookup. The `subtask_type` key and `Signature.TYPES` (filled by `register_type`) let `from_dict` rebuild the right subclass (`chain`, `group`, `chord`, `xmap`, and so on) from a dictionary.

Sources: [celery/canvas.py:297-346](repo://celery/canvas.py#L297-L346)

The normal ways to make one are `task.s(*args, **kwargs)` (which cannot set options), `task.si(...)` (immutable) and `task.signature(args, kwargs, options)`. `signature(varies)` turns a dict, a name or an existing signature into a `Signature`, and `maybe_signature` does so without cloning when it already is one.

Sources: [celery/app/task.py:962-986](repo://celery/app/task.py#L962-L986), [celery/canvas.py:2395-2442](repo://celery/canvas.py#L2395-L2442)

The methods that matter in practice:

| Method | Behaviour |
| --- | --- |
| `delay`, `apply_async`, `apply` | Merge partial args/kwargs/options with the stored ones, then call the task's own method (or `send_task` by name when the task is not registered locally); `apply` runs inline |
| `__call__` | Calls the task function directly in this process |
| `clone` | Copy with `deepcopy` of the options so links are not shared; partial args are prepended |
| `set(**options)` | Updates `options` in place and returns `self`; `set(immutable=...)` also toggles immutability |
| `replace` | Clone with args, kwargs or options replaced if not `None` |
| `link(cb)`, `link_error(eb)` | Append a callback or errback to the `link` or `link_error` option list (no duplicates) |
| `on_error(eb)` | Like `link_error` but returns the signature itself, so it chains |
| `freeze` | Assign a concrete `task_id` (and root, parent, group id, index, chord) and return the `AsyncResult` without sending |
| `a \| b` | Build a chain |

Sources: [celery/canvas.py:347-402](repo://celery/canvas.py#L347-L402), [celery/canvas.py:445-549](repo://celery/canvas.py#L445-L549), [celery/canvas.py:685-746](repo://celery/canvas.py#L685-L746), [celery/canvas.py:859-863](repo://celery/canvas.py#L859-L863)

`_merge` decides how partial values combine. Positional arguments passed later are prepended to the stored ones, which is how `add.s(2) | ...` receives the previous result as its first argument. If the signature is `immutable`, stored args and kwargs win and only the options merge. The options named in `_IMMUTABLE_OPTIONS` (`group_id`, `stamped_headers`) and any stamped header cannot be overwritten, because changing them would disrupt completion of parent tasks.

Sources: [celery/canvas.py:403-443](repo://celery/canvas.py#L403-L443), [celery/canvas.py:293-296](repo://celery/canvas.py#L293-L296)

`freeze` is how a workflow knows its result ids before anything runs. It keeps an existing `task_id` or generates one, fills `reply_to` with the thread's oid, records the group id, chord body and group index, and returns `AsyncResult(task_id)`. The docstring warns not to call a frozen signature twice, which would send two messages with the same id.

Sources: [celery/canvas.py:473-521](repo://celery/canvas.py#L473-L521)

## Chains

`a | b | c` builds a `_chain` (the class behind the `chain` function). `Signature.__or__` returns a chain: task | chain prepends, task | group unrolls a one-member group, task | task makes a pair. `chain.__or__` handles the combinations of chain with group, chord and task, so chains stay flat.

Sources: [celery/canvas.py:759-786](repo://celery/canvas.py#L759-L786), [celery/canvas.py:935-1007](repo://celery/canvas.py#L935-L1007)

Running a chain never keeps the whole sequence in one place. `apply_async` runs it eagerly if `task_always_eager` is set, and otherwise calls `run`, which prepares the steps and sends only the **first** task. The remaining tasks travel in that task's message as the `chain` field, in reverse order so the worker can `pop()` the next one.

Sources: [celery/canvas.py:1036-1095](repo://celery/canvas.py#L1036-L1095)

`prepare_steps` does the preparation by walking the tasks from last to first:

1. Each step is cloned (the first one also receives the chain's partial args and kwargs).
2. A nested chain is spliced in; a group inside a chain is unrolled (`maybe_unroll_group`), and an empty group in the middle is skipped.
3. A group followed by another task is upgraded to a `chord(group, body=next_task)`.
4. Each step is frozen. Only the last gets the chain's `task_id`, the group id and the chord body, so a chain that belongs to a group or chord synchronizes on its last task.
5. Each frozen result's `parent` is linked to the previous step's result, building the result graph.
6. With the legacy `link` mode (protocol 1) each task is linked to the next; otherwise the `chain` field carries the tail. The chain's `link_error` is applied to every step and to a chord's body.

Sources: [celery/canvas.py:1120-1292](repo://celery/canvas.py#L1120-L1292)

`_prepare_chain_from_options` produces the options passed to the first task: it uses a `ChainMap` so the shared options dict is never mutated. A long comment explains that mutating the `chain` option, a list passed by reference, caused tasks in a group to inherit each other's chains. If `chain` is already present, it creates a new list with `options['chain'] + tasks`.

Sources: [celery/canvas.py:877-931](repo://celery/canvas.py#L877-L931), [celery/canvas.py:1075-1095](repo://celery/canvas.py#L1075-L1095)

When the first task finishes, the worker's tracer sends the next one with the return value as its first argument and the rest of the chain attached; this happens inside `_dispatch_callbacks_and_chain` described on [[Task Execution, Tracing and Acknowledgement]]. If a chain member fails, `mark_as_failure` walks the stored `chain` to mark the remaining tasks failed so waiters do not hang (see [[Chords: Header, Body and Completion]]).

Sources: [celery/app/trace.py:467-473](repo://celery/app/trace.py#L467-L473), [celery/backends/base.py:188-252](repo://celery/backends/base.py#L188-L252)

## Groups

`group(*tasks)` accepts signatures, an iterable or a generator; it keeps generators lazy. Its `apply_async` rejects `link` (use a chord) and `link_error` (set it on members) with `TypeError`, runs eagerly under `task_always_eager`, and returns a frozen result for an empty group. Otherwise it follows these steps:

1. `_freeze_gid` picks or creates the group id and root id.
2. `_prepared` clones each member, converts dicts to signatures, unrolls nested groups, prepends the partial arguments and freezes each member with the group id, root id and its index, yielding `(task, result, group_id)`.
3. `_apply_tasks` publishes each member through one producer from the pool, tracking the chord size across the whole generator, and sets the chord size in the backend when the group is a chord header. Each result's fulfilment gradually completes a `barrier`.
4. A `GroupResult(group_id, results, ready_barrier=p)` is returned and added to the parent task's trail.

Sources: [celery/canvas.py:1492-1525](repo://celery/canvas.py#L1492-L1525), [celery/canvas.py:1616-1651](repo://celery/canvas.py#L1616-L1651), [celery/canvas.py:1714-1761](repo://celery/canvas.py#L1714-L1761), [celery/canvas.py:1763-1826](repo://celery/canvas.py#L1763-L1826)

A group that is the only member and whose last chain element is itself a group returns that inner `GroupResult`, a special case the comments call out. `group | task` is upgraded to a chord, and `skew` staggers members' countdowns.

Sources: [celery/canvas.py:1595-1614](repo://celery/canvas.py#L1595-L1614), [celery/canvas.py:1636-1651](repo://celery/canvas.py#L1636-L1651)

## Map, starmap and chunks

`xmap(task, iterable)` and `xstarmap(task, iterable)` are immutable signatures of the built-in tasks `celery.map` and `celery.starmap`, whose bodies apply the task to each item in one process: `[task(item) for item in it]` and `[task(*item) for item in it]`. The docstring says this is sequential, unlike a group. `chunks(task, it, n)` splits the iterable into parts of size `n` and returns a group of `xstarmap` signatures, one task message per chunk. Generators are evaluated with `regen` and turned into lists at send time.

Sources: [celery/canvas.py:1385-1472](repo://celery/canvas.py#L1385-L1472), [celery/app/builtins.py:102-131](repo://celery/app/builtins.py#L102-L131)

## Stamping

Stamping attaches custom headers to every message of a workflow so that later code, such as revoke-by-header, can find them. `Signature.stamp(visitor=None, append_stamps=False, **headers)` merges the stamps into the options; with `visitor`, a `StampingVisitor` subclass decides stamps per primitive by overriding `on_signature`, `on_group_start`/`on_group_end`, `on_chain_start`/`on_chain_end`, `on_chord_header_start`/`end`, `on_chord_body`, `on_callback` and `on_errback`, each returning a dict. `_stamp_headers` merges stamps from the visitor, the arguments and the signature's own options; with `append_stamps` duplicate keys become lists, otherwise the last wins. The names of stamped headers are listed in `stamped_headers`. The stamps travel in the message headers `stamped_headers` and `stamps`, and the revoke-by-stamp command reads them (see [[Remote Control: Inspect and Control]]).

Sources: [celery/canvas.py:119-230](repo://celery/canvas.py#L119-L230), [celery/canvas.py:554-635](repo://celery/canvas.py#L554-L635), [celery/app/amqp.py:370-391](repo://celery/app/amqp.py#L370-L391)
