---
title: "Applications and Configuration"
---
## Overview

A `Celery` application is the configuration and task-identity boundary shared by producers and workers. It owns the registry, loader, messaging service and application-bound task base. [[Quickstart]] shows one importable instance; this page follows how construction becomes usable configuration and registered tasks. Once registration is complete, [[Task Publishing and Routing]] takes over when a task invocation becomes a message.

Sources: [celery/app/base.py:343-408](repo://celery/app/base.py#L343-L408), [celery/app/base.py:607-630](repo://celery/app/base.py#L607-L630), [celery/app/task.py:702-705](repo://celery/app/task.py#L702-L705)

## Construct the application boundary

The constructor selects loader, AMQP, logging, events, control and task classes, then creates the task registry and pending queues. `broker`, `backend` and `include` become preconfiguration values. A `Settings` view wraps `PendingConfiguration`, keeping configuration deferred until it is needed. Fixups are installed during construction, and `set_as_current=True` makes this instance the current application for its thread.

Sources: [celery/app/base.py:343-416](repo://celery/app/base.py#L343-L416)

`current_app` is a proxy. Resolution uses the thread-local current application when present and otherwise the global default application; if no default exists, it constructs a fallback instance with the default loader. Shared libraries can therefore resolve an application dynamically, but application code that needs a particular configuration can retain and import its explicit instance as the [[Quickstart]] does.

Sources: [celery/_state.py:92-104](repo://celery/_state.py#L92-L104), [celery/_state.py:138-142](repo://celery/_state.py#L138-L142), [examples/next-steps/proj/tasks.py:1-6](repo://examples/next-steps/proj/tasks.py#L1-L6)

## Load and normalize settings

`config_from_object` accepts an object or importable module name. By default it records the source for later loading; `force=True`, or an already configured application, loads immediately. `config_from_envvar` reads a module name from the specified environment variable and delegates to the same method. An unset variable raises `ImproperlyConfigured` unless `silent=True`; silence is an explicit option rather than the default import behavior.

Sources: [celery/app/base.py:703-743](repo://celery/app/base.py#L703-L743), [celery/loaders/base.py:119-130](repo://celery/loaders/base.py#L119-L130)

On first required configuration access, `_load_config` sends `on_configure`, loads the configured source and passes loader settings plus preconfiguration to `detect_settings`. It swaps the completed settings into the existing view so references to `app.conf` remain useful. Pending defaults and periodic entries are then applied before `on_after_configure` is sent. Configuration completion and task finalization are distinct milestones with separate signals.

Sources: [celery/app/base.py:1230-1279](repo://celery/app/base.py#L1230-L1279), [celery/app/base.py:657-677](repo://celery/app/base.py#L657-L677)

Normalization recognizes old and new setting names, detects unsupported mixtures and supplies renaming suggestions. A namespace prefix selects the new naming format. The resulting settings view places preconfiguration ahead of the configured source and defaults. Endpoint properties additionally check `CELERY_BROKER_URL` and `CELERY_RESULT_BACKEND`; separate read and write URL environment variables can override their respective broker endpoints. Inspect these properties when effective endpoints differ from the imported configuration object.

Sources: [celery/app/utils.py:232-286](repo://celery/app/utils.py#L232-L286), [celery/app/utils.py:84-112](repo://celery/app/utils.py#L84-L112)

## Materialize decorated tasks

`app.task` builds a factory around the decorated function. A lazy decorator returns a `PromiseProxy` and queues it for evaluation; an already finalized application, or `lazy=False`, materializes immediately. Shared registration also attaches a callback to application finalization. This allows decorators to be imported before all application-specific task objects have been constructed.

Sources: [celery/app/base.py:554-585](repo://celery/app/base.py#L554-L585)

`_task_from_fun` generates a name unless one is provided, chooses the supplied base or `app.Task`, and constructs a task class whose `run` is either the bound function or a static method. It retains metadata and an argument-checking header, creates one instance, registers it, binds it to the application and adds autoretry behavior. A name already in the registry returns the existing task. [[Task Execution and Retries]] describes what the bound task does once a worker invokes it.

Sources: [celery/app/base.py:590-633](repo://celery/app/base.py#L590-L633)

`shared_task` is designed for library authors who need tasks to work with different applications. It registers construction callbacks for future applications, adds the task to already finalized applications, and returns a proxy that resolves the task by name from the current application's registry. Its returned proxy consequently follows application selection instead of permanently holding one application's task instance.

Sources: [celery/app/__init__.py:24-32](repo://celery/app/__init__.py#L24-L32), [celery/app/__init__.py:48-71](repo://celery/app/__init__.py#L48-L71)

## Finalize and import worker modules

`finalize` uses an `RLock`, marks the application finalized once, announces finalization, evaluates queued decorators and binds all registered tasks. It then sends `on_after_finalize`. Accessing `app.tasks` calls `finalize(auto=True)` automatically. With `autofinalize=False`, an automatic finalization attempt raises a contract error; initialize deliberately before accessing APIs that depend on the finalized registry.

Sources: [celery/app/base.py:657-677](repo://celery/app/base.py#L657-L677), [celery/app/base.py:1601-1609](repo://celery/app/base.py#L1601-L1609)

The loader's `init_worker` imports default modules once before calling its worker hook. Default modules combine builtins, `imports` and `include`. During import, it first sends `import_modules` and explicitly re-raises exception responses because logging may not yet be ready; this prevents initialization failures from being silently hidden. [[Worker Lifecycle and Concurrency]] follows the worker after this application-loading boundary.

Sources: [celery/loaders/base.py:97-117](repo://celery/loaders/base.py#L97-L117), [celery/loaders/base.py:223-229](repo://celery/loaders/base.py#L223-L229)

## Discover task modules and extend initialization

`autodiscover_tasks` searches the listed packages for the related module, normally `tasks`; a callable package list is evaluated lazily. Without `force=True`, discovery is connected to `import_modules`. Omitting packages delegates package discovery to installed fixups. [[Framework Integrations]] explains how Django supplies those packages and runs its setup before task imports; the generic discovery mechanism remains in the loader and application.

Sources: [celery/app/base.py:782-789](repo://celery/app/base.py#L782-L789), [celery/app/base.py:809-844](repo://celery/app/base.py#L809-L844), [celery/loaders/base.py:218-221](repo://celery/loaders/base.py#L218-L221)

Application services also retain explicit extension boundaries. The AMQP service is instantiated from the configured class with the application attached. Backends are initialized on demand and cached globally on the application only when the backend declares itself thread-safe; otherwise the cache is thread-local. [[Result Backend Catalogue]] covers resolution of that backend class, while [[Periodic Scheduling]] covers the periodic entries drained during configuration.

Sources: [celery/app/base.py:1535-1563](repo://celery/app/base.py#L1535-L1563), [celery/app/base.py:1273-1279](repo://celery/app/base.py#L1273-L1279)
