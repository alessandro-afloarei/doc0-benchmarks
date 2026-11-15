---
type: api
title: "Results API: AsyncResult and GroupResult"
description: The client-side handles to task outcomes in celery/result.py. Covers AsyncResult state, get() semantics and parent error propagation, the ban on blocking joins inside tasks, ResultSet/GroupResult joins (join vs join_native), saving and restoring groups, EagerResult, result serialization tuples, and the async result consumer and drainer machinery used by Redis and RPC.
tags: [results, asyncresult, groupresult, join, drainer]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:49.645Z
sources:
  - id: openwiki-source-07e60038fdde80ea7d71678a
    resource: repo://celery/backends/asynchronous.py
  - id: openwiki-source-98fa58283cefff1b0e071bbe
    resource: repo://celery/backends/base.py
  - id: openwiki-source-09faa18a62432ea5464530cc
    resource: repo://celery/concurrency/prefork.py
  - id: openwiki-source-33fca59793af7cfa460b223c
    resource: repo://celery/result.py
  - id: openwiki-source-cd5b25b412e425989370ceb9
    resource: repo://celery/worker/components.py
generated: { by: "claude-code", at: "2026-11-15T17:08:49.645Z" }
---

# Results API: AsyncResult and GroupResult

`celery/result.py` defines the objects returned by `apply_async`, `delay`, and canvas calls. They are thin handles. They hold an ID, a link to the app's backend, and optional parent and children, and they fetch state on demand from the [result backend](backends.md).

## `AsyncResult`

- `AsyncResult(id, backend=None, task_name=None, app=None, parent=None)`. `parent` links chain steps (see [Canvas](../canvas/workflows.md)).
- **State access:** `state`/`status`, `result`/`info`, `traceback`, `ready()`, `successful()`, `failed()`, `children`, `date_done`. With `result_extended`, it also exposes `name`, `args`, `kwargs`, `worker`, `retries`, and `queue`. These read `_get_task_meta()`, which calls `backend.get_task_meta(id)` and **caches the metadata on the instance once the state is ready** (`_maybe_set_cache`), resolving child tuples into result objects. Reading the state of a pending task therefore queries the backend every time. An unknown ID is simply `PENDING`.
- `get(timeout=None, propagate=True, interval=0.5, follow_parents=True, disable_sync_subtasks=True, callback=None, on_message=None, ...)`:
  1. returns `None` immediately if the result was created with `ignore_result` (`result.ignored`);
  2. calls `assert_will_not_block()` unless `disable_sync_subtasks=False`;
  3. with `follow_parents` and `propagate`, re-raises any failure of a parent in the chain first, and checks again on each interval;
  4. returns the cached result if it is already ready;
  5. otherwise registers itself with the backend (`add_pending_result`) and waits with `backend.wait_for_pending(...)`. Polling backends sleep `interval` between checks. Async backends (Redis, RPC) ignore `interval` and wait for pushed messages. On timeout it raises `celery.exceptions.TimeoutError`, but the task keeps running.
  6. With `propagate=True` it re-raises the task's exception (rebuilt by the backend; see [exception safety](backends.md#exceptions-are-reconstructed-safely)). With `propagate=False` it returns the exception instance.
- `forget()` drops the cache and deletes the stored result where supported.
- `revoke(terminate=False, signal=None, wait=False)` and `revoke_by_stamped_headers(...)` go through `app.control` (see [Remote Control](../worker/remote-control.md)).
- `collect()` and `iterdeps()` walk the result graph depth-first and yield `(result, value)` pairs, including children produced by tasks that called other tasks. `build_graph()` returns a `DependencyGraph`.
- `then(callback)` integrates with `vine` promises. `on_ready` is a promise fulfilled when the metadata becomes ready.

## Never block inside a task

Waiting on another task's result inside a worker can deadlock: every pool slot ends up waiting on tasks that can't be scheduled. Celery enforces this rule:

