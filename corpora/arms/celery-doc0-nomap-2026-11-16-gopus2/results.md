---
title: "Results and AsyncResult"
---
## Overview

Every call to `apply_async` returns a result object that refers to the task by id. It holds no value of its own: reading its `state` or calling `get()` asks the app's result backend for the stored metadata, and the object caches the answer once the task is finished. `AsyncResult` represents one task, `ResultSet` a list of them, `GroupResult` a saved group, and `EagerResult` a task that already ran locally.

Sources: [celery/result.py:69-102](repo://celery/result.py#L69-L102), [celery/app/base.py:1028-1033](repo://celery/app/base.py#L1028-L1033)

How the backend stores and fetches that metadata, and how the RPC and Redis backends push results instead of being polled, is on [[Result Backend Interface]] and [[Redis and RPC Result Backends]].

Sources: [celery/result.py:470-473](repo://celery/result.py#L470-L473)

## Task states

`celery.states` defines the states a task can be in. `PENDING` means "unknown": the backend has nothing for the id, which is also what an id that was never sent, or whose result expired, looks like. `RECEIVED` and `REJECTED` only appear in events.

Sources: [celery/states.py:126-137](repo://celery/states.py#L126-L137)

| State | Meaning | Ready | Propagates |
| --- | --- | --- | --- |
| `PENDING` | Unknown, assumed waiting | no | no |
| `RECEIVED` | Received by a worker (events only) | no | no |
| `STARTED` | Started (with `track_started`) | no | no |
| `RETRY` | Waiting for a retry | no | no |
| `SUCCESS` | Finished successfully | yes | no |
| `FAILURE` | Raised an exception | yes | yes |
| `REVOKED` | Revoked | yes | yes |

Sources: [celery/states.py:126-151](repo://celery/states.py#L126-L151)

`READY_STATES` (`SUCCESS`, `FAILURE`, `REVOKED`) mark a finished task; `PROPAGATE_STATES` (`FAILURE`, `REVOKED`) are re-raised by `get()`; `EXCEPTION_STATES` adds `RETRY` to them, the states whose stored result is an exception.

Sources: [celery/states.py:142-145](repo://celery/states.py#L142-L145)

States also have an order. `PRECEDENCE` lists them from highest to lowest — `SUCCESS`, `FAILURE`, unknown (custom) states, `REVOKED`, `STARTED`, `RECEIVED`, `REJECTED`, `RETRY`, `PENDING` — and the `state` string subclass compares by it, so a custom state such as `PROGRESS` ranks above `STARTED` but below `SUCCESS`. Event consumers use this to merge out-of-order events; see [[Cluster State from Events]].

Sources: [celery/states.py:61-123](repo://celery/states.py#L61-L123)

## AsyncResult

### Reading metadata

An `AsyncResult(id, backend=None, app=None, parent=None)` requires an id and uses the app's backend by default. Its properties all read the cached metadata dict: `state` (alias `status`), `result` (alias `info`; the exception for failed tasks), `traceback`, `children`, `date_done`, and — when the backend stores extended results — `name`, `args`, `kwargs`, `worker`, `retries` and `queue`. `ready()`, `successful()` and `failed()` compare the state.

Sources: [celery/result.py:89-102](repo://celery/result.py#L89-L102), [celery/result.py:369-383](repo://celery/result.py#L369-L383), [celery/result.py:487-576](repo://celery/result.py#L487-L576)

`_get_task_meta` asks the backend for the metadata until the task reaches a ready state; then `_maybe_set_cache` stores it, converts stored children into result objects, and fulfils the `on_ready` promise. After that, no further backend calls are made for this object.

Sources: [celery/result.py:461-485](repo://celery/result.py#L461-L485)

`exists()` asks the backend whether anything is stored for the id, which distinguishes a truly pending task from an unknown or expired id — both report `PENDING`.

Sources: [celery/result.py:351-367](repo://celery/result.py#L351-L367)

### get()

`get(timeout=None, propagate=True, interval=0.5, ...)` waits for the result:

Sources: [celery/result.py:191-195](repo://celery/result.py#L191-L195)

1. A result marked `ignored` (the task was sent with `ignore_result`) returns `None` immediately.
2. Unless `disable_sync_subtasks=False`, `assert_will_not_block()` raises `RuntimeError("Never call result.get() within a task!")` when called inside a pool process where waiting would block.
3. With `follow_parents` and `propagate`, the parents (earlier steps of a chain) are checked first and on every polling interval, so a failure earlier in the chain is raised even if this task never runs.
4. If the result is already cached, it is returned (or its exception raised).
5. Otherwise the result is registered with the backend as pending and `backend.wait_for_pending` waits — by polling every `interval` seconds, or by consuming pushed results for RPC and Redis.

Sources: [celery/result.py:191-269](repo://celery/result.py#L191-L269), [celery/result.py:272-280](repo://celery/result.py#L272-L280)

When the task failed and `propagate` is true, `maybe_throw` re-raises the stored exception. With `task_remote_tracebacks` and the `tblib` package installed, the worker's traceback is attached to it.

Sources: [celery/result.py:385-401](repo://celery/result.py#L385-L401)

### The deadlock guard

Waiting on a result from inside a task can deadlock a worker whose processes are all busy waiting. `task_join_will_block` is a process-wide flag; the worker's `Pool` step sets it from the pool's `task_join_will_block` attribute (true for prefork, false for green pools), and prefork children set it in their initializer. `allow_join_result()` and `denied_join_result()` are context managers that change the flag temporarily; eager calls run under `denied_join_result`.

Sources: [celery/result.py:30-59](repo://celery/result.py#L30-L59), [celery/worker/components.py:173](repo://celery/worker/components.py#L173), [celery/concurrency/prefork.py:49](repo://celery/concurrency/prefork.py#L49), [celery/app/task.py:701-703](repo://celery/app/task.py#L701-L703)

### Following children and parents

When a task sends other tasks, their results are recorded as its `children` (with `trail=True`, the default). `iterdeps()` walks this tree breadth-first, raising `IncompleteStream` when it reaches a node that is not ready unless `intermediate=True`. `collect()` yields `(result, value)` for every node, `get_leaf()` returns the last value, and `build_graph()` returns a dependency graph of the tree.

Sources: [celery/result.py:282-349](repo://celery/result.py#L282-L349), [celery/result.py:403-413](repo://celery/result.py#L403-L413)

`parent` links a chain step to the previous one. `as_tuple()` and `as_list()` serialize the id with its parent chain, and `result_from_tuple` rebuilds an `AsyncResult` or `GroupResult` with its parents from that form.

Sources: [celery/result.py:123-134](repo://celery/result.py#L123-L134), [celery/result.py:1110-1131](repo://celery/result.py#L1110-L1131)

### forget, revoke and then

`forget()` drops the cache, forgets the parents, stops waiting and deletes the stored result. `revoke(terminate=False, signal=None, wait=False, timeout=None)` broadcasts the `revoke` control command, and `revoke_by_stamped_headers` the stamped variant (see [[Remote Control and Inspection]]). `then(callback)` registers the result with the backend and returns a promise fulfilled when the result is ready — useful with backends that push results.

Sources: [celery/result.py:115-189](repo://celery/result.py#L115-L189)

## ResultSet and GroupResult

### ResultSet

A `ResultSet` holds a list of results with `add`, `remove`, `discard`, `update` and `clear`, and aggregates them: `successful()` if all succeeded, `failed()` if any failed, `waiting()` if any are not ready, `ready()` if all are, and `completed_count()`. A barrier promise fires `on_ready` when every member is ready on asynchronous backends.

Sources: [celery/result.py:579-694](repo://celery/result.py#L579-L694)

`get()` calls `join_native` when the backend supports it, else `join`. `join` waits for each result in order with the remaining share of the timeout, returning the values as a list (or calling `callback(task_id, value)` per result instead). `join_native` lets the backend deliver results in any order through `iter_native` and places each value at its member's index. Both apply the same deadlock guard as `get()`.

Sources: [celery/result.py:726-806](repo://celery/result.py#L726-L806), [celery/result.py:830-882](repo://celery/result.py#L830-L882)

```python
from celery import group
res = group(add.s(i, i) for i in range(10))()
res.get(timeout=10)          # [0, 2, 4, ...]
res.completed_count()
```

Sources: [celery/result.py:726-740](repo://celery/result.py#L726-L740)

### GroupResult

`GroupResult` adds an `id` and a `parent`; it is what calling a group returns (see [[Groups and Chords]]). `save()` stores the group's member ids in the backend and the class method `restore(id)` loads it back, so another process can follow a group by its id; `delete()` removes the saved entry. Its `children` are its results, and `as_tuple()` includes them.

Sources: [celery/result.py:929-1022](repo://celery/result.py#L929-L1022)

## EagerResult

`Task.apply()` and eager `apply_async()` return an `EagerResult`, which holds the return value, state and traceback directly. It is always ready; `get()` returns the value or raises the stored exception when `propagate` is true; `forget()` does nothing and `revoke()` only sets the local state to `REVOKED`.

Sources: [celery/result.py:1025-1107](repo://celery/result.py#L1025-L1107)
