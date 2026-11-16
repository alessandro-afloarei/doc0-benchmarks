---
type: testing
title: Development and verification workflows
description: Editable installation, pytest configuration and app fixtures, unit versus service-backed suites, Docker smoke coverage and repository quality checks.
tags: [testing, development, pytest, integration, ci]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:34:04.042Z
sources:
  - id: openwiki-source-4d1645cb6317345817452838
    resource: repo://.pre-commit-config.yaml
  - id: openwiki-source-5d3d393604de2260b545f131
    resource: repo://celery/contrib/pytest.py
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
  - id: openwiki-source-a33e87501bc6e99159549e28
    resource: repo://requirements/default.txt
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
generated: { by: "codex", at: "2026-11-16T06:34:04.042Z" }
---

# Development and verification workflows

The package is installed from `setup.py`, which reads its version from `celery/__init__.py` and dependencies from `requirements/`. It requires Python 3.10 or newer. Core runtime dependencies include Kombu for messaging, Billiard for multiprocessing, Vine for promises and Click for the CLI. Optional backends and integrations are selected through extras.

## Prepare a development environment

From the repository root, using a supported Python interpreter:

```bash
python -m venv .venv
. .venv/bin/activate
python -m pip install -e .
python -m pip install -r requirements/test.txt -r requirements/pkgutils.txt
```

These install the source checkout and the test/tool dependencies. Service-specific suites need additional requirements and running services. `tox.ini` is the executable definition of environment dependencies, interpreter selection and suite commands; use it when reproducing CI rather than inferring behavior from older Makefile targets.

## Choose the smallest meaningful suite

| Scope | Command from the root | What it establishes |
| --- | --- | --- |
| Focused unit behavior | `python -m pytest t/unit/app/test_routes.py -q` | Route matching and merge behavior without a real broker |
| Execution unit behavior | `python -m pytest t/unit/tasks/test_trace.py t/unit/worker/test_request.py -q` | Trace states and request callback decisions |
| Canvas unit behavior | `python -m pytest t/unit/tasks/test_canvas.py -q` | Signature preparation and workflow composition |
| Default unit suite | `python -m pytest` | Tests under configured `t/unit/` discovery |
| Tox unit environment | `tox -e 3.13-unit -- t/unit/app/test_routes.py` | Isolated editable install and coverage commands |
| Service-backed integration | `tox -e 3.13-integration-rabbitmq_redis -- t/integration/test_canvas.py` | Real RabbitMQ/Redis messaging and workflow behavior |
| Container smoke tests | `tox -e 3.13-smoke -- t/smoke/tests` | Docker-based worker and service scenarios |

Substitute an interpreter environment installed on the host. Pytest requires strict markers, uses `test_*` classes, and treats unexpected xfail success as failure. Tests outside `t/unit/` require an explicit path.

## Unit fixtures deliberately simplify the runtime

`t/unit/conftest.py` provides the `app` alias to `celery_app`, memory broker and cache-memory backend settings, patching helpers, signal assertions and isolation checks for logging, threads and shutdown flags. It enables a default-app trap to catch accidental global-app use.

The unit suite patches multiprocessing process construction and relaxes the synchronous-result-join guard. A passing unit test therefore does not establish prefork process safety or prove that waiting inside a production task is safe. Prefer the supplied app and patching fixtures, restore shared state, and add service-backed coverage when behavior depends on delivery or process boundaries.

`celery.contrib.pytest` also exposes configurable app and worker fixtures. Its default worker pool is `solo`; integration fixtures in this repository override that to `prefork`. The worker helper starts an embedded test worker and can verify startup by sending a ping task.

## Integration and smoke boundaries

Integration configuration reads `TEST_BROKER` and `TEST_BACKEND`, defaulting to AMQP and Redis. An optional `integration-tests-config.json` at the root overrides settings. Tox's transport/backend factors set these URLs; they do not by themselves provision every required service. `requirements/test-integration.txt` adds backend dependencies and a Git Kombu dependency, which matters when reproducing compatibility results.

Smoke tests use the external `pytest-celery` package and Docker tools. The smoke configuration checks Docker readiness and supplies container-backed workers and Redis resources. Use these scenarios for worker kills, restarts, task termination and broker disruption, where mocks cannot reproduce acknowledgement and recovery behavior. This harness differs from Celery's in-process `celery.contrib.pytest` fixtures.

## Quality and documentation checks

Tox exposes `lint` for pre-commit hooks, `mypy` for the selected typed modules, `bandit`, and Sphinx `apicheck`, `configcheck` and `linkcheck` environments. Documentation dependencies live in `requirements/docs.txt`. The pre-commit configuration also checks CI test matrices when test files or workflow definitions change. Read the relevant environment before running a broad check; some hooks can rewrite files.

Route changes belong near application tests, worker changes near worker tests, and backend coordination changes need both backend units and integration Canvas scenarios. Use the [system map](../architecture/system.md), [worker guide](../architecture/worker.md) and [Canvas guide](../workflows/canvas.md) to select the owning layer.
