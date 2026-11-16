---
type: architecture
title: Result Backends
description: How Celery stores and retrieves task state and return values - the Backend base classes, the key-value and database storage paths, the asynchronous result-consumer machinery, the RPC backend, and the backends that support or do not support chords.
tags: [celery, backend, result, storage, redis, database, rpc, async, chord]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:42:35.525Z
sources:
  - id: openwiki-source-c4ebf7fa0abfe9f2d1eabf61
    resource: repo://celery/app/backends.py
  - id: openwiki-source-98fa58283cefff1b0e071bbe
    resource: repo://celery/backends/base.py
  - id: openwiki-source-841e21137490a3db7a509f92
    resource: repo://celery/backends/cache.py
  - id: openwiki-source-780ad51e7477aa5e5ddbf3df
    resource: repo://celery/backends/database/__init__.py
  - id: openwiki-source-2159b37992e69ba636c3ca3f
    resource: repo://celery/backends/database/models.py
  - id: openwiki-source-988ef4eeaa034468195db4c9
    resource: repo://celery/backends/dynamodb.py
  - id: openwiki-source-0b6b8ed4194a35d9f3eb6192
    resource: repo://celery/backends/gcs.py
  - id: openwiki-source-a4d1ab266bef232afaa055d8
    resource: repo://celery/backends/rpc.py
generated: { by: "claude-code", at: "2026-11-16T10:42:35.525Z" }
---

# Result Backends

A result backend stores each task's state and return value and lets an `AsyncResult` ask for them later. Backends are optional: when no backend is configured, the `disabled` backend is used (`by_name` in `celery/app/backends.py` defaults to it), results cannot be read, and chords cannot be built. The backend code is in `celery/backends/` (base classes in `base.py`, concrete backends in sibling modules), the result objects are in `celery/result.py`, and the name-to-class mapping is in `celery/app/backends.py`.

## Responsibility and ownership

The backend owns:

- writing task metadata (status, result, traceback, children, and request context) when the worker reports a state change;
- reading that metadata for `AsyncResult.get`, `state`, and `ready`;
- chord bookkeeping, meaning counting completed header members and triggering the body;
- group results and, for some backends, cleanup (`forget`, `delete_group`).

The worker and tracer call into the backend through `store_result` and `mark_as_failure` (see [tasks and tracing](tasks-and-tracing.md)); the canvas layer relies on it for chord completion (see [canvas](canvas.md)).

## Selection

`BACKEND_ALIASES` in `celery/app/backends.py` (lines 15 onward) maps URL schemes and short names to classes. Examples are `redis`, `rediss`, `sentinel`, `db` and `database`, `cache`, `rpc`, `file`, `disabled`, `mongodb`, `elasticsearch`, `cassandra`, `dynamodb`, `s3`, and `gs`. `by_name` (line 41) resolves a backend name and falls back to `disabled` when none is given; `by_url` (line 59) resolves a URL scheme. The app instantiates the chosen class with the app and the URL.

## The Backend base class

`Backend` (`celery/backends/base.py`, class at line 108) defines the interface that every backend implements:

- `store_result(task_id, result, state, ...)` (around line 673) writes the state and, for failures, the traceback. `mark_as_failure` (around line 188) is the failure entry point described in [canvas](canvas.md).
- `get_state`, `get_result`, `get_traceback`, `get_children`, `get_task_meta`, and `get_group_meta` read the stored data. `get_task_meta` has a `cache` argument so repeated reads within one call do not hit storage again.
- `on_task_call` (around line 826) runs when a task is published, before the worker has seen it, and is the hook some backends use to prepare a result channel.
- `set_chord_size`, `ensure_chords_allowed` (around line 861), and `apply_chord` (around line 864) implement the chord protocol. The default `apply_chord` calls `ensure_chords_allowed` and then `fallback_chord_unlock`.
- `implements_incr` (a class attribute, `False` by default) says whether the backend supports incremental counting for chords; see below.

