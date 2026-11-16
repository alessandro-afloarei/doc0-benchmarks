---
title: "AsyncResult and GroupResult"
---
## Overview

`AsyncResult` is the handle a caller receives when a task is published: it holds the task id and a backend, and every question about the task, such as its state, its value or whether it failed, is answered by reading the backend. `ResultSet` and `GroupResult` do the same for several tasks, and `EagerResult` stands in when a task ran inline. The objects hold no task data of their own, only an id and a cache of what the backend last returned, so they can be created from an id alone, passed between processes and pickled. The storage side is described in [[Result Backends]], and `group` and `chord` produce the group results in [[Groups and Chords]].

Sources: [celery/result.py:70-103](repo://celery/result.py#L70-L103), [celery/result.py:579-598](repo://celery/result.py#L579-L598), [celery/result.py:929-953](repo://celery/result.py#L929-L953)

## States

A task is always in one of the states defined in `celery/states.py`, and the three sets below decide how the result classes behave:

Sources: [celery/states.py:127-147](repo://celery/states.py#L127-L147)

| Set | Members | Used for |
| --- | --- | --- |
| `READY_STATES` | `SUCCESS`, `FAILURE`, `REVOKED` | `ready()`, deciding the task is finished |
| `UNREADY_STATES` | `PENDING`, `RECEIVED`, `STARTED`, `REJECTED`, `RETRY` | The task is still in progress or may be redelivered |
| `PROPAGATE_STATES` | `FAILURE`, `REVOKED` | Re-raising the stored exception in `get()` |

Sources: [celery/states.py:127-147](repo://celery/states.py#L127-L147)

`PENDING` is also what the backend reports for an id it has no record of, so `PENDING` does not prove that a task was ever sent. `AsyncResult.exists()` asks the backend whether a record exists, which separates a task that is truly pending from an unknown or expired id.

Sources: [celery/backends/base.py:1148-1153](repo://celery/backends/base.py#L1148-L1153), [celery/result.py:351-367](repo://celery/result.py#L351-L367)

## Reading a task

Every property goes through `_get_task_meta`, which returns the cached record when there is one and otherwise calls `backend.get_task_meta(id)`. `_maybe_set_cache` stores the record only when its status is in `READY_STATES`, converts stored child tuples into result objects, and fires `on_ready`. This is why a running task is re-read on every call while a finished one is read once.

Sources: [celery/result.py:461-486](repo://celery/result.py#L461-L486)

The accessors are thin projections of that record:

Sources: [celery/result.py:486-577](repo://celery/result.py#L486-L577)

| Accessor | Returns |
| --- | --- |
| `state` / `status` | The `status` field |
| `result` | The return value, or the exception for a failed task |
| `ready()`, `successful()`, `failed()` | Comparisons of `state` against the state sets |
| `traceback` | The stored traceback |
| `children` | The sub-results the task started |
| `name`, `args`, `kwargs`, `worker`, `retries`, `queue`, `date_done` | Fields stored when `result_extended` is on |

Sources: [celery/result.py:369-383](repo://celery/result.py#L369-L383), [celery/result.py:458-460](repo://celery/result.py#L458-L460), [celery/result.py:486-577](repo://celery/result.py#L486-L577)

## Waiting with get

`AsyncResult.get` returns `None` immediately when the result is marked `ignored` (the sender set this from `ignore_result`), and it calls `assert_will_not_block()` unless `disable_sync_subtasks` is false. It re-raises errors from parents first when `follow_parents` and `propagate` are true, using `_parents()` to walk the `parent` chain, so a failed step in a chain surfaces as an exception from the last result.

Sources: [celery/result.py:191-199](repo://celery/result.py#L191-L199), [celery/result.py:243-282](repo://celery/result.py#L243-L282)

If the record is already cached, `get` returns it, raising when `propagate` is on and the state is in `PROPAGATE_STATES`. Otherwise it registers itself with `backend.add_pending_result` and calls `backend.wait_for_pending`. For a polling backend that is `wait_for`, which calls `get_task_meta` every `interval` seconds until the state is ready, raising `TimeoutError` when `timeout` is exceeded, and then `maybe_throw` raises the stored exception. Backends with asynchronous result consumers override these and do not poll.

Sources: [celery/result.py:258-281](repo://celery/result.py#L258-L281), [celery/result.py:388-397](repo://celery/result.py#L388-L397), [celery/backends/base.py:900-946](repo://celery/backends/base.py#L900-L946)

`maybe_throw` rebuilds a remote traceback with `tblib` when `task_remote_tracebacks` is on and the library is installed, and calls the optional callback with the id and value.

Sources: [celery/result.py:388-402](repo://celery/result.py#L388-L402)

## The blocking guard

A task that waits for another task can deadlock the worker pool. `assert_will_not_block` raises a `RuntimeError` that says never to call `result.get()` within a task whenever `task_join_will_block()` is true. The pool bootstep sets that flag from the pool (`pool.task_join_will_block`, true by default and false for the green pools), and each prefork child sets it true in `process_initializer`.

Sources: [celery/result.py:30-40](repo://celery/result.py#L30-L40), [celery/_state.py:55-61](repo://celery/_state.py#L55-L61), [celery/worker/components.py:171](repo://celery/worker/components.py#L171), [celery/concurrency/prefork.py:41-52](repo://celery/concurrency/prefork.py#L41-L52), [celery/concurrency/base.py:69](repo://celery/concurrency/base.py#L69), [celery/concurrency/eventlet.py:91-96](repo://celery/concurrency/eventlet.py#L91-L96)

Library code that must wait on a result, such as chord joining and eager workflow execution, wraps the call in `allow_join_result()`, which clears the flag and restores it afterwards. `denied_join_result()` sets it for the duration of an eager `apply`, so eager mode reproduces the restriction.

Sources: [celery/result.py:42-60](repo://celery/result.py#L42-L60), [celery/app/task.py:698-701](repo://celery/app/task.py#L698-L701)

## Following a task tree

`collect` and `iterdeps` walk a task and the children it started, depth first through a deque: each node is yielded, and if it is ready its children are queued, otherwise an `IncompleteStream` is raised unless `intermediate` is true. `get_leaf` returns the value of the last node. Children exist only if the tasks were recorded in `request.children`, which `send_task` does through `add_trail` when called inside a task. `build_graph` turns the same walk into a dependency graph.

Sources: [celery/result.py:282-349](repo://celery/result.py#L282-L349), [celery/result.py:403-413](repo://celery/result.py#L403-L413), [celery/app/base.py:1032-1042](repo://celery/app/base.py#L1032-L1042)

## Forgetting and revoking

`forget` clears the cache and calls `backend.forget(id)` for the task and, recursively, its parents. `revoke` does not touch the backend: it sends a control broadcast with `app.control.revoke`, optionally terminating the running process, and `revoke_by_stamped_headers` does the same for tasks matching stamped headers. See [[Remote Control and Revoking]].

Sources: [celery/result.py:136-190](repo://celery/result.py#L136-L190)

## Promises and callbacks

`then(callback, on_error)` registers the result with the backend's pending set and chains on the `on_ready` promise, which `_maybe_set_cache` fulfils; `_on_fulfilled` removes the result from the pending set again. `__del__` also removes a pending result when the object is destroyed, so abandoned handles do not leak.

Sources: [celery/result.py:97-122](repo://celery/result.py#L97-L122), [celery/result.py:444-448](repo://celery/result.py#L444-L448)

## ResultSet and GroupResult

A `ResultSet` wraps a list of `AsyncResult` objects and a `barrier` that becomes ready when every member is. `group.apply_async` passes the barrier it filled while publishing, so the set can know it is complete without polling. `successful`, `failed`, `waiting`, `ready` and `completed_count` aggregate the members, `forget` and `revoke` apply to all of them, and `add`, `remove`, `discard` and `update` manage membership.

Sources: [celery/result.py:591-612](repo://celery/result.py#L591-L612), [celery/result.py:644-718](repo://celery/result.py#L644-L718), [celery/canvas.py:1636-1642](repo://celery/canvas.py#L1636-L1642)

`join` collects the values in member order. It enforces the blocking guard, tracks the remaining time against `timeout` across all members and calls each member's `get`. With a `callback`, values go to the callback and nothing is returned. A timeout raises `TimeoutError('join operation timed out')`, and an `on_message` argument raises `ImproperlyConfigured` because a plain join cannot support it.

Sources: [celery/result.py:742-825](repo://celery/result.py#L742-L825)

`join_native` asks the backend for all results at once through `iter_native`, which yields `(id, meta)` pairs from `backend.get_many` and passes nested `ResultSet` members through as lists. It fills an array indexed by each member's position, so results come back in order, and raises the stored exception when `propagate` is set and a member's state is in `PROPAGATE_STATES`. It is only valid for backends whose `supports_native_join` is true, which the set reads from its first member.

Sources: [celery/result.py:830-883](repo://celery/result.py#L830-L883), [celery/result.py:906-911](repo://celery/result.py#L906-L911), [celery/backends/base.py:879-897](repo://celery/backends/base.py#L879-L897)

`GroupResult` adds an `id` and a `parent`. `save` and `restore` persist the group through the backend's `save_group` and `restore_group`, which is how a chord on a counting backend recovers the structure of its header. `as_tuple` serializes it as `((id, parent), [member tuples])`, and the `children` property is the member list, so a group can be walked like a task. `_failed_join_report` names members that failed and are cached, which chord error messages use.

Sources: [celery/result.py:884-893](repo://celery/result.py#L884-L893), [celery/result.py:929-1022](repo://celery/result.py#L929-L1022)

## EagerResult

When `task_always_eager` is set, `Task.apply` returns an `EagerResult`, which subclasses `AsyncResult` but never touches a backend. It is built from the return value and state directly; `ready()` is always true, `get` returns the value or re-raises the exception when the state is in `PROPAGATE_STATES`, `forget` does nothing, and `revoke` only sets the state to `REVOKED`. Its `get` also honours the blocking guard.

Sources: [celery/result.py:1025-1110](repo://celery/result.py#L1025-L1110), [celery/app/task.py:951](repo://celery/app/task.py#L951)