- `celery._state.task_join_will_block()` is a process-global flag. The prefork pool's child initializer and the worker's pool component set it (`_set_task_join_will_block(True)` in `concurrency/prefork.py` and `worker/components.py`).
- `get()`, `join()`, and `join_native()` call `assert_will_not_block()` and raise `RuntimeError("Never call result.get() within a task!")`.
- The `allow_join_result()` context manager lifts the restriction. Celery uses it internally in `chord_unlock`, Redis chord joins, and eager canvas execution. `denied_join_result()` sets it, for example around eager `apply_async`.
- Pass `disable_sync_subtasks=False` to opt out per call. This is discouraged.

## `ResultSet` and `GroupResult`

`ResultSet(results)` is an unordered collection. `GroupResult(id, results, parent=None)` adds a group ID and is what `group.apply_async()` returns.

- `ready()`, `successful()`, `failed()`, `waiting()`, `completed_count()`, `revoke()`, `forget()`, and iteration and indexing all work across members.
- **`get()` chooses the join strategy:**
  - `join_native()` is used if `backend.supports_native_join` (Redis, RPC, cache, GCS). It uses `backend.iter_native`, which waits on all members at once and fills a list by member order. Batched `get_many`/`mget` is used for key-value stores. Nested group results inside members are expanded.
  - `join()` otherwise. This sequential loop calls `member.get()` with the remaining timeout, so the overall `timeout` is spread across all members. It raises `TimeoutError('join operation timed out')`.
  - Both return values in the original order, or call `callback(task_id, value)` instead of collecting.
- `GroupResult.save()` and `GroupResult.restore(id)` persist and reload the member list through `backend.save_group` and `restore_group`. They are needed to rebuild group results in another process and are used internally by counter-based chord joins. `delete()` removes the saved group.
- `as_tuple()` and `result_from_tuple()` give a compact nested-tuple form `((id, parent), children_or_None)`. It is used for `children` in metadata and for chord headers, and `result_from_tuple` rebuilds `AsyncResult` or `GroupResult` objects from it.
- A `vine.barrier` (`ready_barrier`) fires `on_ready` when all members are ready, which supports `then()` on groups.

## `EagerResult`

When tasks run eagerly (`Task.apply()` or `task_always_eager`), the result is an `EagerResult` that holds the value and state in memory:

- `ready()` is always true.
- `get()` returns the value, or re-raises for propagating states when `propagate=True`. It still enforces the join check.
- `forget()` and `revoke()` do nothing.

When `task_always_eager` is on, backend lookups emit a `RuntimeWarning` (`_ensure_not_eager`) unless `task_store_eager_result` is set, because eager results are not stored in the backend by default.

## Async result consumers (`backends/asynchronous.py`)

Redis and RPC implement `AsyncBackendMixin` plus a backend-specific `ResultConsumer`:

- `add_pending_result(result)` starts the drainer. If the message already arrived and was buffered in `_pending_messages`, it resolves the result immediately. Otherwise it records the result in `_pending_results` (strong or weak references) and calls `consume_from(task_id)`, which subscribes to a Redis channel or binds the RPC reply queue.
- `on_state_change(meta)` runs for every incoming state message. Ready states fill the matching result's cache and its bucket. Results that arrive before anyone waits for them are buffered (`BufferMap`), which handles the race between publishing a task and starting to wait.
- **Drainers** pump `drain_events`. The type is chosen by `detect_environment()`:
  - `Drainer` (`default`): drains in the caller's thread until the promise is ready or the timeout passes. Recoverable `OSError`s are logged and retried after one interval.
  - `eventletDrainer` / `geventDrainer`: a background greenlet drains continuously, and waiters block on a per-iteration event. This lets many greenlets wait on results concurrently over one connection.
- `iter_native` for groups uses buckets, so results are yielded as they arrive, regardless of order.
- After a fork, consumers clear their pending state, and the Redis consumer re-subscribes.

## Tests

- `t/unit/tasks/test_result.py`: AsyncResult, ResultSet, GroupResult, EagerResult, tuples, join timeouts.
- `t/unit/backends/test_asynchronous.py`: drainers under the default, eventlet, and gevent environments.

## See also

- [Result Backends](backends.md)
- [Canvas](../canvas/workflows.md)
