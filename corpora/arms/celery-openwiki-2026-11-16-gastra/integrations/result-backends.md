---
type: integration
title: Results, persistence and backend contracts
description: Result state interpretation, AsyncResult waiting, backend retries and expiration, and the differences between Redis, RPC, and database coordination.
tags: [results, backend, persistence, redis, rpc, database]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:55:28.912Z
sources:
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
  - id: openwiki-source-30739e9c6aac84ef121d58dc
    resource: repo://celery/states.py
generated: { by: "codex", at: "2026-11-16T07:55:28.912Z" }
---

# Results, persistence and backend contracts

A result backend is distinct from the task broker. The broker delivers work; the backend stores or transports state and return values. Choose `result_backend` independently of `broker_url`, and install the corresponding package extras. An `AsyncResult` is a client-side handle for a task ID, not proof that a task ran or that its result exists.

## Reading state and waiting

`SUCCESS`, `FAILURE`, and `REVOKED` are ready states; `RETRY` is not terminal. FAILURE and REVOKED belong to the default exception-propagation set. A missing key in the key/value backend, or missing database row, produces PENDING with no result. PENDING therefore also covers unknown or expired IDs; it does not prove a task is waiting in a broker queue.

`AsyncResult.get(timeout=...)` delegates waiting to the backend and normally propagates remote failure. Its timeout limits the caller's wait and does not terminate worker execution. The default synchronous-subtask guard rejects blocking waits from task execution where they can deadlock a pool. An ignored result returns immediately. Release result resources through `get()` or `forget()` as appropriate.

STARTED storage is conditional on task tracking and result policy; receipt events are not a guaranteed backend state history. With no configured result backend, the disabled backend cannot support result waiting or chords.

## Storage and retry contract

The base backend selects result serialization and accepted content, prepares metadata, and delegates storage to the implementation. Its retry wrapper only retries when `result_backend_always_retry` is enabled **and** the backend classifies the exception as safe to retry. It uses jittered exponential backoff bounded by the sleep configuration and `result_backend_max_retries`; retry exhaustion can raise a backend-specific wrapper such as `BackendStoreError` or `BackendGetMetaError`.

This is a storage-operation retry, separate from task retries and producer publication retries. A backend outage can occur after user code has already produced side effects. See [worker acknowledgement](../architecture/worker.md) before assuming redelivery safely repairs storage failures.

The base key/value implementation reads existing metadata before writing and preserves an existing SUCCESS result against subsequent updates. This is an implementation-level guard, not a universal atomic compare-and-set contract for all backends. The database backend has its own update logic.

## Representative backend differences

| Backend | Result mechanism | Coordination and lifecycle |
| --- | --- | --- |
| Redis | Stores task metadata under keys and publishes updates through Redis pub/sub | Supports native joins, expiration, and native chord accounting |
| RPC | Publishes replies to the request's reply destination and correlation ID | Uses a shared reply queue per client process; defaults to nonpersistent messages; explicitly rejects chords |
| Database | Queries and commits SQLAlchemy task/group records | Supports fallback chord unlock; cleanup deletes records older than configured expiration |
| Disabled | Ignores result writes | Cannot provide chord coordination or normal result retrieval |

Redis writes use a pipeline with SET/SETEX and PUBLISH. Chord parts accumulate under group keys with completion counts and expected size; on completion the backend reconstructs results, dispatches the body, and cleans coordination keys. Complex group structure may require restoring a saved GroupResult. Coordination expiration must be long enough for the workflow.

The base chord implementation schedules `celery.chord_unlock` for backends without specialized completion accounting. RPC rejects this capability explicitly. Do not choose a backend solely because ordinary `get()` works if the application also requires chords.

## Extension and verification

Backend extensions must implement their storage contract and explicitly declare retry-safe exceptions and capabilities; the base `exception_safe_to_retry` returns false. Result acceptance defaults to `result_accept_content`, falling back to `accept_content`; see [security](../operations/security.md).

Focused tests live in [test_base.py](../../t/unit/backends/test_base.py), [test_redis.py](../../t/unit/backends/test_redis.py), [test_rpc.py](../../t/unit/backends/test_rpc.py), [test_database.py](../../t/unit/backends/test_database.py), and [test_result.py](../../t/unit/tasks/test_result.py). Broker/service behavior belongs in [integration backend tests](../../t/integration/test_backend.py). Read [Canvas](../workflows/canvas.md) for workflow-level success and failure propagation, and [worker operations](../operations/workers.md) for diagnosing queue versus backend failures.
