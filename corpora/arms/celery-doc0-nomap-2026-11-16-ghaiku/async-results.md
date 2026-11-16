---
title: "AsyncResult and Result Sets"
---
## Overview

Every `apply_async` returns an `AsyncResult`, a handle with the task id. The handle reads the state and the return value from the result backend and can wait for them. A `ResultSet` groups several handles, and a `GroupResult` is a `ResultSet` with an id of its own. This page covers the reading side: how `get` waits, how the set-level methods combine members, and the guard that stops a task from waiting on another task. The storage that these reads use is in [[Result Backend Contract]].

Sources: [celery/result.py:70-103](repo://celery/result.py#L70-L103), [celery/result.py:579-600](repo://celery/result.py#L579-L600), [celery/result.py:929-940](repo://celery/result.py#L929-L940)

## Waiting with get

`get` takes a timeout, an interval, and flags that decide what happens on failure and whether parent errors are re-raised. Its docstring says the call raises `TimeoutError` when the timeout passes, re-raises the task's exception unless `propagate` is false, and returns `None` at once for a task that ignores its result.

Sources: [celery/result.py:191-200](repo://celery/result.py#L191-L200), [celery/result.py:213-242](repo://celery/result.py#L213-L242)

When the result is ignored, `get` returns before any wait. When `disable_sync_subtasks` is set, `get` first calls `assert_will_not_block`, which raises while the join guard is on (see below). When `follow_parents` and `propagate` are set and the result has a parent, a parent error check runs on each interval, so a failing parent ends the wait early.

Sources: [celery/result.py:243-253](repo://celery/result.py#L243-L253)

The wait itself is delegated to the backend. `get` registers the result as pending and calls `wait_for_pending`, which for a synchronous backend polls with `wait_for`, and for an asynchronous backend such as `rpc` or `redis` uses the result consumer and its drainer.

Sources: [celery/result.py:260-269](repo://celery/result.py#L260-L269), [celery/backends/base.py:900-916](repo://celery/backends/base.py#L900-L916), [celery/backends/asynchronous.py:260-268](repo://celery/backends/asynchronous.py#L260-L268)

`wait` is an alias of `get`, kept for older code.

Sources: [celery/result.py:270](repo://celery/result.py#L270)

## Non-blocking reads

`ready` is true when the state is one of the backend's ready states, and `successful` and `failed` are the state checks built on it. A task waiting for a retry is not ready.

Sources: [celery/result.py:369-383](repo://celery/result.py#L369-L383)

`_get_task_meta` asks the backend for the metadata and stores it in the cache when the state is ready; a state that is not ready is returned without caching. `state` and `result` read through that method.

Sources: [celery/result.py:461-478](repo://celery/result.py#L461-L478), [celery/result.py:505-520](repo://celery/result.py#L505-L520)

## The join guard

`assert_will_not_block` raises `RuntimeError` when the join guard is set. The guard is a module-level flag in `celery/_state.py`, and `denied_join_result` sets it for the duration of a block and restores the old value afterwards.

Sources: [celery/result.py:37-39](repo://celery/result.py#L37-L39), [celery/result.py:53-60](repo://celery/result.py#L53-L60), [celery/_state.py:55-62](repo://celery/_state.py#L55-L62)

The eager branch of `apply_async` wraps its `apply` call in `denied_join_result`, so waiting on a result inside an eager run raises instead of blocking.

Sources: [celery/app/task.py:699-701](repo://celery/app/task.py#L699-L701)

## Result sets

`ResultSet` holds a list of results and a barrier that fires its `on_ready` promise once all members are ready. `add`, `remove` and `discard` change the members, and `update` adds several at once.

Sources: [celery/result.py:591-600](repo://celery/result.py#L591-L600), [celery/result.py:609-640](repo://celery/result.py#L609-L640)

The set-level reads combine the members. `successful` and `failed` ask every member, `waiting` is true while any member is not ready, and `completed_count` counts the ready ones. `maybe_throw` re-raises the first member failure it finds.

Sources: [celery/result.py:644-690](repo://celery/result.py#L644-L690)

`GroupResult` adds an id and a parent to the set. It is what `group` returns, so the id names the whole group, and the set can be restored from the backend's group storage.

Sources: [celery/result.py:929-950](repo://celery/result.py#L929-L950)

## Eager results

`EagerResult` is the result of a task that already ran in the caller's process. It holds the value directly and does not contact the backend, so its `ready` and `get` return at once.

Sources: [celery/result.py:1025-1032](repo://celery/result.py#L1025-L1032), [celery/result.py:1052-1060](repo://celery/result.py#L1052-L1060)

`wait_for_pending` in the synchronous backend mixin calls `_ensure_not_eager` before it waits. Under `task_always_eager`, the tracer does not store results unless `task_store_eager_result` is set, and the `_ensure_not_eager` path warns that such results are not retrieved from the backend.

Sources: [celery/backends/base.py:723-731](repo://celery/backends/base.py#L723-L731), [celery/backends/base.py:900-904](repo://celery/backends/base.py#L900-L904)
