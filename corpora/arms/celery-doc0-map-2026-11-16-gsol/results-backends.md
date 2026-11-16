---
title: "Results and Backends"
---
## Overview

An `AsyncResult` associates a task ID with an application, backend and optional parent. It queries or waits for an outcome independently of the publication that created the ID. Workers report completion through backend methods such as `mark_as_done` and `mark_as_failure`; these methods also notify chord coordination when the request belongs to a chord. [[Canvas Workflows]] explains the composition that creates those dependencies.

Sources: [celery/result.py:90-101](repo://celery/result.py#L90-L101), [celery/backends/base.py:180-199](repo://celery/backends/base.py#L180-L199)

## Select and configure a backend

The application resolves `result_backend` through `by_url`, instantiates the selected class with the application and URL, and defaults to a disabled backend if no name is supplied. URL schemes select aliases; a `+` in the scheme separates a backend name from its underlying URL. Aliases can be overridden by the loader or supplied through the `celery.result_backends` extension namespace. [[Applications and Configuration]] describes how those settings reach the application.

Sources: [celery/app/base.py:1224-1228](repo://celery/app/base.py#L1224-L1228), [celery/app/backends.py:41-69](repo://celery/app/backends.py#L41-L69)

Backend initialization chooses `result_serializer`, an optional result cache, expiration and retry settings. Accepted content follows explicit `accept`, then `result_accept_content`, then general `accept_content`. Encoding and decoding use the selected serializer and that acceptance policy. This makes result deserialization a separate policy surface from task publication; [[Message Security]] covers the exception reconstruction checks applied to decoded failure results.

Sources: [celery/backends/base.py:140-165](repo://celery/backends/base.py#L140-L165), [celery/backends/base.py:528-565](repo://celery/backends/base.py#L528-L565)

## Interpret states and existence

| State group | Meaning in this implementation |
| --- | --- |
| `PENDING` | State is unknown and assumed pending from the known ID |
| `STARTED` | Worker-started tracking is enabled and an execution has started |
| `RETRY` | An attempt is waiting for retry; it is not ready |
| `SUCCESS`, `FAILURE`, `REVOKED` | Terminal states included in `READY_STATES` |
| `RECEIVED`, `REJECTED` | States identified as event-only in the state definitions |
| `FAILURE`, `REVOKED` | States whose exceptions propagate to result callers by default |

Sources: [celery/states.py:126-147](repo://celery/states.py#L126-L147)

For key/value backends, missing metadata produces `PENDING` with a `None` result. `AsyncResult.exists()` delegates to `task_result_exists`; the key/value implementation checks whether the stored key exists rather than guessing from state. A false result can correspond to a task whose result was never stored, was forgotten or expired. It is a storage check, so it cannot prove that the broker accepted a message or that a worker has reserved it.

Sources: [celery/result.py:351-367](repo://celery/result.py#L351-L367), [celery/backends/base.py:1148-1169](repo://celery/backends/base.py#L1148-L1169)

## Wait for one or many results

`AsyncResult.get` returns immediately when result retrieval is marked ignored. Otherwise it guards against synchronous subtask joins, checks parent failure when requested, returns a cached outcome when available, or adds itself to the backend's pending set and calls `wait_for_pending`. Ready metadata is cached and fulfills the handle's readiness promise. A client can therefore receive a ready value from cache without another backend wait.

Sources: [celery/result.py:243-265](repo://celery/result.py#L243-L265), [celery/result.py:461-468](repo://celery/result.py#L461-L468)

The `timeout` argument limits waiting in the client and does not terminate the worker task. With propagation enabled, remote failure is raised locally; with propagation disabled the exception instance can be returned. The API warns that waiting for child tasks inside another task can deadlock, so synchronous joins are disabled by default. [[Tasks and Retries]] follows execution state changes, while [[Monitoring and Remote Control]] covers commands that can influence a running task.

Sources: [celery/result.py:191-241](repo://celery/result.py#L191-L241)

Synchronous backends repeatedly fetch metadata, sleep for `interval` and stop at a ready state or timeout. They reject `on_message`. Asynchronous backends instead register pending results, consume the task's result channel, drain messages and cancel that consumption after fulfillment. Redis subscribes to task result keys through pub/sub. Consequently, changing the polling interval does not control RPC or Redis waiting in the same way as a polling backend.

Sources: [celery/backends/base.py:900-944](repo://celery/backends/base.py#L900-L944), [celery/backends/asynchronous.py:260-308](repo://celery/backends/asynchronous.py#L260-L308), [celery/backends/redis.py:175-201](repo://celery/backends/redis.py#L175-L201), [celery/result.py:216-219](repo://celery/result.py#L216-L219)

`ResultSet.get` chooses `join_native` when supported and otherwise `join`. Ordinary joining returns values in the set's original order and shares its timeout budget across member waits. A callback changes collection behavior: ordinary `join` calls it for each ID and value instead of accumulating values, while native join has its own documented return convention. These collections are the result-facing side of the groups in [[Canvas Workflows]].

Sources: [celery/result.py:726-735](repo://celery/result.py#L726-L735), [celery/result.py:789-823](repo://celery/result.py#L789-L823)

## Backend catalogue

| Backend selection | Implemented behavior or boundary |
| --- | --- |
| `rpc` | Reply messages use the request's reply destination and correlation ID; chords are refused |
| `redis`, `rediss`, `sentinel` | Select Redis or Sentinel implementations; Redis combines key/value storage with asynchronous result consumption |
| `db`, `database` | Select the database backend, which opens sessions, creates or updates task rows and commits results |
| `cache` | Selects a cache client such as memcached or memory; advertises autoexpiration, native join and increment support |
| `file` | Uses a directory URL and validates read/write/delete access during construction |
| `disabled` | Ignores result writes and raises when retrieval or chord support is required |
| Service adapters | Registry aliases include MongoDB, Elasticsearch, Cassandra, Couchbase, CouchDB, Cosmos DB SQL, Riak, Consul, DynamoDB, Azure Block Blob, ArangoDB, S3 and GCS |

Sources: [celery/app/backends.py:15-38](repo://celery/app/backends.py#L15-L38), [celery/backends/rpc.py:214-238](repo://celery/backends/rpc.py#L214-L238), [celery/backends/redis.py:175-205](repo://celery/backends/redis.py#L175-L205), [celery/backends/database/__init__.py:127-149](repo://celery/backends/database/__init__.py#L127-L149), [celery/backends/cache.py:82-116](repo://celery/backends/cache.py#L82-L116), [celery/backends/filesystem.py:36-75](repo://celery/backends/filesystem.py#L36-L75), [celery/backends/base.py:1263-1281](repo://celery/backends/base.py#L1263-L1281)

RPC prepares the reply queue before task publication, except where prefork execution already implies the queue is declared. It routes result messages to request metadata rather than a generic persistent task table. Use its documented no-chord boundary when choosing a backend for the [[Quickstart]] example versus a chord workflow. Redis's native chord completion path and the generic polling unlock path are described once in [[Canvas Workflows]].

Sources: [celery/backends/rpc.py:209-238](repo://celery/backends/rpc.py#L209-L238), [celery/backends/base.py:864-867](repo://celery/backends/base.py#L864-L867)

## Store outcomes and handle backend failures

`store_result` encodes the outcome and calls the backend's `_store_result` through `_ensure_retryable`, attaching the task ID and state to storage errors. Retry configuration includes maximum attempts and exponential backoff bounds; retry is conditional on both `always_retry` and the backend's classification of the exception. The database backend preserves its historical default of enabled retries with a maximum of three, rather than using the base defaults unchanged.

Sources: [celery/backends/base.py:157-161](repo://celery/backends/base.py#L157-L161), [celery/backends/base.py:635-693](repo://celery/backends/base.py#L635-L693), [celery/backends/database/__init__.py:62-66](repo://celery/backends/database/__init__.py#L62-L66)

Key/value storage checks existing metadata and preserves an already successful result against later state updates. The comment ties this to lost-worker and network-partition races that could overwrite success. This is an implemented metadata rule, not a transaction spanning the task's external effects and broker acknowledgement; [[Worker Lifecycle and Delivery]] describes that separate delivery boundary.

Sources: [celery/backends/base.py:1116-1138](repo://celery/backends/base.py#L1116-L1138)

## Release result resources

`AsyncResult.forget` clears its cache, recursively forgets parents, removes pending consumption and asks the backend to forget the ID. The backend clears its cache and delegates deletion; implementations differ in whether deletion is supported. The public result API requires eventually retrieving or forgetting every retained result because backends spend resources storing and transmitting them.

Sources: [celery/result.py:136-143](repo://celery/result.py#L136-L143), [celery/result.py:203-207](repo://celery/result.py#L203-L207), [celery/backends/base.py:695-700](repo://celery/backends/base.py#L695-L700)

Expiration cleanup is backend-specific. Database cleanup deletes expired task and group rows in a session and commits. Beat installs a `celery.backend_cleanup` entry when results expire and the backend does not support automatic expiration. [[Periodic Scheduling]] follows how that maintenance task is scheduled and published.

Sources: [celery/backends/database/__init__.py:237-250](repo://celery/backends/database/__init__.py#L237-L250), [celery/beat.py:268-277](repo://celery/beat.py#L268-L277)
