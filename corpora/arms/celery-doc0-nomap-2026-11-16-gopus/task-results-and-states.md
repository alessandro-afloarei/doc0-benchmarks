---
title: "Task Results and States"
---
## Overview

Sending a task returns a result object straight away. `AsyncResult` stands for one task by its id and reads its state and return value from the result backend on demand; `ResultSet` and `GroupResult` hold several of them; `EagerResult` wraps a task that already ran in-process. All of them speak in the states defined in `celery/states.py`. This page explains how these objects wait, cache, propagate errors and link to each other. How a backend stores and delivers the data behind them is in [[Result Backend Architecture]].

Sources: [celery/result.py:62-102](repo://celery/result.py#L62-L102), [celery/states.py:126-151](repo://celery/states.py#L126-L151)

## Task states

| State | Meaning |
| --- | --- |
| `PENDING` | Unknown; assumed waiting because you know the id |
| `RECEIVED` | Received by a worker (events only) |
| `STARTED` | Execution started (only with `task_track_started`) |
| `SUCCESS` | Returned normally |
| `FAILURE` | Raised, or exceeded its retry limit |
| `REVOKED` | Revoked before or during execution |
| `REJECTED` | Message rejected (events only) |
| `RETRY` | Waiting to be retried |
| `IGNORED` | Raised `Ignore`; no state is stored |

Sources: [celery/states.py:126-142](repo://celery/states.py#L126-L142)

The state sets drive behaviour elsewhere. `READY_STATES` (`SUCCESS`, `FAILURE`, `REVOKED`) mean a result is final; `UNREADY_STATES` are the rest; `EXCEPTION_STATES` (`RETRY`, `FAILURE`, `REVOKED`) carry an exception as their result; `PROPAGATE_STATES` (`FAILURE`, `REVOKED`) are the ones `get()` re-raises.

Sources: [celery/states.py:144-151](repo://celery/states.py#L144-L151)

`PRECEDENCE` orders states from `SUCCESS` and `FAILURE` down to `PENDING`, with `None` standing for any custom state. The `state` string subclass compares by that order, so a custom state such as `PROGRESS` sorts above `STARTED` but below `SUCCESS`. Monitors use this to keep the most advanced state when events arrive out of order ([[Events and Monitoring]]).

Sources: [celery/states.py:64-123](repo://celery/states.py#L64-L123)

## AsyncResult

### Reading state

`AsyncResult(id, backend=None, app=None, parent=None)` requires an id and defaults to the app's backend. `state`, `result`, `traceback`, `name`, `args`, `kwargs`, `worker`, `date_done`, `retries`, `queue` and `children` all read the task's metadata through `_get_task_meta`. The extended fields (`name`, `args` …) are only present when the backend stores extended results.

Sources: [celery/result.py:89-102](repo://celery/result.py#L89-L102), [celery/result.py:470-576](repo://celery/result.py#L470-L576)

Metadata is cached only once it is final: `_maybe_set_cache` stores the decoded metadata when the state is in `READY_STATES`, rebuilds `children` from their tuples, and fulfils the `on_ready` promise. Until then every property access queries the backend again, so polling `state` reflects progress.

Sources: [celery/result.py:461-486](repo://celery/result.py#L461-L486)

`ready()` checks the state against the backend's ready states, `successful()` and `failed()` compare with `SUCCESS` and `FAILURE`. `exists()` asks the backend whether any result is stored, which tells a task that is truly pending from an id that was never sent or whose result expired, since both report `PENDING`.

Sources: [celery/result.py:351-383](repo://celery/result.py#L351-L383)

### Waiting with get()

`get(timeout=None, propagate=True, interval=0.5, no_ack=True, follow_parents=True, callback=None, disable_sync_subtasks=True, ...)` returns the task's value:

Sources: [celery/result.py:191-196](repo://celery/result.py#L191-L196)

1. A result marked `ignored` (the task had `ignore_result`) returns `None` at once.
2. With `disable_sync_subtasks`, `assert_will_not_block()` raises `RuntimeError("Never call result.get() within a task!")` when running inside a worker task.
3. With `follow_parents` and `propagate`, it first re-raises any failure of the parent results (oldest first), and keeps checking them on every interval.
4. A cached result is returned directly (after re-raising when its state propagates).
5. Otherwise it registers itself as a pending result with the backend and calls `backend.wait_for_pending(...)`, which either polls every `interval` seconds or consumes result messages, depending on the backend.

Sources: [celery/result.py:244-280](repo://celery/result.py#L244-L280)

`timeout` is how long the *caller* waits; the docstring stresses that the task keeps running when it expires, and a `TimeoutError` is raised. With `propagate=False` a failed task's exception instance is returned instead of raised.

Sources: [celery/result.py:206-243](repo://celery/result.py#L206-L243)

`maybe_throw` re-raises an exception state's value, attaching a remote traceback through `tblib` when `task_remote_tracebacks` is on, and calls `callback(id, value)` if given.

Sources: [celery/result.py:385-402](repo://celery/result.py#L385-L402)

### The synchronous-subtask guard

Waiting on another task from inside a task can deadlock a worker whose slots are all busy waiting. The guard is a process-wide flag in `celery._state`. The prefork child initializer sets it, and the worker's pool component sets it from the pool's `task_join_will_block` attribute, which is `True` on `BasePool` and `False` for eventlet and gevent. `allow_join_result()` and `denied_join_result()` are context managers that switch it temporarily; Celery's own chord code joins inside `allow_join_result()`.

Sources: [celery/result.py:30-59](repo://celery/result.py#L30-L59), [celery/concurrency/prefork.py:40-49](repo://celery/concurrency/prefork.py#L40-L49), [celery/worker/components.py:165-172](repo://celery/worker/components.py#L165-L172), [celery/concurrency/base.py:70-70](repo://celery/concurrency/base.py#L70-L70)

### Result graphs

`parent` points to the previous result in a chain, set by the canvas when it freezes the steps ([[Signatures and Chains]]). `as_tuple()` encodes the result and its parents as nested `(id, parent)` tuples, and `result_from_tuple` reverses it, producing a `GroupResult` when the tuple carries child nodes. Backends store `children` in this form.

Sources: [celery/result.py:123-134](repo://celery/result.py#L123-L134), [celery/result.py:1112-1131](repo://celery/result.py#L1112-L1131)

`children` lists results of subtasks the task sent while running (with `trail` on). `iterdeps` walks the tree breadth-first and raises `IncompleteStream` on a node that is not ready unless `intermediate=True`; `collect()` yields `(result, value)` for every node, and `get_leaf()` returns the last value. `build_graph()` turns the tree into a dependency graph.

Sources: [celery/result.py:282-349](repo://celery/result.py#L282-L349), [celery/result.py:403-413](repo://celery/result.py#L403-L413)

### Forgetting and revoking

`forget()` clears the cache, forgets the parents too, removes the pending registration and deletes the stored result. `revoke(terminate=False, signal=None, wait=False, timeout=None)` broadcasts a revoke command through `app.control`; with `terminate=True` the worker also kills the process running the task. `revoke_by_stamped_headers` revokes every task carrying matching stamps ([[Remote Control and Inspection]]).

Sources: [celery/result.py:136-189](repo://celery/result.py#L136-L189)

### Callbacks

`then(callback)` registers the result as pending with the backend and chains a callback on the `on_ready` promise, so asynchronous backends can notify without a blocking `get()`.

Sources: [celery/result.py:115-121](repo://celery/result.py#L115-L121)

## ResultSet

`ResultSet(results)` is a list of results with set-like helpers (`add`, `remove`, `discard`, `update`, `clear`) and aggregate queries: `successful()` (all), `failed()` (any), `waiting()` (any not ready), `ready()` (all ready) and `completed_count()`. A `barrier` over the members fulfils the set's `on_ready` promise when every member is ready, for asynchronous backends.

Sources: [celery/result.py:579-694](repo://celery/result.py#L579-L694)

`join()` calls `get()` on each member in order, sharing one overall `timeout` and raising `TimeoutError('join operation timed out')` when it runs out; with a `callback` it calls `callback(id, value)` instead of collecting. The docstring calls this expensive for polling backends. `join_native()` asks the backend for all members at once through `iter_native` and places values back in order, and `get()` uses it automatically when the backend's `supports_native_join` is true (the docstring names the RPC, Redis and cache backends).

Sources: [celery/result.py:726-825](repo://celery/result.py#L726-L825), [celery/result.py:830-882](repo://celery/result.py#L830-L882)

## GroupResult

`GroupResult(id, results, parent=None)` is the `ResultSet` a `group` returns, plus the group id. `save()` stores it in the backend so `GroupResult.restore(id)` can rebuild it in another process, and `delete()` removes it; chord counting relies on this ([[Groups and Chords]]). It compares equal to its id string and pickles as `(id, results)`; `as_tuple()` adds the member tuples to the parent tuple.

Sources: [celery/result.py:929-1022](repo://celery/result.py#L929-L1022)

## EagerResult

`Task.apply` and eager mode return an `EagerResult` holding the id, value, state, traceback and name in memory. `ready()` is always true, `get()` returns the value or raises it for propagating states (still honouring the synchronous-subtask guard), `forget()` does nothing, and `revoke()` only sets the state to `REVOKED`.

Sources: [celery/result.py:1025-1109](repo://celery/result.py#L1025-L1109), [celery/app/task.py:940-951](repo://celery/app/task.py#L940-L951)
