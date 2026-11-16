---
title: "Result Backends"
---
## Overview

A result backend is the store the worker writes task states to and callers read them from. Celery ships about twenty, all subclasses of the base classes described on [[Task Results and States]]; they differ in where the record lives, whether callers are pushed results or must poll, whether records expire by themselves, and whether chords can be joined with an atomic counter. This page explains how the `result_backend` setting picks a class and what sets each shipped backend apart.

Sources: [celery/app/backends.py:15-38](repo://celery/app/backends.py#L15-L38), [celery/backends/base.py:108-136](repo://celery/backends/base.py#L108-L136)

## Choosing a backend by URL

`app.backend` is created on first use by `backends.by_url(result_backend)`. The URL scheme is the alias: `redis://localhost/0` selects `RedisBackend`, and `db+postgresql://…` splits on the first `+`, selecting the `db` alias and passing the rest as the SQLAlchemy URL. `by_name` looks the alias up in `BACKEND_ALIASES`, merged with the loader's `override_backends` and any classes registered under the `celery.result_backends` entry point; a full `module:Class` path also works. An unknown name raises `ImproperlyConfigured`, and with no backend configured the alias is `disabled`.

Sources: [celery/app/backends.py:40-69](repo://celery/app/backends.py#L40-L69), [celery/app/base.py:1224-1228](repo://celery/app/base.py#L1224-L1228)

A backend whose `thread_safe` attribute is true (from `result_backend_thread_safe`) is shared by all threads; any other one is created per thread ([[The Celery Application]]).

Sources: [celery/backends/base.py:158-162](repo://celery/backends/base.py#L158-L162), [celery/app/base.py:1539-1563](repo://celery/app/base.py#L1539-L1563)

## Capability flags

Three class attributes describe what a backend can do, and the rest of Celery checks them:

Sources: [celery/backends/base.py:115-129](repo://celery/backends/base.py#L115-L129)

- `supports_native_join`: the backend can fetch many results in one call (`get_many`), so `ResultSet.get` uses `join_native`.
- `supports_autoexpire`: records expire on their own. When false and `result_expires` is set, beat installs the built-in `celery.backend_cleanup` task to run daily at 4:00, which calls the backend's `cleanup()`.
- `implements_incr`: a key-value backend with an atomic counter. Its `apply_chord` saves the header group and each finished member increments a counter; the member that reaches the chord size joins the group and sends the body. Backends without it fall back to the `celery.chord_unlock` task, which polls the header group.

Sources: [celery/beat.py:268-277](repo://celery/beat.py#L268-L277), [celery/backends/base.py:838-867](repo://celery/backends/base.py#L838-L867), [celery/backends/base.py:1183-1257](repo://celery/backends/base.py#L1183-L1257)

## Catalogue

| Alias | Class | Base | Notable behaviour |
| --- | --- | --- | --- |
| `redis`, `rediss` | `RedisBackend` | key-value, async | Pub/sub push, auto-expire, native join, sorted-set chord counter |
| `sentinel` | `SentinelBackend` | Redis | Redis via Sentinel; several `;`-separated sentinel URLs |
| `rpc` | `RPCBackend` | async | Results sent as AMQP messages to the caller; no chords |
| `db`, `database` | `DatabaseBackend` | polling | SQLAlchemy tables; daily cleanup |
| `cache` | `CacheBackend` | key-value | Memcached or in-memory; auto-expire, native join, counter chords |
| `mongodb` | `MongoBackend` | polling | Collections `celery_taskmeta`/`celery_groupmeta`; daily cleanup |
| `dynamodb` | `DynamoDBBackend` | key-value | TTL auto-expire, counter chords |
| `s3` | `S3Backend` | key-value | Objects in an S3 bucket |
| `gs` | `GCSBackend` | key-value | Google Cloud Storage objects; Firestore chord counter, native join |
| `azureblockblob` | `AzureBlockBlobBackend` | key-value | Azure Blob Storage |
| `file` | `FilesystemBackend` | key-value | One file per key in a shared directory |
| `cassandra` | `CassandraBackend` | polling | Auto-expire through `entry_ttl` |
| `elasticsearch` | `ElasticsearchBackend` | key-value | Documents in an index |
| `consul` | `ConsulBackend` | key-value | Consul KV, auto-expire |
| `couchdb`, `couchbase` | `CouchBackend`, `CouchbaseBackend` | key-value | Document stores; Couchbase auto-expires |
| `cosmosdbsql` | `CosmosDBSQLBackend` | key-value | Azure Cosmos DB SQL API |
| `arangodb` | `ArangoDbBackend` | key-value | ArangoDB collection |
| `disabled` | `DisabledBackend` | — | Stores nothing; reads and chords raise |

Sources: [celery/app/backends.py:15-38](repo://celery/app/backends.py#L15-L38), [celery/backends/redis.py:204-221](repo://celery/backends/redis.py#L204-L221), [celery/backends/rpc.py:147-159](repo://celery/backends/rpc.py#L147-L159), [celery/backends/cache.py:90-96](repo://celery/backends/cache.py#L90-L96), [celery/backends/dynamodb.py:29-66](repo://celery/backends/dynamodb.py#L29-L66), [celery/backends/gcs.py:161-168](repo://celery/backends/gcs.py#L161-L168), [celery/backends/cassandra.py:71-86](repo://celery/backends/cassandra.py#L71-L86), [celery/backends/consul.py:27-32](repo://celery/backends/consul.py#L27-L32), [celery/backends/couchbase.py:23-37](repo://celery/backends/couchbase.py#L23-L37)

## Redis

`RedisBackend` stores each record with `SETEX` (or `SET` without expiry) and, in the same pipeline, `PUBLISH`es it on a channel named after the key. Waiting callers subscribe to the keys of the tasks they wait for, so results are pushed rather than polled. A value larger than Redis's 512 MB string limit raises `BackendStoreError` before sending.

Sources: [celery/backends/redis.py:526-541](repo://celery/backends/redis.py#L526-L541), [celery/backends/redis.py:178-199](repo://celery/backends/redis.py#L178-L199)

The result consumer is built to survive reconnects: after a lost connection, `_reconnect_pubsub` first `MGET`s every subscribed key, in case a result was published while it was away, then subscribes again. Before waiting, `on_wait_for_pending` also reads the current record, so a result stored before the subscription is not missed.

Sources: [celery/backends/redis.py:97-130](repo://celery/backends/redis.py#L97-L130), [celery/backends/redis.py:149-169](repo://celery/backends/redis.py#L149-L169)

Connection parameters come from the URL or the `redis_*` settings (host, port, db, password, username, `redis_max_connections`, socket timeouts, `redis_backend_use_ssl`, an optional credential provider). With TLS, `ssl_cert_reqs` must be set; `CERT_OPTIONAL` and `CERT_NONE` log a warning.

Sources: [celery/backends/redis.py:226-330](repo://celery/backends/redis.py#L226-L330)

Chords on Redis do not use `chord_unlock`. Each finished member adds `[1, task_id, state, result]` to a sorted set `<group>.j` scored by its `group_index` (or a list, when `result_chord_ordered` is off in the transport options) and reads the count, the `.t` adjustment from `add_to_chord` and the chord size `.s` in one pipeline. The member that brings the count to the size decodes the stored results in header order, raises `ChordError` for a failed member, sends the body with `callback.delay(results)`, and deletes the three keys.

Sources: [celery/backends/redis.py:555-584](repo://celery/backends/redis.py#L555-L584), [celery/backends/redis.py:593-693](repo://celery/backends/redis.py#L593-L693)

## RPC

`RPCBackend` (`rpc://`) stores nothing. The worker publishes the result as a message to the queue named in the request's `reply_to`, with the task id as `correlation_id`, and the caller consumes its own reply queue. Before each send, `on_task_call` declares that queue unless running in a pool process. Only the process that sent the task receives the result, and `ensure_chords_allowed` raises, so chords cannot use this backend. Messages are transient unless `result_persistent` is set.

Sources: [celery/backends/rpc.py:179-282](repo://celery/backends/rpc.py#L179-L282)

## SQL databases

`DatabaseBackend` writes rows to the `celery_taskmeta` and `celery_tasksetmeta` tables through SQLAlchemy, using `TaskExtended` columns when `result_extended` is on. The URL comes from the `db+` URL or `database_url`; `database_engine_options`, `database_table_schemas`, `database_table_names` and `database_short_lived_sessions` tune it. Unlike other backends it retries failed operations by default, three times. Its `cleanup` deletes rows whose `date_done` is older than `result_expires`.

Sources: [celery/backends/database/__init__.py:45-110](repo://celery/backends/database/__init__.py#L45-L110), [celery/backends/database/__init__.py:237-250](repo://celery/backends/database/__init__.py#L237-L250), [celery/backends/database/models.py:27-31](repo://celery/backends/database/models.py#L27-L31)

## Cache and the other key-value stores

`CacheBackend` uses `pylibmc` or `python-memcached` for `memcached://` URLs (servers separated by `;`) and an in-process LRU cache for `memory://`, which suits tests. It sets expiry on every key and supports counter chords.

Sources: [celery/backends/cache.py:24-50](repo://celery/backends/cache.py#L24-L50), [celery/backends/cache.py:90-117](repo://celery/backends/cache.py#L90-L117)

The cloud stores (S3, Google Cloud Storage, Azure Blob, DynamoDB, Cosmos DB) and the document stores (Elasticsearch, CouchDB, Couchbase, ArangoDB, Consul) implement `get`, `set` and `delete` on top of `KeyValueStoreBackend`, so they share its key layout and its rule that a `SUCCESS` record is never overwritten. DynamoDB keeps its chord counter in a `chord_count` attribute and expires items through a `ttl` attribute; GCS keeps its counter in Firestore. `FilesystemBackend` writes one file per key under the directory in its `file://` URL, which must be shared by every worker and client.

Sources: [celery/backends/dynamodb.py:56-66](repo://celery/backends/dynamodb.py#L56-L66), [celery/backends/gcs.py:161-175](repo://celery/backends/gcs.py#L161-L175), [celery/backends/s3.py:20-40](repo://celery/backends/s3.py#L20-L40), [celery/backends/filesystem.py:25-50](repo://celery/backends/filesystem.py#L25-L50)

## MongoDB

`MongoBackend` is a polling backend that stores records in the `celery_taskmeta` collection and groups in `celery_groupmeta` of the `celery` database by default. It does not expire records by itself: its `cleanup` deletes documents whose `date_done` is older than `result_expires`, run by the daily cleanup task.

Sources: [celery/backends/mongodb.py:36-56](repo://celery/backends/mongodb.py#L36-L56), [celery/backends/mongodb.py:273-283](repo://celery/backends/mongodb.py#L273-L283)
