---
type: architecture
title: Celery App, Configuration and Task Registry
description: How the Celery application object is constructed, how configuration is lazily loaded and merged with defaults, how tasks are registered and bound at finalization, and how current-app state is tracked.
tags: [celery, app, configuration, task-registry, finalization, loaders]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:56:17.091Z
sources:
  - id: openwiki-source-5112943b291f75d67ab0c888
    resource: repo://celery/_state.py
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-ceca684addb7674df2c5c60b
    resource: repo://celery/app/utils.py
generated: { by: "claude-code", at: "2026-11-16T17:56:17.091Z" }
---

# Celery App, Configuration and Task Registry

The `Celery` class in `celery/app/base.py` is the root object of the library. Almost every other subsystem (AMQP publishing, result backends, control, events, logging, the worker) is reached through an app instance and instantiated lazily from it. This page covers what the app owns, how it is configured, and how tasks get attached to it.

## What the app owns

`Celery.__init__` (`celery/app/base.py`) wires up:

- **Pluggable class names** such as `amqp_cls`, `events_cls`, `log_cls`, `control_cls`, `loader_cls` and `registry_cls`. They are resolved lazily, so a subclass can swap them out.
- **Constructor arguments** such as `broker`, `backend` and `include`, plus arbitrary keyword settings. These are stashed in `_preconf` through `__autoset` and tracked in `_preconf_set_by_auto`. They are treated as overrides on top of loaded configuration.
- **A task registry** (`TaskRegistry`, a `dict` subclass in `celery/app/registry.py`) that raises `NotRegistered` on a missing key.
- **Fixups**, framework hooks such as Django, instantiated with the app (see [Django integration and contrib](../integrations/django-and-contrib.md)).
- **Lifecycle signals**: `on_configure`, `on_after_configure`, `on_after_finalize` and `on_after_fork`.
- A Lamport clock, thread-local storage, and a re-entrant finalize mutex.

Subsystems are exposed as lazy properties. `app.amqp`, `app.control`, `app.events`, `app.loader` and `app.log` are `cached_property`s that instantiate the configured class. `app.backend` builds its backend on first use through `backends.by_url`, and `app.tasks` auto-finalizes the app before returning the registry.

The backend instance is cached per thread unless the backend declares `thread_safe`. See the `_backend` property and its setter in `celery/app/base.py`.

## Lazy configuration

Configuration is deliberately not read at construction time.

1. `app.conf` starts as a `Settings` wrapping a `PendingConfiguration` (`celery/app/base.py`). Writes such as `app.conf.update(...)` go straight into the pre-configuration dict. Reading any key calls `_finalize_pending_conf`, which loads the real configuration.
2. `_load_config` runs the `on_configure` signal and applies any `config_source` through the loader. It then sets `configured = True` and calls `detect_settings` to merge loader config, constructor overrides and defaults.
3. It then evaluates deferred `add_defaults` callables and deferred periodic tasks registered with `add_periodic_task`, and finally fires `on_after_configure`.
4. If a `Settings` object was already handed out, it is swapped in place (`swap_with`) so earlier references to `app.conf` stay valid.

`config_from_object`, `config_from_envvar` and `config_from_cmdline` only record the source. They read it immediately only when `force=True` or the app is already configured.

### Defaults and old/new key names

`celery/app/defaults.py` declares every setting as an `Option(default, type=..., old=...)` inside nested `Namespace`s (for example `beat`, `worker` and `task`). Each option carries its legacy `CELERY_*`, `CELERYD_*` and `CELERYBEAT_*` aliases.

`detect_settings` (`celery/app/utils.py`) decides whether the user's configuration uses the new lowercase names or the old uppercase names. It picks the majority style, and it raises `ImproperlyConfigured` with rename suggestions when the two styles are mixed. When a `namespace` prefix is used, the new format is always assumed.

`Settings` also provides derived accessors (`broker_url`, `broker_read_url`, `broker_write_url`, `result_backend`, `task_default_exchange`), a censoring `humanize`/`table` for display, and `find_option`.

## Task registration and finalization

`@app.task` (`Celery.task`) is the central decorator:

- With `shared=True` (the default) it also registers a constructor with `connect_on_app_finalize` (`celery/_state.py`). The same function therefore becomes a task on every app that is finalized, which is how `@shared_task` works.
- With `lazy=True` (the default) and a non-finalized app, it returns a `PromiseProxy` and appends it to `app._pending`. The real task class is only created on first use. Otherwise `_task_from_fun` builds it immediately.
- `_task_from_fun` creates a new `Task` subclass with `run` set to the function, and optional pydantic validation through `pydantic_wrapper`. It then registers the instance in `app._tasks`, calls `task.bind(self)`, and adds autoretry behaviour from the options. Task names default to `gen_task_name(module, function)`.
- Old class-based tasks use `register_task`.

`Celery.finalize` (`celery/app/base.py`), under the mutex, does the following in order:

1. It sets `finalized`.
2. It announces the app to all `_on_app_finalizers`. This is where built-in tasks (`celery/app/builtins.py`) and shared tasks get created for the app.
3. It evaluates pending task proxies.
4. It rebinds all tasks.
5. It sends `on_after_finalize`.

With `autofinalize=False`, accessing tasks before an explicit `finalize()` raises `RuntimeError('Contract breach: app not finalized')`.

## Current app and task state

`celery/_state.py` holds process-global and thread-local state:

- `_tls.current_app` is the last app created with `set_as_current=True` in this thread. `default_app` is a process-wide fallback. If neither exists, `_get_current_app` lazily creates a bare `default` app.
- `current_app` and `current_task` are `Proxy` objects resolved at access time (`celery/local.py`).
- `_task_stack` is a `LocalStack` of running tasks. `get_current_worker_task` walks it for the nearest task that was not `called_directly`.
- The `C_STRICT_APP`, `C_WARN_APP` and `CELERY_TRACE_APP` environment variables switch on diagnostics for accidental use of the implicit current app.

The app is picklable through `__reduce__` and `AppPickler`, which is how it travels to pool child processes. `_after_fork` resets the producer pool and `app.pool`, and then emits `on_after_fork`.

## Loaders

A loader (`celery/loaders/base.py`, with `AppLoader` as the default and a plain `default` loader) abstracts configuration import and worker lifecycle hooks:

- `config_from_object`, `import_default_modules` (which imports `imports` and `include` modules after dispatching the `import_modules` signal), and `autodiscover_tasks`.
- Worker and task hooks: `init_worker`, `on_task_init`, `on_process_cleanup` and `shutdown_worker`.

Loader selection can be overridden with the `CELERY_LOADER` environment variable.

## Where to go next

- Publishing a task from the app: [Task publishing](../workflows/task-publishing.md).
- How the worker uses the app: [Worker and consumer](worker-and-consumer.md).
- Backend selection through `app.backend`: [Result backends](result-backends.md).
- Signing and serializer restrictions via `app.setup_security`: [Message security](../operations/message-security.md).
