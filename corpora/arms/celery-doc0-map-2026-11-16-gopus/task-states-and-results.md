---
title: "Task States and AsyncResult"
---
## Overview

Sending a task returns an `AsyncResult`: a handle holding the task id and the result backend, through which the caller asks for the task's state and waits for its return value. The handle stores nothing on its own; every question goes to the backend, and the answer is cached once the task reaches a final state. Groups return a `GroupResult`, and eager calls return an `EagerResult` that already holds the outcome.

Sources: [celery/result.py:69-100](repo://celery/result.py#L69-L100), [celery/result.py:1025-1036](repo://celery/result.py#L1025-L1036)

This page covers the vocabulary of states, the result classes, and how waiting works for polling and for push-based backends. How the backend stores and encodes results is in [[Result Backend Interface]]; which backend to use is in [[Result Backend Catalogue]].

Sources: [celery/states.py:1-60](repo://celery/states.py#L1-L60)

## States

`celery.states` defines the built-in state names and the sets the rest of Celery uses to reason about them:

Sources: [celery/states.py:62-66](repo://celery/states.py#L62-L66)

| State | Meaning |
| --- | --- |
| `PENDING` | Unknown; assumed pending since the id is known |
| `RECEIVED` | Received by a worker (events only) |
| `STARTED` | Started by a worker, when `task_track_started` is on |
| `SUCCESS` | Succeeded |
| `FAILURE` | Raised an exception or ran out of retries |
| `REVOKED` | Revoked |
| `REJECTED` | Rejected (events only) |
| `RETRY` | Waiting to be retried |
| `IGNORED` | Raised `Ignore`; nothing is stored |

Sources: [celery/states.py:120-151](repo://celery/states.py#L120-L151)

`READY_STATES` is `{SUCCESS, FAILURE, REVOKED}`; `UNREADY_STATES` is `{PENDING, RECEIVED, STARTED, REJECTED, RETRY}`; `EXCEPTION_STATES` is `{RETRY, FAILURE, REVOKED}` (the stored result is an exception); and `PROPAGATE_STATES` is `{FAILURE, REVOKED}`, the states whose exception `get()` re-raises. A task id that was never sent, or whose result expired, also reads as `PENDING`; `AsyncResult.exists()` asks the backend whether anything is stored, to tell the two apart.

Sources: [celery/states.py:140-151](repo://celery/states.py#L140-L151), [celery/result.py:358-375](repo://celery/result.py#L358-L375)

States are ordered by `PRECEDENCE`, from `SUCCESS` and `FAILURE` at the top, then unknown states (`None`), then `REVOKED`, `STARTED`, `RECEIVED`, `REJECTED`, `RETRY` and `PENDING`. The `state` class, a `str` subclass, compares by that order, so a custom state such as `PROGRESS` ranks above every built-in state except `SUCCESS` and `FAILURE`. Event monitors use this to avoid moving a task backwards when events arrive out of order ([[Events and Monitoring]]).

Sources: [celery/states.py:65-118](repo://celery/states.py#L65-L118)

## AsyncResult

`AsyncResult(id, backend=None, app=None, parent=None)` requires an id, takes the backend from the app when none is given, and keeps `parent` for chains. Created through `app.AsyncResult`, it is bound to that app ([[The Celery Application]]).

Sources: [celery/result.py:85-100](repo://celery/result.py#L85-L100)

Reading a property calls `_get_task_meta()`, which asks `backend.get_task_meta(id)` until the result is ready and then caches the decoded meta, turning stored child tuples into result objects. Before that point every access is a backend round trip.

Sources: [celery/result.py:478-498](repo://celery/result.py#L478-L498)

| Member | Returns |
| --- | --- |
| `state` / `status` | The stored state |
| `result` / `info` | Return value, or the exception instance for failed tasks |
| `traceback` | Traceback text of a failed task |
| `ready()`, `successful()`, `failed()` | State in `READY_STATES`, equal to `SUCCESS`, equal to `FAILURE` |
| `children` | Results of subtasks recorded through `trail` |
| `name`, `args`, `kwargs`, `worker`, `retries`, `queue`, `date_done` | Extended meta, when the backend stores it |
| `exists()` | Whether the backend has any record for the id |

Sources: [celery/result.py:376-392](repo://celery/result.py#L376-L392), [celery/result.py:466-577](repo://celery/result.py#L466-L577)

Two `AsyncResult` objects are equal when their ids are, and an `AsyncResult` also equals its id string. `as_tuple()` serializes the result with its parent chain as nested tuples, and `result_from_tuple` rebuilds an `AsyncResult` or `GroupResult` from that form; this is how backends store children and how `chord_unlock` receives the header.

Sources: [celery/result.py:118-121](repo://celery/result.py#L118-L121), [celery/result.py:438-447](repo://celery/result.py#L438-L447), [celery/result.py:1112-1131](repo://celery/result.py#L1112-L1131)

## Waiting with get

`get(timeout=None, propagate=True, interval=0.5, no_ack=True, follow_parents=True, callback=None, on_message=None, on_interval=None, disable_sync_subtasks=True)` returns `None` at once for a result marked `ignored` (the task was sent with `ignore_result`). It then:

Sources: [celery/result.py:241-243](repo://celery/result.py#L241-L243)

1. Refuses to block inside a task, through `assert_will_not_block()`, unless `disable_sync_subtasks=False`.
2. With `follow_parents` and `propagate`, re-raises the first failed parent's exception, both now and on every interval while waiting, so a broken chain fails fast.
3. Returns the cached value if the result is already cached, re-raising its exception when `propagate`.
4. Otherwise registers the result as pending with the backend and calls `backend.wait_for_pending(...)`.

Sources: [celery/result.py:191-277](repo://celery/result.py#L191-L277)

When the task failed, `maybe_throw` raises the stored exception. If `task_remote_tracebacks` is enabled and `tblib` is installed, the remote traceback text is turned into a real traceback attached to it. With `propagate=False` the exception instance is returned instead. A `timeout` only limits the caller's wait and raises `celery.exceptions.TimeoutError`; the docstring stresses that the task itself is not terminated.

Sources: [celery/result.py:394-410](repo://celery/result.py#L394-L410), [celery/result.py:209-240](repo://celery/result.py#L209-L240)

`collect(intermediate=False)` follows the task tree through `children` and yields `(result, value)` for each node, raising `IncompleteStream` when it meets a node that is not ready unless `intermediate` is true. `get_leaf()` returns the value of the last node, and `build_graph()` produces a `DependencyGraph` of the tree.

Sources: [celery/result.py:279-356](repo://celery/result.py#L279-L356), [celery/result.py:412-420](repo://celery/result.py#L412-L420)

## The deadlock guard

Calling `get()` from inside a task can deadlock: the waiting task holds a pool slot that the subtask may need. `celery._state` keeps a module-level flag, and `assert_will_not_block()` raises `RuntimeError` ("Never call result.get() within a task!") while it is set. The prefork pool sets it in every child process, and the `Pool` bootstep copies the pool's `task_join_will_block` attribute into the flag; the eventlet and gevent pools set that attribute to `False`. `allow_join_result()` and `denied_join_result()` are context managers that switch the flag temporarily; Celery's own chord code uses `allow_join_result()` where it must join, and eager `apply_async` uses `denied_join_result()`.

Sources: [celery/result.py:30-60](repo://celery/result.py#L30-L60), [celery/_state.py:40-61](repo://celery/_state.py#L40-L61), [celery/concurrency/prefork.py:41-49](repo://celery/concurrency/prefork.py#L41-L49), [celery/worker/components.py:171-172](repo://celery/worker/components.py#L171-L172), [celery/concurrency/base.py:70-70](repo://celery/concurrency/base.py#L70-L70)

## Polling and push-based waiting

### SyncBackendMixin

`wait_for_pending` comes from one of two mixins on the backend, and which one decides whether waiting polls. Store-and-query backends use `SyncBackendMixin`. `wait_for` loops on `get_task_meta`, sleeping `interval` seconds between checks and raising `TimeoutError` once the accumulated sleep exceeds the timeout; the comment says the sleep is there to avoid "hammering the CPU". `iter_native` for a result set calls the backend's `get_many` with all ids at once. `add_pending_result` and `remove_pending_result` do nothing.

Sources: [celery/backends/base.py:879-955](repo://celery/backends/base.py#L879-L955)

### AsyncBackendMixin and the result consumer

Backends that receive results as messages (the RPC backend, and Redis through pub/sub) use `AsyncBackendMixin`. `add_pending_result` starts the backend's drainer, resolves the result immediately if its message already arrived and was buffered in `_pending_messages`, and otherwise records it in the pending maps and asks the `result_consumer` to subscribe to its id. Removing a pending result unsubscribes.

Sources: [celery/backends/asynchronous.py:225-313](repo://celery/backends/asynchronous.py#L225-L313)

`BaseResultConsumer.on_state_change(meta, message)` handles each incoming state message: it calls any `on_message` callback, and for a ready state finds the pending result, fills its cache, and appends it to the bucket of any result set collecting it. A message for a result nobody registered yet goes to the buffer, which covers the race where the task finishes before the caller calls `get()`. `_wait_for_pending` drains events until the result's `on_ready` promise is fulfilled, turning a socket timeout into `TimeoutError`.

Sources: [celery/backends/asynchronous.py:397-449](repo://celery/backends/asynchronous.py#L397-L449)

The drainer depends on the environment detected by Kombu. The default `Drainer` calls `drain_events` in the caller's thread in one-second slices until the promise is ready, logging and sleeping on `OSError` instead of spinning. Under eventlet or gevent, `greenletDrainer` runs `drain_events` in a background greenlet and wakes waiters with an event after each drain; if that greenlet dies, later waits re-raise its exception or report that Celery must be restarted.

Sources: [celery/backends/asynchronous.py:57-115](repo://celery/backends/asynchronous.py#L57-L115), [celery/backends/asynchronous.py:115-223](repo://celery/backends/asynchronous.py#L115-L223)

## Releasing results

`forget()` clears the cache, forgets parents too, and calls `backend.forget(id)` to delete the stored result. `revoke(terminate=False, signal=None, wait=False, timeout=None)` broadcasts a revoke for the id through `app.control` ([[Remote Control and Revocation]]), and `revoke_by_stamped_headers` does the same by stamp ([[Stamping]]). Deleting an `AsyncResult` object removes it from the backend's pending set.

Sources: [celery/result.py:131-190](repo://celery/result.py#L131-L190), [celery/result.py:451-454](repo://celery/result.py#L451-L454)

## ResultSet and GroupResult

`ResultSet(results)` groups results without an id of its own, and `GroupResult(id, results, parent=None)` adds the group id that `group.apply_async` returns. Both expose aggregate checks: `ready()`, `successful()`, `failed()`, `waiting()`, `completed_count()`, and `forget()`, plus `revoke()`, which sends a single revoke for every id.

Sources: [celery/result.py:579-690](repo://celery/result.py#L579-L690), [celery/result.py:929-950](repo://celery/result.py#L929-L950)

`get()` on a set delegates to `join_native` when the backend supports native joins (the docstring lists the amqp, Redis and cache backends) and to `join` otherwise. `join` calls `get()` on each member in order, shrinking the remaining timeout and raising `TimeoutError('join operation timed out')` when it runs out; its docstring warns this "can be an expensive operation for result store backends that must resort to polling". `join_native` uses the backend's `iter_native` to fetch many results per round trip and places each value at its original index. With a `callback`, values are passed to it as they arrive and are not collected.

Sources: [celery/result.py:726-785](repo://celery/result.py#L726-L785), [celery/result.py:785-835](repo://celery/result.py#L785-L835)

A `GroupResult` can be persisted with `save()` and loaded with `GroupResult.restore(id)`, through the backend's `save_group` and `restore_group`; `delete()` removes it. Chords use this to rebuild the header on whichever worker finishes last ([[Groups and Chords]]).

Sources: [celery/result.py:939-990](repo://celery/result.py#L939-L990)

## EagerResult

`apply()` and eager mode return `EagerResult(id, ret_value, state, traceback=None, name=None)`. It is always ready and keeps its value in memory: `get()` returns the value, or raises the stored exception for `FAILURE` and `REVOKED` when `propagate` is true (wrapping a non-exception value in `Exception`). It still honours the deadlock guard. `forget()` does nothing and `revoke()` only sets its state to `REVOKED`.

Sources: [celery/result.py:1025-1109](repo://celery/result.py#L1025-L1109)
