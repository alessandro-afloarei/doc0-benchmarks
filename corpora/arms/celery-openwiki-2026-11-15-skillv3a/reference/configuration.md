---
type: reference
title: Configuration Settings Reference
description: How Celery settings are declared (Option/Namespace tables in celery/app/defaults.py), how old uppercase names map to new lowercase names, how values are resolved (environment overrides, Settings properties, defaults), how secrets are censored, and a guided tour of the most consequential settings by group.
tags: [configuration, settings, defaults, reference]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:49.645Z
sources:
  - id: openwiki-source-ac404435efa758dad4bbfc83
    resource: repo://celery/app/defaults.py
  - id: openwiki-source-ceca684addb7674df2c5c60b
    resource: repo://celery/app/utils.py
  - id: openwiki-source-94b60a38fd26082deb41f979
    resource: repo://celery/worker/consumer/consumer.py
  - id: openwiki-source-12d3bd623a53e489a785c641
    resource: repo://celery/worker/worker.py
generated: { by: "claude-code", at: "2026-11-15T17:08:49.645Z" }
---

# Configuration Settings Reference

The authoritative list of settings is `celery/app/defaults.py`. The user documentation is `docs/userguide/configuration.rst`, and the `configcheck` lint target (`make configcheck`, `tox -e configcheck`) checks that every setting is documented there. This page explains the mechanism and points out the settings that change behaviour the most. For how and when configuration is loaded, see [The Celery Application Object](../architecture/application.md).

## How settings are declared

```python
NAMESPACES = Namespace(
    accept_content=Option(('json',), type='list', old=OLD_NS),
    broker=Namespace(url=Option(None, type='string'), ...),
    task=Namespace(__old__=OLD_NS, acks_late=Option(False, type='bool'), ...),
    ...
)
```

- An `Option(default, type=..., old=..., deprecate_by=..., remove_by=..., alt=...)` describes one setting. `type` selects a converter (`string`, `int`, `float`, `bool` via `strtobool`, `dict`, `tuple`, `any`), which `Option.to_python` uses when values come from strings such as the command line.
- Nested namespaces are flattened with `_`: `broker.url` → `broker_url`, `task.acks_late` → `task_acks_late`.
- `__old__` on a namespace gives each option its pre-4.0 uppercase name, for example `task_acks_late` ↔ `CELERY_ACKS_LATE`, `worker_*` ↔ `CELERYD_*`, `beat_*` ↔ `CELERYBEAT_*`. An option can override this with an explicit `old={...}`, for example `result_expires` ↔ `CELERY_TASK_RESULT_EXPIRES`.
- Derived tables: `DEFAULTS` (new name → default), `_TO_NEW_KEY`/`_TO_OLD_KEY`, `SETTING_KEYS`, and `_OLD_SETTING_KEYS`. `find(name)` looks up an option by name in any namespace, and `app.conf.find_option()` exposes it.
- Options with `deprecate_by`/`remove_by` produce deprecation warnings (`find_deprecated_settings`). For example, `task_acks_on_failure_or_timeout` is deprecated in 6.0 and will be removed in 7.0 in favour of `task_acks_on_failure` and `task_acks_on_timeout`.

## How values are resolved

`app.conf` is a `Settings` object (a `ConfigurationView` over `[user config, defaults]`, with pre-configuration from `Celery(...)` keyword arguments layered on top). Lookups go through key conversion, so both the new and old names work for reading.

- `detect_settings()` decides whether the user config uses old or new names, refuses mixtures, and converts pre-configuration to the chosen style. Using old names triggers `maybe_warn_deprecated_settings`, with removal planned for 6.0.
- Some properties combine sources. **Environment variables take precedence** here:
  - `broker_url` = `$CELERY_BROKER_URL` or `broker_url` or `broker_host`
  - `broker_read_url` / `broker_write_url` = `$CELERY_BROKER_READ_URL` / `$CELERY_BROKER_WRITE_URL` or the setting, falling back to `broker_url`
  - `result_backend` = `$CELERY_RESULT_BACKEND` or the setting
  - `task_default_exchange` / `task_default_routing_key` fall back to `task_default_queue`
  - `timezone` falls back to Django's `TIME_ZONE`
- `conf.without_defaults()` and `value_set_for(key)` tell you what the user explicitly set.
- `conf.table(censored=True)` and `humanize()` (used by `celery report` and the worker banner) **censor** values whose key matches `API|TOKEN|KEY|SECRET|PASS|SIGNATURE|DATABASE|...`. Passwords inside broker URLs and backend URLs are masked.

## Important settings by area

### Serialization and security

