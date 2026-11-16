---
title: "Framework Integrations"
---
## Overview

Celery integrates with Django through application fixups and a transaction-aware task base. It also supplies pytest fixtures and embedded-worker helpers for applications that test broker delivery in a test process. These integrations reuse the application and worker boundaries in [[Applications and Configuration]] and [[Worker Lifecycle and Concurrency]], adding framework setup, resource cleanup and test-state isolation around them.

Sources: [celery/fixups/django.py:52-62](repo://celery/fixups/django.py#L52-L62), [celery/fixups/django.py:75-88](repo://celery/fixups/django.py#L75-L88), [celery/contrib/django/task.py:8-21](repo://celery/contrib/django/task.py#L8-L21), [celery/contrib/pytest.py:172-210](repo://celery/contrib/pytest.py#L172-L210)

## Configure a Django application

The Django fixup activates when `DJANGO_SETTINGS_MODULE` is set and the selected loader is not already a Django loader. It imports Django, checks its version and installs the fixup; a missing Django installation produces a warning. Installation prepends the working directory to module search, connects import/worker initialization signals, and uses `DjangoTask` unless a custom application task class was explicitly chosen.

Sources: [celery/fixups/django.py:47-62](repo://celery/fixups/django.py#L47-L62), [celery/fixups/django.py:75-88](repo://celery/fixups/django.py#L75-L88)

The repository example sets the settings-module default, loads the Django settings object under the `CELERY` namespace and asks for task autodiscovery. The example's comment explains that using a string configuration reference avoids serializing the settings object into child processes. [[Applications and Configuration]] covers namespaced settings and deferred discovery; the fixup supplies Django's installed application names as the packages to search.

Sources: [examples/django/proj/celery.py:1-17](repo://examples/django/proj/celery.py#L1-L17), [celery/fixups/django.py:121-123](repo://celery/fixups/django.py#L121-L123)

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

## Order setup and transaction-aware publishing

Before task modules import, the fixup calls model validation, which runs `django.setup()` and configured checks. Worker initialization retains the worker instance on its fixup and installs cleanup handlers. This ordering makes the Django application registry available to task imports and discovery. Check skipping is read through `CELERY_SKIP_CHECKS`; it does not bypass the fixup's call to Django setup.

Sources: [celery/fixups/django.py:101-123](repo://celery/fixups/django.py#L101-L123), [celery/fixups/django.py:145-163](repo://celery/fixups/django.py#L145-L163)

`DjangoTask.delay_on_commit` and `apply_async_on_commit` register partial calls with `transaction.on_commit`. They return `None` and do not immediately return the result handle produced by ordinary publishing. The invocation enters [[Task Publishing and Routing]] when Django invokes that callback. This timing boundary is useful when a task depends on transaction writes becoming visible; it schedules publication after the transaction callback rather than making broker publication part of a database transaction.

Sources: [celery/contrib/django/task.py:8-21](repo://celery/contrib/django/task.py#L8-L21)

## Clean up database and cache resources

The worker fixup subscribes to task prerun, postrun, process initialization and embedded-beat initialization. Non-eager tasks trigger database closing before execution and database/cache closing afterward. Child initialization closes inherited descriptors before database cleanup because the comments explain that ordinary network-level close could break the parent's inherited connection. This is framework resource management around the execution hooks in [[Task Execution and Retries]].

Sources: [celery/fixups/django.py:156-203](repo://celery/fixups/django.py#L156-L203)

`CELERY_DB_REUSE_MAX` can defer database cleanup according to a reuse counter. Database cleanup handles initialized connections, tolerates the older Django connection enumeration interface and closes configured connection pools for prefork when supported. Known interface errors and already-closed/not-connected database errors are tolerated; other database errors propagate. Cache cleanup tolerates missing or incompatible close interfaces.

Sources: [celery/fixups/django.py:134-144](repo://celery/fixups/django.py#L134-L144), [celery/fixups/django.py:205-246](repo://celery/fixups/django.py#L205-L246)

## Select the application test fixtures

The pytest integration registers the `celery` marker and creates a fresh test application from fixture configuration and marker overrides. `celery_config` supplies settings, `celery_parameters` constructor arguments, `celery_includes` imported modules and `celery_worker_parameters` controller arguments. Function-scoped and session-scoped application/worker variants let tests choose their lifetime; the default worker pool fixture is `solo`.

Sources: [celery/contrib/pytest.py:22-29](repo://celery/contrib/pytest.py#L22-L29), [celery/contrib/pytest.py:64-105](repo://celery/contrib/pytest.py#L64-L105), [celery/contrib/pytest.py:115-185](repo://celery/contrib/pytest.py#L115-L185), [celery/contrib/pytest.py:194-210](repo://celery/contrib/pytest.py#L194-L210)

`TestApp` starts from copied test defaults, which select an in-memory broker and cache backend and import the supplied test tasks. The setup context records and restores default/current application state and finalizers, closing the temporary application afterward. Enabling the application trap makes accidental fallback to current/default applications raise, exposing code that failed to pass the intended application explicitly.

Sources: [celery/contrib/testing/app.py:1-21](repo://celery/contrib/testing/app.py#L1-L21), [celery/contrib/testing/app.py:47-65](repo://celery/contrib/testing/app.py#L47-L65), [celery/contrib/testing/app.py:68-112](repo://celery/contrib/testing/app.py#L68-L112)

## Run an embedded worker in tests

`start_worker` is a context manager with one worker slot and the solo pool by default. It starts a worker thread, waits for consumer readiness and optionally sends a ping task and waits for `pong`. The helper checks broker connectivity before starting, disables mingle and gossip, and normally disables heartbeat. Tests therefore exercise a worker delivery path with deliberately reduced cluster services; use [[Monitoring and Remote Control]] when testing those services specifically.

Sources: [celery/contrib/testing/worker.py:99-178](repo://celery/contrib/testing/worker.py#L99-L178)

On exit, the helper asks worker state to terminate and joins the thread for `shutdown_timeout`, defaulting to ten seconds. A still-running thread raises a clear error suggesting a larger timeout for long tasks. `NO_WORKER` prevents worker fixtures from starting. These helpers cover application integration tests; [[Development and Testing]] describes how this repository layers unit, service-backed integration and smoke suites around the same machinery.

Sources: [celery/contrib/testing/worker.py:180-192](repo://celery/contrib/testing/worker.py#L180-L192), [celery/contrib/pytest.py:16-16](repo://celery/contrib/pytest.py#L16-L16), [celery/contrib/pytest.py:194-210](repo://celery/contrib/pytest.py#L194-L210)

## Validate typed task boundaries

The application's optional Pydantic task wrapper inspects function annotations, binds incoming arguments and validates annotated model inputs, including optional models, using configurable strictness and context. For an appropriately annotated model return value, it serializes a matching model instance with JSON-mode dumping by default. This is an argument/result adaptation boundary around a task function; serializer acceptance and message trust are handled separately in [[Message Security]].

Sources: [celery/app/base.py:127-205](repo://celery/app/base.py#L127-L205), [celery/app/base.py:607-609](repo://celery/app/base.py#L607-L609)
