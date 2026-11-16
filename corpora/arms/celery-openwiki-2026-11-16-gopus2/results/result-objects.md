---
type: subsystem
title: Result Objects
description: The client-side result API in celery/result.py — AsyncResult, ResultSet, GroupResult and EagerResult — covering get()/join semantics, caching, parent chains and failure propagation, the guard against calling get() inside tasks, serialization as tuples, and how asynchronous backends deliver results through result consumers and drainers.
tags: [results, asyncresult, groupresult, join, deadlock, result-consumer]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:05:29.073Z
sources:
  - id: openwiki-source-07e60038fdde80ea7d71678a
    resource: repo://celery/backends/asynchronous.py
  - id: openwiki-source-799e2e026f2aa536a3206b1f
    resource: repo://celery/concurrency/base.py
  - id: openwiki-source-a77ffa26d752c146df8b33c1
    resource: repo://celery/concurrency/eventlet.py
  - id: openwiki-source-6e802d4c51b7e3a934027fff
    resource: repo://celery/concurrency/gevent.py
  - id: openwiki-source-09faa18a62432ea5464530cc
    resource: repo://celery/concurrency/prefork.py
  - id: openwiki-source-33fca59793af7cfa460b223c
    resource: repo://celery/result.py
  - id: openwiki-source-cd5b25b412e425989370ceb9
    resource: repo://celery/worker/components.py
generated: { by: "claude-code", at: "2026-11-16T17:05:29.073Z" }
---

# Result Objects

`celery/result.py` defines the promises returned when tasks are published. They hold an id and a reference to a [result backend](backends.md); all state is fetched lazily from that backend.

| Class | Returned by | Represents |
|-------|-------------|-----------|
| `AsyncResult` | `apply_async`, `delay`, `send_task`, `chain` | One task (optionally with `parent` linking to previous chain steps) |
| `ResultSet` | manual construction | An unordered collection of results without its own id |
| `GroupResult` | `group.apply_async`, chord header | A `ResultSet` with a group id that can be saved/restored |
| `EagerResult` | `task.apply()` / `task_always_eager` | An already-computed local result |

`app.AsyncResult` and `app.GroupResult` are app-bound subclasses; `Task.AsyncResult` uses the task's backend.

## `AsyncResult`

Construction requires a non-`None` id; the backend defaults to `app.backend`. Each instance carries an `on_ready` `vine.promise` and an internal `_cache`.

### Reading state

`state`/`status`, `result`/`info`, `traceback`, `children`, `date_done`, and the extended fields (`name`, `args`, `kwargs`, `worker`, `retries`, `queue`, available with `result_extended`) all go through `_get_task_meta()`:

- If nothing is cached, it calls `backend.get_task_meta(id)`.
- Once a **ready** state (`SUCCESS`, `FAILURE`, `REVOKED`) is seen, the decoded meta is cached on the instance, children tuples are turned into result objects, and `on_ready` fires. Non-ready states are never cached, so repeated `state` checks keep hitting the backend.

Predicates: `ready()`, `successful()`, `failed()`; `exists()` checks for stored metadata. Unknown ids simply report `PENDING`.

### `get()`

`get(timeout=None, propagate=True, interval=0.5, no_ack=True, follow_parents=True, callback=None, on_message=None, on_interval=None, disable_sync_subtasks=True)`:

1. If the result is marked `ignored` (task published with `ignore_result`), return `None` immediately without waiting.
2. If `disable_sync_subtasks` (default), call `assert_will_not_block()` — raises `RuntimeError("Never call result.get() within a task!")` when executing inside a worker pool that sets the join-will-block flag (see below).
3. With `follow_parents`, re-raise failures from parent results in a chain (checked up front and on each interval).
4. If already cached, return or raise immediately.
5. Otherwise register with the backend (`add_pending_result`) and block in `backend.wait_for_pending(...)`, which polls (sync backends) or drains pushed messages (async backends) until ready or `timeout` → `celery.exceptions.TimeoutError`.
6. On failure with `propagate=True` the stored exception is re-raised (`maybe_throw`); with `propagate=False` it is returned.

`timeout` only affects the caller; the task keeps running. `wait` is a deprecated alias.

