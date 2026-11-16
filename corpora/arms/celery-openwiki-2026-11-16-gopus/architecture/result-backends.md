---
type: architecture
title: Result Backends and AsyncResult
description: How Celery stores and retrieves task state and return values — backend selection by URL, the Backend and key/value base classes, retry policy, chord counting, the Redis and RPC asynchronous consumers, the database backend, and the AsyncResult/ResultSet/GroupResult client API.
tags: [backends, results, asyncresult, redis, rpc, database, chord]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:57:55.789Z
sources:
  - id: openwiki-source-c4ebf7fa0abfe9f2d1eabf61
    resource: repo://celery/app/backends.py
  - id: openwiki-source-ac404435efa758dad4bbfc83
    resource: repo://celery/app/defaults.py
  - id: openwiki-source-98fa58283cefff1b0e071bbe
    resource: repo://celery/backends/base.py
  - id: openwiki-source-780ad51e7477aa5e5ddbf3df
    resource: repo://celery/backends/database/__init__.py
  - id: openwiki-source-6b95f00dc919dfdb3eec1511
    resource: repo://celery/backends/redis.py
  - id: openwiki-source-a4d1ab266bef232afaa055d8
    resource: repo://celery/backends/rpc.py
  - id: openwiki-source-09faa18a62432ea5464530cc
    resource: repo://celery/concurrency/prefork.py
  - id: openwiki-source-33fca59793af7cfa460b223c
    resource: repo://celery/result.py
generated: { by: "claude-code", at: "2026-11-16T06:57:55.789Z" }
---

# Result Backends and AsyncResult

A *result backend* records each task's state (`PENDING` → `STARTED` →
`SUCCESS`/`FAILURE`/`RETRY`/`REVOKED`), return value or exception, traceback
and metadata, and implements chord synchronisation. The worker writes to it
from the [execution tracer](worker/task-execution-trace.md); clients read it
through `AsyncResult`. Results are optional — with no `result_backend` the
`DisabledBackend` is used and any attempt to read state raises.

## Selection

`app.backend` is created lazily from `result_backend` (or `app.backend_cls`)
by `celery.app.backends.by_url` (`celery/app/backends.py`):

- The URL scheme picks the class from `BACKEND_ALIASES` (`redis`, `rediss`,
  `sentinel`, `rpc`, `db`/`database`, `cache`, `mongodb`, `elasticsearch`,
  `cassandra`, `couchbase`, `couchdb`, `cosmosdbsql`, `file`, `consul`,
  `dynamodb`, `azureblockblob`, `arangodb`, `s3`, `gs`, `disabled`).
- A `+` in the scheme splits the alias from the real URL
  (`db+postgresql://...` → database backend with `postgresql://...`).
- Aliases can be extended through the loader's `override_backends` setting and
  the `celery.result_backends` entry-point namespace; a plain
  `module:Class` path also works.
- No backend → `'disabled'`.

Backend instances are cached per app; only if the backend sets
`thread_safe` (`result_backend_thread_safe`) is one instance shared across
threads, otherwise each thread gets its own.

## Class hierarchy

```
Backend                              # celery/backends/base.py
├── BaseBackend (+SyncBackendMixin)  # polling get/wait_for
│   ├── DatabaseBackend, MongoBackend, CassandraBackend, ...
│   └── DisabledBackend
├── BaseKeyValueStoreBackend         # get/set/mget/delete/incr/expire primitives
│   ├── KeyValueStoreBackend (+SyncBackendMixin)
│   │     CacheBackend, FilesystemBackend, S3, GCS, DynamoDB, Azure, Consul, ...
│   └── RedisBackend (+AsyncBackendMixin)  → SentinelBackend
└── RPCBackend (+AsyncBackendMixin)  # results as AMQP messages
```

### Backend (common behaviour)

