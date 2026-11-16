---
type: architecture
title: The Celery Application Object
description: How the Celery app (celery.app.base.Celery) is constructed, lazily configured and finalized, how tasks are registered through decorators and shared_task, and how current_app, proxies, loaders and fixups fit together.
tags: [app, configuration, finalization, task-registry, loaders, fixups, proxies]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:05:29.073Z
sources:
  - id: openwiki-source-5112943b291f75d67ab0c888
    resource: repo://celery/_state.py
  - id: openwiki-source-c7b315432f7d11b299e2a88a
    resource: repo://celery/app/__init__.py
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-13b5c49e893fd28fca034cee
    resource: repo://celery/utils/imports.py
generated: { by: "claude-code", at: "2026-11-16T17:05:29.073Z" }
---

# The Celery Application Object

Every Celery interaction — defining tasks, publishing messages, running a worker or beat — goes through an instance of `celery.app.base.Celery` (exported as `celery.Celery`). The app is a mostly-lazy container: it holds configuration, a task registry, and factories for the subsystems (AMQP, backend, events, control, logging, loader), but defers almost all real work until a value is first needed.

## Responsibilities

- **Configuration holder** — `app.conf`, a `Settings` view assembled from constructor arguments, a config source, loader-provided config and defaults (see [Configuration System](configuration.md)).
- **Task registry** — `app.tasks`, a `TaskRegistry` (a `dict` subclass whose `__missing__` raises `NotRegistered`).
- **Subsystem factory** — lazy attributes `amqp`, `backend`, `events`, `control`, `loader`, `log`, plus class factories such as `app.Worker`, `app.WorkController`, `app.Beat`, `app.Task`, `app.AsyncResult`, `app.GroupResult`.
- **Connection/producer access** — `connection_for_read()`, `connection_for_write()`, `producer_or_acquire()`, and `app.pool` (a kombu connection pool, reset after fork).
- **Publishing entry point** — `send_task()`, used by `Task.apply_async()` (see [Task Definition and Invocation](../tasks/task-definition-and-invocation.md)).

## Construction

`Celery.__init__` (`celery/app/base.py`) mostly records intent instead of acting:

- Class paths for subsystems (`amqp_cls`, `events_cls`, `log_cls`, `control_cls`, `task_cls`, `registry_cls`) are stored as strings and only instantiated on first access through `cached_property`/`instantiate`.
- The loader class defaults to `$CELERY_LOADER`, then the class's `loader_cls`, then `celery.loaders.app:AppLoader`.
- Convenience keyword arguments (`broker`, `backend`, `include`, and any extra `**kwargs`) are written into a "preconf" dict (`_preconf`) as `broker_url`, `result_backend`, etc. These are treated as highest-priority configuration.
- `_conf` starts as a `Settings` wrapping a `PendingConfiguration`. Reading any key from it triggers `_finalize_pending_conf()`, which runs `_load_config()`; writes before that point go only into preconf.
- Fixups are instantiated immediately: by default `BUILTIN_FIXUPS = {'celery.fixups.django:fixup'}`; passing `fixups=` overrides the set.
- Unless `set_as_current=False`, the new app becomes the thread's current app, and it is registered in a weak set of active apps (`_register_app`).
- Four app-level signals are created: `on_configure`, `on_after_configure`, `on_after_finalize`, `on_after_fork`.

The app can be used as a context manager; `close()` drops the connection pool and deregisters the app.

## Lazy configuration

`_load_config()` is the single place configuration is materialised:

1. Send `on_configure`.
2. If a config source was set (via `config_from_object`/`config_from_envvar`), ask the loader to import it.
3. Run `detect_settings()` to merge loader config with preconf (detecting old UPPERCASE vs new lowercase setting names, and honouring `namespace`).
4. If a `Settings` object already exists, swap contents in place (so references to `app.conf` stay valid).
5. Apply queued `add_defaults()` callables and pending `add_periodic_task()` registrations.
6. Send `on_after_configure` with the finished settings.

`config_from_object(obj)` only stores the source unless the app is already configured or `force=True`; in that case configuration is re-read immediately. `config_from_envvar(name)` resolves a module name from the environment and raises `ImproperlyConfigured` if missing (unless `silent`).

## Task registration and finalization

`@app.task` builds a task *class* from a function in `_task_from_fun()`: it generates a subclass of `app.Task` (or a `base=` class) with `run` set to the function (wrapped in `staticmethod` unless `bind=True`), registers an instance in `app._tasks`, binds it to the app, and applies autoretry behaviour. If a task with that name already exists, the existing instance is returned.

The decorator is lazy by default. If the app is not yet finalized, it returns a `PromiseProxy` and appends it to `app._pending`; the real task object is created on first use or at finalize time. With `shared=True` (the default) it also registers a constructor via `connect_on_app_finalize`, so **every** app that finalizes later will get a copy of the task.

