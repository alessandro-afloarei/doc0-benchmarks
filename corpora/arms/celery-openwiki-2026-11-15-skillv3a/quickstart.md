---
type: guide
title: Celery Repository Quickstart
description: Entry point to the Celery repository wiki. Explains what Celery is, its core dependencies, how the source tree is organized, how to run tests, and which wiki page to read for common questions and changes.
tags: [quickstart, overview, navigation, repository]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:49.645Z
sources:
  - id: openwiki-source-39b293cb4d26aec690dfc284
    resource: repo://celery/__init__.py
  - id: openwiki-source-a33e87501bc6e99159549e28
    resource: repo://requirements/default.txt
  - id: openwiki-source-9fe3a610596da7b7f2c71115
    resource: repo://setup.py
generated: { by: "claude-code", at: "2026-11-15T17:08:49.645Z" }
---

# Celery Repository Quickstart

**Celery** (`celery/__init__.py`, version 5.6.x, series "recovery") is a distributed task queue for Python 3.10+, including PyPy. Applications define **tasks** on a `Celery` app and send them as messages through a **broker** (RabbitMQ, Redis, SQS, and others, via kombu). **Workers** execute the tasks and can store results in a **result backend**. **Beat** schedules periodic tasks, and **events** and **remote control** support monitoring and administration.

Core runtime dependencies (`requirements/default.txt`):

- `kombu`: messaging and transports;
- `billiard`: the multiprocessing fork used by the prefork pool;
- `vine`: promises;
- `click` plus plugins: the CLI;
- `python-dateutil` and `tzlocal`.

Optional features are installed through extras in `requirements/extras/*.txt`, such as `celery[redis]`, `celery[sqlalchemy]`, `celery[auth]`, `celery[gevent]`, and `celery[pydantic]`. The single console script is `celery` → `celery.__main__:main`.

Start with the [Architecture Overview](architecture/overview.md) for the end-to-end flow of a task.

## Repository layout

| Path | Contents |
|---|---|
| `celery/app/` | `Celery` app class, `Task`, tracing, AMQP and routing, control client, settings defaults, built-in tasks |
| `celery/worker/` | `WorkController`, consumer and bootsteps, requests, strategies, worker-side control, state |
| `celery/concurrency/` | prefork (`asynpool`), threads, solo, eventlet, gevent pools |
| `celery/backends/` | result backends |
| `celery/canvas.py`, `celery/result.py` | workflow primitives and result handles |
| `celery/beat.py`, `celery/schedules.py` | periodic scheduler and schedule types |
| `celery/events/` | monitoring events, cluster state, curses monitor |
| `celery/bin/`, `celery/apps/` | click CLI and long-running program wrappers |
| `celery/security/` | message signing serializer |
| `celery/fixups/`, `celery/contrib/` | Django integration, pytest plugin, testing helpers, abortable, rdb, migrate, sphinx |
| `celery/utils/`, `celery/platforms.py`, `celery/local.py`, `celery/_state.py` | shared utilities, OS and daemon layer, proxies, current-app state |
| `t/unit`, `t/integration`, `t/smoke` | test suites |
| `docs/` | Sphinx user guide and reference |
| `extra/`, `docker/`, `helm-chart/` | init scripts, dev environment, sample chart |

## Running tests quickly

```bash
pip install -e . -r requirements/test.txt
pytest t/unit/app/test_app.py -q                  # focused unit test
tox -e 3.12-unit                                  # full unit suite with coverage
TEST_BROKER=redis:// TEST_BACKEND=redis:// pytest -xsv t/integration/test_tasks.py
make docker-unit-tests                            # inside the docker-compose dev env
```

See [Testing](testing/test-suite.md) for suite details and fixtures.

## Where to look: task routing map

| If you need to… | Read |
|---|---|
| Understand how the pieces fit, or follow a task from `delay()` to its result | [Architecture Overview](architecture/overview.md) |
| Change how the app is configured, finalized, or how `@app.task` and `shared_task` register tasks | [The Celery Application Object](architecture/application.md) |
| Add or rename a setting, or understand old and new setting names | [Configuration Settings Reference](reference/configuration.md) |
| Change task options, retries, autoretry, `replace`, states, or exceptions | [Tasks: Definition, Invocation, Retries](tasks/task-lifecycle.md) |
| Change the message format, routing, queues, or quorum-queue delayed delivery | [Task Messages, Protocol and Routing](tasks/messaging-and-routing.md) |
| Debug what happens when a task runs in the worker (signals, hooks, result storing, chain dispatch) | [Task Execution Tracing](tasks/execution-tracing.md) |
| Work on chains, groups, chords, or stamping | [Canvas](canvas/workflows.md) |
| Change `AsyncResult`/`GroupResult` behaviour or `get()` semantics | [Results API](results/result-api.md) |
| Add or fix a result backend, expiry, or a chord join | [Result Backends](results/backends.md) |
| Change worker start-up, bootsteps, or shutdown (warm, cold, soft) | [Worker Architecture and Bootsteps](worker/worker-architecture.md) |
| Debug prefetch, acks, ETA, rate limits, or connection recovery | [Consumer, Strategies and Task Requests](worker/consumer-and-requests.md) |
| Work on prefork, threads, or gevent pools, time limits, or autoscaling | [Concurrency Pools and Autoscaling](worker/concurrency-pools.md) |
| Add or change a `celery inspect`/`control` command, or revoke behaviour | [Remote Control and Inspection](worker/remote-control.md) |
| Change periodic scheduling or crontab maths | [Periodic Tasks: Beat and Schedules](operations/beat-scheduler.md) |
| Work on monitoring events, heartbeats, or the event State model | [Events and Monitoring](operations/events-monitoring.md) |
| Add CLI options or subcommands, `celery multi`, or `-A` resolution | [Command-Line Interface](operations/cli.md) |
| Daemonize, run under systemd or Kubernetes, or use the docker dev env and Helm chart | [Deployment, Daemonization and Packaging](operations/deployment.md) |
| Integrate with Django (DB connections, `delay_on_commit`) | [Django Integration and Fixups](integrations/django.md) |
| Sign messages or harden serialization | [Message Signing](security/message-signing.md) |
| Extend Celery (signals, custom steps, plugins) or use contrib tools | [Contrib Utilities and Extension Seams](extensions/contrib-utilities.md) |
| Run or write tests, or use Celery's pytest fixtures | [Testing](testing/test-suite.md) |

## Conventions worth knowing

- **Everything is lazy.** Configuration, the backend, and tasks are created on first use. `app.tasks` finalizes the app. See [Application](architecture/application.md).
- **Classes are referenced as `"module:Class"` strings** and resolved with `symbol_by_name`. Most subsystems can be replaced this way.
- **Message contract.** Workers depend only on protocol-v2 headers and body plus a task registered under the same name.
- **Lint and doc coverage.** `make lint` runs flake8, `apicheck`, and `configcheck`. New modules and settings must be documented under `docs/` (the reference and the configuration guide).
- **Changelog** lives in `Changelog.rst` and `docs/history/`. Contributor guidelines are in `CONTRIBUTING.rst`.
