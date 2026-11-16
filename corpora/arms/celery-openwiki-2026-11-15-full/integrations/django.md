---
type: integration
title: Django Integration
description: How Celery integrates with Django without a separate package — the built-in Django fixup activated by DJANGO_SETTINGS_MODULE, django.setup() and system checks before task import, database/cache connection handling around tasks and forks, autodiscovery from installed apps, and DjangoTask.delay_on_commit.
tags: [django, fixup, integration, database, transactions]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T09:27:53.075Z
sources:
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-650c0d51beedca1446741693
    resource: repo://celery/contrib/django/task.py
  - id: openwiki-source-bdd128d49c4b8a546ae88464
    resource: repo://celery/fixups/django.py
generated: { by: "claude-code", at: "2026-11-15T09:27:53.075Z" }
---

# Django Integration

Celery supports Django out of the box through a **fixup** (`celery/fixups/django.py`) that every app loads (`BUILTIN_FIXUPS = {'celery.fixups.django:fixup'}` in `celery/app/base.py`) plus a Django-aware task base class (`celery/contrib/django/task.py`). The typical project layout is a `proj/celery.py` that creates `app = Celery('proj')`, calls `app.config_from_object('django.conf:settings', namespace='CELERY')` and `app.autodiscover_tasks()`.

## Activation

`fixup(app)` installs `DjangoFixup` only when:

- the `DJANGO_SETTINGS_MODULE` environment variable is set, and
- the app's loader class name does not contain `django` (legacy `django-celery` loaders handle this themselves).

If Django isn't importable a `FixupWarning` is issued and nothing is installed; Django older than 1.11 raises `ImproperlyConfigured`.

## What `DjangoFixup` does

On construction it makes the app the **default app** if none has been set. `install()` then:

- Prepends the current working directory to `sys.path` so the project package is importable.
- Replaces `app.loader.now` with Django's `django.utils.timezone.now` (for non-UTC calls), so Celery honours Django's timezone handling.
- Sets the app's task class to `celery.contrib.django.task:DjangoTask`, **unless** a custom `task_cls` was supplied to the app (`_custom_task_cls_used`).
- Connects `import_modules` → `validate_models()`: calls `django.setup()` and, unless `CELERY_SKIP_CHECKS` is set (CLI `--skip-checks`), `django.core.checks.run_checks()` — this happens *before* task modules are imported, so models are ready.
- Connects `worker_init` → installs the worker-side fixup.
- Provides `autodiscover_tasks()` returning every installed app's name; `app.autodiscover_tasks()` with no packages uses it (see [Application Object and Configuration](../app/application-and-configuration.md#loaders)).

## Worker-side connection management (`DjangoWorkerFixup`)

Django's persistent DB connections are not safe to share across forks or to keep open indefinitely in a long-lived worker. The worker fixup connects to:

| Signal | Action |
| --- | --- |
| install (worker init) | Close DB connections and caches in the parent |
| `worker_process_init` | In each pool child: re-run `validate_models()` if started via `execv` (`FORKED_BY_MULTIPROCESSING`), close inherited DB sockets by **file descriptor** (avoiding network I/O that would break the parent's connection), then close connections and caches |
| `task_prerun` | Close DB connections before each non-eager task |
| `task_postrun` | Close DB connections and caches after each non-eager task |
| `beat_embedded_init` | Close DB connections in an embedded beat process |

`close_database()` honours the `CELERY_DB_REUSE_MAX` setting: when set, connections are only closed every `2 × CELERY_DB_REUSE_MAX` calls (prerun+postrun) to allow reuse. Errors whose message contains `closed` or `not connected` are ignored; `InterfaceError` is ignored.

With Django's native connection **pool** enabled (`DATABASES[alias]['OPTIONS']['pool']`) and the prefork pool, `close_pool()` is also called so pooled connections aren't inherited across processes.

## Transaction-safe task dispatch

`DjangoTask` adds:

- `delay_on_commit(*args, **kwargs)` → `transaction.on_commit(partial(self.delay, ...))`
- `apply_async_on_commit(*args, **kwargs)` → same for `apply_async`

These defer publishing until the surrounding DB transaction commits, preventing workers from picking up a task before the rows it needs are visible. They return `None` (no `AsyncResult`), since the task may never be sent if the transaction rolls back.

## Configuration notes

- With `namespace='CELERY'`, settings are read from Django settings using upper-case names prefixed `CELERY_` (e.g. `CELERY_BROKER_URL`); the namespace forces the new-style setting names (see `detect_settings`).
- `Settings.timezone` falls back to Django's `TIME_ZONE` when `timezone` isn't set.

## Related tests

- `t/unit/fixups/test_django.py` — activation rules, DB close behaviour, pool handling.
- `t/unit/contrib/django/test_task.py` — `DjangoTask` helpers.
- `t/integration/django_settings.py` — Django settings used by the integration suite.
