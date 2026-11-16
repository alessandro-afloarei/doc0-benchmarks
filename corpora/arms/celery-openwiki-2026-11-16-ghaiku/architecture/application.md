---
type: architecture
title: Celery Application
description: How the Celery app object loads configuration, defers task registration until finalization, resolves its loader, and builds its AMQP routing and task registry.
tags: [celery, app, configuration, loader, registry, amqp, routing]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:42:35.525Z
sources:
  - id: openwiki-source-5a0b6982dd7ddb0fabfabd0c
    resource: repo://celery/app/amqp.py
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-eee674a48f00d180319d175e
    resource: repo://celery/app/registry.py
  - id: openwiki-source-51bdc9f790e9afc683dd8164
    resource: repo://celery/app/routes.py
  - id: openwiki-source-22fdaa8d5ef2592e74f90808
    resource: repo://celery/loaders/__init__.py
  - id: openwiki-source-4a74724fd0043fb3763dcbaf
    resource: repo://celery/utils/collections.py
generated: { by: "claude-code", at: "2026-11-16T10:42:35.525Z" }
---

# Celery Application

The `Celery` class in `celery/app/base.py` is the central object of the library. Every producer, worker, and beat process works through an app instance. The app owns configuration, the task registry, the AMQP (broker messaging) component, the result backend, the log and control helpers, and the loader that binds those together to a concrete environment.

## Responsibility and ownership

The app is a composition root. It does not implement messaging, execution, or storage itself. It holds lazily-constructed components:

- `app.amqp` — built from `amqp_cls` (default `celery.app.amqp:AMQP`). It owns queues, routers, the producer pool, and task message construction.
- `app.backend` — the result backend, selected from the `result_backend` setting (see [result backends](result-backends.md)).
- `app.loader` — built from `loader_cls` (see below).
- `app.log`, `app.control`, `app.events` — instantiated from their respective `*_cls` class attributes.
- `app.tasks` — the `TaskRegistry` (`celery/app/registry.py`), a `dict` subclass keyed by task name.

Each of these is a `cached_property` or property, so construction happens on first access, not at `Celery(...)` time.

## Construction and the loader

`Celery.__init__` records the constructor arguments, sets `self.loader_cls`, and creates the registry and a `deque` named `_pending` used for deferred task decorators. Loader resolution is performed by `_get_default_loader`, which checks, in order:

1. the `CELERY_LOADER` environment variable (the `--loader` CLI flag sets it);
2. the `loader` constructor argument or the `loader_cls` class attribute;
3. the fallback `celery.loaders.app:AppLoader`.

`celery/loaders/__init__.py` defines two aliases, `app` (`AppLoader`) and `default` (`Loader`), and resolves other values as dotted paths through `symbol_by_name`. The loader decides how configuration modules are read, what runs on worker init and shutdown, and how modules are imported for task discovery. `AppLoader` is the normal choice when the application is itself the configuration source; `Loader` reads a settings module, as the older Django-style setup did.

## Configuration: lazy read and finalize

Configuration is not read when `Celery(...)` is called. The sequence is:

1. `config_from_object(obj)` stores the source in `_config_source` and returns. If the config was already loaded and `force=True` is passed, the cached `_conf` is discarded and reloaded immediately.
2. On first access to `app.conf`, `_load_config` runs. It fires the `on_configure` signal, feeds the source through `self.loader.config_from_object`, runs `prepare_config`, and calls `detect_settings`, which merges the loader's values with preconfigured keys and the app's namespace prefix. The result replaces `_conf` in place via `swap_with`, so references to `app.conf` obtained earlier keep seeing the current values.
3. Deferred `add_defaults` callables and lazy periodic-task definitions are then drained from their pending queues.

`add_defaults` and `config_from_envvar` follow the same deferred pattern: they register a source and let the configuration be materialized on demand.

## Task registration and finalization

The `@app.task` decorator (`Celery.task`, `celery/app/base.py` around lines 515–575) does not always build a task class immediately:

- If the app is not yet finalized and `lazy=True` (the default), the decorator returns a `PromiseProxy` around `_task_from_fun` and appends it to `_pending`.
- If the app is already finalized, or `lazy=False`, `_task_from_fun` runs at once.
- Shared tasks (`@shared_task`) are registered via `connect_on_app_finalize`, so they are instantiated for each app that finalizes.

`finalize()` (around lines 657–676) is the explicit barrier. It sets `finalized = True`, announces the app, evaluates every pending proxy, binds each registered task to the app, and sends `on_after_finalize`. Accessing `app.tasks` auto-finalizes the app. Passing `autofinalize=False` makes the app raise `RuntimeError` if registry or task access happens before explicit finalization, which is useful for catching import-order mistakes.

`register_task` and `TaskRegistry.register` enforce that a task class has a non-empty `name`; the registry raises when a class lacks one. `TaskRegistry` also offers `regular()` and `periodic()` filters used by the worker and beat.

## AMQP and routing

`app.amqp` builds queues and routing from configuration:

- `AMQP.Queues` materializes `task_queues` into a `Queues` mapping. Missing queues can be created on demand; the `create_missing` argument defaults to the `task_create_missing_queues` setting, and `create_missing_queue_type` selects the type of created queues.
- `AMQP.Router` (around lines 308–311 of `celery/app/amqp.py`) combines `app.conf.task_routes`, the queues, and the default exchange into a `celery.app.routes.Router`.
- `flush_routes` (around lines 314–315) recompiles the route table from `task_routes`. It is triggered when `task_routes` changes at runtime through the config update handler (`_handle_conf_update`, around lines 659–662).

`celery/app/routes.py` defines `MapRoute` for name-based lookup and `Router.route`, which resolves a task name, arguments, and options into a destination. The route's values are merged with the call's options via `lpmerge(route, options)`, so explicit call options overwrite route values; `task_default_queue` is applied only when no queue has been determined.

## Relationships

- Upstream: the CLI (`celery/bin/*`) and user code create the app and call `config_from_object`, `autodiscover_tasks`, and `@app.task`.
- Downstream: `app.amqp` is used by `Task.apply_async` and the worker's consumer; `app.backend` is used by `AsyncResult` and by the tracer ([tasks and tracing](tasks-and-tracing.md)).
- Configuration keys and their defaults live in `celery/app/defaults.py`; security-relevant settings are covered in [configuration and security](../operations/configuration-and-security.md).

## Invariants and failure behaviour

- Configuration is read at most once per materialization; code that mutates `app.conf` after reading keeps working because `_conf` is swapped in place rather than replaced.
- Pending task proxies are evaluated exactly once, during finalization. A task defined after finalization is built immediately.
- An unresolvable loader name fails at first access of `app.loader`, not at construction, so misconfigured `CELERY_LOADER` values surface during startup.
- When `autofinalize=False`, premature access to the registry raises instead of silently finalizing.

## Extension seams

Subclassing `Celery` and overriding the `*_cls` attributes (`amqp_cls`, `backend_cls`, `loader_cls`, `log_cls`, `control_cls`, `task_cls`, `registry_cls`) replaces the corresponding component. The constructor also accepts `fixups` (for example the Django fixup in [Django integration](../integrations/django.md)) and `config_source`.

## Representative tests

- `t/unit/app/` covers the app object, registry, routes, and AMQP queue handling.
- `t/integration/test_loader.py` exercises loader behaviour against a real configuration.
