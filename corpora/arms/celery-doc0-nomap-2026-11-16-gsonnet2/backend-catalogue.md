---
title: "Result Backend Catalogue"
---
## Overview

Celery ships backends for many stores. They share one contract (see [[Results, AsyncResult and the Result Backend]]) and differ in where results live, whether they expire by themselves, whether a chord can complete natively and whether the client waits by polling or by push. A backend is chosen by URL scheme through the alias table; this page lists each alias, what its class is built on, and the capability flags the code declares. Chord mechanics are on [[Chords: Header, Body and Completion]].

Sources: [celery/app/backends.py:12-33](repo://celery/app/backends.py#L12-L33), [celery/backends/base.py:120-129](repo://celery/backends/base.py#L120-L129)

## Reading the capability flags

The base `Backend` declares three flags that each backend may override, and key/value backends add `implements_incr`:

| Flag | Default | Effect |
| --- | --- | --- |
| `supports_autoexpire` | `False` | The store removes old results itself, so the daily `celery.backend_cleanup` task is not scheduled (see [[Periodic Tasks with Beat]]) |
| `supports_native_join` | `False` | The backend implements `get_many`, so `GroupResult.join_native` can be used |
| `persistent` | `True` | Results survive restarts; used by the `worker_deduplicate_successful_tasks` check |
| `implements_incr` (key/value only) | `False` | Chords complete via an atomic counter instead of the polling `celery.chord_unlock` task |

Sources: [celery/backends/base.py:115-130](repo://celery/backends/base.py#L115-L130), [celery/backends/base.py:964-978](repo://celery/backends/base.py#L964-L978), [celery/app/trace.py:362-366](repo://celery/app/trace.py#L362-L366)

The summary below lists each class's declared flags. "Poll" means results are read by `wait_for` polling; "push" means the class uses `AsyncBackendMixin` and a result consumer.

| Alias | Class | Autoexpire | Native join | Incr (chords) | Waiting |
| --- | --- | --- | --- | --- | --- |
| `rpc` | `RPCBackend` | yes | yes | no, chords refused | push |
| `redis`, `rediss` | `RedisBackend` | yes | yes | own `on_chord_part_return` | push |
| `sentinel` | `SentinelBackend` | as Redis | as Redis | as Redis | push |
| `cache` | `CacheBackend` | yes | yes | yes | poll |
| `dynamodb` | `DynamoDBBackend` | yes (TTL) | no | yes | poll |
| `gs` | `GCSBackend` | not declared | yes | yes | poll |
| `cassandra` | `CassandraBackend` | yes (`entry_ttl`) | no | no | poll |
| `couchbase` | `CouchbaseBackend` | yes | no | no | poll |
| `consul` | `ConsulBackend` | yes | no | no | poll |
| `mongodb` | `MongoBackend` | no | no | no | poll |
| other key/value stores | see below | not declared | no | no | poll |

Sources: [celery/backends/rpc.py:147-166](repo://celery/backends/rpc.py#L147-L166), [celery/backends/redis.py:204-221](repo://celery/backends/redis.py#L204-L221), [celery/backends/cache.py:90-96](repo://celery/backends/cache.py#L90-L96), [celery/backends/dynamodb.py:55-66](repo://celery/backends/dynamodb.py#L55-L66), [celery/backends/gcs.py:161-168](repo://celery/backends/gcs.py#L161-L168), [celery/backends/cassandra.py:86-87](repo://celery/backends/cassandra.py#L86-L87), [celery/backends/couchbase.py:36-37](repo://celery/backends/couchbase.py#L36-L37), [celery/backends/consul.py:32-34](repo://celery/backends/consul.py#L32-L34), [celery/backends/mongodb.py:55-56](repo://celery/backends/mongodb.py#L55-L56)

## Message-based: rpc

`rpc://` returns results as messages, using each task's `reply_to` and `correlation_id`, with one queue per client. `store_result` publishes the result straight to the caller's reply queue; if the request has no `reply_to` it does nothing. The class sets `persistent = False`, `supports_autoexpire = True` and `supports_native_join = True`, and `ensure_chords_allowed` raises, so chords are not supported. Because the result goes to the client that sent the task, a different process cannot read it later. `on_task_call` declares the reply queue before sending (skipped inside a prefork child, where it already exists), and `get_task_meta` buffers out-of-band replies that arrive for ids not yet awaited.

Sources: [celery/backends/rpc.py:1-4](repo://celery/backends/rpc.py#L1-L4), [celery/backends/rpc.py:147-166](repo://celery/backends/rpc.py#L147-L166), [celery/backends/rpc.py:214-238](repo://celery/backends/rpc.py#L214-L238), [celery/backends/rpc.py:254-292](repo://celery/backends/rpc.py#L254-L292)

## Redis and Sentinel

`RedisBackend` is a key/value backend that also uses the async mixin. Its docstring lists the Redis commands it needs: `GET`, `MGET`, `DEL`, `INCRBY`, `EXPIRE`, `SET` and `SETEX`. It sets `supports_autoexpire` and `supports_native_join`, caps a stored value at 512 MB, and implements chords with its own `on_chord_part_return`: each finished header member pushes an encoded entry to a sorted set (ordered by group index unless `result_chord_ordered` is false) or list under `<group>.j`, with the expected size in `.s` and an adjustment counter `.t`; when the count reaches the total it joins the results and calls the body. `add_to_chord` increments `.t`, which is why `Task.add_to_chord` is Redis-only. `SentinelBackend` subclasses it to connect through Redis Sentinel. The `rediss` alias maps to the same class, which handles SSL connection options.

Sources: [celery/backends/redis.py:204-232](repo://celery/backends/redis.py#L204-L232), [celery/backends/redis.py:554-592](repo://celery/backends/redis.py#L554-L592), [celery/backends/redis.py:593-686](repo://celery/backends/redis.py#L593-L686), [celery/backends/redis.py:727-745](repo://celery/backends/redis.py#L727-L745)

## SQL: db

`db` and `database` map to `DatabaseBackend`, built on SQLAlchemy models (`Task`, `TaskSet`, with `TaskExtended` when extended results are on). It polls with a `subpolling_interval` of 0.5 s to avoid overloading the database, and keeps the old behaviour of always retrying failed operations, three times by default, unless overridden. The engine options default to `pool_pre_ping` and `pool_recycle`, as set in `database_engine_options`. It does not declare `supports_autoexpire`, so `backend_cleanup` removes old rows.

Sources: [celery/backends/database/__init__.py:45-80](repo://celery/backends/database/__init__.py#L45-L80), [celery/backends/database/__init__.py:237-250](repo://celery/backends/database/__init__.py#L237-L250)

## Cache

`cache` stores results in a cache client named by the URL scheme part after `cache+` (several servers are separated by `;`), with options from `cache_backend_options`. The module's own messages show it supports Memcached through `pylibmc` or `python-memcached` and an in-memory client. It sets `supports_autoexpire`, `supports_native_join` and `implements_incr`, so chords complete through the counter.

Sources: [celery/backends/cache.py:14-47](repo://celery/backends/cache.py#L14-L47), [celery/backends/cache.py:90-110](repo://celery/backends/cache.py#L90-L110)

## Document and wide-column stores

| Alias | Stores results in | Notes from the code |
| --- | --- | --- |
| `mongodb` | MongoDB collections `celery_taskmeta` and `celery_groupmeta` in database `celery` | Not auto-expiring; implements `_store_result`, `_save_group` and `cleanup` directly |
| `cassandra` | A Cassandra/AstraDB table through the DataStax driver | Needs exactly one of `cassandra_servers` or `cassandra_secure_bundle_path`; expiry through `entry_ttl` |
| `couchbase` | A Couchbase bucket (default `default`) | Auto-expiring |
| `couchdb` | A CouchDB database (container `default`) | Requires `pycouchdb` |
| `elasticsearch` | An Elasticsearch index `celery` | Updates state in a conflict-free manner; retry-on-timeout option off by default |
| `arangodb` | An ArangoDB collection | URL form `arangodb://username:password@host:port/database/collection`; default database and collection `celery` |
| `cosmosdbsql` | Azure CosmosDB with the SQL API | Takes database, collection, consistency level and retry options |

Sources: [celery/backends/mongodb.py:36-56](repo://celery/backends/mongodb.py#L36-L56), [celery/backends/mongodb.py:182-200](repo://celery/backends/mongodb.py#L182-L200), [celery/backends/cassandra.py:71-90](repo://celery/backends/cassandra.py#L71-L90), [celery/backends/couchbase.py:23-39](repo://celery/backends/couchbase.py#L23-L39), [celery/backends/couchdb.py:21-34](repo://celery/backends/couchdb.py#L21-L34), [celery/backends/elasticsearch.py:30-46](repo://celery/backends/elasticsearch.py#L30-L46), [celery/backends/arangodb.py:23-49](repo://celery/backends/arangodb.py#L23-L49), [celery/backends/cosmosdbsql.py:30-45](repo://celery/backends/cosmosdbsql.py#L30-L45)

## Key/value and object stores

| Alias | Stores results in | Notes from the code |
| --- | --- | --- |
| `file` | Files in a directory given by the URL | Checks the directory at start by writing a test file; accepts custom `open` and `unlink` functions; expired files are deleted by cleanup |
| `consul` | The Consul KV store | Auto-expiring; `consistency` defaults to `consistent` |
| `dynamodb` | An AWS DynamoDB table (default `celery`) | Auto-expires through DynamoDB TTL; keeps a `chord_count` attribute so chords work through increments |
| `s3` | An S3 bucket | Requires boto3, AWS credentials and a bucket setting, else `ImproperlyConfigured` |
| `azureblockblob` | An Azure Storage block blob container | Takes a URL and container name |
| `gs` | Google Cloud Storage, with Firestore for chords | `GCSBackend` extends `GCSBackendBase` with `implements_incr` and `supports_native_join`, a chord-part-return callback and a TTL policy on Firestore documents |

Sources: [celery/backends/filesystem.py:25-60](repo://celery/backends/filesystem.py#L25-L60), [celery/backends/filesystem.py:99-112](repo://celery/backends/filesystem.py#L99-L112), [celery/backends/consul.py:27-40](repo://celery/backends/consul.py#L27-L40), [celery/backends/dynamodb.py:29-70](repo://celery/backends/dynamodb.py#L29-L70), [celery/backends/s3.py:20-40](repo://celery/backends/s3.py#L20-L40), [celery/backends/azureblockblob.py:24-40](repo://celery/backends/azureblockblob.py#L24-L40), [celery/backends/gcs.py:43-52](repo://celery/backends/gcs.py#L43-L52), [celery/backends/gcs.py:161-170](repo://celery/backends/gcs.py#L161-L170), [celery/backends/gcs.py:240-262](repo://celery/backends/gcs.py#L240-L262)

## Disabled and custom backends

`disabled` selects `DisabledBackend`, which is also what a missing `result_backend` resolves to; see [[Results, AsyncResult and the Result Backend]]. Third-party backends can be added as `celery.result_backends` entry points, through the loader's `override_backends`, or by giving a dotted class path as the backend name.

Sources: [celery/app/backends.py:36-50](repo://celery/app/backends.py#L36-L50), [celery/backends/base.py:1263-1281](repo://celery/backends/base.py#L1263-L1281)
