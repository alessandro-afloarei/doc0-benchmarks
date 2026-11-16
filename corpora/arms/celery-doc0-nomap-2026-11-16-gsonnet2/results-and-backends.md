---
title: "Results, AsyncResult and the Result Backend"
---
## Overview

Celery stores a task's outcome in a result backend, keyed by task id, and gives the caller an `AsyncResult` to read it back. The backend is an instance of a `Backend` subclass that the app creates from the `result_backend` setting. The worker writes to it through `mark_as_*` and `store_result`; the client reads through `AsyncResult.get` and `state`. This page covers that shared machinery: states, the storage contract in the base class, the key/value scheme most backends reuse, polling versus push-style waiting, and the result classes. The individual stores are on [[Result Backend Catalogue]]; chord-specific methods are on [[Chords: Header, Body and Completion]].

Sources: [celery/backends/base.py:108-165](repo://celery/backends/base.py#L108-L165), [celery/result.py:70-103](repo://celery/result.py#L70-L103)

## Task states

States are plain strings in `celery.states`. The groups drive behaviour throughout:

Sources: [celery/states.py:144-150](repo://celery/states.py#L144-L150)

| Group | Members | Used for |
| --- | --- | --- |
| `READY_STATES` | `SUCCESS`, `FAILURE`, `REVOKED` | A result is final; `AsyncResult.ready()` and waiting stop here |
| `UNREADY_STATES` | `PENDING`, `RECEIVED`, `STARTED`, `REJECTED`, `RETRY` | Still waiting |
| `EXCEPTION_STATES` | `RETRY`, `FAILURE`, `REVOKED` | The stored result is an exception |
| `PROPAGATE_STATES` | `FAILURE`, `REVOKED` | `get` re-raises, and failures propagate down a chain |

Sources: [celery/states.py:127-150](repo://celery/states.py#L127-L150), [celery/result.py:388-396](repo://celery/result.py#L388-L396)

`PENDING` is also what a backend answers for an id it has no record of, so an unknown id looks pending forever. A `PRECEDENCE` list orders states for comparison.

Sources: [celery/states.py:64-90](repo://celery/states.py#L64-L90), [celery/backends/base.py:1148-1153](repo://celery/backends/base.py#L1148-L1153)

## Choosing and building the backend

`app.backend` is built lazily by `_get_backend`, using `backends.by_url(backend_cls or conf.result_backend, loader)`. `by_url` splits a URL such as `redis://host/0` into a scheme and the full URL; a scheme with a `+` (`db+sqlite:///x`) uses the part before the plus as the backend name and the rest as the URL. `by_name` looks the name up in `BACKEND_ALIASES`, the loader's `override_backends`, and any `celery.result_backends` entry points, then falls back to a dotted path; an unknown name or a module raises `ImproperlyConfigured`. No backend name resolves to `disabled`. The aliases are listed on [[Result Backend Catalogue]].

Sources: [celery/app/base.py:1224-1228](repo://celery/app/base.py#L1224-L1228), [celery/app/backends.py:36-69](repo://celery/app/backends.py#L36-L69)

`DisabledBackend` makes `store_result` a no-op and turns reads (`get_state`, `get_result`, `wait_for` and the like) and chords into `NotImplementedError` with an explanatory message. Per-task `ignore_result` skips storing without disabling the backend; the tracer also honours `store_errors_even_if_ignored` (see [[Task Execution, Tracing and Acknowledgement]]).

Sources: [celery/backends/base.py:1263-1281](repo://celery/backends/base.py#L1263-L1281), [celery/app/trace.py:188-204](repo://celery/app/trace.py#L188-L204)

## The storage contract

`Backend.__init__` takes its serializer from `result_serializer`, sets up an LRU cache of results (`result_cache_max`, with `-1` meaning no cache), computes `expires`, and resolves the accepted content types with precedence `accept`, `result_accept_content`, `accept_content`. It also reads the retry options `result_backend_always_retry`, `..._max_retries`, `..._base_sleep_between_retries_ms`, `..._max_sleep_between_retries_ms` and `result_backend_thread_safe`. Class attributes declare capabilities: `supports_native_join`, `supports_autoexpire` (the daily `backend_cleanup` task is not scheduled for such backends, see [[Periodic Tasks with Beat]]) and `persistent`.

Sources: [celery/backends/base.py:108-165](repo://celery/backends/base.py#L108-L165)

The worker-side API is a family of `mark_as_*` methods over `store_result`:

Sources: [celery/backends/base.py:176-187](repo://celery/backends/base.py#L176-L187)

| Method | State stored | Also |
| --- | --- | --- |
| `mark_as_started` | `STARTED` | Stores the metadata passed |
| `mark_as_done` | `SUCCESS` | Calls `on_chord_part_return` if the request has a chord |
| `mark_as_failure` | `FAILURE` | Chord part return, propagates to chain members, calls errbacks |
| `mark_as_revoked` | `REVOKED` | Stores `TaskRevokedError`; chord part return |
| `mark_as_retry` | `RETRY` | Stores the current exception |

Sources: [celery/backends/base.py:176-187](repo://celery/backends/base.py#L176-L187), [celery/backends/base.py:188-204](repo://celery/backends/base.py#L188-L204), [celery/backends/base.py:306-323](repo://celery/backends/base.py#L306-L323)

`store_result` first encodes the value: exceptions in an exception state go through `prepare_exception`, which keeps a pickleable exception for pickle-like codecs and otherwise a dictionary of `exc_type`, `exc_message` and `exc_module`; `exception_to_python` reverses it on the reading side. It then calls the subclass's `_store_result` inside `_ensure_retryable`. With `result_backend_always_retry`, errors the backend marks as safe (`exception_safe_to_retry`) are retried with exponential backoff up to `max_retries`, then raised as `BackendStoreError`; by default no exception is safe.

Sources: [celery/backends/base.py:447-475](repo://celery/backends/base.py#L447-L475), [celery/backends/base.py:573-576](repo://celery/backends/base.py#L573-L576), [celery/backends/base.py:635-693](repo://celery/backends/base.py#L635-L693), [celery/backends/base.py:732-744](repo://celery/backends/base.py#L732-L744)

The stored document is built by `_get_result_meta`: `status`, `result`, `traceback`, `children` (the task's trail), `date_done` for ready states, `group_id` and `parent_id`. With the `extended` result setting it adds name, args, kwargs, worker, retries, queue and any stamps.

Sources: [celery/backends/base.py:581-630](repo://celery/backends/base.py#L581-L630)

Reading goes through `get_task_meta(task_id)`: an LRU-cached value is returned when present; otherwise `_get_task_meta_for` is called with the same retry wrapper (raising `BackendGetMetaError` if it gives up), and only `SUCCESS` documents are cached. `get_state`, `get_result`, `get_traceback` and `get_children` are projections of it. With `task_always_eager` and no `task_store_eager_result`, reads warn that nothing is stored.

Sources: [celery/backends/base.py:702-768](repo://celery/backends/base.py#L702-L768), [celery/backends/base.py:723-730](repo://celery/backends/base.py#L723-L730)

## Key/value backends

Most stores subclass `BaseKeyValueStoreBackend` and implement `get`, `mget`, `set`, `delete`, and optionally `incr` and `expire`. It defines the key scheme: `celery-task-meta-<id>` for tasks, `celery-taskset-meta-<id>` for groups and `chord-unlock-<id>` for chord counters, with an optional `global_keyprefix` from `result_backend_transport_options` prepended to all three (a separator is added if the prefix does not end in one of `:_-.`). If the subclass sets `implements_incr`, `apply_chord` is replaced by the counter-based chord path.

Sources: [celery/backends/base.py:964-1045](repo://celery/backends/base.py#L964-L1045)

`_store_result` builds the document, reads the current one, and returns without writing if the stored status is already `SUCCESS`. A comment explains why: a lost task redelivered after network partition must not overwrite the last good result. `_get_task_meta_for` returns `{'status': PENDING, 'result': None}` when no key exists. `get_many` serves ready results from the cache, then polls `mget` every `interval` until all ids are ready or the timeout expires. Groups are saved as the tuple form of the group result and restored with `result_from_tuple`.

Sources: [celery/backends/base.py:1075-1181](repo://celery/backends/base.py#L1075-L1181)

## Waiting: polling versus push

`AsyncResult.get` calls `backend.add_pending_result(self)` and then `backend.wait_for_pending(...)`. Which implementation runs depends on the backend's mixin:

Sources: [celery/result.py:262-270](repo://celery/result.py#L262-L270)

| Mixin | `is_async` | How it waits |
| --- | --- | --- |
| `SyncBackendMixin` | `False` | `wait_for` loops: `get_task_meta`, sleep `interval`, until a ready state or `TimeoutError`; `on_message` is refused |
| `AsyncBackendMixin` | `True` | A `ResultConsumer` subscribes per task id and a `Drainer` runs the event loop until the result arrives |

Sources: [celery/result.py:191-270](repo://celery/result.py#L191-L270), [celery/backends/base.py:879-954](repo://celery/backends/base.py#L879-L954), [celery/backends/asynchronous.py:225-313](repo://celery/backends/asynchronous.py#L225-L313)

For the async mixin, `add_pending_result` starts the drainer, first checks the buffer of messages that arrived early, and otherwise records the pending result and tells the consumer to `consume_from(task_id)`. Removing the result cancels the subscription. `BaseResultConsumer.on_state_change` handles each message: for a ready state it finds the pending result and sets its cache, hands it to a waiting bucket if one exists, or buffers the metadata if the result was not registered yet. The drainer class is chosen by environment (default, eventlet, gevent), so waiting works inside green workers. The Redis and RPC backends use this path, so their `interval` argument has no effect.

Sources: [celery/backends/asynchronous.py:260-293](repo://celery/backends/asynchronous.py#L260-L293), [celery/backends/asynchronous.py:316-336](repo://celery/backends/asynchronous.py#L316-L336), [celery/backends/asynchronous.py:427-449](repo://celery/backends/asynchronous.py#L427-L449), [celery/result.py:191-216](repo://celery/result.py#L191-L216)

## AsyncResult and result sets

`AsyncResult(id)` is a handle: nothing is read until you ask. `state` is `_get_task_meta()['status']`, where the meta is cached on the object once final; `result` and `traceback` read the same document; `ready()` tests `state in READY_STATES`, `successful()` and `failed()` test for `SUCCESS` and `FAILURE`. `maybe_throw` raises the stored exception for propagate states (with the remote traceback attached) and calls an optional callback, which is how `get(propagate=True)` re-raises task errors.

Sources: [celery/result.py:369-397](repo://celery/result.py#L369-L397), [celery/result.py:470-535](repo://celery/result.py#L470-L535)

`get` has a few more rules: an ignored result returns `None` immediately; unless `disable_sync_subtasks=False` it calls `assert_will_not_block`, which raises if the worker marked joins as blocking (`allow_join_result()` and `denied_join_result()` toggle this); with `follow_parents` it re-raises an error from a parent in the chain first; and a cached result returns without a backend call.

Sources: [celery/result.py:37-60](repo://celery/result.py#L37-L60), [celery/result.py:191-270](repo://celery/result.py#L191-L270)

`ResultSet` holds many results and offers `join` (a list of values in order, polling, optionally `callback` per result), `join_native` and `iter_native` for backends with `supports_native_join`, and `ready`, `successful`, `failed` and `completed_count` summaries. `GroupResult` adds an id and a parent, can be `save`d to and `restore`d from the backend, and serializes with `as_tuple`, which is how chords find their header. `EagerResult` is a result whose value is already known, returned by `apply` and by eager mode, so calling code can treat local and remote execution alike. `result_from_tuple` rebuilds any of them from their tuple form.

Sources: [celery/result.py:579-599](repo://celery/result.py#L579-L599), [celery/result.py:742-760](repo://celery/result.py#L742-L760), [celery/result.py:929-1020](repo://celery/result.py#L929-L1020), [celery/result.py:1025-1060](repo://celery/result.py#L1025-L1060)
