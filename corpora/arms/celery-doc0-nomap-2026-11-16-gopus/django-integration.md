---
title: "Django Integration"
---
## Overview

Celery works with Django without a separate package. A Django project defines a normal `Celery` app that reads its settings from `django.conf:settings`, and Celery's built-in Django *fixup* takes care of the rest when `DJANGO_SETTINGS_MODULE` is set: it calls `django.setup()` before task modules are imported, finds tasks in every installed Django app, makes `DjangoTask` the default task class, and closes database connections and caches around tasks and pool processes so a worker never reuses a broken or shared connection. This page follows the example project in `examples/django` and the fixup code. Fixups in general are described in [[Configuration and Loaders]].

Sources: [celery/fixups/django.py:52-89](repo://celery/fixups/django.py#L52-L89), [examples/django/proj/celery.py:1-22](repo://examples/django/proj/celery.py#L1-L22)

## Project layout

The example defines the app in `proj/celery.py`. It sets `DJANGO_SETTINGS_MODULE` if not already set, creates `Celery('proj')`, loads configuration from `django.conf:settings` with `namespace='CELERY'`, and calls `app.autodiscover_tasks()` with no arguments. The comment notes that passing the settings as a string means the worker does not have to serialize the configuration object to child processes.

Sources: [examples/django/proj/celery.py:1-22](repo://examples/django/proj/celery.py#L1-L22)

```python
import os

from celery import Celery

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'proj.settings')

app = Celery('proj')
app.config_from_object('django.conf:settings', namespace='CELERY')
app.autodiscover_tasks()
```

Sources: [examples/django/proj/celery.py:1-17](repo://examples/django/proj/celery.py#L1-L17)

`proj/__init__.py` imports the app as `celery_app`, so it is created whenever Django starts and `@shared_task` functions in reusable apps bind to it ([[The Celery Application]]). The apps' `tasks.py` modules use `@shared_task` and can use the ORM directly.

Sources: [examples/django/proj/__init__.py:1-5](repo://examples/django/proj/__init__.py#L1-L5), [examples/django/demoapp/tasks.py:1-32](repo://examples/django/demoapp/tasks.py#L1-L32)

With the `CELERY` namespace every setting is written in Django's settings in upper case with that prefix: `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND`, `CELERY_TASK_SERIALIZER`, `CELERY_ACCEPT_CONTENT`. A namespaced configuration always uses the new setting names, and the settings object also takes `timezone` from Django's `TIME_ZONE` when `timezone` is not set.

Sources: [examples/django/proj/settings.py:8-16](repo://examples/django/proj/settings.py#L8-L16), [celery/app/utils.py:262-266](repo://celery/app/utils.py#L262-L266), [celery/app/utils.py:128-131](repo://celery/app/utils.py#L128-L131)

## Installing the fixup

`celery.fixups.django:fixup` is in every app's default fixups. It does nothing unless `DJANGO_SETTINGS_MODULE` is set and the loader is not a Django loader. If Django cannot be imported it warns with `FixupWarning` and continues; Django older than 1.11 raises `ImproperlyConfigured`.

Sources: [celery/fixups/django.py:33-63](repo://celery/fixups/django.py#L33-L63), [celery/app/base.py:82-84](repo://celery/app/base.py#L82-L84)

`DjangoFixup` makes the app the default app if there is none, then `install()`:

Sources: [celery/fixups/django.py:66-89](repo://celery/fixups/django.py#L66-L89)

1. Puts the current directory first on `sys.path`, so the project package is importable.
2. Replaces the loader's `now()` with Django's `timezone.now` (or UTC when asked).
3. Sets the app's task class to `celery.contrib.django.task:DjangoTask`, unless the app was given a custom task class.
4. Connects `on_import_modules` to `import_modules` and `on_worker_init` to `worker_init`.

Sources: [celery/fixups/django.py:75-127](repo://celery/fixups/django.py#L75-L127)

`autodiscover_tasks()` on the fixup returns the name of every installed Django app config, which is the package list `app.autodiscover_tasks()` uses when called without arguments.

Sources: [celery/fixups/django.py:121-123](repo://celery/fixups/django.py#L121-L123), [celery/app/base.py:828-844](repo://celery/app/base.py#L828-L844)

## Django setup and checks

When the loader is about to import task modules, `on_import_modules` runs `django.setup()` and then Django's system checks, so models are ready before any `tasks.py` is imported. `--skip-checks` on the command line (or `SKIP_CHECKS`) sets `CELERY_SKIP_CHECKS` and skips the checks only.

Sources: [celery/fixups/django.py:101-103](repo://celery/fixups/django.py#L101-L103), [celery/fixups/django.py:146-154](repo://celery/fixups/django.py#L146-L154), [celery/bin/celery.py:103-110](repo://celery/bin/celery.py#L103-L110), [celery/bin/celery.py:131-132](repo://celery/bin/celery.py#L131-L132)

## Database connections in the worker

### Worker fixup

`on_worker_init` records the worker instance and installs a `DjangoWorkerFixup`, which connects to `task_prerun`, `task_postrun`, `worker_process_init` and `beat_embedded_init`, and immediately closes the database connections and caches the parent process holds.

Sources: [celery/fixups/django.py:105-116](repo://celery/fixups/django.py#L105-L116), [celery/fixups/django.py:130-163](repo://celery/fixups/django.py#L130-L163)

### Around each task

Before and after every task that is not running eagerly, the fixup closes database connections, and after the task it also closes caches, so each task starts with a fresh connection rather than one that may have timed out or been left in a failed transaction. With the `CELERY_DB_REUSE_MAX` setting, connections are only closed every `2 × CELERY_DB_REUSE_MAX` calls instead, so a connection is reused for about that many tasks.

Sources: [celery/fixups/django.py:194-211](repo://celery/fixups/django.py#L194-L211), [celery/fixups/django.py:136-136](repo://celery/fixups/django.py#L136-L136)

`_close_database` closes each initialized connection, ignoring interface errors and database errors that say the connection is already closed. When the worker uses the prefork pool and a database has Django's connection pool enabled (`OPTIONS['pool']`), it also closes the pool.

Sources: [celery/fixups/django.py:213-240](repo://celery/fixups/django.py#L213-L240)

### In new pool processes

In each new pool process, `on_worker_process_init` re-runs Django setup and checks if the child was started with `execv` (as on Windows). For connections inherited from the parent, it closes only the child's copy of the socket file descriptor, without the network traffic `close()` would cause, because the comment notes a normal close could also break the parent's connection. It then closes the connections and caches.

Sources: [celery/fixups/django.py:165-192](repo://celery/fixups/django.py#L165-L192), [celery/fixups/django.py:39-44](repo://celery/fixups/django.py#L39-L44)

## DjangoTask

`DjangoTask` adds two methods that publish a task only after the current database transaction commits, using `transaction.on_commit`: `delay_on_commit(*args, **kwargs)` and `apply_async_on_commit(*args, **kwargs)`. This avoids a worker picking up a task for a row the sending transaction has not committed yet. Neither returns an `AsyncResult`, since the message is not sent until later.

Sources: [celery/contrib/django/task.py:1-21](repo://celery/contrib/django/task.py#L1-L21)

## Running it

Workers and beat are started with the project's app, for example `celery -A proj worker -l INFO`, from the directory containing `manage.py`. Results can use the database backend through SQLAlchemy, as the example's `CELERY_RESULT_BACKEND = 'db+sqlite:///results.sqlite'` does ([[Result Backend Catalogue]]).

Sources: [examples/django/proj/settings.py:10-16](repo://examples/django/proj/settings.py#L10-L16), [examples/django/README.rst:44-50](repo://examples/django/README.rst#L44-L50)
