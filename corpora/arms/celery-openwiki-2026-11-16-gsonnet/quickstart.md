---
type: quickstart
title: Celery Quickstart and Task Routing Map
description: Entry point for the Celery repository wiki — what the package is, how the source tree is laid out, how to install, run and test it, and a task-to-page routing table for deciding which wiki page to read first.
tags: [celery, quickstart, overview, navigation, repository-layout]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:22:47.483Z
sources:
  - id: openwiki-source-39b293cb4d26aec690dfc284
    resource: repo://celery/__init__.py
  - id: openwiki-source-965d19cff645fcce36529be3
    resource: repo://celery/__main__.py
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
  - id: openwiki-source-a33e87501bc6e99159549e28
    resource: repo://requirements/default.txt
  - id: openwiki-source-9fe3a610596da7b7f2c71115
    resource: repo://setup.py
generated: { by: "claude-code", at: "2026-11-16T09:22:47.483Z" }
---

# Celery Quickstart and Task Routing Map

**Celery** is a distributed task queue for Python (`celery/__init__.py`: version `5.6.2`, series "recovery"). Clients publish task messages to a broker, workers execute them, and an optional result backend stores outcomes. Messaging comes from **kombu**, the multiprocessing pool from **billiard**, promises from **vine**, and the CLI from **click** (`requirements/default.txt`). It requires Python `>=3.10` (`setup.py`) and installs a single console script, `celery = celery.__main__:main`. Optional dependency groups ("bundles") are in `requirements/extras/` and selected with extras such as `celery[redis]`, `celery[auth]` or `celery[gevent]`.

## Repository layout

| Path | What lives there |
|---|---|
| `celery/app/` | The `Celery` app class (`base.py`), `Task` (`task.py`), AMQP message/queue layer (`amqp.py`), routing, settings defaults (`defaults.py`), tracer (`trace.py`), built-in tasks, logging, autoretry |
| `celery/worker/` | `WorkController`, consumer bootsteps (`consumer/`), strategy, `Request`, event loops, autoscale, worker state, remote-control commands |
| `celery/concurrency/` | Execution pools: prefork (`asynpool.py`), solo, threads, eventlet, gevent |
| `celery/backends/` | Result backends (Redis, RPC, database, cache, MongoDB, S3, ...) and the async result machinery |
| `celery/canvas.py`, `celery/result.py` | Workflow primitives (signature, chain, group, chord) and result objects |
| `celery/beat.py`, `celery/schedules.py` | Periodic task scheduler and schedule types |
| `celery/events/` | Event dispatcher, receiver, in-memory cluster state, snapshots, curses monitor |
| `celery/bin/`, `celery/apps/` | Click CLI commands and the worker/beat/multi program classes |
| `celery/security/` | Message-signing `auth` serializer, certificates and keys |
| `celery/loaders/`, `celery/fixups/` | Config/loader abstraction; Django integration |
| `celery/contrib/` | Pytest plugin, testing helpers, Django task class, rdb debugger, abortable tasks |
| `celery/utils/`, `celery/_state.py`, `celery/local.py` | Shared helpers, current-app/task state, lazy proxies |
| `t/` | `unit/`, `integration/`, `smoke/` tests |
| `docs/` | Sphinx documentation (user guide, reference, history) |
| `docker/`, `helm-chart/`, `examples/`, `extra/` | Dev containers, Kubernetes chart, sample apps, init scripts/shell completions |

## Run something

```bash
pip install -e .[redis]          # or: pip install celery[redis]
celery -A proj worker -l INFO    # run a worker  (proj exposes a Celery instance)
celery -A proj beat              # run the periodic scheduler
celery -A proj inspect active    # query running workers over the control channel
```

`-A/--app` accepts `module`, `module:attr` or a package; see [[/openwiki/architecture/cli.md]] for how it is resolved.

## Run the tests

```bash
pytest t/unit                    # fast, in-memory broker/backend (default testpaths)
pytest t/unit/worker/test_request.py -k revoke
tox -e 3.13-unit                 # full unit environment with coverage
TEST_BROKER=redis:// TEST_BACKEND=redis:// pytest -xsv t/integration
make lint                        # flake8 + Sphinx apicheck/configcheck + readme checks
```

Details — fixtures, tox matrix, smoke tests, CI workflows — are in [[/openwiki/operations/testing.md]].

## Which page should I read?

| If you are... | Read |
|---|---|
| Getting the big picture, or mapping a symptom to a component | [[/openwiki/architecture/overview.md]] |
| Following one task from `delay()` to result | [[/openwiki/workflows/task-lifecycle.md]] |
| Changing configuration, settings defaults, loaders, `shared_task`, autodiscovery, signals, Django integration | [[/openwiki/architecture/application.md]] |
| Changing `apply_async`/`send_task`, routing, queues, retries, eager mode, `replace`, message protocol | [[/openwiki/architecture/tasks.md]] |
| Working on worker startup, bootsteps, consumer, prefetch/QoS, ETA/rate limits, acks, connection recovery, autoscale | [[/openwiki/architecture/worker.md]] |
| Debugging pools, `--concurrency`, prefork child setup, time limits, lost workers, gevent/eventlet | [[/openwiki/architecture/concurrency-pools.md]] |
| Working on results, `AsyncResult`, backend storage, Redis/RPC/database backends, exception serialization | [[/openwiki/architecture/result-backends.md]] |
| Working on chain/group/chord, callbacks/errbacks, stamping, chord failures | [[/openwiki/architecture/canvas-workflows.md]] |
| Working on `celery beat`, `crontab`/`solar`, schedule persistence | [[/openwiki/architecture/beat-scheduler.md]] |
| Working on events, Flower-style monitoring, `inspect`/`control`/`revoke`, gossip/mingle | [[/openwiki/architecture/events-and-monitoring.md]] |
| Adding or changing a CLI command, `celery multi`, daemonization | [[/openwiki/architecture/cli.md]] |
| Message signing, accepted serializers, pickle risks, root-user checks | [[/openwiki/architecture/security.md]] |
| Writing tests, running CI-equivalent checks, linting | [[/openwiki/operations/testing.md]] |

## Conventions worth knowing before editing

- **Lazy by design**: configuration, task creation and backends are evaluated on first use; `app.finalize()` is the point where task decorators become tasks. Don't touch `app.conf` or `app.tasks` at import time in library code (see the application page).
- **Hot paths are unrolled**: `celery/app/trace.py` (`trace_task`) and `celery/worker/strategy.py` are intentionally long and closure-based for speed; change them carefully and run `t/unit/app/test_trace.py` and `t/unit/worker/test_strategy.py`.
- **Behavior toggles via settings**: new options go in `celery/app/defaults.py` and must be documented under `docs/userguide/configuration.rst`, or `configcheck` fails.
- **Test classes are lowercase** (`class test_Foo`) per `python_classes = "test_*"` in `pyproject.toml`.
- **Source is authoritative**: the `docs/` Sphinx tree describes user-facing behavior; for internals trust the code and these pages' cited files.
- `AGENTS.md` and the `openwiki/` tree are managed by OpenWiki; refresh pages with the documented update process rather than hand-editing them.
