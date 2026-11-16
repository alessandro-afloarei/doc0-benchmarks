---
type: testing
title: Testing, CI and Development Workflow
description: How Celery is tested and checked, covering the unit, integration, smoke and benchmark tiers, tox environments, shared fixtures and configuration, CI workflows, linting and docs checks, and where to add tests for each subsystem.
tags: [celery, testing, pytest, tox, ci, integration, smoke, lint, workflow]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:56:17.091Z
sources:
  - id: openwiki-source-6d4b4e707b8d60b6ccfa3425
    resource: repo://.github/workflows/openwiki-update.yml
  - id: openwiki-source-766f9fc88b197e7004015c51
    resource: repo://.github/workflows/python-package.yml
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
  - id: openwiki-source-6168ccd1870abc65a264f683
    resource: repo://t/integration/conftest.py
  - id: openwiki-source-8aa386b793247662031e0f63
    resource: repo://t/smoke/conftest.py
  - id: openwiki-source-fd9bfe0969a721f12fafb53d
    resource: repo://t/unit/conftest.py
  - id: openwiki-source-ccd2623ea7a88d6abc2d9b5a
    resource: repo://tox.ini
generated: { by: "claude-code", at: "2026-11-16T17:56:17.091Z" }
---

# Testing, CI and Development Workflow

Tests live in `t/`, split by cost and by what they need from the outside world. The supporting tooling is `tox.ini`, `pyproject.toml` (pytest and mypy config), `Makefile`, `.pre-commit-config.yaml` and the workflows in `.github/workflows/`.

## Test tiers

| Tier | Path | Needs | What it proves |
|---|---|---|---|
| **Unit** | `t/unit/` | nothing external (in-memory broker and cache backend) | Logic of each module in isolation, fast. The default pytest target (`testpaths = "t/unit/"`). |
| **Integration** | `t/integration/` | a real broker and result backend (`TEST_BROKER`, `TEST_BACKEND`), plus a worker started in-process | End-to-end behavior: canvas, tasks, backends, security, inspect, connection recovery. |
| **Smoke** | `t/smoke/` | Docker (`pytest-celery`, `pytest-docker-tools`): containers for RabbitMQ or Redis and for Celery workers | Whole-system behavior across processes: failover, worker kill/restart, quorum queues, stamping, signals. |
| **Benchmarks** | `t/benchmarks/bench_worker.py` | a broker | Worker throughput measurements. These are not part of CI gates. |

`pyproject.toml` sets `--strict-markers` and `xfail_strict = true`. Custom markers are `sleepdeprived_patched_module`, `masked_modules`, `patched_environ`, `patched_module`, `flaky`, `timeout` and `amqp`. An unknown marker is an error, and an `xfail` that unexpectedly passes fails the run.

### Unit tests (`t/unit`)

The directory mirrors the package: `app/`, `backends/` (one file per backend), `bin/`, `concurrency/`, `contrib/`, `events/`, `fixups/`, `security/`, `tasks/` (canvas, chord, result, stamping, tracer and task tests), `utils/`, `worker/`, plus `test_canvas.py`, `test_loops.py` and `test_generics.py`.

`t/unit/conftest.py` imports the pytest plugin from `celery.contrib.pytest` (see [Django integration and contrib](../integrations/django-and-contrib.md)) and defines:

- `celery_config`: the `memory://` broker, `cache+memory://` backend, a dedicated `testcelery` queue and exchange, `accept_content = ('json', 'pickle')`, and options for the Mongo result-store tests (which only run if Mongo is installed and running).
- `use_celery_app_trap`: enabled for unit tests, so any code that silently relies on the implicit current or default app raises. This catches missing `app=` plumbing.
- An autouse fixture that resets cache-backend state between tests, an `assert_signal_called` helper, and shared stubs.

Backends that need third-party libraries are tested against mocks, so these tests run without the services. Real-service checks happen in integration.

### Integration tests (`t/integration`)

`conftest.py` reads `TEST_BROKER` and `TEST_BACKEND` and builds the app config from them, with `result_extended=True`. It can be overridden with an optional `integration-tests-config.json` in the repo root. The fixtures:

- start a session-wide worker (`celery_session_worker`) through the embedded test worker,
- provide `manager` (a `Manager` from `celery.contrib.testing.manager` for waiting on and inspecting results),
- provide `flaky` retry helpers for transient infrastructure errors,
- restore the current app between tests.

Task definitions used by the tests are in `t/integration/tasks.py`, and the worker configuration in `worker_config.py`. The main modules are `test_canvas.py` (the largest), `test_tasks.py`, `test_backend.py`, `test_database_backend.py`, `test_inspect.py`, `test_worker.py`, `test_connection_recovery.py`, `test_security.py`, `test_serialization.py`, `test_loader.py` and `test_mem_leak_in_exception_handling.py`.

### Smoke tests (`t/smoke`)