`celery.shared_task` (in `celery/app/__init__.py`) takes this further for library code: it registers the constructor for future apps, eagerly adds the task to all already-finalized active apps, and returns a `Proxy` that always resolves the task from `current_app.tasks`.

`finalize()` is guarded by `_finalize_mutex` and runs once:

1. Mark `finalized = True` and run all callbacks registered with `connect_on_app_finalize` (built-in tasks from `celery/app/builtins.py` and shared tasks).
2. Evaluate every pending `PromiseProxy`.
3. Re-bind every registered task to the app.
4. Send `on_after_finalize`.

Accessing `app.tasks` auto-finalizes the app. With `autofinalize=False`, auto-finalization (and creating tasks before an explicit `finalize()`) raises `RuntimeError('Contract breach: app not finalized')`.

Task names default to `module.function` via `celery.utils.imports.gen_task_name`; when the module is `__main__` and the app has a `main` name, `main` replaces `__main__` so worker and client agree on names.

`autodiscover_tasks(packages, related_name='tasks')` is lazy unless `force=True`: it connects to the `import_modules` signal, which the loader fires from `import_default_modules()` at worker start. With no packages, the list comes from fixups (e.g. Django `INSTALLED_APPS`).

## Current app, default app and proxies

`celery/_state.py` tracks global state:

- `default_app` — a process-wide fallback. If nothing set it, `get_current_app()` lazily creates a `Celery('default', fixups=[], set_as_current=False)` using the `default` loader.
- `_tls.current_app` — the thread-local current app, set by `app.set_current()` (called from `__init__` by default). `get_current_app()` returns the thread-local app, else the default.
- `current_app` / `current_task` — `celery.local.Proxy` objects that re-resolve on every attribute access.
- A task stack (`_task_stack`) used by `current_task` and `get_current_worker_task()`; the latter skips tasks invoked directly (`called_directly`).
- `C_STRICT_APP` / `C_WARN_APP` environment variables make `get_current_app()` raise or print a traceback, useful for finding code that implicitly depends on the current app.

`celery/local.py` provides `Proxy` (forwarding nearly all dunder operations to `_get_current_object()`) and `PromiseProxy` (evaluates once, caches the result, and can queue `__then__` callbacks until evaluation).

## Backend, pool and fork safety

`app.backend` is built from `conf.result_backend` by `celery.app.backends.by_url`. Backends that declare `thread_safe = True` are cached on the app; otherwise one instance is stored per thread in `app._local` (see [Result Backends](../results/backends.md)).

`_after_fork()` clears the connection pool and the AMQP producer pool and sends `on_after_fork`; it is registered with `multiprocessing.register_after_fork` on first pool use so forked pool children never reuse parent sockets.

## Loaders

Loaders (`celery/loaders/`) decide how configuration is imported and hook worker lifecycle:

| Alias | Class | Used by |
|-------|-------|---------|
| `app` | `celery.loaders.app:AppLoader` | Any explicitly created app (default) |
| `default` | `celery.loaders.default:Loader` | The implicit fallback app; reads `celeryconfig` (or `$CELERY_CONFIG_MODULE`) |

`BaseLoader` implements `config_from_object` (importing from the current working directory for string paths), `init_worker()` (imports default modules once, firing `import_modules` so autodiscovery runs), `on_task_init`, `on_process_cleanup` and `on_worker_process_init` hooks.

## Fixups

A fixup is a callable `fixup(app)` that may return an object adjusting app behaviour. The Django fixup activates only when `DJANGO_SETTINGS_MODULE` is set and the loader is not Django-specific; it then sets the app as default, adjusts `sys.path`, and installs worker hooks for DB connection hygiene. Fixups can also contribute packages to `autodiscover_tasks()`. Details are in [Django Integration](../integrations/django.md).

## Pickling

Apps are pickled (e.g. when sent to pool processes using spawn/execv) by reducing to constructor keyword arguments via `AppPickler` in `celery/app/utils.py`, with `__reduce_keys__` capturing `main`, `changes` (the configured changes, or preconf if not yet configured), the `config_source`, fixups, namespace and the subsystem class paths. Defaults added with `add_defaults()` are *not* transferred, so they must be re-applied at import time in the child.

## Tests

- `t/unit/app/test_app.py` — construction, configuration loading, finalization, task decorator semantics.
- `t/unit/app/test_loaders.py`, `t/unit/app/test_registry.py`, `t/unit/fixups/test_django.py`.

## Related

- [System Architecture Overview](overview.md)
- [Configuration System](configuration.md)
- [Django Integration](../integrations/django.md)
