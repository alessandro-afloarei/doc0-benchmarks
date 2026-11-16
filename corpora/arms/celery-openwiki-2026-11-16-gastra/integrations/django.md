---
type: integration
title: Django initialization and transaction boundaries
description: Django application discovery, worker database lifecycle, and deferring Celery publication until a transaction commits.
tags: [django, integration, transactions, database]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:55:28.912Z
sources:
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-650c0d51beedca1446741693
    resource: repo://celery/contrib/django/task.py
  - id: openwiki-source-bdd128d49c4b8a546ae88464
    resource: repo://celery/fixups/django.py
  - id: openwiki-source-3fee0723d3b7d05cdaa5290c
    resource: repo://examples/django/proj/__init__.py
  - id: openwiki-source-856b7a21a3f67aa222e23609
    resource: repo://examples/django/proj/celery.py
  - id: openwiki-source-9c00dd574cce2d0beff0aeb2
    resource: repo://t/unit/contrib/django/test_task.py
generated: { by: "codex", at: "2026-11-16T07:55:28.912Z" }
---

# Django initialization and transaction boundaries

Celery's Django integration prepares Django before importing tasks and manages database/cache resources around worker activity. It also provides task methods that defer publication until database commit. It does not make the Django transaction and broker publication atomic.

## Project setup

The [Django example](../../examples/django/proj/celery.py) sets `DJANGO_SETTINGS_MODULE`, constructs a Celery application, reads `django.conf:settings` with `namespace='CELERY'`, and calls `app.autodiscover_tasks()`. The [project package initializer](../../examples/django/proj/__init__.py) imports that application so shared tasks resolve against the intended project app.

```python
import os
from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "proj.settings")
app = Celery("proj")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()
```

Put project values such as `CELERY_BROKER_URL` and `CELERY_RESULT_BACKEND` in Django settings. Discovery uses installed Django app configurations as package names; the loader then imports their task modules. See [application lifecycle](../architecture/application.md) for lazy discovery and configuration behavior.

## Initialization order and task class

The built-in fixup activates when the settings environment variable is set and the selected loader is not already a Django loader. If Django cannot be imported, it warns instead of installing the integration.

Installation hooks the import-modules and worker-init signals. Before task modules load, validation calls `django.setup()` and, unless `CELERY_SKIP_CHECKS` is set, Django's checks. This prevents model imports from preceding application initialization. Unless a custom task class was supplied, the fixup selects `celery.contrib.django.task:DjangoTask`.

A custom task base that needs commit helpers should inherit from `DjangoTask`; the fixup intentionally preserves explicitly chosen task classes.

## Publish after commit

`DjangoTask.delay_on_commit()` and `apply_async_on_commit()` register a partially applied publishing call with `transaction.on_commit()`. Both return `None`, not an `AsyncResult`, because the helper schedules publication rather than returning its eventual result.

```python
from django.db import transaction

with transaction.atomic():
    record = Model.objects.create(...)
    process_record.delay_on_commit(record.pk)
```

This example assumes `process_record` uses `DjangoTask`. It avoids publishing from that code path before the transaction commits. There is still a separate broker operation after commit: the implementation does not include a transactional outbox or an atomic database/broker commit. Design recovery for a committed row whose publication fails, and pass identifiers rather than live model instances.

## Worker resource lifecycle

The worker fixup connects task prerun/postrun and worker-process initialization. Non-eager tasks trigger database cleanup before and after execution, plus cache cleanup afterward. Eager execution skips these task cleanup hooks.

After forking, inherited database descriptors are detached before database/cache cleanup so child initialization does not reuse parent connections. The implementation supports a reuse counter through `CELERY_DB_REUSE_MAX`; ordinary cleanup closes initialized connections. When Django connection pooling is configured, `close_pool()` is called for prefork workers when available, while thread pools avoid that pool-closing branch. Selected already-closed/interface errors are tolerated; other database errors propagate.

## Tests and related work

[Fixup tests](../../t/unit/fixups/test_django.py) cover custom task classes, initialization, discovery, database closing, and pool-specific cleanup. [Django task tests](../../t/unit/contrib/django/test_task.py) assert the commit helpers return `None`. Follow [task delivery](../workflows/task-delivery.md) for publishing failures and [testing](../testing/contributing.md) for choosing unit versus broker-backed integration tests.
