---
type: architecture
title: Result Backends and Result Objects
description: How task state and return values are stored and retrieved. Covers backend selection by URL, the Backend/KeyValueStore/RPC/Redis/database implementations, result classes (AsyncResult, ResultSet, GroupResult), async result draining, exception serialization, retry and expiry behavior, and chord support.
tags: [celery, result-backend, asyncresult, redis, rpc, database, chord, serialization]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:56:17.091Z
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
generated: { by: "claude-code", at: "2026-11-16T17:56:17.091Z" }
---

# Result Backends and Result Objects

A result backend stores a task's state (`PENDING`, `STARTED`, `SUCCESS`, `FAILURE`, ...) and return value so that a client can read it, and so that the canvas (chords, group results) can synchronize. Backends live in `celery/backends/`. The client-side handles for results live in `celery/result.py`. Backends are optional: with none configured, the app uses `DisabledBackend` and any attempt to fetch a result raises.

## Selecting a backend

`celery/app/backends.py` resolves `result_backend` (or the `backend=` argument of the app) to a class.

- `by_url` splits a URL like `redis://host/0` into a scheme and a URL. A `+` in the scheme (`db+postgresql://...`) separates the backend alias from the driver URL that is passed on.
- `by_name` looks the alias up in `BACKEND_ALIASES`. These cover `rpc`, `cache`, `redis`/`rediss`/`sentinel`, `mongodb`, `db`/`database`, `elasticsearch`, `cassandra`, `couchbase`, `couchdb`, `cosmosdbsql`, `file`, `consul`, `dynamodb`, `azureblockblob`, `arangodb`, `s3`, `gs`, and `disabled`. It then merges in `loader.override_backends` and the `celery.result_backends` entry-point group, so third-party packages can register backends. A full dotted path also works. A missing or non-class result raises `ImproperlyConfigured`.
- `Celery._get_backend` instantiates it as `backend(app=app, url=url)`. See [App and configuration](app-and-configuration.md) for caching, which is per thread unless the backend sets `thread_safe`.

## The `Backend` base class

`celery/backends/base.py::Backend` implements everything that does not depend on the storage medium.

**State transitions.** The `mark_as_started`, `mark_as_done`, `mark_as_failure`, `mark_as_retry` and `mark_as_revoked` methods call `store_result`. They are what the tracer calls (see [Task execution and tracing](../workflows/task-execution-and-tracing.md)). `mark_as_done` and `mark_as_failure` also drive chords and errbacks, which [Canvas](canvas-workflows.md) describes.

**Storing.** `store_result` encodes the value (`encode_result`, which converts exceptions and nested result objects), then runs `_store_result` through `_ensure_retryable`. The metadata dict (`_get_result_meta`) contains `status`, `result`, `traceback`, `children`, `date_done`, and `group_id` and `parent_id` when present. With the `result_extended` setting it also records `name`, `args`, `kwargs`, `worker`, `retries`, `queue`, and stamps.

**Reading.** `get_task_meta` consults a per-backend LRU cache (`result_cache_max`; `-1` disables it). Only `SUCCESS` metadata is cached, since it is final.

**Retries.** `_ensure_retryable` wraps storage and retrieval. If `result_backend_always_retry` is enabled and the backend says the exception is safe to retry (`exception_safe_to_retry`), it retries with exponential backoff up to `result_backend_max_retries`. After that it raises `BackendStoreError` or `BackendGetMetaError`. The database backend turns `always_retry` on by default, for backward compatibility.

**Waiting.** `SyncBackendMixin.wait_for` polls `get_task_meta` every `interval` seconds until the state is ready or the timeout expires. Backends with a push mechanism use the async mixin instead (below).

**Expiry.** `result_expires` is turned into `self.expires`. Backends with `supports_autoexpire = True` (Redis, RPC, cache, Cassandra, Consul, Couchbase, DynamoDB) rely on native TTLs. For the others, beat schedules the daily `celery.backend_cleanup` task (see [Beat scheduler](beat-scheduler.md)).

### Exceptions are serialized as data

With a JSON-style serializer, `prepare_exception` stores `{exc_type, exc_message, exc_module}`. With pickle it stores a pickleable copy. When reading, `exception_to_python` rebuilds the exception class by importing `exc_module` and walking the dotted type name. It **checks that the result is an exception class**, and raises `SecurityError` otherwise. This guards against a poisoned backend entry that names, for example, `os.system` as an "exception". Unknown classes become dynamically created exception types.

## Key/value backends

`BaseKeyValueStoreBackend` implements the template for stores that offer `get`, `set`, `delete`, `incr` and `expire` (cache, Redis, Consul, filesystem, S3, DynamoDB and others). Keys use prefixes for tasks, groups and chords (`celery-task-meta-`, `celery-taskset-meta-`, `chord-unlock-`), optionally behind a global key prefix. `_store_result` first reads the current record and **refuses to overwrite a `SUCCESS`** state. This fixes a race where a redelivered or lost task could overwrite a finished result after a network partition. `get_many` and `mget` back the native join used by `GroupResult`.

