---
type: architecture
title: Application, configuration, and task registration
description: How a Celery application owns configuration, task registration, loaders, and runtime services, and when lazy setup becomes concrete.
tags: [application, configuration, registry, loaders]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:38:41.370Z
sources:
  - id: openwiki-source-5112943b291f75d67ab0c888
    resource: repo://celery/_state.py
  - id: openwiki-source-c7b315432f7d11b299e2a88a
    resource: repo://celery/app/__init__.py
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-461899b2d0d382360e23a4f2
    resource: repo://celery/loaders/base.py
generated: { by: "codex", at: "2026-11-16T16:38:41.370Z" }
---

# Application, configuration, and task registration

`Celery` is the composition root for a producer or worker. It owns a task registry, settings, loader, and factories for messaging, results, logging, events, and control. Producer and worker processes construct their own application objects; they coordinate through task names and messages, rather than sharing Python objects.

## Two lazy lifecycles

Configuration loading and task finalization are related but distinct. Construction puts constructor settings into `PendingConfiguration`; reading a setting resolves the loader configuration and defaults. `config_from_object()` records an object or import path and normally defers reading it. `force=True`, or calling it after configuration was already loaded, takes the immediate path.

`_load_config()` sends `on_configure`, loads the configuration source, combines it with constructor changes through `detect_settings()`, applies pending defaults and periodic entries, then sends `on_after_configure`. The existing settings object is swapped in place when possible, preserving references held by callers. Namespaced configuration is supported, for example `namespace='CELERY'` for framework settings. Old/new key compatibility is implemented in `app/utils.py`; it should not be treated as permission to mix arbitrary naming styles.

Task finalization runs under a reentrant mutex. It announces finalization to registered callbacks, evaluates pending task decorators, binds the registry's tasks to the application, and sends `on_after_finalize`. Reading `app.tasks` triggers automatic finalization; with `autofinalize=False`, premature automatic finalization raises `RuntimeError`. Use `on_after_finalize` when code needs the currently registered tasks to be available. It does not promise that future imports can never register additional tasks.

## From callable to registered task

`@app.task` can return a `PromiseProxy`, delaying construction until use or finalization. `_task_from_fun()` derives a task name, creates a task instance around the function, installs it in the registry, binds it, and adds automatic retry behavior. If that name already exists, the registered task is reused. Names therefore form the compatibility boundary between task publishers and workers; changing a module path or explicit name can strand messages using the old name.

`@shared_task` supports reusable libraries. It registers callbacks for future application finalization, adds the task to already finalized active applications, and returns a proxy that resolves through the current application's registry. It is not permanently bound to the first application that imports the module.

The current application is selected through thread-local state with a process default fallback. Current task state uses a local stack. Prefer passing an explicit application into infrastructure code when ownership matters, especially in tests that create multiple applications.

## Imports and framework discovery

Worker initialization asks the loader to import default modules: built-ins, `imports`, and `include`. Before those imports, it sends `import_modules` and explicitly reraises exception responses, so framework setup errors stop startup rather than becoming silently missing tasks.

`autodiscover_tasks(packages)` normally registers work on that same import signal. `force=True` imports immediately. Without an explicit package list it asks installed fixups, including [Django](../integrations/django.md), for packages. An application existing in a process does not by itself import every task module.

## Extension and diagnostic paths

Application constructor/class attributes select custom task, loader, registry, messaging, and control implementations. `app.steps` adds worker bootsteps; signals expose setup and execution hooks. Keep import-time setup repeatable across worker processes and avoid resolving task proxies before configuration is ready.

For “unregistered task” failures, compare the message's name with the worker's registry, then inspect task imports and application selection. For unexpected settings, inspect the selected configuration source and namespace before changing worker code. Follow [publication and routing](messaging.md) after registration, or [task execution](../workflows/task-execution.md) for request-time behavior.

## Source and focused tests

- [Application construction and configuration](../../celery/app/base.py), especially `_load_config`, `finalize`, and `tasks`.
- [Shared tasks](../../celery/app/__init__.py), [loader imports](../../celery/loaders/base.py), and [current state](../../celery/_state.py).
- [Application tests](../../t/unit/app/test_app.py) cover lazy settings, disabled automatic finalization, discovery, and task construction; [shared-task tests](../../t/unit/app/test_app.py) and neighboring app tests ground application isolation.
