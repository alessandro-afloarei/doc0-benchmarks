---
title: "Applications and Configuration"
---
## Overview

A `Celery` application owns the configuration and task registry used by producers and workers. Construction records component classes, creates a registry and initializes queues for deferred tasks and settings. The importable application selected in [[Quickstart]] therefore provides more than a broker address: it determines which task objects, loader, control interface and backend a process uses.

Sources: [celery/app/base.py:343-385](repo://celery/app/base.py#L343-L385), [celery/app/base.py:392-408](repo://celery/app/base.py#L392-L408)

## Construct an application

The constructor accepts `main`, `broker`, `backend`, `include`, `config_source`, `namespace`, `task_cls` and `autofinalize`, alongside replaceable component implementations. It converts a supplied registry into `TaskRegistry` when necessary. `broker`, `backend` and `include` become preconfiguration entries, as do remaining keyword settings; the comment explains that moving these options into configuration simplifies application pickling.

Sources: [celery/app/base.py:343-408](repo://celery/app/base.py#L343-L408)

Built-in or explicitly supplied fixups are instantiated during construction. Unless `set_as_current=False`, the application becomes current, and the constructor creates its configuration and finalization signals. Current-app behavior matters for shared task proxies, which resolve through the current application rather than storing one fixed task instance. This is the registry side of the process separation described in [[Celery Overview]].

Sources: [celery/app/base.py:410-434](repo://celery/app/base.py#L410-L434), [celery/app/__init__.py:64-71](repo://celery/app/__init__.py#L64-L71)

## Load settings lazily

`app.conf` initially wraps `PendingConfiguration`. Accessing a configuration key invokes `_finalize_pending_conf`, which calls `_load_config`. Loading sends `on_configure`, asks the loader to read the configured source, detects the settings naming scheme and merges the result with preconfiguration and defaults. Existing references to the settings object are preserved by swapping the loaded mapping into place, so a caller holding `app.conf` can continue using it after loading.

Sources: [celery/app/base.py:403-408](repo://celery/app/base.py#L403-L408), [celery/app/base.py:1230-1266](repo://celery/app/base.py#L1230-L1266)

`config_from_object` accepts an object or importable module name. By default it records the source for later; `force=True` or an already configured app triggers loading immediately. `config_from_envvar` reads a module name from the named environment variable and raises `ImproperlyConfigured` when it is absent unless `silent=True`. The loader converts imported objects into mappings and can read an `override_backends` mapping from them.

Sources: [celery/app/base.py:703-743](repo://celery/app/base.py#L703-L743), [celery/loaders/base.py:119-130](repo://celery/loaders/base.py#L119-L130)

The settings detector recognizes old and new setting names and raises with rename suggestions when incompatible forms are mixed without matching counterparts. A namespace prefix selects the new naming format. Broker and backend URLs also have dedicated environment lookups: `CELERY_BROKER_URL` and `CELERY_RESULT_BACKEND` precede configured values, while separate read and write broker URLs fall back to the shared URL. [[Publishing and Routing]] explains how producer connections use those settings.

Sources: [celery/app/utils.py:235-285](repo://celery/app/utils.py#L235-L285), [celery/app/utils.py:84-112](repo://celery/app/utils.py#L84-L112)

Deferred defaults and periodic entries are applied before `on_after_configure` is sent. `add_defaults` accepts a callable evaluated only when configuration is needed; its API documents that the mapping is not copied or transferred to spawned worker children, so equivalent setup must happen when imports reconstruct the app. Periodic entry dispatch itself belongs to [[Periodic Scheduling]].

Sources: [celery/app/base.py:679-701](repo://celery/app/base.py#L679-L701), [celery/app/base.py:1268-1280](repo://celery/app/base.py#L1268-L1280)

## Register and finalize tasks

`app.task` creates a class-producing decorator. With lazy binding it returns a `PromiseProxy` and appends it to `_pending`; otherwise it immediately calls `_task_from_fun`. Shared decorators also register a callback for application finalization. Accessing attributes on a lazy task can evaluate the proxy, which is why the decorator's own documentation warns callers who rely on deferred binding to wait until setup is complete.

Sources: [celery/app/base.py:536-570](repo://celery/app/base.py#L536-L570)

`_task_from_fun` chooses an explicit name or generates one from the function and module, then uses the configured task base. `bind=True` installs the function as an instance method; otherwise it becomes a static `run`. The new instance receives metadata and an argument checker, enters `_tasks`, binds to the app and gains autoretry behavior. If that name already exists, the existing registered instance is returned. [[Tasks and Retries]] follows the execution interface of this resulting object.

Sources: [celery/app/base.py:590-633](repo://celery/app/base.py#L590-L633)

`finalize` holds a reentrant lock, marks the application finalized, announces finalization, evaluates pending task decorators, binds every registered task and sends `on_after_finalize`. An automatic finalization request with `autofinalize=False` raises a contract error. The application identifies its after-finalize signal as the earliest stable point for inspecting currently registered tasks, rather than promising that no later import can add another task.

Sources: [celery/app/base.py:333-338](repo://celery/app/base.py#L333-L338), [celery/app/base.py:657-677](repo://celery/app/base.py#L657-L677)

## Import and discover task modules

The loader combines built-in modules with `imports` and `include`. `init_worker` imports them once and calls the worker initialization hook. Before importing defaults it sends `import_modules` and explicitly reraises exception responses because logging is not yet fully configured; this avoids silently losing import failures during startup. A task module must actually be imported for its decorators to populate a worker's registry.

Sources: [celery/loaders/base.py:97-111](repo://celery/loaders/base.py#L97-L111), [celery/loaders/base.py:223-229](repo://celery/loaders/base.py#L223-L229)

`autodiscover_tasks` normally connects a deferred search to `import_modules`; `force=True` searches immediately. It searches each package's `tasks` module by default, supports another related name and can obtain packages from fixups. Discovery suppresses a missing candidate module but reraises an error from a nested import, distinguishing an absent tasks module from a broken one.

Sources: [celery/app/base.py:809-844](repo://celery/app/base.py#L809-L844), [celery/loaders/base.py:251-278](repo://celery/loaders/base.py#L251-L278)

Library authors can use `shared_task` to register on future app finalizations and on already finalized active apps. Its returned proxy selects the named task from the current application's registry on access. This lets the library supply a task definition while the consuming process supplies configuration and the application context.

Sources: [celery/app/__init__.py:24-32](repo://celery/app/__init__.py#L24-L32), [celery/app/__init__.py:48-71](repo://celery/app/__init__.py#L48-L71)

## Django integration

The Django fixup activates when `DJANGO_SETTINGS_MODULE` is set and the loader is not already a Django loader. It checks the Django import and version, places the current directory first on the import path, selects `DjangoTask` when no custom task class was requested, and connects import and worker hooks. The import hook calls `django.setup()` and runs model checks unless `CELERY_SKIP_CHECKS` is set, before task modules are imported.

Sources: [celery/fixups/django.py:52-89](repo://celery/fixups/django.py#L52-L89), [celery/fixups/django.py:101-103](repo://celery/fixups/django.py#L101-L103), [celery/fixups/django.py:146-154](repo://celery/fixups/django.py#L146-L154)

`DjangoTask.delay_on_commit` and `apply_async_on_commit` register partial task calls with Django's `transaction.on_commit`. They return `None`, so the deferred call does not immediately provide the result handle that ordinary submission returns. Use these methods when publication should be scheduled by the transaction's commit callback; the subsequent message takes the same [[Publishing and Routing]] path as other task calls.

Sources: [celery/contrib/django/task.py:8-21](repo://celery/contrib/django/task.py#L8-L21)
