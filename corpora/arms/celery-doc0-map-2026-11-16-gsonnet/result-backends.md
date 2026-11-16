---
title: "Result Backends"
---
## Overview

A result backend is where a task's state and return value go so that the client, or the next step of a workflow, can read them later. The tracer and the `Request` call the backend's `mark_as_*` methods, `AsyncResult` and `GroupResult` read through `get_task_meta`, and workflows use it to count chord completions. All backends share the `Backend` class in `celery/backends/base.py`, which supplies state handling, serialization, caching and a retry loop. A concrete backend supplies only the storage operations. Reading results from the client is covered in [[AsyncResult and GroupResult]], and how chords use the backend is in [[Groups and Chords]].

Sources: [celery/backends/base.py:108-175](repo://celery/backends/base.py#L108-L175), [celery/backends/base.py:176-190](repo://celery/backends/base.py#L176-L190)

## Selecting a backend

`Celery._get_backend` resolves `backend_cls` or the `result_backend` setting with `backends.by_url`, then instantiates the class with the app and the URL. `by_url` splits a `scheme://...` string: the scheme is the backend name, and a `+` in the scheme (such as `db+postgresql://`) keeps the part before the `+` as the name and the rest as the URL. `by_name` looks the name up in `BACKEND_ALIASES`, then in loader-specific `override_backends`, then in extension entry points in the `celery.result_backends` namespace, and falls back to `symbol_by_name`. An unknown name raises `ImproperlyConfigured`, and a name that is a module rather than a class is rejected.

Sources: [celery/app/base.py:1224-1228](repo://celery/app/base.py#L1224-L1228), [celery/app/backends.py:41-69](repo://celery/app/backends.py#L41-L69)

With no backend configured, `by_name` defaults to `disabled`, which gives a `DisabledBackend`: `store_result` does nothing and every read method raises `NotImplementedError`, so calling `.get()` on a task without a backend fails loudly rather than waiting forever.

Sources: [celery/app/backends.py:41-47](repo://celery/app/backends.py#L41-L47), [celery/backends/base.py:1263-1281](repo://celery/backends/base.py#L1263-L1281)

The app keeps one backend object. If the backend is marked thread safe (`result_backend_thread_safe`) it is cached on the app, and otherwise stored in a thread-local, so each thread gets its own instance.

Sources: [celery/app/base.py:1540-1565](repo://celery/app/base.py#L1540-L1565)

## Recording state

`Backend` has one method per outcome, all ending in `store_result`:

Sources: [celery/backends/base.py:176-199](repo://celery/backends/base.py#L176-L199)

| Method | State stored | Extra behaviour |
| --- | --- | --- |
| `mark_as_started` | `STARTED` | Used when `track_started` is on |
| `mark_as_done` | `SUCCESS` | Skipped when the request ignores results; calls `on_chord_part_return` |
| `mark_as_failure` | `FAILURE` | Calls `on_chord_part_return`, walks the chain, calls errbacks |
| `mark_as_retry` | `RETRY` | Stores the exception and traceback |
| `mark_as_revoked` | `REVOKED` | Stores `TaskRevokedError(reason)`, calls `on_chord_part_return` |

Sources: [celery/backends/base.py:176-199](repo://celery/backends/base.py#L176-L199), [celery/backends/base.py:306-323](repo://celery/backends/base.py#L306-L323)

`store_result` encodes the value with `encode_result`, then runs the backend's `_store_result` through `_ensure_retryable`. An exception state with an `Exception` value is turned into something serializable by `prepare_exception`, and anything else goes through `prepare_value`, which turns a result object into a tuple unless the serializer is pickle.

Sources: [celery/backends/base.py:526-532](repo://celery/backends/base.py#L526-L532), [celery/backends/base.py:573-576](repo://celery/backends/base.py#L573-L576), [celery/backends/base.py:673-693](repo://celery/backends/base.py#L673-L693)

The stored record is built by `_get_result_meta`: `status`, `result`, `traceback`, `children` (the sub-results the task started), and `date_done` when the state is ready. It also records `group_id` and `parent_id` when the request has them. If `result_extended` is on, it adds the task `name`, `args`, `kwargs`, `worker`, `retries`, `queue` and any stamps, and encodes the arguments when asked.

Sources: [celery/backends/base.py:581-630](repo://celery/backends/base.py#L581-L630)

## Storing exceptions

With the pickle serializer, `prepare_exception` stores a pickleable form of the exception object. With any other serializer it stores a dict with `exc_type`, `exc_message` and `exc_module`. `exception_to_python` rebuilds an exception from that dict by looking up the module and type, and falls back to creating an exception class when it cannot import one. Before calling the class it checks that it is a `BaseException` subclass and otherwise raises `SecurityError`, because a malicious record could name something like `os.system` as the "exception type".

Sources: [celery/backends/base.py:38](repo://celery/backends/base.py#L38), [celery/backends/base.py:447-526](repo://celery/backends/base.py#L447-L526)

## Retrying backend operations

`_ensure_retryable` wraps storage, reads and group operations. It only retries when `result_backend_always_retry` is on and the backend's `exception_safe_to_retry(exc)` approves the exception, and the base class never approves any, so a backend must opt in. Each retry sleeps with exponential backoff between `result_backend_base_sleep_between_retries_ms` and `result_backend_max_sleep_between_retries_ms`, up to `result_backend_max_retries`. When the limit is reached it raises the fallback exception (`BackendStoreError` when storing, `BackendGetMetaError` when reading) with the original attached. The backend can observe each retry in `on_backend_retryable_error`.

Sources: [celery/backends/base.py:138-165](repo://celery/backends/base.py#L138-L165), [celery/backends/base.py:635-671](repo://celery/backends/base.py#L635-L671), [celery/backends/base.py:732-744](repo://celery/backends/base.py#L732-L744)

## Reading state

`get_task_meta` first checks the backend's own cache, an LRU of size `result_cache_max` or a no-op when it is `-1`, then reads through the retry loop. Only successful results are cached, since other states can still change. `get_state`, `get_result`, `get_traceback` and `get_children` are projections of that record. `reload_task_result` bypasses the cache, and group results have a parallel API (`save_group`, `restore_group`, `delete_group`).

Sources: [celery/backends/base.py:146-148](repo://celery/backends/base.py#L146-L148), [celery/backends/base.py:702-722](repo://celery/backends/base.py#L702-L722), [celery/backends/base.py:746-770](repo://celery/backends/base.py#L746-L770), [celery/backends/base.py:785-818](repo://celery/backends/base.py#L785-L818)

When `task_always_eager` is on and `task_store_eager_result` is off, reads emit a `RuntimeWarning` that results are not stored.

Sources: [celery/backends/base.py:723-730](repo://celery/backends/base.py#L723-L730)

## Key/value backends

Most backends subclass `KeyValueStoreBackend`, so they implement only `get`, `mget`, `set`, `delete`, and optionally `incr` and `expire`. The base class derives all other behaviour from them. Records are kept under prefixed keys: `celery-task-meta-<id>` for tasks, `celery-taskset-meta-<id>` for groups and `chord-unlock-<id>` for chord counters.

Sources: [celery/backends/base.py:964-1020](repo://celery/backends/base.py#L964-L1020), [celery/backends/base.py:1021-1044](repo://celery/backends/base.py#L1021-L1044)

`_store_result` builds the metadata, reads the current record, and returns without writing if the stored status is already `SUCCESS`. The comment says this protects against a lost or partitioned worker overwriting the last successful result of a deduplicated task. `_get_task_meta_for` returns `{'status': PENDING, 'result': None}` when nothing is stored, which is why an unknown task id reports `PENDING`.

Sources: [celery/backends/base.py:1116-1138](repo://celery/backends/base.py#L1116-L1138), [celery/backends/base.py:1148-1153](repo://celery/backends/base.py#L1148-L1153)

A class that sets `implements_incr = True` makes the base class use the counter-based chord implementation (see [[Groups and Chords]]).

Sources: [celery/backends/base.py:969-978](repo://celery/backends/base.py#L969-L978)

## Built-in backends

The class attributes on each backend say what it supports. `supports_autoexpire` means the store expires entries itself; without it, `Scheduler.install_default_entries` adds a daily `celery.backend_cleanup` entry to beat when `result_expires` is set, so beat can purge old results ([[Beat: Periodic Task Scheduler]]). `supports_native_join` means `join_native` can fetch many results at once, and `persistent` says whether results survive a broker restart.

Sources: [celery/backends/base.py:114-127](repo://celery/backends/base.py#L114-L127), [celery/beat.py:268-277](repo://celery/beat.py#L268-L277)

| Alias | Class | Notes from the code |
| --- | --- | --- |
| `redis`, `rediss`, `sentinel` | `RedisBackend`, `SentinelBackend` | Key/value over Redis commands; autoexpire and native join; native chord counting; the client waits on pub/sub rather than polling |
| `rpc` | `RPCBackend` | Not persistent; replies go as messages to the caller's `reply_to` queue, so the result is only available to the client that sent the task; no chord support |
| `cache` | `CacheBackend` | Memcached or an in-memory dummy client; autoexpire, native join and incr |
| `db`, `database` | `DatabaseBackend` | SQLAlchemy tables for tasks and task sets; `cleanup` deletes rows older than `expires`; polls every 0.5 s |
| `mongodb` | `MongoBackend` | Collections `celery_taskmeta` and `celery_groupmeta` in database `celery` by default |
| `file` | `FilesystemBackend` | One file per key under a `file://` directory; tests the directory at start |
| `s3` | `S3Backend` | Bucket storage through boto3; requires credentials and bucket settings |
| `gs` | `GCSBackend` | Google Cloud Storage; supports incr and native join |
| `dynamodb` | `DynamoDBBackend` | Autoexpire through TTL; supports incr |
| `cassandra` | `CassandraBackend` | Autoexpire through `entry_ttl` |
| `consul`, `couchbase` | `ConsulBackend`, `CouchbaseBackend` | Key/value; autoexpire |
| `elasticsearch`, `couchdb`, `azureblockblob`, `cosmosdbsql`, `arangodb` | matching classes | Key/value stores |
| `disabled` | `DisabledBackend` | No storage; reads raise |

Sources: [celery/app/backends.py:15-38](repo://celery/app/backends.py#L15-L38), [celery/backends/redis.py:77-112](repo://celery/backends/redis.py#L77-L112), [celery/backends/redis.py:204-221](repo://celery/backends/redis.py#L204-L221), [celery/backends/rpc.py:147-160](repo://celery/backends/rpc.py#L147-L160), [celery/backends/cache.py:90-96](repo://celery/backends/cache.py#L90-L96), [celery/backends/database/__init__.py:45-53](repo://celery/backends/database/__init__.py#L45-L53), [celery/backends/mongodb.py:36-55](repo://celery/backends/mongodb.py#L36-L55), [celery/backends/gcs.py:161-168](repo://celery/backends/gcs.py#L161-L168), [celery/backends/dynamodb.py:56-66](repo://celery/backends/dynamodb.py#L56-L66)

The RPC backend is the one that does not store anything on a server. `store_result` publishes the result message to the `reply_to` and `correlation_id` taken from the request, and returns without publishing when there is no `reply_to`. Its `on_task_call` declares the reply queue before the task is sent, unless the join would block in a prefork child, where the queue is known to exist.

Sources: [celery/backends/rpc.py:202-257](repo://celery/backends/rpc.py#L202-L257)

The filesystem backend requires a `file://` URL; `file://localhost/` prefixes are stripped, an empty URL raises `ImproperlyConfigured`, and the constructor writes, reads and deletes a test file to verify the directory works.

Sources: [celery/backends/filesystem.py:25-75](repo://celery/backends/filesystem.py#L25-L75)

The cache backend takes its servers from the URL (`memcache://host1;host2`), merges `cache_backend_options`, and raises `ImproperlyConfigured` for an unknown cache type.

Sources: [celery/backends/cache.py:98-117](repo://celery/backends/cache.py#L98-L117)
