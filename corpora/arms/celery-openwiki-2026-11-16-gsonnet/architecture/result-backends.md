---
type: architecture
title: Result Backends and AsyncResult
description: How Celery stores and retrieves task state and results — backend selection by URL, the Backend/KeyValueStore base classes, result metadata and exception serialization (including its security guard), retries, how AsyncResult/GroupResult wait (polling vs pub/sub drainers), chord counting hooks and the main concrete backends (Redis, RPC, database).
tags: [celery, result-backend, asyncresult, redis, rpc, database, states, exceptions]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:22:47.483Z
sources:
  - id: openwiki-source-c4ebf7fa0abfe9f2d1eabf61
    resource: repo://celery/app/backends.py
  - id: openwiki-source-07e60038fdde80ea7d71678a
    resource: repo://celery/backends/asynchronous.py
  - id: openwiki-source-98fa58283cefff1b0e071bbe
    resource: repo://celery/backends/base.py
  - id: openwiki-source-780ad51e7477aa5e5ddbf3df
    resource: repo://celery/backends/database/__init__.py
  - id: openwiki-source-6b95f00dc919dfdb3eec1511
    resource: repo://celery/backends/redis.py
  - id: openwiki-source-a4d1ab266bef232afaa055d8
    resource: repo://celery/backends/rpc.py
  - id: openwiki-source-2a32c4e613bc7be1d621d647
    resource: repo://celery/beat.py
  - id: openwiki-source-33fca59793af7cfa460b223c
    resource: repo://celery/result.py
  - id: openwiki-source-30739e9c6aac84ef121d58dc
    resource: repo://celery/states.py
generated: { by: "claude-code", at: "2026-11-16T09:22:47.483Z" }
---

# Result Backends and AsyncResult

A **result backend** persists the state and return value of tasks so that clients (via `AsyncResult`) and the workflow machinery (chords) can read them later. Backends live in `celery/backends/`; client-facing result objects are in `celery/result.py`; state names are in `celery/states.py`. The worker writes results from the tracer (see [[/openwiki/workflows/task-lifecycle.md]]); chords depend on backend hooks (see [[/openwiki/architecture/canvas-workflows.md]]).

## Selecting a backend

`celery/app/backends.py` resolves `result_backend` (or `backend=`) to a class. `by_url` splits a URL like `redis://host/0` or `db+postgresql://...` into the scheme (or the part before `+`) and the remaining URL, and `by_name` maps it through `BACKEND_ALIASES` — `rpc`, `cache`, `redis`/`rediss`/`sentinel`, `mongodb`, `db`/`database`, `elasticsearch`, `cassandra`, `couchbase`, `couchdb`, `cosmosdbsql`, `file`, `consul`, `dynamodb`, `azureblockblob`, `arangodb`, `s3`, `gs`, `disabled` — merged with the loader's `override_backends` and any entry points in the `celery.result_backends` namespace. Unknown names raise `ImproperlyConfigured`. With nothing configured the backend is `disabled` (`DisabledBackend`), whose operations raise `NotImplementedError` with an explanatory message — so `AsyncResult.get()` and chords require a configured backend. The app exposes it lazily as `app.backend`, and a task can use its own backend via the task `backend` attribute.

## The `Backend` base class

`Backend` (`celery/backends/base.py#L108`) defines the interface and shared behavior:

- **Capability flags**: `supports_native_join` (can fetch many results at once), `supports_autoexpire` (the store expires results itself, so the daily `celery.backend_cleanup` beat entry is not installed — see [[/openwiki/architecture/beat-scheduler.md]]), `persistent`, and `retry_policy`.
- **Configuration**: serializer from `result_serializer`, an LRU result cache (`result_cache_max`, `-1` disables), `result_expires`, and the accepted content types (precedence: explicit `accept`, `result_accept_content`, then `accept_content`).
- **State writers**: `mark_as_started`, `mark_as_done` (also triggers `on_chord_part_return` for chord members and honors `ignore_result`), `mark_as_failure`, `mark_as_retry`, `mark_as_revoked`. The failure path walks chains and chord bodies as described in the canvas page.
- **Stored metadata** (`_get_result_meta`): `status`, `result`, `traceback`, `children`, `date_done` (only for ready states), plus `group_id`/`parent_id` when present. With `result_extended` it also records `name`, `args`, `kwargs`, `worker`, `retries`, `queue` and any stamps.
- **Retries**: when `result_backend_always_retry` is on, `_ensure_retryable` wraps `store_result`/`forget` and retries recoverable errors (as decided by `exception_safe_to_retry`) with exponential backoff up to `result_backend_max_retries`; when exhausted a `BackendStoreError` is raised.

### Exception serialization and its security guard

Failures are stored through `prepare_exception`: with the pickle codec the exception object is made pickleable; otherwise it is stored as a dict `{exc_type, exc_message, exc_module}`. `exception_to_python` rebuilds it by importing `exc_module` and looking up the (possibly dotted) `exc_type`; if the class cannot be found a stand-in class is created. Crucially, it **verifies that the resolved object is an exception class** and raises `SecurityError` otherwise. Without this check, an attacker able to write to the result store could set `exc_module="os", exc_type="system"` and have the client call it with attacker-controlled arguments (`celery/backends/base.py#L457-L530`). Treat the result backend as part of the trust boundary regardless; see [[/openwiki/architecture/security.md]].

### Key-value backends

