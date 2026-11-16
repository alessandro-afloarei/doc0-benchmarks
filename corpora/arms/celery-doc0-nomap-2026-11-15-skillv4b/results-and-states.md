---
title: "Task Results and States"
---
## Overview

A task's outcome lives in the result backend, not in the message. The worker writes a small metadata record for each task id (state, result or exception, traceback, children, completion time), and callers read it back through `AsyncResult` objects that know only the id and the backend. This page covers the states a task moves through, the result objects callers hold, and the backend base classes that encode, store and fetch the record. The concrete stores are on [[Result Backends]]; when the worker writes each state is on [[Task Execution and Tracing]].

Sources: [celery/result.py:62-102](repo://celery/result.py#L62-L102), [celery/backends/base.py:581-630](repo://celery/backends/base.py#L581-L630)

## Task states

States are plain strings defined in `celery.states`:

Sources: [celery/states.py:56-60](repo://celery/states.py#L56-L60)

| State | Meaning | Set |
| --- | --- | --- |
| `PENDING` | Unknown to the backend: waiting, or never sent | unready |
| `RECEIVED` | Received by a worker (events only) | unready |
| `STARTED` | Running, stored only with `track_started` | unready |
| `RETRY` | Failed and re-sent for retry | unready, exception |
| `REJECTED` | Rejected by the worker (events only) | unready |
| `SUCCESS` | Returned a value | ready |
| `FAILURE` | Raised an exception or ran out of retries | ready, exception, propagate |
| `REVOKED` | Revoked before or while running | ready, exception, propagate |
| `IGNORED` | The task raised `Ignore`; nothing is stored | — |

Sources: [celery/states.py:126-151](repo://celery/states.py#L126-L151)

`READY_STATES` decides when `get()` stops waiting, `EXCEPTION_STATES` decides when the stored result is decoded as an exception, and `PROPAGATE_STATES` decides when `get()` re-raises it. `PENDING` is the default for any id the backend has no record of, so a mistyped id looks like a task still waiting.

Sources: [celery/states.py:144-151](repo://celery/states.py#L144-L151), [celery/backends/base.py:1148-1153](repo://celery/backends/base.py#L1148-L1153)

States have a precedence order, `SUCCESS`, `FAILURE`, then any custom state, then `REVOKED`, `STARTED`, `RECEIVED`, `REJECTED`, `RETRY`, `PENDING`. The `state` subclass of `str` compares by this order, which lets monitors merge events that arrive out of order without moving a finished task back to an earlier state ([[Events and Monitoring]]).

Sources: [celery/states.py:62-123](repo://celery/states.py#L62-L123)

## AsyncResult

`AsyncResult(id, backend=None, app=None, parent=None)` is what `apply_async` returns. Each property reads the task's metadata through the backend: `state`, `result` (the return value or the exception), `traceback`, `children`, and, with `result_extended`, `name`, `args`, `kwargs`, `worker`, `retries`, `queue` and `date_done`. Once a ready state is seen, the record is cached on the object and no more requests are made.

Sources: [celery/result.py:461-576](repo://celery/result.py#L461-L576)

`ready()`, `successful()` and `failed()` test the state. `forget()` drops the cached record and asks the backend to delete it, for this result and its parents. `revoke(terminate=False, signal=None, wait=False)` sends the `revoke` remote-control command for the id to all workers ([[Remote Control and Inspection]]).

Sources: [celery/result.py:136-165](repo://celery/result.py#L136-L165), [celery/result.py:369-383](repo://celery/result.py#L369-L383)

## Waiting with get()

`get(timeout=None, propagate=True, interval=0.5, follow_parents=True, disable_sync_subtasks=True, callback=None, on_message=None)` blocks until the task is ready:

Sources: [celery/result.py:191-195](repo://celery/result.py#L191-L195)

1. A result created with `ignore_result` returns `None` at once.
2. With `disable_sync_subtasks`, `assert_will_not_block()` raises `RuntimeError("Never call result.get() within a task!")` when called inside a pool worker, because a worker waiting on a task that may be queued behind it can deadlock. The prefork pool and the worker's pool step turn this check on; `allow_join_result()` is the context manager that switches it off.
3. With `follow_parents`, the exceptions of failed parent tasks in a chain are raised first.
4. A cached ready result is returned, or re-raised, at once.
5. Otherwise it registers the result with `backend.add_pending_result` and calls `backend.wait_for_pending`.

Sources: [celery/result.py:37-61](repo://celery/result.py#L37-L61), [celery/result.py:244-270](repo://celery/result.py#L244-L270), [celery/concurrency/prefork.py:41-50](repo://celery/concurrency/prefork.py#L41-L50), [celery/worker/components.py:165-172](repo://celery/worker/components.py#L165-L172)

`maybe_throw` decides the outcome: in a propagate state with `propagate=True` it raises the stored exception, with the remote traceback attached when `task_remote_tracebacks` is on and `tblib` is installed; otherwise it returns the value or exception. A `timeout` that passes raises `celery.exceptions.TimeoutError`; the task keeps running.

Sources: [celery/result.py:385-401](repo://celery/result.py#L385-L401), [celery/backends/base.py:918-944](repo://celery/backends/base.py#L918-L944)

## Polling and push backends

### Polling backends

`SyncBackendMixin.wait_for` loops on `get_task_meta`, sleeping `interval` seconds between reads, until the state is ready or the timeout passes. `BaseBackend` and `KeyValueStoreBackend` include this mixin.

Sources: [celery/backends/base.py:918-961](repo://celery/backends/base.py#L918-L961), [celery/backends/base.py:1259-1260](repo://celery/backends/base.py#L1259-L1260)

### Push backends

`AsyncBackendMixin` is mixed into `RedisBackend` and `RPCBackend`, which receive results as messages. `add_pending_result` records the result in a pending map (or takes it from a buffer if its message already arrived) and asks the backend's `ResultConsumer` to `consume_from(task_id)`. `wait_for_pending` then drains events until the result's `on_ready` promise fires. The consumer's `on_state_change` matches each incoming ready message to its pending result, fills the cache, and buffers messages for ids nobody is waiting on yet. The `interval` argument does not apply here.

Sources: [celery/backends/asynchronous.py:225-313](repo://celery/backends/asynchronous.py#L225-L313), [celery/backends/redis.py:204-204](repo://celery/backends/redis.py#L204-L204), [celery/backends/rpc.py:147-147](repo://celery/backends/rpc.py#L147-L147), [celery/backends/asynchronous.py:397-449](repo://celery/backends/asynchronous.py#L397-L449)

The `Drainer` that pulls events is chosen by environment: a plain loop for threads, or a greenlet that drains in the background under eventlet or gevent. A recoverable `OSError` while draining is logged and retried after one interval. A connection error that `_reconnect` cannot fix raises `RuntimeError`, asking for the application to be restarted.

Sources: [celery/backends/asynchronous.py:58-113](repo://celery/backends/asynchronous.py#L58-L113), [celery/backends/asynchronous.py:198-222](repo://celery/backends/asynchronous.py#L198-L222), [celery/backends/asynchronous.py:338-370](repo://celery/backends/asynchronous.py#L338-L370)

## ResultSet and GroupResult

`ResultSet(results)` is a list of results with set-wide operations: `ready()`, `successful()`, `failed()`, `completed_count()`, `revoke()`, `forget()`, and `get()`/`join()` returning values in order. `get` uses `join_native` when the backend supports native joins (fetching many ids at once, as the key-value stores do) and otherwise calls `get()` on each member in turn, sharing the timeout.

Sources: [celery/result.py:579-698](repo://celery/result.py#L579-L698), [celery/result.py:726-741](repo://celery/result.py#L726-L741), [celery/result.py:790-826](repo://celery/result.py#L790-L826)

`GroupResult` is a `ResultSet` with an id; `group(...).apply_async()` returns one. `save()` stores the member ids in the backend under the group id, and `GroupResult.restore(id)` rebuilds the object later in another process.

Sources: [celery/result.py:929-1022](repo://celery/result.py#L929-L1022)

`EagerResult` holds the outcome of a task run with `apply()` or `task_always_eager`; it never touches a backend.

Sources: [celery/result.py:1025-1110](repo://celery/result.py#L1025-L1110)

## How a result is stored

The tracer calls `mark_as_started`, `mark_as_done`, `mark_as_retry`, `mark_as_failure` and `mark_as_revoked`, which call `store_result`. `mark_as_done` skips storage when the request ignores its result, but still reports a chord member's completion. `mark_as_failure` also stores the failure on every remaining task of the chain carried by the request, so callers waiting on the last task of a failed chain see the error instead of waiting forever, and then calls the request's errbacks.

Sources: [celery/backends/base.py:176-252](repo://celery/backends/base.py#L176-L252)

`store_result` encodes the value with `encode_result`, then calls the backend's `_store_result` through `_ensure_retryable`. With `result_backend_always_retry`, errors the backend declares safe to retry are retried with exponential backoff, between `result_backend_base_sleep_between_retries_ms` and `result_backend_max_sleep_between_retries_ms`, up to `result_backend_max_retries`, after which `BackendStoreError` is raised.

Sources: [celery/backends/base.py:635-693](repo://celery/backends/base.py#L635-L693)

The stored record is built by `_get_result_meta`:

Sources: [celery/backends/base.py:581-591](repo://celery/backends/base.py#L581-L591)

```python
meta = {
    'status': state,
    'result': result,
    'traceback': traceback,
    'children': self.current_task_children(request),
    'date_done': date_done,
}
```

Sources: [celery/backends/base.py:592-598](repo://celery/backends/base.py#L592-L598)

`group_id` and `parent_id` are added when known, and with `result_extended` the record also holds the task name, args, kwargs, worker hostname, retries, queue and stamps.

Sources: [celery/backends/base.py:600-630](repo://celery/backends/base.py#L600-L630)

## Serializing results and exceptions

Results are encoded with `result_serializer` (JSON by default) and decoded only if their content type is in `result_accept_content`, or else `accept_content`. A result that is itself a result object is stored as its id tuple, unless the serializer is pickle.

Sources: [celery/backends/base.py:138-165](repo://celery/backends/base.py#L138-L165), [celery/backends/base.py:528-556](repo://celery/backends/base.py#L528-L556)

Exceptions cannot be JSON-encoded, so `prepare_exception` stores them as `exc_type`, `exc_message` and `exc_module`, except under serializers that can carry exception objects. `exception_to_python` rebuilds the exception by importing the class from its module, and creates a stand-in class when the module is not importable. It refuses with `SecurityError` any type that is not a `BaseException` subclass, because a forged record could otherwise make a client call an arbitrary function such as `os.system`.

Sources: [celery/backends/base.py:447-526](repo://celery/backends/base.py#L447-L526)

## Key-value backends

`BaseKeyValueStoreBackend` implements results on any store with `get`, `set`, `mget` and `delete`. Task records live under `celery-task-meta-<id>` and groups under `celery-taskset-meta-<id>`; a `global_keyprefix` in `result_backend_transport_options` is prepended to both. A store that implements `incr` also gets counter-based chord joins.

Sources: [celery/backends/base.py:964-1044](repo://celery/backends/base.py#L964-L1044)

Before writing, `_store_result` reads the current record and does nothing when it is already `SUCCESS`, so a redelivered or lost task cannot overwrite a successful result with a later state.

Sources: [celery/backends/base.py:1116-1138](repo://celery/backends/base.py#L1116-L1138)

Successful results are kept in an LRU cache of size `result_cache_max`; the default `-1` disables it. `DisabledBackend`, used when no `result_backend` is set, stores nothing and raises `NotImplementedError` on every read, and on chords, which need a backend.

Sources: [celery/backends/base.py:746-768](repo://celery/backends/base.py#L746-L768), [celery/backends/base.py:1263-1281](repo://celery/backends/base.py#L1263-L1281)
