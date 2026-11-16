---
type: architecture
title: The Celery Application Object
description: How the Celery app class (celery/app/base.py) holds configuration, lazily loads settings through loaders, registers tasks through decorators and a finalization step, and exposes thread-local "current app" state.
tags: [app, configuration, task-registry, finalize, loaders, state]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:49.645Z
sources:
  - id: openwiki-source-5112943b291f75d67ab0c888
    resource: repo://celery/_state.py
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-868b95b69384872926804a54
    resource: repo://celery/app/builtins.py
  - id: openwiki-source-ceca684addb7674df2c5c60b
    resource: repo://celery/app/utils.py
  - id: openwiki-source-461899b2d0d382360e23a4f2
    resource: repo://celery/loaders/base.py
generated: { by: "claude-code", at: "2026-11-15T17:08:49.645Z" }
---

# The Celery Application Object

`celery.app.base.Celery` is the root object of every Celery program. Producers, workers, beat, and the CLI all start from one app instance. The app owns:

- the **configuration** (`app.conf`, a lazily loaded `Settings` view);
- the **task registry** (`app.tasks`, a `TaskRegistry` dict keyed by task name);
- lazily created **subsystems**: `app.amqp` (messaging), `app.backend` (results), `app.control` (remote control), `app.events`, `app.log`, `app.loader`, plus factory properties such as `app.Worker`, `app.WorkController`, `app.Beat`, `app.AsyncResult`, and `app.GroupResult`;
- **fixups** (by default `celery.fixups.django:fixup`) and **signals** (`on_configure`, `on_after_configure`, `on_after_finalize`, `on_after_fork`).

Subsystem classes are given as `"module:Class"` strings (`amqp_cls`, `events_cls`, `log_cls`, `control_cls`, `task_cls`, `registry_cls`) and can be overridden through constructor arguments or subclass attributes. This is the main seam for replacing whole subsystems.

## Construction

`Celery.__init__` (`celery/app/base.py`) does very little eager work:

1. It records constructor arguments like `broker`, `backend`, `include`, and any extra keyword settings into a **pre-configuration** dict (`_preconf`) instead of applying them directly. Values set this way are tracked in `_preconf_set_by_auto`.
2. It wraps `_preconf` in a `PendingConfiguration` inside a `Settings` object. The first key read triggers `_finalize_pending_conf`, which loads the real configuration.
3. It instantiates fixups (`self._fixups = [symbol_by_name(fixup)(self) ...]`), sets itself as the current app if `set_as_current=True`, creates the app signals, and registers itself in the weak set of active apps (`_register_app`).

The loader class comes from the `CELERY_LOADER` environment variable, the `loader` argument, or the default `celery.loaders.app:AppLoader`. The CLI's `--loader` option sets that environment variable.

## Configuration loading

Configuration is lazy. `config_from_object()` only records the source unless `force=True` or the app is already configured. The first access to `app.conf` (or any key in the pending configuration) runs `_load_config()`:

1. sends `on_configure`;
2. asks the loader to import the configured object or module (`BaseLoader.config_from_object`, which accepts a module path, `module:attr`, or an object);
3. calls `detect_settings()` (`celery/app/utils.py`) to merge loader config, pre-configuration, and defaults into a `Settings` instance;
4. applies pending `add_defaults()` callables and pending `add_periodic_task()` entries;
5. sends `on_after_configure`.

`detect_settings()` accepts either the new lowercase setting names (`result_expires`) or the old uppercase names (`CELERY_TASK_RESULT_EXPIRES`). It picks the format used by most keys and raises `ImproperlyConfigured` with rename suggestions if the two styles are mixed. When a `namespace` is used (for example `namespace='CELERY'` with Django), it always uses the new format with that prefix. If a cached `Settings` already exists, the new settings are swapped into it in place (`swap_with`), so existing references to `app.conf` see the final values. See [Configuration Settings Reference](../reference/configuration.md) for the setting catalog.

Two other entry points are `config_from_envvar()`, which reads a module name from an environment variable, and `config_from_cmdline()`. The `default` loader (`celery/loaders/default.py`) is used by the fallback app and reads `celeryconfig` or the module named in `CELERY_CONFIG_MODULE`.

## Task registration and finalization

`@app.task` (and `@shared_task` in `celery/app/__init__.py`) turns a function into a task **class** and immediately instantiates it:

