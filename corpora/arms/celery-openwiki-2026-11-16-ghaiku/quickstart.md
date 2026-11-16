---
type: guide
title: Quickstart
description: Entry point for the Celery codebase - what the repository contains, how its packages map to the system's subsystems, and which page to read for producers, workers, canvas, beat, result backends, the CLI, configuration and security, testing, and Django integration.
tags: [celery, quickstart, guide, navigation, overview]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:42:35.525Z
sources:
  - id: openwiki-source-39b293cb4d26aec690dfc284
    resource: repo://celery/__init__.py
  - id: openwiki-source-ac404435efa758dad4bbfc83
    resource: repo://celery/app/defaults.py
  - id: openwiki-source-9fe3a610596da7b7f2c71115
    resource: repo://setup.py
  - id: openwiki-source-6168ccd1870abc65a264f683
    resource: repo://t/integration/conftest.py
  - id: openwiki-source-fd9bfe0969a721f12fafb53d
    resource: repo://t/unit/conftest.py
generated: { by: "claude-code", at: "2026-11-16T10:42:35.525Z" }
---

# Quickstart

Celery is a distributed task queue for Python, released as the `celery` package. Version `5.6.2` is declared in `celery/__init__.py` (line 27). The package installs one console script, `celery`, which points at `celery.__main__:main` (`setup.py`, line 156). This page is a routing map: start here, then follow the link for the question you have.

## Repository layout

| Path | Contents |
|---|---|
| `celery/` | The library: application, worker, beat, backends, canvas, events, CLI, security, contrib helpers |
| `t/` | Tests: `unit/`, `integration/`, `smoke/`, and `benchmarks/` |
| `docs/` | Sphinx documentation, including user guide, internals, and API reference |
| `examples/` | Example projects and task definitions |
| `extra/` | Packaging and platform support files |
| `docker/`, `helm-chart/` | Container and Kubernetes deployment examples |
| `requirements/`, `setup.py`, `pyproject.toml`, `tox.ini`, `Makefile` | Dependencies, packaging, test environments, and build targets |

## Where to go, by question

| I want to understand | Read |
|---|---|
| The overall architecture and how the subsystems fit together | [system overview](architecture/overview.md) |
| What `Celery(...)`, `app.conf`, the registry, and routing do | [application](architecture/application.md) |
| How `@app.task`, `Task`, retries, and the tracer behave | [tasks and tracing](architecture/tasks-and-tracing.md) |
| What happens to one task from publish to acknowledgement | [task execution lifecycle](workflows/task-execution-lifecycle.md) |
| How `chain`, `group`, `chord`, and `map` compose tasks, and how failures propagate | [canvas](architecture/canvas.md) |
| How the worker consumes, runs, acknowledges, and controls tasks | [worker](architecture/worker.md) |
| Which execution pool runs tasks (prefork, solo, thread, eventlet, gevent) | [concurrency pools](architecture/concurrency.md) |
| How periodic tasks are scheduled | [beat scheduler](architecture/beat.md) |
| How results are stored and read; which backends support chords | [result backends](architecture/result-backends.md) |
| Events for monitoring, and signals for in-process hooks | [events and signals](architecture/events-and-signals.md) |
| The `celery` command and how workers, beat, and multi start | [command-line interface](operations/cli.md) |
| Settings, defaults, serializers, and the signing (`auth`) serializer | [configuration and security](operations/configuration-and-security.md) |
| Django setup, database connections in workers, and `DjangoTask` | [Django integration](integrations/django.md) |
| How to run and write unit, integration, and smoke tests | [test suite](testing/test-suite.md) |

## Common starting points

- **Changing how a task is published or routed:** start with [application](architecture/application.md) for routing and options, then the lifecycle workflow.
- **Changing worker behaviour:** start with [worker](architecture/worker.md), then the pool that runs the task in [concurrency pools](architecture/concurrency.md).
- **Changing workflow semantics:** start with [canvas](architecture/canvas.md) and check [result backends](architecture/result-backends.md) for the chord counting that the change may depend on.
- **Adding a test:** check [test suite](testing/test-suite.md) for the suite and tox environment that fits the test's dependencies.

## Conventions worth knowing

- The configuration key for a namespaced setting is the namespace plus the option name joined with an underscore, for example `security_key` or `beat_schedule_filename`.
- Results, events, and task messages are serialized independently; check `accept_content`, `result_accept_content`, and `event_serializer` when changing message formats.
- Long-running processes (worker and beat) are built from bootstep blueprints, so new behaviour is usually added as a step rather than as a branch in the main loop.
