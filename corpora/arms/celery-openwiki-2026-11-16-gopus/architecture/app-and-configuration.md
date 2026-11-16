---
type: architecture
title: Celery App, Configuration and Loaders
description: How the Celery application object is constructed, lazily configured and finalized; how current_app, shared tasks, the task registry, loaders, configuration namespaces and fixups fit together.
tags: [app, configuration, loaders, registry, finalization, proxies]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:57:55.789Z
sources:
  - id: openwiki-source-5112943b291f75d67ab0c888
    resource: repo://celery/_state.py
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-868b95b69384872926804a54
    resource: repo://celery/app/builtins.py
  - id: openwiki-source-ceca684addb7674df2c5c60b
    resource: repo://celery/app/utils.py
  - id: openwiki-source-95f666732d41b3d73d797847
    resource: repo://celery/loaders/default.py
generated: { by: "claude-code", at: "2026-11-16T06:57:55.789Z" }
---

# Celery App, Configuration and Loaders

The `Celery` class in `celery/app/base.py` is the root object of every Celery
program. Clients use it to define tasks and publish messages; the worker, beat
and CLI all receive an app instance and reach every subsystem through it. The
app is deliberately **lazy**: almost nothing (configuration, task creation,
backend, broker connections) is materialised until first use.

## Construction

`Celery.__init__` (`celery/app/base.py`, around L343–L434) mainly records
*class paths* and pre-configuration rather than doing work:

- Subsystem classes are stored as strings and instantiated on demand:
  `amqp_cls = 'celery.app.amqp:AMQP'`, `events_cls`, `log_cls`,
  `control_cls`, `task_cls = 'celery.app.task:Task'`, `registry_cls`. Passing
  `amqp=`, `events=`, `control=`, `task_cls=` etc. replaces them — this is the
  main extension seam for customising the app.
- Keyword arguments such as `broker=`, `backend=`, `include=` and arbitrary
  `**kwargs` are written to `self._preconf` via `__autoset`, so they behave
  like configuration keys rather than attributes (this keeps the app
  picklable).
- `self._conf` starts as a `Settings` view wrapping a `PendingConfiguration`.
  The first *read* of any key triggers `_finalize_pending_conf`, which loads the
  real configuration.
- Fix-ups are instantiated immediately: the default set is
  `BUILTIN_FIXUPS = {'celery.fixups.django:fixup'}` (see
  [Django integration](../integrations/django.md)).
- If `set_as_current` is true (default) the instance becomes the thread's
  current app; every app is also registered in a global `WeakSet`.
- App-level signals are created: `on_configure`, `on_after_configure`,
  `on_after_finalize`, `on_after_fork`.

The default loader is chosen by `_get_default_loader`: the `CELERY_LOADER`
environment variable (set by the `--loader` CLI option), then `loader_cls`, then
`celery.loaders.app:AppLoader`.

## Current app and proxies

`celery/_state.py` holds process/thread state:

- `default_app` – a global fallback; created lazily by `_get_current_app()` as
  `Celery('default', fixups=[], set_as_current=False, loader=... or 'default')`
  if nothing else is set.
- `_tls.current_app` – thread-local "last app that called `set_current`".
- `current_app` and `current_task` are `celery.local.Proxy` objects that
  resolve on every attribute access.
- `_task_stack` is a `LocalStack` of executing tasks;
  `get_current_worker_task()` walks it to find the innermost task that was
  *not* called directly (i.e. actually executed by the worker).
- Debug switches: `C_STRICT_APP` makes any use of the current app raise,
  `C_WARN_APP` prints a stack trace, and `CELERY_TRACE_APP` makes
  `app_or_default()` raise when falling back to the default app in the main
  process.

`celery/local.py` provides `Proxy` (re-evaluates its target each access,
borrowed from werkzeug), `PromiseProxy` (evaluates once and caches), and
`LazyModule` used to make `celery/__init__.py` import submodules on demand.

