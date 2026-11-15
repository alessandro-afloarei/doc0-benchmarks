---
type: testing
title: "Testing: Unit, Integration and Smoke Suites"
description: How Celery is tested and how to run focused tests. Covers the three suites under t/ (unit with in-memory transport, integration against real brokers and backends selected by TEST_BROKER/TEST_BACKEND, docker-based smoke tests with pytest-celery), tox environments and lint targets, and the testing utilities Celery ships for user projects (celery.contrib.pytest fixtures, start_worker, TestApp).
tags: [testing, pytest, tox, integration, smoke, fixtures]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:49.645Z
sources:
  - id: openwiki-source-5d3d393604de2260b545f131
    resource: repo://celery/contrib/pytest.py
  - id: openwiki-source-4370bc15e42aa94cee124f42
    resource: repo://celery/contrib/testing/worker.py
  - id: openwiki-source-6168ccd1870abc65a264f683
    resource: repo://t/integration/conftest.py
  - id: openwiki-source-8aa386b793247662031e0f63
    resource: repo://t/smoke/conftest.py
  - id: openwiki-source-fd9bfe0969a721f12fafb53d
    resource: repo://t/unit/conftest.py
  - id: openwiki-source-ccd2623ea7a88d6abc2d9b5a
    resource: repo://tox.ini
generated: { by: "claude-code", at: "2026-11-15T17:08:49.645Z" }
---

# Testing: Unit, Integration and Smoke Suites

| Suite | Location | Needs | Run |
|---|---|---|---|
| Unit | `t/unit/` (mirrors package layout: `app/`, `backends/`, `worker/`, `tasks/`, `concurrency/`, `events/`, `utils/`, `security/`, `bin/`, `contrib/`, `fixups/`) | nothing external | `pytest t/unit/...` or `tox -e 3.12-unit` |
| Integration | `t/integration/` | a real broker and backend | `TEST_BROKER=... TEST_BACKEND=... pytest -xsv t/integration` or `tox -e 3.12-integration-redis` |
| Smoke | `t/smoke/` | Docker, through `pytest-celery` | `tox -e 3.12-smoke` or `pytest -xsv t/smoke` |
| Benchmarks | `t/benchmarks/bench_worker.py` | broker | manual |

`pyproject.toml` sets `testpaths = "t/unit/"`, `--strict-markers`, `xfail_strict`, and registers markers such as `masked_modules`, `patched_module`, `sleepdeprived_patched_module`, `flaky`, `timeout`, and `amqp`. Test dependencies are in `requirements/test.txt`: pytest, `pytest-celery[all]`, pytest-rerunfailures, pytest-timeout, pytest-subtests, pytest-click, pytest-order, moto, and boto3.

## Unit tests (`t/unit/conftest.py`)

The session `celery_config` fixture uses the **in-memory transport** (`memory://`) and the `cache+memory://` result backend. The queue is a dedicated `testcelery`, and `accept_content` is `('json', 'pickle')`. The `app` fixture wraps `celery_app` from the Celery pytest plugin.

Global safety fixtures, all `autouse`:

- `AAA_disable_multiprocessing` patches `multiprocessing.Process` and `billiard.Process` for the whole session, so no real child processes start, because they break pytest-cov.
- `task_join_will_not_block` forces `task_join_will_block()` to be False, so tests can call `.get()`.
- `threads_not_lingering` fails a test that leaves extra threads alive.
- `sanity_no_shutdown_flags_set`, `sanity_stdouts`, and `sanity_logging_side_effects` fail tests that leave shutdown flags set, replace stdout or stderr, or change root logging.
- `AAA_reset_CELERY_LOADER_env` asserts that `CELERY_LOADER` is not set.
- `reset_cache_backend_state` clears the in-memory cache backend between tests.

Helper fixtures and utilities include `sleepdeprived` (patch out `time.sleep` in a module), `mask_modules` (simulate a missing import), `environ`, `module`, `restore_logging`, `patching`, and `assert_signal_called`. `test_cases_shortcuts` gives class-based tests `self.app`, `self.add`, and similar shortcuts.

Worker internals are tested with message mocks from `celery/contrib/testing/mocks.py` (`TaskMessage`, `TaskMessage1` for protocol 1, `task_message_from_sig`), without a real broker.

## Integration tests (`t/integration/`)

