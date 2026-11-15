---
type: architecture
title: Application Object and Configuration
description: How the Celery application object (celery.app.base.Celery) lazily loads configuration, finalizes its task registry, tracks the current/default app, delegates to loaders, and is pickled across processes.
tags: [app, configuration, loaders, finalization, settings]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T09:27:53.075Z
sources:
  - id: openwiki-source-5112943b291f75d67ab0c888
    resource: repo://celery/_state.py
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-ceca684addb7674df2c5c60b
    resource: repo://celery/app/utils.py
  - id: openwiki-source-461899b2d0d382360e23a4f2
    resource: repo://celery/loaders/base.py
  - id: openwiki-source-95f666732d41b3d73d797847
    resource: repo://celery/loaders/default.py
generated: { by: "claude-code", at: "2026-11-15T09:27:53.075Z" }
---

# Application Object and Configuration

The `Celery` class in `celery/app/base.py` is the root object of every Celery program. Clients, workers, beat and the CLI all hold a reference to one app instance, and nearly every other subsystem (`amqp`, `backend`, `control`, `events`, `loader`, `log`, task registry) is reached through lazily created attributes on it. `celery.Celery` is re-exported from `celery/__init__.py`, and `App = Celery` is kept as a compatibility alias.

## Construction is cheap and lazy

`Celery.__init__` does very little real work:

- It records class *names* (strings such as `'celery.app.amqp:AMQP'`) for the pluggable components: `amqp_cls`, `events_cls`, `log_cls`, `control_cls`, `task_cls`, `registry_cls`, and `loader_cls`. These are only instantiated on first access through `cached_property` accessors (`app.amqp`, `app.control`, `app.events`, `app.loader`, `app.log`).
- Constructor shortcuts such as `broker=`, `backend=`, `include=` and arbitrary extra keyword arguments are stored in a "pre-configuration" dict (`_preconf`) via `__autoset`, and the keys are remembered in `_preconf_set_by_auto` so they don't trip the old/new setting-name detection.
- `app.conf` starts as a `Settings` wrapping a `PendingConfiguration`. Writes to `app.conf` before configuration is loaded go straight into `_preconf`; **the first read of a key** triggers `_finalize_pending_conf()` which runs `_load_config()`.
- Fixups are instantiated immediately (`BUILTIN_FIXUPS` contains only `celery.fixups.django:fixup`, which is a no-op unless Django is configured — see [Django Integration](../integrations/django.md)).
- The app registers itself in a global `WeakSet` of apps and, unless `set_as_current=False`, becomes the thread's current app.
- App-level signals are created per instance: `on_configure`, `on_after_configure`, `on_after_finalize`, `on_after_fork`.

## Configuration loading

`_load_config()` performs the real configuration step:

1. Sends `on_configure`.
2. If a config source was given (`config_from_object`, or `config_source=`), asks the loader to import it (`BaseLoader.config_from_object`). Strings are imported relative to the current working directory; `'module:attr'` and `'module.attr'` forms are both accepted by `_smart_import`.
3. Calls `detect_settings()` (in `celery/app/utils.py`) which decides whether the user is using **new lowercase names** (`task_serializer`) or **old uppercase names** (`CELERY_TASK_SERIALIZER`). If a majority of keys use one style, mixing in the other raises `ImproperlyConfigured` listing the required renames. When a `namespace` is set (e.g. `namespace='CELERY'` for Django-style settings), the new format is always assumed.
4. Builds a `Settings` object (a `ConfigurationView` chain): pre-configuration changes first, then the loaded config, then a deep copy of the defaults. If `app.conf` had already been referenced, the result is swapped *in place* (`swap_with`) so existing references stay valid.
5. Applies lazily registered defaults (`add_defaults`) and periodic tasks queued by `add_periodic_task` before configuration.
6. Sends `on_after_configure`.

Calling `config_from_object()` before configuration is loaded only records the source; afterwards (or with `force=True`) it resets `_conf` and reloads immediately. `config_from_envvar()` reads the module name from an environment variable and raises `ImproperlyConfigured` if it is unset (unless `silent`). `config_from_cmdline()` parses `key=value` arguments using the typed option table.

### Settings namespace and defaults

`celery/app/defaults.py` declares every setting as an `Option(default, type=...)` inside nested `Namespace(...)` dicts (`beat`, `broker`, `result`, `task`, `worker`, `security`, ...). `flatten()` turns these into the flat lowercase keys (`broker_connection_retry`, `worker_prefetch_multiplier`, ...) used throughout the code, and also derives the old-style uppercase aliases (`CELERY_`, `CELERYD_`, `CELERYBEAT_` prefixes). `DEFAULTS`, `SETTING_KEYS`, `_TO_NEW_KEY` and `_TO_OLD_KEY` are computed once at import.

`Settings` adds environment-variable overrides on top of normal lookup:

