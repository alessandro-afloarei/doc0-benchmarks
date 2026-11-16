---
type: integration
title: Django Integration and Fixups
description: How Celery integrates with Django without a separate package. The built-in DjangoFixup activates on DJANGO_SETTINGS_MODULE, runs django.setup() and system checks before task modules are imported, swaps in DjangoTask, uses Django's timezone, and manages database and cache connections around tasks and forked pool processes.
tags: [django, fixups, integration, database-connections, transactions]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:49.645Z
sources:
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-650c0d51beedca1446741693
    resource: repo://celery/contrib/django/task.py
  - id: openwiki-source-bdd128d49c4b8a546ae88464
    resource: repo://celery/fixups/django.py
generated: { by: "claude-code", at: "2026-11-15T17:08:49.645Z" }
---

# Django Integration and Fixups

Celery supports Django directly. No `django-celery` package is needed. The integration has three parts:

1. **App configuration** written by the user. `examples/django/proj/celery.py` shows the pattern.
2. **The Django fixup** (`celery/fixups/django.py`). Every app loads it automatically, but it only becomes active under Django.
3. **`DjangoTask`** (`celery/contrib/django/task.py`), which adds transaction-aware enqueueing.

## Recommended project setup

```python
# proj/celery.py
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'proj.settings')
app = Celery('proj')
app.config_from_object('django.conf:settings', namespace='CELERY')
app.autodiscover_tasks()
```

```python
# proj/__init__.py
from .celery import app as celery_app
```

`namespace='CELERY'` means Celery reads only settings with the `CELERY_` prefix, such as `CELERY_BROKER_URL` or `CELERY_TASK_ALWAYS_EAGER`, using the new-style names in upper case (see [Configuration](../reference/configuration.md)). Calling `autodiscover_tasks()` with no arguments asks the fixup for packages. `DjangoFixup.autodiscover_tasks()` returns the name of every installed app config, and the loader imports `<app>.tasks` from each one when the worker imports its default modules.

## Activation

`Celery.builtin_fixups` contains `celery.fixups.django:fixup`, and every new app calls it. `fixup(app)` installs `DjangoFixup` only when **all** of these are true:

- `DJANGO_SETTINGS_MODULE` is set;
- the app's loader class name does not contain `django`, so legacy django loaders are skipped;
- `import django` succeeds. If it fails, a `FixupWarning` is emitted and nothing is installed;
- Django is version 1.11 or newer. Older versions raise `ImproperlyConfigured`.

To opt out, pass `Celery(fixups=[])`.

## What `DjangoFixup.install()` does

- If no default app exists yet, the app becomes the default app (in `__init__`).
- It prepends the current working directory to `sys.path`, so the project package can be imported.
- It replaces `app.loader.now` with Django's `django.utils.timezone.now`, so non-UTC "now" follows Django's `USE_TZ` and `TIME_ZONE`.
- If the user did not choose a custom task class, it sets `app.task_cls = 'celery.contrib.django.task:DjangoTask'`.
- It connects `import_modules` → `on_import_modules`, which calls `django.setup()` and then `django.core.checks.run_checks()` before any task module is imported. Set `CELERY_SKIP_CHECKS` to skip the checks.
- It connects `worker_init` → `on_worker_init`, which records the worker instance and installs `DjangoWorkerFixup`.

## Worker-side connection management (`DjangoWorkerFixup`)

Django's persistent database connections and cache connections are not safe to share across forked processes, and long-running workers should not keep them open between tasks. The worker fixup connects:

| Signal | Action |
|---|---|
| install time | close DB connections and caches in the parent before the pool forks |
| `worker_process_init` (each pool child) | Re-run `django.setup()` and checks if `FORKED_BY_MULTIPROCESSING` (execv/Windows). Close inherited DB sockets at the file-descriptor level (`os.close(fd)`) **without** a network close, so the parent's connection is not broken. Then close DB connections and caches. |
| `task_prerun` | `close_database()` unless the task runs eagerly |
| `task_postrun` | `close_database()` and `close_cache()` unless eager |
| `beat_embedded_init` | `close_database()` |

`close_database()` honours `CELERY_DB_REUSE_MAX`. When it is set, connections are actually closed only every `2 × CELERY_DB_REUSE_MAX` calls (prerun plus postrun), so a connection is reused for about that many tasks. `_close_database()` iterates over initialized connections (it falls back on Django < 4.1) and calls `conn.close()`. With the **prefork** pool and a database alias that has `OPTIONS['pool']` enabled (Django 5.1+ connection pooling), it also calls `conn.close_pool()` so that child processes don't inherit pools. `InterfaceError` is ignored, and so is any `DatabaseError` whose message contains "closed" or "not connected". Other database errors propagate.

Eager tasks (`request.is_eager`) are skipped so that tasks run in tests or in-process under `task_always_eager` don't close the caller's connections, which may be inside a transaction.

## `DjangoTask`: enqueue after commit

```python
@shared_task
def send_email(user_pk): ...

def view(request):
    with transaction.atomic():
        user = User.objects.create(...)
        send_email.delay_on_commit(user.pk)
```

`delay_on_commit()` and `apply_async_on_commit()` wrap `delay` and `apply_async` in `django.db.transaction.on_commit`. The message is only sent if the transaction commits, which avoids workers seeing rows that aren't committed yet. These methods return `None`, not an `AsyncResult`, because the task ID is unknown until commit.

## Tests and docs

- `t/unit/fixups/test_django.py` tests the fixup's activation rules and connection handling.
- `t/unit/contrib/django/` contains unit tests for `DjangoTask`.
- `docs/django/first-steps-with-django.rst` is the user guide, and `examples/django/` is a runnable sample project.

## See also

- [The Celery Application Object](../architecture/application.md)
- [Tasks: Definition, Invocation, Retries](../tasks/task-lifecycle.md)
