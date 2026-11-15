---
type: guide
title: Contrib Utilities and Extension Seams
description: The optional celery.contrib modules (abortable tasks, rdb remote debugger, queue migration, Sphinx autodoc, testing helpers) and the main ways to extend Celery, including custom Task classes, signals, bootsteps, entry-point plugins for backends, beat schedulers and CLI commands, custom pools, and CLI options.
tags: [contrib, extensions, signals, plugins, entry-points, debugging]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:49.645Z
sources:
  - id: openwiki-source-c4ebf7fa0abfe9f2d1eabf61
    resource: repo://celery/app/backends.py
  - id: openwiki-source-2a32c4e613bc7be1d621d647
    resource: repo://celery/beat.py
  - id: openwiki-source-4e8c69ddbd86a82c3201bc63
    resource: repo://celery/bin/celery.py
  - id: openwiki-source-03401290efe2e461d5c3013a
    resource: repo://celery/concurrency/__init__.py
  - id: openwiki-source-c6f41b90ceaba338b0e90b9b
    resource: repo://celery/contrib/abortable.py
  - id: openwiki-source-a5300d485662e203e0ae1262
    resource: repo://celery/contrib/migrate.py
  - id: openwiki-source-79fe28296d2c6b97a60f7d12
    resource: repo://celery/contrib/rdb.py
  - id: openwiki-source-7ef2718c0e261f897e55c1de
    resource: repo://celery/utils/dispatch/signal.py
  - id: openwiki-source-13b5c49e893fd28fca034cee
    resource: repo://celery/utils/imports.py
  - id: openwiki-source-94b60a38fd26082deb41f979
    resource: repo://celery/worker/consumer/consumer.py
  - id: openwiki-source-12d3bd623a53e489a785c641
    resource: repo://celery/worker/worker.py
generated: { by: "claude-code", at: "2026-11-15T17:08:49.645Z" }
---

# Contrib Utilities and Extension Seams

## `celery.contrib` modules

None of these modules are imported by default. Each one is opt-in.

### Abortable tasks (`celery/contrib/abortable.py`)

`AbortableTask` is a `Task` subclass. Its `AsyncResult` is an `AbortableAsyncResult` with an `abort()` method. `abort()` writes the custom state `ABORTED` into the result backend with `backend.store_result`. Inside the task, `self.is_aborted()` reads the state back. This is cooperative cancellation: the task must poll `is_aborted()` at safe points, and each poll is a backend round trip. Because it depends on storing and reading arbitrary states, the module documentation says it only works with the database backends. Compare this with remote-control `revoke(terminate=True)`, which kills the process (see [Remote Control](../worker/remote-control.md)).

### Remote debugger (`celery/contrib/rdb.py`)

`rdb.set_trace()` opens a `pdb.Pdb` subclass over a TCP socket. Pool child processes have no usable stdin, so you connect to this socket instead. The debugger binds to `CELERY_RDB_HOST` (default `127.0.0.1`, local access only) and to the first free port starting at `CELERY_RDB_PORT` (default `6899`). It tries up to 100 ports and logs a "Ready to connect: telnet host port" banner. Setting the host to a non-loopback address exposes an unauthenticated Python debugger, so keep the default unless the network is trusted.

### Queue migration (`celery/contrib/migrate.py`)

These are tools for moving task messages between brokers or queues, and the `celery migrate` command uses them.

- `migrate_tasks(source, dest, ...)` copies all messages from one connection to another.
- `move(predicate, ...)` consumes from queues and republishes each message where `predicate(body, message)` returns a destination. The destination can be a `Queue` or an exchange/routing key. The original message is acked after it is republished.
- Helpers include `move_task_by_id`, `move_by_idmap`, and `move_by_taskmap`. The predicates `task_id_eq` and `task_id_in` match on task ID, and `filter_status` reports progress.
- `republish()` keeps the original headers, properties, and body encoding.

### Sphinx extension (`celery/contrib/sphinx.py`)

