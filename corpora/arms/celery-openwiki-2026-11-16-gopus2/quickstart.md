---
type: guide
title: Quickstart
description: Orientation to the Celery repository — what the project is, how the source tree is organised, how to install it for development and run the unit, integration and smoke tests, and a task-routing map pointing to the wiki page to read for common questions and changes.
tags: [quickstart, orientation, development, repository-layout, navigation]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:05:29.073Z
sources:
  - id: openwiki-source-39b293cb4d26aec690dfc284
    resource: repo://celery/__init__.py
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-9fe3a610596da7b7f2c71115
    resource: repo://setup.py
  - id: openwiki-source-ccd2623ea7a88d6abc2d9b5a
    resource: repo://tox.ini
generated: { by: "claude-code", at: "2026-11-16T17:05:29.073Z" }
---

# Quickstart

Celery is a distributed task queue for Python: application code publishes task messages to a broker (RabbitMQ, Redis, SQS, ... via kombu), worker processes execute them, and results can be stored in a pluggable result backend. This repository contains the `celery` package (version `5.6.2`, requires Python ≥ 3.10 per `setup.py`), its tests, documentation, examples and deployment assets.

Start with the [System Architecture Overview](architecture/overview.md) for the end-to-end picture.

## Repository layout

| Path | What lives there | Wiki |
|------|------------------|------|
| `celery/app/` | `Celery` app, configuration defaults, `Task`, AMQP/routing, tracing, control client, builtins | [Application Object](architecture/application-object.md), [Configuration](architecture/configuration.md), [Tasks](tasks/task-definition-and-invocation.md) |
| `celery/canvas.py` | Signatures, chains, groups, chords, stamping | [Canvas](canvas/workflows.md) |
| `celery/result.py`, `celery/backends/` | Result objects and result backends | [Result Objects](results/result-objects.md), [Backends](results/backends.md) |
| `celery/worker/`, `celery/bootsteps.py` | Worker controller, consumer, requests, remote control | [Worker Architecture](worker/worker-architecture.md) and the other `worker/` pages |
| `celery/concurrency/` | prefork/threads/eventlet/gevent/solo pools | [Concurrency Pools](worker/concurrency-pools.md) |
| `celery/beat.py`, `celery/schedules.py` | Periodic task scheduler and schedule types | [Beat](scheduling/beat.md) |
| `celery/events/` | Monitoring event stream and state | [Events](events/monitoring.md) |
| `celery/bin/`, `celery/apps/` | Click CLI and its worker/beat/multi wrappers | [CLI and Deployment](operations/cli.md) |
| `celery/security/` | Message-signing serializer | [Security](operations/security.md) |
| `celery/fixups/`, `celery/contrib/django/` | Django integration | [Django](integrations/django.md) |
| `celery/signals.py`, `celery/utils/dispatch/` | Signal catalog and dispatcher | [Signals and Extension Points](architecture/signals-and-extension-points.md) |
| `celery/contrib/` | pytest plugin, testing helpers, abortable tasks, rdb debugger, migrate, Sphinx ext | [Testing](testing/test-suite.md) |
| `celery/utils/`, `celery/platforms.py`, `celery/local.py`, `celery/_state.py` | Shared utilities, OS/process helpers, proxies, global app state | — |
| `t/unit`, `t/integration`, `t/smoke` | Test suites | [Testing](testing/test-suite.md) |
| `docs/` | Sphinx docs (user guide, configuration reference, internals) | — |
| `examples/` | Sample projects (Django, eventlet/gevent, periodic tasks, ...) | — |
| `extra/`, `docker/`, `helm-chart/` | Init/systemd/supervisord files, dev Docker environment, Helm chart | [CLI and Deployment](operations/cli.md) |
| `requirements/` | Requirement sets; `requirements/extras/*.txt` back the `celery[...]` extras | — |

## Development setup

```console
$ pip install -e .                       # core: kombu, billiard, vine, click, ...
$ pip install -r requirements/test.txt   # pytest, pytest-celery, ...
$ pip install -e '.[redis,sqlalchemy]'   # optional extras, one per requirements/extras/*.txt
```

Optional features are exposed as extras: each name in `EXTENSIONS` in `setup.py` maps to `requirements/extras/<name>.txt` (e.g. `redis`, `sqs`, `mongodb`, `dynamodb`, `gevent`, `eventlet`, `auth`, `pydantic`, `pytest`, `django`).

