---
type: architecture
title: Configuration System
description: How Celery settings are declared in celery/app/defaults.py, merged from constructor arguments, config modules and environment variables into app.conf, and how old UPPERCASE names, namespaces and command-line overrides are handled.
tags: [configuration, settings, defaults, app-conf, environment]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:05:29.073Z
sources:
  - id: openwiki-source-ac404435efa758dad4bbfc83
    resource: repo://celery/app/defaults.py
  - id: openwiki-source-ceca684addb7674df2c5c60b
    resource: repo://celery/app/utils.py
  - id: openwiki-source-461899b2d0d382360e23a4f2
    resource: repo://celery/loaders/base.py
  - id: openwiki-source-52c74111faf5c6e27707e52a
    resource: repo://docs/conf.py
  - id: openwiki-source-ccd2623ea7a88d6abc2d9b5a
    resource: repo://tox.ini
generated: { by: "claude-code", at: "2026-11-16T17:05:29.073Z" }
---

# Configuration System

Celery's configuration is a layered, lazily-built mapping exposed as `app.conf`. The schema lives in `celery/app/defaults.py`; merging and access live in `celery/app/utils.py` (`Settings`, `detect_settings`) on top of `ConfigurationView` from `celery/utils/collections.py`; loading is driven by the app (`celery/app/base.py`) and the loader (`celery/loaders/base.py`). For the app-level lifecycle that triggers loading, see [The Celery Application Object](application-object.md).

## Declaring settings: `NAMESPACES` and `Option`

Every known setting is an `Option(default, type=..., old=..., deprecate_by=..., remove_by=..., alt=...)` placed inside nested `Namespace(...)` dicts:

```text
NAMESPACES
├── accept_content, enable_utc, imports, include, timezone, result_accept_content
├── beat_*        (scheduler, schedule, schedule_filename, max_loop_interval, ...)
├── broker_*      (url, read_url, write_url, transport_options, pool_limit, ...)
├── result_*      (backend, expires, serializer, extended, ...)
├── task_*        (serializer, acks_late, routes, queues, default_queue, protocol, time_limit, ...)
├── worker_*      (pool, concurrency, prefetch_multiplier, consumer, state_db, ...)
├── event_*, control_*, security_*, database_*, redis_*, cache_*, mongodb_*, s3_*, gcs_*, ...
```

`flatten(NAMESPACES)` joins namespace and key with `_` to produce the flat lowercase names (`task_acks_late`, `worker_prefetch_multiplier`). From that the module builds:

- `DEFAULTS` — flat name → default value.
- `SETTING_KEYS` — the set of all new-style names.
- `_TO_NEW_KEY` / `_TO_OLD_KEY` — bidirectional mapping to legacy UPPERCASE names. A namespace's `__old__` template (`celery_{0}`, `celerybeat_{0}`, `celeryd_{0}`) generates the old name unless an option sets an explicit `old=`, e.g. `task_serializer` ↔ `CELERY_TASK_SERIALIZER`, `worker_lost_wait` ↔ `CELERYD_WORKER_LOST_WAIT`.

`Option.to_python()` converts strings using a small typemap (`string`, `int`, `float`, `bool` via `strtobool`, `dict`, `tuple`, `any`), which is how command-line overrides are typed. `find(name)` performs a memoized lookup by name across namespaces.

Notable defaults: `accept_content=('json',)`, `task_serializer='json'`, `task_protocol=2`, `task_default_queue='celery'`, `worker_pool='prefork'`, `worker_prefetch_multiplier=4`, `beat_scheduler='celery.beat:PersistentScheduler'`, `task_acks_late=False`, `enable_utc=True`.

## Sources and precedence

When the configuration is first read, `Celery._load_config()` builds the final object. Precedence from highest to lowest:

