---
type: subsystem
title: Result Backends
description: How Celery stores task states and results — backend selection by URL/alias, the Backend base class (encoding, caching, retries, mark_as_* hooks), key/value stores, synchronous vs asynchronous result consumption, chord join strategies (counter, Redis sorted set, chord_unlock), expiry, and notes on the Redis, RPC and database backends.
tags: [results, backends, redis, rpc, database, chord]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T09:27:53.075Z
sources:
  - id: openwiki-source-c4ebf7fa0abfe9f2d1eabf61
    resource: repo://celery/app/backends.py
  - id: openwiki-source-ac404435efa758dad4bbfc83
    resource: repo://celery/app/defaults.py
  - id: openwiki-source-98fa58283cefff1b0e071bbe
    resource: repo://celery/backends/base.py
  - id: openwiki-source-780ad51e7477aa5e5ddbf3df
    resource: repo://celery/backends/database/__init__.py
  - id: openwiki-source-2159b37992e69ba636c3ca3f
    resource: repo://celery/backends/database/models.py
  - id: openwiki-source-6b95f00dc919dfdb3eec1511
    resource: repo://celery/backends/redis.py
  - id: openwiki-source-a4d1ab266bef232afaa055d8
    resource: repo://celery/backends/rpc.py
generated: { by: "claude-code", at: "2026-11-15T09:27:53.075Z" }
---

# Result Backends

