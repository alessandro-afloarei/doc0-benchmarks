---
type: integration
title: Django setup, transactions and worker resources
description: How Celery discovers Django tasks, loads namespaced settings, defers publishing until commit and manages database resources in workers.
tags: [django, transactions, configuration, database]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:34:04.042Z
sources:
  - id: openwiki-source-650c0d51beedca1446741693
    resource: repo://celery/contrib/django/task.py
  - id: openwiki-source-bdd128d49c4b8a546ae88464
    resource: repo://celery/fixups/django.py
  - id: openwiki-source-3fee0723d3b7d05cdaa5290c
    resource: repo://examples/django/proj/__init__.py
  - id: openwiki-source-856b7a21a3f67aa222e23609
    resource: repo://examples/django/proj/celery.py
generated: { by: "codex", at: "2026-11-16T06:34:04.042Z" }
---

# Django setup, transactions and worker resources

The runnable pattern lives in `examples/django/`. The project creates its Celery app in `proj/celery.py`, imports it from `proj/__init__.py`, and defines reusable application tasks with `@shared_task`.

```python
import os
from celery import Celery

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'proj.settings')
app = Celery('proj')
app.config_from_object('django.conf:settings', namespace='CELERY')
app.autodiscover_tasks()
```

The namespace maps Django settings such as `CELERY_BROKER_URL` into Celery's configuration. Importing the app during Django startup also makes it available to shared-task resolution. Launch the example worker from the example directory with `celery -A proj worker -l INFO` after installing its dependencies and configuring a broker.

## Setup happens before task imports

The Django fixup activates when `DJANGO_SETTINGS_MODULE` is set and the application is not already using a Django-specific loader. If Django is unavailable, it warns rather than installing the fixup.

Installation connects `import_modules` and `worker_init` signals. Before task imports, the import hook calls `django.setup()` and runs Django's checks, unless `CELERY_SKIP_CHECKS` is set. Autodiscovery obtains package names from Django's installed app configurations and searches their task modules. This ordering matters for tasks that import models at module scope.

The fixup selects `celery.contrib.django.task:DjangoTask` as the task base unless the application explicitly supplied a custom task class. A custom base that needs the commit helpers should inherit from `DjangoTask` itself.

## Publish after transaction commit

`DjangoTask.delay_on_commit()` and `apply_async_on_commit()` register partial calls with `django.db.transaction.on_commit()`. They return `None`, not an `AsyncResult`, because publishing is deferred to the callback.

For example, after creating a row inside a transaction, pass its ID to `rename_widget.delay_on_commit(widget.id, 'new name')`. This ties publication to Django's commit hook, avoiding publication before that commit. The helper does not make database commit and broker publication one atomic operation; the callback still uses normal [publishing behavior](../workflows/publishing.md), including possible publication failures.

## Database and cache lifecycle

The worker fixup closes database and cache resources at installation. On child-process initialization it removes inherited database file descriptors before closing connections, avoiding network I/O that could disturb the parent's inherited connection. It also closes resources around non-eager task execution through prerun and postrun signals.

This checkout closes initialized database connections directly. When a database has `OPTIONS['pool']` enabled and the worker uses prefork, it additionally calls `close_pool()` when supported, suppressing an absent-pool `KeyError`. It does not close a database connection pool on that path for thread workers. `CELERY_DB_REUSE_MAX` can defer repeated cleanup cycles.

These details belong to worker resource ownership, separate from model transaction semantics. Check the selected pool and the actual Django database backend when changing cleanup behavior.

## Focused verification

`t/unit/fixups/test_django.py` covers activation, setup order, custom task bases, child initialization and pool-sensitive database cleanup. `t/unit/contrib/django/test_task.py` verifies commit helper registration and their `None` return value. The example includes model-access tasks for an application-level check. Use the [application lifecycle](../concepts/application.md) and [testing guide](../testing/development.md) when diagnosing task discovery or fixture setup.