Built on `pytest-celery`: `SmokeTestSetup` extends `CeleryTestSetup` with docker-backed readiness checks, and `SuiteOperations` mixes in reusable operations from `t/smoke/operations/` (`task_termination.py`, `worker_kill.py`, `worker_restart.py`). Worker images are defined in `t/smoke/workers/` (`dev.py` builds the code under test, `latest.py`, `alt.py`, `other.py` and `docker/` for others). Test packages: `tests/failover/` (broker and worker failover), `tests/quorum_queues/` (QoS, native delayed delivery, chord-unlock routing), `tests/stamping/`, and top-level `test_canvas.py`, `test_consumer.py`, `test_control.py`, `test_signals.py`, `test_tasks.py`, `test_thread_safe.py` and `test_worker.py`. The `tox` smoke env reruns failures (`--reruns 5 --reruns-delay 10`), as container-based tests are inherently flaky.

## tox

`tox.ini` defines the environment matrix:

- `{3.10,3.11,3.12,3.13,3.14,pypy3}-unit` runs `coverage run --source=celery -m pytest ...` over `t/unit`.
- `{py}-integration-{rabbitmq_redis,rabbitmq,redis,dynamodb,azureblockblob,cache,cassandra,elasticsearch,docker}` runs `pytest -xsvv t/integration` with `TEST_BROKER` and `TEST_BACKEND` set per environment name (for example `redis` means `redis://` for both, `rabbitmq` means `pyamqp://` with the `rpc` backend).
- `{py}-smoke` runs `pytest -xsvv t/smoke` with `pytest-xdist`.
- Static checks: `flake8`, `mypy` (`python -m mypy --config-file pyproject.toml`), `lint` (pre-commit), `bandit` (`bandit -b bandit.json -r celery/`), `apicheck`, `configcheck` and `linkcheck` (Sphinx builders that verify the API reference and the configuration reference cover everything, and that links work).
- `clean` removes coverage files, leftover docker containers, networks and volumes created by `pytest-docker-tools`.

Dependency sets are in `requirements/` (`test.txt`, `test-ci-default.txt`, `test-integration.txt`, `docs.txt`, and one file per optional extra in `requirements/extras/`).

## CI (`.github/workflows/`)

- `python-package.yml` ("Celery"): unit tests on pushes and PRs to `main` when Python, text or TOML files change. It runs on Python 3.10 to 3.14 and PyPy on Linux, and on Windows for the newest CPython only, then uploads coverage.
- `integration-tests.yml` and `smoke-tests.yml` are reusable workflows that take a test module name, Python versions and (for integration) tox environments. `python-package.yml` calls them once per test module. Integration timeouts are long (240 minutes), and smoke tests pull the Redis and RabbitMQ images first.
- `linter.yml` (pre-commit), `codeql-analysis.yml`, `semgrep.yml` and `docker.yml` (image build).
- `openwiki-update.yml` is a scheduled and manual job that refreshes the generated wiki (this documentation). See the note in `AGENTS.md` that generated pages should not be edited by hand.

## Local development

- `make test` runs `python setup.py test`, a legacy entry point. Prefer calling pytest or tox directly. Other targets: `flakes`, `apicheck`, `configcheck`, `docs`, `clean`, `bump`, `release`, and Docker-based variants (`docker-build`, `docker-unit-tests`, `docker-lint`, `docker-docs`, `docker-bash`).
- `pytest t/unit` or `tox -e 3.12-unit` for fast feedback, with `-k` to select tests. `pytest t/integration` needs `TEST_BROKER` and `TEST_BACKEND` pointing at running services.
- `pre-commit` runs `flake8` and `isort` (and others from `.pre-commit-config.yaml`). `CONTRIBUTING.rst` documents the branching and release process, and the Docker development environment in `docker/`.

## Where to add tests

| Change | Put the test in |
|---|---|
| New or changed task option, retry, state | `t/unit/tasks/test_tasks.py`, `t/unit/tasks/test_trace.py`; end-to-end in `t/integration/test_tasks.py` |
| Canvas (chain, group, chord, stamping) | `t/unit/tasks/test_canvas.py`, `test_chord.py`, `test_stamping.py`; end-to-end in `t/integration/test_canvas.py` and `t/smoke/tests/test_canvas.py` |
| Result backend | `t/unit/backends/test_<backend>.py`, `t/unit/tasks/test_result.py`; real service in `t/integration/test_backend.py` |
| Worker, consumer, strategy, request | `t/unit/worker/`, `t/unit/test_loops.py`; failure scenarios in `t/smoke/tests/` |
| Pool | `t/unit/concurrency/` |
| Events, control | `t/unit/events/`, `t/unit/app/test_control.py`, `t/unit/worker/test_control.py` |
| CLI | `t/unit/bin/` |
| Beat and schedules | `t/unit/app/test_beat.py`, `t/unit/app/test_schedules.py` |
| Security | `t/unit/security/` |
| Config defaults or new settings | `t/unit/app/test_defaults.py` and the configuration reference, enforced by the `configcheck` tox env |

For the subsystems themselves, see [System overview](../architecture/system-overview.md).
