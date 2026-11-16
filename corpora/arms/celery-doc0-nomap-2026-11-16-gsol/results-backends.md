---
title: "Results and Backends"
---
## Overview

The result backend connects worker outcomes to client result handles. `AsyncResult` contains an ID, application, backend, and optional parent; its state is obtained from backend metadata. The trace described in [[Worker Lifecycle and Execution]] calls backend completion methods, while [[Task Retries and Failure Handling]] determines which failures and retries should be stored. A broker URL and a result-backend URL configure separate services even when they use the same infrastructure.

Sources: [celery/result.py:89-101](repo://celery/result.py#L89-L101), [celery/result.py:470-496](repo://celery/result.py#L470-L496), [celery/app/trace.py:619-627](repo://celery/app/trace.py#L619-L627), [celery/app/base.py:394-398](repo://celery/app/base.py#L394-L398)

## Interpret task state

| State | Meaning in the code | Ready? |
| --- | --- | --- |
| `PENDING` | Unknown state, assumed pending when only an ID is known | No |
| `RECEIVED` | Worker receipt; used in events | No |
| `STARTED` | Started execution when tracking is enabled | No |
| `RETRY` | Waiting for retry | No |
| `SUCCESS` | Successful execution | Yes |
| `FAILURE` | Failed execution | Yes |
| `REVOKED` | Revoked task | Yes |

Sources: [celery/states.py:126-147](repo://celery/states.py#L126-L147)

`ready` checks membership in the backend's ready states, while `successful` and `failed` test specific states. A missing key in a key/value backend returns `PENDING` with a `None` result. Consequently `PENDING` alone does not prove that a message is queued. This checkout also exposes `AsyncResult.exists`, delegating to `task_result_exists`, to check whether the backend has a stored result; forgotten or expired results may be absent too.

Sources: [celery/result.py:351-383](repo://celery/result.py#L351-L383), [celery/backends/base.py:1148-1161](repo://celery/backends/base.py#L1148-L1161)

## Store an outcome

`mark_as_done` stores success when result storage is enabled and the request does not ignore results. It separately notifies chord completion when the request belongs to a chord. `store_result` prepares the result for encoding and invokes the backend-specific storage method through its retry helper. [[Canvas Workflows]] owns the chord flow; normal result storage is only one participant in that coordination.

Sources: [celery/backends/base.py:180-198](repo://celery/backends/base.py#L180-L198), [celery/backends/base.py:673-693](repo://celery/backends/base.py#L673-L693)

Metadata includes status, result, traceback, children, and completion date; ready states receive a completion timestamp. Requests can add group and parent IDs. With extended result metadata, the backend includes task name, arguments, worker, retry count, queue, and stamps. This metadata is a backend record, whereas the live receipt and execution stream belongs to [[Monitoring and Worker Control]].

Sources: [celery/backends/base.py:581-630](repo://celery/backends/base.py#L581-L630)

The key/value storage base first reads existing metadata and refuses to overwrite `SUCCESS` with a later state. Its comment identifies lost workers and network partitions as the race this protects against. The retry helper retries only when enabled and the backend considers the exception safe, uses exponential backoff with jitter, and raises the supplied backend error after exhausting its limit. Backend operation retries do not resubmit the task function.

Sources: [celery/backends/base.py:635-671](repo://celery/backends/base.py#L635-L671), [celery/backends/base.py:1116-1138](repo://celery/backends/base.py#L1116-L1138)

## Wait, propagate, and forget

`AsyncResult.get` returns immediately for ignored results, checks the guard against synchronous subtask joins by default, and can propagate parent failures. Cached results use `maybe_throw`; otherwise the result registers as pending and delegates to `backend.wait_for_pending`. [[Quickstart]] demonstrates retrieving a sum, but the same interface can return or raise an exception depending on `propagate`.

Sources: [celery/result.py:191-269](repo://celery/result.py#L191-L269)

Synchronous backends poll `get_task_meta` until a ready state appears, sleeping between reads and raising `TimeoutError` when the wait expires. The asynchronous mixin instead waits through a result consumer and then calls `maybe_throw`. RPC and Redis do not use the polling interval described by `get`. In every case, the client's timeout limits waiting rather than terminating the running task.

Sources: [celery/backends/base.py:918-944](repo://celery/backends/base.py#L918-L944), [celery/backends/asynchronous.py:295-308](repo://celery/backends/asynchronous.py#L295-L308), [celery/result.py:209-219](repo://celery/result.py#L209-L219)

`maybe_throw` raises values in propagation states when requested, optionally reconstructing a remote traceback with `tblib` and `task_remote_tracebacks`. Ready metadata is cached on the handle and reconstructs child results from tuples. `forget` clears the local cache, recursively forgets parents, removes pending-result registration, and asks the backend to forget the task ID. The `get` documentation requires eventually getting or forgetting each returned result to release resources.

Sources: [celery/result.py:136-143](repo://celery/result.py#L136-L143), [celery/result.py:202-207](repo://celery/result.py#L202-L207), [celery/result.py:388-401](repo://celery/result.py#L388-L401), [celery/result.py:461-485](repo://celery/result.py#L461-L485)

## Select a backend

`by_url` extracts the scheme, or separates a backend prefix from a driver URL at `+`. `by_name` merges built-in aliases, loader overrides, and `celery.result_backends` entry points before resolving the class. No selection means `disabled`. The alias table below identifies the registered adapters; choosing an alias still requires its importable implementation and service dependencies.

Sources: [celery/app/backends.py:15-69](repo://celery/app/backends.py#L15-L69), [setup.py:113-125](repo://setup.py#L113-L125)

| Alias | Adapter selected |
| --- | --- |
| `rpc` | AMQP RPC replies |
| `redis`, `rediss`, `sentinel` | Redis backend or Sentinel backend |
| `cache` | Cache backend |
| `db`, `database` | Database backend |
| `file` | Filesystem backend |
| `mongodb` | Mongo backend |
| `elasticsearch` | Elasticsearch backend |
| `cassandra` | Cassandra backend |
| `couchbase`, `couchdb` | Corresponding Couchbase or CouchDB backend |
| `cosmosdbsql`, `arangodb`, `riak` | Corresponding named database adapter |
| `consul`, `dynamodb` | Corresponding named store adapter |
| `azureblockblob`, `s3`, `gs` | Azure Blob, S3, or GCS backend |
| `disabled` | Dummy backend with result retrieval disabled |

Sources: [celery/app/backends.py:15-38](repo://celery/app/backends.py#L15-L38), [celery/backends/rpc.py:254-270](repo://celery/backends/rpc.py#L254-L270), [celery/backends/base.py:1263-1281](repo://celery/backends/base.py#L1263-L1281)

RPC publishes state and return values as replies using correlation IDs and request destinations. It declares itself nonpersistent and explicitly rejects chords, making the [[Quickstart]] RPC example unsuitable for a chord demonstration. Redis exposes native join and automatic expiration capabilities and has a dedicated chord completion path. Backend capability flags, rather than a shared URL interface alone, determine which workflow operations are available.

Sources: [celery/backends/rpc.py:147-159](repo://celery/backends/rpc.py#L147-L159), [celery/backends/rpc.py:214-221](repo://celery/backends/rpc.py#L214-L221), [celery/backends/rpc.py:254-270](repo://celery/backends/rpc.py#L254-L270), [celery/backends/redis.py:220-221](repo://celery/backends/redis.py#L220-L221), [celery/backends/redis.py:608-663](repo://celery/backends/redis.py#L608-L663)

The cache adapter selects among memcache clients and an in-memory dummy client; it advertises native join, automatic expiration, and increment support. Filesystem storage writes encoded values into files under its configured directory and reads missing files as absent values. These adapters share the key/value result contract while differing in storage and cleanup behavior. The disabled backend accepts storage as a no-op but raises for result retrieval and chords.

Sources: [celery/backends/cache.py:82-116](repo://celery/backends/cache.py#L82-L116), [celery/backends/filesystem.py:25-48](repo://celery/backends/filesystem.py#L25-L48), [celery/backends/filesystem.py:77-96](repo://celery/backends/filesystem.py#L77-L96), [celery/backends/base.py:1263-1281](repo://celery/backends/base.py#L1263-L1281)

## Backend participation in chords

The base `apply_chord` validates support, builds a group result, and schedules a fallback unlock operation. Redis instead tracks header-part counts and stored results, joins or decodes them when the count reaches the chord size, and invokes the callback with the result list. [[Canvas Workflows]] explains how the header and body are prepared; backend choice supplies the mechanism that notices the header is complete.

Sources: [celery/backends/base.py:861-867](repo://celery/backends/base.py#L861-L867), [celery/backends/redis.py:608-663](repo://celery/backends/redis.py#L608-L663)
