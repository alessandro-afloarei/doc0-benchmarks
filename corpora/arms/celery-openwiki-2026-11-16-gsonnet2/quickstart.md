---
type: quickstart
title: Celery OpenWiki Quickstart
description: Entry point to the Celery (5.6) repository wiki. Explains what the project is, how the source tree is laid out, and which wiki page to read for each kind of task or question.
tags: [celery, quickstart, overview, navigation, python]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:56:17.091Z
sources:
  - id: openwiki-source-39b293cb4d26aec690dfc284
    resource: repo://celery/__init__.py
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
  - id: openwiki-source-a33e87501bc6e99159549e28
    resource: repo://requirements/default.txt
  - id: openwiki-source-9fe3a610596da7b7f2c71115
    resource: repo://setup.py
generated: { by: "claude-code", at: "2026-11-16T17:56:17.091Z" }
---

# Celery OpenWiki Quickstart

**Celery** is a distributed task queue for Python. Clients publish task messages to a broker (RabbitMQ, Redis, SQS, and others, through the `kombu` library). Workers consume and run them in a process, thread or greenlet pool, and results are optionally stored in a result backend. Beat schedules periodic tasks. Version 5.6.2 (series "recovery"), requires Python 3.10+ (`setup.py`, `celery/__init__.py`).

Core runtime dependencies (`requirements/default.txt`): `kombu` (messaging), `billiard` (multiprocessing), `vine` (promises), `click` with its plugins (CLI), `python-dateutil` and `tzlocal`. Everything else (Redis, SQLAlchemy, Django, gevent, and so on) is an optional extra in `requirements/extras/`.

## Repository layout

| Path | Contents |
|---|---|
| `celery/app/` | The `Celery` app, `Task`, tracer, AMQP message building, routing, defaults |
| `celery/canvas.py` | Signatures, chains, groups, chords |
| `celery/worker/` | Worker, consumer, strategy, request, remote-control handlers |
| `celery/concurrency/` | Execution pools |
| `celery/backends/`, `celery/result.py` | Result storage and result objects |
| `celery/beat.py`, `celery/schedules.py` | Periodic scheduler |
| `celery/events/` | Monitoring events and cluster state |
| `celery/bin/`, `celery/apps/`, `celery/platforms.py` | CLI and process management |
| `celery/security/` | Signed-message serializer |
| `celery/fixups/`, `celery/loaders/`, `celery/contrib/` | Django integration, loaders, contrib tools |
| `celery/utils/` | Shared helpers (signals dispatcher, time, collections, logging) |
| `t/` | Tests: `unit/`, `integration/`, `smoke/`, `benchmarks/` |
| `docs/` | Sphinx user guide, reference and changelog (`docs/userguide/`, `docs/internals/`) |
| `examples/`, `docker/`, `helm-chart/`, `requirements/`, `tox.ini` | Samples, dev containers, packaging and test deps |

The best single starting point is [System overview](architecture/system-overview.md), which traces a task from call to result.

## Which page should I read?

**Understand how something works**

| Question or area | Page |
|---|---|
| "How does a task get from client to worker to result?" | [System overview](architecture/system-overview.md) |
| What is `app.conf`, when is config read, how do `@app.task`/`shared_task` bind, what is `current_app`? | [App, configuration and task registry](architecture/app-and-configuration.md) |
| What does `delay()`/`apply_async()` do, how are queues chosen, how are eta/expires/priority sent? | [Task publishing](workflows/task-publishing.md) |
| What happens inside a worker process: states, retries, errors, time limits, signals, `acks_late`? | [Task execution and tracing](workflows/task-execution-and-tracing.md) |
| How is the worker started and structured, how do prefetch, ETA, rate limits, reconnects and shutdown work? | [Worker, bootsteps and consumer](architecture/worker-and-consumer.md) |
| Prefork vs. gevent vs. threads vs. solo | [Concurrency pools](architecture/concurrency-pools.md) |
| `chain`, `group`, `chord`, `chunks`, callbacks, errbacks, stamping, chord failures | [Canvas](architecture/canvas-workflows.md) |
| Result storage, `AsyncResult`/`GroupResult`, Redis/RPC/DB backends, chord counters | [Result backends and result objects](architecture/result-backends.md) |
| Periodic tasks, crontab, `beat_schedule`, `celery beat` | [Beat scheduler](architecture/beat-scheduler.md) |
| Monitoring events, heartbeats, `inspect`, `control`, `revoke`, mingle/gossip | [Events, monitoring and remote control](architecture/events-and-remote-control.md) |
| `celery worker`, `celery multi`, daemonizing, signals, privileges | [CLI and process management](architecture/cli-and-process-management.md) |
| Django, loaders, autodiscovery, signal dispatcher, abortable tasks, pytest plugin | [Django, loaders and contrib](integrations/django-and-contrib.md) |
| Signing messages, pickle risks, hardening | [Message security](operations/message-security.md) |
| Running and writing tests, CI, tox, linting | [Testing, CI and development workflow](testing/test-strategy.md) |

