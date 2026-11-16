---
title: "Django Integration"
---
## Overview

Celery runs inside Django projects without a separate integration package. Every app installs the built-in Django *fixup* when the `DJANGO_SETTINGS_MODULE` environment variable is set; the fixup calls `django.setup()` before task modules are imported, finds tasks in the installed Django apps, makes the app's clock follow Django's timezone settings, switches the default task class to `DjangoTask`, and in the worker closes database connections and caches around every task and after every fork. This page follows the example project in `examples/django` and then what the fixup does at each stage. How settings are read is on [[Configuration]].

Sources: [celery/fixups/django.py:52-89](repo://celery/fixups/django.py#L52-L89), [celery/app/base.py:82-84](repo://celery/app/base.py#L82-L84)

## Project layout

The example keeps the app in `proj/celery.py`. It sets the settings module, reads every Django setting that starts with `CELERY_` as a Celery setting, and asks for task autodiscovery:

Sources: [examples/django/proj/celery.py:1-17](repo://examples/django/proj/celery.py#L1-L17)

```python
import os

from celery import Celery

# Set the default Django settings module for the 'celery' program.
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'proj.settings')

app = Celery('proj')

# Using a string here means the worker doesn't have to serialize
# the configuration object to child processes.
# - namespace='CELERY' means all celery-related configuration keys
#   should have a `CELERY_` prefix.
app.config_from_object('django.conf:settings', namespace='CELERY')

# Load task modules from all registered Django apps.
app.autodiscover_tasks()
```

Sources: [examples/django/proj/celery.py:1-17](repo://examples/django/proj/celery.py#L1-L17)

With the `CELERY` namespace, `CELERY_BROKER_URL` in `settings.py` is the `broker_url` setting and `CELERY_TASK_SERIALIZER` is `task_serializer`. The project's `__init__.py` imports the app, so it exists (and becomes the current app) whenever Django starts, and the app modules declare tasks with `@shared_task`, which binds to whichever app is current.

Sources: [examples/django/proj/settings.py:10-16](repo://examples/django/proj/settings.py#L10-L16), [examples/django/proj/__init__.py:1-5](repo://examples/django/proj/__init__.py#L1-L5), [examples/django/demoapp/tasks.py:1-25](repo://examples/django/demoapp/tasks.py#L1-L25)

When the configuration source is the string `'django.conf:settings'`, the worker skips its warning about old-style setting names at start.

Sources: [celery/apps/worker.py:148-164](repo://celery/apps/worker.py#L148-L164)

## Installing the fixup

`fixup(app)` runs for every new app, because `celery.fixups.django:fixup` is in `BUILTIN_FIXUPS`. It does nothing unless `DJANGO_SETTINGS_MODULE` is set and the app's loader is not already a Django loader; it warns when Django is not installed and requires Django 1.11 or later. `DjangoFixup.__init__` makes the app the default app if there is none yet.

Sources: [celery/fixups/django.py:47-73](repo://celery/fixups/django.py#L47-L73)

`install()` then:

Sources: [celery/fixups/django.py:75-89](repo://celery/fixups/django.py#L75-L89)

- Puts the current directory first on `sys.path`, so the project's packages are importable.
- Replaces the loader's `now` with Django's `timezone.now`, so `USE_TZ` and `TIME_ZONE` apply.
- Sets the app's `task_cls` to `celery.contrib.django.task:DjangoTask`, unless the project chose its own task class.
- Connects `import_modules` (run `django.setup()` and the system checks before task modules are imported) and `worker_init` (install the worker part).

Sources: [celery/fixups/django.py:75-127](repo://celery/fixups/django.py#L75-L127)

The checks are Django's `run_checks()`; setting `CELERY_SKIP_CHECKS`, which the global `--skip-checks` option does, skips them.

Sources: [celery/fixups/django.py:146-154](repo://celery/fixups/django.py#L146-L154), [celery/bin/celery.py:130-131](repo://celery/bin/celery.py#L130-L131)

## Task discovery

`app.autodiscover_tasks()` with no package list asks the fixups for packages. The Django fixup answers with the name of every installed app config, so the loader imports `<app>.tasks` for each of them once the worker imports its default modules ([[The Celery Application]]).

Sources: [celery/fixups/django.py:121-123](repo://celery/fixups/django.py#L121-L123), [celery/app/base.py:828-844](repo://celery/app/base.py#L828-L844)

## Database connections in the worker

Django opens database connections lazily and keeps them per thread, which does not suit forked pool processes or long-lived workers. `DjangoWorkerFixup` manages them through signals:

Sources: [celery/fixups/django.py:130-163](repo://celery/fixups/django.py#L130-L163)

| Moment | Action |
| --- | --- |
| Worker start | Close database connections and caches in the main process |
| Each pool child starts (`worker_process_init`) | Re-validate models if the child was started with exec; close inherited connection file descriptors without network I/O, then close connections and caches |
| Before each task (`task_prerun`) | Close database connections, unless the task runs eagerly |
| After each task (`task_postrun`) | Close database connections and caches, unless eager |
| Embedded beat starts | Close database connections |

Sources: [celery/fixups/django.py:156-211](repo://celery/fixups/django.py#L156-L211)

Closing inherited connections by closing their file descriptor matters: calling `close()` on a connection shared with the parent could send a disconnect over the socket and break the parent's connection too. During normal closes, errors that only mean "already closed" are ignored. With Django's connection pooling enabled for a database and the prefork pool, the pool is closed as well.

Sources: [celery/fixups/django.py:165-192](repo://celery/fixups/django.py#L165-L192), [celery/fixups/django.py:213-240](repo://celery/fixups/django.py#L213-L240)

`CELERY_DB_REUSE_MAX` keeps connections open across tasks: with it set, connections are closed only every `2 × CELERY_DB_REUSE_MAX` close requests (each task makes two, before and after).

Sources: [celery/fixups/django.py:134-136](repo://celery/fixups/django.py#L134-L136), [celery/fixups/django.py:205-211](repo://celery/fixups/django.py#L205-L211)

## DjangoTask and transactions

`DjangoTask` adds two methods that send the task only after the current database transaction commits, through Django's `transaction.on_commit`. A task that reads a row created in the same request then cannot run before the row is visible, and nothing is sent when the transaction rolls back.

Sources: [celery/contrib/django/task.py:8-21](repo://celery/contrib/django/task.py#L8-L21)

```python
def delay_on_commit(self, *args, **kwargs) -> None:
    """Call :meth:`~celery.app.task.Task.delay` with Django's ``on_commit()``."""
    transaction.on_commit(functools.partial(self.delay, *args, **kwargs))

def apply_async_on_commit(self, *args, **kwargs) -> None:
    """Call :meth:`~celery.app.task.Task.apply_async` with Django's ``on_commit()``."""
    transaction.on_commit(functools.partial(self.apply_async, *args, **kwargs))
```

Sources: [celery/contrib/django/task.py:15-21](repo://celery/contrib/django/task.py#L15-L21)

Both return `None` rather than an `AsyncResult`, because the message does not exist yet when they return. The fixup only installs `DjangoTask` as the base class when the app was not given a custom `task_cls`.

Sources: [celery/contrib/django/task.py:15-21](repo://celery/contrib/django/task.py#L15-L21), [celery/fixups/django.py:84-85](repo://celery/fixups/django.py#L84-L85)
