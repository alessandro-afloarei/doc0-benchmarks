---
title: "Django Integration"
---
## Overview

Celery works with Django without an extra package. Every app carries a built-in Django fix-up that activates when `DJANGO_SETTINGS_MODULE` is set: it sets up Django before task modules are imported, discovers `tasks.py` in installed apps, uses Django's timezone-aware clock, manages database connections around tasks and forks, and makes `DjangoTask` the base task class so tasks can be sent when a transaction commits. Settings live in `settings.py` under a `CELERY_` prefix. The repository's `examples/django` project shows the standard layout.

Sources: [celery/app/base.py:82-84](repo://celery/app/base.py#L82-L84), [celery/fixups/django.py:52-89](repo://celery/fixups/django.py#L52-L89)

## Project layout

The convention is a `celery.py` module next to `settings.py`. It sets the settings module, creates the app, loads configuration from Django settings with the `CELERY` namespace, and asks for task autodiscovery. Using the string `'django.conf:settings'` rather than the settings object keeps the configuration lazy and out of pickled app state.

Sources: [examples/django/proj/celery.py:1-22](repo://examples/django/proj/celery.py#L1-L22)

```python
import os

from celery import Celery

# Set the default Django settings module for the 'celery' program.
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'proj.settings')

app = Celery('proj')

# - namespace='CELERY' means all celery-related configuration keys
#   should have a `CELERY_` prefix.
app.config_from_object('django.conf:settings', namespace='CELERY')

# Load task modules from all registered Django apps.
app.autodiscover_tasks()
```

Sources: [examples/django/proj/celery.py:1-17](repo://examples/django/proj/celery.py#L1-L17)

The project package's `__init__.py` imports this app so it is created when Django starts, which makes `shared_task` decorators in reusable apps bind to it. Workers start with `celery -A proj worker -l INFO` from the project directory.

Sources: [examples/django/proj/__init__.py:1-5](repo://examples/django/proj/__init__.py#L1-L5), [celery/app/utils.py:378-415](repo://celery/app/utils.py#L378-L415)

## Settings with the CELERY namespace

With `namespace='CELERY'`, every Celery setting is read from `settings.py` with a `CELERY_` prefix and in upper case: `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND`, `CELERY_TASK_SERIALIZER`, `CELERY_BEAT_SCHEDULE`. The namespace makes `Settings` look keys up as `CELERY_<key>` first, and forces the new setting names, so old names like `CELERYD_CONCURRENCY` are not recognized under a namespace ([[Configuration and Loaders]]). `timezone` also falls back to Django's `TIME_ZONE`.

Sources: [examples/django/proj/settings.py:8-16](repo://examples/django/proj/settings.py#L8-L16), [celery/utils/collections.py:367-382](repo://celery/utils/collections.py#L367-L382), [celery/app/utils.py:129-131](repo://celery/app/utils.py#L129-L131), [celery/app/utils.py:262-264](repo://celery/app/utils.py#L262-L264)

```python
# settings.py
CELERY_BROKER_URL = 'amqp://guest:guest@localhost'
CELERY_ACCEPT_CONTENT = ['json']
CELERY_RESULT_BACKEND = 'db+sqlite:///results.sqlite'
CELERY_TASK_SERIALIZER = 'json'
```

Sources: [examples/django/proj/settings.py:10-16](repo://examples/django/proj/settings.py#L10-L16)

## Tasks in Django apps

`app.autodiscover_tasks()` with no package list asks the fix-ups for packages; the Django fix-up returns the name of every installed app config, and the loader imports `<app>.tasks` where it exists when the worker imports its modules. Reusable apps define tasks with `shared_task`, so they do not need to import the project's app.

Sources: [celery/app/base.py:782-843](repo://celery/app/base.py#L782-L843), [celery/fixups/django.py:121-123](repo://celery/fixups/django.py#L121-L123)

```python
from demoapp.models import Widget

from celery import shared_task


@shared_task
def count_widgets():
    return Widget.objects.count()


@shared_task
def rename_widget(widget_id, name):
    w = Widget.objects.get(id=widget_id)
    w.name = name
    w.save()
```

Sources: [examples/django/demoapp/tasks.py:1-32](repo://examples/django/demoapp/tasks.py#L1-L32)

Pass model ids rather than model instances: the row may change between sending and running, and instances cannot be serialized with JSON.

Sources: [examples/django/demoapp/tasks.py:23-32](repo://examples/django/demoapp/tasks.py#L23-L32)

## How the fix-up works

### Activation

`fixup(app)` runs for every app at construction. It does nothing unless `DJANGO_SETTINGS_MODULE` is set; then it imports Django (warning with `FixupWarning` if it is missing), requires Django 1.11 or later, and installs `DjangoFixup`. Installing adds the current directory to `sys.path`, replaces the loader's `now` with `django.utils.timezone.now`, sets `celery.contrib.django.task:DjangoTask` as the task base class unless a custom `task_cls` was given, and connects to `import_modules` and `worker_init`.

Sources: [celery/fixups/django.py:52-127](repo://celery/fixups/django.py#L52-L127), [celery/app/base.py:409-413](repo://celery/app/base.py#L409-L413)

### Setting Django up in the worker

When the worker imports task modules, `on_import_modules` calls `django.setup()` and runs Django's system checks, so models are ready before any `tasks.py` imports them. `--skip-checks` (or `CELERY_SKIP_CHECKS`) skips the checks for faster start-up.

Sources: [celery/fixups/django.py:101-103](repo://celery/fixups/django.py#L101-L103), [celery/fixups/django.py:146-154](repo://celery/fixups/django.py#L146-L154), [celery/bin/celery.py:105-133](repo://celery/bin/celery.py#L105-L133)

### Database connections

On `worker_init`, `DjangoWorkerFixup` connects to `task_prerun`, `task_postrun`, `worker_process_init` and `beat_embedded_init`, and closes the database connections and caches the main process opened. Django normally closes connections at the end of each HTTP request; in a worker there are no requests, so the fix-up closes them around each task instead, which avoids using connections the database has already dropped. Eager tasks are skipped because they run inside the caller's request or test.

Sources: [celery/fixups/django.py:105-116](repo://celery/fixups/django.py#L105-L116), [celery/fixups/django.py:156-203](repo://celery/fixups/django.py#L156-L203)

Each forked pool child must not share the parent's database sockets, so `on_worker_process_init` closes the inherited file descriptors directly (calling `close()` could disturb the parent's connection) and then the connections and caches. Children started with `execv` (Windows) run `django.setup()` and the checks again.

Sources: [celery/fixups/django.py:165-192](repo://celery/fixups/django.py#L165-L192)

`CELERY_DB_REUSE_MAX` keeps connections open across tasks and closes them only every `2 × CELERY_DB_REUSE_MAX` calls. With Django's connection pooling (`OPTIONS['pool']`) under the prefork pool, closing also closes the pool, so forked children do not reuse pooled connections. Errors that say the connection is already closed are ignored.

Sources: [celery/fixups/django.py:130-144](repo://celery/fixups/django.py#L130-L144), [celery/fixups/django.py:205-246](repo://celery/fixups/django.py#L205-L246)

## Sending tasks after commit

A task sent inside a database transaction can start before the transaction commits and not find the rows it needs, or run for a transaction that is later rolled back. `DjangoTask` adds `delay_on_commit(*args, **kwargs)` and `apply_async_on_commit(...)`, which register the send with `transaction.on_commit`, so the message is published only after a successful commit and never after a rollback. Unlike `delay`, they return `None`, since no task id exists until the commit.

Sources: [celery/contrib/django/task.py:1-21](repo://celery/contrib/django/task.py#L1-L21)

```python
from django.db import transaction


def create_widget(request):
    with transaction.atomic():
        widget = Widget.objects.create(name=request.POST['name'])
        rename_widget.delay_on_commit(widget.id, widget.name.title())
```

Sources: [celery/contrib/django/task.py:15-21](repo://celery/contrib/django/task.py#L15-L21)

## Results and beat with Django

The fix-up does not provide result storage or a database scheduler. Results can go to any backend ([[Result Backends]]), including the SQLAlchemy `db+` backend the example uses. The separate django-celery-results and django-celery-beat packages store results and periodic schedules in Django models; the latter plugs in as `beat_scheduler` ([[Periodic Tasks with Beat]]).

Sources: [examples/django/proj/settings.py:15-15](repo://examples/django/proj/settings.py#L15-L15), [celery/beat.py:663-673](repo://celery/beat.py#L663-L673)
