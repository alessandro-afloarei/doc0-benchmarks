---
type: architecture
title: Application lifecycle and configuration
description: How Celery applications load configuration, register tasks lazily, discover modules, and bind task behavior to an application.
tags: [application, configuration, registry, lifecycle]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:55:28.912Z
sources:
  - id: openwiki-source-c7b315432f7d11b299e2a88a
    resource: repo://celery/app/__init__.py
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-3795aa577fa7b0f3bd2af81a
    resource: repo://celery/app/task.py
  - id: openwiki-source-ceca684addb7674df2c5c60b
    resource: repo://celery/app/utils.py
  - id: openwiki-source-461899b2d0d382360e23a4f2
    resource: repo://celery/loaders/base.py
generated: { by: "codex", at: "2026-11-16T07:55:28.912Z" }
---

# Application lifecycle and configuration

The `Celery` application is the configuration and service boundary used by producers and workers. Its task registry maps message task names to local task implementations. Loading the same application and task modules on workers is therefore part of the execution contract; publishing a name does not ship Python code.

## Lazy setup and finalization

`@app.task` normally returns a promise until the task is first used or the application is finalized. `finalize()` announces application finalization, evaluates pending decorators, binds every registered task, and sends `on_after_finalize`. Accessing `app.tasks` automatically finalizes; with `autofinalize=False`, callers must explicitly finalize before operations that require it. Avoid inspecting a lazy task's attributes during incomplete application setup.

Task binding fills unset task attributes from application configuration, clears cached execution options, installs annotations and the request stack on first binding, and calls `on_bound`. Explicit task options take precedence over these defaults. In this checkout, unset `acks_on_failure` and `acks_on_timeout` fall back to `acks_on_failure_or_timeout`, then to true.

`shared_task` supports reusable libraries without importing a particular project application. It registers a finalization callback for future applications, registers with already finalized active applications, and returns a proxy that resolves through the current application's task registry. Explicit application references are useful where multiple apps coexist.

## Configuration lifecycle

`config_from_object()` accepts a module name or object and normally defers reading until configuration is needed. `force=True` loads immediately. `config_from_envvar()` treats the variable's value as a configuration module name; a missing variable raises `ImproperlyConfigured` unless silent mode is requested.

During `_load_config`, Celery loads the configured source through the loader, combines preconfiguration with defaults, drains pending default providers and periodic-task registrations, and emits `on_after_configure`. Existing references to the settings object are updated in place.

Use modern names such as `broker_url` and `task_serializer`. A namespace such as `CELERY` allows keys such as `CELERY_TASK_ALWAYS_EAGER`. Compatibility handling recognizes older names but rejects unsupported mixtures of old and new keys with renaming guidance. Namespace handling and legacy compatibility are separate concerns; see [the settings implementation](../../celery/app/utils.py).

## Discovery and extension points

`autodiscover_tasks(packages)` searches for each package's `tasks` module by default. Discovery is attached to the import-modules signal unless forced. Omitting packages delegates discovery to installed fixups, including [Django](../integrations/django.md). A missing candidate task module is allowed; a missing dependency imported inside that module is propagated rather than silently ignored.

The loader imports default modules before worker initialization and re-raises import-signal errors. Custom Task classes, loaders, application signals, and fixups are extension seams with different lifetimes: a Task supplies execution hooks, while the loader and fixups prepare the process environment.

## Where to verify changes

- [Application tests](../../t/unit/app/test_app.py) exercise lazy decorators, disabled autofinalization, configuration loading, namespaces, and discovery.
- [Task implementation](../../celery/app/task.py) owns binding defaults and request context.
- [Loader implementation](../../celery/loaders/base.py) distinguishes missing task modules from broken nested imports.

Continue with [task publishing](../workflows/task-delivery.md) for execution options and [serialization security](../operations/security.md) for configuration that changes the trust boundary.