`BaseKeyValueStoreBackend` (`#L964`) implements the Backend API on top of `get`/`mget`/`set`/`delete`/`incr`/`expire`. Keys are namespaced with prefixes `celery-task-meta-`, `celery-taskset-meta-` (groups) and `chord-unlock-`, optionally prefixed by `result_backend_transport_options['global_keyprefix']`. `_store_result` has an important idempotency rule: **a stored `SUCCESS` is never overwritten** by a later update, which prevents a lost or duplicated task delivery from clobbering a good result (`#L1115-L1135`). Group results are saved and restored under group keys. Backends that set `implements_incr` (cache, GCS, DynamoDB) get the generic counter-based chord implementation `_apply_chord_incr`/`on_chord_part_return`; others override chord handling.

## Waiting for results

`AsyncResult` (`celery/result.py#L70`) is a handle `(id, backend, parent)`. `get(timeout, propagate, interval, follow_parents, disable_sync_subtasks, ...)`:

1. Returns immediately for `ignore_result` tasks.
2. Calls `assert_will_not_block()` unless `disable_sync_subtasks=False`: waiting for a result *inside a task* is rejected, because it can deadlock a worker pool (`allow_join_result()` is the explicit escape hatch used internally by chords).
3. With `follow_parents`, re-raises a parent's failure while waiting (so a failed chain step surfaces on the last result).
4. Returns from `_cache` if the meta is already ready; otherwise registers itself with `backend.add_pending_result` and calls `backend.wait_for_pending`.
5. On a failure state, `maybe_throw` re-raises the stored exception when `propagate=True`.

`_maybe_set_cache` only caches *ready* states and turns stored `children` tuples into result objects. State precedence and groupings are in `celery/states.py`: `READY_STATES = {SUCCESS, FAILURE, REVOKED}`, `UNREADY_STATES = {PENDING, RECEIVED, STARTED, REJECTED, RETRY}`, `EXCEPTION_STATES = {RETRY, FAILURE, REVOKED}`, `PROPAGATE_STATES = {FAILURE, REVOKED}`.

`ResultSet` / `GroupResult` (`#L579`, `#L929`) aggregate results: `join` (ordered list, polling), `join_native` when `supports_native_join`, `iterate`, `ready`, `successful`, `revoke`, and persistence of the group (`save`/`restore`) used by chords. `EagerResult` is returned under `task_always_eager`.

### Polling vs. push backends

- **Polling** (database, filesystem, cache-style KV without pub/sub): `wait_for_pending` repeatedly calls `get_task_meta` every `interval` seconds.
- **Async/push** backends mix in `AsyncBackendMixin` (`celery/backends/asynchronous.py`). A `ResultConsumer` subscribes to per-task channels/queues, a **drainer** runs `drain_events` until the awaited promise is fulfilled, and results that arrive for tasks nobody waits on yet are buffered in `_pending_messages` (bounded by `MESSAGE_BUFFER_MAX = 8192`) so they are not lost. Drainers are registered by name (`default`, plus greenlet-based `eventlet` and `gevent` variants chosen to match the active green library). Connection loss triggers `reconnect_on_error`, bounded by retry limits; hitting the limit or a shutdown signal raises the "Celery must be restarted" errors.

## Concrete backends

### Redis (`celery/backends/redis.py`)

Stores each result at `celery-task-meta-<id>` with `SET`/`SETEX` (expiry from `result_expires`) and **also publishes** it, so `ResultConsumer` can `SUBSCRIBE` to the key and wake waiting clients without polling. It sets `supports_autoexpire` and `supports_native_join`. Chord handling is Redis-specific: `on_chord_part_return` pipelines a `ZADD` (or `RPUSH` when `result_chord_ordered` is false) of the encoded `[1, task_id, state, result]` onto a `.j` key, reads the saved chord size (`.s`, written via `set_chord_size`) and compares the ready count to it; when equal it collects results (or joins a saved complex `GroupResult`), calls `callback.delay(results)` and deletes the three keys in a `finally`. Errors become `ChordError` routed to `chord_error_from_stack`. `apply_chord` saves the header `GroupResult` only when it contains nested group results, as an optimization. `SentinelBackend` adds Sentinel-based discovery. The pub/sub consumer cleans up buffered READY messages to avoid leaks.

### RPC (`celery/backends/rpc.py`)

Not a store: results are sent as **messages back to the caller's reply queue** (`reply_to`/`correlation_id`), using the anonymous exchange. It is non-persistent, supports autoexpire and native join, requires the result to be consumed by the same client that started the task, and **does not support chords** (`ensure_chords_allowed` raises). It is fast for simple request/response use, and the consumer reconnects after connection errors.

### Database (`celery/backends/database/`)

SQLAlchemy-backed (`db+<dialect>://`). `_store_result` inserts or updates a task row inside a session that is cleaned up (and committed) per operation; `_get_task_meta_for` returns a `PENDING` placeholder for unknown ids and decodes stored `args`/`kwargs` for extended results. Group results use a separate table, and `cleanup()` deletes expired rows (driven by the beat `backend_cleanup` task since the database does not autoexpire). Retries on transient errors are controlled by the same `always_retry` policy through `exception_safe_to_retry`.

### Others

`cache`, `filesystem`, `mongodb`, `dynamodb`, `s3`, `gcs`, `cassandra`, `elasticsearch`, `couchdb`/`couchbase`, `cosmosdbsql`, `azureblockblob`, `arangodb`, `consul` each subclass the key-value or base class and map `get/set/delete` onto the service. Third parties can add more via the `celery.result_backends` entry-point group.

## Operational consequences

- Always consume or `forget()` results of tasks whose results you store, or set `result_expires`; otherwise results accumulate.
- Use `ignore_result=True` for fire-and-forget tasks to skip the write (and the chord hook for members still runs only when the request is part of a chord).
- Backend outages surface in the worker during `store_result`; enabling `result_backend_always_retry` trades task completion latency for resilience.
