---
type: testing
title: "Testing: Suites and Tooling"
description: How Celery itself is tested — the unit, integration, smoke (pytest-celery/Docker) and benchmark suites, tox environments and TEST_BROKER/TEST_BACKEND matrix, Makefile and Docker targets — plus the celery.contrib.pytest fixtures and celery.contrib.testing helpers available to user projects.
tags: [testing, pytest, tox, integration, smoke, fixtures]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T09:27:53.075Z
sources:
  - id: openwiki-source-5d3d393604de2260b545f131
    resource: repo://celery/contrib/pytest.py
  - id: openwiki-source-a79943d68c1d8f0165ea4359
    resource: repo://celery/contrib/testing/app.py
  - id: openwiki-source-4e3e0920b43b4fcb60fd64d5
    resource: repo://celery/contrib/testing/tasks.py
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
generated: { by: "claude-code", at: "2026-11-15T09:27:53.075Z" }
---

# Testing: Suites and Tooling

Tests live under `t/`. Pytest is configured in `pyproject.toml` (`testpaths = "t/unit/"`, `--strict-markers`, `xfail_strict = true`, test classes named `test_*`), so a bare `pytest` runs only the unit suite.

## Suites

| Suite | Path | Needs | Purpose |
| --- | --- | --- | --- |
| Unit | `t/unit/` | nothing external | Fast, mocked tests mirroring the package layout (`app/`, `backends/`, `worker/`, `concurrency/`, `events/`, `tasks/`, `utils/`, `security/`, `bin/`, `contrib/`, `fixups/`, `apps/`) |
| Integration | `t/integration/` | a live broker + backend | Real workers running `t/integration/tasks.py`; canvas, retries, inspect, backend, security, serialization, connection recovery, memory-leak checks |
| Smoke | `t/smoke/` | Docker | Multi-container scenarios via `pytest-celery`: worker/broker failover, worker kill/restart, task termination, quorum queues and native delayed delivery, stamping, signals, thread safety |
| Benchmarks | `t/benchmarks/bench_worker.py` | broker | Worker throughput measurement |

### Unit suite infrastructure (`t/unit/conftest.py`)

- Imports the `celery.contrib.pytest` fixtures directly (so the plugin need not be installed) and defines a session `celery_config` using in-memory transport/backends.
- Many **autouse** sanity fixtures enforce isolation: no lingering threads, stdout/stderr restored, logging side effects undone, worker shutdown flags (`should_stop`/`should_terminate`) reset, `CELERY_LOADER` env cleared, multiprocessing disabled, and `task_join_will_block` reset.
- Helper fixtures: `app`, `sleepdeprived`, `mask_modules`, `environ`, `patching`, `restore_logging`, platform spoofing (`sys_platform`, `pypy_version`).
- `celery.contrib.testing.mocks.TaskMessage` / `TaskMessage1` / `task_message_from_sig` build fake protocol v2/v1 messages for worker tests.

### Integration suite (`t/integration/conftest.py`)

- Broker and backend come from `TEST_BROKER` (default `pyamqp://`) and `TEST_BACKEND` (default `redis://`).
- Uses a session-scoped embedded worker (`celery_session_worker`) with `celery_includes = ['t.integration.tasks']`, and a `manager` fixture (`celery.contrib.testing.manager.Manager`) offering `wait_for`, `join`, `assert_accepted`, `assert_received`, `wait_until_idle`, `inspect()` helpers.
- A `flaky` decorator retries tests on known transient errors.

### Smoke suite (`t/smoke/`)

Built on `pytest-celery` and `pytest-docker-tools`: workers are Docker containers (`t/smoke/workers/` defines `dev` — built from this checkout — `latest` from PyPI, plus `alt`/`other` variants), with Redis/RabbitMQ/LocalStack containers. `SuiteOperations` mixes in operations such as `WorkerKill`, `WorkerRestart`, `TaskTermination` (`t/smoke/operations/`). Tests under `t/smoke/tests/quorum_queues/` cover quorum-queue QoS, default queue type, native delayed delivery bindings and chord unlock routing.

## Running tests

### tox (`tox.ini`)

