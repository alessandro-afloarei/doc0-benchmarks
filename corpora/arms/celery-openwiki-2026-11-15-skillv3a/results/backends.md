---
type: subsystem
title: Result Backends
description: How Celery stores task state and return values. Covers backend selection from result_backend URLs and aliases, the Backend / BaseKeyValueStoreBackend class hierarchy, metadata encoding and safe exception reconstruction, retry policy, caching, expiry and cleanup, chain/chord failure propagation, and the behaviour of the main concrete backends (Redis, RPC, SQLAlchemy database, MongoDB, cache, cloud stores).
tags: [results, backends, redis, rpc, database, storage]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:49.645Z
sources:
  - id: openwiki-source-c4ebf7fa0abfe9f2d1eabf61
    resource: repo://celery/app/backends.py
  - id: openwiki-source-98fa58283cefff1b0e071bbe
    resource: repo://celery/backends/base.py
  - id: openwiki-source-780ad51e7477aa5e5ddbf3df
    resource: repo://celery/backends/database/__init__.py
  - id: openwiki-source-0b6b8ed4194a35d9f3eb6192
    resource: repo://celery/backends/gcs.py
  - id: openwiki-source-6b95f00dc919dfdb3eec1511
    resource: repo://celery/backends/redis.py
  - id: openwiki-source-a4d1ab266bef232afaa055d8
    resource: repo://celery/backends/rpc.py
generated: { by: "claude-code", at: "2026-11-15T17:08:49.645Z" }
---

# Result Backends

A result backend stores each task's **state** (`PENDING` → `STARTED` → `SUCCESS`/`FAILURE`/`RETRY`/`REVOKED`), its result or exception, the traceback, child results, and optionally extended request metadata. The backend is also the coordination point for **chords** (see [Canvas](../canvas/workflows.md)). Using a backend is optional. Without `result_backend`, the app uses `DisabledBackend`, which raises on reads.

## Selection

`app.backend` → `celery.app.backends.by_url(conf.result_backend)`:

- `scheme://...` selects the alias `scheme`. With `scheme+rest://`, the part before `+` is the alias and the rest is the URL, for example `db+postgresql://...` or `cache+memcached://...`.
- Built-in aliases (`BACKEND_ALIASES`): `rpc`, `redis`/`rediss`, `sentinel`, `cache`, `db`/`database` (SQLAlchemy), `mongodb`, `elasticsearch`, `cassandra`, `couchbase`, `couchdb`, `cosmosdbsql`, `file`, `consul`, `dynamodb`, `azureblockblob`, `arangodb`, `s3`, `gs` (Google Cloud Storage), and `disabled`. (`riak` is still listed, but its module has been removed.)
- Aliases can be extended by the loader's `override_backends` (from a config key of the same name) and by the `celery.result_backends` entry-point group. A full `module:Class` path also works.
- The backend instance is cached on the app if `thread_safe` (setting `result_backend_thread_safe`), otherwise per thread (see [Application](../architecture/application.md)).

## Class hierarchy (`celery/backends/base.py`)

```
Backend                       – state machine, encoding, retry, chord hooks
├─ BaseBackend(+SyncBackendMixin)          – polling waits (database, mongodb, cassandra)
├─ BaseKeyValueStoreBackend                – get/set/mget/delete/incr over keys
│   └─ KeyValueStoreBackend(+SyncBackendMixin)   – cache, s3, dynamodb, azure, gcs, couch*, consul, file, es, cosmos, arangodb
│   └─ RedisBackend(+AsyncBackendMixin)          – pub/sub waits
└─ RPCBackend(+AsyncBackendMixin)          – results as AMQP messages
DisabledBackend
```

Capability flags on each class decide behaviour elsewhere:

- `supports_native_join` enables `GroupResult.join_native`.
- `supports_autoexpire` means beat does not schedule `celery.backend_cleanup`.
- `implements_incr` enables counter-based chord joins.
- `persistent` affects RPC message durability.
- `thread_safe` controls caching on the app.

