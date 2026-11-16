---
title: "Task Results"
---
## Overview

Sending a task returns a result object at once, before any worker has seen the message. The object holds only the task id (and, for workflows, links to related results); every question about state or return value is answered by the result backend when asked. `celery.result` defines the classes the caller works with: `AsyncResult` for one task, `ResultSet` and its subclass `GroupResult` for several, and `EagerResult` for tasks run in-process. This page describes their behaviour; how backends store and deliver results is in [[Result Backends]], and the meaning of each state in [[Retries, Errors and Task States]].

Sources: [celery/result.py:62-101](repo://celery/result.py#L62-L101), [celery/result.py:579-597](repo://celery/result.py#L579-L597)

## AsyncResult

### Creating and identifying

`AsyncResult(id, backend=None, app=None, parent=None)` raises `ValueError` for a `None` id and otherwise only stores the id, the backend (default `app.backend`) and an optional parent. `app.AsyncResult(task_id)` and `task.AsyncResult(task_id)` create one for any id, so a web request can check a task that another process sent. Results compare equal to each other and to strings by id, hash by id, and pickle as their id, backend and parent.

Sources: [celery/result.py:89-101](repo://celery/result.py#L89-L101), [celery/result.py:415-442](repo://celery/result.py#L415-L442), [celery/app/task.py:953-960](repo://celery/app/task.py#L953-L960)

### Reading state and metadata

Every property reads the task's metadata through `_get_task_meta`, which asks the backend for the current record unless a final record is already cached. Once the state is in `READY_STATES`, the record is cached on the object and the `on_ready` promise fires, so later reads cost nothing.

Sources: [celery/result.py:461-485](repo://celery/result.py#L461-L485)

| Attribute | Meaning |
| --- | --- |
| `state` / `status` | Current state; `PENDING` for unknown ids |
| `result` / `info` | Return value, the exception for failures, or the metadata dict for custom states |
| `traceback` | Formatted traceback of a failure |
| `ready()`, `successful()`, `failed()` | State in ready states, equal to `SUCCESS`, equal to `FAILURE` |
| `children` | Results of tasks sent by this task (needs `trail=True`) |
| `name`, `args`, `kwargs`, `worker`, `retries`, `queue`, `date_done` | Extended metadata, present when `result_extended` is on |
| `exists()` | Whether the backend has any record for the id |

Sources: [celery/result.py:351-383](repo://celery/result.py#L351-L383), [celery/result.py:457-459](repo://celery/result.py#L457-L459), [celery/result.py:487-575](repo://celery/result.py#L487-L575)

`exists()` matters because `PENDING` is also what the backend reports for an id it has never seen, an expired result, or a typo. Checking existence separates a queued task from a lost one.

Sources: [celery/result.py:351-367](repo://celery/result.py#L351-L367)

### Waiting with get()

`get(timeout=None, propagate=True, interval=0.5, ...)` blocks until the task is ready and returns its value.

Sources: [celery/result.py:191-245](repo://celery/result.py#L191-L245)

1. Returns `None` at once if the result was sent with `ignore_result` (`result.ignored`).
2. Raises `RuntimeError` if called where joining would block a worker (see below), unless `disable_sync_subtasks=False`.
3. With `follow_parents`, re-raises a failure from any parent in a chain first, checking again on every polling interval.
4. Returns the cached value if the result is already known.
5. Otherwise registers itself as pending and calls `backend.wait_for_pending(...)`.

Sources: [celery/result.py:246-269](repo://celery/result.py#L246-L269), [celery/result.py:272-280](repo://celery/result.py#L272-L280)

How the wait happens depends on the backend. Polling backends loop on `get_task_meta`, sleeping `interval` seconds and raising `celery.exceptions.TimeoutError` after `timeout`. The RPC and Redis backends receive results pushed over a subscription and ignore `interval`. The `timeout` only limits the caller's wait; the task keeps running.

Sources: [celery/backends/base.py:900-944](repo://celery/backends/base.py#L900-L944)

When the final state is `FAILURE` or `REVOKED` and `propagate` is true, `maybe_throw` re-raises the stored exception in the caller; with `propagate=False` the exception instance is returned. If `task_remote_tracebacks` is on and `tblib` is installed, the re-raised exception carries the worker's traceback.

Sources: [celery/result.py:385-401](repo://celery/result.py#L385-L401)

> [!WARNING]
> Each `AsyncResult` that is never read can leave state behind: the RPC backend keeps messages for it, and stored results stay until they expire. Call `get()` or `forget()` on every result you create.

Sources: [celery/result.py:198-203](repo://celery/result.py#L198-L203)

### Callbacks instead of blocking

`then(callback, on_error=None)` registers the result with the backend and attaches the callback to the `on_ready` promise. With an asynchronous backend (RPC, Redis) the callback runs when the result message is drained, without a blocking `get()`.

Sources: [celery/result.py:115-121](repo://celery/result.py#L115-L121)

## The deadlock guard

A task that sends a subtask and then waits for it with `get()` holds a pool slot while waiting. If every slot is taken by such tasks, the subtasks can never run. Celery therefore refuses by default: `assert_will_not_block()` raises `RuntimeError("Never call result.get() within a task!")` when the process-wide `task_join_will_block` flag is set.

Sources: [celery/result.py:30-39](repo://celery/result.py#L30-L39), [celery/_state.py:40-61](repo://celery/_state.py#L40-L61)

The worker sets the flag from its pool when it starts, and every prefork child sets it in its initializer. Pools based on eventlet and gevent leave it off, because their greenlets do not hold an OS-level slot. `Task.apply_async` in eager mode runs the task inside `denied_join_result()`, so tests catch the mistake too.

Sources: [celery/worker/components.py:171](repo://celery/worker/components.py#L171), [celery/concurrency/prefork.py:40-49](repo://celery/concurrency/prefork.py#L40-L49), [celery/concurrency/base.py:70](repo://celery/concurrency/base.py#L70), [celery/concurrency/gevent.py:92](repo://celery/concurrency/gevent.py#L92), [celery/app/task.py:699-701](repo://celery/app/task.py#L699-L701)

Code that must wait (the chord unlock task, for example) wraps the call in `allow_join_result()`, or passes `disable_sync_subtasks=False`. The better fix is usually a chain or chord ([[Signatures and Chains]], [[Groups and Chords]]).

Sources: [celery/result.py:42-59](repo://celery/result.py#L42-L59), [celery/app/builtins.py:75-81](repo://celery/app/builtins.py#L75-L81)

## Result graphs

### Parents and children

Results link in two directions. `parent` points to the previous step of a chain (set when the chain is frozen), so the result of `a | b | c` is `c`'s result and `res.parent.parent` is `a`'s. `children` lists the results of tasks sent while this task ran, stored with its result when `trail` is enabled. `as_tuple()` and `result_from_tuple()` serialize this structure, including nested group results, so it can be stored and rebuilt.

Sources: [celery/result.py:123-134](repo://celery/result.py#L123-L134), [celery/result.py:1112-1131](repo://celery/result.py#L1112-L1131)

### Walking the tree

`collect()` walks the children breadth-first with `iterdeps()` and yields `(result, value)` for each node, waiting for each one with `get()`. A node that is not ready when visited raises `IncompleteStream` unless `intermediate=True`. `get_leaf()` returns the value of the last node, and `build_graph()` creates a `DependencyGraph` of the tree for visualization.

Sources: [celery/result.py:282-349](repo://celery/result.py#L282-L349), [celery/result.py:403-411](repo://celery/result.py#L403-L411)

## Results for several tasks

### ResultSet

`ResultSet(results)` wraps a list of results. `ready()`, `successful()`, `failed()`, `waiting()` and `completed_count()` (the number of successful tasks) aggregate over the members; `revoke()` revokes them all in one control broadcast; `forget()` forgets each. A `barrier` promise fires the set's `on_ready` when all members are ready, which asynchronous backends use to deliver callbacks.

Sources: [celery/result.py:591-611](repo://celery/result.py#L591-L611), [celery/result.py:644-717](repo://celery/result.py#L644-L717)

### join and join_native

`get()` on a set uses `join_native` when the backend supports it, else `join`.

Sources: [celery/result.py:726-740](repo://celery/result.py#L726-L740)

| Method | How it waits | Order |
| --- | --- | --- |
| `join(timeout, propagate, callback)` | Calls `get()` on each member in turn, sharing one overall timeout | Member order |
| `join_native(...)` | Asks the backend for all ids at once through `iter_native`/`get_many` | Member order, rebuilt from an id index |

Sources: [celery/result.py:742-825](repo://celery/result.py#L742-L825), [celery/result.py:830-882](repo://celery/result.py#L830-L882)

`join` re-raises the first failure it meets when `propagate` is true; otherwise failed positions hold the exception. With a `callback(task_id, value)`, values are passed to it instead of collected, and `join` returns an empty list. `join_native` fetches many ids per round trip, which matters for large groups on Redis or memcached.

Sources: [celery/result.py:784-825](repo://celery/result.py#L784-L825), [celery/result.py:862-882](repo://celery/result.py#L862-L882)

### GroupResult

`GroupResult(id, results, parent=None)` is the result of a group: a `ResultSet` with the group id. It can be persisted with `save()` and rebuilt in another process with `GroupResult.restore(id)` (or `app.GroupResult.restore`), which is how chords on key-value backends find their members. `delete()` removes the saved copy. Its `children` are its members, and it serializes through `as_tuple()` with its parent.

Sources: [celery/result.py:929-1021](repo://celery/result.py#L929-L1021)

## EagerResult

`Task.apply()` and eager mode return an `EagerResult`, which holds the return value, state and traceback directly and never touches the backend. `ready()` is always true; `get()` returns the value or, for failed tasks and with `propagate`, raises the exception (wrapping non-exception values in `Exception`). `revoke()` only sets the local state to `REVOKED`, and `forget()` does nothing.

Sources: [celery/result.py:1024-1109](repo://celery/result.py#L1024-L1109)

## Forgetting and revoking

`forget()` drops the local cache, forgets the parent chain, unregisters the result from the backend's pending set and deletes the stored record with `backend.forget(id)`. Backends that cannot delete raise `NotImplementedError`.

Sources: [celery/result.py:136-143](repo://celery/result.py#L136-L143), [celery/backends/base.py:695-700](repo://celery/backends/base.py#L695-L700)

`revoke(terminate=False, signal=None, wait=False, timeout=None)` broadcasts a revoke command for the id; `wait=True` collects replies from workers for `timeout` seconds. `revoke_by_stamped_headers` revokes by stamp instead ([[Canvas Stamping]]). Both are described in [[Remote Control and Inspection]].

Sources: [celery/result.py:145-189](repo://celery/result.py#L145-L189)
