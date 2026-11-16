---
type: quickstart
title: Getting started and finding your way
description: Run a task from this Celery checkout, understand the broker and result-backend roles, and find the right implementation or operations guide.
tags: [quickstart, navigation, celery, development]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:55:28.912Z
sources:
  - id: openwiki-source-3795aa577fa7b0f3bd2af81a
    resource: repo://celery/app/task.py
  - id: openwiki-source-98fa58283cefff1b0e071bbe
    resource: repo://celery/backends/base.py
  - id: openwiki-source-33fca59793af7cfa460b223c
    resource: repo://celery/result.py
  - id: openwiki-source-6e90651e84289dc2f15e1833
    resource: repo://docs/getting-started/first-steps-with-celery.rst
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
  - id: openwiki-source-3b598a8151cb69f5017d7c52
    resource: repo://requirements/extras/redis.txt
  - id: openwiki-source-9fe3a610596da7b7f2c71115
    resource: repo://setup.py
  - id: openwiki-source-ccd2623ea7a88d6abc2d9b5a
    resource: repo://tox.ini
generated: { by: "codex", at: "2026-11-16T07:55:28.912Z" }
---

# Getting started and finding your way

<!-- openwiki: broken internal link [../docs] file "../docs" does not exist. Fix the href or restore the target, then delete this comment. -->
Celery sends named tasks through a broker to workers that execute registered Python implementations. A separate result backend stores or transports outcomes. This wiki explains the checked-out implementation and its tests; the repository also contains a full [Sphinx documentation tree](../docs) and [first-steps tutorial](../docs/getting-started/first-steps-with-celery.rst).

## Run one task locally

Use Python 3.10 or newer, as required by this checkout's [package metadata](../setup.py). The README describes a release series and may differ from development metadata.

From the repository root:

```bash
python -m venv .venv
. .venv/bin/activate
python -m pip install -e ".[redis]"
```

The example below expects a local Redis service at `localhost:6379`, using database 0 for broker messages and database 1 for results. The Redis extra installs client support; it does not start the server. Use a local development Redis instance with those databases available.

Create a separate demo directory and change into it, keeping the environment active:

```bash
mkdir -p /tmp/celery-demo
cd /tmp/celery-demo
```

Create `tasks.py` in that directory:

```python
from celery import Celery

app = Celery(
    "tasks",
    broker="redis://localhost:6379/0",
    backend="redis://localhost:6379/1",
)

@app.task
def add(x, y):
    return x + y
```

Start the worker:

```bash
celery -A tasks:app worker --loglevel=INFO
```

In another terminal, activate the same repository virtual environment, change to the demo directory, and start Python:

```python
from tasks import add

result = add.delay(2, 3)
print(result.id)
print(result.get(timeout=10))  # Expected: 5
result.forget()
```

`delay()` returns an AsyncResult handle immediately; `get()` waits for the backend result. A wait timeout does not cancel the task. Stop the foreground worker with one interrupt and let it finish its warm shutdown.

If nothing executes, confirm the worker loaded `tasks.add`, that both processes use the same broker and result backend, and that Redis is running. A PENDING result can mean unknown or missing metadata, not necessarily queued work. See [worker operations](operations/workers.md) and [results](integrations/result-backends.md).

## Choose a guide by task

| What you need to do | Start here |
| --- | --- |
| Understand the producer-to-worker path and state owners | [System boundaries and task flow](architecture/system.md) |
| Fix task discovery, app initialization, or configuration | [Application lifecycle](architecture/application.md) |
| Publish with routing, delays, eager mode, or retry | [Task delivery](workflows/task-delivery.md) |
| Change worker scheduling, acknowledgement, or failure handling | [Worker execution](architecture/worker.md) |
| Compose chains, groups, chords, and error handlers | [Canvas workflows](workflows/canvas.md) |
| Select or debug result storage and chord coordination | [Result backends](integrations/result-backends.md) |
| Configure periodic tasks and scheduler persistence | [Beat scheduling](operations/periodic-tasks.md) |
| Inspect workers, tune consumption, or handle reconnect/shutdown | [Worker operations](operations/workers.md) |
| Integrate Django and publish after database commit | [Django integration](integrations/django.md) |
| Configure serializers, message signing, and trust boundaries | [Security](operations/security.md) |
| Set up development dependencies and choose focused tests | [Development and validation](testing/contributing.md) |

## Repository landmarks

<!-- openwiki: broken internal link [../celery/app] file "../celery/app" does not exist. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [../celery/worker] file "../celery/worker" does not exist. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [../celery/backends] file "../celery/backends" does not exist. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [../celery/bin] file "../celery/bin" does not exist. Fix the href or restore the target, then delete this comment. -->
The application and task APIs live in [celery/app](../celery/app); worker services and requests in [celery/worker](../celery/worker); workflow composition in [celery/canvas.py](../celery/canvas.py); and result persistence in [celery/backends](../celery/backends). [celery/bin](../celery/bin) contains CLI commands, while [celery/beat.py](../celery/beat.py) and [celery/schedules.py](../celery/schedules.py) implement periodic scheduling.

<!-- openwiki: broken internal link [../t/unit] file "../t/unit" does not exist. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [../t/integration] file "../t/integration" does not exist. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [../t/smoke] file "../t/smoke" does not exist. Fix the href or restore the target, then delete this comment. -->
Tests are split into [unit](../t/unit), [integration](../t/integration), and [smoke](../t/smoke) suites. Plain pytest defaults to the unit suite. After installing development requirements, a focused check might be:

```bash
python -m pytest t/unit/tasks/test_tasks.py -k retry
```

Run that command from the repository root, not the demo directory. The [testing guide](testing/contributing.md) covers dependency sets, service requirements, tox, and documentation checks.
