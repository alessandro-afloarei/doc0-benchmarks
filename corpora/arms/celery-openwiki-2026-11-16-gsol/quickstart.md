---
type: guide
title: Quickstart and task routing
description: Run a minimal Celery task from this checkout, understand broker and backend prerequisites, and find the wiki page for each development or operations task.
tags: [quickstart, navigation, tasks, development]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:34:04.042Z
sources:
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-3795aa577fa7b0f3bd2af81a
    resource: repo://celery/app/task.py
  - id: openwiki-source-ceca684addb7674df2c5c60b
    resource: repo://celery/app/utils.py
  - id: openwiki-source-33fca59793af7cfa460b223c
    resource: repo://celery/result.py
  - id: openwiki-source-a85d69622d5baa166a82e6c1
    resource: repo://celery/worker/control.py
  - id: openwiki-source-9fe3a610596da7b7f2c71115
    resource: repo://setup.py
generated: { by: "codex", at: "2026-11-16T06:34:04.042Z" }
---

# Quickstart and task routing

Celery is a distributed task queue. Producers publish named invocations to a broker, workers import and execute task implementations, and an optional result backend makes values and states available to callers. This repository contains the Python library, CLI, workers, beat scheduler, backend integrations, examples and tests.

## Run one task from the checkout

Use Python 3.10 or newer and a Redis server accessible at `localhost:6379`. The example uses Redis database 0 for broker messages and database 1 for result storage. Install the checkout and Redis dependencies in your development environment:

```bash
python -m pip install -e '.[redis]'
```

Create a local example file named `demo_tasks.py` in a directory importable from both terminals:

```python
from celery import Celery

app = Celery(
    'demo',
    broker='redis://localhost:6379/0',
    backend='redis://localhost:6379/1',
)

@app.task(name='demo.add')
def add(x, y):
    return x + y
```

In the first terminal, from that directory:

```bash
celery -A demo_tasks:app worker -l INFO
```

In a second terminal with the same environment and working directory:

```python
from demo_tasks import add

result = add.delay(2, 3)
print(result.id)
print(result.get(timeout=10))  # 5
```

The worker must be running and the Redis service reachable. Relevant `CELERY_BROKER_*` and `CELERY_RESULT_BACKEND` environment variables can override configured URLs. This example is a local development configuration; adapt connections and [message trust settings](operations/security.md) for your deployment.

`delay()` is the argument-only convenience form of `apply_async()`. For example, `add.apply_async(args=(2, 3), countdown=5)` schedules an invocation with execution options. The returned result handle identifies the task; its `get()` timeout limits waiting and does not cancel worker execution.

For a local check of task logic, set `app.conf.task_always_eager = True` before calling the registered task. That executes through the eager path and returns an eager result. It does not verify broker delivery or pool behavior, and plain `app.send_task()` ignores eager mode.

## Find the right guide

| Task or question | Read |
| --- | --- |
| Understand the complete task path and component owners | [System boundaries](architecture/system.md) |
| Configure an app, register tasks or troubleshoot discovery | [Application lifecycle](concepts/application.md) |
| Set queues, route tasks, choose publish options or inspect message encoding | [Publishing and protocol](workflows/publishing.md) |
| Change bootsteps, pools, prefetch, reconnect or shutdown | [Worker lifecycle](architecture/worker.md) |
| Understand acknowledgements, execution failures, retry or redelivery | [Execution and retries](workflows/execution.md) |
| Build chains, groups and chords or replace a task | [Canvas workflows](workflows/canvas.md) |
| Retrieve results, set retention or implement a backend | [Result backend contracts](integrations/result-backends.md) |
| Schedule recurring work and recover beat state | [Periodic tasks](operations/periodic-tasks.md) |
| Inspect workers, consume events or revoke work | [Monitoring and control](operations/monitoring.md) |
| Configure allowed serializers, body signing or broker TLS | [Serialization and trust](operations/security.md) |
| Integrate Django settings, transactions and worker databases | [Django integration](integrations/django.md) |
| Install test dependencies and choose unit, integration or smoke checks | [Development and verification](testing/development.md) |

## First diagnostic steps

If nothing executes, verify application import, task registration and consumed queues with `celery -A demo_tasks:app inspect registered` and `inspect active_queues`. If execution completes but a result is unavailable, check backend configuration and retention separately. If work repeats, inspect retries, acknowledgement policy, connection-loss behavior and application idempotency.

Use `python -m pytest t/unit/app/test_routes.py -q` as an example focused test after installing the dependencies described in the testing guide. The existing `docs/` tree provides the broader user and API manuals; `examples/` includes Django and other application patterns. This wiki focuses on how the checked-out implementation connects those public behaviors.
