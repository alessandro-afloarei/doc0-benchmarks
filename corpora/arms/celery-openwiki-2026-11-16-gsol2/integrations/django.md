---
type: integration
title: Django integration and transaction boundaries
description: Django application discovery, worker initialization and database cleanup, and publishing tasks after a database transaction commits.
tags: [django, integration, transactions, database]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:38:41.370Z
sources:
  - id: openwiki-source-650c0d51beedca1446741693
    resource: repo://celery/contrib/django/task.py
  - id: openwiki-source-bdd128d49c4b8a546ae88464
    resource: repo://celery/fixups/django.py
  - id: openwiki-source-856b7a21a3f67aa222e23609
    resource: repo://examples/django/proj/celery.py
generated: { by: "codex", at: "2026-11-16T16:38:41.370Z" }
---

# Django integration and transaction boundaries

Celery's Django integration adapts the normal application and worker lifecycle. The built-in fixup activates when `DJANGO_SETTINGS_MODULE` is set and the selected loader is not already Django-specific. It imports Django, checks the minimum version, and installs initialization hooks. If the environment variable is set but Django cannot be imported, it emits a `FixupWarning`.

## Project setup and discovery

The repository's [Django example](../../examples/django/proj/celery.py) establishes the integration in this order:

```python
import os
from celery import Celery

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'proj.settings')
app = Celery('proj')
app.config_from_object('django.conf:settings', namespace='CELERY')
app.autodiscover_tasks()
```

The namespace makes settings such as `CELERY_BROKER_URL` and `CELERY_RESULT_BACKEND` available to the application. Discovery asks Django's app registry for installed application names, then uses Celery's normal related-module discovery to import their `tasks` modules. The [example task module](../../examples/django/demoapp/tasks.py) uses `shared_task`, allowing tasks to resolve through the configured current application.

The fixup connects to `import_modules`, where it calls `django.setup()` before tasks import models. Django system checks run unless `CELERY_SKIP_CHECKS` is set. Configuration loading, finalization, and task import timing still follow the [application lifecycle](../architecture/application.md); setting up a `Celery` object does not eagerly discover every installed task.

## Publish after commit

The fixup selects `celery.contrib.django.task.DjangoTask` as the default task class unless the application supplied a custom task class. It adds two methods:

- `delay_on_commit(*args, **kwargs)` registers a callback that calls `delay()`.
- `apply_async_on_commit(*args, **kwargs)` registers a callback that calls `apply_async()`, including its execution options.

For a task that looks up a newly created row, the intended call site is:

```python
from django.db import transaction
from demoapp.models import Widget
from demoapp.tasks import rename_widget

with transaction.atomic():
    widget = Widget.objects.create(name='draft')
    rename_widget.delay_on_commit(widget.pk, 'ready')
```

Both methods use `transaction.on_commit(functools.partial(...))` and return `None`; they cannot return the future `AsyncResult` from a callback that has not run. This places publication behind Django's commit callback boundary. It does not implement a durable outbox or an atomic transaction spanning the database and broker: the callback still performs an ordinary Celery publication, which can fail. Applications needing recovery for that gap must provide it above these helpers.

If a custom task base is installed, explicitly inherit the Django helper behavior when needed; the fixup deliberately preserves the application's custom class. Use `apply_async_on_commit(args=(...), kwargs={...}, queue='...')` when passing publication options instead of treating those options as task keyword arguments to `delay_on_commit()`.

## Worker connection lifecycle

At worker initialization the fixup connects database/cache cleanup to task and process signals. Before and after a non-eager task it invokes database cleanup; postrun also closes caches. Eager execution bypasses these task cleanup branches, so an eager test does not verify the worker's database lifecycle.

After fork, inherited database file descriptors are closed without the usual network shutdown path, followed by forced database/cache cleanup. This avoids reusing a parent's connections in child processes. Exec-based child initialization also validates models again.

`CELERY_DB_REUSE_MAX` controls a cleanup reuse counter. The actual database close path closes initialized connections, with compatibility fallback for older Django signatures. For a configured Django database pool, it calls `close_pool()` only when using a prefork worker and the connection exposes that method. Interface errors and selected already-closed errors are tolerated; unrelated database errors propagate. The fixup receives the existing worker instance rather than constructing a new controller to decide the pool type.

## Tests and related flows

[Django fixup tests](../../t/unit/fixups/test_django.py) cover custom task classes, discovery, checks, inherited connections, and prefork/thread pool cleanup. [Django task tests](../../t/unit/contrib/django/test_task.py) check the commit helpers' `None` return contract using a mocked callback runner. Those mocks do not prove transactional behavior with a real Django database; use appropriate transaction tests for application-level commit timing.

Continue with [task execution and retries](../workflows/task-execution.md) for behavior after publication, or [testing workflows](../testing/development.md) for eager and live-worker test boundaries.
