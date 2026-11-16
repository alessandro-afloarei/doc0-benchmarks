---
title: "Task Results"
---
## Overview

An `AsyncResult` identifies a task and connects it to an application and backend. It does not execute the task when constructed: it holds the ID, optional parent, readiness promise and metadata cache used to observe execution. [[Canvas Workflows]] builds trees of these handles, while [[Result Backends]] describes the storage and notification adapters behind them.

Sources: [celery/result.py:89-125](repo://celery/result.py#L89-L125), [celery/result.py:243-269](repo://celery/result.py#L243-L269)

## States and the meaning of pending

| State | Meaning in result handling |
| --- | --- |
| `PENDING` | State is unknown; knowing the ID makes it assumed pending |
| `STARTED` | Worker has recorded task startup when tracking is enabled |
| `RETRY` | Task is waiting for a retry; not a ready result |
| `SUCCESS` | Ready result containing the return value |
| `FAILURE` | Ready exceptional result that propagates by default |
| `REVOKED` | Ready revoked result that propagates by default |
| `RECEIVED`, `REJECTED` | States used in events rather than ordinary stored task progress |

Sources: [celery/states.py:126-151](repo://celery/states.py#L126-L151)

For key-value backends, missing stored metadata becomes `PENDING` with a null result. That state alone cannot prove whether a task was submitted, is queued, was forgotten or expired. This checkout exposes `AsyncResult.exists()`, which asks the backend whether a stored result exists. The key-value implementation checks the key directly, while the generic implementation falls back to testing whether metadata has a non-pending status. Even a false existence check is therefore about stored evidence, not proof that publication never happened.

Sources: [celery/backends/base.py:1148-1171](repo://celery/backends/base.py#L1148-L1171), [celery/backends/base.py:774-797](repo://celery/backends/base.py#L774-L797), [celery/result.py:351-367](repo://celery/result.py#L351-L367)

`ready()` tests membership in the backend's ready states, while `successful()` and `failed()` test for `SUCCESS` and `FAILURE`. A retry is an exceptional state but is not in the propagation set, which contains failure and revocation. `maybe_throw` reads cached or backend metadata, raises the stored exception when propagation applies, and can invoke a callback with the ID and value.

Sources: [celery/result.py:369-411](repo://celery/result.py#L369-L411), [celery/states.py:144-147](repo://celery/states.py#L144-L147)

## Waiting and exception propagation

`get` returns immediately for an ignored handle. Otherwise it checks the synchronous-subtask guard, optionally checks parent failures, returns a cached result when available, or adds the handle to the backend's pending set and delegates to `wait_for_pending`. With `follow_parents=True` and propagation enabled, failure in a parent can be raised before the requested child finishes. This supports the result ancestry created by [[Canvas Workflows]].

Sources: [celery/result.py:243-274](repo://celery/result.py#L243-L274)

The timeout on `get` bounds the client's wait and does not terminate the worker task. `propagate=False` returns a task exception as a value instead of re-raising it. The polling interval is backend-dependent: the API explicitly notes that RPC and Redis result stores do not use it for polling. [[Worker Execution]] describes worker time limits, which are a different mechanism from a caller deciding how long to wait.

Sources: [celery/result.py:191-241](repo://celery/result.py#L191-L241)

The default guard rejects synchronous joins from task execution contexts that declare them blocking. `allow_join_result` temporarily changes that flag and restores it afterward, while `denied_join_result` enforces the opposite. The result API warns that waiting for tasks inside tasks can deadlock; Canvas continuations let the worker publish dependent work after success rather than holding a task open for a synchronous join.

Sources: [celery/result.py:30-58](repo://celery/result.py#L30-L58), [celery/result.py:198-200](repo://celery/result.py#L198-L200), [celery/app/trace.py:467-473](repo://celery/app/trace.py#L467-L473)

## Metadata, storage and caching

The backend's result metadata includes status, result, traceback, children and completion time. Request context can add group and parent IDs. With extended results enabled, metadata can include task name, arguments, keyword arguments, worker, retries, queue and stamps. These values are execution metadata, so enabling extended results changes what is retained in storage beyond the return value itself.

Sources: [celery/backends/base.py:580-630](repo://celery/backends/base.py#L580-L630)

`mark_as_done` stores the successful result only when storage is enabled and the request does not ignore results; chord-part notification has its own branch. `store_result` encodes the result and delegates the write through the backend retry helper. For key-value stores, `_store_result` refuses to overwrite an existing successful result with a later state, explicitly preventing a lost-worker or network-partition race from replacing success. This storage invariant complements the redelivery behavior in [[Worker Execution]].

Sources: [celery/backends/base.py:180-186](repo://celery/backends/base.py#L180-L186), [celery/backends/base.py:673-693](repo://celery/backends/base.py#L673-L693), [celery/backends/base.py:1116-1138](repo://celery/backends/base.py#L1116-L1138)

Backend retries require both `always_retry` and an adapter classifying the exception as safe to retry. The helper uses bounded exponential backoff with jitter, calls the adapter's retry-error hook, and ultimately raises a fallback storage or retrieval error when configured. Result observation therefore has its own failure boundary: successful task execution does not guarantee every later backend operation succeeds.

Sources: [celery/backends/base.py:635-671](repo://celery/backends/base.py#L635-L671), [celery/backends/base.py:759-768](repo://celery/backends/base.py#L759-L768)

## Group joins and ordering

`GroupResult` extends a result set with an ID. A set is ready when all children are ready, successful when all succeeded, and failed when any child failed. `completed_count` counts successful children, so its name does not mean every terminal outcome. The `get` method selects native joining when supported, otherwise ordinary joining; backend capabilities are catalogued in [[Result Backends]].

Sources: [celery/result.py:644-695](repo://celery/result.py#L644-L695), [celery/result.py:725-744](repo://celery/result.py#L725-L744), [celery/result.py:928-935](repo://celery/result.py#L928-L935)

Ordinary `join` walks results in their stored order, subtracting elapsed time from the overall timeout before each child wait. Without a callback it returns values in that order. With a callback it passes each task ID and value to the callback and returns an empty list. Native join uses backend iteration and places arrivals back into result order unless a callback consumes them; its callback form returns no aggregate result. Code consuming both paths should not depend on their callback return values being identical.

Sources: [celery/result.py:789-825](repo://celery/result.py#L789-L825), [celery/result.py:851-884](repo://celery/result.py#L851-L884)

## Release results and saved groups

Eventually consume or forget each result, as the API warns that backends use resources to store and transmit them. `AsyncResult.forget` clears the local cache, recursively forgets parents, removes the pending registration and asks the backend to delete the task result. Waiting with `get` does not mean every backend deletes durable metadata immediately; explicit forgetting is the deletion path exposed here.

Sources: [celery/result.py:136-143](repo://celery/result.py#L136-L143), [celery/result.py:202-207](repo://celery/result.py#L202-L207), [celery/backends/base.py:695-700](repo://celery/backends/base.py#L695-L700)

A group can save its identity and child references through the backend and later restore them with `GroupResult.restore`. Deleting that saved group record is distinct from forgetting its child task results. These operations require the chosen adapter to implement the group-storage contract; consult [[Result Backends]] before relying on saved groups across client processes.

Sources: [celery/result.py:958-970](repo://celery/result.py#L958-L970), [celery/result.py:1014-1021](repo://celery/result.py#L1014-L1021), [celery/backends/base.py:1140-1146](repo://celery/backends/base.py#L1140-L1146)