Add `celery.contrib.sphinx` to Sphinx `extensions` to document tasks. It provides a `TaskDocumenter` for `autotask`, a `task` directive, and a skip handler so that task proxies are documented with their original function signature. This repository's own docs use it.

### Testing helpers (`celery/contrib/testing/`, `celery/contrib/pytest.py`)

These cover `start_worker`, `TestApp`, mocks, and the pytest plugin (`celery_app`, `celery_worker`, and related fixtures). See [Testing](../testing/test-suite.md).

### Django task class (`celery/contrib/django/task.py`)

`DjangoTask` adds `delay_on_commit` and `apply_async_on_commit`. See [Django Integration](../integrations/django.md).

## Extension seams

| Seam | How | Where resolved |
|---|---|---|
| Custom base Task | `Celery(task_cls=...)`, `@app.task(base=MyTask)`, or a subclass with `Request` / `on_success` / `on_failure` / `before_start` / `after_return` hooks | `celery/app/base.py`, `celery/app/task.py` |
| Task annotations | `task_annotations` setting overrides task attributes or methods by name or with a callable | `celery/app/annotations.py` |
| Signals | Connect receivers to `celery.signals.*` (task lifecycle, worker lifecycle, beat, logging, eventlet pool, preload options) | `celery/signals.py`, `celery/utils/dispatch/signal.py` |
| Worker/consumer bootsteps | `app.steps['worker'].add(Step)` or `app.steps['consumer'].add(Step)` | `celery/bootsteps.py`; blueprints in `celery/worker/worker.py` and `celery/worker/consumer/consumer.py` |
| Result backend plugins | URL scheme alias from the `celery.result_backends` entry-point group, or a `module:Class` string | `celery/app/backends.py` |
| Beat scheduler plugins | `celery.beat_schedulers` entry-point group, or `--scheduler module:Class` | `celery/beat.py` |
| CLI subcommands | `celery.commands` entry-point group (loaded via `click_plugins.with_plugins`), or `app.user_options` for extra worker and preload options | `celery/bin/celery.py`, `celery/bin/base.py` |
| Custom pool | `CELERY_CUSTOM_WORKER_POOL=module:Pool` plus `--pool custom`, or any `module:Class` passed as the pool | `celery/concurrency/__init__.py` |
| Loader | `CELERY_LOADER` env var or `Celery(loader=...)` | `celery/loaders/__init__.py` |
| Routers | `task_routes` entries can be callables or `module:function` strings | `celery/app/routes.py` |
| Whole subsystems | `amqp`, `events`, `log`, `control`, and `tasks` constructor arguments | `celery/app/base.py` |

### Signals implementation

`celery.utils.dispatch.signal.Signal` is a port of Django's dispatcher with a few additions:

- Receivers are held by **weak reference** by default. Bound methods use `WeakMethod`. Pass `weak=False` to keep lambdas and closures alive.
- Receivers are deduplicated by `dispatch_uid`, or by the sender's identity.
- A receiver can be limited to a particular `sender`, for example `task_success.connect(handler, sender='tasks.add')` or `sender=app`.
- `connect(retry=True)` wraps the receiver so that it is retried with `retry_over_time`.
- `send()` logs receiver exceptions and returns them in the response list instead of raising. This is why `BaseLoader.import_default_modules` checks `import_modules` responses and re-raises any exceptions it finds.

Signals that run in pool child processes (`task_prerun`, `task_postrun`, `worker_process_init`, and others) must be connected in modules that the child imports.

### Entry points

`celery.utils.imports.load_extension_class_names(namespace)` reads `importlib.metadata.entry_points(group=namespace)`, with fallbacks for older Python versions. Backends and beat schedulers merge these names into their alias tables, so third-party packages such as `django-celery-beat` or custom result backends can register names that work in configuration and on the command line.

## See also

- [The Celery Application Object](../architecture/application.md)
- [Worker Architecture and Bootsteps](../worker/worker-architecture.md)
- [Testing](../testing/test-suite.md)