- `{3.10…3.14,pypy3}-unit` — `coverage run -m pytest` over the default testpaths, with `junit.xml` and coverage reports.
- `{…}-integration-<matrix>` — `pytest -xsvv t/integration`, where the matrix factor sets `TEST_BROKER`/`TEST_BACKEND`:

  | Factor | Broker | Backend |
  | --- | --- | --- |
  | `rabbitmq_redis` | `pyamqp://` | `redis://` |
  | `rabbitmq` | `pyamqp://` | `rpc` |
  | `redis` | `redis://` | `redis://` |
  | `dynamodb` | `redis://` | `dynamodb://@localhost:8000` |
  | `azureblockblob` | `redis://` | Azurite blob URL |
  | `cache` | `redis://` | `cache+pylibmc://` |
  | `cassandra` | `redis://` | `cassandra://` |
  | `elasticsearch` | `redis://` | `elasticsearch://@localhost:9200` |
  | `docker` | `pyamqp://rabbit:5672` | `redis://redis` |

- `{…}-smoke` — `pytest -xsvv t/smoke --reruns 5 --reruns-delay 10` (requires Docker).
- Quality gates: `flake8`/`lint` (pre-commit), `mypy`, `apicheck` and `configcheck` (Sphinx builders verifying API docs and that every setting is documented), `linkcheck`, `bandit` (`bandit -b bandit.json -r celery/`).
- Dependencies come from `requirements/test*.txt` and `requirements/extras/*.txt`, installed with `requirements/constraints.txt`.

### Makefile / Docker

- `make test-all` runs tox; `make cov` runs pytest with HTML coverage; `make lint` runs flake/apicheck/configcheck/readme checks.
- `make docker-build`, `make docker-unit-tests` (runs `tox -e 3.12-unit` inside the compose `celery` service), `make docker-integration-tests` (`3.12-integration-docker`, allowed to fail while support is incomplete), `make docker-bash`, `make docker-docs`. See [Deployment and Daemonization](../operations/deployment.md#docker-development-environment-docker) for the compose services.

## Testing helpers for user projects

### `celery.contrib.pytest`

A pytest plugin providing fixtures (enable with `pytest_plugins = ("celery.contrib.pytest",)`, or install the `celery[pytest]` extra which pulls in `pytest-celery`):

| Fixture | Scope | Purpose |
| --- | --- | --- |
| `celery_config` | session | Override to configure the test app |
| `celery_parameters` | session | Extra `Celery(...)` constructor args |
| `celery_app` | function | A `TestApp` configured from the above; `@pytest.mark.celery(**overrides)` overrides config per test |
| `celery_worker` | function | Embedded worker thread for `celery_app` |
| `celery_session_app` / `celery_session_worker` | session | Shared app/worker for the whole session |
| `celery_includes`, `celery_class_tasks` | session | Modules / task classes to register |
| `celery_worker_pool` (`solo`), `celery_worker_parameters`, `celery_enable_logging` | session | Worker tuning |
| `use_celery_app_trap`, `depends_on_current_app` | — | Detect / allow implicit `current_app` usage |

### `celery.contrib.testing`

- `app.TestApp(...)` — app with test defaults (`memory://` broker, `cache+memory://` backend, JSON only, UTC, broker heartbeats off) and logging setup suppressed unless `enable_logging=True`; `set_trap()` installs a `Trap` object that raises `RuntimeError('Test depends on current_app')` if code falls back to the current app.
- `worker.start_worker(app, pool='solo', concurrency=1, perform_ping_check=True, shutdown_timeout=10.0, ...)` — context manager running a `TestWorkController` **in a thread** with mingle/gossip (and by default heartbeat) disabled. It asserts the `celery.ping` shared task is registered (defined in `celery.contrib.testing.tasks`, which `TestApp` imports automatically), verifies broker connectivity, waits for the consumer to be ready, sends `test_worker_starting/started/stopped` signals, and resets `task_join_will_block` so tests can call `result.get()`. If the worker thread doesn't exit within `shutdown_timeout` a `RuntimeError` is raised.
- `manager.Manager` — integration-test assertions on top of `app.control.inspect()`.
- `mocks` — fake task messages and context-manager mocks.

## Related

- Repository orientation: [Quickstart](../quickstart.md).
- What the embedded worker runs: [Worker Bootsteps and WorkController](../worker/bootsteps-and-workcontroller.md).
