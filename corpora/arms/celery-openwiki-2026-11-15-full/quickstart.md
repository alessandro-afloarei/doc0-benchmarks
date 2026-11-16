---
type: guide
title: Quickstart
description: Entry point to the Celery repository wiki — what Celery is, package metadata and dependencies, repository layout, how to run the code and tests, and a task-routing map pointing to the right page for common questions.
tags: [quickstart, overview, navigation, repository-layout]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T09:27:53.075Z
sources:
  - id: openwiki-source-39b293cb4d26aec690dfc284
    resource: repo://celery/__init__.py
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
  - id: openwiki-source-a33e87501bc6e99159549e28
    resource: repo://requirements/default.txt
  - id: openwiki-source-9fe3a610596da7b7f2c71115
    resource: repo://setup.py
  - id: openwiki-source-ccd2623ea7a88d6abc2d9b5a
    resource: repo://tox.ini
generated: { by: "claude-code", at: "2026-11-15T09:27:53.075Z" }
---

# Quickstart

**Celery** is a distributed task queue for Python: applications publish *task messages* to a broker (RabbitMQ, Redis, SQS, ...), *workers* execute them, and an optional *result backend* stores outcomes. This repository contains the `celery` package (version and release series in `celery/__init__.py`, currently `5.6.2` "recovery"), its test suites, documentation sources and deployment examples.

## Package at a glance

- Python **≥ 3.10** (`python_requires` in `setup.py`); console script `celery = celery.__main__:main`.
- Core dependencies (`requirements/default.txt`): **kombu** (messaging), **billiard** (multiprocessing fork used by the prefork pool), **vine** (promises), **click** + plugins (CLI), `python-dateutil`, `tzlocal`, and `exceptiongroup` on Python < 3.11.
- Optional extras (`setup.py` `EXTENSIONS`, each backed by `requirements/extras/<name>.txt`): brokers/backends (`redis`, `sqs`, `mongodb`, `dynamodb`, `s3`, `gcs`, `cassandra`, `couchbase`, `azureblockblob`, `arangodb`, `elasticsearch`, `memcache`, `sqlalchemy`, ...), pools (`eventlet`, `gevent`), serializers/compression (`msgpack`, `yaml`, `brotli`, `zstd`), and features (`auth`, `django`, `pydantic`, `pytest`, `solar`, `tblib`, ...).

## Repository layout

| Path | Contents |
| --- | --- |
| `celery/app/` | `Celery` app class, configuration defaults, `Task`, registry, AMQP/message layer, routing, control client, tracer, logging |
| `celery/worker/` | `WorkController`, bootsteps components, consumer blueprint, request/strategy, remote-control handlers, worker state |
| `celery/concurrency/` | Execution pools: prefork/AsynPool, threads, solo, eventlet, gevent |
| `celery/backends/` | Result backends (Redis, RPC, database, many cloud/NoSQL stores) |
| `celery/canvas.py`, `celery/result.py`, `celery/states.py` | Workflow primitives, result objects, task states |
| `celery/beat.py`, `celery/schedules.py` | Periodic task scheduler and schedule types |
| `celery/events/` | Monitoring events, cluster state, curses monitor |
| `celery/bin/`, `celery/apps/` | CLI commands and the worker/beat/multi program wrappers |
| `celery/security/` | Message signing serializer |
| `celery/fixups/`, `celery/contrib/` | Django integration, pytest plugin, testing helpers, misc. contrib modules |
| `celery/loaders/`, `celery/utils/`, `celery/platforms.py`, `celery/signals.py`, `celery/bootsteps.py` | Supporting infrastructure |
| `t/` | Unit, integration, smoke and benchmark tests |
| `docs/` | Sphinx documentation (user guide, reference, internals) |
| `extra/`, `docker/`, `helm-chart/` | Deployment examples, dev Docker environment, Helm chart |
| `requirements/` | Requirement files for install, extras, tests, docs |

## Minimal usage

```python
# proj/celery.py
from celery import Celery

app = Celery('proj', broker='redis://localhost', backend='redis://localhost')

@app.task
def add(x, y):
    return x + y
```

```console
$ celery -A proj worker -l INFO        # start a worker
$ python -c "from proj.celery import add; print(add.delay(2, 2).get(timeout=10))"
```

## Developing and testing

- Install in a virtualenv with test requirements (`requirements/test.txt`, plus extras as needed).
- `pytest` runs the unit suite (`t/unit/`, configured in `pyproject.toml`); `tox -e 3.12-unit`, `tox -e 3.12-integration-redis` etc. run CI-like environments; `make docker-unit-tests` runs them inside the dev container.
- Lint/docs checks: `tox -e lint`, `tox -e apicheck`, `tox -e configcheck`, `tox -e bandit`.

Details: [Testing: Suites and Tooling](testing/test-suite.md).

## Where to look — task routing map

| If you need to… | Read |
| --- | --- |
| Understand the overall design and a task's end-to-end path | [Architecture Overview](architecture/overview.md) |
| Configure an app, understand lazy config, loaders, `current_app` | [Application Object and Configuration](app/application-and-configuration.md) |
| Define tasks, task options, retries/autoretry, `replace` | [Tasks, Task Registry and Retries](app/tasks-and-registry.md) |
| Route tasks to queues, understand message format, publish retries | [Message Publishing, Protocol and Routing](messaging/publishing-and-routing.md) |
| Extend or debug worker startup/shutdown, bootsteps, signals to the worker process | [Worker Bootsteps and WorkController](worker/bootsteps-and-workcontroller.md) |
| Debug broker connection loss, prefetch/QoS, unknown task errors | [Worker Consumer and Event Loop](worker/consumer.md) |
| Understand acks, `acks_late`, time limits, revocation, how results are stored | [Task Execution: Strategy, Request and Tracing](worker/task-execution.md) |
| Choose or tune prefork/threads/gevent/eventlet/solo, autoscaling | [Concurrency Pools and Autoscaling](worker/concurrency-pools.md) |
| Use `inspect`/`control`, add custom control commands | [Remote Control and Inspection](worker/remote-control.md) |
| Run on RabbitMQ quorum queues, ETA tasks without holding them in workers | [Native Delayed Delivery and Quorum Queues](worker/delayed-delivery-and-quorum-queues.md) |
| Build chains, groups, chords; stamping; chord failures | [Canvas: Signatures and Workflows](canvas/signatures-and-workflows.md) |
| Wait on results, avoid `get()` deadlocks, understand states | [Result Objects](results/result-objects.md) |
| Pick or implement a result backend, chord join internals, expiry | [Result Backends](results/result-backends.md) |
| Schedule periodic tasks, crontab semantics, beat persistence | [Beat and Periodic Scheduling](beat/periodic-tasks.md) |
| Monitor workers/tasks, write an event consumer or camera | [Events and Monitoring](events/monitoring-events.md) |
| Use the `celery` command, `celery multi`, CLI plugins | [Command-Line Interface](cli/command-line.md) |
| Sign messages with certificates | [Message Signing Security](security/message-signing.md) |
| Integrate with Django | [Django Integration](integrations/django.md) |
| Hook signals, customise logging, daemonize, drop privileges | [Signals, Logging and Platform Support](operations/signals-logging-and-platforms.md) |
| Deploy with systemd/supervisord/init.d/Helm | [Deployment and Daemonization](operations/deployment.md) |
| Run or write tests, use the pytest plugin | [Testing: Suites and Tooling](testing/test-suite.md) |
