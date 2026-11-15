---
title: "Configuration"
---
## Overview

Every Celery setting is declared once, with its type and default, in `celery/app/defaults.py`. At run time `app.conf` is a `Settings` object that layers what the user set over those defaults, translates old uppercase names to the current lowercase ones, and lets a few environment variables override the broker and backend URLs. This page explains how settings are declared, where an app reads them from, and how a key is looked up. When configuration is loaded is covered on [[The Celery Application]]; what each setting does is explained on the page of the system that reads it.

Sources: [celery/app/defaults.py:41-66](repo://celery/app/defaults.py#L41-L66), [celery/app/utils.py:70-131](repo://celery/app/utils.py#L70-L131)

## How settings are declared

`NAMESPACES` is a nested dictionary of `Option` objects. Each `Option` holds a `default`, a `type` (`string`, `int`, `float`, `bool`, `dict`, `tuple`, `list` or `any`) and, for settings being retired, `deprecate_by`, `remove_by` and `alt`. A `Namespace(__old__=...)` call fills each option's `old` set with the names the setting had before Celery 4, such as `celeryd_{0}` for worker settings.

Sources: [celery/app/defaults.py:23-63](repo://celery/app/defaults.py#L23-L63)

`flatten` walks the tree and joins each namespace and key with `_`, so `worker.prefetch_multiplier` becomes the setting `worker_prefetch_multiplier`. From the flattened list the module builds `DEFAULTS` (new name to default), `_OLD_DEFAULTS`, the two rename maps `_TO_OLD_KEY` and `_TO_NEW_KEY`, and the key sets `SETTING_KEYS` and `_OLD_SETTING_KEYS`.

Sources: [celery/app/defaults.py:378-413](repo://celery/app/defaults.py#L378-L413)

`find(name, namespace)` searches the tree by name: first in the given namespace, then in every namespace, and finally as a full flattened name. `app.conf.find_option` and `find_value_for_key` use it.

Sources: [celery/app/defaults.py:427-447](repo://celery/app/defaults.py#L427-L447), [celery/app/utils.py:141-169](repo://celery/app/utils.py#L141-L169)

## Setting groups

The top-level settings and namespaces map onto the parts of Celery:

Sources: [celery/app/defaults.py:66-72](repo://celery/app/defaults.py#L66-L72)

| Group | Examples (default) | Read by |
| --- | --- | --- |
| top level | `accept_content` (`('json',)`), `enable_utc` (`True`), `timezone`, `imports`, `include` | serializers, clocks, the loader |
| `broker_*` | `broker_url`, `broker_pool_limit` (10), `broker_connection_retry_on_startup`, `broker_heartbeat` (120) | [[The Celery Application]], [[The Consumer and Message Handling]] |
| `task_*` | `task_serializer` (`json`), `task_acks_late` (`False`), `task_always_eager`, `task_routes`, `task_default_queue` (`celery`) | [[Defining Tasks]], [[Sending Tasks and Routing]] |
| `result_*` | `result_backend`, `result_expires` (1 day), `result_extended`, `result_serializer` | [[Task Results and States]] |
| `worker_*` | `worker_concurrency`, `worker_prefetch_multiplier` (4), `worker_pool` (`prefork`), `worker_hijack_root_logger` | [[Worker Startup and Bootsteps]], [[Execution Pools]] |
| `beat_*` | `beat_scheduler` (`celery.beat:PersistentScheduler`), `beat_schedule`, `beat_max_loop_interval` | [[Periodic Tasks with Beat]] |
| `event_*`, `control_*` | `event_queue_ttl`, `control_exchange` (`celery`) | [[Events and Monitoring]], [[Remote Control and Inspection]] |
| `security_*` | key, certificate and digest for signed messages | [[Message Signing and Security]] |
| backend namespaces | `redis_*`, `mongodb_*`, `database_*`, `s3_*`, `cassandra_*`, … | [[Result Backends]] |

Sources: [celery/app/defaults.py:66-108](repo://celery/app/defaults.py#L66-L108), [celery/app/defaults.py:151-157](repo://celery/app/defaults.py#L151-L157), [celery/app/defaults.py:179-230](repo://celery/app/defaults.py#L179-L230), [celery/app/defaults.py:265-375](repo://celery/app/defaults.py#L265-L375)

## Where settings come from

An app collects settings from four places, read lazily the first time a key is accessed:

Sources: [celery/app/base.py:1230-1245](repo://celery/app/base.py#L1230-L1245)

1. Keyword arguments to `Celery(...)` (`broker=`, `backend=`, `include=` and any setting name), stored in `_preconf`.
2. `app.conf.update(...)` or item assignment before configuration is loaded, which also lands in `_preconf`.
3. A configuration object or module given to `app.config_from_object` or `app.config_from_envvar`.
4. The loader's own configuration: the default loader of the fallback app imports `celeryconfig` (or the module named by `CELERY_CONFIG_MODULE`).

Sources: [celery/app/base.py:387-405](repo://celery/app/base.py#L387-L405), [celery/app/base.py:1247-1260](repo://celery/app/base.py#L1247-L1260), [celery/loaders/default.py:25-44](repo://celery/loaders/default.py#L25-L44)

`config_from_object(obj, silent=False, force=False, namespace=None)` records `obj` as the config source and, when given, the namespace. Unless `force=True` or the app is already configured, nothing is imported yet. A string is imported with `_smart_import`, which accepts `module:attr`, a module name, or `module.attr`; `force_mapping` then wraps a module or class so its attributes read as keys. A config object may also hold `override_backends`, a mapping that replaces backend aliases.

Sources: [celery/app/base.py:703-725](repo://celery/app/base.py#L703-L725), [celery/loaders/base.py:119-145](repo://celery/loaders/base.py#L119-L145)

`config_from_envvar(name)` reads a module name from the environment variable and calls `config_from_object` with it, raising `ImproperlyConfigured` when the variable is unset unless `silent=True`.

Sources: [celery/app/base.py:727-743](repo://celery/app/base.py#L727-L743)

```python
app = Celery('proj')
app.config_from_object('proj.celeryconfig')
app.config_from_envvar('CELERY_CONFIG_MODULE', silent=True)
```

Sources: [celery/app/base.py:703-743](repo://celery/app/base.py#L703-L743)

`config_from_cmdline(argv)` parses `key=value` pairs from command-line arguments. A key may be written `ns.key` or `ns_key`; a leading `.` or `_` means the default namespace. The value is converted with the declared option's type, or with an explicit cast prefix such as `(json)` or `(int)`.

Sources: [celery/app/base.py:745-748](repo://celery/app/base.py#L745-L748), [celery/loaders/base.py:161-206](repo://celery/loaders/base.py#L161-L206)

## Environment variables

`Settings` overrides a few keys from the environment before looking at configuration: `CELERY_BROKER_URL`, `CELERY_BROKER_READ_URL`, `CELERY_BROKER_WRITE_URL` and `CELERY_RESULT_BACKEND`. The read and write URLs fall back to `broker_url`. The global `-b/--broker` and `--result-backend` options of the `celery` command work by setting these variables, and `--config` sets `CELERY_CONFIG_MODULE`.

Sources: [celery/app/utils.py:84-112](repo://celery/app/utils.py#L84-L112), [celery/bin/celery.py:122-131](repo://celery/bin/celery.py#L122-L131)

Some properties fall back across keys: `task_default_exchange` and `task_default_routing_key` default to `task_default_queue`, and `timezone` also reads Django's `TIME_ZONE`.

Sources: [celery/app/utils.py:114-131](repo://celery/app/utils.py#L114-L131)

## Old and new setting names

Celery 4 renamed settings from uppercase (`CELERY_TASK_SERIALIZER`, `CELERYD_CONCURRENCY`) to lowercase (`task_serializer`, `worker_concurrency`). `detect_settings` decides which style a configuration uses by counting the keys that match each style, skipping keys set automatically from constructor arguments. The majority wins. A key from the losing style raises `ImproperlyConfigured` listing the renames, unless the user also gave the same setting in the winning style. A namespace prefix always selects the new style.

Sources: [celery/app/utils.py:232-275](repo://celery/app/utils.py#L232-L275)

The resulting `Settings` keeps three layers: user changes, the configuration source, and the defaults for the chosen style. Lookups try the key, then the key converted by `_old_key_to_new` and `_new_key_to_old`, so both spellings resolve once loaded. Old-style keys are recorded as `deprecated_settings`, and `maybe_warn_deprecated_settings` warns that they go away in 6.0. Separately, `prepare_config` runs `find_deprecated_settings`, which warns about any option marked with `deprecate_by`, such as `task_acks_on_failure_or_timeout`.

Sources: [celery/app/utils.py:197-209](repo://celery/app/utils.py#L197-L209), [celery/app/utils.py:276-286](repo://celery/app/utils.py#L276-L286), [celery/utils/collections.py:384-399](repo://celery/utils/collections.py#L384-L399), [celery/app/defaults.py:416-424](repo://celery/app/defaults.py#L416-L424)

## Namespaces

`Celery('proj', namespace='CELERY')` makes every setting carry a prefix. `ConfigurationView._to_keys` turns `task_serializer` into `CELERY_TASK_SERIALIZER`, matching the case of the prefix, and tries it before the plain key. This is how a Django project keeps Celery settings in `settings.py` beside Django's own ([[Django Integration]]).

Sources: [celery/utils/collections.py:353-382](repo://celery/utils/collections.py#L353-L382), [celery/app/base.py:397-401](repo://celery/app/base.py#L397-L401)

## Inspecting configuration

`app.conf.table(with_defaults=False, censored=True)` returns the settings that differ from the defaults, and `humanize()` formats them as text. Censoring masks the value of any key matching `HIDDEN_SETTINGS` (`API`, `TOKEN`, `KEY`, `SECRET`, `PASS`, `SIGNATURE`, `DATABASE` and others), and `celery report` prints this table through `app.bugreport()`.

Sources: [celery/app/utils.py:36-39](repo://celery/app/utils.py#L36-L39), [celery/app/utils.py:181-195](repo://celery/app/utils.py#L181-L195), [celery/bin/celery.py:164-170](repo://celery/bin/celery.py#L164-L170)
