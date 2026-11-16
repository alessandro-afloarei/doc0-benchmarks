---
type: testing
title: Development and validation workflows
description: Setting up this checkout, selecting focused unit or service-backed tests, and using repository lint, type, and documentation checks.
tags: [testing, development, pytest, tox, documentation]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:55:28.912Z
sources:
  - id: openwiki-source-a79943d68c1d8f0165ea4359
    resource: repo://celery/contrib/testing/app.py
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
  - id: openwiki-source-c01e87f54a436a66e4d91d2d
    resource: repo://requirements/test-ci-default.txt
  - id: openwiki-source-7afb102df909ae0ebea69e5b
    resource: repo://requirements/test-integration.txt
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
generated: { by: "codex", at: "2026-11-16T07:55:28.912Z" }
---

# Development and validation workflows

This repository separates fast unit tests, service-backed integration tests, and Docker-driven smoke tests. Choose the layer that exercises the changed boundary: a mocked request test can prove acknowledgement decisions, but broker reconnect and process termination need a running worker and services.

## Environment and focused tests

The packaging metadata in [setup.py](../../setup.py) requires Python 3.10 or newer. The README contains release-series guidance that may differ from this checkout; use the checked-out package metadata and tox environments for development.

A focused editable setup is:

```bash
python -m venv .venv
. .venv/bin/activate
python -m pip install -e .
python -m pip install -r requirements/test.txt
python -m pytest t/unit/worker/test_request.py -k acks_on_timeout
```

Optional integrations may need further extras or system libraries. The [tox configuration](../../tox.ini) defines fuller dependency sets, including CI defaults, docs dependencies, and build constraints. Its requirements can include the development Kombu Git checkout, so reproducing CI requires network access and those dependency choices, not just the released Celery requirements.

```bash
python -m pip install tox
tox -e 3.13-unit -- t/unit/tasks/test_canvas.py
```

Select an environment matching an installed interpreter. Tox's unit command runs coverage and pytest; direct pytest is useful for a narrower local edit cycle. The default pytest configuration discovers `t/unit/`, treats unknown markers as errors, uses `test_*` classes, and enables strict xfail behavior.

## Unit fixtures and isolation

[t/unit/conftest.py](../../t/unit/conftest.py) supplies an in-memory broker and cache backend, imports the Celery pytest fixtures, and enables the current-app trap. The trap detects code that accidentally falls back to global app state instead of using the supplied application. Prefer the existing `celery_app` fixtures and neighboring tests' mocks.

Test configuration is not production guidance: the unit fixture accepts JSON and pickle for coverage, while production defaults accept JSON only. Eager task execution also differs from actual delivery: it cannot prove broker routing, prefork isolation, or real acknowledgement behavior.

## Integration and smoke layers

Integration fixtures read `TEST_BROKER` and `TEST_BACKEND`, defaulting to AMQP and Redis. They use prefork workers, include `t.integration.tasks`, and enable extended result metadata. An optional `integration-tests-config.json` at the repository root can override the integration application configuration.

With RabbitMQ and Redis already available:

```bash
tox -e 3.13-integration-rabbitmq_redis -- t/integration/test_tasks.py
```

Tox provides other broker/backend combinations; select the combination relevant to the failure. Do not assume changing environment variables overrides a tox environment that explicitly sets them.

Smoke tests use `pytest-celery` and `pytest-docker-tools` to construct workers and broker/backend containers. Their setup includes a dedicated Redis instance for integration task helpers and operations for worker kill, restart, and task termination. They require Docker and suitable images:

```bash
tox -e 3.13-smoke -- t/smoke/tests
```

## Match tests to behavior

| Changed behavior | Focused starting point |
| --- | --- |
| Configuration or registry | [t/unit/app/test_app.py](../../t/unit/app/test_app.py) |
| Publishing and task retry | [t/unit/tasks/test_tasks.py](../../t/unit/tasks/test_tasks.py), [t/unit/app/test_app.py](../../t/unit/app/test_app.py) |
| Acknowledgement or timeout | [t/unit/worker/test_request.py](../../t/unit/worker/test_request.py) |
| Reconnect and prefetch | [t/unit/worker/test_consumer.py](../../t/unit/worker/test_consumer.py), [integration recovery](../../t/integration/test_connection_recovery.py) |
| Canvas propagation | [unit Canvas](../../t/unit/tasks/test_canvas.py), [integration Canvas](../../t/integration/test_canvas.py) |
<!-- openwiki: broken internal link [../../t/unit/backends] file "../../t/unit/backends" does not exist. Fix the href or restore the target, then delete this comment. -->
| Storage or chord accounting | [t/unit/backends](../../t/unit/backends), [integration backend](../../t/integration/test_backend.py) |
| Periodic scheduling | [Beat tests](../../t/unit/app/test_beat.py), [schedule tests](../../t/unit/app/test_schedules.py) |

## Other repository checks

<!-- openwiki: broken internal link [../../docs] file "../../docs" does not exist. Fix the href or restore the target, then delete this comment. -->
`tox -e lint` runs pre-commit; `tox -e mypy` uses the selected file scope in `pyproject.toml`. Sphinx API and configuration coverage checks are `tox -e apicheck` and `tox -e configcheck`; `tox -e linkcheck` checks documentation links. The main Sphinx source is [docs](../../docs), with build requirements in [requirements/docs.txt](../../requirements/docs.txt). OpenWiki pages form a separate repository guide.

Use [quickstart](../quickstart.md) for a task demonstration, [worker execution](../architecture/worker.md) for failure invariants, and [Canvas](../workflows/canvas.md) for workflow contracts before changing those paths.
