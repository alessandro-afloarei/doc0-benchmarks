---
title: "The Celery App and Configuration"
---
## Overview

The `Celery` class is the single object that owns a project's tasks, configuration, broker helpers and result backend. It is built to be created at import time, before any settings or tasks are fully known, so nearly everything on it is lazy: tasks are proxies, `app.conf` is a placeholder until first read, and the AMQP, events, control and log helpers are created on first access.

Sources: [celery/app/base.py:252-342](repo://celery/app/base.py#L252-L342), [celery/app/base.py:1535-1612](repo://celery/app/base.py#L1535-L1612)

The sections below follow that order: what the constructor sets up, how a function becomes a task, how finalization binds tasks, and how configuration is read. Publishing a message from a task is covered in [[Publishing Tasks]].

Sources: [celery/app/base.py:343-435](repo://celery/app/base.py#L343-L435)

## Constructing an app

The constructor stores the pluggable class names (`amqp_cls`, `events_cls`, `log_cls`, `control_cls`, `task_cls`, `registry_cls`), picks a loader class (the `CELERY_LOADER` environment variable wins, then `loader_cls`, then `celery.loaders.app:AppLoader`), creates an empty task registry and a `LamportClock`, and records `autofinalize`.

Sources: [celery/app/base.py:343-382](repo://celery/app/base.py#L343-L382), [celery/app/base.py:436-442](repo://celery/app/base.py#L436-L442)

`broker`, `backend` and `include` are not stored as attributes. They are moved into `_preconf` under the setting names `broker_url`, `result_backend` and `include`, and any extra keyword arguments follow. `__autoset` also remembers which keys were set this way in `_preconf_set_by_auto`, so they can be ignored when the library decides whether the project uses old or new setting names.

Sources: [celery/app/base.py:388-402](repo://celery/app/base.py#L388-L402), [celery/app/base.py:447-450](repo://celery/app/base.py#L447-L450)

`self._conf` starts as a `Settings` wrapping a `PendingConfiguration`. That object accepts writes (`update`, `setdefault`, item assignment) into the preconfiguration dict without loading anything; reading any other key triggers `_finalize_pending_conf`, which replaces it with the real settings. Fix-ups such as the Django one are instantiated next, and `set_current` makes the app the thread's current app unless `set_as_current=False`.

Sources: [celery/app/base.py:208-250](repo://celery/app/base.py#L208-L250), [celery/app/base.py:403-420](repo://celery/app/base.py#L403-L420)

## Defining tasks

`@app.task` has three outcomes, decided inside `inner_create_task_cls`:

Sources: [celery/app/base.py:554-585](repo://celery/app/base.py#L554-L585)

- When `shared` is true, a `cons` callback is registered with `connect_on_app_finalize`, so the task is also created on every other app that finalizes.
- When `lazy` is false or the app is already finalized, `_task_from_fun` runs immediately and the task is returned.
- Otherwise a `PromiseProxy` around `_task_from_fun` is returned and appended to `app._pending`.

Sources: [celery/app/base.py:554-585](repo://celery/app/base.py#L554-L585)

`_task_from_fun` raises `RuntimeError('Contract breach: app not finalized')` when auto-finalize is off and the app has not been finalized. Otherwise it names the task with `gen_task_name`, wraps the function in a new subclass of the base task class with `run` set to the function, registers it in `_tasks`, binds it to the app and applies autoretry behaviour. A task whose name is already registered is returned as is.

Sources: [celery/app/base.py:590-633](repo://celery/app/base.py#L590-L633)

`gen_task_name` joins the module name and function name, and when the module is `__main__` it substitutes the app's `main` name so that a script run as a worker and the same script imported by a client agree on the name.

Sources: [celery/utils/imports.py:122-141](repo://celery/utils/imports.py#L122-L141)

The registry is a `dict` subclass whose `__missing__` raises `NotRegistered`, so looking up an unknown task name raises rather than returning `None`.

Sources: [celery/app/registry.py:17-45](repo://celery/app/registry.py#L17-L45)

## Finalization

`finalize` takes `_finalize_mutex`, marks the app finalized, announces it to the shared-task callbacks, evaluates each pending proxy with `maybe_evaluate`, rebinds every registered task, and sends `on_after_finalize`. The `app.tasks` property calls `finalize(auto=True)`, so touching the registry finalizes the app, and a `RuntimeError` is raised if `autofinalize` was disabled.

Sources: [celery/app/base.py:657-677](repo://celery/app/base.py#L657-L677), [celery/app/base.py:1601-1608](repo://celery/app/base.py#L1601-L1608)

`Task.bind` is where a task takes its defaults from the configuration. For each pair in `from_config` (for example `('acks_late', 'task_acks_late')`) a class attribute that is still `None` is filled from `app.conf`. It also resolves `acks_on_failure` and `acks_on_timeout` from the combined `acks_on_failure_or_timeout` option, defaulting both to true.

Sources: [celery/app/task.py:396-456](repo://celery/app/task.py#L396-L456)

## Reading configuration

`app.conf` calls `_load_config` the first time a real key is read. `_load_config` sends `on_configure`, asks the loader to read `config_source` if one was set, marks the app configured, and passes the loader's mapping plus the preconfiguration to `detect_settings`. After swapping the result into the existing `Settings` object, it replays lazily registered defaults and periodic tasks and finally sends `on_after_configure`.

Sources: [celery/app/base.py:1247-1280](repo://celery/app/base.py#L1247-L1280)

`detect_settings` is what supports both the old (`CELERY_TASK_SERIALIZER`) and new (`task_serializer`) key styles. It counts how many user keys are in each style, picks the style of the majority, and refuses a mix with `ImproperlyConfigured` and a rename suggestion unless the user provided both spellings of a key. When a namespace prefix is used it always takes the new style.

Sources: [celery/app/utils.py:232-286](repo://celery/app/utils.py#L232-L286)

The defaults themselves live in `NAMESPACES` in `celery/app/defaults.py`: nested `Namespace` objects of `Option(default, type=...)` entries, where `__old__` templates generate the legacy names. For example the `beat` namespace sets `scheduler` to `celery.beat:PersistentScheduler` and `schedule_filename` to `celerybeat-schedule`, and the `broker` namespace sets `connection_retry` to true and `heartbeat` to 120.

Sources: [celery/app/defaults.py:66-100](repo://celery/app/defaults.py#L66-L100)

There are three ways to supply values:

Sources: [celery/app/base.py:703-748](repo://celery/app/base.py#L703-L748)

| Method | Behaviour |
| --- | --- |
| `config_from_object(obj)` | Remembers `obj` as `_config_source` and reads it on the next load, or immediately with `force=True` or if the app is already configured |
| `config_from_envvar(name)` | Reads a module name from the environment variable and delegates to `config_from_object`; raises `ImproperlyConfigured` if unset and not `silent` |
| `config_from_cmdline(argv, namespace)` | Updates `_conf` with options parsed by the loader's command-line parser |

Sources: [celery/app/base.py:703-748](repo://celery/app/base.py#L703-L748)

The loader's `config_from_object` accepts either an object or a dotted name: a string is imported (with `module:attribute` supported), the result becomes `_conf`, and an `override_backends` entry is captured for backend lookup. That entry is how [[Result Backends]] can be extended without patching the library.

Sources: [celery/loaders/base.py:119-145](repo://celery/loaders/base.py#L119-L145)

## Discovering task modules

`autodiscover_tasks` is lazy by default: it connects a promise to the `import_modules` signal so modules are imported only when the loader imports the default modules. With `force=True` it imports immediately.

Sources: [celery/app/base.py:782-827](repo://celery/app/base.py#L782-L827)