## Task decorators and finalization

`@app.task` (`Celery.task`) does not build a task class immediately for an
unfinalized app. Instead it:

1. Registers a `cons(app)` callback with `connect_on_app_finalize` when
   `shared=True` (the default), so **every** app finalized later also gets a
   copy of the task.
2. Returns a `PromiseProxy(self._task_from_fun, ...)` appended to
   `self._pending`, unless `lazy=False` or the app is already finalized.

`_task_from_fun` creates a new subclass of the app's `Task` base with `run`
set to the function (a `staticmethod` unless `bind=True`), registers the
instance in `self._tasks` keyed by name, binds it to the app, and applies
`add_autoretry_behaviour`. If a task of that name already exists, the
existing instance is returned — task names are unique per app. Names come from
`gen_task_name(fun.__name__, fun.__module__)`. With `pydantic=True` the
function is wrapped so arguments are validated/converted from and results
dumped to Pydantic models.

`shared_task` in `celery/app/__init__.py` goes further: it registers a
finalizer for future apps, immediately adds the task to all *already
finalized* apps, and returns a Proxy that always resolves the task from
`current_app.tasks`. This is how reusable libraries (and Django apps) define
tasks without importing a specific app.

`Celery.finalize()` (guarded by `_finalize_mutex`) sets `finalized = True`,
runs every `_on_app_finalizers` callback (`_announce_app_finalized`), evaluates
all pending `PromiseProxy` objects, re-binds every task, and sends
`on_after_finalize`. Accessing `app.tasks` calls `finalize(auto=True)`;
with `autofinalize=False` this raises `RuntimeError('Contract breach: app not
finalized')`, which is useful to detect premature registry access.

The built-in tasks in `celery/app/builtins.py` are themselves registered via
`connect_on_app_finalize`: `celery.backend_cleanup`, `celery.accumulate`,
`celery.chord_unlock`, `celery.map`, `celery.starmap`, `celery.chunks`,
`celery.group`, `celery.chain`, `celery.chord`.

## Task registry

`TaskRegistry` (`celery/app/registry.py`) is a `dict` subclass whose
`__missing__` raises `celery.exceptions.NotRegistered`. `register()` requires
a `name`, instantiates classes, and applies autoretry behaviour. A worker that
receives a message for a name not present in this registry rejects it as an
unregistered task (see [Consumer](worker/consumer.md)).

## Configuration loading

Configuration is read on first access to `app.conf` or any key:

```
app.conf[...]  ->  PendingConfiguration  ->  _finalize_pending_conf()
                                         ->  _load_config()
```

`_load_config` (`celery/app/base.py`):

1. sends `on_configure`;
2. if a config source was given via `config_from_object`, calls
   `loader.config_from_object(source)`;
3. builds the final `Settings` with `detect_settings(...)`, merging the
   loader's configuration with `_preconf` (constructor kwargs);
4. if an earlier `Settings` object exists, **swaps contents in place** so
   references to `app.conf` held by user code stay valid;
5. applies deferred `add_defaults()` callables and deferred
   `add_periodic_task()` registrations;
6. sends `on_after_configure`.

`config_from_object(obj, namespace=...)` only records the source unless the app
is already configured or `force=True`. Strings are imported relative to the
current working directory (`import_from_cwd`); `module:attr` paths are
supported. `config_from_envvar` reads the module name from an environment
variable. `namespace='CELERY'` makes the app look for keys like
`CELERY_BROKER_URL` — the convention used with Django settings.

### Settings and defaults

`celery/app/defaults.py` defines every recognised setting as an `Option`
(default, type, optional `old` names, deprecation metadata) grouped in
`NAMESPACES` (`broker`, `result`, `task`, `worker`, `beat`, `event`,
`control`, `redis`, `database`, `security`, backend-specific groups, ...).
`flatten()` turns them into `namespace_key` setting names (e.g.
`worker_prefetch_multiplier`). Notable defaults: pool `prefork`,
`accept_content = ('json',)`, security digest `sha256`.

