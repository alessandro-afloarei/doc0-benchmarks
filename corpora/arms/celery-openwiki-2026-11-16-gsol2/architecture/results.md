---
type: architecture
title: Results, persistence, and backend contracts
description: How result handles retrieve task state, how backends store and expire metadata, and why backend choice changes workflow behavior.
tags: [results, backends, persistence, redis, rpc]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:50:32.264Z
sources:
  - id: openwiki-source-c4ebf7fa0abfe9f2d1eabf61
    resource: repo://celery/app/backends.py
  - id: openwiki-source-98fa58283cefff1b0e071bbe
    resource: repo://celery/backends/base.py
  - id: openwiki-source-780ad51e7477aa5e5ddbf3df
    resource: repo://celery/backends/database/__init__.py
  - id: openwiki-source-6b95f00dc919dfdb3eec1511
    resource: repo://celery/backends/redis.py
  - id: openwiki-source-a4d1ab266bef232afaa055d8
    resource: repo://celery/backends/rpc.py
  - id: openwiki-source-33fca59793af7cfa460b223c
    resource: repo://celery/result.py
generated: { by: "codex", at: "2026-11-16T16:38:41.370Z" }
---

# Results, persistence, and backend contracts

The broker delivers tasks; the result backend records or transmits execution state. These are separate configuration choices even if both use Redis. `AsyncResult` is a task ID plus an application/backend relationship, with optional cached metadata. It does not contain a live connection to the worker that ran the task.

## Selection and storage responsibilities

Backend selection resolves aliases, loader overrides, and `celery.result_backends` extensions. URLs select the scheme's adapter; compound forms such as `db+...` split the adapter from its connection URL. Without a backend selection, the disabled backend permits result writes as a no-op but raises for result retrieval and chord support.

The common backend prepares result values and exceptions, constructs metadata, and exposes `mark_as_started`, `mark_as_done`, `mark_as_failure`, and `mark_as_retry`. The worker tracer drives these transitions. `mark_as_done` also notifies chord coordination even when its ordinary result-storage branch is skipped. Failures can trigger errbacks and downstream workflow error handling as well as metadata storage.

Result storage and retrieval pass through the backend's recoverable-operation retry wrapper. `result_backend_always_retry` enables retries only for exceptions the adapter classifies as safe to retry; configured retry limits and backoff apply. This retries a backend operation, not the user's task body. An execution can finish its external side effect and still fail while publishing its result.

## Reading and releasing results

`AsyncResult.state` asks for task metadata unless a ready state is cached. Key/value backends return `PENDING` with no result when the key does not exist. That means an unknown ID, an expired result, and a task whose result has not been stored can look the same; `PENDING` is not proof that a message is waiting in a queue.

`get(timeout=..., propagate=True)` registers a pending result and delegates waiting to the backend. It returns the value on success and normally reraises a stored failure. Its timeout ends the client's wait and does not terminate execution. Ignored result handles return immediately. Redis and RPC can wait through result consumers instead of the synchronous polling loop, so the polling `interval` is not a universal latency control.

By default the task context blocks synchronous subtask joins, because waiting for queued children can deadlock a finite worker pool. Use [Canvas](../workflows/canvas.md) for dependencies. Call `get()` or `forget()` to release result-handle resources when appropriate; `forget()` clears local metadata, unregisters pending consumption, and asks the backend to forget the task and its parents. Expiration remains an independent storage policy.

## Backend differences that affect design

| Backend | Result mechanism | Workflow consequence |
| --- | --- | --- |
| Redis | Stores task keys, applies TTL when configured, and publishes result updates | Supports asynchronous result consumption and native chord completion using group coordination keys |
| RPC | Publishes replies to the request's reply-to destination with its correlation ID | Uses a client reply queue rather than a general shared task-key store; chords are explicitly unsupported |
| Database | Stores task/group records through SQLAlchemy | Expired records are deleted by backend cleanup; availability of rows depends on running cleanup and configured retention |
| Disabled | No result storage/retrieval service | Suitable only when callers and workflows do not require backend results |

Redis chord completion stores each part, checks the expected count, reconstructs results, dispatches the callback, and cleans coordination keys. Nested groups may require a saved `GroupResult` so their shape survives joining. Generic backends can use the built-in chord unlock task instead; backend support is a correctness dependency for a chord.

`result_expires` controls retention, with adapter-specific enforcement. Redis uses key expiration. Database cleanup removes records older than the retention window. Beat installs the cleanup task for backends that need it when expiration is configured; see [periodic scheduling](../operations/periodic-tasks.md). Choose retention long enough for result readers and chord completion, including retries and delayed tasks.

## Extension and verification

New adapters implement storage/retrieval primitives and declare capabilities such as automatic expiration and native join support. Async adapters also own pending-result consumers and reconnect behavior. Serialization and exception reconstruction are part of the [trust boundary](../security/serialization.md).

Read [result handles](../../celery/result.py), [backend contracts](../../celery/backends/base.py), [Redis](../../celery/backends/redis.py), [RPC](../../celery/backends/rpc.py), and [database cleanup](../../celery/backends/database/__init__.py). Focused tests include [base backend tests](../../t/unit/backends/test_base.py), [Redis tests](../../t/unit/backends/test_redis.py), [RPC tests](../../t/unit/backends/test_rpc.py), and [result tests](../../t/unit/tasks/test_result.py). For the caller that writes these states, follow [task execution](../workflows/task-execution.md).
