---
title: "Result Backend Catalogue"
---
## Overview

Celery ships a result backend for most common data stores. Each is selected by the scheme of the `result_backend` URL through `BACKEND_ALIASES`, and each builds on one of the base classes described in [[Result Backend Interface]]: most extend `KeyValueStoreBackend` and implement only `get`, `mget`, `set` and `delete`, while a few (database, MongoDB, Cassandra, RPC) implement storage themselves. Each needs its client library, installed through the extra of the same name ([[Quickstart]]); constructing a backend without its library raises `ImproperlyConfigured`.

Sources: [celery/app/backends.py:15-38](repo://celery/app/backends.py#L15-L38), [celery/backends/mongodb.py:59-67](repo://celery/backends/mongodb.py#L59-L67)

Three capability flags matter when choosing. `supports_native_join` means result sets are joined with bulk reads (or pushed messages) instead of one polling loop per result. `supports_autoexpire` means the store removes old results itself, so the daily `celery.backend_cleanup` task is not needed. `implements_incr` means chords are counted with an atomic counter rather than the polling `chord_unlock` task ([[Groups and Chords]]).

Sources: [celery/backends/base.py:120-129](repo://celery/backends/base.py#L120-L129), [celery/backends/base.py:964-979](repo://celery/backends/base.py#L964-L979)

## Summary

| Scheme | Class | Base | Native join | Auto-expire | Chord counter |
| --- | --- | --- | --- | --- | --- |
| `redis`, `rediss` | `RedisBackend` | key-value + async | yes | yes | Redis keys |
| `sentinel` | `SentinelBackend` | `RedisBackend` | yes | yes | Redis keys |
| `rpc` | `RPCBackend` | `Backend` + async | yes | yes | chords refused |
| `db`, `database` | `DatabaseBackend` | `BaseBackend` | no | no | `chord_unlock` |
| `cache` | `CacheBackend` | key-value | yes | yes | `incr` |
| `mongodb` | `MongoBackend` | `BaseBackend` | no | no | `chord_unlock` |
| `dynamodb` | `DynamoDBBackend` | key-value | no | yes (TTL) | `incr` |
| `s3` | `S3Backend` | key-value | no | no | `chord_unlock` |
| `gs` | `GCSBackend` | key-value | yes | no | Firestore `incr` |
| `azureblockblob` | `AzureBlockBlobBackend` | key-value | no | no | `chord_unlock` |
| `cosmosdbsql` | `CosmosDBSQLBackend` | key-value | no | no | `chord_unlock` |
| `cassandra` | `CassandraBackend` | `BaseBackend` | no | yes (`entry_ttl`) | `chord_unlock` |
| `couchbase` | `CouchbaseBackend` | key-value | no | yes | `chord_unlock` |
| `couchdb` | `CouchBackend` | key-value | no | no | `chord_unlock` |
| `elasticsearch` | `ElasticsearchBackend` | key-value | no | no | `chord_unlock` |
| `arangodb` | `ArangoDbBackend` | key-value | no | no | `chord_unlock` |
| `consul` | `ConsulBackend` | key-value | no | yes (sessions) | `chord_unlock` |
| `file` | `FilesystemBackend` | key-value | no | no | `chord_unlock` |
| `disabled` | `DisabledBackend` | `BaseBackend` | n/a | n/a | chords refused |

Sources: [celery/app/backends.py:15-38](repo://celery/app/backends.py#L15-L38), [celery/backends/redis.py:204-221](repo://celery/backends/redis.py#L204-L221), [celery/backends/rpc.py:147-159](repo://celery/backends/rpc.py#L147-L159), [celery/backends/cache.py:90-96](repo://celery/backends/cache.py#L90-L96), [celery/backends/dynamodb.py:55-66](repo://celery/backends/dynamodb.py#L55-L66), [celery/backends/gcs.py:161-168](repo://celery/backends/gcs.py#L161-L168), [celery/backends/cassandra.py:86-86](repo://celery/backends/cassandra.py#L86-L86), [celery/backends/couchbase.py:37-37](repo://celery/backends/couchbase.py#L37-L37), [celery/backends/consul.py:27-32](repo://celery/backends/consul.py#L27-L32), [celery/backends/mongodb.py:55-55](repo://celery/backends/mongodb.py#L55-L55)

## Redis and Sentinel

`RedisBackend` stores each result under its key with `SETEX` when results expire (`result_expires`, as an integer) and `SET` otherwise, and in the same pipeline `PUBLISH`es the value on a channel named after the key. Clients waiting on a result subscribe to that channel through the backend's `ResultConsumer`, so waiting does not poll ([[Task States and AsyncResult]]). `on_task_call` subscribes to the new task's id as soon as it is sent, unless running inside a prefork child where joining is forbidden anyway. Values larger than Redis's 512 MB string limit raise `BackendStoreError`.

Sources: [celery/backends/redis.py:204-230](repo://celery/backends/redis.py#L204-L230), [celery/backends/redis.py:500-546](repo://celery/backends/redis.py#L500-L546)

When the pub/sub connection is lost, `_reconnect_pubsub` resets the pool and, before resubscribing, fetches the current meta of every subscribed task with `MGET`, because "task state might have changed when the connection was down". Writes go through `ensure`, which retries connection errors with the backend's `retry_policy` (overridable through `retry_policy` in `result_backend_transport_options`), and connection errors are declared safe for `result_backend_always_retry`. Chords use three Redis keys per group, described in [[Groups and Chords]].

Sources: [celery/backends/redis.py:77-128](repo://celery/backends/redis.py#L77-L128), [celery/backends/redis.py:487-524](repo://celery/backends/redis.py#L487-L524)

`SentinelBackend` takes a `;`-separated list of `sentinel://host:port/db` URLs, requires the `redis.sentinel` module, and masks passwords in every part of `as_uri()`.

Sources: [celery/backends/redis.py:727-760](repo://celery/backends/redis.py#L727-L760)

## RPC

The `rpc` backend sends results back as AMQP messages instead of storing them. Each client process has one reply queue named after the app's `thread_oid`, declared by `on_task_call` before the task is sent (skipped in prefork children, where it already exists); the task's `reply_to` and `correlation_id` route the result message to it. Results are therefore only readable by the client that sent the task, and the backend is `persistent = False` by default, so messages are not written to disk unless `result_persistent` is set. It refuses chords with `NotImplementedError`.

Sources: [celery/backends/rpc.py:147-260](repo://celery/backends/rpc.py#L147-L260), [celery/backends/rpc.py:389-401](repo://celery/backends/rpc.py#L389-L401)

`store_result` publishes `{task_id, status, result, traceback, children}` through the app's producer pool with retry. A reply that arrives for a task the client is not waiting on is buffered as out-of-band and returned when that task is asked for.

Sources: [celery/backends/rpc.py:254-289](repo://celery/backends/rpc.py#L254-L289)

## Database

`DatabaseBackend` stores results with SQLAlchemy in a `celery_taskmeta` table (`task_id`, `status`, pickled `result`, `date_done`, `traceback`, and with `result_extended` also `name`, `args`, `kwargs`, `worker`, `retries`, `queue`) and groups in `celery_tasksetmeta`. The URL is `db+<sqlalchemy-url>`, or the `database_url` setting; a missing URL raises `ImproperlyConfigured`. Table names and schemas come from `database_table_names` and `database_table_schemas`, engine options from `database_engine_options`, and `database_create_tables_at_setup` creates the tables at construction.

Sources: [celery/backends/database/__init__.py:45-115](repo://celery/backends/database/__init__.py#L45-L115), [celery/backends/database/models.py:27-121](repo://celery/backends/database/models.py#L27-L121)

Unlike other backends it retries by default: `result_backend_always_retry` defaults to `True` and `result_backend_max_retries` to 3 here, preserving the behaviour of an older retry decorator, and on a retryable database error it invalidates the session for its URL. `cleanup()` deletes task and group rows whose `date_done` is older than `result_expires`. `subpolling_interval = 0.5` slows polling of result sets "to not bombard the database with queries".

Sources: [celery/backends/database/__init__.py:62-124](repo://celery/backends/database/__init__.py#L62-L124), [celery/backends/database/__init__.py:230-250](repo://celery/backends/database/__init__.py#L230-L250)

## Cache

`CacheBackend` uses Memcached through `pylibmc` (preferred) or `python-memcached`, selected by URLs such as `cache+memcached://host1:11211;host2:11211/`, or the in-process `memory` client for tests. It uses `get_multi` for bulk reads, the cache's own expiry, `incr` for chord counting (initializing the counter in `_apply_chord_incr`), and `touch` to extend expiry. The `memory` client keeps results in a module-level LRU cache of 5,000 entries, shared between threads but not processes.

Sources: [celery/backends/cache.py:20-88](repo://celery/backends/cache.py#L20-L88), [celery/backends/cache.py:90-163](repo://celery/backends/cache.py#L90-L163)

## MongoDB

`MongoBackend` stores each result as a document whose `_id` is the task id in the `celery_taskmeta` collection of the `celery` database (groups in `celery_groupmeta`), writing with `replace_one(..., upsert=True)`. A document Mongo refuses becomes an `EncodeError`. Connection details come from the URL or from the `mongodb_backend_settings` dict, where `host` or `port` override the URL's hosts. It does not auto-expire: `cleanup()` deletes documents whose `date_done` is older than the expiry.

Sources: [celery/backends/mongodb.py:36-110](repo://celery/backends/mongodb.py#L36-L110), [celery/backends/mongodb.py:182-196](repo://celery/backends/mongodb.py#L182-L196), [celery/backends/mongodb.py:273-283](repo://celery/backends/mongodb.py#L273-L283)

## Cloud object and document stores

| Backend | Where results go | Notes from the code |
| --- | --- | --- |
| `DynamoDBBackend` | Table `celery` (default), items with `id`, binary `result`, `timestamp`, optional `ttl` | Uses DynamoDB Time to Live for expiry; chord counts in a numeric `chord_count` field; requires `boto3` |
| `S3Backend` | Objects in `s3_bucket`, under `s3_base_path` | Missing bucket raises `ImproperlyConfigured`; optional `s3_endpoint_url` and `s3_region` |
| `GCSBackend` | Objects in `gcs_bucket` under `gcs_base_path`, with optional `gcs_ttl` | Chord counts kept in Firestore; requires `google-cloud-storage` and `google-cloud-firestore` |
| `AzureBlockBlobBackend` | Blobs in `azureblockblob_container_name` | URL is a connection string, or `DefaultAzureCredential@` / `ManagedIdentityCredential@` plus an account URL; needs azure-storage-blob 12 |
| `CosmosDBSQLBackend` | Documents in a Cosmos DB SQL collection | Database, collection, consistency level and retry limits are constructor options |

Sources: [celery/backends/dynamodb.py:29-68](repo://celery/backends/dynamodb.py#L29-L68), [celery/backends/s3.py:20-50](repo://celery/backends/s3.py#L20-L50), [celery/backends/gcs.py:43-75](repo://celery/backends/gcs.py#L43-L75), [celery/backends/gcs.py:161-180](repo://celery/backends/gcs.py#L161-L180), [celery/backends/azureblockblob.py:24-53](repo://celery/backends/azureblockblob.py#L24-L53), [celery/backends/cosmosdbsql.py:30-40](repo://celery/backends/cosmosdbsql.py#L30-L40)

## Databases and key-value services

| Backend | Defaults | Notes from the code |
| --- | --- | --- |
| `CassandraBackend` | Servers from `cassandra_servers` or an AstraDB secure bundle | Exactly one of servers and bundle path must be set; expiry through `entry_ttl` |
| `CouchbaseBackend` | `localhost:8091`, bucket `default` | String keys; auto-expires |
| `CouchBackend` | `http://localhost:5984`, container `default` | Requires `pycouchdb` |
| `ElasticsearchBackend` | `http://localhost:9200`, index `celery` | Stores `result` and `@timestamp`; on a conflict for an existing document it updates instead of indexing |
| `ArangoDbBackend` | `127.0.0.1:8529`, database and collection `celery` | URL `arangodb://user:pass@host:port/database/collection`, or `arangodb_backend_settings` |
| `ConsulBackend` | Consistency `consistent` | Each key is attached to a Consul session with a TTL, so results disappear when the session expires |

Sources: [celery/backends/cassandra.py:71-90](repo://celery/backends/cassandra.py#L71-L90), [celery/backends/couchbase.py:23-42](repo://celery/backends/couchbase.py#L23-L42), [celery/backends/couchdb.py:21-36](repo://celery/backends/couchdb.py#L21-L36), [celery/backends/elasticsearch.py:30-48](repo://celery/backends/elasticsearch.py#L30-L48), [celery/backends/elasticsearch.py:128-145](repo://celery/backends/elasticsearch.py#L128-L145), [celery/backends/arangodb.py:23-52](repo://celery/backends/arangodb.py#L23-L52), [celery/backends/consul.py:27-100](repo://celery/backends/consul.py#L27-L100)

## Filesystem

`FilesystemBackend` writes one file per key into the directory given by a `file:///path` URL, checks at startup that it can write and delete a test file there, and reads result sets one file at a time. `cleanup()` deletes task, group and chord files whose modification time is older than `result_expires`.

Sources: [celery/backends/filesystem.py:25-60](repo://celery/backends/filesystem.py#L25-L60), [celery/backends/filesystem.py:85-112](repo://celery/backends/filesystem.py#L85-L112)
