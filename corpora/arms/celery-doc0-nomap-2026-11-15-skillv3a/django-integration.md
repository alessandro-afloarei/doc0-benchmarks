---
title: "Django Integration"
---
## Overview

Celery works with Django without an extra package. A small fix-up, `celery.fixups.django`, is part of every app's default fix-ups and activates itself when the `DJANGO_SETTINGS_MODULE` environment variable is set. It makes Django's settings, app registry, clock and database connections behave correctly inside workers, lets `autodiscover_tasks()` find `tasks.py` in every installed app, and makes the default task class `DjangoTask`, which can delay sending until the current database transaction commits.

Sources: [celery/app/base.py:82-84](repo://celery/app/base.py#L82-L84), [celery/fixups/django.py:52-89](repo://celery/fixups/django.py#L52-L89)

## Project layout

### The app module

The usual layout puts the app in `proj/celery.py`, reads settings from Django with a `CELERY_` prefix, and calls `autodiscover_tasks()` without arguments. `proj/__init__.py` imports the app so it is created whenever Django starts, which also makes it the app that `@shared_task` tasks in reusable apps bind to ([[Defining Tasks]]).

Sources: [examples/django/proj/celery.py:1-22](repo://examples/django/proj/celery.py#L1-L22), [examples/django/proj/__init__.py:1-5](repo://examples/django/proj/__init__.py#L1-L5)

```python
import os
from celery import Celery

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'proj.settings')

app = Celery('proj')
app.config_from_object('django.conf:settings', namespace='CELERY')
app.autodiscover_tasks()
```

Sources: [examples/django/proj/celery.py:1-17](repo://examples/django/proj/celery.py#L1-L17)

### Settings

With `namespace='CELERY'`, every Celery setting is read from the Django settings module with the prefix, upper-cased: `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND`, `CELERY_TASK_SERIALIZER`. Passing the settings object as the string `'django.conf:settings'` means it is imported lazily and the worker never has to pickle it for child processes. The `timezone` setting falls back to Django's `TIME_ZONE`. [[Configuration and Loaders]] explains namespaces.

Sources: [examples/django/proj/settings.py:10-16](repo://examples/django/proj/settings.py#L10-L16), [celery/utils/collections.py:367-382](repo://celery/utils/collections.py#L367-L382), [celery/app/utils.py:128-131](repo://celery/app/utils.py#L128-L131)

## The fix-up

### Activation

`fixup(app)` runs when the app is created. It does nothing unless `DJANGO_SETTINGS_MODULE` is set and the app does not use a Django-specific loader; if Django is not installed it warns with `FixupWarning`, and Django older than 1.11 raises `ImproperlyConfigured`. Otherwise it creates and installs a `DjangoFixup`, which also makes this app the default app if none exists yet.

Sources: [celery/fixups/django.py:47-73](repo://celery/fixups/django.py#L47-L73)

### What install changes

`DjangoFixup.install()`:

Sources: [celery/fixups/django.py:75-89](repo://celery/fixups/django.py#L75-L89)

1. Prepends the current directory to `sys.path`, so the project package is importable from the directory where `celery` is run.
2. Replaces the loader's `now()` with Django's `timezone.now`, so Celery and Django agree on time zone handling.
3. Sets the app's task class to `celery.contrib.django.task:DjangoTask`, unless the app was given a custom `task_cls`.
4. Connects to `import_modules` to run `django.setup()` (and, unless `CELERY_SKIP_CHECKS` is set, Django's system checks) before the worker imports any task module, so models can be imported in tasks.
5. Connects to `worker_init` to install the worker-specific part.

Sources: [celery/fixups/django.py:101-127](repo://celery/fixups/django.py#L101-L127), [celery/fixups/django.py:146-154](repo://celery/fixups/django.py#L146-L154)

`celery --skip-checks` sets `CELERY_SKIP_CHECKS` ([[Command-Line Interface]]).

Sources: [celery/bin/celery.py:132-133](repo://celery/bin/celery.py#L132-L133)

### Autodiscovery

`app.autodiscover_tasks()` with no packages asks each fix-up for packages, and the Django fix-up returns the name of every installed app config. The worker then imports `<app>.tasks` for each one that has such a module ([[Configuration and Loaders]]).

Sources: [celery/fixups/django.py:121-123](repo://celery/fixups/django.py#L121-L123), [celery/app/base.py:828-844](repo://celery/app/base.py#L828-L844)

## Database connections in workers

### Why connections are closed

Django normally opens a database connection per request and closes it at the end of the request. A worker has no requests, and prefork children inherit their parent's open sockets, so `DjangoWorkerFixup` manages connections around tasks and forks through signals ([[Signals]]).

Sources: [celery/fixups/django.py:130-163](repo://celery/fixups/django.py#L130-L163)

| Signal | Action |
| --- | --- |
| Worker start | Close database connections and caches in the parent |
| `worker_process_init` | In each child: re-run `django.setup()` if the child was spawned rather than forked, close inherited connection file descriptors without network I/O, then close connections and caches |
| `task_prerun` | Close stale connections before the task (not for eager tasks) |
| `task_postrun` | Close connections and caches after the task (not for eager tasks) |
| `beat_embedded_init` | Close connections in an embedded beat process |

Sources: [celery/fixups/django.py:156-203](repo://celery/fixups/django.py#L156-L203)

Closing the inherited file descriptor directly, instead of calling `close()`, matters: closing a connection over the network from the child would also break the parent's connection on the same socket.

Sources: [celery/fixups/django.py:165-192](repo://celery/fixups/django.py#L165-L192), [celery/fixups/django.py:39-44](repo://celery/fixups/django.py#L39-L44)

### Reusing connections

Closing after every task costs a reconnect per task. Setting `CELERY_DB_REUSE_MAX = N` makes `close_database` close connections only every `2 × N` calls (prerun and postrun each count), so a connection is reused for about `N` tasks. Errors from already-closed connections are ignored. When Django's connection pooling is enabled for a database (`OPTIONS['pool']`) and the worker uses the prefork pool, the pool itself is also closed, since a pool cannot be shared across processes.

Sources: [celery/fixups/django.py:205-240](repo://celery/fixups/django.py#L205-L240)

## DjangoTask and transactions

A task sent inside a database transaction can start before the transaction commits and then not find the rows it was meant to process. `DjangoTask` adds two methods that defer sending until the transaction commits, using Django's `transaction.on_commit`:

Sources: [celery/contrib/django/task.py:8-21](repo://celery/contrib/django/task.py#L8-L21)

| Method | Equivalent to |
| --- | --- |
| `task.delay_on_commit(*args, **kwargs)` | `transaction.on_commit(lambda: task.delay(*args, **kwargs))` |
| `task.apply_async_on_commit(args, kwargs, **options)` | `transaction.on_commit(lambda: task.apply_async(...))` |

Sources: [celery/contrib/django/task.py:15-21](repo://celery/contrib/django/task.py#L15-L21)

Both return `None` rather than an `AsyncResult`, because the task id is not known until the message is actually sent. Outside a transaction (autocommit mode) Django runs the callback immediately.

Sources: [celery/contrib/django/task.py:15-17](repo://celery/contrib/django/task.py#L15-L17)

```python
from django.db import transaction
from demoapp.tasks import rename_widget

with transaction.atomic():
    widget = Widget.objects.create(name='draft')
    rename_widget.delay_on_commit(widget.id, 'final')
```

Sources: [examples/django/demoapp/tasks.py:1-32](repo://examples/django/demoapp/tasks.py#L1-L32), [celery/contrib/django/task.py:15-17](repo://celery/contrib/django/task.py#L15-L17)

## Related tools

Result storage in the Django database and database-backed periodic schedules are provided by the separate `django-celery-results` and `django-celery-beat` packages, which plug in through the result backend and beat scheduler extension points ([[Backend Catalogue]], [[Periodic Tasks with Beat]]). The SQLAlchemy database backend in Celery itself can also point at the same database.

Sources: [celery/app/backends.py:41-55](repo://celery/app/backends.py#L41-L55), [celery/beat.py:666-675](repo://celery/beat.py#L666-L675)