## Writing state

The worker's tracer calls these (see [Task Execution Tracing](../tasks/execution-tracing.md)):

- `mark_as_started`, `mark_as_retry`, `mark_as_revoked`, `mark_as_done`, `mark_as_failure` → `store_result(task_id, result, state, traceback, request)`.
- `store_result` encodes the result (`encode_result` → `prepare_exception` for exception states, otherwise `prepare_value`) and calls the backend's `_store_result` through `_ensure_retryable`.
- `mark_as_done` skips storing when the request has `ignore_result`, and always calls `on_chord_part_return` when `request.chord` is set.
- `mark_as_failure` also:
  - calls `on_chord_part_return` when the task is part of a chord;
  - walks `request.chain` and stores the same failure for every remaining chained task that has an ID (for propagating states), so that callers waiting on the final `AsyncResult` of a chain do not hang;
  - for chained steps that are chords, calls `on_chord_part_return` and **descends into the chord body** so that the failure reaches the body's result (issue #9674);
  - finally calls the request's errbacks (`_call_task_errbacks`). Errbacks whose task signature accepts only one argument (old style) are called with the task ID as a group. Errbacks that accept more arguments are called with `(request, exc, traceback)`.

**Metadata** (`_get_result_meta`) contains `status`, `result`, `traceback`, `children`, `date_done` (only for ready states), `group_id`, and `parent_id`. With `result_extended=True`, it also includes `name`, `args`, `kwargs`, `worker`, `retries`, `queue`, and any stamps.

**Key-value store specifics** (`BaseKeyValueStoreBackend._store_result`):

- Keys are `celery-task-meta-<id>`, `celery-taskset-meta-<gid>`, and `chord-unlock-<gid>`, optionally prefixed with `result_backend_transport_options['global_keyprefix']`.
- Before writing, the backend reads the current metadata and **does not overwrite a stored `SUCCESS`**. This prevents a redelivered or duplicated execution from clobbering a completed result.

## Reading state

- `get_task_meta(task_id)` refuses to run for eager results (`_ensure_not_eager`) and checks an LRU cache (`result_cache_max`; `-1` disables it). It reads through the retry wrapper and caches only `SUCCESS` metadata.
- Waiting: `SyncBackendMixin.wait_for` polls `get_task_meta` every `interval` until the result is ready or the timeout expires. Async backends instead use a `ResultConsumer` plus a `Drainer` (`backends/asynchronous.py`) chosen for the execution model (default, eventlet, or gevent). See [Results API](result-api.md).
- `get_many` (key-value stores) uses `mget` to fetch many results at once, which `GroupResult.join_native` relies on.

## Exceptions are reconstructed safely

With non-pickle serializers, exceptions are stored as `{'exc_type', 'exc_message', 'exc_module'}`. `exception_to_python` looks up the class in `sys.modules[exc_module]`, or creates a stand-in class under `celery.exceptions`. It then **raises `SecurityError` if the resolved object is not a `BaseException` subclass**. Without this check, a forged backend entry such as `exc_module="os", exc_type="system"` would execute arbitrary code when a client calls `.get()`.

## Retry policy

`_ensure_retryable` wraps store, get, and forget calls. If `result_backend_always_retry` is set and `exception_safe_to_retry(exc)` is true (each backend defines its own retryable error types), it retries with exponential backoff from `result_backend_base_sleep_between_retries_ms` (10) up to `..._max_sleep_between_retries_ms` (10000), for up to `result_backend_max_retries` attempts (default unlimited). It calls `on_backend_retryable_error` before each retry; the database backend uses this to invalidate its session. When retries run out, it raises `BackendStoreError` or `BackendGetMetaError`. The **database backend defaults `always_retry` to True** to preserve the behaviour of its old `@retry` decorator.

## Expiry and cleanup