### Redis (`celery/backends/redis.py`)

`RedisBackend` (also `rediss://` and `SentinelBackend`) sets `supports_autoexpire` and `supports_native_join`. Results are `SET` with expiry. It is an async backend: a `ResultConsumer` subscribes to a pub/sub channel per pending task, and `store_result` also publishes the result so that waiting clients wake without polling. Connection errors trigger the configured retry policy and re-subscription.

Chords use per-group keys, written in `on_chord_part_return`: a sorted set (default) or list of encoded results, a counter, and the chord size. A pipeline adds the result, reads the count and the size, and refreshes expiry. When the count equals the size, the backend collects the results in order, delivers the body, and deletes the keys. See [Canvas](canvas-workflows.md) for the full flow and failure handling.

### RPC (`celery/backends/rpc.py`)

`RPCBackend` does not store anything. It sends the result as a **reply message** to the `reply_to` queue named in the task's request, with the `correlation_id`. The client has one reply queue per app process (`oid`), consumed by `ResultConsumer`. Consequences:

- A result can be fetched **once**, and only by the process that sent the task.
- It does not support chords, and `ensure_chords_allowed` raises. Chains that contain a group get upgraded to chords, so they fail as well.
- It supports auto-expiry (messages expire with the queue).

### Database (`celery/backends/database/`)

`DatabaseBackend` uses SQLAlchemy sessions (`models.py` defines `Task` and `TaskSet` tables). It polls (`subpolling_interval = 0.5`), uses the retry-by-default policy above, and cleans up expired rows in `cleanup()`. It does not support auto-expiry, so the daily cleanup task applies.

### Others

Additional backends (MongoDB, Cassandra, Couchbase, CouchDB, Elasticsearch, filesystem, S3, GCS, Azure Blob, CosmosDB, ArangoDB, DynamoDB, Consul, memcached cache) each subclass `KeyValueStoreBackend` or `BaseBackend` and implement the storage primitives. Their optional dependencies are declared in `requirements/extras/`.

## Async result consumption

Backends that push results (Redis, RPC) mix in `AsyncBackendMixin` (`celery/backends/asynchronous.py`):

- `add_pending_result` registers an `AsyncResult` and tells the backend's `ResultConsumer` to subscribe to that task's channel or queue. If the message was already buffered, the result is resolved immediately.
- A `Drainer` runs `drain_events` until the awaited promise is ready. The default drainer runs in the calling thread. `eventletDrainer` and `geventDrainer` run it in a greenlet. They are registered with `@register_drainer` and chosen by kombu's `detect_environment()` when the `ResultConsumer` is created.
- `BaseResultConsumer.reconnect_on_error` re-establishes the connection and resubscribes after failures.

## Result objects (`celery/result.py`)

- **`AsyncResult(id, backend, parent)`** is a lightweight handle. `get(timeout, propagate, follow_parents, ...)` waits through the backend. If an exception was stored it is re-raised, and parents in a chain are checked first, so a failed ancestor surfaces. `state`, `result`, `traceback`, `ready()`, `successful()`, `failed()`, `forget()` and `revoke()` go to the backend or the control channel. `collect()` and `iterdeps()` walk the parent chain, and `graph` renders it. It is picklable (via `as_tuple`/`result_from_tuple`) so that it can be embedded in messages. Calling `get()` inside a task raises unless the pool allows blocking or `allow_join_result()` is used (`disable_sync_subtasks`), to prevent deadlocks.
- **`ResultSet`** holds a collection and offers `ready()`, `successful()`, `get()`, `join()` (ordered), `iterate()`, and `join_native()`/`iter_native()`, which use the backend's bulk fetch where `supports_native_join` is true.
- **`GroupResult`** is a `ResultSet` with an `id`, a `parent`, and `save()`, `restore()` and `delete()` that persist the group's member list through the backend. Chord completion and nested groups depend on this.
- **`EagerResult`** is the in-process result returned by `task.apply()` and by `task_always_eager`. It has no backend.
- `result_from_tuple` rebuilds any of these from their serialized tuple form.

## Operational notes

- `ignore_result=True` (per task, via the `task_ignore_result` setting, or per call) skips storing results, and `AsyncResult.get()` returns `None` immediately for them. The tracer resolves the effective value with `get_actual_ignore_result`, where an explicit request-level value overrides the task's.
- Backend connection and retry settings are covered under `result_backend_*` and `redis_*` settings. `result_serializer` and `result_accept_content` limit what can be stored and read. See [Message security](../operations/message-security.md).

## Tests

`t/unit/backends/` has one file per backend plus `test_base.py` and `test_asynchronous.py`. `t/unit/tasks/test_result.py` covers the result classes, and `t/integration/test_backend.py` and `t/integration/test_database_backend.py` run against real services. See [Testing, CI and development workflow](../testing/test-strategy.md).