- **Serialization.** `result_serializer` (default `json`) encodes results;
  `accept` comes from `result_accept_content`, falling back to
  `accept_content`. Exceptions are stored in a serializer-safe form by
  `prepare_exception` and rebuilt by `exception_to_python` (see
  [serialization](../integrations/security-and-serialization.md)).
- **Meta document.** `_get_result_meta` produces
  `{status, result, traceback, children, date_done, group_id?, parent_id?}`.
  With `result_extended=True` it also stores task `name`, `args`, `kwargs`,
  `worker`, `retries`, `queue` and stamps.
- **State transitions.** `mark_as_started/done/failure/retry/revoked` wrap
  `store_result`. `mark_as_failure` additionally (a) calls
  `on_chord_part_return` if the task is part of a chord, (b) walks the
  remaining `request.chain` and stores the failure on every downstream chain
  element that has an id — descending into a chord element's body — so
  waiters on the chain's final result and enclosing chords do not hang, and (c)
  fires errbacks.
- **Retry policy.** With `result_backend_always_retry`, `store_result`,
  `get_task_meta` and `forget` retry on errors the backend classifies as
  safe (`exception_safe_to_retry`) using exponential backoff between
  `result_backend_base_sleep_between_retries_ms` (10) and
  `result_backend_max_sleep_between_retries_ms` (10000), up to
  `result_backend_max_retries` (infinite), then raise
  `BackendStoreError`/`BackendGetMetaError`.
- **Local cache.** `get_task_meta` caches only `SUCCESS` metas, in an LRU of
  `result_cache_max` entries; the default `-1` disables caching.
- **Expiry.** `result_expires` defaults to one day. Backends with
  `supports_autoexpire` (Redis, RPC, ...) expire natively; for others beat
  schedules the built-in `celery.backend_cleanup` task, which calls
  `backend.cleanup()` (see [beat](beat-scheduler.md)).
- **Chords.** `apply_chord`, `on_chord_part_return`, `set_chord_size`,
  `add_to_chord` are hooks; the default `fallback_chord_unlock` schedules the
  polling `celery.chord_unlock` task. Details in
  [Canvas](../concepts/canvas.md).

### Key/value backends

`BaseKeyValueStoreBackend` maps ids to keys: `celery-task-meta-<id>`,
`celery-taskset-meta-<id>` (groups) and `chord-unlock-<id>` (chord counters).
A `global_keyprefix` in `result_backend_transport_options` is prepended to all
three.

- `_store_result` reads the current meta first and **never overwrites a stored
  `SUCCESS`** — this guards against a redelivered duplicate overwriting a good
  result after network partitions or lost workers.
- A missing key reads as `{'status': 'PENDING', 'result': None}`; Celery
  cannot distinguish "unknown id" from "not started yet" (use
  `task_result_exists` / `task_track_started` if this matters).
- If the store implements atomic `incr` (`implements_incr = True`), chords use
  a counter: `apply_chord` saves the header `GroupResult`, and every finishing
  header task's `on_chord_part_return` increments the counter; the call that
  reaches the chord size joins the header results (with
  `result_chord_join_timeout`, default 3 s), calls the body with them, and
  deletes the group and counter. Join errors call the body's errbacks via
  `chord_error_from_stack`.

### Redis

`RedisBackend` (`celery/backends/redis.py`):

- `set` writes with `SETEX` when `expires` is set, and **publishes** the
  value on a channel named after the key in the same pipeline; values larger
  than 512 MiB are rejected with `BackendStoreError`.
- Its `ResultConsumer` subscribes to the keys of pending results (pub/sub),
  so `AsyncResult.get()` is push-based rather than polling. It reconnects and
  re-subscribes after connection errors and resets after fork.
- Chords use a native implementation: each header result is appended to a
  sorted set `<group>.j` (scored by `group_index`, so results keep header
  order; `result_chord_ordered` transport option, default true) or a list,
  while `<group>.s` stores the chord size and `<group>.t` extra
  `add_to_chord` additions. When the ready count equals size + additions the
  body is called with the decoded results, and the keys are deleted.
