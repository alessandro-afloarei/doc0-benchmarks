---
title: "Task Results, States and Result Backends"
---
## Overview

A task's state and return value are stored in a result backend, keyed by the task id. The producer holds only an `AsyncResult(id)` and asks the backend when it needs the outcome. This page covers the state vocabulary, how workers write results (`Backend.mark_as_*` and `store_result`), how clients read them (`AsyncResult`, `ResultSet`, `GroupResult`), how a backend is chosen from a URL, and the built-in backends. How `chord` completion uses the backend is in [[Canvas: Signatures, Chains, Groups and Chords]]; the call that stores results from a worker is in [[Task Execution, Tracing and Acknowledgement]].

Sources: [celery/result.py:70-102](repo://celery/result.py#L70-L102), [celery/backends/base.py:108-137](repo://celery/backends/base.py#L108-L137)

## Task states

`celery.states` defines the state strings and the sets that group them:

| Set | Members |
| --- | --- |
| `READY_STATES` | `SUCCESS`, `FAILURE`, `REVOKED` |
| `UNREADY_STATES` | `PENDING`, `RECEIVED`, `STARTED`, `REJECTED`, `RETRY` |
| `EXCEPTION_STATES` | `RETRY`, `FAILURE`, `REVOKED` |
| `PROPAGATE_STATES` | `FAILURE`, `REVOKED` |

Sources: [celery/states.py:127-150](repo://celery/states.py#L127-L150)

`IGNORED` is also defined as a state string. `precedence` orders states for comparison, from highest to lowest: `SUCCESS`, `FAILURE`, unknown, `REVOKED`, `STARTED`, `RECEIVED`, `REJECTED`, `RETRY`, `PENDING`.

Sources: [celery/states.py:64-76](repo://celery/states.py#L64-L76), [celery/states.py:127-150](repo://celery/states.py#L127-L150)

A task that has no stored entry is reported as `PENDING`, which is why `PENDING` cannot tell an unsent task from an unfinished one. `AsyncResult.exists()` asks the backend whether any result is stored.

Sources: [celery/backends/base.py:1148-1153](repo://celery/backends/base.py#L1148-L1153), [celery/result.py:351-367](repo://celery/result.py#L351-L367)

## Writing results

Workers write through methods on `Backend`. `mark_as_started`, `mark_as_done`, `mark_as_failure`, `mark_as_retry` and `mark_as_revoked` all end in `store_result(task_id, result, state, traceback, request)`. `mark_as_done` skips the write when the request says to ignore the result, and then calls `on_chord_part_return` if the request belongs to a chord. `mark_as_failure` also propagates the failure along the request's chain and chord and fires error callbacks; see [[Canvas: Signatures, Chains, Groups and Chords]].

Sources: [celery/backends/base.py:176-253](repo://celery/backends/base.py#L176-L253), [celery/backends/base.py:306-324](repo://celery/backends/base.py#L306-L324)

`store_result` encodes the value (an exception is turned into a serialisable form by `prepare_exception`), then runs the backend-specific `_store_result` inside `_ensure_retryable`. That helper retries only when the setting `result_backend_always_retry` is on and the backend says the exception is safe to retry; each retry sleeps with exponential backoff between `result_backend_base_sleep_between_retries_ms` and `result_backend_max_sleep_between_retries_ms`, up to `result_backend_max_retries`. When retries are exhausted it raises the fallback `BackendStoreError`; with retry off the error propagates at once.

Sources: [celery/backends/base.py:138-165](repo://celery/backends/base.py#L138-L165), [celery/backends/base.py:635-693](repo://celery/backends/base.py#L635-L693), [celery/backends/base.py:447-456](repo://celery/backends/base.py#L447-L456)

The stored record is built by `_get_result_meta`: `status`, `result`, `traceback`, `children`, and `date_done` (set only for ready states), plus `group_id` and `parent_id` when the request has them. When the `result_extended` setting is on, it adds the task `name`, `args`, `kwargs`, `worker`, `retries`, `queue` and any stamps.

Sources: [celery/backends/base.py:581-631](repo://celery/backends/base.py#L581-L631)

## Reading results

`AsyncResult` binds an id to a backend (the app's by default). Its status properties go through `_get_task_meta`, which asks `backend.get_task_meta(id)` and caches the answer only when the state is ready, so a ready result is read from the backend once. `state`, `result`, `traceback` and `ready()` (state in `READY_STATES`) are views of that record; `successful()` and `failed()` compare the state to `SUCCESS` and `FAILURE`.

Sources: [celery/result.py:461-498](repo://celery/result.py#L461-L498), [celery/result.py:369-383](repo://celery/result.py#L369-L383), [celery/backends/base.py:746-768](repo://celery/backends/base.py#L746-L768)

`AsyncResult.get` returns at once for an ignored result. Otherwise it refuses to run inside a task (`assert_will_not_block`) unless `disable_sync_subtasks=False`, re-raises errors from parent tasks first when `follow_parents` is set, returns the cached value if there is one, and otherwise registers itself with the backend and calls `backend.wait_for_pending`. A state in `PROPAGATE_STATES` makes `maybe_throw` raise the stored exception (with a remote traceback when `task_remote_tracebacks` is on and `tblib` is available); `propagate=False` returns the exception instead.

Sources: [celery/result.py:191-270](repo://celery/result.py#L191-L270), [celery/result.py:388-401](repo://celery/result.py#L388-L401)

The wait is implemented differently by two kinds of backend:

Sources: [celery/backends/base.py:879-956](repo://celery/backends/base.py#L879-L956)

- **Polling** backends mix in `SyncBackendMixin`: `wait_for` calls `get_task_meta` in a loop, sleeping `interval` (0.5 s by default) between checks, until the state is ready or `timeout` is reached, which raises `TimeoutError`.
- **Push** backends mix in `AsyncBackendMixin` and own a result consumer. `add_pending_result` registers the result with the consumer and starts a drainer; messages for results nobody waits on yet are buffered; `wait_for_pending` drives the consumer's loop until the result is fulfilled. `is_async` is true.

Sources: [celery/backends/base.py:918-956](repo://celery/backends/base.py#L918-L956), [celery/backends/asynchronous.py:262-318](repo://celery/backends/asynchronous.py#L262-L318)

The `interval` argument therefore has no effect on the RPC and Redis backends, as the docstring on `get` says. `forget()` deletes the stored result; the docstring of `get` asks callers to call either `get()` or `forget()` on every `AsyncResult` so the backend can free resources.

Sources: [celery/result.py:136-143](repo://celery/result.py#L136-L143), [celery/result.py:198-212](repo://celery/result.py#L198-L212)

## Groups of results

`ResultSet` holds several `AsyncResult` objects. `join` gathers their values in order, calling `get` on each with the remaining share of the timeout; `join_native` and `iter_native` ask the backend for many results at once through `get_many`. `get` uses `join_native` when `supports_native_join` is true and `join` otherwise. The `join` docstring warns that this is expensive for polling backends such as the database. `GroupResult` adds an `id`, can be `save`d to and restored from the backend, and is what a `group` returns.

Sources: [celery/result.py:579-600](repo://celery/result.py#L579-L600), [celery/result.py:726-826](repo://celery/result.py#L726-L826), [celery/result.py:929-970](repo://celery/result.py#L929-L970)

## Choosing a backend

### How the backend is resolved

The app resolves its backend from the `result_backend` URL with `backends.by_url`. A URL with a scheme sets both the backend name and the URL; a scheme such as `db+postgresql://` splits at `+` so the part before it names the backend and the rest is the database URL. With no setting the name is `disabled`. `by_name` merges the built-in `BACKEND_ALIASES`, the loader's `override_backends`, and any class names registered under the `celery.result_backends` entry-point group, then resolves the name with `symbol_by_name`. A module instead of a class raises `ImproperlyConfigured`.

Sources: [celery/app/backends.py:11-69](repo://celery/app/backends.py#L11-L69), [celery/app/base.py:1224-1228](repo://celery/app/base.py#L1224-L1228)

`DisabledBackend` does not store anything: `store_result` is a no-op and reads raise `NotImplementedError` with a message saying that no backend is configured. Chords refuse to run on it.

Sources: [celery/backends/base.py:1263-1278](repo://celery/backends/base.py#L1263-L1278)

All backends share the `Backend` base: serializer from `result_serializer`, an LRU cache of results sized by `result_cache_max` (`-1` disables it), `result_expires`, `result_accept_content`, and the retry settings above. Three capability flags are declared per backend: `supports_native_join` (the backend implements `get_many`), `supports_autoexpire` (results expire on their own, so the daily `celery.backend_cleanup` task is not scheduled; see [[Beat: Periodic Task Scheduling]]) and `persistent`.

Sources: [celery/backends/base.py:108-165](repo://celery/backends/base.py#L108-L165), [celery/beat.py:268-277](repo://celery/beat.py#L268-L277)

### Key-value backends

Most backends subclass `KeyValueStoreBackend`, which turns the store into four primitives (`get`, `set`, `delete`, optionally `mget`, `incr` and `expire`) and provides everything else. Keys are `celery-task-meta-<id>`, `celery-taskset-meta-<id>` and `chord-unlock-<id>`, optionally prefixed by `global_keyprefix` from `result_backend_transport_options`. `_store_result` first reads the current record and returns without writing if the stored status is already `SUCCESS`, so a late update from a lost worker cannot overwrite a good result. A backend that sets `implements_incr = True` can count chord completions natively; see [[Canvas: Signatures, Chains, Groups and Chords]].

Sources: [celery/backends/base.py:964-1000](repo://celery/backends/base.py#L964-L1000), [celery/backends/base.py:1116-1137](repo://celery/backends/base.py#L1116-L1137), [celery/backends/base.py:1259-1260](repo://celery/backends/base.py#L1259-L1260)

### Built-in backends

| URL scheme | Class | Declared properties |
| --- | --- | --- |
| `redis`, `rediss` | `RedisBackend` | Key-value and async; `supports_autoexpire`, `supports_native_join`; uses GET, MGET, DEL, INCRBY, EXPIRE, SET and SETEX |
| `sentinel` | `SentinelBackend` | A `RedisBackend` subclass |
| `rpc` | `RPCBackend` | Results sent as messages to a per-client queue through `reply_to`; `persistent = False`, `supports_autoexpire`, `supports_native_join`; async |
| `cache` | `CacheBackend` | Memcached or in-memory; `supports_autoexpire`, `supports_native_join`, `implements_incr` |
| `db`, `database` | `DatabaseBackend` | SQLAlchemy; polling with `subpolling_interval = 0.5` |
| `mongodb` | `MongoBackend` | Collections `celery_taskmeta` and `celery_groupmeta`; `supports_autoexpire = False` |
| `file` | `FilesystemBackend` | Files in a directory given by the URL |
| `s3`, `gs`, `azureblockblob` | `S3Backend`, `GCSBackend`, `AzureBlockBlobBackend` | Object stores as key-value backends; GCS sets `supports_native_join` and `implements_incr` |
| `dynamodb` | `DynamoDBBackend` | `supports_autoexpire` and `implements_incr` |
| `cassandra` | `CassandraBackend` | `supports_autoexpire` via `entry_ttl` |
| `couchbase`, `couchdb`, `consul`, `elasticsearch`, `arangodb`, `cosmosdbsql` | one class each | Key-value backends; Couchbase and Consul declare `supports_autoexpire` |
| `disabled` | `DisabledBackend` | Stores nothing |

Sources: [celery/app/backends.py:13-33](repo://celery/app/backends.py#L13-L33), [celery/backends/redis.py:204-225](repo://celery/backends/redis.py#L204-L225), [celery/backends/rpc.py:147-160](repo://celery/backends/rpc.py#L147-L160), [celery/backends/cache.py:90-97](repo://celery/backends/cache.py#L90-L97), [celery/backends/database/__init__.py:45-52](repo://celery/backends/database/__init__.py#L45-L52), [celery/backends/mongodb.py:36-56](repo://celery/backends/mongodb.py#L36-L56)

Sources: [celery/backends/gcs.py:161-168](repo://celery/backends/gcs.py#L161-L168), [celery/backends/dynamodb.py:29-66](repo://celery/backends/dynamodb.py#L29-L66), [celery/backends/cassandra.py:71-87](repo://celery/backends/cassandra.py#L71-L87), [celery/backends/couchbase.py:23-38](repo://celery/backends/couchbase.py#L23-L38), [celery/backends/consul.py:27-33](repo://celery/backends/consul.py#L27-L33), [celery/backends/filesystem.py:25-35](repo://celery/backends/filesystem.py#L25-L35)

The `rpc` backend is the one the example app suggests (`backend='rpc'`). Its module docstring calls it an "RPC-style result backend, using reply-to and one queue per client", and the class declares `persistent = False`, so results are not stored durably the way they are in Redis, a database or an object store.

Sources: [celery/backends/rpc.py:1-5](repo://celery/backends/rpc.py#L1-L5), [celery/backends/rpc.py:147-160](repo://celery/backends/rpc.py#L147-L160), [examples/app/myapp.py:32-33](repo://examples/app/myapp.py#L32-L33)
