---
title: "Storage Result Backends"
---
## Overview

Besides Redis and RPC, Celery ships backends for SQL databases, memcached, document stores, cloud key/value services and object storage. They are all polled: a waiting client reads the stored state every `interval` seconds. Most subclass `KeyValueStoreBackend` and only implement `get`, `set`, `mget` and `delete` on top of the key scheme `celery-task-meta-<id>`; a few (database, MongoDB, Cassandra) store columns or documents themselves. Each needs its client library, and raises `ImproperlyConfigured` at creation if it is missing.

Sources: [celery/backends/base.py:964-1019](repo://celery/backends/base.py#L964-L1019), [celery/app/backends.py:15-38](repo://celery/app/backends.py#L15-L38)

The behaviour these backends share — encoding, retries, the `SUCCESS` guard, chord counting — is on [[Result Backend Interface]]. This page says what each store is, how it lays out results, how results expire and whether chords use a native counter.

Sources: [celery/backends/base.py:1116-1138](repo://celery/backends/base.py#L1116-L1138)

## At a glance

| Alias | Class | Auto-expiry | Native chord counter |
| --- | --- | --- | --- |
| `db+<sqlalchemy url>` | `DatabaseBackend` | No (`backend_cleanup`) | No (`chord_unlock`) |
| `cache+memcached://`, `cache+memory://` | `CacheBackend` | Yes | Yes |
| `mongodb://` | `MongoBackend` | No (`backend_cleanup`) | No |
| `dynamodb://` | `DynamoDBBackend` | Yes (TTL) | Yes |
| `cassandra://` | `CassandraBackend` | Yes (`USING TTL`) | No |
| `elasticsearch://` | `ElasticsearchBackend` | No | No |
| `couchdb://` | `CouchBackend` | No | No |
| `couchbase://` | `CouchbaseBackend` | Yes | No |
| `arangodb://` | `ArangoDbBackend` | No (`cleanup`) | No |
| `consul://` | `ConsulBackend` | Yes (session TTL) | No |
| `cosmosdbsql://` | `CosmosDBSQLBackend` (experimental) | No | No |
| `file://` | `FilesystemBackend` | No (`cleanup` by mtime) | No |
| `s3://` | `S3Backend` | No | No |
| `gs://` | `GCSBackend` | Bucket lifecycle rule | Yes (Firestore) |
| `azureblockblob://` | `AzureBlockBlobBackend` | No | No |

Sources: [celery/backends/database/__init__.py:45-53](repo://celery/backends/database/__init__.py#L45-L53), [celery/backends/cache.py:90-96](repo://celery/backends/cache.py#L90-L96), [celery/backends/mongodb.py:36-55](repo://celery/backends/mongodb.py#L36-L55), [celery/backends/dynamodb.py:29-66](repo://celery/backends/dynamodb.py#L29-L66), [celery/backends/cassandra.py:71-86](repo://celery/backends/cassandra.py#L71-L86), [celery/backends/couchbase.py:23-42](repo://celery/backends/couchbase.py#L23-L42), [celery/backends/consul.py:27-35](repo://celery/backends/consul.py#L27-L35), [celery/backends/cosmosdbsql.py:1-31](repo://celery/backends/cosmosdbsql.py#L1-L31), [celery/backends/gcs.py:161-173](repo://celery/backends/gcs.py#L161-L173)

## SQL databases

### Tables and sessions

`DatabaseBackend` stores results through SQLAlchemy in two tables: `celery_taskmeta` (task id, status, a pickled result, `date_done`, traceback; plus name, args, kwargs, worker, retries and queue with `result_extended`) and `celery_tasksetmeta` for saved groups. `database_table_schemas` and `database_table_names` rename them. The URL comes from the `db+...` result backend URL or the `database_url` setting; a missing URL raises `ImproperlyConfigured`.

Sources: [celery/backends/database/models.py:27-121](repo://celery/backends/database/models.py#L27-L121), [celery/backends/database/__init__.py:55-112](repo://celery/backends/database/__init__.py#L55-L112)

Each operation opens a session, and `session_cleanup` rolls back on error and always closes it. `_store_result` creates the row if needed and sets every column from the metadata. A missing row reads as `PENDING`.

Sources: [celery/backends/database/__init__.py:34-43](repo://celery/backends/database/__init__.py#L34-L43), [celery/backends/database/__init__.py:135-185](repo://celery/backends/database/__init__.py#L135-L185)

`SessionManager` creates engines differently before and after a fork. In the parent it uses a `NullPool` engine per call, so no pooled connection is inherited by pool children; after a fork it caches one engine and session factory per URL (`database_short_lived_sessions` recreates the factory each time). Tables are created on first use, retrying with jittered backoff because concurrent `create_all` calls can race. `database_engine_callback` is called with each new engine.

Sources: [celery/backends/database/session.py:29-106](repo://celery/backends/database/session.py#L29-L106)

### Retries and cleanup

Unlike other backends, the database backend retries by default: `result_backend_always_retry` defaults to `True` and `result_backend_max_retries` to 3, preserving an older retry decorator's behaviour. `DatabaseError`, `InterfaceError`, `InvalidRequestError` and `StaleDataError` are retried, and the cached engine is disposed before each retry. `cleanup` deletes task and group rows whose `date_done` is older than `result_expires`.

Sources: [celery/backends/database/__init__.py:26-31](repo://celery/backends/database/__init__.py#L26-L31), [celery/backends/database/__init__.py:62-66](repo://celery/backends/database/__init__.py#L62-L66), [celery/backends/database/__init__.py:117-121](repo://celery/backends/database/__init__.py#L117-L121), [celery/backends/database/__init__.py:237-250](repo://celery/backends/database/__init__.py#L237-L250)

## Memcached

`CacheBackend` takes `cache+memcached://host1:11211;host2:11211/` (servers separated by `;`) or the `cache_backend` setting and `cache_backend_options`. It prefers `pylibmc` and falls back to `python-memcached`. `memory://` uses an in-process LRU cache of 5000 entries shared between threads, useful for tests. Values are written with the result expiry; chords use `incr` on a counter initialized to 0, and `expire` uses `touch`.

Sources: [celery/backends/cache.py:22-55](repo://celery/backends/cache.py#L22-L55), [celery/backends/cache.py:98-145](repo://celery/backends/cache.py#L98-L145)

## Document stores

### MongoDB

`MongoBackend` stores one document per task in `celery_taskmeta` (with `_id` set to the task id, via `replace_one(..., upsert=True)`) and group member ids in `celery_groupmeta`, in the `celery` database by default. Connection details come from a `mongodb://` URI and the `mongodb_backend_settings` dict, which can also rename the database and collections. With the `bson` serializer the result is stored as a native document; binary serializers are wrapped in `Binary`. A document the driver cannot encode raises `EncodeError`.

Sources: [celery/backends/mongodb.py:36-118](repo://celery/backends/mongodb.py#L36-L118), [celery/backends/mongodb.py:166-255](repo://celery/backends/mongodb.py#L166-L255)

### Elasticsearch

`ElasticsearchBackend` indexes a document per key in the `celery` index with a `result` field and an `@timestamp`. It creates documents with `op_type=create`; on a conflict it updates with optimistic concurrency (`if_seq_no`, `if_primary_term`) and refuses to overwrite a `SUCCESS` state, or a ready state with an unready one — the docstring notes this stops a `RETRY` from replacing a final state and keeps `chord_unlock` from retrying forever.

Sources: [celery/backends/elasticsearch.py:30-47](repo://celery/backends/elasticsearch.py#L30-L47), [celery/backends/elasticsearch.py:128-231](repo://celery/backends/elasticsearch.py#L128-L231)

### CouchDB, Couchbase, ArangoDB and CosmosDB

| Backend | Layout | Notes |
| --- | --- | --- |
| CouchDB | Document `{_id: key, value}` | Updates the existing document on conflict |
| Couchbase | `upsert` of the key with `ttl=result_expires` | String keys; auto-expiry |
| ArangoDB | `UPSERT {_key, task}` in a collection (default `celery`/`celery`) | `cleanup` removes records older than the expiry |
| CosmosDB/SQL | Document `{id: key, value}` with a partition key | Experimental; database and collection from settings |

Sources: [celery/backends/couchdb.py:21-100](repo://celery/backends/couchdb.py#L21-L100), [celery/backends/couchbase.py:23-114](repo://celery/backends/couchbase.py#L23-L114), [celery/backends/arangodb.py:23-52](repo://celery/backends/arangodb.py#L23-L52), [celery/backends/arangodb.py:117-190](repo://celery/backends/arangodb.py#L117-L190), [celery/backends/cosmosdbsql.py:30-60](repo://celery/backends/cosmosdbsql.py#L30-L60), [celery/backends/cosmosdbsql.py:179-195](repo://celery/backends/cosmosdbsql.py#L179-L195)

## Wide-column and key/value services

### Cassandra

`CassandraBackend` writes rows with `INSERT ... USING TTL` (from `cassandra_entry_ttl`) into a table keyed by task id and clustered by `date_done` descending, and reads the newest row. Exactly one of `cassandra_servers` or `cassandra_secure_bundle_path` (Astra DB) must be set, together with a keyspace and table. Read and write consistency default to `LOCAL_QUORUM`, and an auth provider class from `cassandra.auth` can be configured.

Sources: [celery/backends/cassandra.py:37-64](repo://celery/backends/cassandra.py#L37-L64), [celery/backends/cassandra.py:71-140](repo://celery/backends/cassandra.py#L71-L140)

### DynamoDB

`DynamoDBBackend` uses a table (default `celery`) with an `id` key, a binary `result` and a timestamp. The URL `dynamodb://key:secret@region:port/table?read=n&write=n&ttl_seconds=n` sets credentials, region, throughput and TTL; a `localhost` or IP region selects a local DynamoDB endpoint. The table is created if missing, and with `ttl_seconds` each item gets a `ttl` attribute so DynamoDB expires it. Chords use an atomic `chord_count` update expression.

Sources: [celery/backends/dynamodb.py:29-66](repo://celery/backends/dynamodb.py#L29-L66), [celery/backends/dynamodb.py:68-156](repo://celery/backends/dynamodb.py#L68-L156), [celery/backends/dynamodb.py:450-556](repo://celery/backends/dynamodb.py#L450-L556)

### Consul

`ConsulBackend` stores keys in Consul's K/V store under an optional path. To make results expire, `set` first creates a Consul session with the result TTL and attaches the key to it; when the session expires, Consul removes the key. It opens a client per operation for correctness unless the URL has `one_client=1`.

Sources: [celery/backends/consul.py:27-112](repo://celery/backends/consul.py#L27-L112)

## Files and object storage

### Filesystem

`FilesystemBackend` writes each key as a file in the directory given by `file:///path` (or `file://localhost/path`), checking at startup that it can write, read and delete a test file. `cleanup` deletes result files whose modification time is older than `result_expires`. It suits a shared filesystem mounted by every worker and client.

Sources: [celery/backends/filesystem.py:25-112](repo://celery/backends/filesystem.py#L25-L112)

### S3, Google Cloud Storage and Azure Blob

| Backend | Settings | Notes |
| --- | --- | --- |
| S3 | `s3_bucket` (required), `s3_base_path`, `s3_endpoint_url`, `s3_region`, credentials | A missing object reads as `None` |
| GCS | `gcs_bucket`, `gcs_project` (required), `gcs_base_path`, `gcs_ttl`, `gcs_threadpool_maxsize` | `gcs_ttl` requires a bucket lifecycle rule |
| Azure Block Blob | Connection string or credential URL, `azureblockblob_container_name`, `azureblockblob_base_path`, timeouts | Needs `azure-storage-blob` v12 |

Sources: [celery/backends/s3.py:20-77](repo://celery/backends/s3.py#L20-L77), [celery/backends/gcs.py:43-84](repo://celery/backends/gcs.py#L43-L84), [celery/backends/azureblockblob.py:24-59](repo://celery/backends/azureblockblob.py#L24-L59), [celery/backends/azureblockblob.py:126-142](repo://celery/backends/azureblockblob.py#L126-L142)

`GCSBackend` adds native chords by keeping the chord counter in a Firestore document: each part increments it, and when it reaches the chord size the header is joined and the body called, with errors routed to `chord_error_from_stack`; the counter document is deleted afterwards because Firestore has no exact TTL.

Sources: [celery/backends/gcs.py:161-195](repo://celery/backends/gcs.py#L161-L195), [celery/backends/gcs.py:227-312](repo://celery/backends/gcs.py#L227-L312)
