---
title: "The Celery Application and Configuration"
---
## Overview

The `Celery` class is the root object of a project. It owns the configuration, the task registry, the loader, and lazily created helpers for AMQP, events, logging, control and results. Almost everything else in the package takes an `app` and asks it for settings, connections or tasks. This page follows how an app is built, when its configuration is actually read, and when its tasks are bound. How tasks are declared is in [[Defining Tasks, Retries and Task Options]]; how the app publishes messages is in [[Publishing Tasks: apply_async, Routing and Messages]].

Sources: [celery/app/base.py:252-342](repo://celery/app/base.py#L252-L342), [celery/app/base.py:1535-1610](repo://celery/app/base.py#L1535-L1610)

## Building the app

`Celery.__init__` records the class names of its collaborators (`amqp_cls`, `events_cls`, `loader_cls`, `log_cls`, `control_cls`), creates a `TaskRegistry`, and installs fixups. The default loader is taken from the `CELERY_LOADER` environment variable, then `loader_cls`, then `celery.loaders.app:AppLoader`.

Sources: [celery/app/base.py:343-375](repo://celery/app/base.py#L343-L375), [celery/app/base.py:436-442](repo://celery/app/base.py#L436-L442)

The `broker`, `backend` and `include` arguments and any extra keyword arguments are not stored on the app; `__autoset` puts each non-`None` value into `_preconf` and remembers the key in `_preconf_set_by_auto`. The `_conf` attribute becomes a `Settings` wrapped around a `PendingConfiguration` that holds `_preconf`, with the app's `_finalize_pending_conf` as its callback.

Sources: [celery/app/base.py:393-408](repo://celery/app/base.py#L393-L408), [celery/app/base.py:447-450](repo://celery/app/base.py#L447-L450)

Unless `set_as_current=False`, the constructor calls `set_current`, and at the end `_register_app` adds the app to a global weak set. Four signals are created on the instance: `on_configure`, `on_after_configure`, `on_after_finalize` and `on_after_fork`.

Sources: [celery/app/base.py:413-434](repo://celery/app/base.py#L413-L434), [celery/_state.py:33-34](repo://celery/_state.py#L33-L34)

The `Django` fixup is built in: `BUILTIN_FIXUPS` names `celery.fixups.django:fixup`, and `autodiscover_tasks` with no packages asks each fixup that has an `autodiscover_tasks` method for packages.

Sources: [celery/app/base.py:82-84](repo://celery/app/base.py#L82-L84), [celery/app/base.py:839-844](repo://celery/app/base.py#L839-L844)

## Lazy configuration

`PendingConfiguration` stands in for `app.conf` until something reads a key. Writes (`__setitem__`, `update`, `setdefault`) go to the plain pre-configuration dict, so you can set options before calling `config_from_object`. Reading any key evaluates its cached `data` property, which calls the callback and so loads the real configuration.

Sources: [celery/app/base.py:208-250](repo://celery/app/base.py#L208-L250)

```python
class PendingConfiguration(UserDict, AttributeDictMixin):
    # accessing any key will finalize the configuration,
    # replacing `app.conf` with a concrete settings object.
    ...
    @cached_property
    def data(self):
        return self.callback()
```

Sources: [celery/app/base.py:208-250](repo://celery/app/base.py#L208-L250)

`_load_config` is the loading step. In order it:

Sources: [celery/app/base.py:1247-1280](repo://celery/app/base.py#L1247-L1280)

1. sends `on_configure`;
2. if a `config_source` was set, asks the loader to read it with `config_from_object`;
3. marks the app `configured`;
4. calls `detect_settings` on the loader's configuration and the pre-configuration;
5. swaps the result into the existing `_conf` in place, so references to `app.conf` taken earlier stay valid;
6. evaluates the lazy defaults queued by `add_defaults` and the periodic tasks queued by `add_periodic_task`;
7. sends `on_after_configure`.

Sources: [celery/app/base.py:1230-1280](repo://celery/app/base.py#L1230-L1280)

A failure inside loading that raises `AttributeError` is re-raised as `ModuleNotFoundError`, because `PendingConfiguration`'s parent would otherwise swallow it and produce a confusing `RecursionError`.

Sources: [celery/app/base.py:1230-1245](repo://celery/app/base.py#L1230-L1245)

## Reading configuration sources

`config_from_object` stores the source in `_config_source` and a namespace; with `force=True`, or when the app is already `configured`, it discards `_conf` and reads immediately. Otherwise reading is deferred to `_load_config`. The loader's own `config_from_object` imports a string (a module, or `module:attr`, resolved relative to the current directory), turns the result into a mapping, and picks up an optional `override_backends` entry.

Sources: [celery/app/base.py:703-725](repo://celery/app/base.py#L703-L725), [celery/loaders/base.py:119-130](repo://celery/loaders/base.py#L119-L130)

`config_from_cmdline` updates `_conf` from `--name=value` arguments through the loader's parser, which is how the `worker` command applies extra options. `add_defaults` accepts a dict or a callable; a callable is not evaluated until the configuration is needed.

Sources: [celery/app/base.py:679-701](repo://celery/app/base.py#L679-L701), [celery/app/base.py:745-748](repo://celery/app/base.py#L745-L748)

`Settings` overrides a few lookups so the environment wins: `broker_url` reads `CELERY_BROKER_URL` first, `broker_read_url` and `broker_write_url` read their own variables and fall back to `broker_url`, and `result_backend` reads `CELERY_RESULT_BACKEND`.

Sources: [celery/app/utils.py:70-113](repo://celery/app/utils.py#L70-L113)

## Old and new setting names

Celery has two key spellings: lowercase names such as `task_always_eager` and the old uppercase `CELERY_ALWAYS_EAGER` style. `detect_settings` decides which the user wrote by intersecting the user's keys with the known new and old key sets. It uses whichever style is in the majority, and raises `ImproperlyConfigured` with rename suggestions when keys of the minority style appear without their counterpart. A `namespace` (prefix) forces the new style. The result is a `Settings` stacking the pre-configuration, the user's configuration and the defaults, with key-conversion functions between the two styles.

Sources: [celery/app/utils.py:232-286](repo://celery/app/utils.py#L232-L286)

The defaults come from `NAMESPACES` in `celery/app/defaults.py`, a nested dictionary of `Option(default, type=...)` entries. `flatten` walks it into `DEFAULTS` (new names to defaults), and the same walk builds `_OLD_DEFAULTS` and the `_TO_OLD_KEY`/`_TO_NEW_KEY` maps, using each option's `old` set of name templates.

Sources: [celery/app/defaults.py:379-414](repo://celery/app/defaults.py#L379-L414)

```python
DEFAULTS = {
    key: opt.default for key, opt in flatten(NAMESPACES)
}
__compat = list(flatten(NAMESPACES, keyfilter=_to_compat))
_OLD_DEFAULTS = {old_key: opt.default for old_key, _, opt in __compat}
_TO_OLD_KEY = {new_key: old_key for old_key, new_key, _ in __compat}
_TO_NEW_KEY = {old_key: new_key for old_key, new_key, _ in __compat}
```

Sources: [celery/app/defaults.py:30-62](repo://celery/app/defaults.py#L30-L62), [celery/app/defaults.py:379-414](repo://celery/app/defaults.py#L379-L414)

`Option.to_python` converts command-line strings using the `typemap` (`string`, `int`, `float`, `any`, `bool`, `dict`, `tuple`). Options can carry `alt`, `deprecate_by` and `remove_by` attributes for deprecation warnings.

Sources: [celery/app/defaults.py:42-63](repo://celery/app/defaults.py#L42-L63)

## Finalizing the app

`finalize` runs once under a re-entrant lock. It sets `finalized`, calls `_announce_app_finalized` (which runs every callback registered by `connect_on_app_finalize`, including the built-in tasks and every `shared_task`), evaluates each pending task proxy, binds every registered task to the app, and sends `on_after_finalize`.

Sources: [celery/app/base.py:657-677](repo://celery/app/base.py#L657-L677), [celery/_state.py:43-52](repo://celery/_state.py#L43-L52)

Accessing `app.tasks` calls `finalize(auto=True)`; if the app was built with `autofinalize=False` that raises `RuntimeError('Contract breach: app not finalized')`. Other helpers are `cached_property` objects created on first use: `amqp`, `events`, `control`, `loader`, `log`, and `backend`.

Sources: [celery/app/base.py:1601-1609](repo://celery/app/base.py#L1601-L1609), [celery/app/base.py:1535-1538](repo://celery/app/base.py#L1535-L1538), [celery/app/base.py:1577-1595](repo://celery/app/base.py#L1577-L1595)

The `backend` property builds the result backend with `backends.by_url`, using `backend_cls` or `conf.result_backend`, and stores it in the shared `_backend_cache` when the backend declares itself thread safe and in thread-local storage otherwise. See [[Task Results, States and Result Backends]].

Sources: [celery/app/base.py:1224-1228](repo://celery/app/base.py#L1224-L1228), [celery/app/base.py:1539-1563](repo://celery/app/base.py#L1539-L1563)

## Current app, forks and cleanup

`set_current` stores the app in thread-local state (`current_app`), while `set_default` makes it the default for all threads. `_ensure_after_fork` registers `_after_fork_cleanup_app` with `multiprocessing.register_after_fork`; after a fork `_after_fork` clears the cached connection pool and the AMQP producer pool and sends `on_after_fork`, so child processes never reuse the parent's sockets.

Sources: [celery/app/base.py:452-464](repo://celery/app/base.py#L452-L464), [celery/app/base.py:1282-1288](repo://celery/app/base.py#L1282-L1288), [celery/app/base.py:118-124](repo://celery/app/base.py#L118-L124)

`close` drops the connection pool and deregisters the app; the class also works as a context manager, which is the recommended way to clean up short-lived apps.

Sources: [celery/app/base.py:466-478](repo://celery/app/base.py#L466-L478), [celery/app/base.py:1382-1386](repo://celery/app/base.py#L1382-L1386)

## Loaders

A loader decides how configuration and task modules are loaded in each process. `BaseLoader` has hooks `on_task_init`, `on_process_cleanup`, `on_worker_init`, `on_worker_shutdown` and `on_worker_process_init`; `init_worker` imports the default modules once (after sending the `import_modules` signal, which is how `autodiscover_tasks` runs lazily) and then calls `on_worker_init`. `AppLoader` is the default for custom apps; the aliases `app` and `default` resolve through `get_loader_cls`.

Sources: [celery/loaders/base.py:60-117](repo://celery/loaders/base.py#L60-L117), [celery/loaders/app.py:1-8](repo://celery/loaders/app.py#L1-L8), [celery/loaders/__init__.py:10-18](repo://celery/loaders/__init__.py#L10-L18)
