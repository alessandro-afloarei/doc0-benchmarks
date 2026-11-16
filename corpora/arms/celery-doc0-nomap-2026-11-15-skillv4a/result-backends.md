---
title: "Result Backends"
---
## Overview

A result backend stores what workers report about tasks, their state, return value or exception, traceback and children, so that callers and other tasks can read it. It is also where chords are coordinated. Every backend subclasses `celery.backends.base.Backend`; the app creates one from the `result_backend` URL on first use of `app.backend`. Workers write through `mark_as_done`, `mark_as_failure` and their siblings ([[Task Execution and Tracing]] shows when), and callers read through `get_task_meta` behind `AsyncResult` ([[Task Results]]). This page follows the write and read paths through the base classes, explains how chords complete in each kind of backend, and ends with a catalogue of the built-in backends.

Sources: [celery/backends/base.py:108-165](repo://celery/backends/base.py#L108-L165), [celery/app/base.py:1224-1228](repo://celery/app/base.py#L1224-L1228)

## Selecting a backend

`backends.by_url(result_backend)` takes the scheme of a URL such as `redis://localhost/0` as the backend name. A scheme with a `+`, such as `db+postgresql://...`, names the backend before the `+` and passes the rest as the URL. `by_name` resolves the name through `BACKEND_ALIASES`, the loader's `override_backends`, and any class registered under the `celery.result_backends` entry point, and accepts a dotted class path as well. An unknown name, or a name that resolves to a module, raises `ImproperlyConfigured`; no setting at all selects `disabled`.

Sources: [celery/app/backends.py:15-69](repo://celery/app/backends.py#L15-L69)

`DisabledBackend` accepts `store_result` silently, so tasks still run, but every read raises `NotImplementedError` and `ensure_chords_allowed` refuses chords.

Sources: [celery/backends/base.py:1263-1281](repo://celery/backends/base.py#L1263-L1281)

## The Backend base class

The constructor reads its settings from the app: `result_serializer` for encoding, `result_cache_max` for an LRU cache of finished results (`-1` disables caching), `result_expires` for expiry, and the accepted content types (the `accept` argument, then `result_accept_content`, then `accept_content`). It also reads the retry settings described below and `result_backend_thread_safe`, which decides whether the app shares one instance between threads.

Sources: [celery/backends/base.py:138-165](repo://celery/backends/base.py#L138-L165), [celery/app/base.py:1550-1556](repo://celery/app/base.py#L1550-L1556)

Class attributes describe what a backend can do, and other code checks them.

Sources: [celery/backends/base.py:108-136](repo://celery/backends/base.py#L108-L136)

| Attribute | Effect when true |
| --- | --- |
| `supports_native_join` | `ResultSet.get()` uses `join_native` and `get_many` instead of polling each result |
| `supports_autoexpire` | The backend expires results itself; beat does not schedule `celery.backend_cleanup` |
| `implements_incr` | Key/value chords use an atomic counter instead of `celery.chord_unlock` |
| `persistent` | Results survive a broker or server restart by default |
| `is_async` | Results are pushed to a `ResultConsumer` instead of polled |

Sources: [celery/backends/base.py:118-129](repo://celery/backends/base.py#L118-L129), [celery/backends/base.py:969-978](repo://celery/backends/base.py#L969-L978), [celery/beat.py:269-277](repo://celery/beat.py#L269-L277)

## Writing results

### The mark_as methods

The worker never calls `store_result` directly for final states; it calls the `mark_as_*` methods, which add the side effects that belong to each state.

Sources: [celery/backends/base.py:176-180](repo://celery/backends/base.py#L176-L180)

- `mark_as_started` stores `STARTED` with the worker pid and hostname.
- `mark_as_done` stores the value unless the request says to ignore results, then calls `on_chord_part_return` if the task is part of a chord.
- `mark_as_failure` stores the exception and traceback, calls `on_chord_part_return`, marks every remaining step of the request's chain as failed too (descending into chord bodies) so nobody waits forever on a later step, and finally runs the task's errbacks.
- `mark_as_revoked` stores a `TaskRevokedError` and notifies the chord; `mark_as_retry` stores the retry exception.

Sources: [celery/backends/base.py:176-252](repo://celery/backends/base.py#L176-L252), [celery/backends/base.py:306-323](repo://celery/backends/base.py#L306-L323)

Errbacks are called in one of two ways. An errback task whose signature takes more than one argument is called inline in the worker as `errback(request, exc, traceback)`. Errbacks that take a single argument, or are not registered in this worker, are sent as a group of tasks with the failed task's id as their argument.

Sources: [celery/backends/base.py:254-304](repo://celery/backends/base.py#L254-L304)

### Encoding

`store_result` encodes the value with `encode_result` and calls the backend's `_store_result` under `_ensure_retryable`. Exceptions in `FAILURE`, `RETRY` and `REVOKED` states are converted by `prepare_exception`: pickled with the pickle serializer, otherwise stored as `{exc_type, exc_message, exc_module}`. A result object returned by a task is stored as its tuple form. `_get_result_meta` builds the stored dict: `status`, `result`, `traceback`, `children` (the results of tasks this task started), `date_done` for ready states, `group_id`, `parent_id`, and, when `result_extended` is on, the task `name`, `args`, `kwargs`, `worker`, `retries`, `queue` and stamps.

Sources: [celery/backends/base.py:447-456](repo://celery/backends/base.py#L447-L456), [celery/backends/base.py:528-631](repo://celery/backends/base.py#L528-L631), [celery/backends/base.py:673-693](repo://celery/backends/base.py#L673-L693)

Reading an exception back, `exception_to_python` imports the class from `exc_module` and walks a qualified `exc_type`, falling back to a generated class of that name when it cannot be found. It raises `SecurityError` when the resolved object is not an exception class, so a crafted result such as `exc_module='os'`, `exc_type='system'` cannot make the caller run a function.

Sources: [celery/backends/base.py:457-526](repo://celery/backends/base.py#L457-L526)

## Reading results

`get_task_meta(task_id)` returns the cached meta if present, otherwise calls the backend's `_get_task_meta_for` under the retry wrapper, and caches it only when the state is `SUCCESS`. `get_state`, `get_result`, `get_traceback` and `get_children` read single fields from it. Group metadata follows the same pattern through `save_group`, `restore_group` and `delete_group`, which [[Task Results]] uses for `GroupResult.save()` and `restore()`. Reading with `task_always_eager` on and `task_store_eager_result` off issues a `RuntimeWarning`, because nothing was stored.

Sources: [celery/backends/base.py:702-818](repo://celery/backends/base.py#L702-L818)

Synchronous backends wait by polling: `wait_for` calls `get_task_meta` every `interval` seconds until the state is ready or `timeout` passes, and `iter_native` uses `get_many` for groups. [[Task Results]] covers the asynchronous alternative.

Sources: [celery/backends/base.py:879-955](repo://celery/backends/base.py#L879-L955)

## Retrying backend operations

`_ensure_retryable` wraps every store, read, forget and group operation. It retries only when `result_backend_always_retry` is on and the backend's `exception_safe_to_retry(exc)` says the error is transient. The wait grows exponentially from `result_backend_base_sleep_between_retries_ms` (10 ms) to at most `result_backend_max_sleep_between_retries_ms` (10 s) with full jitter, up to `result_backend_max_retries` (unlimited by default). Before each retry it calls the `on_backend_retryable_error` hook. When retries run out, stores raise `BackendStoreError` and reads `BackendGetMetaError`.

Sources: [celery/backends/base.py:632-671](repo://celery/backends/base.py#L632-L671), [celery/backends/base.py:732-744](repo://celery/backends/base.py#L732-L744), [celery/app/defaults.py:221-229](repo://celery/app/defaults.py#L221-L229)

## Key/value backends

### Keys and storage

Most backends only need to store blobs by key. `BaseKeyValueStoreBackend` implements the whole protocol on five primitives a subclass provides, `get`, `mget`, `set`, `delete` and optionally `incr` and `expire`. Task results live under `celery-task-meta-<id>`, groups under `celery-taskset-meta-<id>`, and chord counters under `chord-unlock-<id>`; a `global_keyprefix` in `result_backend_transport_options` is prepended to all three.

Sources: [celery/backends/base.py:964-1052](repo://celery/backends/base.py#L964-L1052)

`_store_result` reads the current meta first and does nothing if it is already `SUCCESS`. A worker that lost a task and runs it again therefore cannot overwrite a successful result with a later failure. A missing key reads as `PENDING`. `get_many` serves cached ready results first, then calls `mget` for the rest in rounds of `interval` seconds, yielding each result as it becomes ready and raising `TimeoutError` after `timeout`.

Sources: [celery/backends/base.py:1075-1181](repo://celery/backends/base.py#L1075-L1181)

### Chords with a counter

When `implements_incr` is true, the constructor replaces `apply_chord` with `_apply_chord_incr`, which saves the group so that any worker can restore it. Each finishing header task increments the chord counter. The task that makes it equal to the chord size (sent with the chord, or the group's length) joins the results, sends the body, and deletes the group and counter; one that has not reached it just refreshes the counter's expiry. A group that cannot be restored, or a header failure, ends in `chord_error_from_stack`, which marks the body as failed with a `ChordError`. Backends without `incr` fall back to the `celery.chord_unlock` polling task, as [[Canvas: Chains, Groups and Chords]] describes.

Sources: [celery/backends/base.py:1183-1257](repo://celery/backends/base.py#L1183-L1257), [celery/backends/base.py:325-358](repo://celery/backends/base.py#L325-L358)

## Redis

`RedisBackend` is a key/value backend with `supports_native_join` and `supports_autoexpire`, plus an asynchronous `ResultConsumer`. Its `set` writes the value with `SETEX` (or `SET` without expiry) and `PUBLISH`es it on a channel named after the key in the same pipeline, and refuses values over 512 MB. The consumer subscribes to a task's channel in `on_task_call`, before the task is sent, and unsubscribes when the result is ready or forgotten. Before blocking, `on_wait_for_pending` reads the stored value once, in case the result was published before the subscription.

Sources: [celery/backends/redis.py:204-225](repo://celery/backends/redis.py#L204-L225), [celery/backends/redis.py:526-552](repo://celery/backends/redis.py#L526-L552), [celery/backends/redis.py:134-201](repo://celery/backends/redis.py#L134-L201), [celery/backends/redis.py:501-503](repo://celery/backends/redis.py#L501-L503)

Chords in Redis are counted per group with three keys: `<group>.j` holds the encoded header results, `<group>.s` the chord size written by `set_chord_size`, and `<group>.t` extra tasks added with `add_to_chord`. Each part adds its `[1, task_id, state, result]` in one pipeline, by default to a sorted set scored by `group_index` so the results keep header order (`result_chord_ordered: False` in the transport options uses a list instead). The part that brings the count to size plus extras sends the body with the decoded results, or joins a saved `GroupResult` when the header contained nested groups, then deletes the three keys. A failed dependency raises a `ChordError` that marks the body as failed.

Sources: [celery/backends/redis.py:554-592](repo://celery/backends/redis.py#L554-L592), [celery/backends/redis.py:593-686](repo://celery/backends/redis.py#L593-L686)

`SentinelBackend` (`sentinel://`) is the same backend connecting through Redis Sentinel, with several Sentinel addresses separated by `;` in the URL.

Sources: [celery/backends/redis.py:727-800](repo://celery/backends/redis.py#L727-L800)

## RPC

`RPCBackend` (`rpc://`) sends each result as an AMQP message back to the client that sent the task, instead of storing it. `store_result` publishes `{task_id, status, result, traceback, children}` to the request's `reply_to` with its `correlation_id`. Each client process has one reply queue named after the app's thread oid, declared in `on_task_call` before the task is sent and auto-deleted when unused.

Sources: [celery/backends/rpc.py:147-160](repo://celery/backends/rpc.py#L147-L160), [celery/backends/rpc.py:205-280](repo://celery/backends/rpc.py#L205-L280), [celery/backends/rpc.py:390-401](repo://celery/backends/rpc.py#L390-L401)

The consequences follow from that design: only the client that sent a task can read its result, results are transient by default (`persistent = False`), and group storage and chords are not supported (`ensure_chords_allowed` and the group methods raise). A message for a result nobody is waiting on is kept in an out-of-band buffer until it is asked for.

Sources: [celery/backends/rpc.py:214-215](repo://celery/backends/rpc.py#L214-L215), [celery/backends/rpc.py:282-322](repo://celery/backends/rpc.py#L282-L322), [celery/backends/rpc.py:359-374](repo://celery/backends/rpc.py#L359-L374)

## Database

`DatabaseBackend` (`db+<sqlalchemy-url>`) stores results with SQLAlchemy in the `celery_taskmeta` and `celery_tasksetmeta` tables, with an extended task model when `result_extended` is on. It raises `ImproperlyConfigured` without a URL. Table names and schemas come from `database_table_names` and `database_table_schemas`, engine options from `database_engine_options`, and an optional `database_engine_callback` can adjust the engine. Unlike other backends it retries by default (three times), and on a retryable database error it invalidates the session so the next attempt reconnects. It does not expire rows itself: `cleanup()` deletes rows older than `result_expires`, and beat schedules `celery.backend_cleanup` daily at 4:00 to call it.

Sources: [celery/backends/database/__init__.py:45-125](repo://celery/backends/database/__init__.py#L45-L125), [celery/backends/database/__init__.py:237-250](repo://celery/backends/database/__init__.py#L237-L250), [celery/backends/database/models.py:27-40](repo://celery/backends/database/models.py#L27-L40), [celery/beat.py:269-277](repo://celery/beat.py#L269-L277)

## Backend catalogue

### Built-in backends

| Scheme | Class | Notes |
| --- | --- | --- |
| `redis://`, `rediss://` | `RedisBackend` | Pub/sub results, native join, native chords, auto-expiry |
| `sentinel://` | `SentinelBackend` | Redis through Sentinel |
| `rpc://` | `RPCBackend` | Results as AMQP replies to the sender; no chords |
| `db+...`, `database` | `DatabaseBackend` | SQLAlchemy tables; daily cleanup task |
| `cache+...` | `CacheBackend` | Memcached or in-memory cache; `incr` chords, auto-expiry |
| `mongodb://` | `MongoBackend` | MongoDB collections |
| `cassandra://` | `CassandraBackend` | Cassandra with TTL expiry |
| `elasticsearch://` | `ElasticsearchBackend` | Elasticsearch documents |
| `couchbase://` | `CouchbaseBackend` | Couchbase with expiry |
| `couchdb://` | `CouchBackend` | CouchDB documents |
| `consul://` | `ConsulBackend` | Consul key/value with expiry |
| `dynamodb://` | `DynamoDBBackend` | DynamoDB with TTL; `incr` chords |
| `s3://` | `S3Backend` | Objects in an S3 bucket |
| `gs://` | `GCSBackend` | Google Cloud Storage; `incr` chords, native join |
| `azureblockblob://` | `AzureBlockBlobBackend` | Azure Blob Storage |
| `cosmosdbsql://` | `CosmosDBSQLBackend` | Azure Cosmos DB (SQL API) |
| `arangodb://` | `ArangoDbBackend` | ArangoDB documents |
| `file://` | `FilesystemBackend` | Files in a shared directory |
| `disabled` | `DisabledBackend` | No results |

Sources: [celery/app/backends.py:15-38](repo://celery/app/backends.py#L15-L38), [celery/backends/cache.py:90-96](repo://celery/backends/cache.py#L90-L96), [celery/backends/dynamodb.py:29-66](repo://celery/backends/dynamodb.py#L29-L66), [celery/backends/gcs.py:161-168](repo://celery/backends/gcs.py#L161-L168), [celery/backends/cassandra.py:71-86](repo://celery/backends/cassandra.py#L71-L86)

### Choosing one

Pick Redis when callers wait on results and workflows use chords: it pushes results instead of polling and completes chords without extra tasks. RPC suits request/reply use where only the sender reads the result and no chord is involved. Pick the database, document stores or object stores when results must be durable or queried later, and set `result_extended` to keep task names and arguments with them. Backends without `supports_native_join` read groups one result at a time, and backends without `implements_incr` or a native chord implementation complete chords through the polling `celery.chord_unlock` task.

Sources: [celery/backends/redis.py:220-221](repo://celery/backends/redis.py#L220-L221), [celery/backends/rpc.py:157-159](repo://celery/backends/rpc.py#L157-L159), [celery/backends/base.py:838-866](repo://celery/backends/base.py#L838-L866)

### Writing a backend

A new key/value backend subclasses `KeyValueStoreBackend` and implements `get`, `mget`, `set` and `delete`; implementing `incr` and setting `implements_incr = True` enables counter chords, and `expire` plus `supports_autoexpire` removes the need for the cleanup task. Override `exception_safe_to_retry` to make transient errors retryable. Register the class under the `celery.result_backends` entry point to make its name usable in `result_backend` URLs.

Sources: [celery/backends/base.py:1000-1019](repo://celery/backends/base.py#L1000-L1019), [celery/backends/base.py:1259-1260](repo://celery/backends/base.py#L1259-L1260), [celery/app/backends.py:40-55](repo://celery/app/backends.py#L40-L55)
