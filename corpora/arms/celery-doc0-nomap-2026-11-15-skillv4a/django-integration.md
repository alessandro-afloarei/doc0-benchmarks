---
title: "Django Integration"
---
## Overview

Celery works with Django without a separate package. Every app loads the built-in fix-up `celery.fixups.django:fixup`, which activates when the `DJANGO_SETTINGS_MODULE` environment variable is set. It makes Django's time, apps and settings available to Celery, runs `django.setup()` before task modules are imported, and manages database connections and caches around tasks so a worker process does not reuse connections that broke or were inherited from its parent. `celery.contrib.django.task.DjangoTask` becomes the default task base class and adds `delay_on_commit`. The repository's `examples/django` project shows the standard layout.

Sources: [celery/app/base.py:83-85](repo://celery/app/base.py#L83-L85), [celery/fixups/django.py:52-89](repo://celery/fixups/django.py#L52-L89), [celery/contrib/django/task.py:8-21](repo://celery/contrib/django/task.py#L8-L21)

## Project layout

### The app module

The Celery app lives in `proj/celery.py`. It sets a default for `DJANGO_SETTINGS_MODULE` before the app is created, so the fix-up sees it. It reads configuration from Django's settings object with the `CELERY` namespace, so every Celery setting is written in `settings.py` with a `CELERY_` prefix (`CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND`). Calling `autodiscover_tasks()` with no arguments then finds `tasks.py` in every installed Django app.

Sources: [examples/django/proj/celery.py:1-22](repo://examples/django/proj/celery.py#L1-L22), [examples/django/proj/settings.py:9-16](repo://examples/django/proj/settings.py#L9-L16)

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

### Importing the app with Django

`proj/__init__.py` imports the app as `celery_app`. Importing the Django project then creates the app and makes it current, so tasks declared with `@shared_task` in reusable Django apps bind to it. Task modules in Django apps use `shared_task` rather than importing the project's app.

Sources: [examples/django/proj/__init__.py:1-5](repo://examples/django/proj/__init__.py#L1-L5), [examples/django/demoapp/tasks.py:1-32](repo://examples/django/demoapp/tasks.py#L1-L32)

The worker is started like any other, from the directory containing `manage.py`: `celery -A proj worker -l INFO`. [[Configuration and Loaders]] explains namespaced settings, and [[The Celery Application]] explains `shared_task` and autodiscovery.

Sources: [celery/app/utils.py:378-415](repo://celery/app/utils.py#L378-L415), [celery/app/base.py:782-844](repo://celery/app/base.py#L782-L844)

## Installing the fix-up

`fixup(app)` returns nothing unless `DJANGO_SETTINGS_MODULE` is set and the app's loader is not a Django-specific loader. If Django cannot be imported it warns with `FixupWarning` and does nothing; Django older than 1.11 raises `ImproperlyConfigured`.

Sources: [celery/fixups/django.py:33-63](repo://celery/fixups/django.py#L33-L63)

`DjangoFixup` makes the app the default app if none exists yet. `install()` then does the following.

Sources: [celery/fixups/django.py:69-75](repo://celery/fixups/django.py#L69-L75)

- Puts the current directory first on `sys.path`, so the project's modules win over installed ones.
- Replaces the loader's `now()` with Django's `timezone.now`, so Celery uses Django's time zone handling for local times.
- Sets the app's task class to `DjangoTask`, unless the app was given a custom `task_cls`.
- Connects to the `import_modules` and `worker_init` signals.

Sources: [celery/fixups/django.py:66-127](repo://celery/fixups/django.py#L66-L127)

Its `autodiscover_tasks()` returns the names of all installed Django app configs. This is what `app.autodiscover_tasks()` without arguments uses when it asks the fix-ups for packages.

Sources: [celery/fixups/django.py:121-123](repo://celery/fixups/django.py#L121-L123), [celery/app/base.py:839-844](repo://celery/app/base.py#L839-L844)

## Django setup and checks

When the loader is about to import task modules, the `import_modules` handler calls `django.setup()`, which loads settings and the app registry, so task modules can import models. It then runs Django's system checks with `run_checks()`, unless `CELERY_SKIP_CHECKS` is set, which `celery --skip-checks` (or the `SKIP_CHECKS` variable) does.

Sources: [celery/fixups/django.py:101-104](repo://celery/fixups/django.py#L101-L104), [celery/fixups/django.py:146-154](repo://celery/fixups/django.py#L146-L154), [celery/bin/celery.py:105-133](repo://celery/bin/celery.py#L105-L133)

## Database connections in workers

### Signal handlers

On `worker_init` the fix-up records the worker and installs `DjangoWorkerFixup`. That object closes database connections and caches once at startup, then connects handlers to four signals; [[Signals]] describes when each fires.

Sources: [celery/fixups/django.py:156-163](repo://celery/fixups/django.py#L156-L163)

| Signal | Handler |
| --- | --- |
| `worker_process_init` | In each new pool child: re-run setup and checks if the child was started with `execv`; drop inherited connections without network I/O; close connections and caches |
| `task_prerun` | Close connections before a task (not for eager tasks) |
| `task_postrun` | Close connections and caches after a task (not for eager tasks) |
| `beat_embedded_init` | Close connections in an embedded beat process |

Sources: [celery/fixups/django.py:105-116](repo://celery/fixups/django.py#L105-L116), [celery/fixups/django.py:130-203](repo://celery/fixups/django.py#L130-L203)

Closing around every task makes each task start with a fresh connection. This matches what Django does around each request, and it avoids using a connection the database server has dropped while the worker was idle.

Sources: [celery/fixups/django.py:194-203](repo://celery/fixups/django.py#L194-L203)

### Inherited connections

A forked child inherits its parent's open sockets. Calling `close()` on such a connection could send a termination message that breaks the parent's copy too. `on_worker_process_init` therefore first closes only the file descriptors of inherited connections, then closes the connection objects.

Sources: [celery/fixups/django.py:165-192](repo://celery/fixups/django.py#L165-L192), [celery/fixups/django.py:39-44](repo://celery/fixups/django.py#L39-L44)

### Closing and pooling

`_close_database` closes every initialized connection, ignoring interface errors and database errors that say the connection is already closed. For the prefork pool, connections whose `DATABASES` options enable Django's connection `pool` also have the pool itself closed, so each child builds its own.

Sources: [celery/fixups/django.py:213-240](repo://celery/fixups/django.py#L213-L240)

Setting `CELERY_DB_REUSE_MAX` changes the per-task behaviour: connections are closed only every `2 × CELERY_DB_REUSE_MAX` calls (one call before and one after each task), so a connection is reused for about that many tasks. Caches are closed with `django.core.cache.close_caches()` after each task.

Sources: [celery/fixups/django.py:134-140](repo://celery/fixups/django.py#L134-L140), [celery/fixups/django.py:205-211](repo://celery/fixups/django.py#L205-L211), [celery/fixups/django.py:242-246](repo://celery/fixups/django.py#L242-L246)

## Sending tasks after a transaction commits

A task sent inside a database transaction can start before the transaction commits and not find the rows it was sent for. `DjangoTask` adds two methods that defer sending until commit through Django's `transaction.on_commit`.

Sources: [celery/contrib/django/task.py:1-13](repo://celery/contrib/django/task.py#L1-L13)

```python
def delay_on_commit(self, *args, **kwargs) -> None:
    """Call :meth:`~celery.app.task.Task.delay` with Django's ``on_commit()``."""
    transaction.on_commit(functools.partial(self.delay, *args, **kwargs))

def apply_async_on_commit(self, *args, **kwargs) -> None:
    """Call :meth:`~celery.app.task.Task.apply_async` with Django's ``on_commit()``."""
    transaction.on_commit(functools.partial(self.apply_async, *args, **kwargs))
```

Sources: [celery/contrib/django/task.py:8-21](repo://celery/contrib/django/task.py#L8-L21)

Both return `None` rather than an `AsyncResult`, because the task has not been sent when they return; if the transaction rolls back, it is never sent. Outside a transaction, Django runs the callback immediately. An app with its own `task_cls` does not get `DjangoTask` automatically and must subclass it to have these methods.

Sources: [celery/contrib/django/task.py:15-21](repo://celery/contrib/django/task.py#L15-L21), [celery/fixups/django.py:84-85](repo://celery/fixups/django.py#L84-L85)