`result_expires` (1 day) becomes `backend.expires` in seconds. Backends with native TTLs (Redis `SETEX`, cache, DynamoDB, Consul, Couchbase, Cassandra `entry_ttl`, RPC queue expiry) set `supports_autoexpire=True`. Others implement `cleanup()`, which the built-in `celery.backend_cleanup` task calls daily at 04:00 through beat:

- Database: deletes `celery_taskmeta` and `celery_tasksetmeta` rows with `date_done < now - expires`.
- MongoDB: `delete_many` on the task and group collections with the same rule.

## Concrete backends

### Redis (`redis.py`)

- `_set` uses `SETEX` (or `SET`) **and `PUBLISH`es** the value on the key's channel in one pipeline. Values larger than the Redis string limit raise `BackendStoreError`.
- `on_task_call` subscribes the caller's `ResultConsumer` to the task key **before** the task is published, so the result notification cannot be missed. Inside prefork pool workers it is skipped, because `task_join_will_block` is set there.
- `ResultConsumer` keeps one pub/sub connection, resubscribes after reconnects and forks, and fetches current metadata with `MGET` before resuming.
- Native chord join uses sorted sets; see [Canvas](../canvas/workflows.md).
- `rediss://` and `redis_backend_use_ssl` enable TLS. `sentinel://` with `SentinelBackend` handles master discovery. The `redis_*` settings cover socket timeouts, keepalive, and the connection pool size.

### RPC (`rpc.py`)

- Results are sent back **as AMQP messages** to the caller's reply queue. The queue is named after `app.thread_oid`, one per client thread, is declared in `on_task_call`, auto-deletes, and expires per `result_expires`. The worker publishes to `request.reply_to` with `correlation_id`.
- Messages are transient unless `result_persistent` is set.
- State is held only by the client process. Only the original caller can read the result, the result can be read once, and results do not survive the client. Messages for other task IDs that arrive while waiting are buffered "out of band".
- Chords are **not supported**, and neither are `group | task` chains, because those are upgraded to chords. See `ensure_chords_allowed`.

### Database / SQLAlchemy (`database/`)

- `db+<sqlalchemy-url>`, or `database_url`. Models (`models.py`): `Task` and `TaskExtended` (`celery_taskmeta`, with extended columns when `result_extended` is set) and `TaskSet` (`celery_tasksetmeta`). Table names and schemas are configurable with `database_table_names` and `database_table_schemas`.
- Tables are created at backend setup unless `database_create_tables_at_setup=False`. A `SessionManager` caches engines per process, with `database_short_lived_sessions` and `database_engine_options` (`pool_pre_ping`, `pool_recycle=3600`).
- Uses polling waits and `chord_unlock`-based chord joins.

### Others

| Backend | Notes |
|---|---|
| MongoDB | Task and group collections, `mongodb_backend_settings`, explicit cleanup. |
| Cache (`cache+memcached://`, `cache+memory://`) | `implements_incr` chord counter, auto-expire. `memory` is per process and only suitable for tests. |
| DynamoDB | TTL attribute and atomic `incr` counters for chords. |
| S3, Azure Block Blob, GCS (`gs://`) | Object-per-key stores. GCS supports `incr` and native join (via Firestore). |
| Elasticsearch, Cassandra, Couchbase, CouchDB, ArangoDB, Consul, Cosmos DB SQL, filesystem (`file://`) | Key-value or document stores with backend-specific settings. |

## Tests

- `t/unit/backends/test_<name>.py`, one per backend; `test_base.py` covers metadata, exceptions, retries, chain failure propagation, and chord helpers.
- `t/integration/test_backend.py` and `test_database_backend.py` run against real services, configured through `TEST_BACKEND`.

## See also

- [Results API: AsyncResult and GroupResult](result-api.md)
- [Canvas](../canvas/workflows.md)
- [Configuration Settings Reference](../reference/configuration.md)
