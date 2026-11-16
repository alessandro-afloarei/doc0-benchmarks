---
type: quickstart
title: Repository quickstart
description: Install this Celery checkout, run a task through a broker and worker, and find the right architecture, workflow, operations, or testing guide.
tags: [quickstart, celery, setup, navigation]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:38:41.370Z
sources:
  - id: openwiki-source-39b293cb4d26aec690dfc284
    resource: repo://celery/__init__.py
  - id: openwiki-source-965d19cff645fcce36529be3
    resource: repo://celery/__main__.py
  - id: openwiki-source-3795aa577fa7b0f3bd2af81a
    resource: repo://celery/app/task.py
  - id: openwiki-source-a4d1ab266bef232afaa055d8
    resource: repo://celery/backends/rpc.py
  - id: openwiki-source-33fca59793af7cfa460b223c
    resource: repo://celery/result.py
  - id: openwiki-source-6e90651e84289dc2f15e1833
    resource: repo://docs/getting-started/first-steps-with-celery.rst
  - id: openwiki-source-a33e87501bc6e99159549e28
    resource: repo://requirements/default.txt
  - id: openwiki-source-9fe3a610596da7b7f2c71115
    resource: repo://setup.py
generated: { by: "codex", at: "2026-11-16T16:38:41.370Z" }
---

# Repository quickstart

Celery distributes named tasks from producers through a message broker to workers. An optional result backend stores or transmits task outcomes. This repository contains the Python application/task APIs, worker runtime, Canvas workflow composition, Beat scheduler, result adapters, CLI, framework integration, and tests.

The checkout identifies itself as Celery `5.6.2` (`recovery`), while `setup.py` requires Python **3.10 or newer**. Use that packaging requirement for this source tree; introductory README version-support text is not fully aligned with the manifest. Core dependencies include Kombu for messaging, Billiard for multiprocessing, Vine for promises, and Click for the CLI.

## Install the checkout

From the repository root:

```bash
python -m venv .venv
. .venv/bin/activate
python -m pip install -e .
python -m celery --version
```

Optional extras install integration clients, for example `python -m pip install -e '.[redis]'` for Redis. The console script and `python -m celery` both enter `celery.__main__.main`, which performs early concurrency patching before importing the CLI when appropriate.

## Run one task end to end

The example below needs a reachable RabbitMQ broker on localhost and credentials with access to its default virtual host. Start/configure that service separately. Put this code in a project directory as `tasks.py`; it follows the repository's first-steps tutorial and uses the RPC backend so the client can retrieve a result without a second service:

```python
from celery import Celery

app = Celery(
    'tasks',
    broker='pyamqp://guest:guest@localhost//',
    backend='rpc://',
)

@app.task
def add(x, y):
    return x + y
```

In that directory, with the environment active, run a worker:

```bash
celery -A tasks:app worker --loglevel=INFO
```

In another terminal using the same directory and environment:

```python
from tasks import add

result = add.delay(2, 3)
print(result.id)
print(result.get(timeout=10))  # 5
```

`delay()` delegates to `apply_async()` and returns a result handle. Use `apply_async(args=(2, 3), queue='math')` for execution options, with a worker configured to consume the destination queue. Calling `add(2, 3)` directly executes Python locally and does not prove broker delivery. Keep `get()` in the client for this example; synchronous waits inside worker tasks are guarded because they can deadlock a finite pool.

RPC is useful for this small reply flow but explicitly does not support chords. Use a backend with the required capabilities for [Canvas aggregation](workflows/canvas.md). A `get()` timeout stops the wait without killing the worker task. Missing backend data often reads as `PENDING`, which by itself does not prove queue membership.

## Choose the next guide

| Goal or symptom | Start here |
| --- | --- |
| Understand settings, lazy decorators, task names, or imports | [Application and registration](architecture/application.md) |
| Follow a message, change queues, or investigate delayed/quorum delivery | [Publication and routing](architecture/messaging.md) |
| Understand pool startup, prefetch, broker reconnects, or shutdown | [Worker lifecycle](architecture/workers.md) |
| Change retry, timeout, failure, acknowledgement, or redelivery behavior | [Task execution](workflows/task-execution.md) |
| Compose parallel/serial work, callbacks, or chords | [Canvas workflows](workflows/canvas.md) |
| Investigate missing results, retention, or backend capabilities | [Results and persistence](architecture/results.md) |
| Run scheduled work or debug Beat state | [Periodic scheduling](operations/periodic-tasks.md) |
| Inspect workers, consume events, or manage revocation | [Monitoring and remote control](operations/monitoring-control.md) |
| Integrate Django or send after a transaction commit | [Django integration](integrations/django.md) |
| Configure accepted content or signed task bodies | [Serialization and trust](security/serialization.md) |
| Set up development tools and choose a test layer | [Development and testing](testing/development.md) |

## Find authoritative code and examples

`celery/app/` owns application, task, tracing, routing, and messaging behavior. Worker consumption and request lifecycle live in `celery/worker/`; execution adapters are in `celery/concurrency/`. `celery/canvas.py`, `celery/result.py`, and `celery/beat.py` connect workflows, persistence, and scheduling. Result storage adapters live in `celery/backends/`; broker transport implementations come from Kombu.

The [first-steps tutorial](../docs/getting-started/first-steps-with-celery.rst), [tutorial task example](../examples/tutorial/tasks.py), and [multi-module project example](../examples/next-steps/proj/celery.py) show application setup. The existing Sphinx manual under `docs/` contains the larger user-facing API/configuration reference; this wiki explains repository mechanisms and the tests that establish them.

For a focused initial development check, install `requirements/test.txt` and `requirements/pkgutils.txt`, then run `python -m pytest t/unit/app/test_routes.py -q`. Full integration and smoke suites require their service/container infrastructure; see the testing guide before selecting them.