## Running tests

| Goal | Command |
|------|---------|
| Unit tests (no services needed) | `pytest` (defaults to `t/unit`) or `tox -e 3.13-unit` |
| One module | `pytest t/unit/worker/test_request.py -k acks_late` |
| Integration (needs broker/backend) | `TEST_BROKER=pyamqp:// TEST_BACKEND=redis:// pytest t/integration` or `tox -e 3.13-integration-rabbitmq_redis` |
| Integration in Docker | `docker compose -f docker/docker-compose.yml ...` then `tox -e 3.13-integration-docker` |
| Smoke (Docker, pytest-celery) | `tox -e 3.13-smoke` |
| Lint / docs checks | `tox -e lint`, `tox -e apicheck`, `tox -e configcheck`, `tox -e bandit`, `tox -e mypy` |

`make cov` runs pytest with an HTML coverage report. Details: [Testing: Suites and Utilities](testing/test-suite.md).

## Running Celery locally

```console
$ celery -A proj worker -l INFO          # start a worker (prefork pool)
$ celery -A proj beat -l INFO            # periodic task scheduler
$ celery -A proj inspect active          # remote inspection
$ celery -A proj events                  # curses monitor (enable task events with -E on workers)
```

`-A/--app` and other global options must come before the subcommand.

## Where to look: task routing map

| I want to... | Read |
|--------------|------|
| Understand how a task call becomes a message and a result | [Overview](architecture/overview.md), [Task Definition and Invocation](tasks/task-definition-and-invocation.md) |
| Add or change a configuration setting | [Configuration System](architecture/configuration.md) (also document it in `docs/userguide/configuration.rst` — `configcheck` enforces this) |
| Change how tasks are registered or the app is finalized | [Application Object](architecture/application-object.md) |
| Change message headers, queues or routing | [Message Protocol, Queues and Routing](tasks/messaging-and-routing.md) |
| Debug retries, task states, `on_failure` hooks or signals during execution | [Task Execution, Tracing and Retries](tasks/execution-tracing-and-retries.md) |
| Fix chain/group/chord behaviour or stamping | [Canvas](canvas/workflows.md), [Result Backends](results/backends.md) |
| Debug `AsyncResult.get()` hangs or "Never call result.get() within a task" | [Result Objects](results/result-objects.md) |
| Add or fix a result backend | [Result Backends](results/backends.md) |
| Understand acks, ETA, rate limits, time limits or revocation in the worker | [Task Request Lifecycle](worker/request-lifecycle.md) |
| Investigate prefetch/QoS, reconnection or quorum queues | [Worker Consumer](worker/consumer.md), [Messaging](tasks/messaging-and-routing.md#quorum-queues-and-native-delayed-delivery) |
| Change worker startup/shutdown or add a bootstep | [Worker Architecture and Bootsteps](worker/worker-architecture.md), [Extension Points](architecture/signals-and-extension-points.md) |
| Work on pools, `--autoscale`, or eventlet/gevent | [Concurrency Pools](worker/concurrency-pools.md) |
| Add an `inspect`/`control` command | [Remote Control and Inspection](worker/remote-control.md) |
| Change periodic scheduling | [Periodic Tasks (Beat) and Schedules](scheduling/beat.md) |
| Work on monitoring events | [Events and Monitoring](events/monitoring.md) |
| Change CLI commands or deployment files | [CLI and Deployment](operations/cli.md) |
| Secure messages or review deserialization risks | [Message Signing and Security](operations/security.md) |
| Fix Django-specific behaviour | [Django Integration](integrations/django.md) |
| Write or run tests | [Testing](testing/test-suite.md) |

## Key conventions

- Most objects are **lazy**: configuration, tasks and backends materialise on first use; avoid touching `app.conf`/`app.tasks` at import time in library code.
- Tasks are **singletons per process**; per-call data lives in `task.request`.
- Default serializer is JSON and only JSON is accepted (`accept_content`); pickle must be enabled explicitly.
- Worker-side behaviour is composed of **bootsteps**; prefer adding a step over patching the worker.
- `t/unit` forbids implicit use of the default app (app trap) and checks for leaked threads/logging changes — tests must use the `app` fixture.