| Setting | Default | Notes |
|---|---|---|
| `accept_content` | `('json',)` | Content types the worker will deserialize. Adding `pickle` enables code execution by anyone who can publish; it is also refused for root workers (see [Deployment](../operations/deployment.md)). |
| `result_accept_content` | `None` (uses `accept_content`) | Content types accepted for results. |
| `task_serializer` / `result_serializer` / `event_serializer` | `json` | |
| `task_compression` / `result_compression` | none | gzip, bzip2, zstd, ... through kombu. |
| `security_key`, `security_certificate`, `security_cert_store`, `security_digest` (`sha256`) | | Message signing; see [Message Signing](../security/message-signing.md). |

### Broker

`broker_url`, `broker_transport_options` (transport-specific settings such as visibility timeout, global key prefix, and Sentinel), `broker_connection_retry`, `broker_connection_retry_on_startup` (`None` means startup retries follow `broker_connection_retry`; a pending-deprecation warning is emitted when that disables retries), `broker_connection_max_retries` (100), `broker_connection_timeout` (4s), `broker_heartbeat` (120s, AMQP), `broker_pool_limit` (10), `broker_failover_strategy`, `broker_native_delayed_delivery_queue_type` (`quorum`).

### Tasks and routing

- **Acknowledgement:** `task_acks_late` (False), `task_acks_on_failure` / `task_acks_on_timeout` (new, `None` = inherit), `task_reject_on_worker_lost`.
- **Execution:** `task_time_limit`, `task_soft_time_limit`, `task_default_rate_limit`, `task_track_started` (emit `STARTED` state), `task_ignore_result`, `task_store_errors_even_if_ignored`, `task_remote_tracebacks`.
- **Eager mode (tests):** `task_always_eager`, `task_eager_propagates`, `task_store_eager_result`.
- **Routing and queues:** `task_routes`, `task_queues`, `task_default_queue` (`celery`), `task_default_queue_type` (`classic`, or `quorum`), `task_default_exchange_type` (`direct`), `task_create_missing_queues` (True), `task_create_missing_queue_type`, `task_queue_max_priority`, `task_default_priority`, `task_inherit_parent_priority`, `task_default_delivery_mode` (2 = persistent).
- **Publishing:** `task_protocol` (2), `task_publish_retry` with `task_publish_retry_policy` (3 retries, 0–1s), `task_send_sent_event`.
- **Canvas:** `task_allow_error_cb_on_chord_header`.

See [Task Messages, Protocol and Routing](../tasks/messaging-and-routing.md).

### Results

`result_backend`, `result_expires` (1 day; also drives the `celery.backend_cleanup` beat entry), `result_extended` (store name, args, and worker in metadata), `result_persistent`, `result_cache_max` (-1 = disabled), `result_chord_join_timeout` (3s), `result_chord_retry_interval` (1s), `result_backend_always_retry` with `result_backend_max_retries` and base/max sleep, and `result_backend_transport_options`. Per-backend groups: `redis_*`, `database_*` (`database_engine_options` defaults to `pool_pre_ping=True, pool_recycle=3600`), `mongodb_backend_settings`, `cache_backend`, `s3_*`, `azureblockblob_*`, `gcs_*`, `cassandra_*`, `elasticsearch_*`, `cosmosdbsql_*`, `couchbase_*`, `arangodb_*`. See [Result Backends](../results/backends.md).

### Worker

`worker_concurrency` (`None` = CPU count), `worker_pool` (`prefork`), `worker_prefetch_multiplier` (4), `worker_disable_prefetch`, `worker_enable_prefetch_count_reduction`, `worker_eta_task_limit`, `worker_max_tasks_per_child`, `worker_max_memory_per_child`, `worker_send_task_events`, `worker_enable_remote_control` (True), `worker_state_db`, `worker_lost_wait` (10s), `worker_proc_alive_timeout` (4s), `worker_cancel_long_running_tasks_on_connection_loss`, `worker_soft_shutdown_timeout` (0 = disabled) with `worker_enable_soft_shutdown_on_idle`, `worker_deduplicate_successful_tasks`, `worker_detect_quorum_queues` (True), `worker_hijack_root_logger`, `worker_redirect_stdouts`, `worker_log_format` / `worker_task_log_format`, `worker_consumer` / `worker_autoscaler` / `worker_timer` (class overrides), `worker_direct`. See [Worker Architecture](../worker/worker-architecture.md).

### Events, control, and beat

- `event_*` (queue TTL and expiry, exchange, serializer); see [Events](../operations/events-monitoring.md).
- `control_*` (queue TTL 300s, expires 10s, exchange `celery`); see [Remote Control](../worker/remote-control.md).
- `beat_*`; see [Beat](../operations/beat-scheduler.md).

### General

`timezone`, `enable_utc` (True), `imports` / `include` (modules imported by the worker at start), `task_annotations`.

## Upgrading old names

`celery upgrade settings path/to/celeryconfig.py [--django]` rewrites old uppercase names to the new names using `_TO_NEW_KEY`, after backing up the file.

## Tests

`t/unit/app/test_defaults.py` (option tables, `find`) and `t/unit/app/test_app.py` (detection and mixing errors, environment overrides, censoring).
