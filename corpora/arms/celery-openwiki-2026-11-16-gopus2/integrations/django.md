---
type: integration
title: Django Integration
description: How Celery integrates with Django without a separate package — the automatically installed Django fixup (activation, django.setup and system checks, task autodiscovery from INSTALLED_APPS, database and cache connection hygiene around forks and tasks) and DjangoTask's delay_on_commit/apply_async_on_commit helpers.
tags: [django, fixup, integration, database, transactions]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:05:29.073Z
sources:
  - id: openwiki-source-650c0d51beedca1446741693
    resource: repo://celery/contrib/django/task.py
  - id: openwiki-source-bdd128d49c4b8a546ae88464
    resource: repo://celery/fixups/django.py
generated: { by: "claude-code", at: "2026-11-16T17:05:29.073Z" }
---

# Django Integration

Celery supports Django directly through two pieces of code:

- `celery/fixups/django.py` — the **Django fixup**, applied automatically to every app (it is the only entry in `BUILTIN_FIXUPS`, see [Application Object](../architecture/application-object.md)).
- `celery/contrib/django/task.py` — `DjangoTask`, the default task base class when the fixup is active.

The canonical project layout is in `examples/django/` and documented in `docs/django/first-steps-with-django.rst`:

```python
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'proj.settings')
app = Celery('proj')
app.config_from_object('django.conf:settings', namespace='CELERY')
app.autodiscover_tasks()
```

`namespace='CELERY'` makes every Celery setting read from Django settings with a `CELERY_` prefix (`CELERY_BROKER_URL`, `CELERY_TASK_ALWAYS_EAGER`); see [Configuration System](../architecture/configuration.md).

## Activation

`fixup(app)` runs during `Celery.__init__` and installs `DjangoFixup` only when:

1. `DJANGO_SETTINGS_MODULE` is set in the environment, **and**
2. the app's loader class name does not contain `django` (to avoid clashing with legacy django-celery loaders).

If Django cannot be imported, a `FixupWarning` is issued and nothing is installed. Django older than 1.11 raises `ImproperlyConfigured`.

## What `DjangoFixup.install()` does

- Makes the app the **default app** if none has been set yet (in the constructor), so `shared_task` and `current_app` resolve to the project app.
- Prepends the current working directory to `sys.path` so the project package is importable.
- Replaces `app.loader.now` with Django's timezone-aware `django.utils.timezone.now` (or UTC now when `utc=True`).
- Sets `app.task_cls = 'celery.contrib.django.task:DjangoTask'` unless the user supplied a custom task class (`task_cls=` argument or a `Celery` subclass with `task_cls`).
- Connects `import_modules` → `django.setup()` plus Django system checks (`run_checks()`), skipped when `CELERY_SKIP_CHECKS` is set. This happens before task modules are imported at worker start.
- Connects `worker_init` → installs the worker-side `DjangoWorkerFixup`.
- Provides `autodiscover_tasks()` returning the names of all installed Django app configs, which `app.autodiscover_tasks()` uses when called without packages.

## Worker-side connection hygiene (`DjangoWorkerFixup`)

Database connections must not be shared across processes or leak between tasks. On install the worker fixup closes DB connections and caches, then connects:

| Signal | Action |
|--------|--------|
| `worker_process_init` | In pool child processes: re-run `django.setup()`/checks if started via execv (`FORKED_BY_MULTIPROCESSING`), close inherited DB sockets at the file-descriptor level (avoiding network I/O that could break the parent's connection), then close databases and caches |
| `task_prerun` | Close DB connections before each non-eager task (equivalent to Django's per-request connection management) |
| `task_postrun` | Close DB connections and caches after each non-eager task |
| `beat_embedded_init` | Close DB connections when beat runs embedded in the worker |

`close_database()` honours `CELERY_DB_REUSE_MAX`: when set, connections are only actually closed every `2 × CELERY_DB_REUSE_MAX` calls. `_close_database()` iterates initialized connections, ignores `InterfaceError` and "closed"/"not connected" `DatabaseError`s, and — for prefork workers using Django's native connection pooling (`DATABASES[alias]['OPTIONS']['pool']`) — also calls `close_pool()` so children do not reuse the parent's pool.

## `DjangoTask`

`DjangoTask` extends `Task` with transaction-aware publishing:

- `task.delay_on_commit(*args, **kwargs)` → `transaction.on_commit(partial(task.delay, ...))`
- `task.apply_async_on_commit(*args, **kwargs)` → same for `apply_async`

These avoid the classic race where a worker picks up a task referencing a row before the creating transaction commits. Both return `None` (no `AsyncResult`), because the message may never be sent if the transaction rolls back.

## Related tooling outside this repository

Database-backed result storage and periodic schedules come from separate projects (`django-celery-results`, `django-celery-beat`); Celery integrates with them through the generic result backend URL and `beat_scheduler` setting rather than special code here.

## Tests

- `t/unit/fixups/test_django.py` — activation conditions, task class override, signal wiring, DB close logic (including reuse and pool handling).
- `t/unit/contrib/django/test_task.py` — `DjangoTask` helpers.
- `t/integration/test_worker.py` uses `t/integration/django_settings.py` to exercise a worker with the fixup active.

## Related

- [The Celery Application Object](../architecture/application-object.md)
- [Task Definition and Invocation](../tasks/task-definition-and-invocation.md)
