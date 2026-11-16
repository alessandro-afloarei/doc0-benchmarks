---
title: "Result Backends"
---
## Overview

A result backend holds the state and return value of each task so that a caller can read them after the task has run. The `Backend` base class in `celery/backends/base.py` defines the contract the worker and the caller use: the trace stores each state change through it, and `AsyncResult` reads it back. The backends differ in where the data lives and in how a caller waits for it. This page covers that contract, the families of backends, and how the one in use is picked. The worker's calls into the backend are in [[Task Execution]], and the chord counter is in [[Chains, Groups and Chords]].

Sources: [celery/backends/base.py:108-137](repo://celery/backends/base.py#L108-L137)

Sources: [celery/app/trace.py:625-628](repo://celery/app/trace.py#L625-L628)

## Choosing a backend

`by_name` resolves the backend setting through `BACKEND_ALIASES`, merged with the loader's `override_backends`, and loads the class with `symbol_by_name`.

Sources: [celery/app/backends.py:15-30](repo://celery/app/backends.py#L15-L30)

Sources: [celery/app/backends.py:41-58](repo://celery/app/backends.py#L41-L58)

The aliases include `rpc`, `redis` and `rediss`, `db` and `database`, `cache`, `file`, and several document and wide-column stores. The RPC backend is not persistent (`persistent` is false), and its results travel as messages.

Sources: [celery/app/backends.py:15-45](repo://celery/app/backends.py#L15-L45)

Sources: [celery/backends/rpc.py:147-157](repo://celery/backends/rpc.py#L147-L157)

## The contract

`store_result` encodes the result and the state, then calls the family's `_store_result` through `_ensure_retryable`. The retry wrapper applies the `always_retry_backend_operation` setting, so a recoverable error is retried with backoff before the operation fails.

Sources: [celery/backends/base.py:673-693](repo://celery/backends/base.py#L673-L693)

Sources: [celery/backends/base.py:635-672](repo://celery/backends/base.py#L635-L672)

`get_task_meta` calls `_ensure_not_eager` first, then reads through the same retry wrapper. A meta with status `SUCCESS` is kept in the instance's cache so that a second read does not go to the store.

Sources: [celery/backends/base.py:746-768](repo://celery/backends/base.py#L746-L768)

`mark_as_done` is what the trace calls on success. It stores the result unless the request ignores results, and then it hands the result to the chord counter when the request belongs to a chord.

Sources: [celery/backends/base.py:180-186](repo://celery/backends/base.py#L180-L186)

## Key-value families

`BaseKeyValueStoreBackend` implements the contract on top of four primitives: `get`, `set`, `delete` and `incr`. Keys are built by `get_key_for_task`, `get_key_for_group` and `get_key_for_chord`, which add the configured key prefix.

Sources: [celery/backends/base.py:964-1038](repo://celery/backends/base.py#L964-L1038)

`_store_result` reads the current meta first and skips the write when the stored status is already `SUCCESS`. That guards against a lost worker that reports late and overwrites a finished result.

Sources: [celery/backends/base.py:1116-1138](repo://celery/backends/base.py#L1116-L1138)

Redis overrides several parts of the family. Its `ResultConsumer` reads state changes from a pub/sub subscription, which it reconnects after a fork or a connection loss.

Sources: [celery/backends/redis.py:77-101](repo://celery/backends/redis.py#L77-L101)

Sources: [celery/backends/redis.py:204-227](repo://celery/backends/redis.py#L204-L227)

## Database

`DatabaseBackend` stores each task's meta in a table rather than as a key. `_store_result` writes the row, `_get_task_meta_for` reads it back, and group results are saved through `_save_group`.

Sources: [celery/backends/database/__init__.py:45-56](repo://celery/backends/database/__init__.py#L45-L56)

Sources: [celery/backends/database/__init__.py:135-170](repo://celery/backends/database/__init__.py#L135-L170)

## RPC

The RPC backend sends each result as a message. `store_result` picks the routing key with `destination_for`, and if none is returned nothing is sent.

Sources: [celery/backends/rpc.py:254-268](repo://celery/backends/rpc.py#L254-L268)

Sources: [celery/backends/rpc.py:225-240](repo://celery/backends/rpc.py#L225-L240)

`get_task_meta` for RPC drains the reply queue, up to a backlog limit, and caches the messages it sees for the other ids on the queue.

Sources: [celery/backends/rpc.py:291-328](repo://celery/backends/rpc.py#L291-L328)

## Disabled backend

`DisabledBackend` is the stand-in when results are not kept. Its `store_result` does nothing.

Sources: [celery/backends/base.py:1263-1280](repo://celery/backends/base.py#L1263-L1280)