1. **Environment overrides for connection URLs** — `Settings.broker_url`, `broker_read_url`, `broker_write_url` and `result_backend` are properties that consult `CELERY_BROKER_URL`, `CELERY_BROKER_READ_URL`, `CELERY_BROKER_WRITE_URL`, and `CELERY_RESULT_BACKEND` *before* the stored values. `broker_read_url`/`broker_write_url` fall back to `broker_url`.
2. **Changes / preconf** — values passed to the `Celery(...)` constructor (`broker=`, `backend=`, `include=`, other kwargs, `changes=`) and any `app.conf[...] = value` assignment. These are the `changes` layer of the `ConfigurationView`.
3. **Loader configuration** — the object or module given to `config_from_object()` / `config_from_envvar()` (or `celeryconfig` for the default loader). String sources are imported from the current working directory; `module:attribute` paths are supported.
4. **Defaults** — `DEFAULTS` (or the old-name defaults, see below), plus any lazily-added dicts from `app.add_defaults()`.

`detect_settings()` returns `Settings(preconf, [conf, defaults], ...)`, which is exactly this stack. Lookups through `Settings` translate keys in both directions, so reading `app.conf.CELERY_TASK_SERIALIZER` and `app.conf.task_serializer` resolve to the same value.

Some derived properties add fallbacks: `task_default_exchange` and `task_default_routing_key` fall back to `task_default_queue`, and `timezone` falls back to Django's `TIME_ZONE`.

## Old vs new setting names

`detect_settings()` decides whether a configuration uses the new lowercase names or the legacy UPPERCASE ones:

- It counts which known keys appear in the source (ignoring keys auto-set from constructor arguments).
- The style in the majority wins; if a `namespace` prefix is in use, the new format is always chosen.
- Keys from the losing style raise `ImproperlyConfigured` with a rename table — **mixing styles is an error**, unless the user supplied both the old and new key for the same setting.
- Old keys present are recorded as `deprecated_settings`; `Settings.maybe_warn_deprecated_settings()` emits deprecation warnings (scheduled for removal in 6.0).

Separately, `find_deprecated_settings()` (called via `app.prepare_config`) warns about options declared with `deprecate_by`/`remove_by`, such as `task_acks_on_failure_or_timeout`.

## Namespaces (`Celery(namespace='CELERY')`)

A namespace makes every key prefixed, typically used to read Celery settings from a Django settings module (`CELERY_BROKER_URL`, `CELERY_TASK_ALWAYS_EAGER`). `ConfigurationView` with a `prefix` rewrites lookups to `prefix + key` while matching the case of the prefix. `config_from_object(obj, namespace=...)` can set it as well.

## Command-line overrides

`BaseLoader.cmdline_config_parser()` parses `key=value` arguments (used by `app.config_from_cmdline`). Keys are lower-cased and dots become underscores; a leading `_` or `.` expands to the default namespace. Values are converted using the option's declared type, or with an explicit cast prefix such as `(json)` / `(int)`; `tuple`, `list` and `dict` casts are parsed as JSON.

## Inspecting configuration

- `app.conf.humanize(with_defaults=False, censored=True)` / `app.conf.table()` — show changed settings. Keys matching `API|TOKEN|KEY|SECRET|PASS|SIGNATURE|DATABASE|BEAT_DBURI` are masked, and broker/backend URLs have their passwords masked.
- `app.conf.without_defaults()` — drop the defaults layer.
- `app.bugreport()` / `celery report` — environment and settings report.
- `app.conf.finalize()` — force the pending configuration to load.

## Configuration-related signals and hooks

- `app.on_configure` — before the config source is read (good place to call `add_defaults`).
- `app.on_after_configure` — after settings are built; `add_periodic_task` registrations made before this point are queued and applied here.
- `celery.signals.import_modules` — fired by the loader when importing `imports`/`include` modules at worker start.

## Documentation consistency

The user-facing reference for every setting is `docs/userguide/configuration.rst`. The `configcheck` tox environment runs a Sphinx `configcheck` builder that compares documented settings against `NAMESPACES`, so adding an `Option` requires documenting it.

## Tests

- `t/unit/app/test_defaults.py` — option declarations, old/new name mapping, `find()`.
- `t/unit/app/test_app.py` — `config_from_object`, mixing old and new keys, namespace handling, env URL overrides.
- `t/unit/app/test_loaders.py` — `cmdline_config_parser`, default loader behaviour.

## Related

- [The Celery Application Object](application-object.md)
- [Message Protocol, Queues and Routing](../tasks/messaging-and-routing.md)
