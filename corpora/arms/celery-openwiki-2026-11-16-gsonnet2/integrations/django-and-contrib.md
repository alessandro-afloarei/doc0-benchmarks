---
type: integration
title: Django Integration, Loaders and Contrib Utilities
description: How Celery plugs into Django through the fixup mechanism, how loaders and task autodiscovery work, the signal dispatcher used for extension, and the celery.contrib toolbox (abortable tasks, pytest plugin and embedded test worker, message migration, remote debugger, Sphinx support).
tags: [celery, django, fixups, loaders, signals, contrib, pytest, testing, abortable]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:56:17.091Z
sources:
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-ab4dad970ade900447cb0dd5
    resource: repo://celery/bin/migrate.py
  - id: openwiki-source-c6f41b90ceaba338b0e90b9b
    resource: repo://celery/contrib/abortable.py
  - id: openwiki-source-650c0d51beedca1446741693
    resource: repo://celery/contrib/django/task.py
  - id: openwiki-source-a5300d485662e203e0ae1262
    resource: repo://celery/contrib/migrate.py
  - id: openwiki-source-5d3d393604de2260b545f131
    resource: repo://celery/contrib/pytest.py
  - id: openwiki-source-a79943d68c1d8f0165ea4359
    resource: repo://celery/contrib/testing/app.py
  - id: openwiki-source-4370bc15e42aa94cee124f42
    resource: repo://celery/contrib/testing/worker.py
  - id: openwiki-source-bdd128d49c4b8a546ae88464
    resource: repo://celery/fixups/django.py
  - id: openwiki-source-2cec9a8c6ec81ee188e2e051
    resource: repo://celery/loaders/app.py
  - id: openwiki-source-461899b2d0d382360e23a4f2
    resource: repo://celery/loaders/base.py
  - id: openwiki-source-95f666732d41b3d73d797847
    resource: repo://celery/loaders/default.py
  - id: openwiki-source-7ef2718c0e261f897e55c1de
    resource: repo://celery/utils/dispatch/signal.py
generated: { by: "claude-code", at: "2026-11-16T17:56:17.091Z" }
---

# Django Integration, Loaders and Contrib Utilities

Celery's core knows nothing about Django. Integration happens through **fixups**: objects that an app instantiates at construction time and that connect to signals. This page covers the Django fixup, the loader and autodiscovery layer it relies on, the signal system that is the general extension seam, and the optional utilities in `celery/contrib/`.

## Fixups and loaders

### How a fixup is installed

<!-- openwiki: broken internal link [app-and-configuration.md] file "app-and-configuration.md" does not exist. Fix the href or restore the target, then delete this comment. -->
`Celery.__init__` stores `builtin_fixups` and calls `symbol_by_name(fixup)(app)` for each (see [App and configuration](app-and-configuration.md)). The built-in one is `celery.fixups.django:fixup`. It returns a `DjangoFixup` only if:

- the `DJANGO_SETTINGS_MODULE` environment variable is set, and
- the app's loader class is not itself a Django loader.

If Django is not importable, a `FixupWarning` is issued and nothing is installed. Django older than 1.11 raises `ImproperlyConfigured`.

### Loaders (`celery/loaders/`)

A loader is the app's bridge to configuration and module import. `BaseLoader` provides `config_from_object`, `import_default_modules` (which sends the `import_modules` signal and then imports `imports` and `include`), `autodiscover_tasks`, and worker lifecycle hooks (`on_worker_init`, `on_task_init`, `on_process_cleanup`, and so on). The subclasses are:

- `AppLoader`: used when an app is explicitly created (the usual case).
- `default.Loader`: used by the implicit default app. It reads `celeryconfig` (or `CELERY_CONFIG_MODULE`) and tolerates a missing file, warning only if `C_WNOCONF` is set.