Other operations: `forget()` (delete stored result), `revoke(terminate=..., signal=...)` and `revoke_by_stamped_headers(...)` (broadcast through `app.control`), `then(callback)`, `collect()`/`iterdeps()` (walk the result graph), `get_leaf()`, `build_graph()`.

## Deadlock prevention

Waiting synchronously for another task inside a task can deadlock a worker whose pool slots are all blocked waiting. The flag lives in `celery/_state.py` (`task_join_will_block`):

- `BasePool.task_join_will_block = True`; the worker's Pool bootstep sets the flag from the pool class, and prefork children set it at process init. The eventlet and gevent pools set it to `False` since green threads do not block the pool.
- `allow_join_result()` / `denied_join_result()` context managers temporarily override it. Celery uses `allow_join_result()` internally where joining is safe (e.g. `celery.chord_unlock`, eager chain execution), and `denied_join_result()` around eager `apply_async` so eager code behaves like the worker.
- Callers who really need it can pass `disable_sync_subtasks=False`.

The Redis and RPC backends also consult the flag to skip work that only matters for blocking callers (e.g. subscribing/declaring reply queues in `on_task_call`).

## `ResultSet` and `GroupResult`

- `ResultSet(results)` aggregates results: `ready()`, `successful()`, `failed()`, `waiting()`, `completed_count()`, `revoke()`, `forget()`, iteration and indexing. A `vine.barrier` (`ready_barrier`) fires `on_ready` when all members are done.
- `join()` calls `get()` on each member in order — simple but polls each result in turn.
- `join_native()` / `iter_native()` use the backend's bulk API (`get_many` for KV backends, the result consumer for async backends) and are used automatically when `supports_native_join` is true (as in `get()`). Results are returned in group order unless a `callback` is given.
- With `propagate=True` the first failing member's exception is raised; `_failed_join_report()` finds the culprit for chord error messages.
- `GroupResult` adds `id` and `parent`; `save()`/`GroupResult.restore(id)`/`delete()` persist the member list in the backend (used by chords and by `celery result`).

## `EagerResult`

Wraps a value computed in-process by `Task.apply`. `get()` re-raises the stored exception if the task failed and `propagate=True`; `ready()` is always true; `revoke()` just marks it revoked. Eager results bypass the backend unless `task_store_eager_result` is set.

## Serialization

Results are not sent as objects in task messages; they are converted to nested tuples:

- `AsyncResult.as_tuple()` → `((id, parent_tuple), None)`
- `GroupResult.as_tuple()` → `((id, parent_tuple), [member tuples])`

`result_from_tuple(t, app)` rebuilds `AsyncResult` or `GroupResult` trees (parents included). Backends store children this way in result metadata, and chords pass header results as tuples to `celery.chord_unlock`.

## Async delivery: result consumers and drainers

For backends using `AsyncBackendMixin` (Redis, RPC), see `celery/backends/asynchronous.py`:

- `add_pending_result` starts the **drainer**, first checks a buffer of already-received messages (`_pending_messages`) for an early-arriving result, and otherwise registers the result and asks the `ResultConsumer` to `consume_from(task_id)` (subscribe to the Redis key channel / ensure the reply queue).
- Pending results are tracked in two maps: strong references for results the caller is waiting on and weak references for results waited on implicitly (e.g. inside groups); `AsyncResult.__del__` removes them.
- `wait_for_pending` iterates `drain_events_until(promise, timeout, on_interval)` and then calls `maybe_throw`.
- The drainer implementation is chosen by `detect_environment()`: `default` (blocking drain in the caller), `eventlet` and `gevent` (a background green thread draining events and waking waiters). Connection errors during draining are retried.

## Tests

- `t/unit/tasks/test_result.py` — AsyncResult/ResultSet/GroupResult/EagerResult behaviour, tuple round-trips, `assert_will_not_block`.
- `t/unit/backends/test_asynchronous.py` — drainers under default/eventlet/gevent.
- `t/integration/test_tasks.py`, `test_canvas.py` — real `get()`/`join()` behaviour.

## Related

- [Result Backends](backends.md)
- [Canvas: Signatures, Chains, Groups and Chords](../canvas/workflows.md)
