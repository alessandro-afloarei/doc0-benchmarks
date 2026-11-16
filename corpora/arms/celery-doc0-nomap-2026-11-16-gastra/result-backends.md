---
title: "Result Backends"
---
## Overview

Result backends implement storage, retrieval and sometimes completion notification behind [[Task Results]]. The application's backend resolver selects a class separately from broker transport selection. Adapters share result metadata interfaces, but differ in expiry, group storage, native joins and chord synchronization. A workflow that relies on those capabilities must use an adapter that implements them; a shared `AsyncResult` interface does not make all backends interchangeable.

Sources: [celery/app/backends.py:15-69](repo://celery/app/backends.py#L15-L69), [celery/backends/rpc.py:147-159](repo://celery/backends/rpc.py#L147-L159), [celery/backends/rpc.py:214-215](repo://celery/backends/rpc.py#L214-L215), [celery/backends/cache.py:90-96](repo://celery/backends/cache.py#L90-L96)

## Backend selection and extension

`by_url` extracts a scheme and returns the backend class plus its URL. A compound scheme separates the backend name from the underlying service URL at `+`, supporting adapters whose service has its own scheme. `by_name` starts with built-in aliases, merges loader overrides, then loads entry-point extensions from `celery.result_backends`. It resolves the symbol and rejects a Python module where a backend class is required. No configured name selects `disabled`.

Sources: [celery/app/backends.py:41-69](repo://celery/app/backends.py#L41-L69)

| Family | Registered names | Selected implementation |
| --- | --- | --- |
| Broker replies | `rpc` | `RPCBackend` |
| Redis | `redis`, `rediss` | `RedisBackend` |
| Redis discovery | `sentinel` | `SentinelBackend` |
| Cache clients | `cache` | `CacheBackend` |
| SQL database | `db`, `database` | `DatabaseBackend` |
| Document database | `mongodb` | `MongoBackend` |
| Search index | `elasticsearch` | `ElasticsearchBackend` |
| Database adapters | `cassandra`, `couchbase`, `couchdb` | `CassandraBackend`, `CouchbaseBackend`, `CouchBackend` |
| Database adapters | `cosmosdbsql`, `arangodb`, `dynamodb` | `CosmosDBSQLBackend`, `ArangoDbBackend`, `DynamoDBBackend` |
| Key-value service | `consul` | `ConsulBackend` |
| Object storage | `s3`, `gs`, `azureblockblob` | `S3Backend`, `GCSBackend`, `AzureBlockBlobBackend` |
| Files | `file` | `FilesystemBackend` |
| No result store | `disabled` | `DisabledBackend` |

Sources: [celery/app/backends.py:15-38](repo://celery/app/backends.py#L15-L38)

The alias map also contains `riak`, pointing to `celery.backends.riak:RiakBackend`. Alias registration is only a lookup mapping: `by_name` still imports the selected symbol, and optional adapters must have their implementation and client dependencies available. Treat a listed alias as a resolution target rather than a runtime availability test.

Sources: [celery/app/backends.py:29-29](repo://celery/app/backends.py#L29-L29), [celery/app/backends.py:41-56](repo://celery/app/backends.py#L41-L56)

## Redis results and chord completion

Redis combines key-value storage with asynchronous result consumption. Consumers subscribe to per-task keys; a write uses a pipeline to set the result, optionally with expiration, and publish its value on that key. Forgetting a result also cancels its subscription. `rediss` selects an SSL connection class, while URL parsing handles database selection and rejects SSL query parameters on the plain `redis` scheme.

Sources: [celery/backends/redis.py:189-208](repo://celery/backends/redis.py#L189-L208), [celery/backends/redis.py:410-433](repo://celery/backends/redis.py#L410-L433), [celery/backends/redis.py:526-546](repo://celery/backends/redis.py#L526-L546)

Redis has its own chord coordination. It stores each part's result with a group index, counts completed parts, reads the expected size and added-task count, and invokes the body when those counts match. By default it uses a sorted set for ordered chord results. Complex nested group results are saved so completion can reconstruct their shape; simple headers can decode the collected records directly. [[Canvas Workflows]] explains the caller-facing chord contract, while this backend owns the completion bookkeeping.

Sources: [celery/backends/redis.py:573-587](repo://celery/backends/redis.py#L573-L587), [celery/backends/redis.py:594-677](repo://celery/backends/redis.py#L594-L677)

## RPC replies and limitations

RPC sends results to the task request's `reply_to` destination with its correlation ID, using one reply queue per client. `on_task_call` declares that queue before publishing work when needed. `store_result` publishes a result message rather than writing a database record, and a missing reply destination produces no result publication. This is the adapter used by the result example in [[Quickstart]].

Sources: [celery/backends/rpc.py:1-4](repo://celery/backends/rpc.py#L1-L4), [celery/backends/rpc.py:217-238](repo://celery/backends/rpc.py#L217-L238), [celery/backends/rpc.py:254-270](repo://celery/backends/rpc.py#L254-L270)

RPC explicitly rejects chords, including the group-followed-by-task pattern that Canvas upgrades into a chord. It also declares group save, restore and delete operations unsupported. Use its reply-oriented interface for workflows that do not require those features; selecting it for a chord cannot be fixed by changing the chord's polling interval.

Sources: [celery/backends/rpc.py:23-27](repo://celery/backends/rpc.py#L23-L27), [celery/backends/rpc.py:214-215](repo://celery/backends/rpc.py#L214-L215), [celery/backends/rpc.py:351-374](repo://celery/backends/rpc.py#L351-L374)

## Database and cache storage

The SQL database backend opens result sessions, finds or creates a row by task ID, updates metadata and commits. Configuration controls engine options, table names, schemas, extended result models and session lifetime. Retryable database errors can invalidate the session manager before another attempt. Cleanup deletes task and group rows older than the configured expiry. MongoDB similarly writes a task-ID document containing encoded result metadata and decodes it when read.

Sources: [celery/backends/database/__init__.py:55-121](repo://celery/backends/database/__init__.py#L55-L121), [celery/backends/database/__init__.py:127-156](repo://celery/backends/database/__init__.py#L127-L156), [celery/backends/database/__init__.py:237-250](repo://celery/backends/database/__init__.py#L237-L250), [celery/backends/mongodb.py:182-225](repo://celery/backends/mongodb.py#L182-L225)

The cache adapter selects among memcache clients and an in-memory `DummyClient`, forwards expiration to writes and supports multi-get and increment operations. Its chord setup initializes a counter before using the increment-based backend contract. The in-memory client shares an LRU cache between threads in the process; its `touch` method does nothing and its `set` method does not implement expiry. These details make it useful to distinguish this local client from an external cache service when interpreting tests.

Sources: [celery/backends/cache.py:23-25](repo://celery/backends/cache.py#L23-L25), [celery/backends/cache.py:57-79](repo://celery/backends/cache.py#L57-L79), [celery/backends/cache.py:82-145](repo://celery/backends/cache.py#L82-L145)

## Files and service-specific storage

The filesystem backend maps keys to files under a configured `file://` directory. Construction verifies the directory by writing, reading and deleting a test key, raising `ImproperlyConfigured` on filesystem failure. Cleanup scans recognized task, group and chord prefixes and removes files whose modification times predate the expiry cutoff. All participants using this adapter need access to the configured storage path to observe the same files.

Sources: [celery/backends/filesystem.py:36-112](repo://celery/backends/filesystem.py#L36-L112)

Object-storage adapters express the same result-key contract through their client APIs: S3 reads and writes object bodies, GCS downloads and uploads blobs, and Azure uploads blob content. DynamoDB writes an item built from the key and value, while Consul creates a session with its configured expiry and writes a key bound to that session. Each operation translates the result key into the selected service's storage request.

Sources: [celery/backends/s3.py:57-78](repo://celery/backends/s3.py#L57-L78), [celery/backends/gcs.py:86-107](repo://celery/backends/gcs.py#L86-L107), [celery/backends/azureblockblob.py:126-143](repo://celery/backends/azureblockblob.py#L126-L143), [celery/backends/dynamodb.py:523-544](repo://celery/backends/dynamodb.py#L523-L544), [celery/backends/consul.py:87-114](repo://celery/backends/consul.py#L87-L114)

GCS additionally uses Firestore for chord reference counts. Its constructor checks the Firestore dependencies and a TTL policy before completing initialization. This is a concrete example of why a storage URL alone does not describe every service required for workflow synchronization.

Sources: [celery/backends/gcs.py:161-193](repo://celery/backends/gcs.py#L161-L193)

## Expiry and disabled storage

Beat installs a `celery.backend_cleanup` entry at 04:00 when result expiry is configured and the backend does not report automatic expiry. [[Periodic Tasks and Beat]] covers execution of that entry. With the disabled backend, storing a result is a no-op and result retrieval or chord use raises an explicit unsupported-operation error. Choose disabled storage only when those result-dependent operations are not required.

Sources: [celery/beat.py:268-277](repo://celery/beat.py#L268-L277), [celery/backends/base.py:1263-1281](repo://celery/backends/base.py#L1263-L1281)