`detect_settings` (`celery/app/utils.py`) supports both the modern lowercase
names and the pre-4.0 uppercase names (`CELERY_*`, `CELERYD_*`,
`CELERYBEAT_*`). It decides which scheme the user is using by majority and
raises an `ImproperlyConfigured` error when they are mixed in a way it cannot
reconcile. Old names emit deprecation warnings scheduled for removal in 6.0.

`Settings` (a `ConfigurationView`) adds computed properties. Several of them
let environment variables override files: `broker_url` checks
`CELERY_BROKER_URL` first, and `broker_read_url` / `broker_write_url` check
`CELERY_BROKER_READ_URL` / `CELERY_BROKER_WRITE_URL` before falling back to
`broker_url`. `Settings.table()`/`humanize()` censor secret-looking keys and
are used by `celery report` and `app.bugreport()`.

## Loaders

Loaders (`celery/loaders/`) are the hook layer between the app and its host
environment. `get_loader_cls` resolves aliases `app` → `AppLoader` and
`default` → `Loader`. `BaseLoader` provides:

- `config_from_object` / `read_configuration` (the default `Loader` reads
  `CELERY_CONFIG_MODULE`, falling back to `celeryconfig`);
- `default_modules` = built-in modules + `imports` + `include` settings, which
  `init_worker()` imports via `import_default_modules()` (after sending the
  `import_modules` signal and re-raising any exception from its receivers);
- worker hooks `on_worker_init`, `on_worker_process_init`,
  `on_worker_shutdown`, `on_task_init`, `on_process_cleanup`;
- `autodiscover_tasks(packages, related_name='tasks')`, used by
  `app.autodiscover_tasks()`; the app version is lazy and re-runs on
  `import_modules`, and can take packages from fixups (Django
  `INSTALLED_APPS`).
- `override_backends` from the configuration lets users add or replace backend
  aliases used by `celery.app.backends.by_name`.

## Lazily created subsystems

| Attribute | Created from | Notes |
|-----------|--------------|-------|
| `app.amqp` | `amqp_cls` | Message construction, queues, routing, producer pool ([publishing](../workflows/task-publishing-and-routing.md)) |
| `app.backend` | `backends.by_url(backend_cls or conf.result_backend)` | Cached app-wide if `backend.thread_safe`, otherwise per thread in `self._local` ([backends](result-backends.md)) |
| `app.control` | `control_cls` | Broadcast commands ([remote control](remote-control-and-events.md)) |
| `app.events` | `events_cls` | Event dispatch/receive |
| `app.loader` | `get_loader_cls(loader_cls)` | |
| `app.log` | `log_cls` | Logging setup |
| `app.pool` | kombu connection pool | Reset in `_after_fork` |
| `app.timezone` | `timezone` / `enable_utc` settings | UTC when unset and `enable_utc` is true |

`app.Worker`, `app.WorkController`, `app.Beat`, `app.Task`, `app.AsyncResult`
and friends are produced with `subclass_with_self`, which creates a subclass
bound to this app so that pickling and `app` attribute lookup work.

## Fork safety

When billiard's `register_after_fork` is available, `_ensure_after_fork`
registers `_after_fork_cleanup_app`, which calls `app._after_fork()`: it drops
the connection pool and the amqp producer pool (connections must not be shared
across forked processes) and sends `on_after_fork`.

## Tests

- `t/unit/app/test_app.py` – construction, finalization, config loading,
  pickling, autofinalize contract.
- `t/unit/app/test_defaults.py`, `t/unit/app/test_utils.py` – settings and
  `detect_settings`.
- `t/unit/app/test_loaders.py`, `t/unit/app/test_registry.py`,
  `t/unit/app/test_builtins.py`.
- `t/unit/utils/test_local.py` – Proxy semantics.

See also: [Architecture overview](overview.md), [Tasks](../concepts/tasks.md).