`app.autodiscover_tasks(packages, related_name='tasks', force=False)` is lazy. It connects a callable to the `import_modules` signal, so modules are only imported when the worker starts importing. With no `packages`, it asks every fixup for its `autodiscover_tasks()`. For Django that is every installed app config, so `app.autodiscover_tasks()` imports `<app>.tasks` for each installed Django app.

## The Django fixup (`celery/fixups/django.py`)

`DjangoFixup.install` does the following:

1. It prepends the current directory to `sys.path` so the project wins over system modules.
2. It replaces `app.loader.now` with Django's `timezone.now`.
3. Unless a custom task class was requested, it sets `app.task_cls` to `celery.contrib.django.task:DjangoTask`.
4. It connects handlers to `import_modules` and `worker_init`.

The handlers do the real work:

- **`import_modules`**: `DjangoWorkerFixup.validate_models` calls `django.setup()` before task modules are imported, and runs Django's system checks unless `CELERY_SKIP_CHECKS` is set (the `--skip-checks` CLI flag sets it).
- **`worker_init`**: the `DjangoWorkerFixup` installs more signal handlers: `task_prerun`, `task_postrun`, `worker_process_init`, and `beat_embedded_init`.

Database hygiene is the main purpose of those handlers:

- Before and after each non-eager task, `close_database` closes Django DB connections, so that a long-lived worker process does not use connections that the database has timed out. After a task it also closes cache connections. If `CELERY_DB_REUSE_MAX` is set, connections are recycled only every N calls instead of every task.
- In each new prefork child (`worker_process_init`), inherited DB connections are removed **without** network I/O (the file descriptor is closed directly), because calling `close()` on a connection inherited from the parent could break the parent's connection. Models are validated again if the child was started through `execv` (`FORKED_BY_MULTIPROCESSING`).

`DjangoTask` (`celery/contrib/django/task.py`) extends `Task` with `delay_on_commit` and `apply_async_on_commit`, which defer publishing until the current database transaction commits (`transaction.on_commit`). This avoids workers picking up a task before the data it needs is visible.

<!-- openwiki: broken internal link [result-backends.md] file "result-backends.md" does not exist. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [beat-scheduler.md] file "beat-scheduler.md" does not exist. Fix the href or restore the target, then delete this comment. -->
The Django-specific Celery result and beat database backends are third-party packages (`django-celery-results`, `django-celery-beat`). They plug in through the `celery.result_backends` and `celery.beat_schedulers` entry points (see [Result backends](result-backends.md) and [Beat scheduler](beat-scheduler.md)).

## Signals (`celery/signals.py`, `celery/utils/dispatch/signal.py`)

`Signal` is a Celery-owned implementation of the Django-style dispatcher:

- `connect(receiver, sender=None, weak=True, dispatch_uid=None)` works as a decorator. Receivers are weakly referenced by default (bound methods use `WeakMethod`). Receivers can be restricted to a `sender`.
- `send(sender, **named)` calls each live receiver. **An exception in a receiver is logged and returned as that receiver's response; it does not propagate.** `send_robust` is an alias. Callers that need failures to be fatal must inspect the returned list. `Loader.import_default_modules` re-raises such exceptions itself, because logging is not yet configured at that point.
- A per-sender receiver cache is used when `use_caching` is set.

<!-- openwiki: broken internal link [cli-and-process-management.md] file "cli-and-process-management.md" does not exist. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [concurrency-pools.md] file "concurrency-pools.md" does not exist. Fix the href or restore the target, then delete this comment. -->
`celery/signals.py` defines about three dozen named signals, among them: publishing (`before_task_publish`, `after_task_publish`), task lifecycle (`task_prerun`, `task_postrun`, `task_success`, `task_failure`, `task_retry`, `task_revoked`, `task_rejected`, `task_unknown`, `task_received`, `task_internal_error`), worker (`celeryd_init`, `celeryd_after_setup`, `worker_init`, `worker_ready`, `worker_process_init`, `worker_process_shutdown`, `worker_shutting_down`, `worker_shutdown`), logging setup (`setup_logging`, `after_setup_logger`), beat (`beat_init`, `beat_embedded_init`), `heartbeat_sent`, and eventlet pool signals. Hooks in other pages: [CLI and process management](cli-and-process-management.md) (shutdown), [Concurrency pools](concurrency-pools.md) (process init) and [Task publishing](../workflows/task-publishing.md).

