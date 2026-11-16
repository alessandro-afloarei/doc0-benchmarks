---
type: subsystem
title: Result Backends
description: How Celery stores and retrieves task state and results — backend selection from result_backend URLs, the Backend / BaseKeyValueStoreBackend / AsyncBackendMixin hierarchy, result metadata and exception serialization, retry and caching behaviour, expiry, and the specifics of the Redis, RPC and SQLAlchemy database backends.
tags: [result-backend, redis, rpc, database, sqlalchemy, results, storage]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:05:29.073Z
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
  - id: openwiki-source-2a32c4e613bc7be1d621d647
    resource: repo://celery/beat.py
generated: { by: "claude-code", at: "2026-11-16T17:05:29.073Z" }
---

# Result Backends

A result backend stores task states (`PENDING` → `STARTED` → `SUCCESS`/`FAILURE`/`RETRY`/`REVOKED`), return values, tracebacks, group results and chord bookkeeping. Workers write through `task.backend` (normally `app.backend`); clients read through [result objects](result-objects.md). Without a backend (`DisabledBackend`) results cannot be fetched and chords are unavailable.

## Selection

`app.backend` is created lazily by `Celery._get_backend()` → `celery.app.backends.by_url(conf.result_backend)`:

- A URL such as `redis://host/0` selects the backend by scheme; `db+postgresql://...` selects `db` and passes the remainder (`postgresql://...`) as the URL.
- Aliases in `BACKEND_ALIASES`: `rpc`, `redis`/`rediss`/`sentinel`, `cache`, `mongodb`, `db`/`database`, `elasticsearch`, `cassandra`, `couchbase`, `couchdb`, `cosmosdbsql`, `file`, `consul`, `dynamodb`, `azureblockblob`, `arangodb`, `s3`, `gs`, `disabled`. A `riak` alias also remains but points to a module that no longer exists in `celery/backends/`.
- Any `module:Class` path works; aliases can be added via the loader's `override_backends` or the `celery.result_backends` entry-point group.
- No configured backend → `disabled`.

Backends declaring `thread_safe` (from `result_backend_thread_safe`) are shared by the app; others are created per thread (see [Application Object](../architecture/application-object.md)).

## Class hierarchy

```text
Backend                         (celery/backends/base.py: state API, encoding, retries, chord hooks)
├── BaseBackend = Backend + SyncBackendMixin         → Database, Mongo, Cassandra, DisabledBackend
├── BaseKeyValueStoreBackend    (get/set/mget/delete/incr on string keys)
│   ├── KeyValueStoreBackend = + SyncBackendMixin    → Cache, Filesystem, S3, GCS, DynamoDB, Azure,
│   │                                                  Consul, CouchDB, Couchbase, Elasticsearch, ArangoDB, CosmosDB
│   └── RedisBackend = + AsyncBackendMixin           → SentinelBackend
└── RPCBackend = Backend + AsyncBackendMixin
```

- **SyncBackendMixin** implements waiting by polling `get_task_meta` every `interval` (`wait_for`, `iter_native`).
- **AsyncBackendMixin** (`celery/backends/asynchronous.py`) uses a `ResultConsumer` that receives pushed updates (Redis pub/sub, AMQP reply queue) and a `Drainer` matched to the concurrency model (plain, eventlet, gevent). These backends set `supports_native_join` so groups can be joined efficiently.

## Writing results

The tracer calls `mark_as_started`, `mark_as_done`, `mark_as_failure`, `mark_as_retry`, `mark_as_revoked`, all funnelling into `store_result(task_id, result, state, traceback, request)`:

1. `encode_result()` converts exceptions with `prepare_exception()`; other values pass through `prepare_value()` (result objects are converted to tuples for non-pickle serializers).
2. `_get_result_meta()` builds `{status, result, traceback, children, date_done, group_id?, parent_id?}`. With `result_extended=True` it adds `name`, `args`, `kwargs`, `worker`, `retries`, `queue` and stamping headers.
3. `_ensure_retryable()` runs the backend's `_store_result`. With `result_backend_always_retry`, exceptions the backend deems safe (`exception_safe_to_retry`) are retried with exponential backoff (`result_backend_base_sleep_between_retries_ms`, `..._max_sleep_between_retries_ms`, `result_backend_max_retries`); after exhausting retries a `BackendStoreError` is raised.

