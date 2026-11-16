---
title: "Database and Other Backends"
---
## Overview

Beyond Redis and RPC, Celery ships result backends for SQL databases through SQLAlchemy and for a range of document stores, caches and object stores. They fall into two groups. `DatabaseBackend`, `MongoBackend` and `CassandraBackend` subclass `BaseBackend` and implement `_store_result` and `_get_task_meta_for` as queries against their own schema. Everything else subclasses `KeyValueStoreBackend` and only provides `get`, `set`, `mget` and `delete` (plus `incr` for chords), inheriting key naming, the "never overwrite `SUCCESS`" rule and polling `get_many` from the base class described in [[Result Backends]].

Sources: [celery/backends/base.py:957-964](repo://celery/backends/base.py#L957-L964), [celery/backends/base.py:1000-1019](repo://celery/backends/base.py#L1000-L1019), [celery/backends/database/__init__.py:45-53](repo://celery/backends/database/__init__.py#L45-L53), [celery/backends/mongodb.py:36-55](repo://celery/backends/mongodb.py#L36-L55), [celery/backends/cassandra.py:71-86](repo://celery/backends/cassandra.py#L71-L86)

All of these are synchronous: `AsyncResult.get` polls them every `interval`. Each one is selected by the scheme of `result_backend`, and each raises `ImproperlyConfigured` at construction when its client library is missing. For the push-based stores see [[Redis and RPC Backends]].

Sources: [celery/backends/base.py:918-944](repo://celery/backends/base.py#L918-L944), [celery/app/backends.py:15-38](repo://celery/app/backends.py#L15-L38)

## Database backend

### Configuration

`DatabaseBackend` is selected with `db+<sqlalchemy-url>` (for example `db+postgresql://user:pass@host/db`): `by_url` strips the `db+` prefix and passes the SQLAlchemy URL as `url`. The URL can also come from `dburi` or `database_url`; with none of them set the constructor raises `ImproperlyConfigured('Missing connection string! ...')`. Importing the module without SQLAlchemy installed raises `ImproperlyConfigured` immediately.

Sources: [celery/app/backends.py:59-69](repo://celery/app/backends.py#L59-L69), [celery/backends/database/__init__.py:14-20](repo://celery/backends/database/__init__.py#L14-L20), [celery/backends/database/__init__.py:55-111](repo://celery/backends/database/__init__.py#L55-L111)

| Setting | Default | Effect |
| --- | --- | --- |
| `database_url` | none | SQLAlchemy URL when not given in `result_backend` |
| `database_engine_options` | `{'pool_pre_ping': True, 'pool_recycle': 3600}` | Merged with the `engine_options` argument and passed to `create_engine` |
| `database_engine_callback` | none | Callable or dotted path called with each new engine; non-callables raise `ImproperlyConfigured` |
| `database_short_lived_sessions` | `False` | Create a new `sessionmaker` for every session after fork |
| `database_table_schemas` | none | Dict with `task` and `group` keys, the schema of each table |
| `database_table_names` | none | Dict with `task` and `group` keys, renaming `celery_taskmeta` and `celery_tasksetmeta` |
| `database_create_tables_at_setup` | `True` | Create tables in the constructor instead of on first use |

Sources: [celery/app/defaults.py:248-264](repo://celery/app/defaults.py#L248-L264), [celery/backends/database/__init__.py:73-111](repo://celery/backends/database/__init__.py#L73-L111)

```python
app = Celery('proj', backend='db+postgresql://celery:secret@db.internal/celery')
app.conf.database_table_names = {'task': 'myapp_taskmeta', 'group': 'myapp_groupmeta'}
app.conf.result_extended = True
```

Sources: [celery/backends/database/__init__.py:68-91](repo://celery/backends/database/__init__.py#L68-L91)

### Models

The tables are SQLAlchemy declarative models on `ResultModelBase`. `Task` maps `celery_taskmeta` with an integer `id` primary key from the `task_id_sequence` sequence (`BigInteger` on MSSQL), a unique `task_id` of up to 155 characters, `status`, a `PickleType` `result`, an indexed `date_done` that is refreshed on every update, and `traceback`. `TaskSet` maps `celery_tasksetmeta` with `taskset_id`, a pickled `result` and `date_done`. Each model's `configure` classmethod sets the table schema and name from the settings above.

Sources: [celery/backends/database/models.py:14-62](repo://celery/backends/database/models.py#L14-L62), [celery/backends/database/models.py:90-121](repo://celery/backends/database/models.py#L90-L121)

When `result_extended` is on, the backend swaps `task_cls` for `TaskExtended`, which extends the same table with `name`, `args` and `kwargs` (as `LargeBinary`), `worker`, `retries` and `queue`.

Sources: [celery/backends/database/models.py:64-87](repo://celery/backends/database/models.py#L64-L87), [celery/backends/database/__init__.py:68-69](repo://celery/backends/database/__init__.py#L68-L69), [celery/backends/database/__init__.py:113-115](repo://celery/backends/database/__init__.py#L113-L115)

```mermaid
erDiagram
  celery_taskmeta {
    int id PK
    string task_id UK
    string status
    blob result
    datetime date_done
    text traceback
    string name
    blob args
    blob kwargs
    string worker
    int retries
    string queue
  }
  celery_tasksetmeta {
    int id PK
    string taskset_id UK
    blob result
    datetime date_done
  }
```

Sources: [celery/backends/database/models.py:27-121](repo://celery/backends/database/models.py#L27-L121)

### Storing and reading rows

`_store_result` opens a session, loads the row for `task_id` or inserts a new one, and calls `_update_result`. That method builds the meta with `_get_result_meta(..., format_date=False, encode=True)` and copies each key onto the column of the same name, setting columns missing from the meta to `None` and never touching `id` or `task_id`. Every operation runs inside `session_cleanup`, which rolls back on error and always closes the session.

Sources: [celery/backends/database/__init__.py:34-42](repo://celery/backends/database/__init__.py#L34-L42), [celery/backends/database/__init__.py:135-168](repo://celery/backends/database/__init__.py#L135-L168)

`_get_task_meta_for` returns an unsaved `PENDING` row when nothing is stored, decodes `args` and `kwargs` for extended rows, and passes the dict through `meta_from_decoded` to rebuild exceptions. Groups are written once by `_save_group` and read with `_restore_group`; `_forget` and `_delete_group` delete rows. `cleanup`, which the `celery.backend_cleanup` periodic task calls since this backend does not auto-expire, deletes task and group rows whose `date_done` is older than `result_expires`.

Sources: [celery/backends/database/__init__.py:170-250](repo://celery/backends/database/__init__.py#L170-L250), [celery/app/builtins.py:13-23](repo://celery/app/builtins.py#L13-L23)

### SessionManager

`SessionManager` keeps engines and session factories per URL, but only after a fork. Before `register_after_fork` marks it `forked`, `get_engine` creates a throwaway engine with `NullPool` (dropping the `pool*`, `max_overflow` and `echo_pool` options it does not support), so that a parent process never hands pooled connections to its children. After the fork it caches one engine per URL and one `sessionmaker`, unless short-lived sessions are enabled. `engine_callback` runs on every engine it creates.

Sources: [celery/backends/database/session.py:29-71](repo://celery/backends/database/session.py#L29-L71)

`session_factory` calls `prepare_models` before returning a session. It runs `metadata.create_all` once per manager and retries it up to `PREPARE_MODELS_MAX_RETRIES` (10) times with exponential backoff on `DatabaseError`, because concurrent workers can race on the existence checks.

Sources: [celery/backends/database/session.py:22-22](repo://celery/backends/database/session.py#L22-L22), [celery/backends/database/session.py:80-106](repo://celery/backends/database/session.py#L80-L106)

### Retry on errors

Unlike other backends, the database backend retries by default: it reads `result_backend_always_retry` with a default of `True` and `result_backend_max_retries` with a default of `3`, which keeps the behaviour of the retry decorator it used before. `exception_safe_to_retry` accepts SQLAlchemy's `DatabaseError`, `InterfaceError`, `InvalidRequestError` and `StaleDataError`. Before each retry, `on_backend_retryable_error` calls `SessionManager.invalidate(url)`, which drops the cached session factory and disposes the engine, so the next attempt reconnects instead of reusing a broken connection. Table creation in `_create_tables` goes through the same retry loop.

Sources: [celery/backends/database/__init__.py:26-31](repo://celery/backends/database/__init__.py#L26-L31), [celery/backends/database/__init__.py:62-66](repo://celery/backends/database/__init__.py#L62-L66), [celery/backends/database/__init__.py:117-125](repo://celery/backends/database/__init__.py#L117-L125), [celery/backends/database/session.py:73-78](repo://celery/backends/database/session.py#L73-L78)

```mermaid
flowchart TD
  A["store_result()"] --> B["_ensure_retryable(_store_result)"]
  B --> C["ResultSession() and query/insert row"]
  C -->|ok| D["commit and close"]
  C -->|"DatabaseError, InterfaceError, ..."| E{"retries < max_retries (3)?"}
  E -->|yes| F["on_backend_retryable_error:<br>SessionManager.invalidate(url)"]
  F --> G["exponential backoff sleep"]
  G --> C
  E -->|no| H["raise BackendStoreError"]
```

Sources: [celery/backends/base.py:635-693](repo://celery/backends/base.py#L635-L693), [celery/backends/database/__init__.py:117-121](repo://celery/backends/database/__init__.py#L117-L121)

## Document and wide-column stores

### MongoDB

Scheme `mongodb://` (and `mongodb+srv://`, whose `+` makes `by_url` hand `srv://...` to the backend, which then restores the `mongodb+` prefix in `_ensure_mongodb_uri_compliance`). `MongoBackend` subclasses `BaseBackend`; the URI's hosts, credentials, database and options are parsed with pymongo's `uri_parser`, and `mongodb_backend_settings` can override `host`, `port`, `user`, `password`, `database` (default `celery`), `taskmeta_collection` (`celery_taskmeta`), `groupmeta_collection` (`celery_groupmeta`) and client `options`.

Sources: [celery/backends/mongodb.py:44-128](repo://celery/backends/mongodb.py#L44-L128), [celery/app/backends.py:62-68](repo://celery/app/backends.py#L62-L68)

Each task is one document keyed by `_id = task_id`, written with `replace_one(..., upsert=True)`; an `InvalidDocument` becomes `EncodeError`. With the `bson` serializer the result is stored natively, and `pickle`/`msgpack` payloads are wrapped in `Binary`. Both collections get a background index on `date_done`, and `cleanup` deletes older documents because `supports_autoexpire` is false.

Sources: [celery/backends/mongodb.py:166-196](repo://celery/backends/mongodb.py#L166-L196), [celery/backends/mongodb.py:273-320](repo://celery/backends/mongodb.py#L273-L320)

### Cassandra

Scheme `cassandra://`, base `BaseBackend`. Configuration comes from settings only: exactly one of `cassandra_servers` or `cassandra_secure_bundle_path` (for AstraDB), plus `cassandra_keyspace` and `cassandra_table`, otherwise `ImproperlyConfigured`. `cassandra_port` defaults to 9042, `cassandra_read_consistency` and `cassandra_write_consistency` to `LOCAL_QUORUM`, `cassandra_auth_provider` with `cassandra_auth_kwargs` names a `cassandra.auth` class, and `cassandra_options` is passed to `Cluster`.

Sources: [celery/backends/cassandra.py:88-140](repo://celery/backends/cassandra.py#L88-L140), [celery/app/defaults.py:115-127](repo://celery/app/defaults.py#L115-L127)

The connection is created lazily under a lock. Writers (workers) issue `CREATE TABLE` with the task id as partition key and `date_done` descending as clustering column, ignoring `AlreadyExists`. `cassandra_entry_ttl` appends `USING TTL` to every insert, which is how the backend auto-expires. An `OperationTimedOut` during connect shuts down the cluster so the next call retries cleanly.

Sources: [celery/backends/cassandra.py:37-64](repo://celery/backends/cassandra.py#L37-L64), [celery/backends/cassandra.py:142-248](repo://celery/backends/cassandra.py#L142-L248)

### Elasticsearch

Scheme `elasticsearch://host:port/index/doc_type` (also `http`/`https` URLs through `elasticsearch+https://`), base `KeyValueStoreBackend`, default index `celery` on `localhost:9200`. Settings: `elasticsearch_retry_on_timeout`, `elasticsearch_timeout` (10), `elasticsearch_max_retries` (3) and `elasticsearch_save_meta_as_text` (true; when false, the meta is stored as a document with only `result` and `traceback` encoded).

Sources: [celery/backends/elasticsearch.py:38-88](repo://celery/backends/elasticsearch.py#L38-L88), [celery/app/backends.py:59-69](repo://celery/app/backends.py#L59-L69), [celery/backends/elasticsearch.py:233-255](repo://celery/backends/elasticsearch.py#L233-L255), [celery/app/defaults.py:231-238](repo://celery/app/defaults.py#L231-L238)

Writes first try `index` with `op_type=create`; on a conflict `_update` reads the existing document and does nothing if it is already `SUCCESS`, or if it is ready and the new state is not, then updates with `if_seq_no`/`if_primary_term` optimistic concurrency. `exception_safe_to_retry` returns true for API errors 401, 409, 500, 502, 504 and transport errors, enabling `result_backend_always_retry`.

Sources: [celery/backends/elasticsearch.py:90-102](repo://celery/backends/elasticsearch.py#L90-L102), [celery/backends/elasticsearch.py:128-231](repo://celery/backends/elasticsearch.py#L128-L231)

### CouchDB, Couchbase and ArangoDB

| Backend | URL | Defaults | Notes |
| --- | --- | --- | --- |
| `CouchBackend` | `couchdb://user:pass@host:port/container` | `localhost:5984`, container `default`, always `http` | Stores `{'_id': key, 'value': value}`; on `Conflict` re-reads and saves the new value; creates the database if missing |
| `CouchbaseBackend` | `couchbase://user:pass@host:port/bucket` | `localhost:8091`, bucket `default` | `couchbase_backend_settings` dict as fallback; `upsert` with `ttl=expires`, so `supports_autoexpire`; keys are `str` |
| `ArangoDbBackend` | `arangodb://user:pass@host:port/database/collection` | `127.0.0.1:8529`, database and collection `celery` | `arangodb_backend_settings` adds `http_protocol` and `verify`; AQL `UPSERT` for writes; `cleanup` removes records by `task.date_done` |

Sources: [celery/backends/couchdb.py:21-100](repo://celery/backends/couchdb.py#L21-L100), [celery/backends/couchbase.py:23-114](repo://celery/backends/couchbase.py#L23-L114), [celery/backends/arangodb.py:23-99](repo://celery/backends/arangodb.py#L23-L99), [celery/backends/arangodb.py:120-145](repo://celery/backends/arangodb.py#L120-L145), [celery/backends/arangodb.py:176-190](repo://celery/backends/arangodb.py#L176-L190)

### Azure Cosmos DB (SQL API)

Scheme `cosmosdbsql://:{key}@{host}:{port}`, base `KeyValueStoreBackend`. The host and password (the master key) are required; port 443 selects `https`, any other port `http`. `cosmosdbsql_database_name` (`celerydb`), `cosmosdbsql_collection_name` (`celerycol`), `cosmosdbsql_consistency_level` (`Session`), `cosmosdbsql_max_retry_attempts` (9) and `cosmosdbsql_max_retry_wait_time` (30) configure the `pydocumentdb` client, which creates the database and a collection partitioned on `/id` on first use.

Sources: [celery/backends/cosmosdbsql.py:30-145](repo://celery/backends/cosmosdbsql.py#L30-L145), [celery/app/defaults.py:172-178](repo://celery/app/defaults.py#L172-L178)

## Caches and key/value services

### Memcached and in-memory cache

Scheme `cache+memcached://host1:11211;host2:11211/`, or `cache_backend` set to `memcache`, `memcached`, `pylibmc` or `memory`. `CacheBackend` prefers `pylibmc` and falls back to `python-memcached`; `memory` uses a `DummyClient` over a process-wide `LRUCache` of 5000 entries, which is only useful for tests. `cache_backend_options` are passed to the client. Values are set with `expires` as their time, and `supports_autoexpire` is true.

Sources: [celery/backends/cache.py:23-126](repo://celery/backends/cache.py#L23-L126), [celery/app/defaults.py:109-114](repo://celery/app/defaults.py#L109-L114)

This backend has `implements_incr = True`, so it uses the counter-based chord path: `_apply_chord_incr` sets the chord key to 0 with the result TTL, every header task increments it, and `expire` refreshes it with memcached `touch`.

Sources: [celery/backends/cache.py:96-96](repo://celery/backends/cache.py#L96-L96), [celery/backends/cache.py:131-141](repo://celery/backends/cache.py#L131-L141), [celery/backends/base.py:1188-1256](repo://celery/backends/base.py#L1188-L1256)

### DynamoDB

Scheme `dynamodb://access_key:secret@region:port/table?read=n&write=n&ttl_seconds=n`, base `KeyValueStoreBackend`, default table `celery`. Both or neither of the key id and secret must be given; a region of `localhost` or an IP address targets local DynamoDB at `http://host:port`, and `dynamodb_endpoint_url` overrides the endpoint. On first client use the backend creates the table if needed with the given read and write capacity.

Sources: [celery/backends/dynamodb.py:29-148](repo://celery/backends/dynamodb.py#L29-L148), [celery/backends/dynamodb.py:165-190](repo://celery/backends/dynamodb.py#L165-L190)

Items hold `id`, a binary `result` and a `timestamp`. A non-negative `ttl_seconds` enables the table's TTL on the `ttl` attribute and writes an expiry with each item, a negative one disables TTL, and leaving it unset leaves the table's TTL alone. Chords use an atomic `update_item` on a `chord_count` attribute, initialised by `_apply_chord_incr`.

Sources: [celery/backends/dynamodb.py:240-249](repo://celery/backends/dynamodb.py#L240-L249), [celery/backends/dynamodb.py:450-475](repo://celery/backends/dynamodb.py#L450-L475), [celery/backends/dynamodb.py:543-556](repo://celery/backends/dynamodb.py#L543-L556)

### Consul

Scheme `consul://host:port[/path]`, base `KeyValueStoreBackend`, `supports_autoexpire = True`. The URL path becomes a key prefix. Each `set` creates a Consul session named after the key with `behavior='delete'` and `ttl=expires`, and writes the key acquired by that session, so Consul deletes the key when the session expires. By default a new client is created per operation; `?one_client=1` reuses one.

Sources: [celery/backends/consul.py:27-116](repo://celery/backends/consul.py#L27-L116)

### File system

Scheme `file:///path/to/dir` (or `file://localhost/path`), base `KeyValueStoreBackend`. Each key is a file in that directory. The constructor writes, reads and deletes a `.fs-backend-<uuid>` test file and raises `E_PATH_INVALID` if that fails, so a missing or read-only directory is reported at startup. `cleanup` deletes task, group and chord files whose modification time is older than `result_expires`. Clients on other machines can only read results if they see the same directory.

Sources: [celery/backends/filesystem.py:14-112](repo://celery/backends/filesystem.py#L14-L112)

## Object storage

### Amazon S3

Scheme `s3://`, base `KeyValueStoreBackend`. The URL carries no parameters; everything comes from settings: `s3_bucket` (required), `s3_base_path` (prepended to keys), `s3_access_key_id`, `s3_secret_access_key`, `s3_region` and `s3_endpoint_url` for S3-compatible services. A boto3 session without resolvable credentials raises `ImproperlyConfigured('Missing aws s3 creds')`. A 404 on `get` means the result is pending.

Sources: [celery/backends/s3.py:20-87](repo://celery/backends/s3.py#L20-L87), [celery/app/defaults.py:128-135](repo://celery/app/defaults.py#L128-L135)

### Google Cloud Storage

Scheme `gs://bucket/base_path?gcs_project=...`: the host becomes `gcs_bucket`, the path `gcs_base_path`, and query parameters are merged into the configuration. `gcs_bucket` and `gcs_project` are required. `gcs_ttl` sets each blob's `custom_time`, and requires the bucket to have a `Delete` lifecycle rule. `gcs_threadpool_maxsize` (10) sizes the HTTP pool, `mget` fetches in a thread pool, and clients are re-created per process after a fork.

Sources: [celery/backends/gcs.py:43-158](repo://celery/backends/gcs.py#L43-L158), [celery/app/defaults.py:145-150](repo://celery/app/defaults.py#L145-L150)

`GCSBackend` adds chords on top of `GCSBackendBase`: it requires `google-cloud-firestore`, counts header completions with `firestore.Increment` in a `celery` collection (project `firestore_project`, defaulting to `gcs_project`), and refuses to start unless that collection has a TTL policy on `expires_at`.

Sources: [celery/backends/gcs.py:161-245](repo://celery/backends/gcs.py#L161-L245)

### Azure Block Blob

Scheme `azureblockblob://<connection string>`, or `azureblockblob://DefaultAzureCredential@<account URL>` / `ManagedIdentityCredential@<account URL>` for Azure identity credentials. Base `KeyValueStoreBackend`; each key is a blob in `azureblockblob_container_name` (default `celery`, created on first use) under `azureblockblob_base_path`. `azureblockblob_connection_timeout` (20) and `azureblockblob_read_timeout` (120) configure the client, and `as_uri` redacts the `AccountKey`.

Sources: [celery/backends/azureblockblob.py:21-105](repo://celery/backends/azureblockblob.py#L21-L105), [celery/backends/azureblockblob.py:170-188](repo://celery/backends/azureblockblob.py#L170-L188), [celery/app/defaults.py:136-144](repo://celery/app/defaults.py#L136-L144)

## Choosing a store

| Backend | Base | Auto-expire | Chords |
| --- | --- | --- | --- |
| Database | `BaseBackend` | No, `cleanup` task | `chord_unlock` polling |
| MongoDB | `BaseBackend` | No, `cleanup` task | `chord_unlock` polling |
| Cassandra | `BaseBackend` | Via `cassandra_entry_ttl` | `chord_unlock` polling |
| Cache | `KeyValueStoreBackend` | Yes | Counter (`incr`) |
| DynamoDB | `KeyValueStoreBackend` | Yes (TTL) | Counter (`incr`) |
| GCS | `KeyValueStoreBackend` | Lifecycle rule | Counter in Firestore |
| Consul, Couchbase | `KeyValueStoreBackend` | Yes | `chord_unlock` polling |
| Elasticsearch, CouchDB, ArangoDB, Cosmos DB, S3, Azure Block Blob, File system | `KeyValueStoreBackend` | No | `chord_unlock` polling |

Sources: [celery/backends/base.py:838-867](repo://celery/backends/base.py#L838-L867), [celery/backends/cache.py:90-96](repo://celery/backends/cache.py#L90-L96), [celery/backends/dynamodb.py:55-66](repo://celery/backends/dynamodb.py#L55-L66), [celery/backends/gcs.py:161-168](repo://celery/backends/gcs.py#L161-L168), [celery/backends/consul.py:32-32](repo://celery/backends/consul.py#L32-L32), [celery/backends/couchbase.py:37-37](repo://celery/backends/couchbase.py#L37-L37), [celery/backends/cassandra.py:86-86](repo://celery/backends/cassandra.py#L86-L86)
