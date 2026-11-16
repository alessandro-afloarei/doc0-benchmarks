---
title: "Result Backend Catalogue"
---
## Overview

The result backend is chosen from the `result_backend` setting or the `backend` keyword of the app. A name or URL that matches a key in `BACKEND_ALIASES` picks the class at that path; any other name is imported as a class path. This page lists the backends the package ships, what each one stores its results in, and the conditions the code states for choosing it. The storage contract that every backend implements is in [[Result Backend Contract]].

Sources: [celery/app/backends.py:15-40](repo://celery/app/backends.py#L15-L40), [celery/app/backends.py:41-57](repo://celery/app/backends.py#L41-L57)

`by_name` resolves the name in three steps. The alias table is the base; the loader's `override_backends` setting replaces entries in it; and any backend class registered through the extension namespace is added last. A name that cannot be imported raises `ImproperlyConfigured`, and a missing name selects the `disabled` backend.

Sources: [celery/app/backends.py:44-56](repo://celery/app/backends.py#L44-L56)

## Backends that store results in a database

| Alias | Class | Stores results in | Notes from the code |
| --- | --- | --- | --- |
| `db`, `database` | `DatabaseBackend` | SQL tables through SQLAlchemy | Its `ResultSet` iteration sleeps between polls to avoid flooding the database |
| `mongodb` | `MongoBackend` | MongoDB collections | Requires `pymongo`; `supports_autoexpire` is false |
| `cassandra` | `CassandraBackend` | Cassandra or AstraDB | Requires exactly one of `cassandra_servers` and `cassandra_secure_bundle_path` |
| `elasticsearch` | `ElasticsearchBackend` | Elasticsearch documents | Requires the `elasticsearch` package |
| `couchdb` | `CouchBackend` | CouchDB documents | Key-value subclass |
| `couchbase` | `CouchbaseBackend` | Couchbase documents | Key-value subclass |
| `arangodb` | `ArangoDbBackend` | ArangoDB collections | Key-value subclass |

Sources: [celery/backends/database/__init__.py:45-53](repo://celery/backends/database/__init__.py#L45-L53), [celery/backends/database/session.py:5-7](repo://celery/backends/database/session.py#L5-L7), [celery/backends/mongodb.py:36-55](repo://celery/backends/mongodb.py#L36-L55), [celery/backends/cassandra.py:71-86](repo://celery/backends/cassandra.py#L71-L86), [celery/backends/elasticsearch.py:30-36](repo://celery/backends/elasticsearch.py#L30-L36), [celery/backends/couchdb.py:21-26](repo://celery/backends/couchdb.py#L21-L26), [celery/backends/couchbase.py:23-27](repo://celery/backends/couchbase.py#L23-L27), [celery/backends/arangodb.py:23-27](repo://celery/backends/arangodb.py#L23-L27)

## Backends that store results in a key-value or object store

| Alias | Class | Stores results in | Notes from the code |
| --- | --- | --- | --- |
| `redis`, `rediss`, `sentinel` | `RedisBackend`, `SentinelBackend` | Redis keys | Uses GET, MGET, DEL, INCRBY, EXPIRE, SET and SETEX; `sentinel` is the Sentinel subclass |
| `cache` | `CacheBackend` | A cache service | Supports native expiry and increments |
| `file` | `FilesystemBackend` | One file per key in a directory | The directory is the URL; open, unlink and separator can be replaced |
| `s3` | `S3Backend` | S3 objects | Requires `boto3` and the AWS key settings |
| `dynamodb` | `DynamoDBBackend` | DynamoDB items | Requires `boto3` |
| `gs` | `GCSBackend` | Google Cloud Storage objects | Built on `GCSBackendBase` |
| `azureblockblob` | `AzureBlockBlobBackend` | Azure Blob Storage blocks | Key-value subclass |
| `consul` | `ConsulBackend` | Consul key-value entries | Supports native expiry |
| `cosmosdbsql` | `CosmosDBSQLBackend` | Azure Cosmos DB SQL API items | Key-value subclass |

Sources: [celery/backends/redis.py:204-212](repo://celery/backends/redis.py#L204-L212), [celery/backends/redis.py:727-728](repo://celery/backends/redis.py#L727-L728), [celery/backends/cache.py:90-96](repo://celery/backends/cache.py#L90-L96), [celery/backends/filesystem.py:25-34](repo://celery/backends/filesystem.py#L25-L34), [celery/backends/s3.py:20-26](repo://celery/backends/s3.py#L20-L26), [celery/backends/dynamodb.py:29-35](repo://celery/backends/dynamodb.py#L29-L35), [celery/backends/gcs.py:43-44](repo://celery/backends/gcs.py#L43-L44), [celery/backends/gcs.py:161-162](repo://celery/backends/gcs.py#L161-L162), [celery/backends/azureblockblob.py:24-25](repo://celery/backends/azureblockblob.py#L24-L25), [celery/backends/consul.py:27-32](repo://celery/backends/consul.py#L27-L32), [celery/backends/cosmosdbsql.py:30-31](repo://celery/backends/cosmosdbsql.py#L30-L31)

## The RPC backend

The `rpc` alias selects `RPCBackend`, which sends results as messages instead of storing them. Its `persistent` flag is false by default, so the result messages are sent with delivery mode 1 unless the persistence setting asks for mode 2.

Sources: [celery/backends/rpc.py:147-157](repo://celery/backends/rpc.py#L147-L157), [celery/backends/rpc.py:179-186](repo://celery/backends/rpc.py#L179-L186)

## The disabled backend

`disabled` selects `DisabledBackend`, which stores nothing. It is the default when no backend is named, and it refuses chords, because a chord cannot count results it does not keep.

Sources: [celery/app/backends.py:44](repo://celery/app/backends.py#L44), [celery/backends/base.py:1263-1278](repo://celery/backends/base.py#L1263-L1278)

## Alias without a module

`BACKEND_ALIASES` lists `riak` for `celery.backends.riak:RiakBackend`, but this tree has no `riak` module under `celery/backends`. Selecting `riak` fails at import time, and the `ImproperlyConfigured` path described above reports it.

Sources: [celery/app/backends.py:15-40](repo://celery/app/backends.py#L15-L40), [celery/app/backends.py:41-56](repo://celery/app/backends.py#L41-L56)

Every class in the tables implements the contract in [[Result Backend Contract]], and the key-value subclasses share the `get`, `set`, `mget` and `delete` methods described there. The way a caller waits on these stores is in [[AsyncResult and Result Sets]].

Sources: [celery/backends/base.py:964-1000](repo://celery/backends/base.py#L964-L1000)
