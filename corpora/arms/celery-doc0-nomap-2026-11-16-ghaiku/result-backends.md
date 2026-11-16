---
title: "Result Backend Contract"
---
## Overview

A result backend stores each task's state and return value so that a caller can read them later. The contract is the `Backend` base class in `celery/backends/base.py`. The tracer and the worker call its `mark_as_*` methods; callers read through `get_task_meta` and the methods built on it. Every write ends in `store_result`, and most concrete backends implement the storage through a key-value subclass. The list of concrete backends and how each one is chosen is in [[Result Backend Catalogue]].

Sources: [celery/backends/base.py:108-137](repo://celery/backends/base.py#L108-L137), [celery/backends/base.py:176-186](repo://celery/backends/base.py#L176-L186)

## State writes

`mark_as_started` stores the `STARTED` state, and `mark_as_retry` and `mark_as_revoked` store `RETRY` and `REVOKED` with the exception as the value. Each of them calls `store_result` with the task's request, so the backend can read the request fields when it encodes the value.

Sources: [celery/backends/base.py:176-178](repo://celery/backends/base.py#L176-L178), [celery/backends/base.py:306-320](repo://celery/backends/base.py#L306-L320)

`mark_as_done` stores the success and then calls `on_chord_part_return` when the task belongs to a chord.

Sources: [celery/backends/base.py:180-186](repo://celery/backends/base.py#L180-L186)

`store_result` encodes the value with `encode_result`, then passes the write to `_store_result` through `_ensure_retryable`. The retry helper repeats a failed write with exponential backoff when `always_retry_backend_operation` is on, and it raises `BackendStoreError` when the attempts run out.

Sources: [celery/backends/base.py:673-693](repo://celery/backends/base.py#L673-L693), [celery/backends/base.py:635-650](repo://celery/backends/base.py#L635-L650)

## The success rule in the key-value store

`BaseKeyValueStoreBackend._store_result` reads the stored metadata for the task before it writes. If the stored state is a success, the write is skipped and the new value is discarded. The code comment gives the reason: a task that was lost on a partitioned worker could otherwise overwrite the successful result of its replacement.

Sources: [celery/backends/base.py:1122-1131](repo://celery/backends/base.py#L1122-L1131)

```python
current_meta = self._get_task_meta_for(task_id)
```

Sources: [celery/backends/base.py:1116-1131](repo://celery/backends/base.py#L1116-L1131)

When the write goes ahead, the metadata is encoded and stored under the task's key with the state. A failure of the write raises `BackendStoreError` with the task id and the state attached.

Sources: [celery/backends/base.py:1132-1138](repo://celery/backends/base.py#L1132-L1138)

## Key layout

A key-value backend names every entry with a prefix and the id. `get_key_for_task` builds the key from the task prefix and the task id, and it refuses an empty id. Groups and chords use the same pattern with their own prefixes, and `_get_key_for` joins prefix, id and an optional suffix.

Sources: [celery/backends/base.py:1021-1026](repo://celery/backends/base.py#L1021-L1026), [celery/backends/base.py:1027-1045](repo://celery/backends/base.py#L1027-L1045)

The base class reaches storage through `get`, `mget`, `set`, `delete`, `incr` and `expire`. A subclass implements those for its database, and the rest of the contract is inherited.

Sources: [celery/backends/base.py:1000-1019](repo://celery/backends/base.py#L1000-L1019)

## Reads

`get_task_meta` reads through the cache, then calls `_get_task_meta_for` through the retry helper. A missing entry is reported as `PENDING` with no result, and a present one is decoded.

Sources: [celery/backends/base.py:746-768](repo://celery/backends/base.py#L746-L768), [celery/backends/base.py:1148-1153](repo://celery/backends/base.py#L1148-L1153)

`get_state`, `get_result` and `get_traceback` are thin wrappers over that read. [[AsyncResult and Result Sets]] describes how the caller uses them, including the wait loop.

Sources: [celery/backends/base.py:702-715](repo://celery/backends/base.py#L702-L715)

## Encoding

`encode` serializes the metadata with the backend's serializer, and `decode` reverses it. `prepare_expires` takes the expiry from the call, or from `result_expires` in the configuration, and converts a timedelta to seconds. `prepare_persistent` takes the call's flag, or the `result_persistent` setting when no flag is given.

Sources: [celery/backends/base.py:534-540](repo://celery/backends/base.py#L534-L540), [celery/backends/base.py:558-572](repo://celery/backends/base.py#L558-L572)

Exceptions are converted before they are stored. `prepare_exception` and `exception_to_python` map an exception to a form the serializer accepts and back again, so the caller re-raises the original class where it can.

Sources: [celery/backends/base.py:447-470](repo://celery/backends/base.py#L447-L470)

## Groups

`save_group` and `restore_group` write and read a group result under the group prefix, using the key-value helpers `_save_group` and `_restore_group`. `delete_group` removes it. Chords keep their own counter under a separate chord key.

Sources: [celery/backends/base.py:802-820](repo://celery/backends/base.py#L802-L820), [celery/backends/base.py:1140-1182](repo://celery/backends/base.py#L1140-L1182)

## The disabled backend

`DisabledBackend` is the backend for `disabled`. Its `store_result` does nothing, and it refuses chords, because a chord needs stored member results to count.

Sources: [celery/backends/base.py:1263-1278](repo://celery/backends/base.py#L1263-L1278)

Cleanup has two hooks. `cleanup` is the backend's own cleanup entry point. The built-in `celery.backend_cleanup` task calls it, and for a backend that needs periodic cleanup the task is scheduled daily at 4am. `process_cleanup` runs at the end of each task in the worker process. The tracer calls `process_cleanup` for every non-eager run, as [[Task Execution Tracing]] describes.

Sources: [celery/backends/base.py:820-827](repo://celery/backends/base.py#L820-L827), [celery/app/builtins.py:13-25](repo://celery/app/builtins.py#L13-L25)

The chord counting that `on_chord_part_return` starts is covered in [[Chords]].

Sources: [celery/backends/base.py:829-835](repo://celery/backends/base.py#L829-L835), [celery/backends/base.py:1188-1200](repo://celery/backends/base.py#L1188-L1200)
