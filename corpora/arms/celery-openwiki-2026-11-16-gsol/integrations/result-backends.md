---
type: integration
title: Results, persistence and backend contracts
description: Result handles, state storage and expiry, synchronous and asynchronous retrieval, Redis chord coordination and RPC backend limits.
tags: [results, backends, persistence, chords]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:34:04.042Z
sources:
  - id: openwiki-source-868b95b69384872926804a54
    resource: repo://celery/app/builtins.py
  - id: openwiki-source-98fa58283cefff1b0e071bbe
    resource: repo://celery/backends/base.py
  - id: openwiki-source-6b95f00dc919dfdb3eec1511
    resource: repo://celery/backends/redis.py
  - id: openwiki-source-a4d1ab266bef232afaa055d8
    resource: repo://celery/backends/rpc.py
  - id: openwiki-source-2a32c4e613bc7be1d621d647
    resource: repo://celery/beat.py
  - id: openwiki-source-33fca59793af7cfa460b223c
    resource: repo://celery/result.py
generated: { by: "codex", at: "2026-11-16T06:34:04.042Z" }
---

# Results, persistence and backend contracts

The broker delivers task invocations; the result backend stores or transports execution metadata. Configure these independently. `AsyncResult` combines a task ID, an application and a backend; constructing one does not submit work or prove that a task exists.

## Reading and releasing results

`AsyncResult.get()` waits through the backend and normally re-raises remote failures. `propagate=False` returns an exception value instead. Its timeout limits the client's wait and does not terminate worker execution. Waiting synchronously for subtasks inside a task is guarded by default because it can exhaust worker capacity and deadlock; compose a [Canvas workflow](../workflows/canvas.md) instead.

An ignored result returns from `get()` without waiting. For key-value backends, absent metadata is reported as `PENDING`; that can mean a result has not arrived, has expired or never existed. It is not a worker-queue query.

The synchronous backend mixin polls `get_task_meta()` at an interval. Redis and RPC use asynchronous result consumers, so the polling interval on `get()` does not control their retrieval cadence. Native join support is another backend capability, used for efficient result-set retrieval.

Call `get()` or `forget()` as appropriate to release result resources. `forget()` clears local state, removes pending registration, delegates deletion to the backend and recursively forgets parent results. Reading a result is not a universal delete operation; retention still depends on backend behavior and expiry.

## State writes, serialization and retention

The backend base encodes results before storing them and wraps storage in its retry machinery. Settings include `result_serializer`, `result_accept_content`, `result_backend_always_retry` and retry timing/limits. Result content acceptance falls back to `accept_content` if no result-specific list is configured. Keep result serialization compatible with result readers, not just workers.

`mark_as_done()` conditionally stores success and invokes chord-part completion when applicable. Failure handling also propagates into chains and chords. In the shared key-value implementation, a stored `SUCCESS` result suppresses later state overwrites, protecting an existing success from a subsequent failed/redelivered execution's metadata. This is not a transaction around application side effects.

`result_expires` supplies backend retention. Backends advertise `supports_autoexpire`; beat installs a cleanup task for backends needing periodic cleanup. The disabled backend discards stores and rejects result reads and chords, so a successful task can run without a usable result store.

## Chord coordination is backend-specific

| Backend path | Completion mechanism | Operational consequence |
| --- | --- | --- |
| Base fallback | Publishes `celery.chord_unlock`, which checks header readiness, retries, joins results and publishes the body | Workers must execute unlock tasks and retain header results |
| Redis | Stores each part in a sorted set by default, tracks expected count and dynamic additions, and publishes the body when complete | Chord keys and expiry are part of correctness, alongside task result keys |
| RPC | Reply-message result transport; explicitly rejects chords | A group chained into a body also requires a different backend |

Redis can use a list instead of a sorted set through `result_backend_transport_options['result_chord_ordered']`. Complex nested header results may be saved separately so the body receives their intended structure. Redis converts failed dependencies into chord errors and routes body publication failures into the chord error path.

Do not ignore results needed for chord synchronization. Set retention long enough for the workflow and its retries, then test failure and timeout paths with the selected backend. See [execution semantics](../workflows/execution.md) for the relationship between result writes, retries and acknowledgements.

## Extending and testing a backend

Choose the base matching storage and retrieval capabilities, then implement storage, reads, forgetting/expiry, safe retry classification and any chord support. Capability flags such as persistence, automatic expiry and native join affect callers' behavior and must describe actual guarantees.

Use `t/unit/backends/test_base.py`, `test_redis.py`, `test_rpc.py` and `t/unit/tasks/test_result.py` for focused behavior. `t/integration/test_canvas.py` verifies cross-process workflow behavior; [development workflows](../testing/development.md) explains how to provide real services.