- `_task_from_fun()` builds a new subclass of `base or app.Task` with `run` set to the function. If `bind=False`, `run` is a `staticmethod`. The method also sets `name` (generated from module and function name when not given), `__header__` (a signature checker used for argument type checking), and any extra options. The task is stored in the registry, bound to the app, and wrapped with autoretry behaviour.
- With the default `pydantic=False`, arguments pass through unchanged. With `pydantic=True`, the function is wrapped so that arguments annotated as Pydantic models are validated and return values are dumped (`pydantic_wrapper`).
- If the app is **not yet finalized**, the decorator returns a `PromiseProxy` (`celery/local.py`) and adds it to `app._pending`. The real task is created only when the proxy is first used or when the app is finalized. With `shared=True` (the default), the decorator also registers a constructor with `connect_on_app_finalize`, so every app that is finalized later gets its own copy of the task.

`finalize()` runs under an `RLock` and is idempotent. It:

1. marks the app finalized;
2. runs every callback registered with `connect_on_app_finalize`, including the built-in tasks in `celery/app/builtins.py` (`celery.backend_cleanup`, `celery.accumulate`, `celery.chord_unlock`, `celery.map`, `celery.starmap`, `celery.chunks`, `celery.group`, `celery.chain`, `celery.chord`) and shared tasks;
3. evaluates all pending task proxies;
4. re-binds every registered task to the app;
5. sends `on_after_finalize`.

Accessing `app.tasks` calls `finalize(auto=True)`. If the app was created with `autofinalize=False`, auto-finalization raises `RuntimeError('Contract breach: app not finalized')`. This catches code that touches tasks before the app is fully set up.

`TaskRegistry` (`celery/app/registry.py`) is a `dict` whose `__missing__` raises `NotRegistered`. `register()` requires a `name` and also applies autoretry behaviour. `app.register_task()` is the compatibility path for class-based tasks.

When the environment variable `FORKED_BY_MULTIPROCESSING` is set (execv-style child processes, for example on Windows), `@app.task` falls back to `shared_task(..., lazy=False)`. Tasks then always resolve from the current app's registry.

## Current app, default app, and proxies

`celery/_state.py` keeps the process-wide and thread-local state:

- `default_app` is a global fallback. If no app was ever created, `_get_current_app()` creates `Celery('default', fixups=[], set_as_current=False, loader=... or 'default')` on demand.
- `_tls.current_app` is per thread. `app.set_current()` sets it, and `app.set_default()` sets the global.
- `current_app` and `current_task` (exported from `celery`) are `Proxy` objects from `celery/local.py` that resolve on every attribute access.
- `connect_on_app_finalize` and `_announce_app_finalized` implement the shared-task and built-in-task mechanism.
- `task_join_will_block` and `_set_task_join_will_block` are used by the worker to forbid blocking `result.get()` inside tasks (see [Results API](../results/result-api.md)).

Calling `celery._state.enable_trace()`, or setting `CELERY_TRACE_APP`, swaps in a tracing `app_or_default()`. It prints a stack whenever code falls back to the current or default app. In the main process it raises `Exception('DEFAULT APP')` when no current app is set. This helps find code that forgot to pass an app.

## Backend and connection access

- `app.backend` is created from `result_backend` through `celery.app.backends.by_url`. Thread-safe backends (`backend.thread_safe`) are cached on the app; others are stored on `app._local`, one instance per thread.
- `app.connection_for_write()` and `app.connection_for_read()` build kombu connections from `broker_write_url` and `broker_read_url` (both default to `broker_url`). `app.pool` is the broker connection pool, and `app.producer_pool` comes from `app.amqp`.
- `app.send_task()` sends a task by name without needing the task's code; `Task.apply_async` uses it internally. See [Task Messages, Protocol and Routing](../tasks/messaging-and-routing.md).
- After a fork, `_after_fork` drops the connection pool and the AMQP producer pool, then sends `on_after_fork`. The hook is registered through `multiprocessing.util.register_after_fork`.

## Autodiscovery

`app.autodiscover_tasks(packages=None, related_name='tasks', force=False)` connects a promise to the `import_modules` signal. Discovery therefore happens when the loader imports default modules (`BaseLoader.import_default_modules`, which runs at worker init). If `packages` is omitted, the packages come from fixups that implement `autodiscover_tasks()`; the Django fixup supplies installed apps. `force=True` imports immediately.

## Pickling

Apps can be pickled to send them to child processes. `__reduce__` stores the class and a dict of keyword arguments built by `__reduce_keys__`. Subclasses that override `__reduce_args__` fall back to the v1 list-based protocol.

## Related tests

- `t/unit/app/test_app.py`: configuration, finalization, autofinalize, pickling, and pydantic tasks.
- `t/unit/app/test_loaders.py` and `t/unit/app/test_registry.py`.

## See also

- [Configuration Settings Reference](../reference/configuration.md)
- [Tasks: Definition, Invocation, Retries](../tasks/task-lifecycle.md)
- [Django Integration and Fixups](../integrations/django.md)
