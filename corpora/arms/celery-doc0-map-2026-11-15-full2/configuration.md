---
title: "Configuration"
---
## Overview

Celery's settings are declared in one place, `celery/app/defaults.py`. That module describes every option once, with its default and type, grouped in namespaces such as `broker`, `task`, `worker` and `result`. Flattening the namespaces produces the lowercase setting names used today (`task_serializer`, `worker_concurrency`). A compatibility table maps each name to its uppercase Celery 3.x form (`CELERY_TASK_SERIALIZER`, `CELERYD_CONCURRENCY`).

Sources: [celery/app/defaults.py:1-8](repo://celery/app/defaults.py#L1-L8), [celery/app/defaults.py:378-413](repo://celery/app/defaults.py#L378-L413)

At runtime `app.conf` is a `Settings` object, a layered view that combines your values with those defaults. This page covers how options are declared, how old and new names are detected and converted, how a namespace prefix such as `CELERY_` works, and the order in which a setting is resolved. How the app loads configuration (`config_from_object`, `PendingConfiguration`) is covered in [[The Celery Application]].

Sources: [celery/app/utils.py:70-77](repo://celery/app/utils.py#L70-L77), [celery/app/base.py:1247-1280](repo://celery/app/base.py#L1247-L1280)

## Declaring Options

### The Option class

Each setting is an `Option`, which holds a `default`, a `type` (default `'string'`) and optional deprecation metadata (`deprecate_by`, `remove_by`, `alt`) or explicit old names (`old`). `to_python` converts a string with `typemap`, which maps `string`, `int`, `float`, `any`, `bool` (through `strtobool`), `dict` and `tuple`. `to_python` is what the command-line parser uses.

Sources: [celery/app/defaults.py:42-63](repo://celery/app/defaults.py#L42-L63)

```python
class Option:
    """Describes a Celery configuration option."""

    alt = None
    deprecate_by = None
    remove_by = None
    old = set()
    typemap = {'string': str, 'int': int, 'float': float, 'any': lambda v: v,
               'bool': strtobool, 'dict': dict, 'tuple': tuple}
```

Sources: [celery/app/defaults.py:42-50](repo://celery/app/defaults.py#L42-L50)

### Namespaces

`NAMESPACES` is a nested dict built with the helper `Namespace(__old__=None, **options)`. When `__old__` is given, every option in that namespace that has no explicit `old` gets old-name templates. Namespaces that use templates include `beat` (`celerybeat_{0}`), `task` (`celery_{0}`), `worker` (`celeryd_{0}`), and `result`, `event`, `cache`, `redis`, `security` (each `celery_<ns>_{0}`).

Sources: [celery/app/defaults.py:23-39](repo://celery/app/defaults.py#L23-L39), [celery/app/defaults.py:66-185](repo://celery/app/defaults.py#L66-L185), [celery/app/defaults.py:186-300](repo://celery/app/defaults.py#L186-L300), [celery/app/defaults.py:301-375](repo://celery/app/defaults.py#L301-L375)

| Namespace | Example options |
|---|---|
| top level | `accept_content`, `result_accept_content`, `enable_utc`, `imports`, `include`, `timezone` |
| `beat` | `scheduler`, `schedule`, `schedule_filename`, `max_loop_interval`, `sync_every` |
| `broker` | `url`, `read_url`, `write_url`, `transport_options`, `connection_retry`, `heartbeat`, `pool_limit` |
| `task` | `serializer`, `acks_late`, `always_eager`, `default_queue`, `routes`, `time_limit`, `protocol` |
| `worker` | `concurrency`, `pool`, `prefetch_multiplier`, `max_tasks_per_child`, `send_task_events` |
| `result` | `backend`, `expires`, `serializer`, `extended`, `backend_always_retry` |
| `event` | `queue_ttl`, `queue_expires`, `serializer`, `exchange` |
| `control` | `queue_ttl`, `queue_expires`, `exchange` |
| backend-specific | `cache`, `cassandra`, `s3`, `azureblockblob`, `gcs`, `couchbase`, `arangodb`, `mongodb`, `cosmosdbsql`, `redis`, `elasticsearch`, `database` |
| `security` | `certificate`, `cert_store`, `key`, `key_password`, `digest` |

Sources: [celery/app/defaults.py:66-185](repo://celery/app/defaults.py#L66-L185), [celery/app/defaults.py:186-300](repo://celery/app/defaults.py#L186-L300), [celery/app/defaults.py:301-375](repo://celery/app/defaults.py#L301-L375)

### Flattening into setting names

`flatten()` walks `NAMESPACES` breadth-first and joins each namespace path and key with `_`, so `task` and `serializer` become `task_serializer`. The module builds its lookup tables from that walk:

Sources: [celery/app/defaults.py:391-400](repo://celery/app/defaults.py#L391-L400)

- `DEFAULTS`: new name to default value. `SETTING_KEYS` is the set of new names.
- `_to_compat` produces one `(OLD_NAME, new_name, option)` triple per old template, uppercasing the formatted template. An option with no old template gets its new name uppercased.
- `_OLD_DEFAULTS`, `_TO_OLD_KEY` and `_TO_NEW_KEY` are built from those triples. `_OLD_SETTING_KEYS` is the set of old names.

Sources: [celery/app/defaults.py:378-413](repo://celery/app/defaults.py#L378-L413)

```mermaid
flowchart TD
  ns["NAMESPACES<br>(nested Option dicts)"] --> flat["flatten(keyfilter=_flatten_keys)"]
  ns --> compat["flatten(keyfilter=_to_compat)"]
  flat --> defaults["DEFAULTS / SETTING_KEYS"]
  compat --> oldDefaults["_OLD_DEFAULTS"]
  compat --> toOld["_TO_OLD_KEY"]
  compat --> toNew["_TO_NEW_KEY / _OLD_SETTING_KEYS"]
  defaults --> detect["detect_settings()"]
  oldDefaults --> detect
  toNew --> detect
  toOld --> detect
```

Sources: [celery/app/defaults.py:378-413](repo://celery/app/defaults.py#L378-L413), [celery/app/utils.py:220-286](repo://celery/app/utils.py#L220-L286)

## Old and New Setting Names

### How old names are derived

Because the template is formatted with the key inside its namespace, an old name does not always contain the namespace. The explicit `old=` sets cover names that broke the pattern.

Sources: [celery/app/defaults.py:30-35](repo://celery/app/defaults.py#L30-L35), [celery/app/defaults.py:382-388](repo://celery/app/defaults.py#L382-L388)

| New name | Old name | Why |
|---|---|---|
| `task_always_eager` | `CELERY_ALWAYS_EAGER` | `task` namespace template `celery_{0}` |
| `task_default_queue` | `CELERY_DEFAULT_QUEUE` | `task` namespace template |
| `task_routes` | `CELERY_ROUTES` | `task` namespace template |
| `task_serializer` | `CELERY_TASK_SERIALIZER` | explicit `old={'celery_task_serializer'}` |
| `worker_concurrency` | `CELERYD_CONCURRENCY` | `worker` namespace template `celeryd_{0}` |
| `beat_schedule` | `CELERYBEAT_SCHEDULE` | `beat` namespace template `celerybeat_{0}` |
| `result_backend` | `CELERY_RESULT_BACKEND` | `result` namespace template `celery_result_{0}` |
| `result_expires` | `CELERY_TASK_RESULT_EXPIRES` | explicit `old={'celery_task_result_expires'}` |
| `database_url` | `CELERY_RESULT_DBURI` | explicit `old={'celery_result_dburi'}` |
| `broker_url` | `BROKER_URL` | no template: new name uppercased |
| `accept_content` | `CELERY_ACCEPT_CONTENT` | top-level `old=OLD_NS` |

Sources: [celery/app/defaults.py:66-72](repo://celery/app/defaults.py#L66-L72), [celery/app/defaults.py:73-84](repo://celery/app/defaults.py#L73-L84), [celery/app/defaults.py:205-221](repo://celery/app/defaults.py#L205-L221), [celery/app/defaults.py:248-249](repo://celery/app/defaults.py#L248-L249), [celery/app/defaults.py:265-314](repo://celery/app/defaults.py#L265-L314), [celery/app/defaults.py:325-334](repo://celery/app/defaults.py#L325-L334)

### Detecting which style is in use

`detect_settings(conf, preconf, ignore_keys, prefix)` decides whether a configuration uses new or old names. It compares the keys the user supplied (minus `ignore_keys`, which are the values auto-set from constructor arguments) with `SETTING_KEYS` and `_OLD_SETTING_KEYS`:

Sources: [celery/app/utils.py:232-245](repo://celery/app/utils.py#L232-L245)

1. If only new names, or only old names, are present, that style wins. With no recognised names at all, the new style is used.
2. If both are present, the style with more keys wins, and the keys of the other style are "left over".
3. If a `prefix` is set, the new style is always used and nothing is left over.
4. A left-over key raises `ImproperlyConfigured` with rename suggestions (`E_MIX_OLD_INTO_NEW` or `E_MIX_NEW_INTO_OLD`), unless the user also supplied its converted name.
5. The pre-configuration keys are converted into the chosen style. Defaults come from `DEFAULTS` or `_OLD_DEFAULTS` and are overlaid with the pre-configuration. The result is `Settings(preconf, [conf, defaults], ...)`, with the old keys found recorded as `deprecated_settings`.

Sources: [celery/app/utils.py:232-286](repo://celery/app/utils.py#L232-L286), [celery/app/utils.py:42-62](repo://celery/app/utils.py#L42-L62)

```python
    if prefix:
        # always use new format if prefix is used.
        info, left = _settings_info, set()

    # only raise error for keys that the user didn't provide two keys
    # for (e.g., both ``result_expires`` and ``CELERY_TASK_RESULT_EXPIRES``).
    really_left = {key for key in left if info.convert[key] not in have}
    if really_left:
        # user is mixing old/new, or new/old settings, give renaming
        # suggestions.
        raise ImproperlyConfigured(info.mix_error.format(renames='\n'.join(
            FMT_REPLACE_SETTING.format(replace=key, with_=info.convert[key])
            for key in sorted(really_left)
        )))
```

Sources: [celery/app/utils.py:264-277](repo://celery/app/utils.py#L264-L277)

### Reading either name

The style choice affects only which defaults table is used. Lookups accept both names in either style, because the app builds `Settings` with the key converters `_old_key_to_new` and `_new_key_to_old`. `app.conf.task_serializer` and `app.conf.CELERY_TASK_SERIALIZER` therefore find the same value.

Sources: [celery/app/utils.py:212-217](repo://celery/app/utils.py#L212-L217), [celery/app/base.py:403-408](repo://celery/app/base.py#L403-L408), [celery/utils/collections.py:384-401](repo://celery/utils/collections.py#L384-L401)

### Deprecation warnings and migration

When old names are detected, the worker calls `app.conf.maybe_warn_deprecated_settings()`, which warns once per old setting that it will be removed in 6.0.0. It then advises running `celery upgrade settings path/to/settings.py`. The warning is skipped when the config source is `django.conf:settings`. Separately, `prepare_config` calls `find_deprecated_settings`, which warns about options that carry `deprecate_by`/`remove_by`, such as `task_acks_on_failure_or_timeout`.

Sources: [celery/app/utils.py:197-209](repo://celery/app/utils.py#L197-L209), [celery/apps/worker.py:149-166](repo://celery/apps/worker.py#L149-L166), [celery/app/defaults.py:416-424](repo://celery/app/defaults.py#L416-L424), [celery/app/defaults.py:268-272](repo://celery/app/defaults.py#L268-L272), [celery/app/base.py:1193-1195](repo://celery/app/base.py#L1193-L1195)

`celery upgrade settings FILE` rewrites a settings file in place, using `_TO_NEW_KEY`. It replaces the longest old names first, and saves a `.orig` backup unless `--no-backup` is given. With `--django` or `--compat`, the new names are uppercased and prefixed with `CELERY_`.

Sources: [celery/bin/upgrade.py:25-91](repo://celery/bin/upgrade.py#L25-L91)

## Namespace Prefix

### Setting a prefix

A namespace makes Celery read its settings from keys with a common prefix. This lets Celery share a settings module with another framework. Pass it to the constructor (`Celery(namespace='CELERY')`) or to `config_from_object(..., namespace='CELERY')`. The Django example uses the second form so that every Celery key in `settings.py` starts with `CELERY_`:

Sources: [celery/app/base.py:343-348](repo://celery/app/base.py#L343-L348), [celery/app/base.py:703-721](repo://celery/app/base.py#L703-L721), [examples/django/proj/celery.py:10-14](repo://examples/django/proj/celery.py#L10-L14)

```python
CELERY_BROKER_URL = 'amqp://guest:guest@localhost'

#: Only add pickle to this list if your broker is secured
#: from unwanted access (see userguide/security.html)
CELERY_ACCEPT_CONTENT = ['json']
CELERY_RESULT_BACKEND = 'db+sqlite:///results.sqlite'
CELERY_TASK_SERIALIZER = 'json'
```

Sources: [examples/django/proj/settings.py:10-16](repo://examples/django/proj/settings.py#L10-L16)

### How prefixed keys are looked up

`ConfigurationView` normalises the prefix to end in exactly one `_`. For each lookup, `_to_keys` builds the prefixed key, unless the key already starts with the prefix, and `match_case` makes its case match the prefix's. With prefix `CELERY_`, a lookup for `broker_url` therefore tries `CELERY_BROKER_URL` first, then `broker_url`, then the converted old and new names. Containment checks (`in`) try only the prefixed and plain keys.

Sources: [celery/utils/collections.py:367-401](repo://celery/utils/collections.py#L367-L401), [celery/utils/collections.py:423-426](repo://celery/utils/collections.py#L423-L426), [celery/utils/text.py:116-117](repo://celery/utils/text.py#L116-L117)

> [!NOTE]
> With a prefix, `detect_settings` always uses new-style names, so prefixed keys must be the uppercased *new* names: `CELERY_TASK_ALWAYS_EAGER`, not `CELERY_ALWAYS_EAGER`.

Sources: [celery/app/utils.py:264-266](repo://celery/app/utils.py#L264-L266)

## Resolution Order

### Layers of the settings view

`Settings` is a `ConfigurationView`, which is a `ChainMap`. Its first map, `changes`, holds the pre-configuration (constructor keywords and anything written to `app.conf`). The remaining maps are the defaults. `detect_settings` builds the view as `[preconf, conf, defaults]`, where `conf` is the loader's configuration (your config module or object). `add_defaults()` inserts a new map at position 1, directly after `changes`.

Sources: [celery/utils/collections.py:202-226](repo://celery/utils/collections.py#L202-L226), [celery/app/utils.py:279-286](repo://celery/app/utils.py#L279-L286), [celery/app/base.py:679-701](repo://celery/app/base.py#L679-L701)

```mermaid
flowchart TD
  lookup["app.conf.KEY"] --> keys["candidate keys:<br>prefixed, plain, old/new converted"]
  keys --> changes["(1) changes<br>(constructor kwargs, app.conf writes)"]
  changes -->|miss| added["(2) add_defaults() layers"]
  added -->|miss| source["(3) config source<br>(config_from_object / CELERY_CONFIG_MODULE)"]
  source -->|miss| builtin["(4) DEFAULTS or _OLD_DEFAULTS"]
  builtin -->|miss| missing["KeyError / AttributeError"]
```

Sources: [celery/utils/collections.py:384-401](repo://celery/utils/collections.py#L384-L401), [celery/utils/collections.py:222-226](repo://celery/utils/collections.py#L222-L226), [celery/app/utils.py:279-286](repo://celery/app/utils.py#L279-L286)

### Environment overrides and computed settings

A few `Settings` properties look past the layers:

Sources: [celery/app/utils.py:84-131](repo://celery/app/utils.py#L84-L131)

| Property | Resolution |
|---|---|
| `broker_url` | `$CELERY_BROKER_URL`, then `broker_url`, then `broker_host` |
| `broker_read_url` / `broker_write_url` | `$CELERY_BROKER_READ_URL` / `$CELERY_BROKER_WRITE_URL`, then the setting, then `broker_url` |
| `result_backend` | `$CELERY_RESULT_BACKEND`, then `result_backend`, then `CELERY_RESULT_BACKEND` |
| `task_default_exchange` | `task_default_exchange`, else `task_default_queue` |
| `task_default_routing_key` | `task_default_routing_key`, else `task_default_queue` |
| `timezone` | `timezone`, else Django's `TIME_ZONE` |

Sources: [celery/app/utils.py:84-131](repo://celery/app/utils.py#L84-L131)

The `celery` command's `-b/--broker`, `--result-backend` and `--config` options set `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND` and `CELERY_CONFIG_MODULE` in the environment. Because of the properties above, the first two override the configured values.

Sources: [celery/bin/celery.py:123-133](repo://celery/bin/celery.py#L123-L133)

### Command-line settings

Extra `key=value` arguments to `celery worker` go through `config_from_cmdline(argv, namespace='worker')` and `BaseLoader.cmdline_config_parser`. Keys are lowercased, and dots become underscores. A leading `.` or `_` means "in the default namespace", so `.concurrency=4` becomes `worker_concurrency`. Values are cast with the option's `to_python`. A `(type)value` prefix forces a cast, and `(json)`, `(list)`, `(tuple)` and `(dict)` parse the value as JSON.

Sources: [celery/bin/worker.py:328-335](repo://celery/bin/worker.py#L328-L335), [celery/app/base.py:745-748](repo://celery/app/base.py#L745-L748), [celery/loaders/base.py:161-206](repo://celery/loaders/base.py#L161-L206)

## Inspecting Configuration

### Settings helpers

| Method | Purpose |
|---|---|
| `find_option(name, namespace='')` | Locate an option. Tries the given namespace, then a namespace with that name, then every namespace, and finally a full setting name. Returns `(namespace, key, Option)`. |
| `get_by_parts(*parts)` | Read a setting from its parts, for example `get_by_parts('worker', 'disable_rate_limits')`. |
| `find_value_for_key(name, namespace='celery')` | `find_option` followed by `get_by_parts`. Backends use it for `result_extended`. |
| `without_defaults()` / `value_set_for(key)` | View without the built-in defaults layer, and whether a key was set explicitly. |
| `table()` / `humanize()` | Dict or text of the changed settings, with secrets masked. |

Sources: [celery/app/utils.py:133-195](repo://celery/app/utils.py#L133-L195), [celery/app/defaults.py:427-447](repo://celery/app/defaults.py#L427-L447), [celery/backends/base.py:604-604](repo://celery/backends/base.py#L604-L604)

`filter_hidden_settings` masks any key that matches `API|TOKEN|KEY|SECRET|PASS|PROFANITIES_LIST|SIGNATURE|DATABASE|BEAT_DBURI`. It also masks the password inside `broker_url` and inside backend URLs. This masked view is what `celery report` prints through `bugreport()`.

Sources: [celery/app/utils.py:37-40](repo://celery/app/utils.py#L37-L40), [celery/app/utils.py:327-375](repo://celery/app/utils.py#L327-L375), [celery/bin/celery.py:166-172](repo://celery/bin/celery.py#L166-L172)

## Important Settings and Defaults

### Core settings

| Setting | Default | Notes |
|---|---|---|
| `broker_url` | `None` | Overridable by `$CELERY_BROKER_URL`. |
| `broker_connection_timeout` | `4` | Seconds. |
| `broker_connection_retry` / `broker_connection_max_retries` | `True` / `100` | |
| `broker_heartbeat` | `120` | |
| `broker_pool_limit` | `10` | Max pooled connections and producers. |
| `broker_transport_options` | `{}` | Passed to the kombu transport. |
| `result_backend` | `None` | `by_name` falls back to the `disabled` backend when unset. |
| `result_expires` | `timedelta(days=1)` | |
| `result_serializer` | `'json'` | |
| `result_extended` | `False` | Store extra task metadata. |
| `accept_content` | `('json',)` | Allowed content types. |
| `enable_utc` / `timezone` | `True` / `None` | |
| `imports` / `include` | `()` / `()` | Modules imported by the worker. |
| `task_serializer` | `'json'` | |
| `task_protocol` | `2` | Message protocol version. |
| `task_default_queue` | `'celery'` | Also the default exchange and routing key. |
| `task_default_exchange_type` | `'direct'` | |
| `task_acks_late` | `False` | Acknowledge after execution instead of before. |
| `task_always_eager` | `False` | Run tasks locally in `apply_async`. |
| `task_ignore_result` | `False` | |
| `task_time_limit` / `task_soft_time_limit` | `None` | Seconds. |
| `task_publish_retry_policy` | `max_retries=3`, `interval_start=0`, `interval_max=1`, `interval_step=0.2` | |
| `task_create_missing_queues` | `True` | |
| `worker_pool` | `'prefork'` | |
| `worker_concurrency` | `None` | CPU count when unset. |
| `worker_prefetch_multiplier` | `4` | |
| `worker_max_tasks_per_child` / `worker_max_memory_per_child` | `None` | |
| `worker_send_task_events` | `False` | |
| `worker_enable_remote_control` | `True` | |
| `worker_hijack_root_logger` | `True` | |
| `beat_scheduler` | `'celery.beat:PersistentScheduler'` | |
| `beat_schedule` / `beat_schedule_filename` | `{}` / `'celerybeat-schedule'` | |
| `event_serializer` / `event_queue_ttl` | `'json'` / `5.0` | |
| `security_digest` | `'sha256'` | |

Sources: [celery/app/defaults.py:11-20](repo://celery/app/defaults.py#L11-L20), [celery/app/backends.py:41-46](repo://celery/app/backends.py#L41-L46), [celery/app/defaults.py:66-108](repo://celery/app/defaults.py#L66-L108), [celery/app/defaults.py:179-247](repo://celery/app/defaults.py#L179-L247), [celery/app/defaults.py:265-374](repo://celery/app/defaults.py#L265-L374), [celery/bin/worker.py:194-204](repo://celery/bin/worker.py#L194-L204)

> [!TIP]
> Every option, with its type and default, can be listed from `celery.app.defaults.DEFAULTS`. Use `app.conf.find_option('name')` to see which namespace an option belongs to.

Sources: [celery/app/defaults.py:403-413](repo://celery/app/defaults.py#L403-L413), [celery/app/utils.py:141-156](repo://celery/app/utils.py#L141-L156)