## `celery.contrib`

| Module | Purpose |
|---|---|
| `abortable` | `AbortableTask` and `AbortableAsyncResult`: cooperative cancellation through an `ABORTED` state in the result backend. |
| `pytest` | pytest fixtures (a pytest plugin) for apps and embedded workers. |
| `testing/` | Helpers used by those fixtures: `TestApp`, `start_worker`, `TestWorkController`, mocks, and an integration `Manager`. |
| `migrate` | Moving task messages between queues or brokers. |
| `rdb` | Remote debugger (`Rdb`, `set_trace`), reachable by telnet. |
| `sphinx` | Sphinx autodoc support for task functions. |

### Abortable tasks

<!-- openwiki: broken internal link [events-and-remote-control.md] file "events-and-remote-control.md" does not exist. Fix the href or restore the target, then delete this comment. -->
`AbortableTask` (an abstract base) exposes `self.is_aborted()`, and `AbortableAsyncResult.abort()` calls `backend.store_result(id, None, 'ABORTED')`. Abort is **cooperative and advisory**: the task body must poll `is_aborted()` (each call is a backend lookup) and return, and nothing guarantees timing. Use `revoke(terminate=True)` (see [Events and remote control](events-and-remote-control.md)) for forced termination. It requires a result backend.

### Embedded test worker

`celery.contrib.testing.worker.start_worker(app, pool='solo', ...)` runs a real `WorkController` in a daemon thread within the test process:

- `TestWorkController` signals readiness from `on_consumer_ready`, so `start_worker` can wait for a fully started consumer (`ensure_started`).
- Mingle, gossip and heartbeat are disabled by default so tests do not wait on peers.
- It checks for the built-in `celery.ping` task unless `perform_ping_check=False`, then sends that ping through the real broker and waits for `pong` before yielding.
- On exit it sets `worker.state.should_terminate` and joins the thread, raising `RuntimeError` if it does not exit within `shutdown_timeout`.
- With a prefork pool, child-process log records are forwarded through a queue.
- `setup_app_for_worker` finalizes the app and makes it current and default.
- `test_worker_starting` and `test_worker_stopped` signals bracket the worker's life.

### pytest plugin (`celery/contrib/pytest.py`)

It registers a `celery(**overrides)` marker and fixtures: `celery_config`, `celery_parameters`, `celery_enable_logging`, `celery_includes`, `celery_worker_pool` (default `solo`), `celery_worker_parameters`, `use_celery_app_trap`, and the app and worker fixtures at session and function scope (`celery_session_app`, `celery_session_worker`, `celery_app`, `celery_worker`). `NO_WORKER=1` skips starting the worker. `TestApp` (`celery/contrib/testing/app.py`) builds an app with in-memory defaults, and `setup_default_app` restores global current/default app state afterwards. The optional "trap" makes any use of the implicit current or default app raise, which finds code that forgets to pass an app. This repository's own `t/unit/conftest.py` reuses these fixtures. See [Testing, CI and development workflow](../testing/test-strategy.md).

### Other tools

<!-- openwiki: broken internal link [cli-and-process-management.md] file "cli-and-process-management.md" does not exist. Fix the href or restore the target, then delete this comment. -->
`celery.contrib.migrate` (`migrate_tasks`, `move`, `move_task_by_id`, `move_by_idmap`, `move_by_taskmap`) consumes messages from source queues and republishes them elsewhere with filters. It backs the `celery migrate` command. `celery.contrib.rdb` backs the `SIGUSR2`/`CELERY_RDBSIG` handler described in [CLI and process management](cli-and-process-management.md).
