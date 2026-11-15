---
title: "Result Backends"
---
## Overview

A result backend stores what tasks produce: their state, return value or exception, traceback, children and, optionally, their arguments and worker. Workers write to it from the tracer ([[Task Tracing and Execution]]); callers read from it through `AsyncResult` ([[Task Results and AsyncResult]]); chords use it to count finished header tasks ([[Chains, Groups and Chords at Runtime]]). All backends share one base class that handles encoding, exception serialization, caching and retries, so a backend implementation only provides storage primitives. Results are optional: with no `result_backend` the app uses `DisabledBackend`, and tasks can opt out with `ignore_result`.

Sources: [celery/backends/base.py:108-171](repo://celery/backends/base.py#L108-L171), [celery/backends/base.py:1263-1281](repo://celery/backends/base.py#L1263-L1281)

## Selecting a backend

`app.backend` is built on first use from `result_backend` (or the `backend=` argument to `Celery`). `backends.by_url` splits the URL scheme: a scheme with `+` such as `db+postgresql://` selects the alias before the `+` and passes the rest as the URL; otherwise the scheme itself is the alias. `by_name` resolves the alias against `BACKEND_ALIASES`, the loader's `override_backends`, and classes registered under the `celery.result_backends` entry point, so third-party packages can add schemes. An unknown name raises `ImproperlyConfigured`.

Sources: [celery/app/backends.py:15-69](repo://celery/app/backends.py#L15-L69), [celery/app/base.py:1224-1228](repo://celery/app/base.py#L1224-L1228)

```python
app = Celery('proj', broker='amqp://', backend='redis://localhost:6379/1')
app.conf.result_backend = 'db+postgresql://user:pass@db/celery'
app.conf.result_backend = 's3://'          # bucket and keys from s3_* settings
```

Sources: [celery/app/backends.py:59-69](repo://celery/app/backends.py#L59-L69)

## The Backend base class

### Configuration

`Backend.__init__` reads its serializer from `result_serializer` (JSON by default), the accepted content types from `result_accept_content` or `accept_content`, the expiry from `result_expires` (one day), and a local LRU cache of finished results sized by `result_cache_max` (`-1`, the default, disables it). Class attributes describe the backend's abilities: `persistent`, `supports_native_join` (can fetch many results at once), `supports_autoexpire` (expires results itself), and `thread_safe`.

Sources: [celery/backends/base.py:108-164](repo://celery/backends/base.py#L108-L164), [celery/app/defaults.py:205-230](repo://celery/app/defaults.py#L205-L230)

### Writing results

The tracer and the request call `mark_as_started`, `mark_as_done`, `mark_as_failure`, `mark_as_retry` and `mark_as_revoked`, which all end in `store_result(task_id, result, state, traceback, request)`. `mark_as_done` and `mark_as_failure` also report chord membership, and `mark_as_failure` propagates the failure along the rest of a chain and calls errbacks.

Sources: [celery/backends/base.py:176-199](repo://celery/backends/base.py#L176-L199), [celery/backends/base.py:306-323](repo://celery/backends/base.py#L306-L323)

`store_result` encodes the value with `encode_result` and calls the backend's `_store_result` inside the retry helper. The stored record, built by `_get_result_meta`, holds `status`, `result`, `traceback`, `children` (the current request's child results as tuples), `date_done` for ready states, and `group_id` and `parent_id` when present. With `result_extended`, it adds the task `name`, `args`, `kwargs`, `worker`, `retries`, `queue` and any stamps.

Sources: [celery/backends/base.py:581-630](repo://celery/backends/base.py#L581-L630), [celery/backends/base.py:673-693](repo://celery/backends/base.py#L673-L693)

Key-value backends refuse to overwrite a `SUCCESS` record: `_store_result` reads the current state first and returns without writing if it is already `SUCCESS`, so a late `RETRY` or `FAILURE` from a duplicate delivery does not hide a success.

Sources: [celery/backends/base.py:1122-1134](repo://celery/backends/base.py#L1122-L1134)

### Exceptions in results

Exceptions have to survive serialization. With the `pickle` serializer they are stored as objects, after `get_pickleable_exception` checks that they can be pickled, substitutes the nearest pickleable base class, or wraps them in `UnpickleableExceptionWrapper`. With JSON and the other serializers, `prepare_exception` stores a dict of `exc_type`, `exc_message` and `exc_module`.

Sources: [celery/backends/base.py:447-455](repo://celery/backends/base.py#L447-L455), [celery/utils/serialization.py:100-172](repo://celery/utils/serialization.py#L100-L172)

`exception_to_python` turns the dict back into an exception when it is read. It looks up the class by module and qualified name in modules already imported by the reader, creates a stand-in class with the same name when the module is not loaded, and raises `SecurityError` if the named object is not an exception class, so a crafted result cannot make the reader instantiate arbitrary classes.

Sources: [celery/backends/base.py:457-526](repo://celery/backends/base.py#L457-L526)

### Reading results

`get_task_meta(task_id)` returns the cached record when present, otherwise calls `_get_task_meta_for` through the retry helper and caches `SUCCESS` records. `meta_from_decoded` converts stored exceptions back. A missing record is reported as `{'status': 'PENDING', 'result': None}`; `task_result_exists` tells the two apart. `forget` deletes a record, `save_group`, `restore_group` and `delete_group` handle `GroupResult` records, and `cleanup` deletes expired results for backends that cannot expire them.

Sources: [celery/backends/base.py:695-770](repo://celery/backends/base.py#L695-L770), [celery/backends/base.py:774-822](repo://celery/backends/base.py#L774-L822), [celery/backends/base.py:541-556](repo://celery/backends/base.py#L541-L556)

### Retrying backend errors

Writes and reads go through `_ensure_retryable`. With `result_backend_always_retry` on, an exception that the backend's `exception_safe_to_retry` accepts (Redis connection errors, database disconnects) is retried with exponential backoff and full jitter, from `result_backend_base_sleep_between_retries_ms` (10) up to `result_backend_max_sleep_between_retries_ms` (10,000), for `result_backend_max_retries` attempts (unlimited). The `on_backend_retryable_error` hook runs before each retry; the database backend uses it to drop its session. When retries run out, a write raises `BackendStoreError` and a read `BackendGetMetaError`.

Sources: [celery/backends/base.py:635-671](repo://celery/backends/base.py#L635-L671), [celery/backends/base.py:732-744](repo://celery/backends/base.py#L732-L744)

## Key-value backends

`BaseKeyValueStoreBackend` turns the backend API into five primitives a store must provide: `get`, `mget`, `set`, `delete`, and optionally `incr` and `expire`. Task records live under `celery-task-meta-<id>`, groups under `celery-taskset-meta-<id>`, chord counters under `chord-unlock-<id>`; `global_keyprefix` in `result_backend_transport_options` prefixes them all so several apps can share one store.

Sources: [celery/backends/base.py:964-1062](repo://celery/backends/base.py#L964-L1062)

`get_many` serves `join_native` for these backends: it yields cached ready results first, then repeatedly `mget`s the remaining keys every `interval` seconds, yielding each newly ready result, until all are done or the timeout passes. Backends that implement `incr` use the counter-based chord join instead of `chord_unlock`.

Sources: [celery/backends/base.py:1079-1120](repo://celery/backends/base.py#L1079-L1120), [celery/backends/base.py:969-979](repo://celery/backends/base.py#L969-L979)

## The Redis backend

`RedisBackend` is a key-value backend with push delivery. `_set` writes the record with `SETEX` when results expire and publishes the same value on a channel named after the key, in one pipeline. Its `ResultConsumer` subscribes to the channels of pending results, so `get()` returns as soon as the worker writes, without polling; after a fork or a connection loss it resubscribes. `on_task_call` subscribes before the task is even sent.

Sources: [celery/backends/redis.py:77-150](repo://celery/backends/redis.py#L77-L150), [celery/backends/redis.py:171-202](repo://celery/backends/redis.py#L171-L202), [celery/backends/redis.py:501-553](repo://celery/backends/redis.py#L501-L553)

Connection settings come from the URL and the `redis_*` settings (`redis_max_connections`, `redis_socket_timeout`, `redis_retry_on_timeout` and so on); `rediss://` enables TLS and `sentinel://` selects `SentinelBackend`, which asks Sentinel for the current master. Values larger than Redis's 512 MB limit raise `BackendStoreError`. Connection errors on set are retried with the backend's retry policy, which `result_backend_transport_options['retry_policy']` can change. Chords use sorted sets as described on [[Chains, Groups and Chords at Runtime]].

Sources: [celery/backends/redis.py:204-260](repo://celery/backends/redis.py#L204-L260), [celery/backends/redis.py:487-531](repo://celery/backends/redis.py#L487-L531), [celery/backends/redis.py:727-806](repo://celery/backends/redis.py#L727-L806)

## The database backend

`DatabaseBackend` (`db+<sqlalchemy-url>`) stores results in two SQLAlchemy tables, `celery_taskmeta` and `celery_tasksetmeta`; with `result_extended` it uses the `TaskExtended` model, which adds name, args, kwargs, worker, retries and queue columns. Table names and schemas can be changed with `database_table_names` and `database_table_schemas`, and `database_create_tables_at_setup` creates them at start-up. Unlike other backends it retries by default (three times) on disconnect errors, invalidating the session before each retry. Expired rows are deleted by `cleanup`, which beat runs daily through `celery.backend_cleanup`.

Sources: [celery/backends/database/__init__.py:60-120](repo://celery/backends/database/__init__.py#L60-L120), [celery/backends/database/__init__.py:237-250](repo://celery/backends/database/__init__.py#L237-L250), [celery/backends/database/models.py:27-121](repo://celery/backends/database/models.py#L27-L121)

For any backend that does not expire results itself (`supports_autoexpire` false), beat installs `celery.backend_cleanup` to run every day at 4 a.m., unless the schedule already has that entry.

Sources: [celery/beat.py:265-280](repo://celery/beat.py#L265-L280), [celery/app/builtins.py:12-23](repo://celery/app/builtins.py#L12-L23)

## Choosing a backend

| Alias (scheme) | Class | Use it when |
| --- | --- | --- |
| `redis`, `rediss`, `sentinel` | `RedisBackend`, `SentinelBackend` | Default choice: fast, push-based `get`, efficient chords |
| `rpc` | `RPCBackend` | Only the caller needs the result; no extra service; no chords, not persistent |
| `db`, `database` | `DatabaseBackend` | Results must be queryable in SQL or kept long-term |
| `cache` | `CacheBackend` | Memcached (or in-memory for tests); short-lived results |
| `mongodb` | `MongoBackend` | MongoDB is already in use |
| `dynamodb` | `DynamoDBBackend` | AWS without servers to run; supports TTL |
| `s3` | `S3Backend` | Large results stored in a bucket |
| `gs` | `GCSBackend` | Google Cloud Storage, with Firestore for chord counters |
| `azureblockblob` | `AzureBlockBlobBackend` | Azure Blob Storage |
| `cosmosdbsql` | `CosmosDBSQLBackend` | Azure Cosmos DB |
| `elasticsearch` | `ElasticsearchBackend` | Results should be searchable |
| `cassandra` | `CassandraBackend` | Cassandra is already in use; TTL support |
| `couchbase`, `couchdb`, `arangodb`, `consul` | Matching classes | These stores are already in use |
| `file` | `FilesystemBackend` | A shared directory, for small setups |
| `disabled` | `DisabledBackend` | No results; reading one raises |

Sources: [celery/app/backends.py:15-38](repo://celery/app/backends.py#L15-L38)

Backends that implement `incr` (cache, DynamoDB, GCS) join chords with a counter; Redis uses its own sorted-set scheme; the rest fall back to the polling `celery.chord_unlock` task, which costs an extra task every second while the chord runs. RPC and the disabled backend refuse chords.

Sources: [celery/backends/cache.py:96-96](repo://celery/backends/cache.py#L96-L96), [celery/backends/dynamodb.py:66-66](repo://celery/backends/dynamodb.py#L66-L66), [celery/backends/gcs.py:167-167](repo://celery/backends/gcs.py#L167-L167), [celery/backends/base.py:861-867](repo://celery/backends/base.py#L861-L867)

## Writing a backend

A key-value backend subclasses `KeyValueStoreBackend` and implements `get`, `mget`, `set` and `delete` (plus `incr` and `expire` for counter-based chords); everything else comes from the base classes. A backend that is not a key-value store subclasses `BaseBackend` and implements `_store_result`, `_get_task_meta_for`, `_forget`, `_save_group`, `_restore_group` and `_delete_group`. Register it under the `celery.result_backends` entry point to make its URL scheme available.

Sources: [celery/backends/base.py:957-963](repo://celery/backends/base.py#L957-L963), [celery/backends/base.py:1014-1034](repo://celery/backends/base.py#L1014-L1034), [celery/backends/base.py:1259-1261](repo://celery/backends/base.py#L1259-L1261), [celery/app/backends.py:41-56](repo://celery/app/backends.py#L41-L56)

```python
from celery.backends.base import KeyValueStoreBackend


class DictBackend(KeyValueStoreBackend):
    def __init__(self, app, **kwargs):
        super().__init__(app, **kwargs)
        self._data = {}

    def get(self, key):
        return self._data.get(key)

    def mget(self, keys):
        return [self._data.get(k) for k in keys]

    def set(self, key, value):
        self._data[key] = value

    def delete(self, key):
        self._data.pop(key, None)
```

Sources: [celery/backends/base.py:1014-1034](repo://celery/backends/base.py#L1014-L1034)