- `SentinelBackend` resolves the master through Redis Sentinel.

### RPC

`RPCBackend` (`celery/backends/rpc.py`, URL `rpc://`) sends each result as a
message to the *client's* reply queue instead of storing it:

- `on_task_call` declares the caller's reply queue before publishing the task
  (skipped inside prefork children where it is already declared), and the
  task message carries `reply_to` / `correlation_id`.
- `store_result` publishes `{task_id, status, result, traceback, children}`
  to `request.reply_to` on `result_exchange` (default `celeryresults`); if
  there is no `reply_to` nothing is stored.
- Results are transient (`persistent=False` by default) and can only be read
  by the client that sent the task, once. Groups/chords are not supported
  (`ensure_chords_allowed` raises `NotImplementedError`), nor are
  `save_group`/`restore_group`.

### Database

`DatabaseBackend` (`celery/backends/database/`) stores results with
SQLAlchemy in `celery_taskmeta` (`Task` / `TaskExtended` model) and groups in
`celery_tasksetmeta` (`TaskSet`). Table names and engine options are
configurable through the `database_*` settings. `cleanup()` deletes rows whose
`date_done` is older than `result_expires`.

## Client API (`celery/result.py`)

- **`AsyncResult(id)`** – `state`/`status`, `result`, `info`,
  `traceback`, `ready()`, `successful()`, `failed()`, `get()`,
  `forget()`, `revoke()`, `parent`, `children`, `collect()`, `then()`.
  `get(timeout, propagate=True, interval=0.5, follow_parents=True,
  disable_sync_subtasks=True)` registers the result with the backend
  (`add_pending_result`) and waits: polling with `interval` on sync backends,
  draining pub/sub or reply messages on async ones. If `propagate`, a failed
  result re-raises the original exception; with `follow_parents`, failures
  of parent tasks are re-raised first. Results with `ignore_result=True` return
  `None` immediately.
- **Deadlock guard.** `get()` calls `assert_will_not_block()`, which raises
  `RuntimeError("Never call result.get() within a task!")` when
  `task_join_will_block()` is set — the prefork child initializer sets it.
  `allow_join_result()` temporarily lifts the guard (used internally by chord
  joins); `disable_sync_subtasks=False` bypasses it.
- **`ResultSet`** / **`GroupResult`** – collections with `join()` (iterates
  each result) and `join_native()` (uses the backend's `get_many`, available
  when `supports_native_join`). `GroupResult.save()` / `restore(id)`
  persist group membership in the backend.
- **`EagerResult`** – returned by `apply()` and `task_always_eager`; holds
  the value locally.
- `result_from_tuple` / `as_tuple()` serialise result trees (used in group
  metadata and the chord machinery).

### Async result consumers

`celery/backends/asynchronous.py` provides `AsyncBackendMixin` and
`BaseResultConsumer`, shared by Redis and RPC. Pending results are tracked in
`_pending_results` (strong and weak maps); messages that arrive before a
result is registered are kept in a bounded `_pending_messages` buffer. A
`Drainer` drives `drain_events` until a promise is fulfilled; under eventlet
or gevent a `greenletDrainer` runs draining in a background greenlet so many
greenlets can wait concurrently.

## Tests

- `t/unit/backends/test_base.py` – meta construction, retry policy, chord
  counting, failure propagation along chains.
- `t/unit/backends/test_redis.py`, `test_rpc.py`, `test_database.py`,
  `test_asynchronous.py` and one file per other backend.
- `t/unit/tasks/test_result.py` – AsyncResult/ResultSet/GroupResult.
- `t/integration/test_backend.py`, `t/integration/test_database_backend.py`.

See also: [Canvas](../concepts/canvas.md),
[App and configuration](app-and-configuration.md).
