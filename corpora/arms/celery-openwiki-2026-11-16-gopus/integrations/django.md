---
type: integration
title: Django Integration
description: How Celery integrates with Django without a separate package — the built-in Django fixup activated by DJANGO_SETTINGS_MODULE, settings loading with the CELERY namespace, task autodiscovery from INSTALLED_APPS, database/cache connection hygiene around tasks and forks, and the DjangoTask on-commit helpers.
tags: [django, fixup, integration, database, autodiscover]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:57:55.789Z
sources:
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-650c0d51beedca1446741693
    resource: repo://celery/contrib/django/task.py
  - id: openwiki-source-bdd128d49c4b8a546ae88464
    resource: repo://celery/fixups/django.py
  - id: openwiki-source-856b7a21a3f67aa222e23609
    resource: repo://examples/django/proj/celery.py
generated: { by: "claude-code", at: "2026-11-16T06:57:55.789Z" }
---

# Django Integration

Celery supports Django directly through a **fixup** in
`celery/fixups/django.py`, applied to every app (it is the only entry in
`BUILTIN_FIXUPS`, see [App and configuration](../architecture/app-and-configuration.md)),
plus a task base class in `celery/contrib/django/task.py`. The canonical
project layout is in `examples/django/`.

## Typical project setup

`examples/django/proj/celery.py`:

```python
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'proj.settings')
app = Celery('proj')
app.config_from_object('django.conf:settings', namespace='CELERY')
app.autodiscover_tasks()
```

- `namespace='CELERY'` means only `CELERY_`-prefixed Django settings are read
  (`CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND`, ...). The worker suppresses
  the "deprecated settings" warning when the config source is
  `django.conf:settings`.
- `autodiscover_tasks()` without arguments asks each fixup for packages; the
  Django fixup returns the names of all `INSTALLED_APPS` configs, and
  `<app>.tasks` modules are imported **lazily** when the `import_modules`
  signal fires (worker startup), not at call time (unless `force=True`).
- Reusable apps should use `@shared_task`, which binds to whichever app is
  current.

## Activation

`fixup(app)` installs `DjangoFixup` only when:

- `DJANGO_SETTINGS_MODULE` is set, and
- the app's loader class name does not contain `django` (legacy
  django-celery loaders handle this themselves).

If Django cannot be imported a `FixupWarning` is emitted; Django older than
1.11 raises `ImproperlyConfigured`.

## DjangoFixup (all processes)

`DjangoFixup.install()`:

- makes the app the default app if there is none;
- prepends the current working directory to `sys.path` (project modules
  shadow installed ones);
- replaces `app.loader.now` so non-UTC "now" uses `django.utils.timezone.now`;
- sets `app.task_cls = 'celery.contrib.django.task:DjangoTask'` **unless the
  user supplied a custom task class** (`_custom_task_cls_used`);
- connects `import_modules` → `django.setup()` plus `run_checks()` (system
  checks are skipped if `CELERY_SKIP_CHECKS` is set) **before task modules
  are imported**, so models are ready;
- connects `worker_init` → install the worker fixup.

## DjangoWorkerFixup (worker only)

Installed on `worker_init`, it keeps Django database and cache connections
safe across forks and long-running processes:

| Hook | Action |
|------|--------|
| install | Close DB connections and caches in the parent |
| `worker_process_init` (each pool child) | Re-run `django.setup()` + checks if the child was started via execv (`FORKED_BY_MULTIPROCESSING`); close inherited DB sockets at the **file-descriptor level** (`os.close(fd)`) to avoid network I/O that would break the parent's connection, then close connections and caches |
| `task_prerun` | Close DB connections (skipped for eager tasks) |
| `task_postrun` | Close DB connections and caches (skipped for eager tasks) |
| `beat_embedded_init` | Close DB connections |

Closing connections around every task mirrors Django's per-request connection
handling, so stale or broken connections are not reused between tasks.
`CELERY_DB_REUSE_MAX` relaxes this: connections are only closed every
`2 × CELERY_DB_REUSE_MAX` close requests. With Django's native connection
pooling (`DATABASES[alias]['OPTIONS']['pool']`) under the prefork pool, the
pool is also closed (`close_pool`). `InterfaceError`s and "closed / not
connected" `DatabaseError`s are ignored during close.

## DjangoTask

`celery/contrib/django/task.py` adds transaction-aware publishing:

- `task.delay_on_commit(*args, **kwargs)`
- `task.apply_async_on_commit(*args, **kwargs)`

Both wrap the call in `django.db.transaction.on_commit`, so the message is
only sent if (and after) the current transaction commits — avoiding workers
that run before the rows they need are visible. They return `None`, not an
`AsyncResult`.

## Related tools

Database-backed result storage and schedules are provided by the separate
`django-celery-results` (`result_backend = 'django-db'` via the
`celery.result_backends` entry point) and `django-celery-beat`
(`beat_scheduler` alias from `celery.beat_schedulers`) packages; see
[Result backends](../architecture/result-backends.md) and
[Beat](../architecture/beat-scheduler.md) for the extension points they use.

## Tests

- `t/unit/fixups/test_django.py` – activation rules, connection closing,
  pool handling, task class substitution.
- `t/unit/contrib/django/` – `DjangoTask` helpers.
- `t/integration/test_worker.py` – runs a worker with `DJANGO_SETTINGS_MODULE=t.integration.django_settings`.