`mark_as_done`/`mark_as_failure` also drive workflow bookkeeping: `on_chord_part_return` for chord members, failure propagation through `request.chain`, and errbacks. See [Canvas](../canvas/workflows.md#error-propagation).

### Key-value backends

`BaseKeyValueStoreBackend` maps ids to keys `celery-task-meta-<id>`, `celery-taskset-meta-<gid>`, and `chord-unlock-<gid>`, optionally prefixed by `result_backend_transport_options['global_keyprefix']`. `_store_result` first reads the current meta and **does nothing if the task is already `SUCCESS`**, so a duplicate execution (e.g. after a lost worker redelivery) cannot overwrite a successful result. `get_many()` fetches many tasks with `mget`, used by `ResultSet.join_native`/`iter_native` and the Redis/KV fast paths.

## Reading results

- `get_task_meta(task_id)` queries `_get_task_meta_for` under the retry policy (raising `BackendGetMetaError` when retries are exhausted). Only `SUCCESS` metadata is cached, in an LRU sized by `result_cache_max`; the default `-1` disables the cache.
- `exception_to_python()` rebuilds exceptions from `{exc_type, exc_message, exc_module}`. If the module/class cannot be imported, a synthetic exception class is created. **It raises `SecurityError` if the resolved object is not a `BaseException` subclass**, preventing a forged result (e.g. `exc_module='os', exc_type='system'`) from executing arbitrary callables.
- Decoding uses the backend's `accept` list: `result_accept_content`, else `accept_content`.

## Expiry and cleanup

`result_expires` (default 1 day) sets `self.expires`. Backends with `supports_autoexpire` (Redis, RPC, cache, DynamoDB, Cassandra, Couchbase, Consul) expire data natively. For others, beat automatically schedules the built-in `celery.backend_cleanup` task daily at 04:00, which calls `backend.cleanup()` — e.g. the database backend deletes rows older than `expires`.

## Notable backends

### Redis (`celery/backends/redis.py`)

- `set()` writes with `SETEX` when expiry is set and **publishes** the value on a channel named after the key in the same pipeline; the `ResultConsumer` subscribes to keys of pending results, so `AsyncResult.get()` wakes on publish instead of polling. On reconnect it re-reads subscribed keys with `MGET` before resubscribing to avoid missing updates.
- Native chord joins via sorted sets/lists and a size key (see [Canvas](../canvas/workflows.md#how-chords-are-joined)); `result_chord_ordered` (transport option) controls ordering.
- `rediss://` requires an explicit `ssl_cert_reqs`; `CERT_NONE`/`CERT_OPTIONAL` log warnings. `SentinelBackend` supports Redis Sentinel; `redis_retry_on_timeout`, socket timeouts and other `redis_*` settings configure the client.

### RPC (`celery/backends/rpc.py`)

- Results are sent **as messages back to the caller** over the broker: each client thread has one reply queue named by `app.thread_oid`, used as the `reply_to` of tasks it publishes. `on_task_call` declares that queue before publishing.
- `persistent = False` by default (transient messages unless `result_persistent`), `supports_native_join = True`, and auto-expire via queue `expires`.
- Only the client that sent the task can retrieve its result, and results can be consumed only once; states are not queryable later from other processes. Excess messages for one task id beyond a backlog limit raise `BacklogLimitExceeded`.

### Database (`celery/backends/database/`)

- SQLAlchemy models in `models.py`: `celery_taskmeta` (`Task`, or `TaskExtended` with name/args/kwargs/worker/retries/queue when `result_extended`) and `celery_tasksetmeta` (`TaskSet`). Results are stored in a `PickleType` column.
- Configuration: `database_engine_options`, `database_short_lived_sessions`, `database_table_names`, `database_table_schemas`, `database_create_tables_at_setup`, and `database_engine_callback` (callable or import path invoked when engines are created).
- `SessionManager` caches engines/sessions per process and resets after fork. Database operations default to `always_retry=True` for backward compatibility with the old `@retry` decorator.

### Others

Cloud/object stores (S3, GCS, Azure Block Blob, DynamoDB, CosmosDB) and databases (MongoDB, Cassandra, Elasticsearch, CouchDB, Couchbase, ArangoDB, Consul, filesystem, memcached) each implement the KV primitives or the `BaseBackend` methods. Their optional dependencies live in `requirements/extras/*.txt`, and their settings in the matching namespaces of `celery/app/defaults.py`.

## Writing a custom backend

Subclass `KeyValueStoreBackend` and implement `get`, `mget`, `set`, `delete` (plus `incr` and `implements_incr = True` for counter-based chords, and `expire`), or subclass `BaseBackend` and implement `_store_result`, `_get_task_meta_for`, `_save_group`, `_restore_group`, `_delete_group`, `_forget`. Point `result_backend` at the class path or register an entry point.

## Tests

- `t/unit/backends/test_base.py` — encoding, exception round-trips (including the `SecurityError` guard), retry policy, KV store semantics, chord helpers.
- `t/unit/backends/test_redis.py`, `test_rpc.py`, `test_database.py`, plus one test module per backend.
- `t/integration/test_backend.py`, `test_database_backend.py` — live backend checks.

## Related

- [Result Objects](result-objects.md)
- [Canvas: Signatures, Chains, Groups and Chords](../canvas/workflows.md)
- [Task Execution, Tracing and Retries](../tasks/execution-tracing-and-retries.md)
