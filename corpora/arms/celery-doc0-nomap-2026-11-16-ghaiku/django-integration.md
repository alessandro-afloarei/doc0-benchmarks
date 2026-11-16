---
title: "Django Integration"
---
## Overview

When the `DJANGO_SETTINGS_MODULE` environment variable is set and Django can be imported, the app installs a fix-up that connects Celery to the Django project. The fix-up makes the project's directory importable, points the app's clock at Django's, uses a Django-aware task base class, and makes the worker close Django's database and cache connections around each task and in each child process. The fix-up is `DjangoFixup` in `celery/fixups/django.py`, and the worker side of it is `DjangoWorkerFixup`. The generic task machinery it plugs into is on [[Defining Tasks]].

Sources: [celery/fixups/django.py:52-63](repo://celery/fixups/django.py#L52-L63), [celery/fixups/django.py:66-79](repo://celery/fixups/django.py#L66-L79)

## Activation

`fixup` reads the settings-module variable, and it returns `None` when the variable is not set. When it is set, the function imports Django, warns if that import fails, checks the version, and installs a `DjangoFixup` for the app. The app calls each of its fix-ups when it is constructed.

Sources: [celery/fixups/django.py:47-63](repo://celery/fixups/django.py#L47-L63), [celery/app/base.py:411-413](repo://celery/app/base.py#L411-L413)

`DjangoFixup.install` does four things. It inserts the current directory at the front of `sys.path`, so the project modules take precedence over installed ones. It sets the loader's `now` to the fix-up's clock, and it sets the app's task class to `DjangoTask` when no task class was given. It then connects the fix-up's methods to the `import_modules` and `worker_init` signals.

Sources: [celery/fixups/django.py:75-90](repo://celery/fixups/django.py#L75-L90)

`on_import_modules` calls `validate_models` before task modules are imported. `on_worker_init` takes the worker instance from the signal's sender, gives it to the worker fix-up and installs that fix-up. Without a sender it warns.

Sources: [celery/fixups/django.py:101-117](repo://celery/fixups/django.py#L101-L117)

`now` returns the current time, in UTC when `utc` is true. `autodiscover_tasks` returns the list of module names the loader should import, and [[The Celery App]] describes how autodiscovery is used.

Sources: [celery/fixups/django.py:118-126](repo://celery/fixups/django.py#L118-L126)

## The worker fix-up

`DjangoWorkerFixup` is created when the worker starts. Its constructor imports the Django database and cache modules and the Django settings, and it reads the `CELERY_DB_REUSE_MAX` setting. Its `django_setup` method calls `django.setup()`, and `validate_models` checks the models.

Sources: [celery/fixups/django.py:130-158](repo://celery/fixups/django.py#L130-L158)

`on_worker_process_init` runs in each child process. A child validates the models again on Windows or after `execv`, and it drops the database connections it inherited from the parent without closing them, because a close would break the parent's connection too. It then closes the cache connections.

Sources: [celery/fixups/django.py:165-186](repo://celery/fixups/django.py#L165-L186)

`on_task_prerun` closes the database connections before each task that is not eager. `on_task_postrun` closes the database and cache connections after each such task. `_is_prefork` checks whether the pool is the prefork pool, which the worker fix-up uses when it decides how to close connections.

Sources: [celery/fixups/django.py:194-217](repo://celery/fixups/django.py#L194-L217)

## The Django task class

`DjangoTask` extends `Task` with two methods. `delay_on_commit` and `apply_async_on_commit` pass the call to Django's `transaction.on_commit`, so the message is sent only after the surrounding database transaction has committed.

Sources: [celery/contrib/django/task.py:1-21](repo://celery/contrib/django/task.py#L1-L21)