`SyncBackendMixin` (around line 879) adds blocking waits (`wait_for`, `wait_for_pending`) for synchronous callers.

## Key-value storage

`BaseKeyValueStoreBackend` (around line 964) implements the `Backend` contract on top of a `get`/`set`/`mget` interface. Keys are built per task, group, and chord (`get_key_for_task`, `get_key_for_group`, `get_key_for_chord`, lines ~1021–1036). `_store_result` (around line 1116) serializes the metadata and writes it with `_set_with_state`, but it first reads the current metadata and returns without writing when the stored state is already `SUCCESS`. This guards against a late update from a lost or partitioned worker overwriting a completed result.

`get_many` (around line 1075) fetches results for several task IDs, with `timeout` and `interval` controlling polling.

Concrete key-value backends include Redis, cache (memcached and similar via `celery/backends/cache.py`), filesystem, MongoDB, and the cloud object stores (S3, GCS, Azure Blob).

## Database backend

`DatabaseBackend` (`celery/backends/database/__init__.py`, class at line 45) is a `BaseBackend` built on SQLAlchemy. Its models are `Task` and `TaskExtended` (`models.py`, lines 27 and 64) for individual results and `TaskSet` (line 90) for group results. `_store_result` (line 135) and `_update_result` (line 151) write rows, `_get_task_meta_for` (line 170) reads them, and `_forget` (line 230) deletes them. Sessions are managed by `SessionManager` in `database/session.py`.

## Asynchronous retrieval

`AsyncBackendMixin` (`celery/backends/asynchronous.py`, around line 225) is the layer used when a caller waits for many results without polling each one. It is driven by a result consumer, which listens for state-change messages and dispatches them to the waiting `AsyncResult` objects. `Drainer` and its greenlet variants (`greenletDrainer`, `eventletDrainer`, `geventDrainer`) run the consumer loop with the concurrency model of the process, so waiting works in threaded, eventlet, and gevent programs.

Backends that deliver results as messages provide their own consumer. Redis has a `ResultConsumer` (`celery/backends/redis.py`, class at line 77). The RPC backend (`celery/backends/rpc.py`) is an `AsyncBackendMixin` whose `RPCBackend` (line 147) creates a binding per task on a result exchange (`_create_binding`, line 209) and reads replies from it. RPC results are delivered as messages and are not stored, so a result can be read only by the client that waits for it.

## Chords and incremental counting

A chord needs a backend that can count completed header members. Two mechanisms exist:

- **Incremental counting** (`implements_incr = True`): `on_chord_part_return` (around line 1188 of `base.py`) updates a counter as each member returns. The backends that set this flag are cache, DynamoDB, and GCS (`cache.py` line 96, `dynamodb.py` line 66, `gcs.py` line 167).
- **Fallback unlock** (`fallback_chord_unlock`, around line 838): the chord body is scheduled to check whether all header results are available, retrying with a countdown until they are.

`DisabledBackend` (line 1263) raises from `ensure_chords_allowed` (line 1271), so chords fail fast instead of stalling when no backend is configured.

## Invariants and failure behaviour

- A `SUCCESS` result is not overwritten by later state updates in key-value backends.
- Storage errors are raised as `BackendStoreError` with the task ID and state attached, so the caller can see which write failed.
- Chords cannot be built without a backend that supports them; `DisabledBackend` raises immediately.
- Result retention and cleanup are backend-specific; `forget` and `delete_group` are the explicit deletion points.

## Extension seams

Subclass `Backend` or `BaseKeyValueStoreBackend` and register the class under a scheme in `BACKEND_ALIASES`, or pass the class directly through the app's `backend` argument. Set `implements_incr` only when the backend can perform an atomic increment, because the chord logic relies on it being exact.

## Representative tests

`t/unit/backends/` contains a test module for each backend, and `t/integration/test_backend.py` and `t/integration/test_database_backend.py` exercise the backends against real services.
