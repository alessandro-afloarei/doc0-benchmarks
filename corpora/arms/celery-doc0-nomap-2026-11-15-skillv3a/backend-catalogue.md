---
title: "Backend Catalogue"
---
## Overview

Celery ships one result backend per storage system, each selected by the scheme of the `result_backend` URL. They all implement the interface described in [[Result Backends]]; they differ in three properties that decide how well they serve a workload: whether clients wait by push or by polling, how chords complete, and whether the store expires results by itself. This page lists every built-in backend with those properties and what it is for.

Sources: [celery/app/backends.py:15-38](repo://celery/app/backends.py#L15-L38), [celery/backends/base.py:120-129](repo://celery/backends/base.py#L120-L129)

## Comparison

| Alias (URL scheme) | Class | Waiting | Native join | Chords | Self-expiring |
| --- | --- | --- | --- | --- | --- |
| `redis`, `rediss` | `RedisBackend` | Push (pub/sub) | yes | Native counter (sorted set) | yes |
| `sentinel` | `SentinelBackend` | Push | yes | Native counter | yes |
| `rpc` | `RPCBackend` | Push (reply queue) | yes | not supported | yes |
| `db`, `database` (`db+<sqlalchemy url>`) | `DatabaseBackend` | Polling | no | `chord_unlock` | no (cleanup task) |
| `cache` (`cache+memcached://`) | `CacheBackend` | Polling | yes | `incr` counter | yes |
| `mongodb` | `MongoBackend` | Polling | no | `chord_unlock` | no (cleanup task) |
| `dynamodb` | `DynamoDBBackend` | Polling | no | `incr` counter | yes (TTL) |
| `elasticsearch` | `ElasticsearchBackend` | Polling | no | `chord_unlock` | no |
| `s3` | `S3Backend` | Polling | no | `chord_unlock` | no |
| `gs` | `GCSBackend` | Polling | yes | Firestore counter | optional TTL |
| `azureblockblob` | `AzureBlockBlobBackend` | Polling | no | `chord_unlock` | no |
| `cosmosdbsql` | `CosmosDBSQLBackend` | Polling | no | `chord_unlock` | no |
| `couchbase` | `CouchbaseBackend` | Polling | no | `chord_unlock` | yes |
| `couchdb` | `CouchBackend` | Polling | no | `chord_unlock` | no |
| `cassandra` | `CassandraBackend` | Polling | no | `chord_unlock` | yes (`entry_ttl`) |
| `arangodb` | `ArangoDbBackend` | Polling | no | `chord_unlock` | no (cleanup task) |
| `consul` | `ConsulBackend` | Polling | no | `chord_unlock` | yes |
| `file` (`file:///path`) | `FilesystemBackend` | Polling | no | `chord_unlock` | no (cleanup task) |
| `disabled` | `DisabledBackend` | none | no | refused | n/a |

Sources: [celery/app/backends.py:15-38](repo://celery/app/backends.py#L15-L38), [celery/backends/redis.py:204-221](repo://celery/backends/redis.py#L204-L221), [celery/backends/rpc.py:147-159](repo://celery/backends/rpc.py#L147-L159), [celery/backends/cache.py:90-96](repo://celery/backends/cache.py#L90-L96), [celery/backends/dynamodb.py:55-66](repo://celery/backends/dynamodb.py#L55-L66), [celery/backends/gcs.py:161-168](repo://celery/backends/gcs.py#L161-L168), [celery/backends/couchbase.py:37](repo://celery/backends/couchbase.py#L37), [celery/backends/cassandra.py:86](repo://celery/backends/cassandra.py#L86), [celery/backends/consul.py:32](repo://celery/backends/consul.py#L32)

"Native join" means `ResultSet.join_native` can fetch many results per round trip. "`chord_unlock`" means chords complete through the polling task described in [[Groups and Chords]]. "Cleanup task" means beat schedules `celery.backend_cleanup` daily and the backend's `cleanup()` deletes expired rows.

Sources: [celery/backends/base.py:838-867](repo://celery/backends/base.py#L838-L867), [celery/beat.py:268-277](repo://celery/beat.py#L268-L277)

## Push backends

### Redis and Sentinel

The Redis backend is the most complete. It stores each result with `SETEX` (so it expires after `result_expires`) and `PUBLISH`es it on a channel named after the key in the same pipeline, so clients that subscribed in `on_task_call` receive it without polling. Chords use the per-group sorted set described in [[Groups and Chords]], and it is the only backend that supports `Task.add_to_chord`. Connection settings come from the URL or from `redis_*` settings (`redis_max_connections`, `redis_socket_timeout`, `redis_retry_on_timeout`, `redis_backend_health_check_interval`, a credential provider); `rediss://` enables TLS. Choose it as the default when you need results, chords or many concurrent waiters.

Sources: [celery/backends/redis.py:227-260](repo://celery/backends/redis.py#L227-L260), [celery/backends/redis.py:526-555](repo://celery/backends/redis.py#L526-L555)

`SentinelBackend` takes several `sentinel://host:port/db` URLs separated by `;`, asks Sentinel for the current master, and otherwise behaves like `RedisBackend`.

Sources: [celery/backends/redis.py:727-740](repo://celery/backends/redis.py#L727-L740)

### RPC

The RPC backend sends each result as an AMQP message back to the `reply_to` queue of the client that sent the task, through the broker the app already uses. It needs no extra service, but results can be read only by the process that sent the task, are consumed when read, are not persistent unless `result_persistent` is set, and chords are refused with `NotImplementedError`. A result read with `get_task_meta` is taken from the queue, the newest message per task is kept and requeued, and messages for other tasks are buffered. Choose it for request/response patterns where the sender waits for its own results.

Sources: [celery/backends/rpc.py:147-159](repo://celery/backends/rpc.py#L147-L159), [celery/backends/rpc.py:214-271](repo://celery/backends/rpc.py#L214-L271), [celery/backends/rpc.py:291-321](repo://celery/backends/rpc.py#L291-L321)

## Database and document stores

### SQLAlchemy database

`DatabaseBackend` stores results in two tables, `celery_taskmeta` (task id, status, pickled result, date done, traceback; plus name, args, kwargs, worker, retries and queue with `result_extended`) and `celery_tasksetmeta` for saved groups. The URL is `db+` followed by any SQLAlchemy URL, or the `database_url` setting. Table names and schemas are configurable (`database_table_names`, `database_table_schemas`), engine options merge with `database_engine_options`, and `database_create_tables_at_setup` controls table creation. Unlike the other backends it retries failed operations by default (3 times). Choose it when a relational database is already the system of record and polling latency is acceptable.

Sources: [celery/backends/database/__init__.py:45-110](repo://celery/backends/database/__init__.py#L45-L110), [celery/backends/database/models.py:27-75](repo://celery/backends/database/models.py#L27-L75)

### MongoDB

`MongoBackend` stores results in the `celery_taskmeta` collection and groups in `celery_groupmeta` of the `celery` database by default, configured from the URL or `mongodb_backend_settings`. It has no automatic expiry; the daily cleanup task removes old documents.

Sources: [celery/backends/mongodb.py:36-60](repo://celery/backends/mongodb.py#L36-L60), [celery/backends/mongodb.py:92](repo://celery/backends/mongodb.py#L92)

### Other document stores

| Backend | Notes |
| --- | --- |
| DynamoDB | Table `celery` by default with id, result, timestamp and TTL attributes; uses DynamoDB TTL for expiry and an atomic `chord_count` attribute for chords |
| Elasticsearch | Index `celery` on `localhost:9200`; on a write conflict it updates with optimistic concurrency and never replaces a success, or a ready state with an unready one |
| CouchDB | Documents in a CouchDB database over HTTP |
| Couchbase | Key-value documents with expiry |
| Cosmos DB (SQL API) | Documents in a database and collection with configurable consistency and retry |
| ArangoDB | Documents in a collection over the HTTP API; has a cleanup implementation |
| Cassandra / AstraDB | Rows in a table, expiry via `entry_ttl`; takes either server addresses or a secure-connect bundle |

Sources: [celery/backends/dynamodb.py:29-66](repo://celery/backends/dynamodb.py#L29-L66), [celery/backends/elasticsearch.py:30-47](repo://celery/backends/elasticsearch.py#L30-L47), [celery/backends/elasticsearch.py:128-197](repo://celery/backends/elasticsearch.py#L128-L197), [celery/backends/couchdb.py:21-35](repo://celery/backends/couchdb.py#L21-L35), [celery/backends/couchbase.py:23-42](repo://celery/backends/couchbase.py#L23-L42), [celery/backends/cosmosdbsql.py:30-42](repo://celery/backends/cosmosdbsql.py#L30-L42), [celery/backends/arangodb.py:23-52](repo://celery/backends/arangodb.py#L23-L52), [celery/backends/cassandra.py:71-90](repo://celery/backends/cassandra.py#L71-L90)

## Caches and object stores

### Memcached

`CacheBackend` uses memcached through `pylibmc` or `python-memcached` (`cache+memcached://host:11211;host2:11211/`), with entries set to expire after `result_expires`. It implements `incr`, so chords complete with a counter, and `get_multi` gives native joins. Results are lost on eviction or restart, so it suits short-lived results. The special `cache+memory://` backend keeps results in a process-local dict and is meant for tests.

Sources: [celery/backends/cache.py:28-56](repo://celery/backends/cache.py#L28-L56), [celery/backends/cache.py:82-140](repo://celery/backends/cache.py#L82-L140)

### Cloud object storage

`S3Backend` writes one object per result to `s3_bucket` (under `s3_base_path`), with credentials, region and endpoint from `s3_*` settings. `AzureBlockBlobBackend` does the same in an Azure container, accepting a connection string or a `DefaultAzureCredential`/`ManagedIdentityCredential` account URL. Both use `chord_unlock` for chords.

Sources: [celery/backends/s3.py:20-49](repo://celery/backends/s3.py#L20-L49), [celery/backends/azureblockblob.py:24-40](repo://celery/backends/azureblockblob.py#L24-L40)

`GCSBackend` (`gs://bucket/path`) stores results in Google Cloud Storage and keeps chord counters in Firestore, which gives it native joins and counter-based chords; it requires both client libraries and refuses to start unless the Firestore `celery` collection has a TTL policy on its `expires_at` field. `gcs_ttl` optionally expires the stored objects.

Sources: [celery/backends/gcs.py:43-75](repo://celery/backends/gcs.py#L43-L75), [celery/backends/gcs.py:161-195](repo://celery/backends/gcs.py#L161-L195), [celery/backends/gcs.py:210-222](repo://celery/backends/gcs.py#L210-L222)

### Consul and filesystem

`ConsulBackend` stores results in Consul's key/value store; each key is tied to a Consul session created with a TTL of `result_expires`, so the key disappears when the session expires. `FilesystemBackend` (`file:///shared/path`) writes one file per result to a directory that every worker and client must share (for example over NFS), and tests at start-up that it can write there.

Sources: [celery/backends/consul.py:27-45](repo://celery/backends/consul.py#L27-L45), [celery/backends/consul.py:88-108](repo://celery/backends/consul.py#L88-L108), [celery/backends/filesystem.py:25-75](repo://celery/backends/filesystem.py#L25-L75)

## Choosing a backend

- Need chords or many concurrent `get()` calls: Redis (or GCS on Google Cloud).
- Only the sender reads its results, no extra infrastructure: RPC.
- Results must be queryable and durable alongside application data: the SQLAlchemy database backend or MongoDB.
- Results are throwaway and fast: memcached.
- Results are never read: leave `result_backend` unset, or set `ignore_result=True` on tasks so nothing is written.

Sources: [celery/backends/redis.py:204-221](repo://celery/backends/redis.py#L204-L221), [celery/backends/rpc.py:214-215](repo://celery/backends/rpc.py#L214-L215), [celery/backends/base.py:1263-1281](repo://celery/backends/base.py#L1263-L1281)

A third-party backend can be added without changing Celery: register its class under the `celery.result_backends` entry-point group and use its name as the URL scheme.

Sources: [celery/app/backends.py:41-55](repo://celery/app/backends.py#L41-L55)
