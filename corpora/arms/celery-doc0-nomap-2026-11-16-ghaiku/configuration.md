---
title: "Configuration"
---
## Overview

A Celery app reads its settings from several places: arguments passed to the `Celery` constructor, a configuration object or module named by the program, the loader's configuration file, and the defaults table. This page follows how those sources are merged into the `app.conf` object and which of them wins. The loader itself is explained in [[The Celery App]].

Sources: [celery/app/base.py:1247-1280](repo://celery/app/base.py#L1247-L1280)

## Merge order

When the configuration loads, the app takes the loader's settings, runs them through `prepare_config`, and passes them to `detect_settings` together with the constructor values and the list of keys that the constructor set. `detect_settings` builds the final `Settings` object from those layers.

Sources: [celery/app/base.py:1253-1259](repo://celery/app/base.py#L1253-L1259)

`Settings` is a `ConfigurationView` whose first mapping is the constructor's pre-configuration. Lookups check that mapping first, then the loader's settings, then the defaults. A value passed in code therefore beats the same key in the configuration file, and the defaults fill in whatever neither source sets.

Sources: [celery/app/utils.py:281-286](repo://celery/app/utils.py#L281-L286)

The keys the constructor set are subtracted from the set of keys that `detect_settings` checks (`have`). A constructor keyword therefore never triggers the old/new mixing error on its own.

Sources: [celery/app/utils.py:239-243](repo://celery/app/utils.py#L239-L243), [celery/app/base.py:1256-1259](repo://celery/app/base.py#L1256-L1259)

## Old and new names

`detect_settings` accepts both the new lowercase names (`task_always_eager`) and the old upper-case names (`CELERY_ALWAYS_EAGER`). It counts which style the keys use. The majority style chooses the table of names, and the other style is converted with the mapping for that table.

Sources: [celery/app/utils.py:246-266](repo://celery/app/utils.py#L246-L266)

A configuration that mixes the two styles for the same setting is refused. The error lists each old name with its new replacement, unless the user already gave both names for the same setting.

Sources: [celery/app/utils.py:268-277](repo://celery/app/utils.py#L268-L277)

## The defaults table

Every setting has an `Option` with a default, a type and an optional list of old names. `Option.to_python` converts a value to the declared type, so a string from the environment becomes a boolean or a list when the option says so.

Sources: [celery/app/defaults.py:42-59](repo://celery/app/defaults.py#L42-L59)

```python
class Option:
    """Describes a Celery configuration option."""

    alt = None
    deprecate_by = None
    remove_by = None
    old = set()
    typemap = {'string': str, 'int': int, 'float': float, 'any': lambda v: v,
               'bool': strtobool, 'dict': dict, 'tuple': tuple}

    def __init__(self, default=None, *args, **kwargs):
        self.default = default
        self.type = kwargs.get('type') or 'string'
        for attr, value in kwargs.items():
            setattr(self, attr, value)

    def to_python(self, value):
        return self.typemap[self.type](value)
```

Sources: [celery/app/defaults.py:42-59](repo://celery/app/defaults.py#L42-L59)

The table is grouped into namespaces. `NAMESPACES` is one `Namespace` call per group, and each entry is an `Option` such as `accept_content` with its default and type. The `flatten` helper turns the grouped table into a flat map from the new key (`task_always_eager`) and from each old key to the option.

Sources: [celery/app/defaults.py:66-70](repo://celery/app/defaults.py#L66-L70), [celery/app/defaults.py:378-400](repo://celery/app/defaults.py#L378-L400)

`find` looks for a setting by name. It tries the namespace named in the call first, then every other namespace, then the flat table of qualified names.

Sources: [celery/app/defaults.py:428-447](repo://celery/app/defaults.py#L428-L447)

## Environment overrides

Four settings read an environment variable before they read the configuration. The broker and result backend URLs are the main case: `broker_read_url` and `broker_write_url` each take `CELERY_BROKER_READ_URL` or `CELERY_BROKER_WRITE_URL` first, then their own key, then `broker_url`. `broker_url` and `result_backend` likewise check `CELERY_BROKER_URL` and `CELERY_RESULT_BACKEND` before the configuration.

Sources: [celery/app/utils.py:84-106](repo://celery/app/utils.py#L84-L106), [celery/app/utils.py:107-116](repo://celery/app/utils.py#L107-L116)

The `celery` command writes `CELERY_LOADER` and `CELERY_CONFIG_MODULE` into the environment when `--loader` or `--config` is given, so the loader and the module it reads are chosen before the app is created.

Sources: [celery/bin/celery.py:123-132](repo://celery/bin/celery.py#L123-L132), [celery/app/base.py:436-441](repo://celery/app/base.py#L436-L441)

## Loading a module

`config_from_object` accepts a module name or an object. It stores the object as the config source. If the configuration is already loaded or `force` is set, it drops the cached settings and hands the object to the loader right away; otherwise the object is read on the next access.

Sources: [celery/app/base.py:703-725](repo://celery/app/base.py#L703-L725)

```python
        self._config_source = obj
        self.namespace = namespace or self.namespace
        if force or self.configured:
            self._conf = None
            if self.loader.config_from_object(obj, silent=silent):
                return self.conf
```

Sources: [celery/app/base.py:703-725](repo://celery/app/base.py#L703-L725)

`config_from_envvar` reads a module name from an environment variable. It returns `False` without raising when the variable is unset and `silent` is set, and raises `ImproperlyConfigured` otherwise.

Sources: [celery/app/base.py:727-743](repo://celery/app/base.py#L727-L743)

The loader's own reader is `read_configuration`. It imports the module named by `CELERY_CONFIG_MODULE` and wraps it in a `DictAttribute`. The default loader uses `celeryconfig` when the variable is unset, and it warns instead of failing when that module is missing, if `C_WNOCONF` is set.

Sources: [celery/loaders/base.py:208-221](repo://celery/loaders/base.py#L208-L221), [celery/loaders/default.py:13-40](repo://celery/loaders/default.py#L13-L40)

The loader's import list is the builtin modules, then the `imports` setting, then `include`. `import_default_modules` sends the `import_modules` signal first and re-raises any exception a receiver returned, so an import failure reaches the caller instead of being silenced. It then imports each name in the list.

Sources: [celery/loaders/base.py:223-229](repo://celery/loaders/base.py#L223-L229), [celery/loaders/base.py:97-105](repo://celery/loaders/base.py#L97-L105)