- `conftest.py` reads `TEST_BROKER` (default `pyamqp://`) and `TEST_BACKEND` (default `redis://`) and enables `result_extended`. An optional `integration-tests-config.json` in the repository root overrides configuration.
- It uses the pytest plugin's `celery_session_worker`, a real worker in a thread, and `Manager` from `celery/contrib/testing/manager.py` (helpers such as `wait_for`, `join`, `inspect`, and `query_task_states`).
- `flaky` combines a 300-second timeout with up to 5 reruns on connection-type errors.
- Covered areas: `test_canvas.py` (the largest; real chains, chords, and groups), `test_tasks.py`, `test_backend.py`, `test_database_backend.py`, `test_inspect.py`, `test_worker.py`, `test_connection_recovery.py`, `test_security.py`, `test_serialization.py`, `test_loader.py`, and `test_mem_leak_in_exception_handling.py`.
- The tox factor selects the services, for example:
  - `redis`: `TEST_BROKER=redis://`, `TEST_BACKEND=redis://`;
  - `rabbitmq`: `pyamqp://` with the `rpc` backend;
  - `rabbitmq_redis`;
  - `cache` (pylibmc), `cassandra`, `elasticsearch`, `dynamodb` (local on 8000), `azureblockblob` (Azurite);
  - `docker`: `pyamqp://rabbit:5672` with `redis://redis`, inside the docker-compose environment.

## Smoke tests (`t/smoke/`)

These are built on **pytest-celery**, which starts real brokers (RabbitMQ, Redis), backends, and Celery worker **containers**.

- `conftest.py` defines a `SmokeTestSetup`, mixes operation helpers into `SuiteOperations` (`operations/`: worker kill, restart, task termination), and overrides the Redis broker and backend containers to use `t/smoke/redis.conf`.
- `workers/` defines the worker images: `dev` (current source tree), `latest`/`pypi` (released Celery), `alt`, and `other`. Mixed-version tests use these.
- `tests/` covers canvas, consumer, control, signals, tasks, thread safety, worker behaviour, `failover/`, `quorum_queues/`, `stamping/`, and chain dispatch deduplication.
- tox runs smoke tests with `--reruns 5 --reruns-delay 10` because container timing makes them flaky.

## tox, lint, and CI

`tox.ini` envlist:

- `{3.10…3.14,pypy3}-unit`, which runs `coverage run -m pytest` and produces a JUnit XML report;
- `-integration-{rabbitmq_redis,rabbitmq,redis,dynamodb,azureblockblob,cache,cassandra,elasticsearch,docker}`;
- `-smoke`;
- `flake8`, `apicheck` and `configcheck` (Sphinx checks that every module and setting is documented), `bandit`, and `lint` (pre-commit).

Dependencies are installed under `requirements/constraints.txt`. The Makefile wraps the docker environment with `make docker-unit-tests` and `docker-integration-tests` (see [Deployment](../operations/deployment.md)). The GitHub workflows (`python-package.yml`, `integration-tests.yml`, `smoke-tests.yml`, `linter.yml`) run these.

**Focused runs:**

```bash
pytest t/unit/tasks/test_canvas.py -k chord -q
pytest t/unit/worker/test_request.py::test_Request -q
TEST_BROKER=redis:// TEST_BACKEND=redis:// pytest -xsv t/integration/test_canvas.py -k chain
```

## Testing utilities for user projects

Celery ships two testing APIs, documented in `docs/userguide/testing.rst`. They are **not compatible** with each other.

1. **`celery.contrib.pytest`**. Enable it by installing `pytest-celery`, which pulls it in, or by adding `pytest_plugins = ("celery.contrib.pytest",)` to `conftest.py`.
   - Fixtures:
     - `celery_app`: a `TestApp` built per test from the `celery_config`, `celery_parameters`, and `celery_enable_logging` fixtures;
     - `celery_worker`: a worker thread per test;
     - `celery_session_app` and `celery_session_worker`;
     - `celery_includes`, `celery_worker_pool` (default **`solo`**), `celery_worker_parameters`, and `use_celery_app_trap`, which raises if code touches the default or current app.
   - The marker `@pytest.mark.celery(**overrides)` overrides configuration per test.
2. **`celery.contrib.testing`**:
   - `TestApp()` builds a `Celery` app with test defaults and quiet logging.
   - `start_worker(app, pool='solo', concurrency=1, perform_ping_check=True, shutdown_timeout=10.0)` is a context manager. It runs a `TestWorkController` in a thread without heartbeats, checks the broker connection, and runs the built-in `celery.ping` task to confirm the worker works. When the worker doesn't stop within `shutdown_timeout`, it raises an error suggesting a larger timeout.
   - The `test_worker_started` and `test_worker_stopped` signals.
3. **pytest-celery** (an external package) provides docker-based end-to-end tests, as used by `t/smoke/`.

## See also

- [Contrib Utilities and Extension Seams](../extensions/contrib-utilities.md)
- [Deployment, Daemonization and Packaging](../operations/deployment.md)
- [Quickstart](../quickstart.md)
