---
title: "Results and State"
---
## Overview

An `AsyncResult` identifies one task invocation and binds that ID to an application and backend. It provides metadata inspection, waiting and exception propagation after [[Task Execution and Retries]] records an outcome. Publication creates the handle without waiting for execution. Choose the storage implementation through [[Result Backend Catalogue]]; this page follows the result client's lifecycle and the shared backend metadata contract.

Sources: [celery/result.py:89-101](repo://celery/result.py#L89-L101), [celery/app/base.py:1025-1034](repo://celery/app/base.py#L1025-L1034), [celery/app/trace.py:619-627](repo://celery/app/trace.py#L619-L627)

## Interpret state and metadata

The backend stores a metadata record with status, result, traceback, child results and completion time. Ready-state records receive a completion timestamp; other states have no completion time. Group and parent identifiers can be added from request context. `AsyncResult.state` reads the record's status, while `children` exposes the stored child relationships. A ready record is cached by the result object and fulfills its ready promise.

Sources: [celery/backends/base.py:581-602](repo://celery/backends/base.py#L581-L602), [celery/result.py:457-467](repo://celery/result.py#L457-L467), [celery/result.py:504-534](repo://celery/result.py#L504-L534)

| State or set | Meaning in the implementation |
| --- | --- |
| `PENDING` | Unknown task state, assumed pending because the caller knows its ID |
| `RECEIVED` | Worker receipt, used in events |
| `STARTED` | Worker start when started-state tracking is enabled |
| `RETRY` | Waiting for another attempt |
| `SUCCESS`, `FAILURE`, `REVOKED` | Ready states |
| `FAILURE`, `REVOKED` | States whose exceptions propagate |
| `RETRY`, `FAILURE`, `REVOKED` | States treated as exception-bearing metadata |

Sources: [celery/states.py:126-147](repo://celery/states.py#L126-L147)

`PENDING` alone does not prove broker delivery or worker receipt. The key/value backend's lookup returns `PENDING` and no result when storage has no record for the ID. State comparison also uses explicit precedence rather than chronology: custom states rank below success/failure and above the other built-in states. Inspect delivery through [[Monitoring and Remote Control]] when the question is whether a worker received work, rather than whether backend metadata exists.

Sources: [celery/backends/base.py:1148-1154](repo://celery/backends/base.py#L1148-L1154), [celery/states.py:61-89](repo://celery/states.py#L61-L89), [celery/states.py:92-123](repo://celery/states.py#L92-L123)

## Wait and propagate outcomes

`get` returns immediately for an ignored result. Otherwise it rejects synchronous waits inside tasks by default, prepares parent-failure checks when requested, and uses cached metadata when available. Without a cache, it registers the result as pending and delegates to the backend's `wait_for_pending`. `follow_parents=True` and `propagate=True` make failures in linked parent results relevant to the current wait.

Sources: [celery/result.py:191-195](repo://celery/result.py#L191-L195), [celery/result.py:243-265](repo://celery/result.py#L243-L265)

The timeout limits the client wait and does not terminate the task. With propagation enabled, stored failure or revocation exceptions are raised; with propagation disabled, callers receive the stored exception value. `maybe_throw` centralizes that state check and can also invoke a supplied callback. The result API warns that every returned handle should eventually be retrieved or forgotten because backends allocate resources to store and transmit outcomes.

Sources: [celery/result.py:198-240](repo://celery/result.py#L198-L240), [celery/result.py:388-401](repo://celery/result.py#L388-L401)

Synchronous backends poll metadata until it reaches a ready state, sleeping by the configured interval and enforcing the timeout. The asynchronous backend mixin instead drains its result consumer until the ready promise resolves, then removes the pending registration. The public `interval` option therefore does not imply identical waiting behavior across backends. [[Result Backend Catalogue]] distinguishes implementations that expose native asynchronous result consumption.

Sources: [celery/backends/base.py:900-951](repo://celery/backends/base.py#L900-L951), [celery/backends/asynchronous.py:252-309](repo://celery/backends/asynchronous.py#L252-L309), [celery/result.py:216-219](repo://celery/result.py#L216-L219)

## Retrieve groups and dependency trees

`GroupResult` extends `ResultSet` with a group ID. The set's `get` selects native join when the backend supports it and otherwise uses ordinary join. A normal join returns values in member order, while callback-driven collection sends each received value to the callback instead of adding it to the collected list. The implementation passes each remaining share of the total timeout into member retrieval instead of granting every member the original full timeout.

Sources: [celery/result.py:726-747](repo://celery/result.py#L726-L747), [celery/result.py:759-826](repo://celery/result.py#L759-L826), [celery/result.py:928-935](repo://celery/result.py#L928-L935)

A group result can save its membership through the backend and restore it later by group ID. Deleting the saved group removes the group record; individual result forgetting is a separate operation. Group metadata persistence goes through the backend's retry wrapper, so failures depend on the configured backend policy. [[Canvas Workflows]] explains how groups and chords create these result relationships during composition.

Sources: [celery/result.py:964-1021](repo://celery/result.py#L964-L1021), [celery/backends/base.py:802-818](repo://celery/backends/base.py#L802-L818)

Result handles also retain an optional parent, and serialization includes that ancestry. `iterdeps` traverses children only after their parent is ready; an incomplete branch raises `IncompleteStream` unless intermediate traversal is requested. This provides a view of recorded relationships, whose availability depends on the child metadata stored by execution, rather than a separate reconstruction of every broker delivery.

Sources: [celery/result.py:123-134](repo://celery/result.py#L123-L134), [celery/result.py:337-349](repo://celery/result.py#L337-L349), [celery/backends/base.py:591-602](repo://celery/backends/base.py#L591-L602)

## Store, protect and discard metadata

Backend `store_result` first prepares exception or value representation, then delegates storage through `_ensure_retryable`. Retry eligibility depends on both `result_backend_always_retry` and the implementation's `exception_safe_to_retry`; backoff uses configured minimum, maximum and retry count. If a retry hook itself fails, the wrapper logs that failure and continues its retry loop. Backend retries concern metadata operations, independently of task retries described in [[Task Execution and Retries]].

Sources: [celery/backends/base.py:157-161](repo://celery/backends/base.py#L157-L161), [celery/backends/base.py:573-576](repo://celery/backends/base.py#L573-L576), [celery/backends/base.py:635-689](repo://celery/backends/base.py#L635-L689)

The key/value storage path reads existing metadata before writing and preserves an already stored `SUCCESS`. Its comment identifies the motivating race: a lost worker or network partition must not overwrite the last successful result with a later failure update. This guarantee belongs to that storage path; it does not make execution globally unique. Backend selection still determines persistence, expiration and transport behavior.

Sources: [celery/backends/base.py:1116-1138](repo://celery/backends/base.py#L1116-L1138)

`AsyncResult.forget` clears its local cache, recursively forgets parent results and asks the backend to remove the task's result. Its destructor removes pending registrations, which is a different cleanup operation from deleting stored metadata. Use the explicit result lifecycle alongside backend expiration settings; [[Result Backend Catalogue]] describes which implementations expire automatically or run cleanup.

Sources: [celery/result.py:136-145](repo://celery/result.py#L136-L145), [celery/result.py:444-447](repo://celery/result.py#L444-L447), [celery/backends/base.py:1113-1114](repo://celery/backends/base.py#L1113-L1114)
