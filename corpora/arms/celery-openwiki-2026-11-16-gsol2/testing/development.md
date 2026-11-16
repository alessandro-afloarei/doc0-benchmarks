---
type: testing
title: Development and testing workflows
description: Set up this Celery checkout and choose focused unit, live integration, or Docker smoke coverage for the behavior being changed.
tags: [testing, development, pytest, integration, smoke]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:50:32.264Z
sources:
  - id: openwiki-source-5d3d393604de2260b545f131
    resource: repo://celery/contrib/pytest.py
  - id: openwiki-source-4370bc15e42aa94cee124f42
    resource: repo://celery/contrib/testing/worker.py
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
  - id: openwiki-source-9fe3a610596da7b7f2c71115
    resource: repo://setup.py
  - id: openwiki-source-6168ccd1870abc65a264f683
    resource: repo://t/integration/conftest.py
  - id: openwiki-source-8aa386b793247662031e0f63
    resource: repo://t/smoke/conftest.py
  - id: openwiki-source-fd9bfe0969a721f12fafb53d
    resource: repo://t/unit/conftest.py
  - id: openwiki-source-ccd2623ea7a88d6abc2d9b5a
    resource: repo://tox.ini
generated: { by: "codex", at: "2026-11-16T16:50:32.264Z" }
---

# Development and testing workflows

The repository separates unit tests in `t/unit`, service-backed integration tests in `t/integration`, and container-based smoke tests in `t/smoke`. Choose the layer that exercises the changed boundary: a mocked request callback can establish acknowledgement decisions, while connection recovery and broker QoS require a real transport.

## Environment and focused unit tests

This checkout's `setup.py` requires Python 3.10 or newer; prefer that manifest over older version prose in the introductory README. From the repository root, create an environment and install the checkout plus test tools:

```bash
python -m venv .venv
. .venv/bin/activate
python -m pip install -e .
python -m pip install -r requirements/test.txt -r requirements/pkgutils.txt
python -m pytest t/unit/app/test_routes.py -q
```

Install extras for the subsystem under test, for example `python -m pip install -e '.[redis]'`. `requirements/test-ci-default.txt` supplies the broader CI dependency set, including optional integrations and a Git checkout of Kombu; it is substantially larger than the runtime dependency list. Tox declares the reproducible matrix and its build constraints.

Pytest defaults to `t/unit/`, recognizes classes matching `test_*`, uses strict marker handling, and treats unexpected passes of strict xfails as failures. Passing an explicit file and a focused `-k` expression is usually the fastest feedback loop:

```bash
python -m pytest t/unit/worker/test_consumer.py -q -k prefetch
python -m pytest t/unit/tasks/test_trace.py -q
python -m pytest t/unit/tasks/test_canvas.py -q
```

The unit conftest configures an in-memory broker and cache backend, imports Celery's pytest fixtures, enables the application trap, and resets cache state. Those defaults isolate tests; they are not production configuration guidance. The `app` fixture yields the test application, keeping setup consistent with neighboring tests.

## Fixtures and eager execution boundaries

`celery_app` creates an application from the `celery_config` fixture, optional `@pytest.mark.celery(...)` values, and constructor parameters. `celery_includes` imports worker task modules; `celery_worker_parameters` and `celery_worker_pool` customize worker creation. The bundled plugin defaults its pool fixture to `solo`.

The embedded worker helper starts a real `WorkController` in a thread, normally disables gossip/mingle/heartbeat, waits for readiness, and can verify a ping task. It is useful for message dispatch with a lightweight worker. It does not reproduce a deployment's process isolation, cluster membership, or broker restart behavior by itself.

`task_always_eager` takes the task's local `apply()` path after a serializer round trip. `send_task()` still publishes and warns that eager mode is ignored. Eager execution cannot establish broker routing, acknowledgement/redelivery, pool time limits, or reconnect correctness. Use unit tests for business logic and local hooks, then a live worker when those boundaries matter.

## Integration services and smoke infrastructure

Integration fixtures read `TEST_BROKER` and `TEST_BACKEND`, defaulting to `pyamqp://` and `redis://`. They select prefork, include `t.integration.tasks`, and allow overrides in the root `integration-tests-config.json`. Start the selected services before running, for example:

```bash
TEST_BROKER=pyamqp:// TEST_BACKEND=redis:// python -m pytest t/integration/test_canvas.py -xsv
```

The environment URLs must point to reachable test services with appropriate credentials. Tox's factors select broker/backend combinations; `tox -e 3.12-integration-rabbitmq_redis -- -k chord` uses its configured service settings and integration dependencies, filtering the integration suite by test name. The tox integration command already supplies `t/integration`, so use the direct pytest command above when selecting only one file. Read the test's fixtures before assuming every backend combination exercises the same capabilities.

Smoke tests use external `pytest-celery` and `pytest-docker-tools` infrastructure, with Docker workers and service containers. `t/smoke/conftest.py` adds integration/smoke task modules, Redis services, worker environment values, and restart/kill/termination helpers. These tests need a working Docker environment and may pull/build images. Select a focused smoke test for topology, failover, quorum queues, or worker shutdown; do not expect the unit suite's memory transport to cover those behaviors.

## Tox, documentation, and quality checks

`tox.ini` defines unit/integration/smoke environments across supported interpreters. Unit environments run coverage and pytest; integration and smoke pass explicit suite paths. Available quality environments include `lint` (pre-commit), `mypy` (the selected files in `pyproject.toml`), `bandit`, and Sphinx `apicheck`, `configcheck`, and `linkcheck`.

For the existing Sphinx manuals, install `requirements/docs.txt` and run `make -C docs html`. OpenWiki generation has its own lifecycle and validation, separate from that Sphinx build. This page records test entrypoints; it does not assert that all suites were run while generating the wiki.

## Map changes to tests

| Changed behavior | Representative coverage |
| --- | --- |
| Submission defaults or routing | `t/unit/app/test_app.py`, `test_routes.py`, `test_amqp.py` |
| Worker scheduling, acknowledgements, or reconnects | `t/unit/worker/test_strategy.py`, `test_request.py`, `test_consumer.py`; connection-recovery integration tests |
| Tracing and retries | `t/unit/tasks/test_trace.py`, `test_tasks.py` |
| Canvas or chords | `t/unit/tasks/test_canvas.py`, `test_chord.py`; `t/integration/test_canvas.py` |
| Backend state, expiry, or joining | `t/unit/backends/`; `t/integration/test_backend.py` |
| Deployment failover or quorum QoS | Focused tests under `t/smoke/tests/` |

Read [tox configuration](../../tox.ini), [pytest settings](../../pyproject.toml), [unit fixtures](../../t/unit/conftest.py), [integration fixtures](../../t/integration/conftest.py), [smoke fixtures](../../t/smoke/conftest.py), and [contributor guidance](../../CONTRIBUTING.rst). Return to the [quickstart](../quickstart.md), [worker architecture](../architecture/workers.md), or [Canvas guide](../workflows/canvas.md) for the runtime contract behind each test.
