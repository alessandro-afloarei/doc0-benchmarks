---
title: "Result Backends"
---
## Overview

A result backend is where Celery keeps task state and return values so that a client holding an `AsyncResult` can learn what happened to a task that ran in another process. Workers write to it (`store_result` and the `mark_as_*` helpers), clients read from it (`get_task_meta`, `wait_for`, `get_many`), and chords use it to know when every header task has finished. Every concrete store, from Redis to S3, is a subclass of the classes in `celery/backends/base.py`, so the serialization, retry, caching and chord rules described here apply to all of them.

Sources: [celery/backends/base.py:108-166](repo://celery/backends/base.py#L108-L166)

The application builds its backend lazily: `app.backend` calls `_get_backend`, which resolves `result_backend` (or the `backend` argument given to `Celery`) through `by_url` and instantiates the class with the app and URL. A backend that declares itself thread safe is cached on the app; otherwise each thread gets its own instance through a `threading.local`. [[Task Results]] covers the `AsyncResult` side, and the concrete stores are covered in [[Redis and RPC Backends]] and [[Database and Other Backends]].

Sources: [celery/app/base.py:1224-1228](repo://celery/app/base.py#L1224-L1228), [celery/app/base.py:1539-1563](repo://celery/app/base.py#L1539-L1563)

## Class hierarchy

`Backend` holds the shared logic but no waiting strategy. Two mixins supply one: `SyncBackendMixin` polls the store, while `AsyncBackendMixin` (in `celery/backends/asynchronous.py`) consumes pushed messages. `BaseBackend` is `Backend` plus polling and is the base for stores with their own query model (database, MongoDB, Cassandra). `BaseKeyValueStoreBackend` adds key naming and a `get`/`set`/`mget`/`delete`/`incr` contract, and `KeyValueStoreBackend` combines it with polling. `RedisBackend` is the one key/value store that combines `BaseKeyValueStoreBackend` with `AsyncBackendMixin` instead.

Sources: [celery/backends/base.py:879-957](repo://celery/backends/base.py#L879-L957), [celery/backends/base.py:964-1019](repo://celery/backends/base.py#L964-L1019), [celery/backends/base.py:1259-1281](repo://celery/backends/base.py#L1259-L1281), [celery/backends/redis.py:204-204](repo://celery/backends/redis.py#L204-L204), [celery/backends/rpc.py:147-147](repo://celery/backends/rpc.py#L147-L147)

```mermaid
classDiagram
  class Backend
  class SyncBackendMixin
  class AsyncBackendMixin
  class BaseBackend
  class BaseKeyValueStoreBackend
  class KeyValueStoreBackend
  class DisabledBackend
  class RedisBackend
  class RPCBackend
  class DatabaseBackend
  Backend <|-- BaseBackend
  SyncBackendMixin <|-- BaseBackend
  Backend <|-- BaseKeyValueStoreBackend
  BaseKeyValueStoreBackend <|-- KeyValueStoreBackend
  SyncBackendMixin <|-- KeyValueStoreBackend
  BaseBackend <|-- DisabledBackend
  BaseKeyValueStoreBackend <|-- RedisBackend
  AsyncBackendMixin <|-- RedisBackend
  Backend <|-- RPCBackend
  AsyncBackendMixin <|-- RPCBackend
  BaseBackend <|-- DatabaseBackend
```

Sources: [celery/backends/base.py:957-964](repo://celery/backends/base.py#L957-L964), [celery/backends/base.py:1259-1264](repo://celery/backends/base.py#L1259-L1264), [celery/backends/database/__init__.py:45-45](repo://celery/backends/database/__init__.py#L45-L45)

Class attributes let a subclass advertise what it can do. `supports_native_join` means the backend implements `get_many` so `ResultSet.join_native` can fetch many results per round trip; `supports_autoexpire` tells Celery the store expires results itself, so the daily `backend_cleanup` periodic task is not needed; `persistent` is the default for `result_persistent`; `retry_policy` is the default connection retry policy, which the RPC backend overrides and the Redis backend extends from its transport options.

Sources: [celery/backends/base.py:108-136](repo://celery/backends/base.py#L108-L136), [celery/backends/base.py:567-571](repo://celery/backends/base.py#L567-L571), [celery/beat.py:268-276](repo://celery/beat.py#L268-L276), [celery/backends/redis.py:492-497](repo://celery/backends/redis.py#L492-L497)

## Backend resolution

### Aliases and URLs

`by_url` takes the configured value. If it holds `://`, the part before it is the scheme; a scheme containing `+` (for example `db+postgresql://...`) is split so that `db` picks the backend and the rest (`postgresql://...`) is passed on as the URL. Without `://` the whole string is treated as an alias or dotted class path. `by_name` then merges `BACKEND_ALIASES` with the loader's `override_backends` and with any classes registered under the `celery.result_backends` entry point namespace, and resolves the name with `symbol_by_name`. An empty value resolves to `disabled`.

Sources: [celery/app/backends.py:41-69](repo://celery/app/backends.py#L41-L69), [celery/loaders/base.py:125-130](repo://celery/loaders/base.py#L125-L130)

An unknown name raises `ImproperlyConfigured` with the `UNKNOWN_BACKEND` message, and so does a name that resolves to a module rather than a class.

Sources: [celery/app/backends.py:11-13](repo://celery/app/backends.py#L11-L13), [celery/app/backends.py:48-56](repo://celery/app/backends.py#L48-L56)

```python
app = Celery('proj', broker='amqp://', backend='redis://localhost:6379/0')
app.conf.result_backend = 'db+postgresql://user:pass@host/celery'
app.conf.result_backend = 'myproject.backends:CustomBackend'
```

Sources: [celery/app/backends.py:59-69](repo://celery/app/backends.py#L59-L69), [celery/app/base.py:1224-1228](repo://celery/app/base.py#L1224-L1228)

### Alias table

| Alias / scheme | Class |
| --- | --- |
| `rpc` | `celery.backends.rpc.RPCBackend` |
| `cache` | `celery.backends.cache:CacheBackend` |
| `redis`, `rediss` | `celery.backends.redis:RedisBackend` |
| `sentinel` | `celery.backends.redis:SentinelBackend` |
| `mongodb` | `celery.backends.mongodb:MongoBackend` |
| `db`, `database` | `celery.backends.database:DatabaseBackend` |
| `elasticsearch` | `celery.backends.elasticsearch:ElasticsearchBackend` |
| `cassandra` | `celery.backends.cassandra:CassandraBackend` |
| `couchbase` | `celery.backends.couchbase:CouchbaseBackend` |
| `couchdb` | `celery.backends.couchdb:CouchBackend` |
| `cosmosdbsql` | `celery.backends.cosmosdbsql:CosmosDBSQLBackend` |
| `riak` | `celery.backends.riak:RiakBackend` (no such module ships in `celery/backends`) |
| `file` | `celery.backends.filesystem:FilesystemBackend` |
| `disabled` | `celery.backends.base:DisabledBackend` |
| `consul` | `celery.backends.consul:ConsulBackend` |
| `dynamodb` | `celery.backends.dynamodb:DynamoDBBackend` |
| `azureblockblob` | `celery.backends.azureblockblob:AzureBlockBlobBackend` |
| `arangodb` | `celery.backends.arangodb:ArangoDbBackend` |
| `s3` | `celery.backends.s3:S3Backend` |
| `gs` | `celery.backends.gcs:GCSBackend` |

Sources: [celery/app/backends.py:15-38](repo://celery/app/backends.py#L15-L38)

## Storing results

### store_result and the retry loop

`store_result` first runs `encode_result`: exceptions in an exception state go through `prepare_exception`, everything else through `prepare_value` (which turns a `ResultBase` into a tuple unless the serializer is pickle). It then calls the subclass's `_store_result` inside `_ensure_retryable`. When `result_backend_always_retry` is on and the subclass's `exception_safe_to_retry` returns true, the call is retried up to `result_backend_max_retries` times with exponential backoff between `result_backend_base_sleep_between_retries_ms` and `result_backend_max_sleep_between_retries_ms`, calling `on_backend_retryable_error` before each sleep. Otherwise the error is re-raised as `BackendStoreError` carrying the `task_id` and `state`.

Sources: [celery/backends/base.py:573-576](repo://celery/backends/base.py#L573-L576), [celery/backends/base.py:635-693](repo://celery/backends/base.py#L635-L693), [celery/backends/base.py:157-161](repo://celery/backends/base.py#L157-L161)

By default `exception_safe_to_retry` returns `False`, so retrying is opt-in per backend: each store decides which of its client's exceptions are transient.

Sources: [celery/backends/base.py:732-744](repo://celery/backends/base.py#L732-L744)

### The mark_as helpers

The worker reports state transitions through these methods rather than calling `store_result` directly, because they also drive chords, chains and errbacks.

Sources: [celery/backends/base.py:176-252](repo://celery/backends/base.py#L176-L252)

| Method | Stored state | Extra work |
| --- | --- | --- |
| `mark_as_started` | `STARTED` | none |
| `mark_as_done` | `SUCCESS` | skips storing when `request.ignore_result`; calls `on_chord_part_return` if `request.chord` |
| `mark_as_failure` | `FAILURE` | chord part return, propagates the failure to every task in `request.chain`, calls errbacks |
| `mark_as_revoked` | `REVOKED` | stores a `TaskRevokedError(reason)`; chord part return |
| `mark_as_retry` | `RETRY` | stores the exception and traceback |

Sources: [celery/backends/base.py:176-199](repo://celery/backends/base.py#L176-L199), [celery/backends/base.py:306-323](repo://celery/backends/base.py#L306-L323)

`mark_as_failure` walks the remaining chain so that the last element, whose result the caller is waiting on, does not stay `PENDING` forever. For each chain element it rebuilds a `Context` from the signature's options, stores the failure under that element's `task_id` when the state is in `PROPAGATE_STATES`, calls `on_chord_part_return` if the element belongs to a chord, and when the element is itself a chord, queues the chord body so the failure reaches the body's result.

Sources: [celery/backends/base.py:200-252](repo://celery/backends/base.py#L200-L252)

`_call_task_errbacks` calls an errback directly with `(request, exc, traceback)` when its task function takes more than one argument; errbacks that take only a task id, or that are not registered in this worker, are grouped and sent as tasks with the failed task's id, applied eagerly when `task_always_eager` or the request is eager.

Sources: [celery/backends/base.py:254-304](repo://celery/backends/base.py#L254-L304)

### Result metadata and result_extended

`_get_result_meta` builds the dictionary every backend stores: `status`, `result`, `traceback`, `children` (the current request's child results as tuples), `date_done` for ready states, plus `group_id` and `parent_id` when the request has them. With `result_extended` enabled it also records `name`, `args`, `kwargs`, `worker`, `retries`, `queue` (the routing key) and any stamps; with `encode=True` the `args` and `kwargs` are serialized to bytes first, which column-based stores such as the database backend need.

Sources: [celery/backends/base.py:581-630](repo://celery/backends/base.py#L581-L630)

## Reading results

`get_task_meta` first warns when `task_always_eager` is on without `task_store_eager_result`, then checks the in-process `LRUCache` (sized by `result_cache_max`; the default `-1` disables it with a `_nulldict`), then calls `_get_task_meta_for` under the retry loop, failing with `BackendGetMetaError`. Only `SUCCESS` metadata is cached, so pending tasks are always re-read. `get_state`, `get_result`, `get_traceback` and `get_children` are thin readers of that dictionary; `reload_task_result` bypasses the cache.

Sources: [celery/backends/base.py:146-148](repo://celery/backends/base.py#L146-L148), [celery/app/defaults.py:205-212](repo://celery/app/defaults.py#L205-L212), [celery/backends/base.py:702-772](repo://celery/backends/base.py#L702-L772)

Groups follow the same pattern through `save_group`, `get_group_meta`/`restore_group` and `delete_group`, which delegate to `_save_group`, `_restore_group` and `_delete_group`. `forget` drops the cached entry and calls `_forget`, which the base class leaves unimplemented.

Sources: [celery/backends/base.py:695-700](repo://celery/backends/base.py#L695-L700), [celery/backends/base.py:785-818](repo://celery/backends/base.py#L785-L818)

`SyncBackendMixin.wait_for` is the polling loop used by `AsyncResult.get` on synchronous backends: it reads the metadata every `interval` seconds until the state is ready, calling `on_interval` each pass and raising `TimeoutError` once `timeout` elapses. `wait_for_pending` wraps it, rejects an `on_message` callback, and fills the result's cache before `maybe_throw`. `iter_native` feeds a `ResultSet` through `get_many`.

Sources: [celery/backends/base.py:879-954](repo://celery/backends/base.py#L879-L954)

## Serialization and exceptions

### Encoding payloads

The serializer comes from `result_serializer` unless passed explicitly, and `encode`/`decode` use kombu's `dumps`/`loads` with it. Accepted content types follow the precedence `accept` argument, then `result_accept_content`, then `accept_content`. `decode_result` decodes and then, for exception states, converts the stored result back into an exception with `exception_to_python`.

Sources: [celery/backends/base.py:143-155](repo://celery/backends/base.py#L143-L155), [celery/backends/base.py:534-556](repo://celery/backends/base.py#L534-L556)

### Exception round trip

With the `pickle` serializer exceptions are stored as pickleable exception objects. With any other serializer `prepare_exception` stores a dictionary.

Sources: [celery/backends/base.py:38-38](repo://celery/backends/base.py#L38-L38), [celery/backends/base.py:447-451](repo://celery/backends/base.py#L447-L451)

```python
return {'exc_type': getattr(exctype, '__qualname__', exctype.__name__),
        'exc_message': ensure_serializable(exc.args, self.encode),
        'exc_module': exctype.__module__}
```

Sources: [celery/backends/base.py:447-455](repo://celery/backends/base.py#L447-L455)

`exception_to_python` reverses this. It looks the module up in `sys.modules` (it does not import it) and walks the dotted `exc_type`; when the class cannot be found it synthesises one with `create_exception_cls` under `celery.exceptions`. If what it found is not a `BaseException` subclass it raises `SecurityError`, which stops a forged result such as `exc_module="os", exc_type="system"` from calling arbitrary functions. If the class's constructor rejects the stored arguments, a plain `Exception` describing the call is returned instead.

Sources: [celery/backends/base.py:457-526](repo://celery/backends/base.py#L457-L526)

## Key/value stores

### Key layout

`BaseKeyValueStoreBackend` names keys `celery-task-meta-<id>`, `celery-taskset-meta-<id>` for groups and `chord-unlock-<id>` for chord counters. A `global_keyprefix` in `result_backend_transport_options` is prepended to all three, with `_` added unless it already ends in `:`, `_`, `-` or `.`. Keys are bytes by default (`key_t = ensure_bytes`); subclasses such as Redis override `key_t`.

Sources: [celery/backends/base.py:964-1044](repo://celery/backends/base.py#L964-L1044)

### Subclass contract

A subclass implements `get`, `set`, `delete`, and optionally `mget` (for `get_many`), `incr` (for chords) and `expire`. `_store_result` builds the metadata, reads the current value and returns without writing if it is already `SUCCESS`, so a duplicated or lost task cannot overwrite a finished result. `_get_task_meta_for` returns `{'status': PENDING, 'result': None}` when the key is missing, and `task_result_exists` checks the key itself.

Sources: [celery/backends/base.py:1000-1019](repo://celery/backends/base.py#L1000-L1019), [celery/backends/base.py:1113-1169](repo://celery/backends/base.py#L1113-L1169)

`get_many` first yields ready results from the cache, then loops `mget` over the remaining keys, keeps only ready states, updates the cache and yields each result, sleeping `interval` between passes until all ids are done, `timeout` expires, or `max_iterations` is reached.

Sources: [celery/backends/base.py:1054-1111](repo://celery/backends/base.py#L1054-L1111)

## Chords

### apply_chord and chord_unlock

`apply_chord` calls `ensure_chords_allowed` (which `DisabledBackend` overrides to raise `E_CHORD_NO_BACKEND`) and then `fallback_chord_unlock`, which sends the built-in `celery.chord_unlock` task with the header's result tuples. That task polls the header group until it is ready; its queue is the body's `queue` option, the body task's queue, or the router's choice, and its priority comes from the body the same way. A key/value backend with `implements_incr = True` replaces `apply_chord` with `_apply_chord_incr`, which only saves the header `GroupResult` and lets each header task count itself in.

Sources: [celery/backends/base.py:838-867](repo://celery/backends/base.py#L838-L867), [celery/backends/base.py:977-978](repo://celery/backends/base.py#L977-L978), [celery/backends/base.py:1183-1186](repo://celery/backends/base.py#L1183-L1186)

### Counting header completions

```mermaid
flowchart TD
  A["mark_as_done / mark_as_failure"] --> B["on_chord_part_return"]
  B --> C{"implements_incr and request.group?"}
  C -->|no| Z["return"]
  C -->|yes| D["GroupResult.restore(gid)"]
  D -->|error or missing| E["chord_error_from_stack"]
  D --> F["incr(chord key)"]
  F --> G{"val vs chord_size"}
  G -->|"val < size"| H["expire(key, expires)"]
  G -->|"val == size"| I["join header results"]
  I -->|ok| J["callback.delay(ret)"]
  I -->|error| E
  J --> K["deps.delete() and delete(key)"]
```

Sources: [celery/backends/base.py:1188-1256](repo://celery/backends/base.py#L1188-L1256)

Each header task's `on_chord_part_return` increments the chord counter. The expected size is `chord_size` from the request, or the number of tasks in the restored group. When the counter reaches it, the header is joined with `join_native` where available under `result_chord_join_timeout`, and the body is sent with the collected results. A failing dependency, or an error sending the callback, becomes a `ChordError` whose `__cause__` is the original exception.

Sources: [celery/backends/base.py:68-77](repo://celery/backends/base.py#L68-L77), [celery/backends/base.py:1215-1256](repo://celery/backends/base.py#L1215-L1256)

### Chord errors

`chord_error_from_stack` locates the body task's own backend, builds a fake request with the body's `link_error` errbacks, calls them, and marks the body failed with `fail_from_current_stack`, generating a task id first if the body has none. When the body is a `group`, `_handle_group_chord_error` freezes it, revokes every member, calls errbacks and marks each member and the group itself failed with the original exception, so the group's tasks do not hang waiting.

Sources: [celery/backends/base.py:326-445](repo://celery/backends/base.py#L326-L445)

## Expiry and the disabled backend

`prepare_expires` defaults to `result_expires`, converts a `timedelta` to seconds and optionally casts it with `expires_type`. Backends use `self.expires` as a TTL; the base key/value class uses it to refresh the chord counter on every part return.

Sources: [celery/backends/base.py:150-150](repo://celery/backends/base.py#L150-L150), [celery/backends/base.py:558-565](repo://celery/backends/base.py#L558-L565)

`DisabledBackend`, the default when no backend is configured, silently discards `store_result` but makes every read (`get_state`, `get_result`, `wait_for`, `get_many` and the others) raise `NotImplementedError` with "No result backend is configured", and refuses chords.

Sources: [celery/backends/base.py:48-60](repo://celery/backends/base.py#L48-L60), [celery/backends/base.py:1263-1281](repo://celery/backends/base.py#L1263-L1281)

> [!NOTE]
> A group chained with a task is upgraded to a chord, so it also needs a backend that supports chords.

Sources: [celery/backends/base.py:53-60](repo://celery/backends/base.py#L53-L60)