**Do something**

| Task | Start with |
|---|---|
| Add or change a task option (retry, timeout, acks) | [Task execution](workflows/task-execution-and-tracing.md), then [Task publishing](workflows/task-publishing.md) for how the option is sent. Add the option's setting to `celery/app/defaults.py` ([App and configuration](architecture/app-and-configuration.md)). |
| Fix a workflow (chord or chain) bug | [Canvas](architecture/canvas-workflows.md), then [Result backends](architecture/result-backends.md) for `on_chord_part_return` and `mark_as_failure`. |
| Add a result backend | [Result backends](architecture/result-backends.md) (aliases in `celery/app/backends.py`; subclass `KeyValueStoreBackend` or `BaseBackend`) and its tests in `t/unit/backends/`. |
| Add a pool implementation | [Concurrency pools](architecture/concurrency-pools.md) (subclass `BasePool`, register an alias or use `CELERY_CUSTOM_WORKER_POOL`). |
| Add a worker remote-control command | [Events and remote control](architecture/events-and-remote-control.md) (`@control_command` / `@inspect_command` in `celery/worker/control.py`, plus client methods in `celery/app/control.py`). |
| Add a CLI subcommand | [CLI and process management](architecture/cli-and-process-management.md) (a click command in `celery/bin/`, registered in `celery/bin/celery.py`, or an external plugin in the `celery.commands` entry-point group). |
| Extend the worker with a custom component | [Worker and consumer](architecture/worker-and-consumer.md) (bootsteps via `app.steps['worker']`/`['consumer']`). |
| React to lifecycle events | [Django, loaders and contrib](integrations/django-and-contrib.md) (signals) and [Task execution](workflows/task-execution-and-tracing.md). |
| Debug "task never runs / is rejected / not registered" | [Task publishing](workflows/task-publishing.md) (routing, queues), [Worker and consumer](architecture/worker-and-consumer.md) (unknown task and invalid content handling), [Message security](operations/message-security.md) (`accept_content`). |
| Debug a lost or duplicated task | [Worker and consumer](architecture/worker-and-consumer.md) (acks, reconnect), [Task execution](workflows/task-execution-and-tracing.md) (deduplication, retry), [System overview](architecture/system-overview.md) (delivery model). |
| Add or run tests | [Testing, CI and development workflow](testing/test-strategy.md). |

## Conventions worth knowing

- **Lazy by design.** Configuration, task creation, backend creation and the app's subsystems are created on first use. Finalization binds all tasks. Accessing `app.tasks` or `app.conf` can trigger that work.
- **Hot paths are unrolled.** The tracer and worker strategy are intentionally long and use local-variable caching. Check for performance impact before refactoring them.
- **Compatibility shims are common.** Old setting names (`CELERY_*`), protocol 1 messages, pre-4.0 router and fixup interfaces, and deprecated aliases still exist.
- **Documentation lives in `docs/`.** The Sphinx reference is checked by the `apicheck` and `configcheck` tox environments, so new public APIs and settings must be documented there.
- **Generated wiki.** `openwiki/` is generated. Update source and let the OpenWiki workflow regenerate pages rather than editing them by hand (see `AGENTS.md`).
