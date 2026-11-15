---
title: "Configuration and Loaders"
---
## Overview

Every behaviour Celery lets you tune is a setting in one table, `NAMESPACES` in `celery/app/defaults.py`. An app's `conf` is a layered view over that table: values you set in code, values read from a configuration module, and the defaults. A loader decides where the configuration module comes from and which modules the worker imports to find tasks. This page follows a setting from its definition to the value a worker reads, and leaves Django's `settings.py` integration to [[Django Integration]].

Sources: [celery/app/defaults.py:66-72](repo://celery/app/defaults.py#L66-L72), [celery/app/utils.py:70-84](repo://celery/app/utils.py#L70-L84)

The configuration is read lazily, on the first access to any key, as described on [[The Celery Application]]. Until then every `config_from_*` call only records where to read from.

Sources: [celery/app/base.py:703-725](repo://celery/app/base.py#L703-L725), [celery/app/base.py:1247-1280](repo://celery/app/base.py#L1247-L1280)

## The defaults table

`NAMESPACES` nests `Option` objects under namespaces (`broker`, `result`, `task`, `worker`, `beat`, `event`, `redis`, `database`, `security` and one per result backend). `flatten` joins a namespace and a key with an underscore, so `broker=Namespace(url=Option(...))` becomes the setting `broker_url`, and builds `DEFAULTS`, the flat dict of default values.

Sources: [celery/app/defaults.py:30-36](repo://celery/app/defaults.py#L30-L36), [celery/app/defaults.py:376-394](repo://celery/app/defaults.py#L376-L394)

An `Option` holds the default, a `type` used to convert strings from the command line (`string`, `int`, `float`, `bool`, `dict`, `tuple`, `any`), the old names it replaces, and optional `deprecate_by`, `remove_by` and `alt` fields that `find_deprecated_settings` turns into warnings.

Sources: [celery/app/defaults.py:41-63](repo://celery/app/defaults.py#L41-L63), [celery/app/defaults.py:404-413](repo://celery/app/defaults.py#L404-L413)

| Example setting | Default | Meaning |
| --- | --- | --- |
| `accept_content` | `('json',)` | Content types a worker deserializes |
| `broker_pool_limit` | `10` | Connections in the app's broker pool |
| `broker_connection_max_retries` | `100` | Reconnect attempts before giving up |
| `beat_scheduler` | `celery.beat:PersistentScheduler` | Scheduler class beat uses |
| `worker_prefetch_multiplier` | `4` | Messages reserved per pool slot |
| `worker_pool` | `prefork` | Default execution pool |
| `worker_state_db` | none | File for persisting revoked task ids |

Sources: [celery/app/defaults.py:66-108](repo://celery/app/defaults.py#L66-L108), [celery/app/defaults.py:325-374](repo://celery/app/defaults.py#L325-L374)

`find(name, namespace)` looks a name up in the given namespace first, then in every other namespace, then as a flat key. `app.conf.find_option('disable_rate_limits')` uses it to tell you which namespace a setting lives in.

Sources: [celery/app/defaults.py:416-436](repo://celery/app/defaults.py#L416-L436), [celery/app/utils.py:141-160](repo://celery/app/utils.py#L141-L160)

## Old and new setting names

Celery 4 renamed settings from uppercase prefixed names (`CELERY_RESULT_BACKEND`, `CELERYD_CONCURRENCY`, `CELERYBEAT_SCHEDULE`) to lowercase namespaced ones (`result_backend`, `worker_concurrency`, `beat_schedule`). The old prefix of each namespace is given to `Namespace(__old__=...)`, and `flatten` with `_to_compat` produces `_TO_NEW_KEY` and `_TO_OLD_KEY`, the maps between the two spellings.

Sources: [celery/app/defaults.py:23-36](repo://celery/app/defaults.py#L23-L36), [celery/app/defaults.py:367-402](repo://celery/app/defaults.py#L367-L402)

`detect_settings` decides which spelling a configuration uses. It counts how many of the given keys are new and how many old; the majority wins, and a prefix (the `namespace` argument) always selects the new format. Keys left in the minority raise `ImproperlyConfigured` with a rename list, unless the same setting was given in both spellings. The resulting `Settings` has three layers: the pre-configuration converted to the chosen spelling, the loader's configuration, and the defaults.

Sources: [celery/app/utils.py:232-286](repo://celery/app/utils.py#L232-L286)

```text
Cannot mix new and old setting keys, please rename the
following settings to the new format:
CELERY_TASK_SERIALIZER               -> task_serializer
```

Sources: [celery/app/utils.py:48-62](repo://celery/app/utils.py#L48-L62), [celery/app/utils.py:271-278](repo://celery/app/utils.py#L271-L278)

## The Settings object

`Settings` extends `ConfigurationView`, a `ChainMap` that also allows attribute access. Lookups try each layer in order, and when a prefix is set (for example `CELERY_` in Django), a key is looked up as `CELERY_<key>` first and then as itself; the key-conversion functions let `conf.result_backend` find a value stored as `CELERY_RESULT_BACKEND`. Writes go to the first layer, the changes.

Sources: [celery/utils/collections.py:353-416](repo://celery/utils/collections.py#L353-L416)

Some settings are properties that combine sources, so that environment variables override files.

Sources: [celery/app/utils.py:84-112](repo://celery/app/utils.py#L84-L112)

| Property | Resolution order |
| --- | --- |
| `broker_url` | `CELERY_BROKER_URL` env, `broker_url`, `broker_host` |
| `broker_read_url` | `CELERY_BROKER_READ_URL` env, `broker_read_url`, `broker_url` |
| `broker_write_url` | `CELERY_BROKER_WRITE_URL` env, `broker_write_url`, `broker_url` |
| `result_backend` | `CELERY_RESULT_BACKEND` env, `result_backend` |
| `task_default_exchange`, `task_default_routing_key` | the setting, then `task_default_queue` |
| `timezone` | `timezone`, then Django's `TIME_ZONE` |

Sources: [celery/app/utils.py:84-131](repo://celery/app/utils.py#L84-L131)

`without_defaults()` drops the last layer and `value_set_for(key)` tells whether a user set a key. `table()` and `humanize()` produce the settings shown by `celery report` and the worker banner, passing them through `filter_hidden_settings`: keys matching `API|TOKEN|KEY|SECRET|PASS|SIGNATURE|DATABASE|BEAT_DBURI` are masked, and passwords inside broker and backend URLs are replaced by `********`.

Sources: [celery/app/utils.py:133-195](repo://celery/app/utils.py#L133-L195), [celery/app/utils.py:37-40](repo://celery/app/utils.py#L37-L40), [celery/app/utils.py:327-343](repo://celery/app/utils.py#L327-L343)

## Ways to configure an app

### In code

Keyword arguments to `Celery()` and assignments to `app.conf` before configuration is loaded go into the pre-configuration layer. `app.add_defaults(d)` adds a mapping, or a callable that returns one, as an extra defaults layer; a callable is only called when configuration is loaded, and the mapping is not pickled to child processes, so the call must also happen at import time.

Sources: [celery/app/base.py:679-701](repo://celery/app/base.py#L679-L701)

### From an object or module

`config_from_object(obj, namespace=None)` records the object (a module, a class, or a dotted name such as `'proj.celeryconfig'`) and an optional namespace. Unless `force=True` or the app is already configured, it reads nothing until a key is accessed. The loader then imports the name, trying it as a module first and as `module.attribute` second, and wraps the object with `force_mapping` so a class's attributes work as keys.

Sources: [celery/app/base.py:703-725](repo://celery/app/base.py#L703-L725), [celery/loaders/base.py:119-145](repo://celery/loaders/base.py#L119-L145)

```python
app.config_from_object('proj.celeryconfig')
app.config_from_object('django.conf:settings', namespace='CELERY')
```

Sources: [celery/app/base.py:703-716](repo://celery/app/base.py#L703-L716)

### From an environment variable

`config_from_envvar('CELERY_CONFIG_MODULE')` reads a module name from the variable and calls `config_from_object` with it. An unset variable raises `ImproperlyConfigured` unless `silent=True`.

Sources: [celery/app/base.py:727-743](repo://celery/app/base.py#L727-L743)

### From the command line

Extra `key=value` arguments after `celery worker --` or `celery beat --` go to `config_from_cmdline`, which parses them with the loader's `cmdline_config_parser`. A key may be written `ns.key` or `ns_key`; a leading dot or underscore uses the command's namespace (`worker` for the worker). The value is converted with the option's type, or with an explicit cast such as `(json)[1,2]`.

Sources: [celery/app/base.py:745-748](repo://celery/app/base.py#L745-L748), [celery/loaders/base.py:161-206](repo://celery/loaders/base.py#L161-L206), [celery/bin/worker.py:326-332](repo://celery/bin/worker.py#L326-L332)

```bash
celery -A proj worker -l INFO -- worker.prefetch_multiplier=1 broker.pool_limit=20
```

Sources: [celery/loaders/base.py:173-205](repo://celery/loaders/base.py#L173-L205)

## Loaders

A loader reads configuration, imports task modules, and receives worker life-cycle callbacks. `get_loader_cls` resolves the aliases `app` (`AppLoader`, used by every app you create) and `default` (`Loader`, used by the fallback app), or any dotted class name; `CELERY_LOADER` or the `--loader` option picks it.

Sources: [celery/loaders/__init__.py:1-18](repo://celery/loaders/__init__.py#L1-L18), [celery/app/base.py:436-442](repo://celery/app/base.py#L436-L442)

`BaseLoader.conf` reads configuration once, through `read_configuration`, which imports the module named by `CELERY_CONFIG_MODULE` when set. The default `Loader` goes further and imports `celeryconfig` from the current directory when no app was given, returning empty settings when it is missing and warning only if `C_WNOCONF` is set.

Sources: [celery/loaders/base.py:208-237](repo://celery/loaders/base.py#L208-L237), [celery/loaders/default.py:1-44](repo://celery/loaders/default.py#L1-L44)

The worker calls `init_worker` once at start-up, which runs `import_default_modules` and then the `on_worker_init` hook. `default_modules` is the loader's built-in modules plus the `imports` and `include` settings; before importing them it sends the `import_modules` signal and re-raises any exception a receiver returned, because logging is not set up yet and errors would otherwise vanish. `on_task_init`, `on_process_cleanup`, `on_worker_shutdown` and `on_worker_process_init` are hooks for subclasses; the Django fix-up uses the same points.

Sources: [celery/loaders/base.py:68-117](repo://celery/loaders/base.py#L68-L117), [celery/loaders/base.py:224-230](repo://celery/loaders/base.py#L224-L230)

## Task autodiscovery

`app.autodiscover_tasks(packages, related_name='tasks')` finds a `tasks` module inside each package. By default it is lazy: it connects a promise to the `import_modules` signal, so discovery runs when the worker imports its default modules. `force=True` runs it at once. `packages` may be a callable, evaluated at discovery time; when it is empty, the packages come from fix-ups such as Django's installed apps.

Sources: [celery/app/base.py:782-843](repo://celery/app/base.py#L782-L843)

`find_related_module` imports the package, then `package.tasks`. A `ModuleNotFoundError` for exactly that module name means the package has no tasks and is skipped, but an import error raised from inside the module propagates, so a broken import in `tasks.py` is not silently ignored. A module-level guard stops discovery re-entering itself when a discovered module triggers discovery again.

Sources: [celery/loaders/base.py:239-278](repo://celery/loaders/base.py#L239-L278)
