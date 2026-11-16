---
type: testing
title: "Testing: Suites and Utilities"
description: How Celery is tested — the unit suite under t/unit (in-memory broker, session fixtures and sanity checks), the integration suite against real brokers/backends selected by TEST_BROKER/TEST_BACKEND, the Docker-based smoke suite built on pytest-celery, tox environments and CI workflows — and the public testing utilities in celery.contrib.pytest and celery.contrib.testing.
tags: [testing, pytest, tox, integration-tests, smoke-tests, pytest-celery, fixtures]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:05:29.073Z
sources:
  - id: openwiki-source-5d3d393604de2260b545f131
    resource: repo://celery/contrib/pytest.py
  - id: openwiki-source-a79943d68c1d8f0165ea4359
    resource: repo://celery/contrib/testing/app.py
  - id: openwiki-source-4e3e0920b43b4fcb60fd64d5
    resource: repo://celery/contrib/testing/tasks.py
  - id: openwiki-source-4370bc15e42aa94cee124f42
    resource: repo://celery/contrib/testing/worker.py
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
  - id: openwiki-source-6168ccd1870abc65a264f683
    resource: repo://t/integration/conftest.py
  - id: openwiki-source-8aa386b793247662031e0f63
    resource: repo://t/smoke/conftest.py
  - id: openwiki-source-da4ae27b0fdea332f62cd5c9
    resource: repo://t/smoke/workers/latest.py
  - id: openwiki-source-fd9bfe0969a721f12fafb53d
    resource: repo://t/unit/conftest.py
  - id: openwiki-source-ccd2623ea7a88d6abc2d9b5a
    resource: repo://tox.ini
generated: { by: "claude-code", at: "2026-11-16T17:05:29.073Z" }
---

# Testing: Suites and Utilities

The repository has three test suites under `t/` plus user-facing test helpers shipped in `celery/contrib/`.

| Suite | Path | Needs | Run |
|-------|------|-------|-----|
| Unit | `t/unit/` | Nothing external | `pytest` (default `testpaths`) or `tox -e 3.13-unit` |
| Integration | `t/integration/` | Running broker + backend | `tox -e 3.13-integration-rabbitmq_redis` or `TEST_BROKER=... TEST_BACKEND=... pytest t/integration` |
| Smoke | `t/smoke/` | Docker | `tox -e 3.13-smoke` / `pytest t/smoke` |
| Benchmark | `t/benchmarks/bench_worker.py` | Broker | manual |

Test dependencies are in `requirements/test.txt` (includes `pytest-celery[all]`), `test-ci-default.txt`, and `test-integration.txt`.

## Unit tests (`t/unit/`)

Layout mirrors the package: `app/`, `apps/`, `backends/`, `bin/`, `concurrency/`, `contrib/`, `events/`, `fixups/`, `security/`, `tasks/`, `utils/`, `worker/`, plus `test_canvas.py`, `test_loops.py`. `pyproject.toml` configures pytest with `--strict-markers`, `xfail_strict=true`, `python_classes = "test_*"` and custom markers (`sleepdeprived_patched_module`, `masked_modules`, `patched_environ`, `patched_module`, `flaky`, `timeout`, `amqp`).

`t/unit/conftest.py` sets up the environment:

- `celery_config` uses the in-memory transport (`memory://`) and `cache+memory://` backend, with a `testcelery` default queue and `accept_content=('json', 'pickle')`.
- The `app` fixture is the per-test `celery_app` from `celery.contrib.pytest`; a session-scoped **app trap** (`use_celery_app_trap`) makes any accidental use of the implicit default app fail, catching code that ignores the explicit `app`.
- Autouse fixtures reset the cache backend between tests, disable multiprocessing, ensure `task_join_will_block` is reset, reset `CELERY_LOADER`, and **sanity-check side effects**: lingering threads, shutdown flags left set, replaced `sys.stdout/stderr`, and root logger level/handler changes all fail the test.
- Helper fixtures: `sleepdeprived` (patch `time.sleep`), `mask_modules` (simulate missing imports), `environ`, `module`, `restore_logging`, `patching`.
- Class-based tests get `self.app` and `self.CELERY_TEST_CONFIG` via `test_cases_shortcuts`.

Coverage: `tox` unit envs run `coverage run --source=celery -m pytest`; `pyproject.toml` omits some modules (`asynpool.py`, `contrib/testing`, `bin/graph.py`, ...).

## Integration tests (`t/integration/`)

- `TEST_BROKER` (default `pyamqp://`) and `TEST_BACKEND` (default `redis://`) choose the services; tox defines one factor per combination: `rabbitmq` (rpc backend), `redis`, `rabbitmq_redis`, `cache`, `cassandra`, `elasticsearch`, `dynamodb`, `azureblockblob`, `docker` (hosts `rabbit`/`redis` from `docker/docker-compose.yml`).
- The suite uses `celery.contrib.pytest`'s `celery_session_worker` (a real worker thread in the test process) with tasks from `t/integration/tasks.py`; the `manager` fixture wraps the app in `celery.contrib.testing.manager.Manager` for helpers like `assert_accepted`, `join`, `wait_for`.
- A `flaky` decorator retries tests on known transient errors.
- Key modules: `test_canvas.py` (large workflow matrix), `test_tasks.py`, `test_backend.py`, `test_database_backend.py`, `test_inspect.py`, `test_security.py`, `test_serialization.py`, `test_connection_recovery.py`, `test_mem_leak_in_exception_handling.py`, `test_worker.py`.

