---
title: "Result Backends"
---
## Overview

Result backends translate execution outcomes into stored metadata or reply messages and provide the retrieval interface used by [[Results and State]]. They also participate in chord completion: `mark_as_done` conditionally stores a result and notifies `on_chord_part_return` for chord members. Backend selection therefore affects persistence, waiting, cleanup and workflow coordination. Broker transport and result storage remain separately configured application components even when they happen to use the same external service.

Sources: [celery/backends/base.py:180-186](repo://celery/backends/base.py#L180-L186), [celery/app/base.py:394-398](repo://celery/app/base.py#L394-L398), [celery/app/base.py:1224-1228](repo://celery/app/base.py#L1224-L1228)

## Resolve the configured implementation

The application passes its backend class override or `result_backend` setting to `by_url`, then instantiates the selected class with the application and URL. A plain URL scheme selects an alias; a scheme containing `+` separates a backend selector from the underlying connection URL. `by_name` combines built-in aliases, loader overrides and `celery.result_backends` entry points. Missing configuration selects `disabled`; resolving a module instead of a backend class raises `ImproperlyConfigured`.

Sources: [celery/app/base.py:1224-1228](repo://celery/app/base.py#L1224-L1228), [celery/app/backends.py:41-69](repo://celery/app/backends.py#L41-L69)

The built-in selection table groups related aliases below. These names describe available resolution targets, not interchangeable feature guarantees. In particular, a backend's result interface does not imply native joins, automatic expiration or chord support; inspect the implementation's capabilities before selecting it for the coordination pattern in [[Canvas Workflows]].

Sources: [celery/app/backends.py:15-38](repo://celery/app/backends.py#L15-L38), [celery/backends/base.py:121-129](repo://celery/backends/base.py#L121-L129), [celery/backends/rpc.py:214-215](repo://celery/backends/rpc.py#L214-L215)

| Storage family | Configured aliases and targets |
| --- | --- |
| Reply messaging | `rpc` selects RPCBackend |
| Redis | `redis` and `rediss` select RedisBackend; `sentinel` selects SentinelBackend |
| Cache | `cache` selects CacheBackend |
| SQL | `db` and `database` select DatabaseBackend |
| Document and search | `mongodb`, `couchdb`, `couchbase`, `elasticsearch`, `arangodb`, `cosmosdbsql` select their named adapters |
| Distributed stores | `cassandra`, `consul`, `dynamodb` select their named adapters |
| Files and object storage | `file`, `s3`, `gs`, `azureblockblob` select filesystem, S3, GCS and Azure adapters |
| Disabled results | `disabled` selects DisabledBackend |

Sources: [celery/app/backends.py:15-38](repo://celery/app/backends.py#L15-L38)

## Shared storage and retry contracts

The common `store_result` encodes the value, then calls `_store_result` through `_ensure_retryable`. Retries occur only when backend retries are enabled and the implementation classifies the exception as safe to retry. The helper invokes a recovery hook, waits with bounded exponential backoff and raises a contextual backend error when configured attempts are exhausted. Forgetting uses the same retry wrapper. These operations concern result persistence, distinct from task execution retries and message-publishing retries.

Sources: [celery/backends/base.py:635-700](repo://celery/backends/base.py#L635-L700)

Key-value storage constructs result metadata, adds the task identifier and checks the existing value before writing. A previously successful result suppresses later updates; the comment explains that this prevents a lost task from overwriting success after a network partition or worker loss. Group structures use separate group keys. This is an implementation-specific safeguard in the common key-value path, rather than a blanket transactional guarantee for all backend families.

Sources: [celery/backends/base.py:1116-1146](repo://celery/backends/base.py#L1116-L1146)

## Reply, Redis and cache behavior

RPC uses a reply queue shared across a process's tasks. Before task publication it declares that queue when necessary; result publication targets the request's `reply_to` and correlation identifier. A request without a reply routing key causes no reply to be sent. RPC defaults to nonpersistent delivery, with persistence configurable at construction or through application settings. It explicitly rejects chords, so choose another backend when the application needs a group completion body rather than independent replies.

Sources: [celery/backends/rpc.py:155-195](repo://celery/backends/rpc.py#L155-L195), [celery/backends/rpc.py:209-279](repo://celery/backends/rpc.py#L209-L279), [celery/backends/base.py:567-571](repo://celery/backends/base.py#L567-L571)

Redis stores a value and publishes it to its result channel in a pipeline, using `setex` when expiration is configured. Submission can subscribe the result consumer to the task identifier; forgetting also cancels that subscription. Its get and multi-get operations expose key-based retrieval, while connection errors go through its retry policy. This combination supports both stored values and notification-driven waits, explaining the retrieval distinction described in [[Results and State]].

Sources: [celery/backends/redis.py:492-546](repo://celery/backends/redis.py#L492-L546)

The cache adapter resolves `memcache`, `memcached`, `pylibmc` or `memory` clients. It passes configured expiration into set operations, exposes multi-get and increment, and declares native join and automatic expiration support. Its increment-based chord setup initializes a counter with expiration. Select a client according to the cache implementation configured for the application; the `memory` choice uses `DummyClient`, so the backend selector itself does not provision an external cache service.

Sources: [celery/backends/cache.py:82-145](repo://celery/backends/cache.py#L82-L145)

## Database and file storage

The SQL backend configures task and group table names and schemas, merges engine options with constructor overrides and requires a connection URL. It optionally creates tables during setup. Storing a task queries by identifier, inserts a row when absent, updates result metadata and commits. A retryable database failure invalidates the session manager's engine state before retry. Extended results select the extended task model, so metadata configuration influences the stored row shape as well as the returned value.

Sources: [celery/backends/database/__init__.py:67-168](repo://celery/backends/database/__init__.py#L67-L168)

Filesystem storage maps keys to files in a configured `file://` directory. Construction performs a write-read-delete test and rejects an invalid directory. Gets return file bytes, sets write encoded bytes and cleanup scans task, group and chord prefixes against modification-time expiration. Choose this adapter only when all participating backend instances can access the intended directory; its implementation contains filesystem calls, with no remote file-distribution mechanism.

Sources: [celery/backends/filesystem.py:45-110](repo://celery/backends/filesystem.py#L45-L110)

## Object storage behavior

S3 requires its client dependency and a bucket name, accepts endpoint, region and base-path settings, and maps keys to objects whose bodies hold result bytes. Azure Block Blob similarly maps a key plus base path to a blob in a container, returning no value for a missing blob and overwriting on set. GCS downloads and uploads result blobs and can attach a custom expiration time. These adapters preserve the key-value result interface while changing the underlying read and write operation.

Sources: [celery/backends/s3.py:30-77](repo://celery/backends/s3.py#L30-L77), [celery/backends/azureblockblob.py:107-151](repo://celery/backends/azureblockblob.py#L107-L151), [celery/backends/gcs.py:86-105](repo://celery/backends/gcs.py#L86-L105)

GCS adds a separate coordination dependency: its backend uses Firestore for chord reference counts, requires the Firestore libraries and verifies a TTL policy on the configured collection. Missing that policy raises `ImproperlyConfigured`. Thus configuring a storage bucket alone is insufficient for this implementation; coordination and expiration configuration must satisfy its constructor as well.

Sources: [celery/backends/gcs.py:161-193](repo://celery/backends/gcs.py#L161-L193)

## Complete chords and disable results deliberately

Redis's chord callback stores each member's encoded outcome in a sorted set or list, counts completed members and compares against the expected size plus adjustments. At completion it restores and joins a saved complex group when needed, or decodes the collected values directly, then publishes the body. Coordination keys are removed after callback dispatch is attempted, while join and callback errors become chord errors. [[Canvas Workflows]] describes the polling unlock alternative used by backends without that native path.

Sources: [celery/backends/redis.py:593-686](repo://celery/backends/redis.py#L593-L686)

The disabled backend makes storage a no-op and raises for result access and chord support. Use that behavior only when callers do not require backend results and workflows do not require backend coordination. It is also the fallback for an unspecified backend, which explains why publishing a task can work while a later attempt to wait for its result fails. The result client's explicit cleanup and waiting contracts remain documented in [[Results and State]].

Sources: [celery/app/backends.py:41-49](repo://celery/app/backends.py#L41-L49), [celery/backends/base.py:1263-1281](repo://celery/backends/base.py#L1263-L1281)
