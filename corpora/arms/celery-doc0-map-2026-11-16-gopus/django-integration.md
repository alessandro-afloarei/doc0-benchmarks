---
title: "Django Integration"
---
## Overview

Celery works with Django without a separate package. A built-in fixup, `celery.fixups.django`, is installed on every app whose process has `DJANGO_SETTINGS_MODULE` set. It initializes Django before task modules are imported, uses Django's clock, discovers tasks in installed apps, switches the default task class to one with transaction-aware helpers, and on the worker closes database connections and caches around each task and after forks. The project only needs a small `celery.py` module, as in `examples/django`.

Sources: [celery/fixups/django.py:52-89](repo://celery/fixups/django.py#L52-L89), [celery/app/base.py:84-86](repo://celery/app/base.py#L84-L86), [examples/django/proj/celery.py:1-22](repo://examples/django/proj/celery.py#L1-L22)

## Project layout

The example project defines the app in `proj/celery.py`:

Sources: [examples/django/proj/celery.py:8-8](repo://examples/django/proj/celery.py#L8-L8)

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

Setting `DJANGO_SETTINGS_MODULE` before creating the app matters because the fixup is chosen in the app constructor. Reading `django.conf:settings` with `namespace='CELERY'` makes Celery look for `CELERY_`-prefixed names, so `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND` and `CELERY_TASK_SERIALIZER` in `settings.py` configure the app; with a prefix, the new setting names are always used ([[Configuration and Loaders]]). `Settings.timezone` also falls back to Django's `TIME_ZONE`.

Sources: [examples/django/proj/settings.py:10-16](repo://examples/django/proj/settings.py#L10-L16), [celery/app/utils.py:262-265](repo://celery/app/utils.py#L262-L265), [celery/app/utils.py:124-127](repo://celery/app/utils.py#L124-L127)

App task modules use `@shared_task`, so they do not import the project's app ([[Defining Tasks]]):

Sources: [examples/django/demoapp/tasks.py:5-10](repo://examples/django/demoapp/tasks.py#L5-L10)

```python
from demoapp.models import Widget

from celery import shared_task


@shared_task
def count_widgets():
    return Widget.objects.count()
```

Sources: [examples/django/demoapp/tasks.py:3-25](repo://examples/django/demoapp/tasks.py#L3-L25)

The worker is then started with `celery -A proj worker`, from the directory containing the project ([[Command Line Interface]]).

Sources: [celery/fixups/django.py:75-79](repo://celery/fixups/django.py#L75-L79)

## Installing the fixup

`fixup(app)` runs for every app, since `celery.fixups.django:fixup` is in `BUILTIN_FIXUPS`. It does nothing unless `DJANGO_SETTINGS_MODULE` is set and the app is not using a Django-specific loader. If Django cannot be imported it warns with `FixupWarning`; Django older than 1.11 raises `ImproperlyConfigured`.

Sources: [celery/fixups/django.py:33-63](repo://celery/fixups/django.py#L33-L63)

`DjangoFixup` makes the app the default app if there is none yet. `install()` then:

Sources: [celery/fixups/django.py:69-75](repo://celery/fixups/django.py#L69-L75)

1. Prepends the current directory to `sys.path` so the project's modules take precedence.
2. Replaces the loader's `now()` with Django's `django.utils.timezone.now` for local time.
3. Sets `app.task_cls` to `celery.contrib.django.task:DjangoTask`, unless the app was given its own task class.
4. Connects `on_import_modules` to `import_modules` and `on_worker_init` to `worker_init`.

Sources: [celery/fixups/django.py:66-127](repo://celery/fixups/django.py#L66-L127), [celery/app/base.py:360-366](repo://celery/app/base.py#L360-L366)

Before task modules are imported, `on_import_modules` calls `django.setup()` and runs Django's system checks, which `celery --skip-checks` or `CELERY_SKIP_CHECKS` turn off ([[Command Line Interface]]). This is what lets task modules import models.

Sources: [celery/fixups/django.py:101-103](repo://celery/fixups/django.py#L101-L103), [celery/fixups/django.py:146-154](repo://celery/fixups/django.py#L146-L154), [celery/bin/celery.py:134-135](repo://celery/bin/celery.py#L134-L135)

## Task autodiscovery

`app.autodiscover_tasks()` with no packages asks fixups for package names, and `DjangoFixup.autodiscover_tasks()` returns the name of every installed app config. The worker then imports `<app>.tasks` for each one that has such a module when it imports its default modules ([[Configuration and Loaders]]).

Sources: [celery/fixups/django.py:121-123](repo://celery/fixups/django.py#L121-L123), [celery/app/base.py:828-844](repo://celery/app/base.py#L828-L844)

## Transaction-aware calls

`DjangoTask`, the default base class under Django, adds two methods that wait for the current database transaction:

Sources: [celery/contrib/django/task.py:8-13](repo://celery/contrib/django/task.py#L8-L13), [celery/fixups/django.py:84-85](repo://celery/fixups/django.py#L84-L85)

```python
def delay_on_commit(self, *args, **kwargs) -> None:
    """Call :meth:`~celery.app.task.Task.delay` with Django's ``on_commit()``."""
    transaction.on_commit(functools.partial(self.delay, *args, **kwargs))

def apply_async_on_commit(self, *args, **kwargs) -> None:
    """Call :meth:`~celery.app.task.Task.apply_async` with Django's ``on_commit()``."""
    transaction.on_commit(functools.partial(self.apply_async, *args, **kwargs))
```

Sources: [celery/contrib/django/task.py:8-21](repo://celery/contrib/django/task.py#L8-L21)

Each method hands a partial of `delay` or `apply_async` to Django's `transaction.on_commit`, so the message is published by Django's commit hook rather than at the call. The docstring describes the purpose as triggering tasks "at the end of the DB transaction". Both methods return `None` rather than an `AsyncResult` ([[Sending Tasks]]).

Sources: [celery/contrib/django/task.py:15-21](repo://celery/contrib/django/task.py#L15-L21)

## Database connections on the worker

When the worker initializes, `on_worker_init` stores the worker (to know its pool type) and installs `DjangoWorkerFixup`, which closes existing database connections and caches and connects:

Sources: [celery/fixups/django.py:156-163](repo://celery/fixups/django.py#L156-L163)

| Signal | Action |
| --- | --- |
| `task_prerun` | Close database connections, unless the task runs eagerly |
| `task_postrun` | Close database connections and caches, unless eager |
| `worker_process_init` | In each new pool child: re-run setup if started by execv, then drop inherited connections |
| `beat_embedded_init` | Close database connections in an embedded beat process |

Sources: [celery/fixups/django.py:105-116](repo://celery/fixups/django.py#L105-L116), [celery/fixups/django.py:156-203](repo://celery/fixups/django.py#L156-L203)

In a forked child, the connections inherited from the parent are not closed normally: the comment explains that calling `close()` on some connections "will cause the inherited DB conn to also get broken in the parent process", so the fixup closes their file descriptors directly without network traffic, then closes everything else. Children started with execv (`FORKED_BY_MULTIPROCESSING`, as on Windows) run `django.setup()` and the checks again.

Sources: [celery/fixups/django.py:39-44](repo://celery/fixups/django.py#L39-L44), [celery/fixups/django.py:165-192](repo://celery/fixups/django.py#L165-L192)

`close_database` closes every initialized connection, ignoring `InterfaceError` and database errors whose message says the connection is already closed. With the `CELERY_DB_REUSE_MAX` setting, connections are closed only every `2 * CELERY_DB_REUSE_MAX` calls instead of around every task, so they can be reused across tasks. When a connection uses Django's connection pool (`OPTIONS['pool']`) and the worker runs the prefork pool, the pool itself is also closed.

Sources: [celery/fixups/django.py:130-144](repo://celery/fixups/django.py#L130-L144), [celery/fixups/django.py:205-246](repo://celery/fixups/django.py#L205-L246)

The worker banner does not warn about old setting names when the configuration comes from `django.conf:settings` ([[Worker Startup and Bootsteps]]).

Sources: [celery/apps/worker.py:151-166](repo://celery/apps/worker.py#L151-L166)
