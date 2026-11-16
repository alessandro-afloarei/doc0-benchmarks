---
title: "Result Backend Interface"
---
## Overview

A result backend is the store where workers write a task's state and return value and where clients read them back. Every backend is a subclass of `celery.backends.base.Backend`, which implements the parts common to all stores (encoding, exception serialization, result metadata, retries, chord hooks) and leaves a small set of storage primitives to each subclass. The worker reaches it through `task.backend` from the tracer, and the client through `AsyncResult.backend` ([[Task States and AsyncResult]]).

Sources: [celery/backends/base.py:108-163](repo://celery/backends/base.py#L108-L163), [celery/app/trace.py:586-604](repo://celery/app/trace.py#L586-L604)

This page covers that shared contract and the key-value base class most stores build on. The individual stores are listed in [[Result Backend Catalogue]], and the chord counting that backends take part in is in [[Groups and Chords]].

Sources: [celery/backends/base.py:964-979](repo://celery/backends/base.py#L964-L979)

## Selecting a backend

The app's `backend` property calls `backends.by_url(backend_cls or conf.result_backend, loader)` and instantiates the class with `app` and `url` ([[The Celery Application]]). `by_url` takes the scheme of a URL (`redis://...` selects `redis`); a scheme of the form `db+postgresql://` selects `db` and passes the rest on as the URL. `by_name` resolves the alias through `BACKEND_ALIASES`, the loader's `override_backends`, and classes registered under the `celery.result_backends` entry-point group, accepting a full `module:Class` path as well. An unknown name, or a name that resolves to a module rather than a class, raises `ImproperlyConfigured`. Without any setting, the backend is `disabled`.

Sources: [celery/app/backends.py:15-69](repo://celery/app/backends.py#L15-L69), [celery/app/base.py:1224-1228](repo://celery/app/base.py#L1224-L1228)

## Construction and settings

`Backend.__init__(app, serializer=None, max_cached_results=None, accept=None, expires=None, expires_type=None, url=None)` reads its defaults from the `result_*` settings:

Sources: [celery/backends/base.py:137-142](repo://celery/backends/base.py#L137-L142)

| Setting | Default | Effect |
| --- | --- | --- |
| `result_serializer` | `'json'` | Serializer for stored metadata |
| `result_accept_content` | `None` | Accepted content types when decoding; falls back to `accept_content` |
| `result_cache_max` | `-1` | Size of the local LRU cache; `-1` disables it |
| `result_expires` | 1 day | Expiry passed to stores that support it |
| `result_extended` | `False` | Store task name, args, kwargs, worker, retries and queue |
| `result_backend_always_retry` | `False` | Retry failed store/read operations |
| `result_backend_max_retries` | infinite | Retry limit |
| `result_backend_base_sleep_between_retries_ms`, `result_backend_max_sleep_between_retries_ms` | 10, 10000 | Backoff bounds |
| `result_backend_thread_safe` | `False` | Lets the app share one backend instance across threads |

Sources: [celery/backends/base.py:137-163](repo://celery/backends/base.py#L137-L163), [celery/app/defaults.py:205-230](repo://celery/app/defaults.py#L205-L230)

Class attributes describe what a backend can do: `supports_native_join` (it implements `get_many`, so result sets can be joined in bulk), `supports_autoexpire` (the store expires results itself, so the daily `celery.backend_cleanup` task is not needed), `persistent`, and a default `retry_policy`. `as_uri()` returns the URL with the password masked unless asked otherwise.

Sources: [celery/backends/base.py:108-136](repo://celery/backends/base.py#L108-L136), [celery/backends/base.py:165-172](repo://celery/backends/base.py#L165-L172)

## Writing results

The worker never calls `store_result` directly; it calls the state-specific methods:

Sources: [celery/backends/base.py:175-186](repo://celery/backends/base.py#L175-L186)

| Method | Stores | Also |
| --- | --- | --- |
| `mark_as_started(task_id, **meta)` | `STARTED` with the given meta | |
| `mark_as_done(task_id, result, request, store_result=True)` | `SUCCESS`, unless the request ignores results | `on_chord_part_return` for chord members |
| `mark_as_failure(task_id, exc, traceback, request, call_errbacks=True)` | `FAILURE` | Chord hook, failure propagation along the remaining chain, errbacks |
| `mark_as_retry(task_id, exc, traceback, request)` | `RETRY` with the exception | |
| `mark_as_revoked(task_id, reason, request)` | `REVOKED` with a `TaskRevokedError` | Chord hook |

Sources: [celery/backends/base.py:175-260](repo://celery/backends/base.py#L175-L260), [celery/backends/base.py:304-323](repo://celery/backends/base.py#L304-L323)

`store_result(task_id, result, state, traceback=None, request=None)` encodes the result for its state and calls the subclass's `_store_result` through `_ensure_retryable`. With `result_backend_always_retry` on, an exception the subclass declares safe in `exception_safe_to_retry` is retried with exponential backoff and full jitter between the configured bounds, calling the `on_backend_retryable_error` hook before each retry; when retries run out, it raises `BackendStoreError` carrying the task id and state. With retrying off, or for any other exception, the error propagates at once. The base `exception_safe_to_retry` returns `False`, so each backend opts in.

Sources: [celery/backends/base.py:617-679](repo://celery/backends/base.py#L617-L679), [celery/backends/base.py:715-727](repo://celery/backends/base.py#L715-L727)

`fail_from_current_stack(task_id, exc=None)` marks a task failed from inside an `except` block and then clears the traceback frames, so locals of the failed frames are not kept alive.

Sources: [celery/backends/base.py:427-443](repo://celery/backends/base.py#L427-L443)

## Errbacks

`mark_as_failure` calls `_call_task_errbacks` for the request's errbacks. An errback whose task function takes more than one argument is called in-process as `errback(request, exc, traceback)`, and an exception it raises is logged. Errbacks that take one argument (the old style), or whose task is not registered on this worker, are sent as a group with the failed task's id as their argument, applied eagerly in eager mode.

Sources: [celery/backends/base.py:255-302](repo://celery/backends/base.py#L255-L302)

## Result metadata

`_get_result_meta` builds the dict that is stored: `status`, `result`, `traceback`, `children` (the current task's subtask results as tuples), and `date_done` for ready states, plus `group_id` and `parent_id` when the request has them. With `result_extended`, it adds `name`, `args`, `kwargs`, `worker`, `retries` and `queue` (the delivery routing key), and the request's stamps; `encode=True` lets stores that need it encode `args` and `kwargs` separately. These fields are what `AsyncResult.name`, `.args` and the other extended properties read.

Sources: [celery/backends/base.py:575-614](repo://celery/backends/base.py#L575-L614), [celery/backends/base.py:869-872](repo://celery/backends/base.py#L869-L872)

## Encoding and exceptions

`encode_result(result, state)` turns an exception into a storable value for exception states, and a result object into its tuple form for non-pickle serializers. Values are then serialized with `encode`, and `decode` uses Kombu's `loads` with the backend's content type and `accept` list, so a result in a content type the client does not accept is refused.

Sources: [celery/backends/base.py:529-573](repo://celery/backends/base.py#L529-L573)

With the `pickle` serializer, exceptions are stored as objects. `get_pickleable_exception` returns the exception if it pickles, otherwise the nearest base class in its MRO (above `Exception`) that pickles with the same arguments, otherwise an `UnpickleableExceptionWrapper` holding the module, class name, serializable arguments and text; reading converts the wrapper back with `restore()`.

Sources: [celery/backends/base.py:445-453](repo://celery/backends/base.py#L445-L453), [celery/utils/serialization.py:38-67](repo://celery/utils/serialization.py#L38-L67), [celery/utils/serialization.py:101-188](repo://celery/utils/serialization.py#L101-L188)

With other serializers, an exception is stored as `{'exc_type', 'exc_message', 'exc_module'}`, with arguments that cannot be encoded replaced by their `repr`. `exception_to_python` rebuilds it by looking the class up in `sys.modules[exc_module]` (following dotted qualified names) or creating a placeholder exception class. It refuses to instantiate anything that is not a `BaseException` subclass and raises `SecurityError` instead; the comment explains that otherwise a forged result such as `exc_module: "os", exc_type: "system"` would run arbitrary code on the client.

Sources: [celery/backends/base.py:455-527](repo://celery/backends/base.py#L455-L527), [celery/utils/serialization.py:73-99](repo://celery/utils/serialization.py#L73-L99)

## Reading results

`get_task_meta(task_id, cache=True)` returns cached meta when present, otherwise calls the subclass's `_get_task_meta_for` through the retry helper (raising `BackendGetMetaError` when retries run out) and caches the meta if the state is `SUCCESS`. `get_state`, `get_result`, `get_traceback` and `get_children` are shortcuts over it, and `reload_task_result` bypasses the cache. Reading while `task_always_eager` is on and `task_store_eager_result` is off emits a `RuntimeWarning`, since nothing was stored.

Sources: [celery/backends/base.py:681-765](repo://celery/backends/base.py#L681-L765), [celery/backends/base.py:729-736](repo://celery/backends/base.py#L729-L736)

Groups are stored with `save_group(group_id, result)` and read with `restore_group` / `get_group_meta`; `delete_group` removes them. `forget(task_id)` drops the cached entry and calls `_forget`. `cleanup()` is called by the `celery.backend_cleanup` task, and `process_cleanup()` after each task on the worker; both do nothing in the base class.

Sources: [celery/backends/base.py:687-695](repo://celery/backends/base.py#L687-L695), [celery/backends/base.py:767-823](repo://celery/backends/base.py#L767-L823)

## What a subclass implements

| Method | Purpose |
| --- | --- |
| `_store_result(task_id, result, state, traceback, request)` | Persist one task's meta |
| `_get_task_meta_for(task_id)` | Load meta, returning `PENDING` when absent |
| `_forget(task_id)` | Delete one result |
| `_save_group`, `_restore_group`, `_delete_group` | Group persistence |
| `get_many(...)` | Bulk read, when `supports_native_join` |
| `on_chord_part_return`, `apply_chord`, `set_chord_size`, `add_to_chord` | Chord support |
| `on_task_call(producer, task_id)` | Hook run by `send_task` before publishing |

Sources: [celery/backends/base.py:687-695](repo://celery/backends/base.py#L687-L695), [celery/backends/base.py:825-867](repo://celery/backends/base.py#L825-L867)

`BaseBackend` combines `Backend` with `SyncBackendMixin`, the polling mixin described in [[Task States and AsyncResult]]. `DisabledBackend`, the default, stores nothing, raises `NotImplementedError` with a "no result backend configured" message on any read, and refuses chords.

Sources: [celery/backends/base.py:957-961](repo://celery/backends/base.py#L957-L961), [celery/backends/base.py:1263-1281](repo://celery/backends/base.py#L1263-L1281)

## Key-value backends

`BaseKeyValueStoreBackend` implements all of the above on top of five primitives a store provides: `get`, `mget`, `set`, `delete` and, optionally, `incr` and `expire`. Keys are `celery-task-meta-<id>`, `celery-taskset-meta-<id>` and `chord-unlock-<id>`, converted to bytes by `key_t`. A `global_keyprefix` in `result_backend_transport_options` is prepended to all three, with `_` added unless it already ends in `:`, `_`, `-` or `.`.

Sources: [celery/backends/base.py:964-1037](repo://celery/backends/base.py#L964-L1037)

`_store_result` builds the meta, adds `task_id`, and before writing reads the current meta: if it is already `SUCCESS`, the write is skipped. The comment explains this guards against a lost or duplicated task overwriting a successful result after a network partition. `_get_task_meta_for` returns `{'status': PENDING, 'result': None}` for a missing key, and `task_result_exists` checks for the key itself.

Sources: [celery/backends/base.py:1120-1176](repo://celery/backends/base.py#L1120-L1176)

`get_many(task_ids, timeout=None, interval=0.5, ...)` first yields ready results from the local cache, then repeatedly calls `mget` for the remaining ids, yields each one that has reached a ready state, sleeps `interval` between rounds ("don't busy loop"), and raises `TimeoutError` when the rounds exceed the timeout. Groups are stored as `{'result': group.as_tuple()}` and restored with `result_from_tuple`. `KeyValueStoreBackend` adds the polling mixin to this base.

Sources: [celery/backends/base.py:1039-1118](repo://celery/backends/base.py#L1039-L1118), [celery/backends/base.py:1144-1181](repo://celery/backends/base.py#L1144-L1181), [celery/backends/base.py:1259-1260](repo://celery/backends/base.py#L1259-L1260)