## Smoke tests (`t/smoke/`)

Built on **pytest-celery**: each test gets real containers (broker, backend, workers) via `pytest-docker-tools`.

- `t/smoke/conftest.py` defines `SmokeTestSetup` and `SuiteOperations`, which mixes in operations from `t/smoke/operations/` (`TaskTermination`, `WorkerKill`, `WorkerRestart`).
- `t/smoke/workers/` defines worker containers: `dev`, `alt` and `other` are built from this checkout (`t/smoke/workers/docker/dev`; `alt`/`other` differ in worker name and queue), while `latest` installs the released Celery from PyPI (`t/smoke/workers/docker/pypi`), enabling mixed-version clusters.
- A dedicated Redis container is raised for integration tasks reused in smoke tests.
- Test areas: `test_canvas.py`, `test_consumer.py`, `test_control.py`, `test_signals.py`, `test_tasks.py`, `test_thread_safe.py`, `test_worker.py`, `test_dedup_chain_dispatch.py`, `failover/`, `quorum_queues/`, `stamping/`.
- tox runs them with `--reruns 5 --reruns-delay 10`. `tox -e clean` removes leftover pytest-docker-tools containers, networks and volumes.

## Other tox environments

`flake8`/`lint` (pre-commit), `apicheck` and `configcheck` (Sphinx builders verifying API docs and that every setting in `NAMESPACES` is documented), `linkcheck`, `bandit` (security lint of `celery/`), `mypy` (typed subset listed in `pyproject.toml`). CI workflows in `.github/workflows/` (`python-package.yml`, `integration-tests.yml`, `smoke-tests.yml`, `linter.yml`, `docker.yml`, `codeql-analysis.yml`, `semgrep.yml`) run these.

## Testing utilities for users

### `celery.contrib.pytest`

A pytest plugin (enable with `pytest_plugins = ('celery.contrib.pytest',)` or via the `pytest-celery` package). It registers the `celery(**overrides)` marker and provides fixtures:

| Fixture | Scope | Purpose |
|---------|-------|---------|
| `celery_config`, `celery_parameters`, `celery_worker_parameters`, `celery_includes`, `celery_worker_pool`, `celery_enable_logging` | session | Override to configure test apps/workers |
| `celery_app` | function | Fresh `TestApp` honouring `@pytest.mark.celery(...)` overrides |
| `celery_worker` | function | Embedded worker for `celery_app` |
| `celery_session_app`, `celery_session_worker` | session | Long-lived app/worker for suites |
| `use_celery_app_trap` | session | Fail on use of the default app |
| `depends_on_current_app` | function | Make `celery_app` current |

### `celery.contrib.testing`

- `app.TestApp(...)` — app with test defaults (memory broker, `cache+memory` backend) and optional `Trap` for the default app.
- `worker.start_worker(app, concurrency=1, pool='solo', perform_ping_check=True, ...)` — context manager running a `TestWorkController` in a thread; by default it waits for the built-in `celery.ping` task (from `celery.contrib.testing.tasks`) to return `'pong'`. Emits `test_worker_starting`/`test_worker_started`/`test_worker_stopped` signals.
- `manager.Manager` — assertions for integration tests (`wait_for`, `ensure_not_for_a_while`, `join`, `assert_accepted`, `assert_received`, `assert_result_tasks_in_progress_or_completed`).
- `mocks.TaskMessage(...)`, `task_message_from_sig(...)`, `ContextMock` — fabricate task messages for unit-testing worker-side code.

## Where to look for focused tests

| Subsystem | Tests |
|-----------|-------|
| App/config | `t/unit/app/test_app.py`, `test_defaults.py`, `test_loaders.py` |
| Messaging/routing | `t/unit/app/test_amqp.py`, `test_routes.py` |
| Tracing/retries | `t/unit/tasks/test_trace.py`, `test_tasks.py` |
| Canvas | `t/unit/tasks/test_canvas.py`, `test_chord.py`, `test_stamping.py` |
| Backends | `t/unit/backends/` |
| Worker | `t/unit/worker/` (`test_worker.py`, `test_consumer.py`, `test_request.py`, `test_strategy.py`, `test_control.py`, `test_loops.py`, `test_native_delayed_delivery.py`) |
| Pools | `t/unit/concurrency/` |
| Beat | `t/unit/app/test_beat.py`, `test_schedules.py` |
| Events | `t/unit/events/` |
| CLI | `t/unit/bin/`, `t/unit/apps/test_multi.py` |

## Related

- [Quickstart](../quickstart.md)
- [Worker Architecture and Bootsteps](../worker/worker-architecture.md)