| Property | Override order |
| --- | --- |
| `broker_url` | `CELERY_BROKER_URL` env → `broker_url` → `broker_host` |
| `broker_read_url` / `broker_write_url` | `CELERY_BROKER_READ_URL` / `CELERY_BROKER_WRITE_URL` env → setting → `broker_url` |
| `result_backend` | `CELERY_RESULT_BACKEND` env → setting |
| `timezone` | `timezone` → Django-style `TIME_ZONE` |

`Settings.table()/humanize()` and `filter_hidden_settings()` censor keys matching `API|TOKEN|KEY|SECRET|PASS|...` — this is what `celery report` and `app.bugreport()` print.

## Loaders

Loaders (`celery/loaders/`) are the hook layer between the app and the environment:

- `AppLoader` (`'app'`) — used by explicitly created apps; reads no config file by itself.
- `Loader` (`'default'`) — used by the implicit fallback app; reads the module named by `CELERY_CONFIG_MODULE` (default `celeryconfig`).
- The loader class can be forced with the `CELERY_LOADER` environment variable (set by the `--loader` CLI option).

`BaseLoader` also owns worker lifecycle hooks (`init_worker`, `on_worker_init`, `init_worker_process`, `on_task_init`, `on_process_cleanup`) and module importing. `import_default_modules()` first sends the `import_modules` signal (which is how lazy `autodiscover_tasks()` registrations run) and re-raises any exception returned by a receiver, then imports `imports` and `include` modules.

`app.autodiscover_tasks(packages, related_name='tasks')` is lazy by default: it connects to `import_modules` and only imports `<package>.tasks` when the worker imports default modules. If `packages` is empty, packages are taken from fixups (Django's installed apps).

## Finalization and the task registry

Task decorators on an unfinalized app return a `PromiseProxy` that is appended to `app._pending`. `finalize()` (guarded by an `RLock`):

1. Marks the app finalized and calls every callback registered with `connect_on_app_finalize` — this is how `@shared_task` tasks and built-in tasks (`celery/app/builtins.py`) are created on every app.
2. Evaluates all pending task proxies.
3. Re-binds every registered task to this app.
4. Sends `on_after_finalize`.

Accessing `app.tasks` auto-finalizes. With `autofinalize=False`, auto-finalization (and creating tasks before finalization) raises `RuntimeError('Contract breach: app not finalized')`. Task creation details are covered in [Tasks, Task Registry and Retries](tasks-and-registry.md).

## Current app, default app and current task

`celery/_state.py` holds process-global state:

- `default_app` — lazily created fallback `Celery('default', loader='default', fixups=[], set_as_current=False)` used when no app was made current.
- A thread-local `current_app`; `get_current_app()` returns it or the default app. `current_app` and `current_task` are `celery.local.Proxy` objects that resolve on each access.
- A `LocalStack` of executing tasks; `push_current_task`/`pop_current_task` are used by the tracer. `get_current_worker_task()` walks the stack for the first task not `called_directly`.
- `_task_join_will_block` — a flag the worker sets so `AsyncResult.get()` inside a task can detect a potential deadlock (see [Result Objects](../results/result-objects.md)).
- Debug env vars: `C_STRICT_APP` makes any use of the current app raise; `C_WARN_APP` prints a stack trace on each use.

## Backend instance and thread safety

`app.backend` builds the result backend from `backend_cls` or `conf.result_backend` via `celery.app.backends.by_url`. If the backend class declares `thread_safe = True` it is cached on the app; otherwise one instance is kept per thread in `app._local`. See [Result Backends](../results/result-backends.md).

## Pickling and fork behaviour

Apps are pickled when passed to child processes. `__reduce__` returns `_unpickle_app_v2` with `__reduce_keys__()`: the main name, *only the configuration changes* (`_conf.changes` or the pre-configuration), the component class names, fixups, config source, `task_cls` and namespace. The unpickled app is created with `set_as_current=False`. Classes overriding the legacy `__reduce_args__` fall back to the v1 `AppPickler` protocol.

After fork, `_after_fork` drops the connection pool and the AMQP producer pool and sends `on_after_fork` (registered through `multiprocessing.util.register_after_fork` when available).

`subclass_with_self()` produces app-bound subclasses (e.g. `app.Worker`, `app.WorkController`, `app.Beat`, `app.AsyncResult`, `app.Task`) whose `app` class attribute points at this instance and whose pickling resolves back through the app.

## Running programs from the app

- `app.start(argv)` runs the click-based `celery` command with this app pre-selected.
- `app.worker_main(argv)` is the same, but requires `'worker'` in argv.

See [Command-Line Interface](../cli/command-line.md).

## Related tests

- `t/unit/app/test_app.py` — configuration laziness, finalization, pickling, `autofinalize`.
- `t/unit/app/test_loaders.py`, `t/unit/app/test_defaults.py`, `t/unit/app/test_utils.py`.
