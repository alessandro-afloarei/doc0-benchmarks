---
type: integration
title: Django Integration
description: How Celery detects a Django project and installs its fixup, how the fixup sets up Django and the worker and child-process database connections, the DjangoTask helper for transaction-aware task dispatch, and the connection-reuse limit.
tags: [celery, django, fixup, integration, database, transactions, worker]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:42:35.525Z
sources:
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-650c0d51beedca1446741693
    resource: repo://celery/contrib/django/task.py
  - id: openwiki-source-bdd128d49c4b8a546ae88464
    resource: repo://celery/fixups/django.py
generated: { by: "claude-code", at: "2026-11-16T10:42:35.525Z" }
---

# Django Integration

Celery integrates with Django through a *fixup*: a plug-in that the app installs when it detects a Django project. The fixup makes sure Django is initialised before Celery imports task modules, uses Django's clock and autodiscovery, closes database and cache connections correctly in forked worker processes, and replaces the default task class with one that can dispatch tasks at the end of a database transaction. The code is in `celery/fixups/django.py` and `celery/contrib/django/task.py`.

## Responsibility and ownership

The integration does not use Django's own task framework. It connects Celery's lifecycle signals to Django's setup and database layer, and it provides one task base class. Its scope is:

- detecting the project and installing the fixup at app construction;
- running `django.setup()` and model validation in the right order;
- installing a worker-side fixup that handles connection and cache lifecycle;
- providing `DjangoTask`.

## Detection and installation

`BUILTIN_FIXUPS` in `celery/app/base.py` (lines 82–84) lists `celery.fixups.django:fixup`, so the fixup is considered for every app. The `fixup` function (`celery/fixups/django.py`, line 52) returns an installed `DjangoFixup` only when the `DJANGO_SETTINGS_MODULE` environment variable is set, the loader is not already a Django loader, and the `django` package imports. It also checks the Django version. If Django is missing while the variable is set, it emits a `FixupWarning` instead of failing.

`DjangoFixup.install` (around lines 75–90) inserts the current working directory at the front of `sys.path` so project modules take precedence, resolves `django.conf:settings`, sets the loader's `now` to Django's timezone-aware clock, and, unless the application already chose a custom task class, sets `task_cls` to `celery.contrib.django.task:DjangoTask`. It then connects to the `import_modules` and `worker_init` signals.

## Setup ordering

Django must be set up before any task module is imported. On `import_modules`, `DjangoFixup.on_import_modules` calls `DjangoWorkerFixup.validate_models` (line 101), which runs `django.setup()` and checks models. On `worker_init` (lines 105–116), the fixup records the `WorkController` as `worker` and installs the worker-side fixup. The worker reference is passed through the signal sender, and a missing sender produces a warning rather than an error.

`autodiscover_tasks` (line 121) returns the names of all installed Django app configurations, so Celery's autodiscovery looks for a `tasks` module in each one. `now` (line 118) returns Django's time with optional UTC handling.

## Worker-side fixup

`DjangoWorkerFixup` (`celery/fixups/django.py`, class at line 130) handles per-process resources:

- `on_worker_process_init` (line 165) runs in each child process. Under the multiprocessing fork, it re-validates models only when `FORKED_BY_MULTIPROCESSING` is set (Windows or `execv` start). It then closes inherited database connections. Closing a connection that the parent opened can break the parent's socket, so the code first removes the file descriptor without network I/O (`_maybe_close_db_fd`, line 187) and only then calls the close helper, `_close_database` (line 219).
- `install` (line 156) connects `on_task_prerun` and `on_task_postrun` (lines 194–202) to the `task_prerun` and `task_postrun` signals, and also to `beat_embedded_init`, for `close_database`. Prerun closes database connections before a non-eager task; postrun closes database connections and then caches. `close_database` (line 205) is subject to the connection-reuse limit described below, and `close_cache` (line 242) calls Django's `close_caches`.
- `_is_prefork` (line 213) inspects the worker's pool class. For connection pools that expose `close_pool`, the fixup closes the pool only when the worker uses prefork and the database settings enable pooling.

## Connection reuse

`DjangoWorkerFixup.__init__` reads `db_reuse_max` from `app.conf.get('CELERY_DB_REUSE_MAX', None)` (line 136). When set, `close_database` keeps a database connection open for up to `db_reuse_max * 2` task completions and then closes it, which reduces reconnect cost while still bounding how long one connection lives. When the value is unset, connections are closed after every task. The key is read in its uppercase legacy form.

## DjangoTask

`DjangoTask` (`celery/contrib/django/task.py`, class at line 8) extends `celery.app.task.Task`. It adds two methods, `delay_on_commit` and `apply_async_on_commit`, which wrap `delay` and `apply_async` in Django's `transaction.on_commit`. This means a task that refers to rows written in the same transaction is published only after the transaction commits, so the worker cannot read uncommitted data. The methods use `functools.partial`, so the arguments are captured at call time.

## Relationships

- The fixup depends on the application's loader and signal system ([application](../architecture/application.md)) and on the worker lifecycle ([worker](../architecture/worker.md)).
- The Django test settings used by the integration tests are in `t/integration/django_settings.py`; see [test suite](../testing/test-suite.md).

## Invariants and failure behaviour

- The fixup is not installed unless `DJANGO_SETTINGS_MODULE` is set, so non-Django projects are unaffected.
- A custom `task_cls` set by the application takes precedence over `DjangoTask`.
- Forked children never reuse database connections inherited from the parent without first closing their file descriptors.
- `delay_on_commit` relies on the database transaction being committed; outside a transaction, `on_commit` runs immediately.

## Extension seams

- Set `task_cls` explicitly to replace `DjangoTask` with a subclass that adds more behaviour.
- The fixup list is a constructor argument (`fixups=`) on the app, so other framework fix-ups can be added alongside it.

## Representative tests

`t/integration/django_settings.py` supplies the Django configuration for the integration tests, which exercise the database backend and worker lifecycle. Unit tests for the fixup live under `t/unit/fixups/`.
