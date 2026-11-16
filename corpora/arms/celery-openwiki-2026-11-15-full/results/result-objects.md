---
type: concept
title: Result Objects
description: The client-side result API in celery.result — AsyncResult, ResultSet, GroupResult and EagerResult — covering get/join semantics, the synchronous-subtask deadlock guard, parent error propagation, result trees and caching, forget/revoke, and task state precedence in celery.states.
tags: [results, asyncresult, groupresult, states, deadlock]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T09:27:53.075Z
sources:
  - id: openwiki-source-98fa58283cefff1b0e071bbe
    resource: repo://celery/backends/base.py
  - id: openwiki-source-09faa18a62432ea5464530cc
    resource: repo://celery/concurrency/prefork.py
  - id: openwiki-source-33fca59793af7cfa460b223c
    resource: repo://celery/result.py
  - id: openwiki-source-30739e9c6aac84ef121d58dc
    resource: repo://celery/states.py
  - id: openwiki-source-cd5b25b412e425989370ceb9
    resource: repo://celery/worker/components.py
generated: { by: "claude-code", at: "2026-11-15T09:27:53.075Z" }
---

# Result Objects

`celery/result.py` defines the objects returned by `apply_async`, `delay`, and canvas operations. They are thin handles around a task id (or group id) plus a reference to the app's [result backend](result-backends.md); they never contain the result until it is fetched.

## AsyncResult

`AsyncResult(id, backend=None, task_name=None, app=None, parent=None)`:

- **State**: `state`/`status` reads `backend.get_task_meta(id)['status']`. Unknown ids — and ids whose results expired or were forgotten — report `PENDING`. `exists()` (backed by `backend.task_result_exists`) distinguishes "really pending" from "never stored".
- `ready()` (state in `READY_STATES`), `successful()`, `failed()`.
- `result` / `info`, `traceback`, and with `result_extended`: `name`, `args`, `kwargs`, `worker`, `retries`, `queue`, `date_done`.
- **Caching**: once a ready state is seen, meta is cached on the instance (`_cache`), children tuples are rebuilt into result objects, and `on_ready` is fulfilled (results are `vine` thenables: `result.then(callback)`).
- `parent` links results in a chain; `children` lists subtasks recorded by the backend (the "trail").

### `get()`

`get(timeout=None, propagate=True, interval=0.5, no_ack=True, follow_parents=True, callback=None, on_message=None, on_interval=None, disable_sync_subtasks=True)`:

1. Returns `None` immediately if the result was created with `ignore_result` (`result.ignored`).
2. **Deadlock guard**: with `disable_sync_subtasks=True` (default) it calls `assert_will_not_block()`, which raises `RuntimeError("Never call result.get() within a task!")` when `task_join_will_block()` is true. The worker sets that flag in prefork pool children (`celery/concurrency/prefork.py`) and from the pool's `task_join_will_block` attribute (`celery/worker/components.py`). Use `allow_join_result()` to deliberately opt out, or better, restructure with canvas primitives.
3. With `follow_parents` and `propagate`, re-raises exceptions from parent results in the chain first.
4. Returns the cached value if ready; otherwise registers the result with the backend (`add_pending_result`) and calls `backend.wait_for_pending()` — polling for synchronous backends (every `interval` seconds), or draining push messages for async backends (Redis, RPC).
5. On failure, re-raises the reconstructed remote exception (`maybe_throw`) unless `propagate=False`, in which case the exception instance is returned. `timeout` raises `celery.exceptions.TimeoutError` — it doesn't affect the running task.

`wait` is a deprecated alias.

### Tree traversal

- `collect(intermediate=False)` walks the result graph (`iterdeps`) yielding `(result, value)` for every node, following results returned by tasks (requires `Task.trail`, default on).
- `get_leaf()`, `build_graph()` / `graph` help inspect complex canvases.

### Releasing and cancelling

- `forget()` removes the result from the backend (and the parent's), and cancels pending subscriptions (`remove_pending_result`). Async backends keep resources until `get()` or `forget()` is called — hence the docs' advice to always do one of them.
- `revoke(terminate=False, signal=None, wait=False, timeout=None)` broadcasts a `revoke` control command; `revoke_by_stamped_headers(headers, ...)` revokes by stamp values. See [Remote Control and Inspection](../worker/remote-control.md).
- `__del__` removes the instance from the backend's pending set.

## ResultSet and GroupResult

- `ResultSet(results)` is an ordered collection with `add/remove/discard/update/clear`, `ready()`, `successful()`, `failed()`, `waiting()`, `completed_count()` (number of **successful** tasks), `forget()` and `revoke()` (one broadcast for all ids).
- `get()` delegates to `join_native()` when the backend `supports_native_join` (Redis, RPC: results gathered in bulk via `iter_native`/`get_many`), otherwise to `join()`, which calls `get()` on each member in order with the remaining `timeout` budget and raises `TimeoutError('join operation timed out')` when it is exhausted. With a `callback`, values are passed to `callback(task_id, value)` instead of being returned.
- Both join flavours honour the deadlock guard.

`GroupResult(id, results, parent=None)` is a `ResultSet` with a group id:

- `save()` / `GroupResult.restore(id)` / `delete()` persist the membership through `backend.save_group` / `restore_group` (not supported by RPC). Chord machinery uses this to find header results.
- `as_tuple()` serializes `((id, parent_tuple), [member tuples])`; `result_from_tuple()` rebuilds results from these tuples (used for `children`).
- `group.apply_async()` returns a `GroupResult` whose readiness is driven by a `vine.barrier` over its members.

## EagerResult

Returned by `Task.apply()` and eager execution (`task_always_eager`). It already holds the return value, state and traceback; `get()` returns or raises immediately (still applying the deadlock guard unless `disable_sync_subtasks=False`), `ready()` is always true, and `forget()`/`revoke()` are no-ops. It is not stored in the backend unless `task_store_eager_result` is enabled.

## Task states (`celery/states.py`)

| Set | Members |
| --- | --- |
| `READY_STATES` | `SUCCESS`, `FAILURE`, `REVOKED` |
| `UNREADY_STATES` | `PENDING`, `RECEIVED`, `STARTED`, `REJECTED`, `RETRY` |
| `EXCEPTION_STATES` | `RETRY`, `FAILURE`, `REVOKED` |
| `PROPAGATE_STATES` | `FAILURE`, `REVOKED` |

`state` is a `str` subclass ordered by **precedence** (`PRECEDENCE` list, lower index = higher precedence): `SUCCESS`, `FAILURE`, then custom/unknown states, then `REVOKED`, `STARTED`, `RECEIVED`, `REJECTED`, `RETRY`, `PENDING`. Custom states (e.g. `PROGRESS` via `update_state`) therefore compare above `STARTED` but below `SUCCESS`/`FAILURE`. The events `State` uses precedence to avoid regressing a task's state when events arrive out of order ([Events and Monitoring](../events/monitoring-events.md)).

`IGNORED` is an internal tracer state (raised by `Ignore`/`Task.replace`) that is never stored.

## Related tests

`t/unit/tasks/test_result.py`, `t/unit/tasks/test_states.py`, `t/unit/backends/test_asynchronous.py`, `t/integration/test_tasks.py`.
