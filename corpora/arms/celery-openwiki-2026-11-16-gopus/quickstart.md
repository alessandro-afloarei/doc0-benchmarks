---
type: guide
title: Quickstart
description: Orientation for working on the Celery repository — what the project is, how the source tree is laid out, how to install and run the test suites, and a routing map from common questions and tasks to the wiki page that answers them.
tags: [quickstart, orientation, repository-layout, contributing]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:57:55.789Z
sources:
  - id: openwiki-source-39b293cb4d26aec690dfc284
    resource: repo://celery/__init__.py
  - id: openwiki-source-9fe3a610596da7b7f2c71115
    resource: repo://setup.py
  - id: openwiki-source-ccd2623ea7a88d6abc2d9b5a
    resource: repo://tox.ini
generated: { by: "claude-code", at: "2026-11-16T06:57:55.789Z" }
---

# Quickstart

Celery is a distributed task queue for Python: producers publish task
messages to a broker (RabbitMQ, Redis, SQS, ...), workers execute them in a
pool of processes/threads/greenlets, and results can be stored in a result
backend. This repository contains the `celery` package (version and
codename in `celery/__init__.py`), its test suites and documentation. It
requires Python ≥ 3.10 (`setup.py`) and builds on `kombu` (messaging),
`billiard` (multiprocessing), `vine` (promises) and `click` (CLI).

Start with the [Architecture overview](architecture/overview.md) for the big
picture and the end-to-end lifecycle of a task.

## Repository layout

| Path | What lives there |
|------|------------------|
| `celery/app/` | The `Celery` app, `Task`, configuration defaults, message/queue handling (`amqp.py`), routing, tracing, control client, built-in tasks |
| `celery/worker/` | `WorkController`, worker components, consumer blueprint, strategies, `Request`, remote-control handlers, worker state |
| `celery/concurrency/` | Execution pools: prefork (`asynpool.py`), threads, eventlet, gevent, solo |
| `celery/backends/` | Result backends (Redis, RPC, database, cache, cloud stores, ...) |
| `celery/canvas.py`, `celery/result.py` | Workflow primitives and result objects |
| `celery/beat.py`, `celery/schedules.py` | Periodic task scheduler and schedule types |
| `celery/events/` | Monitoring events: dispatcher, receiver, cluster state, curses monitor |
| `celery/bin/`, `celery/apps/` | `celery` CLI subcommands; Worker/Beat/multi application wrappers |
| `celery/security/` | Message signing serializer |
| `celery/fixups/`, `celery/contrib/` | Django integration; testing helpers, pytest plugin, abortable tasks, rdb, migrate, sphinx |
| `celery/utils/`, `celery/platforms.py`, `celery/bootsteps.py`, `celery/local.py` | Shared utilities, OS/daemon helpers, bootsteps framework, lazy proxies |
| `t/unit`, `t/integration`, `t/smoke` | Test suites |
| `docs/` | Sphinx docs (user guide, configuration reference, internals incl. `docs/internals/protocol.rst`) |
| `examples/` | Sample projects (Django, eventlet, gevent, quorum queues, security, stamping, pydantic, ...) |
| `extra/`, `helm-chart/`, `docker/` | Init/systemd/supervisor scripts, Kubernetes chart, development containers |
| `requirements/` | `default.txt` (runtime), `test*.txt`, `docs.txt`, and `extras/*.txt` for each optional extra |

## Development setup

```console
$ python -m pip install -e .                       # development install
$ pip install -U -r requirements/default.txt -r requirements/test.txt
$ pip install -e '.[redis,sqlalchemy]'              # optional extras
```

Each optional dependency group is a file in `requirements/extras/`
(`redis`, `sqs`, `auth`, `eventlet`, `gevent`, `msgpack`, `yaml`,
`django`, `pydantic`, backend-specific ones, ...) exposed as a setuptools
extra by `setup.py`.

## Running tests

```console
$ pytest                                   # unit suite (t/unit, default testpaths)
$ pytest t/unit/worker/test_request.py -k revoked
$ tox -e 3.13-unit                         # unit suite with coverage
$ TEST_BROKER=pyamqp:// TEST_BACKEND=redis:// pytest t/integration
$ tox -e 3.13-integration-rabbitmq_redis   # integration against real services
$ tox -e 3.13-smoke                        # Docker-based smoke tests (pytest-celery)
$ tox -e lint                              # pre-commit hooks
$ tox -e mypy,apicheck,configcheck        # type check, API docs, settings docs
```

`docker/docker-compose.yml` starts RabbitMQ, Redis, DynamoDB local and
Azurite for integration runs. Details:
[Testing](testing/test-suite.md).

Useful conventions while changing code:

- Unit tests run with an **app trap**: always use the `app` fixture or pass
  `app=` explicitly instead of relying on `current_app`.
- Every new setting must be declared in `celery/app/defaults.py` **and**
  documented — `tox -e configcheck` verifies this.
- Test classes are named `test_*` (lowercase), not `Test*`.

## Where to look

| If you want to… | Read |
|-----------------|------|
| Understand the system as a whole | [Architecture overview](architecture/overview.md) |
| Know how the app object, configuration loading, loaders, `current_app` or `shared_task` work | [App and configuration](architecture/app-and-configuration.md) |
| Change task options, `apply_async`, retries/autoretry, `Task.replace`, ack semantics | [Tasks](concepts/tasks.md) |
| Change message format, routing, queues, publish retry, ETA encoding | [Publishing and routing](workflows/task-publishing-and-routing.md) |
| Add a worker component or change startup/shutdown/signal handling | [Worker bootsteps](architecture/worker/worker-bootsteps.md) |
| Debug prefetch, ETA, rate limits, unknown tasks, reconnection, ack/reject | [Consumer and requests](architecture/worker/consumer.md) |
| Change what happens when a task runs, states, callbacks, signals | [Execution tracing](architecture/worker/task-execution-trace.md) |
| Work on prefork/eventlet/gevent/threads pools, time limits, autoscaling | [Concurrency pools](architecture/worker/concurrency-pools.md) |
| Work on chains, groups, chords, stamping, error propagation | [Canvas](concepts/canvas.md) |
| Add or fix a result backend, `AsyncResult.get`, chord counting | [Result backends](architecture/result-backends.md) |
| Change periodic scheduling or `crontab` | [Beat](architecture/beat-scheduler.md) |
| Add an inspect/control command or touch events/monitoring | [Remote control and events](architecture/remote-control-and-events.md) |
| Add a CLI subcommand, change daemonization, `celery multi`, deployment files | [CLI and daemonization](operations/cli-and-daemonization.md) |
| Change serializers, exception serialization or message signing | [Serialization and signing](integrations/security-and-serialization.md) |
| Work on Django support | [Django integration](integrations/django.md) |
| Write or run tests, use `celery.contrib.pytest` | [Testing](testing/test-suite.md) |
