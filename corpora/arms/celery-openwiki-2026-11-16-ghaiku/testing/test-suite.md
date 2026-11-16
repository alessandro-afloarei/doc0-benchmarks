---
type: testing
title: Test Suite
description: How Celery's tests are organised into unit, integration, smoke, and benchmark suites; the pytest configuration and fixtures; the tox and Makefile entrypoints; and the celery.contrib.testing helpers that let applications and tests run real workers in-process.
tags: [celery, testing, pytest, tox, unit, integration, smoke, fixtures, contrib]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:42:35.525Z
sources:
  - id: openwiki-source-6d4b4e707b8d60b6ccfa3425
    resource: repo://.github/workflows/openwiki-update.yml
  - id: openwiki-source-4370bc15e42aa94cee124f42
    resource: repo://celery/contrib/testing/worker.py
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
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
generated: { by: "claude-code", at: "2026-11-16T10:42:35.525Z" }
---

# Test Suite

Celery's tests live under `t/`, and the reusable testing helpers that ship with the library live under `celery/contrib/testing/`. The suites differ in what they need to run: unit tests need nothing beyond Python, integration tests need real brokers and backends, and smoke tests drive whole worker deployments. Tox environments, Makefile targets, and CI workflows select among them.

## Suites

| Suite | Location | What it covers | Needs |
|---|---|---|---|
| Unit | `t/unit/` | Modules in isolation: app, apps, backends, bin, concurrency, contrib, events, fixups, security, tasks, utils, worker, and the canvas tests in `test_canvas.py` and `test_generics.py` | Python only |
| Integration | `t/integration/` | Tasks, canvas, backends, the database backend, worker behaviour, inspect and control, serialization, security, and connection recovery | Broker and backend services, selected by tox environment |
| Smoke | `t/smoke/` | End-to-end deployments: canvas, consumer, control, signals, stamping, quorum queues, failover, and operations such as worker kill and restart | Docker containers via `pytest-docker-tools` and `pytest-celery`; retries enabled |
| Benchmarks | `t/benchmarks/` | `bench_worker.py`, a worker throughput benchmark | Manual use |

Unit tests are the default and the most numerous. Integration tests are grouped by service in tox (`rabbitmq_redis`, `rabbitmq`, `redis`, `dynamodb`, `azureblockblob`, `cache`, `cassandra`, `elasticsearch`, `docker`), so each job starts only the services it needs. The `t/smoke/conftest.py` file defines container fixtures for Redis and LocalStack and imports the operations helpers `TaskTermination` and `WorkerKill`.

## Pytest configuration

`pyproject.toml` sets `[tool.pytest.ini_options]`:

- `testpaths = "t/unit/"`, so a bare `pytest` run covers only the unit suite;
- `addopts = "--strict-markers"` and a fixed list of custom markers (`sleepdeprived_patched_module`, `masked_modules`, `patched_environ`, `patched_module`, `flaky`, `timeout`, `amqp`);
- `xfail_strict = true`, so an expected failure that unexpectedly passes is reported as a failure.

`pyproject.toml` also configures coverage (`[tool.coverage.run]` with `branch = true` and `include = ["*celery/*"]`, and `[tool.coverage.report]` with a list of omitted modules such as `celery/contrib/testing/*` and `celery/bin/graph.py`).

## Fixtures

`t/unit/conftest.py` sets up the unit suite:

- `celery_config` (session scope, line 60) returns the configuration a test app uses, and `CELERY_TEST_CONFIG` on test classes overrides it (line 207).
- `use_celery_app_trap` (line 91) is the fixture that enables the app trap from `celery.contrib.testing.app`.
- `reset_cache_backend_state` (autouse, line 96) resets cache backend state between tests.
- `app` (line 124) yields the `celery_app` fixture.
- `AAA_disable_multiprocessing` (session, autouse, line 129) disables multiprocessing for the session.
- `assert_signal_called` (line 108) checks that a signal fired with the expected arguments.

`t/integration/conftest.py` imports the `celery_app`, `celery_session_worker`, and `celery_worker` fixtures from `celery.contrib.pytest` (line 9). It defines `celery_config` (line 62), `celery_worker_pool` (line 91, which chooses the pool from an option), `celery_includes` (line 96), `app` (line 101), and `manager` (line 106). It also provides a `flaky` decorator (line 35) and helpers such as `check_for_logs` (line 52). The pytest plugin entry point is `celery.contrib.pytest`, which is listed in `pyproject.toml` as excluded from coverage.

## Testing helpers in `celery.contrib.testing`

These helpers are part of the public package, so applications can reuse them:

- `app.py` provides `TestApp` (line 47), which builds an app suited to tests, `setup_default_app` (line 90), and `Trap` (line 23), which catches calls to the wrong app.
- `worker.py` provides `start_worker` (line 100), which runs a worker in a thread (`_start_worker_thread`, line 140) or a process (`_start_worker_process`, line 196), using `TestWorkController` (line 30), a `WorkController` subclass that is easy to stop from a test. `setup_app_for_worker` (line 219) configures logging.
- `manager.py` provides `Manager` (line 234) and `ManagerMixin` (line 27), which purge queues, wait for tasks, and inspect worker state.
- `mocks.py` provides `TaskMessage` (line 11), `task_message_from_sig` (line 79), and `ContextMock` (line 128), so tests can build realistic message bodies without a broker.
- `tasks.py` defines the `ping` task (line 6), which is a minimal task used to check that a worker is responsive.

## Tox and Makefile entrypoints

`tox.ini` defines the test environments:

- `{3.10,...,3.14,pypy3}-unit` runs `coverage run --source=celery -m pytest -vv --maxfail=10 ... -o junit_family=legacy`.
- `{...}-integration-<service>` runs `pytest -xsvv t/integration`.
- `{...}-smoke` runs `pytest -xsvv t/smoke --reruns 5 --reruns-delay 10`, with `pytest-xdist` installed.

The Makefile provides lint and check targets: `flake8` (`flakecheck`), `apicheck`, `configcheck`, `bandit`, and `readmecheck`, combined under `lint`. `test` runs `setup.py test`, and `cov` runs pytest with coverage and an HTML report. `docs` builds the Sphinx documentation. `pre-commit` configuration is in `.pre-commit-config.yaml`.

## CI

The GitHub Actions workflows under `.github/workflows/` include `python-package.yml` (unit tests across Python versions), `integration-tests.yml` (service-backed integration jobs), `smoke-tests.yml`, `linter.yml`, `docker.yml`, `codeql-analysis.yml`, and `semgrep.yml`. `openwiki-update.yml` runs the OpenWiki generator and opens a pull request with the changes.

## Invariants and practices

- Unit tests must not depend on a broker or backend; use the mocks and the in-memory backends.
- Integration tests rely on real services, so their tox environment must match the services they use.
- Tests that depend on timing are marked `flaky` or given explicit timeouts; `xfail_strict` ensures that a fixed bug removes its xfail marker.
- The worker thread helper and `TestWorkController` let a test start and stop a worker deterministically, which is the preferred way to test worker behaviour in-process.

## Where to start

- To test a change to the worker: [worker](../architecture/worker.md), then `t/unit/worker/`.
- To test canvas or chord behaviour: [canvas](../architecture/canvas.md), then `t/unit/tasks/test_canvas.py` and `t/integration/test_canvas.py`.
- To add an integration test: follow the fixtures in `t/integration/conftest.py` and pick a tox environment that provides the required service.
