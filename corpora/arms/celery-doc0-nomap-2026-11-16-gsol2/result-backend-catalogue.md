---
title: "Result Backend Catalogue"
---
## Overview

Result backends implement the storage and waiting contract behind [[Results and State]]. Selection is independent of the task broker: the application resolves its configured backend class and instantiates it with the application and parsed URL. This catalogue groups the shipped adapters by service interface and records capabilities visible in this checkout. [[Canvas Workflows]] explains the chord abstraction that some implementations coordinate differently.

Sources: [celery/app/base.py:1224-1228](repo://celery/app/base.py#L1224-L1228), [celery/app/backends.py:15-69](repo://celery/app/backends.py#L15-L69)

## Resolve a backend and its contract

`by_name` defaults to `disabled`, merges built-in aliases with loader overrides and installed `celery.result_backends` entry points, then imports the selected symbol. Unknown names and module objects produce configuration errors. `by_url` extracts the scheme, including compound forms where a backend name precedes `+`. The backend receives the remaining URL; parsing service-specific connection parameters belongs to the adapter.

Sources: [celery/app/backends.py:41-69](repo://celery/app/backends.py#L41-L69)

The disabled backend silently discards stored results but raises for result retrieval and chord use. Key/value implementations share metadata encoding, task/group keys and a success-preserving store path. Waiting is supplied through either synchronous polling or an asynchronous result-consumer mixin. Capability flags such as native join and automatic expiration describe concrete adapter behavior; they do not mean every adapter shares the same durability or synchronization mechanism.

Sources: [celery/backends/base.py:1116-1153](repo://celery/backends/base.py#L1116-L1153), [celery/backends/base.py:1259-1281](repo://celery/backends/base.py#L1259-L1281), [celery/backends/redis.py:204-221](repo://celery/backends/redis.py#L204-L221), [celery/backends/rpc.py:147-159](repo://celery/backends/rpc.py#L147-L159)

## Redis and RPC result delivery

Redis combines key/value storage with asynchronous result consumption, native join and automatic expiry. Writes use a pipeline that sets the value, optionally with expiry, and publishes it on the result key's channel. Connection exceptions qualify for retry. Chord handling records each completed part in a sorted set or list, tracks completed count and reads the stored chord size before dispatching completion. The Redis client library is required at construction.

Sources: [celery/backends/redis.py:204-233](repo://celery/backends/redis.py#L204-L233), [celery/backends/redis.py:487-490](repo://celery/backends/redis.py#L487-L490), [celery/backends/redis.py:526-539](repo://celery/backends/redis.py#L526-L539), [celery/backends/redis.py:604-626](repo://celery/backends/redis.py#L604-L626)

`redis`, `rediss` and `sentinel` resolve through the Redis family. `rediss` selects an SSL connection and decodes certificate parameters from the URL. A plain `redis` URL rejects SSL query parameters, while configured `redis_backend_use_ssl` parameters can still be honored. Sentinel has its own adapter class and verifies that the Redis Sentinel dependency is available.

Sources: [celery/app/backends.py:18-20](repo://celery/app/backends.py#L18-L20), [celery/backends/redis.py:410-428](repo://celery/backends/redis.py#L410-L428), [celery/backends/redis.py:727-740](repo://celery/backends/redis.py#L727-L740)

RPC consumes result messages asynchronously and supports native join. It defaults to nonpersistent results, deriving delivery mode from the effective persistence setting. Bindings use one reply queue for the process, and destination metadata comes from request `reply_to` and correlation ID. RPC explicitly refuses chords, so the single-task setup in [[Quickstart]] cannot be carried unchanged into a chord workflow.

Sources: [celery/backends/rpc.py:147-192](repo://celery/backends/rpc.py#L147-L192), [celery/backends/rpc.py:209-238](repo://celery/backends/rpc.py#L209-L238), [celery/backends/rpc.py:246-249](repo://celery/backends/rpc.py#L246-L249)

## Cache, database and filesystem storage

| Adapter | Configuration and explicit constraints |
| --- | --- |
| Cache | Selects `memcache`, `memcached`, `pylibmc` or `memory`; declares automatic expiry, native join and increment-based coordination |
| SQL database | Uses a database URL, configurable task/group table names and schemas, engine options and session management |
| Filesystem | Requires a `file://` location and verifies it by writing, reading and deleting a test value |

Sources: [celery/backends/cache.py:82-117](repo://celery/backends/cache.py#L82-L117), [celery/backends/database/__init__.py:55-107](repo://celery/backends/database/__init__.py#L55-L107), [celery/backends/filesystem.py:36-75](repo://celery/backends/filesystem.py#L36-L75)

Memcached requires pylibmc or python-memcached. The memory client uses a shared process-local LRU cache, explicitly shared between threads; it supplies no external storage service. Database configuration defaults backend retries to enabled with three retries for compatibility with its previous decorator. Its cleanup deletes expired task and group rows. Filesystem cleanup scans matching metadata files and removes those older than the expiration cutoff.

Sources: [celery/backends/cache.py:14-39](repo://celery/backends/cache.py#L14-L39), [celery/backends/cache.py:57-76](repo://celery/backends/cache.py#L57-L76), [celery/backends/database/__init__.py:62-66](repo://celery/backends/database/__init__.py#L62-L66), [celery/backends/database/__init__.py:237-255](repo://celery/backends/database/__init__.py#L237-L255), [celery/backends/filesystem.py:98-112](repo://celery/backends/filesystem.py#L98-L112)

## Document and database service adapters

| Adapter | Interface or requirement declared by its implementation |
| --- | --- |
| MongoDB | Uses pymongo, separate task/group collections and declares automatic expiry unsupported |
| Elasticsearch | Key/value backend requiring the Elasticsearch client; defaults to the `celery` index |
| Cassandra/AstraDB | Uses the DataStax driver; requires exactly one of server list or secure bundle and supports entry TTL |
| Couchbase | Requires the Couchbase client, uses a bucket and declares automatic expiry |
| CouchDB | Requires pycouchdb and parses a service URL into connection/container settings |
| CosmosDB SQL | Requires pydocumentdb and accepts database, collection, consistency and retry parameters |
| ArangoDB | Requires pyArango and accepts connection/database/collection settings through URL or configuration |

Sources: [celery/backends/mongodb.py:36-64](repo://celery/backends/mongodb.py#L36-L64), [celery/backends/elasticsearch.py:30-55](repo://celery/backends/elasticsearch.py#L30-L55), [celery/backends/cassandra.py:71-118](repo://celery/backends/cassandra.py#L71-L118), [celery/backends/couchbase.py:23-51](repo://celery/backends/couchbase.py#L23-L51), [celery/backends/couchdb.py:21-49](repo://celery/backends/couchdb.py#L21-L49), [celery/backends/cosmosdbsql.py:30-75](repo://celery/backends/cosmosdbsql.py#L30-L75), [celery/backends/arangodb.py:23-95](repo://celery/backends/arangodb.py#L23-L95)

These adapters have distinct client and configuration checks, so an alias alone does not install its dependency or supply service credentials. The application resolves the class before adapter initialization performs those checks. [[Applications and Configuration]] covers effective settings and environment overrides; [[Results and State]] covers the client API that remains consistent across these service-specific constructors.

Sources: [celery/app/backends.py:41-69](repo://celery/app/backends.py#L41-L69), [celery/app/base.py:1224-1228](repo://celery/app/base.py#L1224-L1228), [celery/backends/cosmosdbsql.py:42-58](repo://celery/backends/cosmosdbsql.py#L42-L58), [celery/backends/elasticsearch.py:49-55](repo://celery/backends/elasticsearch.py#L49-L55)

## Cloud object and key/value services

| Adapter | Implemented service boundary |
| --- | --- |
| Consul | Key/value storage with automatic expiry; creates a client per operation by default and optionally reuses one |
| DynamoDB | Boto3 result store with table, capacity, region, endpoint and TTL settings |
| Azure Block Blob | Requires azure-storage-blob v12; accepts connection-string or supported credential URL forms and container settings |
| S3 | Requires boto3/botocore and a bucket; accepts endpoint, region, credentials and base path |
| Google Cloud Storage | Requires google-cloud-storage, bucket and project; supports a base path and nonnegative TTL |

Sources: [celery/backends/consul.py:27-62](repo://celery/backends/consul.py#L27-L62), [celery/backends/dynamodb.py:29-63](repo://celery/backends/dynamodb.py#L29-L63), [celery/backends/azureblockblob.py:24-58](repo://celery/backends/azureblockblob.py#L24-L58), [celery/backends/s3.py:20-55](repo://celery/backends/s3.py#L20-L55), [celery/backends/gcs.py:43-78](repo://celery/backends/gcs.py#L43-L78)

Expiration needs adapter-specific review: some implementations mark native automatic expiry, while database and filesystem code expose explicit cleanup. Result retrieval timeouts, metadata retry policy and task execution retries also live at separate boundaries. Use [[Results and State]] for the first two and [[Task Execution and Retries]] for new task attempts when deciding which operation actually failed.

Sources: [celery/backends/redis.py:220-221](repo://celery/backends/redis.py#L220-L221), [celery/backends/database/__init__.py:237-255](repo://celery/backends/database/__init__.py#L237-L255), [celery/backends/filesystem.py:98-112](repo://celery/backends/filesystem.py#L98-L112), [celery/backends/base.py:635-661](repo://celery/backends/base.py#L635-L661), [celery/result.py:209-219](repo://celery/result.py#L209-L219), [celery/app/task.py:818-866](repo://celery/app/task.py#L818-L866)