A result backend persists task **state** (`PENDING`, `STARTED`, `SUCCESS`, `FAILURE`, `RETRY`, `REVOKED`, custom states) and **results** so that `AsyncResult` objects can query them, and coordinates chords. Code lives in `celery/backends/`; selection is in `celery/app/backends.py`. The app holds the instance (`app.backend`) — see [Application Object and Configuration](../app/application-and-configuration.md#backend-instance-and-thread-safety) for per-thread caching.

## Selecting a backend

`result_backend` (or `Celery(backend=...)`, `--result-backend`, `CELERY_RESULT_BACKEND`) is resolved by `by_url()`:

- `scheme://...` uses the scheme as the alias; `scheme+inner://...` (e.g. `db+postgresql://`) uses the part before `+` as the alias and passes the remainder as the URL.
- `by_name()` looks up `BACKEND_ALIASES` (`rpc`, `redis`/`rediss`, `sentinel`, `cache`, `mongodb`, `db`/`database`, `elasticsearch`, `cassandra`, `couchbase`, `couchdb`, `cosmosdbsql`, `file`, `consul`, `dynamodb`, `azureblockblob`, `arangodb`, `s3`, `gs`, `disabled`, ...), merged with the loader's `override_backends` and the `celery.result_backends` entry-point namespace, or a full `module:Class` path. Unknown names or modules raise `ImproperlyConfigured`. (The table still contains a `riak` alias although no `celery/backends/riak.py` exists in this tree.)
- No backend configured → `DisabledBackend`: storing is a no-op, any read raises `NotImplementedError`, and chords are refused.

## The `Backend` base class (`celery/backends/base.py`)

### Writing state

The worker's tracer calls:

- `mark_as_started` (only with `track_started`), `mark_as_done`, `mark_as_failure`, `mark_as_retry`, `mark_as_revoked`.
- `mark_as_done` skips storing when the request has `ignore_result`, and always calls `on_chord_part_return` for chord members.
- `mark_as_failure` additionally propagates the failure through the remaining `request.chain` and calls errbacks (details in [Canvas](../canvas/signatures-and-workflows.md#failure-propagation)).

`store_result()` encodes the value (exceptions via `prepare_exception`; on read, `exception_to_python` rebuilds them from `exc_module`/`exc_type`/`exc_message` only from already-imported modules and refuses types that are not real exception classes, preventing stored-result code execution), builds meta via `_get_result_meta` (`status`, `result`, `traceback`, `children`, `date_done` for ready states, `group_id`, and — with `result_extended` — `name`, `args`, `kwargs`, `worker`, `retries`, `queue`, stamps), and calls the backend-specific `_store_result`.

### Reading state

`get_task_meta(task_id)` returns a cached value if present (cache is an `LRUCache` of `result_cache_max` entries, disabled with `-1`; **only `SUCCESS` results are cached**), otherwise calls `_get_task_meta_for`. It warns when results are read under `task_always_eager` without `task_store_eager_result`. Decoding uses `result_accept_content` (falling back to `accept_content`).

### Retrying backend operations

With `result_backend_always_retry`, store/get/forget/group operations go through `_ensure_retryable`: errors the backend deems safe (`exception_safe_to_retry`, default none) are retried with exponential backoff (`result_backend_base_sleep_between_retries_ms`, `..._max_sleep_between_retries_ms`) up to `result_backend_max_retries`, calling `on_backend_retryable_error` before each retry. On exhaustion, `BackendStoreError` / `BackendGetMetaError` is raised.

### Hooks used elsewhere

| Hook | Called by | Purpose |
| --- | --- | --- |
| `on_task_call(producer, task_id)` | `send_task` | Prepare to receive a result (RPC declares the reply queue; Redis subscribes) |
| `apply_chord`, `set_chord_size`, `on_chord_part_return`, `add_to_chord` | canvas / tracer | Chord coordination |
| `ensure_chords_allowed` | chain/chord preparation | Raise if chords unsupported |
| `process_cleanup` | tracer after each task | Per-task cleanup |
| `cleanup` | `celery.backend_cleanup` task | Delete expired results |
| `save_group` / `restore_group` / `delete_group` | `GroupResult.save()/restore()` | Persist group membership |

### Expiry

`result_expires` (default one day) sets `self.expires`. Backends with `supports_autoexpire = True` (Redis, RPC and others using native TTLs) expire results themselves; otherwise beat installs the daily `celery.backend_cleanup` task that calls `backend.cleanup()` (see [Beat](../beat/periodic-tasks.md)).

## Synchronous vs asynchronous consumption

- `SyncBackendMixin` (used by `BaseBackend` and `KeyValueStoreBackend`) implements `wait_for` by **polling** `get_task_meta` every `interval` seconds, and `iter_native` via `get_many`.
- `AsyncBackendMixin` (`celery/backends/asynchronous.py`, used by Redis and RPC) registers pending results and drains a `ResultConsumer` that receives push notifications. A `Drainer` matched to the concurrency model (plain, `eventletDrainer`, `geventDrainer` running in a greenlet) pumps events until the promise is fulfilled.

See [Result Objects](result-objects.md) for how `AsyncResult.get()` uses these.

## Key/value stores

`BaseKeyValueStoreBackend` maps results onto `get/mget/set/delete/incr/expire`:

- Keys: `celery-task-meta-<id>`, `celery-taskset-meta-<group_id>`, `chord-unlock-<group_id>`, optionally prefixed by `result_backend_transport_options['global_keyprefix']`.
- `_store_result` reads the current meta first and **does not overwrite a stored `SUCCESS`**, guarding against duplicate/late executions overwriting a successful result.
- If the store `implements_incr`, chords use a **counter**: `apply_chord` saves the header `GroupResult`, and each part's `on_chord_part_return` increments `chord-unlock-<gid>`. When the count reaches the chord size (from `chord_size` in the request or the number of group members), it joins the results (`result_chord_join_timeout`) and sends the body; join or callback failures fail the body with a `ChordError` via `chord_error_from_stack`. If the body is a group, every member is revoked and marked failed so it doesn't hang.
- Without `incr`, `apply_chord` falls back to the `celery.chord_unlock` polling task.

## Redis (`celery/backends/redis.py`)

- `RedisBackend(BaseKeyValueStoreBackend, AsyncBackendMixin)` with `supports_native_join` and `supports_autoexpire`; `SentinelBackend` for `sentinel://` URLs (with optional TLS).
- `set()` stores with `SETEX` (when expiring) **and `PUBLISH`es** the value on the key's channel in one pipeline; values over the size limit raise `BackendStoreError`. The `ResultConsumer` subscribes to `celery-task-meta-<id>` channels so `get()` is push-based. `on_task_call` subscribes eagerly unless running inside a worker task (`task_join_will_block`).
- Chords use their own structure: each part's encoded result is added to a sorted set `<group>.j` scored by `group_index` (or a list when `result_chord_ordered` is false in `result_backend_transport_options`), alongside `<group>.t` (extra tasks added by `add_to_chord`) and `<group>.s` (chord size). When the ready count equals size + additions, results are read in order, any `PROPAGATE_STATES` member raises `ChordError`, the body is sent, and the keys are deleted.
- Connection errors are retried with `retry_over_time` using the backend retry policy; `redis_max_connections` and other `redis_*` settings tune the client.

## RPC (`celery/backends/rpc.py`)

- Sends each result as an AMQP **message** to the client's `reply_to` queue (one queue per client process/thread, `app.thread_oid`) with `correlation_id` = task id. Persistent only if `result_persistent`.
- Results can be read **only by the client that sent the task**, only once, and are not stored anywhere else.
- Does not support chords (`ensure_chords_allowed` raises) or group save/restore.
- `get_task_meta` drains the reply queue up to a backlog limit (`BacklogLimitExceeded`), caching out-of-order results for other task ids.

## Database (`celery/backends/database/`)

- SQLAlchemy models `celery_taskmeta` (`task_id`, `status`, `result`, `date_done`, `traceback`, plus `name`, `args`, `kwargs`, `worker`, `retries`, `queue` with `result_extended`) and `celery_tasksetmeta` for groups; table names/schemas configurable.
- Each store is an upsert inside a session; `subpolling_interval = 0.5` throttles `ResultSet` polling.
- Retries `RETRYABLE_DB_ERRORS` (and invalidates the session/engine before retrying) when `result_backend_always_retry` is set.
- `cleanup()` deletes rows with `date_done` older than `expires` — run via the beat cleanup task.

## Other backends

Most others subclass `KeyValueStoreBackend` (cache/memcached, Couchbase, CouchDB, Consul, DynamoDB, Elasticsearch, Azure Block Blob, S3, GCS, ArangoDB, Cosmos DB SQL, filesystem). MongoDB and Cassandra subclass `BaseBackend` directly. Each lives in its own module under `celery/backends/` with tests in `t/unit/backends/test_<name>.py`.

## Related tests

`t/unit/backends/test_base.py` (mark_as_failure chain propagation, chord counters), `test_redis.py`, `test_rpc.py`, `test_database.py`, `test_asynchronous.py`; `t/integration/test_backend.py`, `t/integration/test_database_backend.py`.
