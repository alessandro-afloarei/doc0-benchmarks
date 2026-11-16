---
title: "Groups and Chords"
---
## Overview

A **group** sends several tasks at once so they run in parallel, and returns a `GroupResult` for all of them. A **chord** is a group (the *header*) plus a *body* signature that runs once every header task has finished, receiving the list of their results. Groups need nothing from the result backend; chords do, because something has to notice when the last header task completes — either a counter in the backend, or a polling task called `celery.chord_unlock`.

Sources: [celery/canvas.py:1492-1524](repo://celery/canvas.py#L1492-L1524), [celery/canvas.py:1971-1997](repo://celery/canvas.py#L1971-L1997)

Both are signatures (see [[Signatures]]), and a chain upgrades a group followed by a task into a chord automatically (see [[Chains]]). The backend side of chord counting is detailed on [[Result Backend Interface]] and [[Redis and RPC Result Backends]].

Sources: [celery/canvas.py:1598-1607](repo://celery/canvas.py#L1598-L1607)

## Groups

### Building a group

`group(a, b, c)` or `group(iterable)` stores the tasks in `kwargs['tasks']` under the pseudo-task `celery.group`; a generator is wrapped lazily so it is not consumed on creation. `group | task` builds a chord with the task as body (an empty group on the right is ignored). `skew(start, stop, step)` sets increasing countdowns on the members.

Sources: [celery/canvas.py:1580-1614](repo://celery/canvas.py#L1580-L1614)

```python
res = group(add.s(i, i) for i in range(10))()
res.get()                 # [0, 2, 4, ..., 18]
```

Sources: [celery/canvas.py:1595-1596](repo://celery/canvas.py#L1595-L1596)

### apply_async

`group.apply_async(args, kwargs, **options)` refuses `link` (use a chord) and `link_error` (put it on the members), runs `apply` in eager mode, and returns a frozen empty `GroupResult` for an empty group. Otherwise:

Sources: [celery/canvas.py:1616-1629](repo://celery/canvas.py#L1616-L1629)

1. `_freeze_gid` takes the group id from `task_id` (or a new UUID), so members do not all share one task id.
2. `_prepared` clones each member, recursively unrolls nested groups into the same group, prepends partial args to mutable members, and freezes each with the group id, root id and its `group_index`.
3. `_apply_tasks` sends every member through one producer and adds each result to a barrier promise. It looks ahead one task so that, when the members belong to a chord, it can call `backend.set_chord_size` with the total size just before sending the last one, without consuming a generator twice (#3021).
4. The results become a `GroupResult` with the barrier, which fires `on_ready` when all members are ready; inside a worker task it is added to the parent's children.

Sources: [celery/canvas.py:1616-1650](repo://celery/canvas.py#L1616-L1650), [celery/canvas.py:1713-1817](repo://celery/canvas.py#L1713-L1817), [celery/canvas.py:1827-1837](repo://celery/canvas.py#L1827-L1837)

`group.freeze()` gives the group and its members ids without sending them. For a generator of tasks it freezes a copy and keeps an unconsumed copy for sending, so freezing does not exhaust the generator.

Sources: [celery/canvas.py:1839-1897](repo://celery/canvas.py#L1839-L1897)

### Callbacks on groups

`group.link(sig)` attaches an immutable clone of the callback to the **first** member only; the comment warns that it may run before the other members finish and even if they fail — a chord is the way to run something after all of them. `group.link_error(sig)` attaches the errback to every member, accepting that it may run more than once rather than not at all.

Sources: [celery/canvas.py:1691-1711](repo://celery/canvas.py#L1691-L1711)

## Maps and chunks

| Primitive | Runs as | Behaviour |
| --- | --- | --- |
| `xmap(task, it)` / `task.map(it)` | One `celery.map` task | Calls `task(item)` for each item, sequentially, in one worker |
| `xstarmap(task, it)` / `task.starmap(it)` | One `celery.starmap` task | Calls `task(*item)` for each item |
| `chunks(task, it, n)` / `task.chunks(it, n)` | A group of `xstarmap` tasks | Splits `it` into parts of `n` items, one task per part |

Sources: [celery/canvas.py:1385-1472](repo://celery/canvas.py#L1385-L1472), [celery/app/builtins.py:100-129](repo://celery/app/builtins.py#L100-L129), [celery/app/task.py:988-1001](repo://celery/app/task.py#L988-L1001)

The `xmap` docstring stresses that it is not a parallel operation like a group. Both map types route by the name of the wrapped task, not the built-in task's.

Sources: [celery/canvas.py:1410-1433](repo://celery/canvas.py#L1410-L1433), [celery/canvas.py:1398-1407](repo://celery/canvas.py#L1398-L1407)

## Chords

### Building a chord

`chord(header, body)` stores the header (normalized to a list of signatures) and the body under the pseudo-task `celery.chord`. Calling `chord(header)(body)` supplies the body at call time. `chord | task` and `chord | group-of-one` chain onto the body rather than wrapping the chord.

Sources: [celery/canvas.py:2059-2091](repo://celery/canvas.py#L2059-L2091), [celery/canvas.py:1475-1489](repo://celery/canvas.py#L1475-L1489)

```python
res = chord([add.s(2, 2), add.s(4, 4)])(tsum.s())
res.get()          # 12
res.parent         # GroupResult of the header
```

Sources: [celery/canvas.py:1981-1995](repo://celery/canvas.py#L1981-L1995)

### Running a chord

`chord.apply_async` merges partial args, clones the body with the call's options and runs `apply` in eager mode. Otherwise `run`:

Sources: [celery/canvas.py:2163-2188](repo://celery/canvas.py#L2163-L2188)

1. Picks the group id (the header's `task_id` or a new UUID) and freezes the body with its own id and that group id.
2. Removes `chain`, `chord` and `task_id` from the options passed to the header, so nested chords and chains are not copied into every header task (#3771).
3. Freezes the header tasks with the group id and `chord=body`, so each header task's message carries the body.
4. If the header has tasks, calls `backend.apply_chord(...)` (which saves the group or schedules `chord_unlock`) and sends the header as a group; if it is empty, sends the body immediately with `[]`.
5. Sets the body result's `parent` to the header's `GroupResult` and returns the body result.

Sources: [celery/canvas.py:2236-2296](repo://celery/canvas.py#L2236-L2296)

`_descend` computes the chord size the backend must wait for: each simple signature counts 1, a group counts its members, a chain counts its last non-empty element, and a nested chord counts its body. The group's `_apply_tasks` stores this size before the last header task is sent.

Sources: [celery/canvas.py:2201-2235](repo://celery/canvas.py#L2201-L2235), [celery/canvas.py:1794-1800](repo://celery/canvas.py#L1794-L1800)

```mermaid
sequenceDiagram
    participant Client
    participant Backend
    participant Workers as "header tasks"
    participant Body as "body task"
    Client->>Client: "chord.run(): freeze body, freeze header with chord=body"
    Client->>Backend: "apply_chord(header_result, body)"
    Client->>Workers: "send header tasks; set_chord_size before last"
    Workers->>Backend: "mark_as_done -> on_chord_part_return(request)"
    Backend->>Backend: "count parts; on last part join results"
    Backend->>Body: "body.delay(results)"
```

Sources: [celery/canvas.py:2236-2296](repo://celery/canvas.py#L2236-L2296), [celery/backends/base.py:180-186](repo://celery/backends/base.py#L180-L186), [celery/backends/base.py:1188-1256](repo://celery/backends/base.py#L1188-L1256)

### Completing a chord

Every header task's request has `chord` set, so `mark_as_done`, `mark_as_failure` and `mark_as_revoked` call `backend.on_chord_part_return`. Backends with a native counter (Redis, memcached, DynamoDB, GCS and other `implements_incr` key/value stores) count completions there and, at the chord size, join the header and send the body.

Sources: [celery/backends/base.py:180-200](repo://celery/backends/base.py#L180-L200), [celery/backends/base.py:306-313](repo://celery/backends/base.py#L306-L313), [celery/backends/base.py:1183-1256](repo://celery/backends/base.py#L1183-L1256)

Other backends use `celery.chord_unlock`. `apply_chord` sends it with a countdown, the group id, the body and the header results; the task checks `deps.ready()` and, while not ready, retries itself every `result_chord_retry_interval` seconds without a retry limit. Once ready it joins the results (natively when supported) and sends the body with them. The RPC backend supports neither and raises `NotImplementedError` from `ensure_chords_allowed`.

Sources: [celery/app/builtins.py:37-98](repo://celery/app/builtins.py#L37-L98), [celery/backends/base.py:838-867](repo://celery/backends/base.py#L838-L867), [celery/backends/rpc.py:214-215](repo://celery/backends/rpc.py#L214-L215)

### Errors

If a header task failed, joining with `propagate=True` raises; the chord then fails with a `ChordError("Dependency <id> raised ...")` whose cause is the original exception, and `chord_error_from_stack` calls the body's errbacks and stores the failure under the body's id. A body that cannot be sent is reported the same way with `Callback error: ...`. When the body is itself a group, `_handle_group_chord_error` revokes its members, calls their errbacks with the original exception and marks each one failed, so they do not hang forever (#8786).

Sources: [celery/app/builtins.py:78-97](repo://celery/app/builtins.py#L78-L97), [celery/backends/base.py:325-426](repo://celery/backends/base.py#L325-L426)

`chord.link(callback)` links to the body only. `chord.link_error(errback)` always links to the body, and to every header task too when `task_allow_error_cb_on_chord_header` is enabled; with it off (the current default) it emits a pending-deprecation warning, since the header behaviour may change. Nested chords in the header do their own linking.

Sources: [celery/canvas.py:2308-2352](repo://celery/canvas.py#L2308-L2352)

### Freezing and eager mode

`chord.freeze()` freezes the header group with `chord=body`, takes the group's id as its own, freezes the body, and links the first parentless result in the body (the body may be a chain) back to the header result, raising `RuntimeError` on a parent cycle. In eager mode `chord.apply()` runs the header with `apply`, gets its results and applies the body with them.

Sources: [celery/canvas.py:2105-2136](repo://celery/canvas.py#L2105-L2136), [celery/canvas.py:2190-2199](repo://celery/canvas.py#L2190-L2199)
