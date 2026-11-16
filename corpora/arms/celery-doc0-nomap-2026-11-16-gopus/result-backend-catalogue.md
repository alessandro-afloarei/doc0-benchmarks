---
title: "Result Backend Catalogue"
---
## Overview

Celery ships one result backend per storage system, each selected by the scheme of the `result_backend` URL. They all implement the interface described in [[Result Backend Architecture]]; most are key/value backends that only supply `get`, `mget`, `set` and `delete`, a few store whole documents or rows, and two (RPC and Redis) also push results to waiting clients. This page lists them with the behaviour their code shows: how they expire results, whether they join group results natively, and how they complete chords ([[Groups and Chords]]). Each needs its client library, installed through the matching extra ([[Quickstart]]).

Sources: [celery/app/backends.py:15-38](repo://celery/app/backends.py#L15-L38), [setup.py:12-47](repo://setup.py#L12-L47)

## Summary

| Scheme | Class | Base | Auto-expiry | Native join | Chords |
| --- | --- | --- | --- | --- | --- |
| `redis`, `rediss` | `RedisBackend` | key/value + async | yes | yes | sorted-set counter |
| `sentinel` | `SentinelBackend` | Redis | yes | yes | as Redis |
| `rpc` | `RPCBackend` | async messages | yes | yes | not supported |
| `db`, `database` (`db+<sqlalchemy-url>`) | `DatabaseBackend` | rows | no (cleanup task) | no | chord_unlock |
| `cache` | `CacheBackend` | key/value | yes | yes | counter (`incr`) |
| `mongodb` | `MongoBackend` | documents | no (cleanup task) | no | chord_unlock |
| `dynamodb` | `DynamoDBBackend` | key/value | yes | no | counter (`incr`) |
| `gs` | `GCSBackend` | key/value | via TTL | yes | Firestore counter |
| `elasticsearch` | `ElasticsearchBackend` | key/value | no | no | chord_unlock |
| `s3` | `S3Backend` | key/value | no | no | chord_unlock |
| `azureblockblob` | `AzureBlockBlobBackend` | key/value | no | no | chord_unlock |
| `cosmosdbsql` | `CosmosDBSQLBackend` | key/value | no | no | chord_unlock |
| `couchbase` | `CouchbaseBackend` | key/value | yes | no | chord_unlock |
| `couchdb` | `CouchBackend` | key/value | no | no | chord_unlock |
| `cassandra` | `CassandraBackend` | rows | yes (`entry_ttl`) | no | chord_unlock |
| `consul` | `ConsulBackend` | key/value | yes (sessions) | no | chord_unlock |
| `arangodb` | `ArangoDbBackend` | key/value | no (cleanup task) | no | chord_unlock |
| `file` | `FilesystemBackend` | key/value | no (cleanup task) | no | chord_unlock |
| `disabled` | `DisabledBackend` | none | n/a | n/a | refused |

Sources: [celery/backends/redis.py:204-221](repo://celery/backends/redis.py#L204-L221), [celery/backends/rpc.py:147-159](repo://celery/backends/rpc.py#L147-L159), [celery/backends/database/__init__.py:45-53](repo://celery/backends/database/__init__.py#L45-L53), [celery/backends/cache.py:90-96](repo://celery/backends/cache.py#L90-L96), [celery/backends/mongodb.py:36-57](repo://celery/backends/mongodb.py#L36-L57), [celery/backends/dynamodb.py:29-66](repo://celery/backends/dynamodb.py#L29-L66), [celery/backends/gcs.py:161-168](repo://celery/backends/gcs.py#L161-L168), [celery/backends/couchbase.py:23-37](repo://celery/backends/couchbase.py#L23-L37), [celery/backends/cassandra.py:71-86](repo://celery/backends/cassandra.py#L71-L86), [celery/backends/consul.py:27-35](repo://celery/backends/consul.py#L27-L35), [celery/backends/base.py:1263-1281](repo://celery/backends/base.py#L1263-L1281)

`BACKEND_ALIASES` also lists `riak`, but there is no `celery/backends/riak.py` in this tree, so that alias cannot be loaded.

Sources: [celery/app/backends.py:29-29](repo://celery/app/backends.py#L29-L29)

## Message-based backends

### Redis and Sentinel

The Redis backend stores each record with `SETEX` when results expire (or `SET` otherwise) and, in the same pipeline, `PUBLISH`es it on a channel named after the key. Waiting clients subscribe to that channel through a pub/sub `ResultConsumer`, so `get()` returns as soon as the worker stores the result instead of polling. `on_task_call` subscribes before the task is sent, except inside prefork children. Values over 512 MB raise `BackendStoreError`.

Sources: [celery/backends/redis.py:526-541](repo://celery/backends/redis.py#L526-L541), [celery/backends/redis.py:498-500](repo://celery/backends/redis.py#L498-L500), [celery/backends/redis.py:224-225](repo://celery/backends/redis.py#L224-L225)

After a lost connection the consumer resets the pool, re-reads the state of every subscribed task with `MGET` (states may have changed while it was down), and subscribes again. Connection errors are retried with the backend's `retry_policy`, which `result_backend_transport_options['retry_policy']` can override, and they count as safe to retry for `result_backend_always_retry`.

Sources: [celery/backends/redis.py:97-131](repo://celery/backends/redis.py#L97-L131), [celery/backends/redis.py:487-524](repo://celery/backends/redis.py#L487-L524)

Chords use dedicated keys per group (`.j` for results, `.s` for the size, `.t` for additions) and support `add_to_chord`, which increments `.t`; `result_chord_ordered` (default on) keeps header results in a sorted set ordered by group index. `SentinelBackend` takes `sentinel://host:port/db` URLs separated by `;` and requires the `redis.sentinel` module.

Sources: [celery/backends/redis.py:555-556](repo://celery/backends/redis.py#L555-L556), [celery/backends/redis.py:585-591](repo://celery/backends/redis.py#L585-L591), [celery/backends/redis.py:727-760](repo://celery/backends/redis.py#L727-L760)

### RPC

`rpc://` publishes results as AMQP messages to the caller's reply queue and keeps nothing; it cannot save groups or run chords. Its design is covered in [[Result Backend Architecture]].

Sources: [celery/backends/rpc.py:1-4](repo://celery/backends/rpc.py#L1-L4), [celery/backends/rpc.py:214-215](repo://celery/backends/rpc.py#L214-L215)

## Databases and document stores

### SQLAlchemy database

`db+<sqlalchemy-url>` (or the `database_url` setting) stores results in the `celery_taskmeta` and `celery_tasksetmeta` tables, using an extended task model when `result_extended` is on. Table names, schemas, engine options, short-lived sessions and an engine callback are configurable through the `database_*` settings, and `database_create_tables_at_setup` creates the tables at start.

Sources: [celery/backends/database/__init__.py:55-112](repo://celery/backends/database/__init__.py#L55-L112), [celery/backends/database/models.py:27-30](repo://celery/backends/database/models.py#L27-L30), [celery/backends/database/models.py:90-93](repo://celery/backends/database/models.py#L90-L93)

Unlike the base class, it enables `result_backend_always_retry` by default with 3 retries, treats a set of database errors as retryable, and invalidates the cached session before each retry. `cleanup()` deletes rows whose `date_done` is older than the expiry, so it relies on the daily `celery.backend_cleanup` task.

Sources: [celery/backends/database/__init__.py:62-67](repo://celery/backends/database/__init__.py#L62-L67), [celery/backends/database/__init__.py:117-121](repo://celery/backends/database/__init__.py#L117-L121), [celery/backends/database/__init__.py:237-250](repo://celery/backends/database/__init__.py#L237-L250)

### MongoDB

`MongoBackend` is a document backend, not a key/value one. It upserts one document per task (keyed by `_id`) into `celery_taskmeta` and groups into `celery_groupmeta` of the `celery` database, defaults to `localhost:27017`, and reads extra options from `mongodb_backend_settings`. Its `cleanup()` deletes documents older than the expiry.

Sources: [celery/backends/mongodb.py:36-57](repo://celery/backends/mongodb.py#L36-L57), [celery/backends/mongodb.py:182-196](repo://celery/backends/mongodb.py#L182-L196), [celery/backends/mongodb.py:273-283](repo://celery/backends/mongodb.py#L273-L283)

### Cassandra

`CassandraBackend` uses the DataStax driver with servers, port (9042), keyspace, table, auth provider and `LOCAL_QUORUM` read and write consistency from the `cassandra_*` settings, or a cloud `bundle_path`. Rows expire through `cassandra_entry_ttl`.

Sources: [celery/backends/cassandra.py:71-130](repo://celery/backends/cassandra.py#L71-L130)

### Elasticsearch, CouchDB, Couchbase, ArangoDB, CosmosDB

These store each key as a document. Elasticsearch writes `{result, @timestamp}` into the `celery` index on `localhost:9200`, creating the document and updating it on conflict. CouchDB (`localhost:5984`, container `default`), Couchbase (`localhost:8091`, bucket `default`, server-side expiry) and ArangoDB (`127.0.0.1:8529`, database and collection `celery`, with a `cleanup()`) follow the same pattern with their own clients. The CosmosDB/SQL backend is marked experimental in its module docstring.

Sources: [celery/backends/elasticsearch.py:30-47](repo://celery/backends/elasticsearch.py#L30-L47), [celery/backends/elasticsearch.py:128-145](repo://celery/backends/elasticsearch.py#L128-L145), [celery/backends/couchdb.py:21-34](repo://celery/backends/couchdb.py#L21-L34), [celery/backends/couchbase.py:23-42](repo://celery/backends/couchbase.py#L23-L42), [celery/backends/arangodb.py:23-52](repo://celery/backends/arangodb.py#L23-L52), [celery/backends/cosmosdbsql.py:1-1](repo://celery/backends/cosmosdbsql.py#L1-L1)

## Caches and cloud key/value stores

### Memcached and in-memory cache

`cache+memcached://host1:11211;host2:11211/` uses the best available memcached client, and `cache+memory://` keeps results in an in-process dictionary, which only works when caller and worker share a process (tests). Expiry is passed to every `set`, and `incr` makes chords count without polling.

Sources: [celery/backends/cache.py:82-87](repo://celery/backends/cache.py#L82-L87), [celery/backends/cache.py:98-127](repo://celery/backends/cache.py#L98-L127)

### DynamoDB

`DynamoDBBackend` stores records in the `celery` table with `id`, `result`, `timestamp`, optional `ttl` and a `chord_count` attribute used by `incr`. The URL can set the region, endpoint (for DynamoDB Local), capacity units and `ttl_seconds`; when a TTL is configured the backend sets the table's TTL so DynamoDB deletes old items itself.

Sources: [celery/backends/dynamodb.py:29-66](repo://celery/backends/dynamodb.py#L29-L66), [celery/backends/dynamodb.py:125-140](repo://celery/backends/dynamodb.py#L125-L140), [celery/backends/dynamodb.py:184-189](repo://celery/backends/dynamodb.py#L184-L189)

### Google Cloud Storage

`gs://` stores blobs under `gcs_bucket`/`gcs_base_path` in `gcs_project`, with a thread pool for parallel reads and an optional `gcs_ttl`. Chord counting is done in a Firestore collection named `celery`; the constructor raises `ImproperlyConfigured` when `google-cloud-firestore` is missing or the collection has no TTL policy.

Sources: [celery/backends/gcs.py:43-75](repo://celery/backends/gcs.py#L43-L75), [celery/backends/gcs.py:161-195](repo://celery/backends/gcs.py#L161-L195)

### S3 and Azure Block Blob

`S3Backend` writes objects to `s3_bucket` under `s3_base_path`, with region, endpoint and credentials from the `s3_*` settings, and raises `ImproperlyConfigured` without boto3, credentials or a bucket. `AzureBlockBlobBackend` writes blobs under `azureblockblob_base_path` with configurable connection and read timeouts (120 seconds by default for reads).

Sources: [celery/backends/s3.py:20-50](repo://celery/backends/s3.py#L20-L50), [celery/backends/azureblockblob.py:24-58](repo://celery/backends/azureblockblob.py#L24-L58)

### Consul

`ConsulBackend` stores results in Consul's key/value store. For each key it first creates a Consul session with the result expiry as TTL and binds the key to it, so Consul removes the key when the session expires.

Sources: [celery/backends/consul.py:1-35](repo://celery/backends/consul.py#L1-L35), [celery/backends/consul.py:87-110](repo://celery/backends/consul.py#L87-L110)

## Local backends

### File system

`file:///path/to/dir` writes one file per key in a directory shared by callers and workers. The constructor writes and deletes a test file so a missing or read-only directory fails at start. `cleanup()` deletes task, group and chord files whose modification time is older than the expiry.

Sources: [celery/backends/filesystem.py:25-58](repo://celery/backends/filesystem.py#L25-L58), [celery/backends/filesystem.py:98-112](repo://celery/backends/filesystem.py#L98-L112)

### Disabled

With no `result_backend`, `DisabledBackend` accepts `store_result` silently but raises `NotImplementedError` from every read, and `ensure_chords_allowed` raises so chords fail when they are built.

Sources: [celery/backends/base.py:1263-1281](repo://celery/backends/base.py#L1263-L1281), [celery/app/backends.py:41-46](repo://celery/app/backends.py#L41-L46)
