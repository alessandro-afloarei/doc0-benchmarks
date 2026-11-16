---
type: concept
title: Application configuration and task registration
description: Lazy configuration, task decoration and finalization, shared-task binding, loader imports and application extension points.
tags: [application, configuration, registration, loaders]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:34:04.042Z
sources:
  - id: openwiki-source-c7b315432f7d11b299e2a88a
    resource: repo://celery/app/__init__.py
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-ceca684addb7674df2c5c60b
    resource: repo://celery/app/utils.py
  - id: openwiki-source-461899b2d0d382360e23a4f2
    resource: repo://celery/loaders/base.py
generated: { by: "codex", at: "2026-11-16T06:34:04.042Z" }
---

# Application configuration and task registration

A `Celery` instance owns configuration, a registry keyed by task name, factories for runtime services and extension registries. Pass the same application configuration to producers and workers; the worker's registry is populated by imports in its own process.

## Configuration has its own lifecycle

`config_from_object()` records a module or object and normally defers loading until configuration is needed. `force=True` loads it immediately. `config_from_envvar()` treats the named environment variable's value as a configuration module name and raises `ImproperlyConfigured` if it is missing, unless `silent=True`.

During `_load_config()`, the application loads the configured source through its loader, normalizes settings with `detect_settings()`, incorporates pending defaults and periodic tasks, then sends `on_after_configure`. The `namespace` option enables prefixed settings such as Django's `CELERY_` configuration. Avoid mixing legacy and new setting names indiscriminately: normalization validates incompatible mixtures.

Broker and backend URL accessors have explicit environment overrides: `CELERY_BROKER_URL`, `CELERY_BROKER_READ_URL`, `CELERY_BROKER_WRITE_URL` and `CELERY_RESULT_BACKEND`. Check these when a process connects somewhere different from the value in its configuration module.

## Decoration, binding and finalization

`@app.task` can return a lazy `PromiseProxy`. Before finalization, touching its attributes can force task creation early. `_task_from_fun()` derives a name, creates a task class around the function, registers an instance, binds it to the app and installs automatic retry behavior. An existing registered name is reused, making consistent naming part of the task contract.

`finalize()` runs under a mutex, announces app finalization, evaluates pending decorators, binds all registered tasks and emits `on_after_finalize`. Accessing `app.tasks` invokes automatic finalization; with `autofinalize=False`, this access raises until explicit finalization. Use `on_after_finalize` when startup code needs the initialized registry. `on_after_configure` means configuration is ready, which is an earlier and different concern.

`@shared_task` supports reusable libraries without importing a project-specific application. It registers definitions with future apps at finalization and with already-finalized active apps immediately. Its returned proxy resolves the task from the current app's registry, so retaining the proxy does not pin it permanently to the first app.

## Imports determine worker availability

The loader imports built-in modules plus configured `imports` and `include`. Before doing so it sends `signals.import_modules` and re-raises exception responses, allowing startup failures to remain visible. Worker initialization runs this import stage once per loader.

`app.autodiscover_tasks(packages)` normally defers discovery until the import-modules signal. It searches for each package's `tasks` module unless `related_name` is changed; `force=True` runs immediately. With no packages, discovery can delegate to installed fixups, including [Django](../integrations/django.md).

An unregistered task can still be published by name through `send_task()`. This does not import its implementation into a worker: troubleshoot unknown-task failures by checking worker imports, names and deployed code, then follow [publishing and routing](../workflows/publishing.md).

## Extension and verification seams

The constructor accepts custom task, loader, AMQP, event, logging and control classes. `app.steps` extends bootstep lifecycles, while `app.user_options` extends CLI options. Prefer the narrow seam that owns the behavior rather than adding work to unrelated startup signals.

Configuration, finalization, shared-task and discovery cases are exercised in `t/unit/app/test_app.py`. Loader behavior belongs with `t/unit/app/test_loaders.py`. See [development workflows](../testing/development.md) for commands and fixtures.
