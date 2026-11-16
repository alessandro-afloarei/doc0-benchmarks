---
title: "Database Backend"
---
## Overview

The database backend stores task results and group results in a relational database through SQLAlchemy, so any database SQLAlchemy supports (PostgreSQL, MySQL, SQLite, SQL Server, ...) can hold Celery results. It is selected with a `db+` prefix on a SQLAlchemy URL, for example `db+postgresql://user:pw@host/dbname`. The package has three modules: `celery/backends/database/__init__.py` with `DatabaseBackend`, `models.py` with the `Task`, `TaskExtended` and `TaskSet` tables, and `session.py` with `SessionManager`, which creates engines and sessions and handles forking. It builds on the shared backend logic described in [[Result Backends]].

Sources: [celery/backends/database/__init__.py:1-53](repo://celery/backends/database/__init__.py#L1-L53), [celery/backends/database/models.py:1-12](repo://celery/backends/database/models.py#L1-L12), [celery/backends/database/session.py:1-30](repo://celery/backends/database/session.py#L1-L30), [celery/app/backends.py:22-23](repo://celery/app/backends.py#L22-L23), [celery/app/backends.py:59-69](repo://celery/app/backends.py#L59-L69)

`DatabaseBackend` subclasses `BaseBackend`, so clients poll it: `subpolling_interval = 0.5` makes `ResultSet.iterate` sleep between queries. It has no atomic counter, so chords use the `celery.chord_unlock` polling task, and it does not expire rows by itself, so cleanup relies on the `celery.backend_cleanup` task.

Sources: [celery/backends/database/__init__.py:45-53](repo://celery/backends/database/__init__.py#L45-L53), [celery/backends/base.py:120-126](repo://celery/backends/base.py#L120-L126), [celery/backends/base.py:838-867](repo://celery/backends/base.py#L838-L867)

## Configuration

### Connecting

`by_url()` splits `db+postgresql://...` at the `+`: `db` selects `DatabaseBackend` and the rest is passed as `url`. The constructor uses `url`, then the `dburi` argument, then the `database_url` setting, and raises `ImproperlyConfigured('Missing connection string! ...')` when none is set. Importing the module without SQLAlchemy installed raises `ImproperlyConfigured` as well.

Sources: [celery/app/backends.py:59-69](repo://celery/app/backends.py#L59-L69), [celery/backends/database/__init__.py:14-20](repo://celery/backends/database/__init__.py#L14-L20), [celery/backends/database/__init__.py:55-96](repo://celery/backends/database/__init__.py#L55-L96)

```python
app.conf.result_backend = 'db+postgresql://celery:secret@db.example.com/celery_results'
app.conf.database_engine_options = {'pool_size': 10, 'echo': False}
app.conf.database_table_names = {'task': 'myapp_taskmeta', 'group': 'myapp_groupmeta'}
```

Sources: [celery/backends/database/__init__.py:71-91](repo://celery/backends/database/__init__.py#L71-L91)

### Settings

| Setting | Default | Effect |
| --- | --- | --- |
| `database_url` | `None` | Connection string when `result_backend` does not carry one. |
| `database_engine_options` | `{'pool_pre_ping': True, 'pool_recycle': 3600}` | Keyword arguments for `create_engine`; constructor `engine_options` are merged on top. |
| `database_engine_callback` | `None` | Callable, or dotted path to one, called with every new engine (to add event listeners, for example). A non-callable raises `ImproperlyConfigured`. |
| `database_short_lived_sessions` | `False` | Build a new `sessionmaker` for every session in forked workers instead of reusing one. |
| `database_table_schemas` | `None` | Dict with `task` and `group` keys giving the schema of each table. |
| `database_table_names` | `None` | Dict with `task` and `group` keys renaming `celery_taskmeta` and `celery_tasksetmeta`. |
| `database_create_tables_at_setup` | `True` | Create the tables when the backend is constructed instead of at the first query. |
| `result_extended` | `False` | Use `TaskExtended` and store name, args, kwargs, worker, retries and queue. |
| `result_expires` | 1 day | Age after which `cleanup()` deletes rows. |

Sources: [celery/app/defaults.py:248-263](repo://celery/app/defaults.py#L248-L263), [celery/app/defaults.py:216-221](repo://celery/app/defaults.py#L216-L221), [celery/backends/database/__init__.py:68-111](repo://celery/backends/database/__init__.py#L68-L111)

Table names and schemas are applied by calling `configure()` on the model classes, which sets `__table__.schema`, the schema of the id sequence and `__table__.name`. Because this changes the class-level table, every `DatabaseBackend` in the process shares the last configuration.

Sources: [celery/backends/database/__init__.py:84-91](repo://celery/backends/database/__init__.py#L84-L91), [celery/backends/database/models.py:57-61](repo://celery/backends/database/models.py#L57-L61), [celery/backends/database/models.py:117-121](repo://celery/backends/database/models.py#L117-L121)

## Models

### Tables

All models derive from `ResultModelBase`, a SQLAlchemy `declarative_base()`. The integer primary keys use `DialectSpecificInteger`, which becomes `BigInteger` on SQL Server, and named sequences for databases that need them.

Sources: [celery/backends/database/session.py:12-18](repo://celery/backends/database/session.py#L12-L18), [celery/backends/database/models.py:14-14](repo://celery/backends/database/models.py#L14-L14)

| Model | Table | Columns |
| --- | --- | --- |
| `Task` | `celery_taskmeta` | `id` (sequence `task_id_sequence`), `task_id` (`String(155)`, unique), `status` (`String(50)`, default `PENDING`), `result` (`PickleType`), `date_done` (`DateTime`, indexed, set on insert and update), `traceback` (`Text`) |
| `TaskExtended` | `celery_taskmeta` (extends `Task`) | Adds `name`, `args` (`LargeBinary`), `kwargs` (`LargeBinary`), `worker`, `retries`, `queue` |
| `TaskSet` | `celery_tasksetmeta` | `id` (sequence `taskset_id_sequence`), `taskset_id` (`String(155)`, unique), `result` (`PickleType`), `date_done` (`DateTime`, indexed) |

Sources: [celery/backends/database/models.py:27-112](repo://celery/backends/database/models.py#L27-L112)

`date_done` defaults to `_get_utc_now`, a callable, so the timestamp is computed when the row is written rather than once at import. `TaskExtended` uses `extend_existing` to add columns to the same `celery_taskmeta` table, so switching `result_extended` on requires those columns to exist in an already-created table.

Sources: [celery/backends/database/models.py:17-24](repo://celery/backends/database/models.py#L17-L24), [celery/backends/database/models.py:38-40](repo://celery/backends/database/models.py#L38-L40), [celery/backends/database/models.py:64-76](repo://celery/backends/database/models.py#L64-L76)

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

Sources: [celery/backends/database/models.py:27-112](repo://celery/backends/database/models.py#L27-L112)

> [!NOTE]
> `result` is a `PickleType` column, so what is stored there is always pickled by SQLAlchemy. With the default `json` result serializer the value is the output of `encode_result()`, so a failure is stored as the `exc_type`/`exc_message`/`exc_module` dict, not as the exception object.

Sources: [celery/backends/database/models.py:37-37](repo://celery/backends/database/models.py#L37-L37), [celery/backends/base.py:447-455](repo://celery/backends/base.py#L447-L455), [celery/backends/base.py:573-576](repo://celery/backends/base.py#L573-L576)

## Storing and reading results

### Writing a task result

`store_result()` in the base class encodes the result and calls `_store_result()` inside the retry loop. `_store_result()` opens a session, looks the row up by `task_id`, inserts a new `Task` (or `TaskExtended`) row when missing, fills it with `_update_result()` and commits. `_update_result()` builds the meta with `_get_result_meta(format_date=False, encode=True)`, so `date_done` stays a `datetime` and `args`/`kwargs` are serialized to bytes, then sets every table column except `id` and `task_id` from the meta, writing `None` for keys the meta lacks.

Sources: [celery/backends/database/__init__.py:135-168](repo://celery/backends/database/__init__.py#L135-L168), [celery/backends/base.py:581-630](repo://celery/backends/base.py#L581-L630), [celery/backends/base.py:673-693](repo://celery/backends/base.py#L673-L693)

```mermaid
sequenceDiagram
  participant Worker
  participant Backend as DatabaseBackend
  participant SM as SessionManager
  participant DB as Database
  Worker->>Backend: store_result(task_id, result, state)
  Backend->>Backend: encode_result(), _ensure_retryable()
  Backend->>SM: ResultSession() / session_factory(dburi)
  SM->>DB: create_engine() and create_all() once
  Backend->>DB: SELECT celery_taskmeta WHERE task_id
  Backend->>DB: INSERT row if missing, then UPDATE columns
  Backend->>DB: COMMIT
  Backend->>Backend: session_cleanup(): rollback on error, close
```

Sources: [celery/backends/database/__init__.py:34-43](repo://celery/backends/database/__init__.py#L34-L43), [celery/backends/database/__init__.py:127-168](repo://celery/backends/database/__init__.py#L127-L168), [celery/backends/database/session.py:103-106](repo://celery/backends/database/session.py#L103-L106)

Every operation wraps its session in `session_cleanup()`, which rolls back on any exception, re-raises it, and always closes the session.

Sources: [celery/backends/database/__init__.py:34-43](repo://celery/backends/database/__init__.py#L34-L43)

### Reading and other operations

| Method | Query |
| --- | --- |
| `_get_task_meta_for(task_id)` | Select the row; a missing row yields a transient `Task` with `PENDING`. Decodes `args`/`kwargs`, then `meta_from_decoded()` rebuilds exceptions. |
| `task_result_exists(task_id)` | `first() is not None` on the task table, through the retry loop. |
| `_save_group(group_id, result)` | Insert a `TaskSet` row holding the pickled group result. |
| `_restore_group(group_id)` | Return `to_dict()` of the matching `TaskSet`, or `None`. |
| `_delete_group(group_id)` | Delete the `TaskSet` row. |
| `_forget(task_id)` | Delete the task row. |

Sources: [celery/backends/database/__init__.py:170-235](repo://celery/backends/database/__init__.py#L170-L235)

## Sessions and engines

### SessionManager

`DatabaseBackend.ResultSession()` asks the `SessionManager` for `session_factory(dburi, short_lived_sessions=..., **engine_options)`, which creates the engine and sessionmaker, makes sure the tables exist, and returns a new session. The manager behaves differently before and after a fork, tracked by the `forked` flag that `register_after_fork` sets in child processes:

Sources: [celery/backends/database/__init__.py:127-133](repo://celery/backends/database/__init__.py#L127-L133)

| State | Engine | Sessionmaker |
| --- | --- | --- |
| Not forked (client, worker main process) | New engine per call with `NullPool`; options starting with `pool` plus `max_overflow` and `echo_pool` are dropped | New per call |
| Forked (prefork pool child) | Cached per `dburi`, created with all `engine_options` | Cached per `dburi`, or new per call with `database_short_lived_sessions` |

Sources: [celery/backends/database/__init__.py:127-133](repo://celery/backends/database/__init__.py#L127-L133), [celery/backends/database/session.py:25-71](repo://celery/backends/database/session.py#L25-L71)

Using `NullPool` before the fork means no pooled connection is created in a parent and then shared with its children, which would corrupt the connection state; children get their own pooled engine. `engine_callback`, when configured, is invoked for every engine created on either path.

Sources: [celery/backends/database/session.py:44-63](repo://celery/backends/database/session.py#L44-L63)

### Creating tables

`prepare_models()` runs `ResultModelBase.metadata.create_all(engine)` once per manager. SQLAlchemy checks for existing tables before creating them, which races when several workers start at once, so a `DatabaseError` is retried up to `PREPARE_MODELS_MAX_RETRIES` (10) times with jittered exponential backoff capped at one second. With `database_create_tables_at_setup` (the default) the constructor triggers this through `_create_tables()`; when disabled, the tables are still created, but on the first session instead.

Sources: [celery/backends/database/session.py:22-22](repo://celery/backends/database/session.py#L22-L22), [celery/backends/database/session.py:80-106](repo://celery/backends/database/session.py#L80-L106), [celery/backends/database/__init__.py:109-125](repo://celery/backends/database/__init__.py#L109-L125)

## Retrying on database errors

The backend used to wrap its methods in its own retry decorator; it now uses the shared `_ensure_retryable()` loop from the base class. `exception_safe_to_retry()` accepts `DatabaseError`, `InterfaceError`, `InvalidRequestError` and `StaleDataError`, and `on_backend_retryable_error()` calls `SessionManager.invalidate(url)`, which drops the cached sessionmaker and disposes the cached engine so the next attempt reconnects.

Sources: [celery/backends/database/__init__.py:26-31](repo://celery/backends/database/__init__.py#L26-L31), [celery/backends/database/__init__.py:62-66](repo://celery/backends/database/__init__.py#L62-L66), [celery/backends/database/__init__.py:117-121](repo://celery/backends/database/__init__.py#L117-L121), [celery/backends/database/session.py:73-78](repo://celery/backends/database/session.py#L73-L78), [celery/backends/base.py:635-671](repo://celery/backends/base.py#L635-L671)

```python
# Override retry defaults to preserve backward compatibility.
# Previously, DatabaseBackend used a custom @retry decorator that always
# retried with max_retries=3. We maintain this behavior by default.
self.always_retry = conf.get('result_backend_always_retry', True)
self.max_retries = conf.get('result_backend_max_retries', 3)
```

Sources: [celery/backends/database/__init__.py:62-66](repo://celery/backends/database/__init__.py#L62-L66)

> [!WARNING]
> The fallbacks `True` and `3` above only apply when the keys are absent from the configuration. The app's settings include defaults for both (`result_backend_always_retry=False`, `result_backend_max_retries=inf`), so in a standard app `conf.get` returns those defaults and no retry happens. Set `result_backend_always_retry = True` and `result_backend_max_retries = 3` explicitly to get the retrying behaviour.

Sources: [celery/backends/database/__init__.py:62-66](repo://celery/backends/database/__init__.py#L62-L66), [celery/app/defaults.py:226-229](repo://celery/app/defaults.py#L226-L229), [celery/app/utils.py:280-282](repo://celery/app/utils.py#L280-L282)

## Cleanup of expired results

The constructor passes `expires_type=maybe_timedelta`, so `self.expires` is a `timedelta` built from `result_expires`. `cleanup()` runs `_cleanup()` in the retry loop: it deletes task and group rows whose `date_done` is older than `app.now() - expires` and commits. `supports_autoexpire` is false for this backend, so `celery beat` adds the daily `celery.backend_cleanup` entry at 04:00 that calls it; see [[Celery Beat Scheduler]].

Sources: [celery/backends/database/__init__.py:55-59](repo://celery/backends/database/__init__.py#L55-L59), [celery/backends/database/__init__.py:237-250](repo://celery/backends/database/__init__.py#L237-L250), [celery/beat.py:268-277](repo://celery/beat.py#L268-L277), [celery/app/builtins.py:13-23](repo://celery/app/builtins.py#L13-L23)

> [!TIP]
> `date_done` is indexed on both tables, so the cleanup delete stays an index range scan even with many rows.

Sources: [celery/backends/database/models.py:38-39](repo://celery/backends/database/models.py#L38-L39), [celery/backends/database/models.py:100-101](repo://celery/backends/database/models.py#L100-L101)

When the backend is pickled (for example to send it to a pool process), `__reduce__` carries `dburi`, `expires` and `engine_options`, so the copy connects to the same database with the same options.

Sources: [celery/backends/database/__init__.py:252-258](repo://celery/backends/database/__init__.py#L252-L258)
