---
title: "Application and Configuration"
---
## Overview

The `Celery` application coordinates configuration, task registration, and access to messaging and backend services. The small application in [[Quickstart]] uses the same setup path as larger projects: constructor values become configuration, decorators supply task definitions, and finalization binds those definitions to the application. Configuration loading and task finalization are related but distinct transitions, each with its own signals.

Sources: [celery/app/base.py:343-426](repo://celery/app/base.py#L343-L426), [celery/app/base.py:657-677](repo://celery/app/base.py#L657-L677), [celery/app/base.py:1247-1279](repo://celery/app/base.py#L1247-L1279)

## Construct an application

`Celery.__init__` accepts the main module name, broker, backend, included modules, loader, task base class, configuration source, namespace, and service-class overrides. It creates a registry, pending queues, a finalization lock, and thread-local storage. Constructor `broker`, `backend`, and `include` values are translated into `broker_url`, `result_backend`, and `include` in preconfiguration, making them part of the settings mechanism.

Sources: [celery/app/base.py:343-408](repo://celery/app/base.py#L343-L408)

The constructor installs fixups and optionally makes the application current. It also creates `on_after_configure`, `on_after_finalize`, and `on_after_fork` signals. Framework activation and the shared-task proxy belong to [[Framework Integration and Extensions]]; application construction supplies the lifecycle points they use. A configured app need not yet have materialized all its task decorators.

Sources: [celery/app/base.py:410-434](repo://celery/app/base.py#L410-L434), [celery/app/base.py:554-570](repo://celery/app/base.py#L554-L570), [celery/app/__init__.py:48-71](repo://celery/app/__init__.py#L48-L71)

## Load configuration

Before settings are read, `app.conf` wraps `PendingConfiguration`. Assignments and updates modify its stored dictionary without immediately loading the configuration source. Reading its data invokes the callback that replaces pending configuration with concrete settings. This preserves values assigned directly to `app.conf` before a later `config_from_object` call.

Sources: [celery/app/base.py:208-249](repo://celery/app/base.py#L208-L249), [celery/app/base.py:1230-1245](repo://celery/app/base.py#L1230-L1245)

`config_from_object` accepts an object or importable module name. It normally remembers that source until configuration is needed; `force=True`, or calling it after configuration has loaded, takes the immediate loader path. `config_from_envvar` expects the named environment variable to contain a configuration module name. A missing variable raises `ImproperlyConfigured` unless `silent=True` was requested.

Sources: [celery/app/base.py:703-743](repo://celery/app/base.py#L703-L743)

`_load_config` sends `on_configure`, asks the loader for the source, and passes loader settings plus preconfiguration into `detect_settings`. The resulting view places preconfiguration before source settings and defaults. The application swaps the settings in place so existing references to `app.conf` continue to work, then applies pending defaults and periodic tasks before sending `on_after_configure`. [[Periodic Scheduling]] covers those deferred schedule registrations.

Sources: [celery/app/base.py:1247-1280](repo://celery/app/base.py#L1247-L1280), [celery/app/utils.py:279-286](repo://celery/app/utils.py#L279-L286)

## Setting names and overrides

The settings detector recognizes current and legacy setting names. It selects a format based on the source keys, converts preconfiguration, and reports incompatible mixtures with rename suggestions. A configured namespace selects the current-format path. This behavior matters when moving a configuration between standalone modules and namespaced framework settings: a mixture can fail during lazy loading, after application construction appeared to succeed.

Sources: [celery/app/utils.py:232-286](repo://celery/app/utils.py#L232-L286), [celery/app/base.py:720-725](repo://celery/app/base.py#L720-L725)

| Property | Environment override | Fallback |
| --- | --- | --- |
| `broker_url` | `CELERY_BROKER_URL` | `broker_url`, then `broker_host` |
| `broker_read_url` | `CELERY_BROKER_READ_URL` | Read URL setting, then broker URL |
| `broker_write_url` | `CELERY_BROKER_WRITE_URL` | Write URL setting, then broker URL |
| `result_backend` | `CELERY_RESULT_BACKEND` | Backend setting under recognized names |

Sources: [celery/app/utils.py:84-112](repo://celery/app/utils.py#L84-L112)

Defaults include JSON task serialization, protocol version 2, queue name `celery`, publication retries enabled, and eager execution disabled. Broker retry and connection options live in the same settings tree. [[Task Publishing and Routing]] explains where these values affect a message; [[Task Retries and Failure Handling]] explains execution policy separately.

Sources: [celery/app/defaults.py:83-101](repo://celery/app/defaults.py#L83-L101), [celery/app/defaults.py:265-324](repo://celery/app/defaults.py#L265-L324)

## Register and finalize tasks

The `app.task` decorator can construct the task immediately or return a `PromiseProxy` and append it to `_pending`. A default shared decorator also connects a construction callback to app finalization. Attribute access on a proxy can trigger construction, so code that depends on deferred binding must avoid touching it before setup is ready. Registration therefore has an import-time definition stage and a later materialization stage.

Sources: [celery/app/base.py:536-570](repo://celery/app/base.py#L536-L570)

`_task_from_fun` generates a name unless one was supplied, selects the task base, and builds a class with the original function as `run`. With `bind=True`, the function is an instance method; otherwise it is static. The new instance enters the registry, binds to the application, and receives autoretry wrapping. If the registry already contains that name, the existing instance is returned. Explicit task names therefore share one application registry key.

Sources: [celery/app/base.py:590-633](repo://celery/app/base.py#L590-L633)

`finalize` runs under a reentrant lock. It marks the application finalized, announces the transition, evaluates pending proxies, binds registered tasks, and sends `on_after_finalize`. Accessing `app.tasks` invokes `finalize(auto=True)`; with `autofinalize=False`, that automatic path raises a contract error until explicit finalization has happened. Registry inspection can therefore change application lifecycle state.

Sources: [celery/app/base.py:657-677](repo://celery/app/base.py#L657-L677), [celery/app/base.py:1601-1609](repo://celery/app/base.py#L1601-L1609)

## Import and discover task modules

The loader's default modules combine built-ins, `imports`, and `include`. `init_worker` imports them once and then calls its worker initialization hook. Before importing, the loader sends `import_modules` and explicitly reraises exception responses because logging may not yet be configured. [[Worker Lifecycle and Execution]] starts from this loader stage when assembling the worker.

Sources: [celery/loaders/base.py:97-111](repo://celery/loaders/base.py#L97-L111), [celery/loaders/base.py:223-229](repo://celery/loaders/base.py#L223-L229)

`autodiscover_tasks` searches packages for a related module, normally `tasks`. A callable package list is evaluated lazily, and discovery connects to `import_modules` unless `force=True` is used. With no packages, fixups provide them. The loader skips an absent candidate module but reraises a `ModuleNotFoundError` caused by a nested import inside it; broken task dependencies should remain visible instead of being mistaken for packages with no tasks.

Sources: [celery/app/base.py:782-844](repo://celery/app/base.py#L782-L844), [celery/loaders/base.py:251-278](repo://celery/loaders/base.py#L251-L278)

## Resolve application services

The messaging service is instantiated with the app. Backend resolution chooses a class from the configured backend URL and constructs it lazily when `app.backend` is first requested. Thread-safe backend instances use the app-wide cache; other instances live in thread-local storage. [[Results and Backends]] owns persistence and waiting behavior, while this application layer owns selecting and retaining the service instance.

Sources: [celery/app/base.py:1224-1228](repo://celery/app/base.py#L1224-L1228), [celery/app/base.py:1535-1563](repo://celery/app/base.py#L1535-L1563)
