---
type: testing
title: "Testing: Unit, Integration and Smoke Suites"
description: How Celery's own tests are organized and run — the unit suite with in-memory transport and strict sanity fixtures, the integration suite against real brokers/backends selected by TEST_BROKER/TEST_BACKEND, the Docker-based smoke suite built on pytest-celery — plus tox environments and the reusable celery.contrib.pytest / celery.contrib.testing helpers.
tags: [testing, pytest, tox, integration, smoke, fixtures]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:57:55.789Z
sources:
  - id: openwiki-source-5d3d393604de2260b545f131
    resource: repo://celery/contrib/pytest.py
  - id: openwiki-source-a79943d68c1d8f0165ea4359
    resource: repo://celery/contrib/testing/app.py
  - id: openwiki-source-4370bc15e42aa94cee124f42
    resource: repo://celery/contrib/testing/worker.py
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
generated: { by: "claude-code", at: "2026-11-16T06:57:55.789Z" }
---

# Testing: Unit, Integration and Smoke Suites

Tests live under `t/` in three suites with different costs and fidelity:

| Suite | Path | Needs | Run with |
|-------|------|-------|----------|
| Unit | `t/unit/` | Nothing external (memory transport, cache backend) | `pytest` (default `testpaths`) or `tox -e 3.13-unit` |
| Integration | `t/integration/` | Running broker + backend (RabbitMQ, Redis, ...) | `tox -e 3.13-integration-rabbitmq_redis` or `pytest t/integration` with `TEST_BROKER`/`TEST_BACKEND` |
| Smoke | `t/smoke/` | Docker (containers started by pytest-celery) | `tox -e 3.13-smoke` |

Test dependencies are in `requirements/test.txt` (pytest, `pytest-celery[all]`,
pytest-rerunfailures, pytest-subtests, pytest-timeout, pytest-click,
pytest-order, ...) and the CI/extras files next to it.

## pytest configuration

`pyproject.toml` sets `testpaths = "t/unit/"`, `--strict-markers`,
`python_classes = "test_*"` (test classes are lowercase `test_*`), and
`xfail_strict = true`. Registered markers include `masked_modules`,
`patched_module`, `patched_environ`, `sleepdeprived_patched_module`,
`flaky`, `timeout`, `amqp`. `mypy` checks a curated file list, and
coverage excludes hard-to-test modules (`asynpool.py`, `contrib/testing`,
`contrib/pytest.py`, ...).

## Unit suite (`t/unit/conftest.py`)

The unit `celery_config` fixture uses `broker_url='memory://'`,
`result_backend='cache+memory://'`, a `testcelery` default queue, and
`accept_content=('json', 'pickle')`. The app comes from
`celery.contrib.pytest.celery_app` with `use_celery_app_trap=True`, which
makes any accidental use of the *default/current* app raise — tests must pass
`app` explicitly.

Autouse sanity fixtures enforce isolation:

- `AAA_disable_multiprocessing` patches `multiprocessing.Process` and billiard
  process classes for the whole session (real child processes break
  coverage);
- `task_join_will_not_block` resets the "join would block" guard;
- `threads_not_lingering` fails tests that leave new threads running;
- `sanity_no_shutdown_flags_set` fails if a test leaves
  `worker_state.should_stop/should_terminate` set;
- `sanity_stdouts` and `sanity_logging_side_effects` check that
  `sys.stdout`/`stderr` and root logging handlers are restored;
- `AAA_reset_CELERY_LOADER_env`, `reset_cache_backend_state`.

Helper fixtures: `patching` (monkeypatch wrapper with mock creation),
`sleepdeprived` (patch `time.sleep`), `mask_modules` (simulate missing
optional dependencies), `environ`, `module`, `restore_logging`, and
`test_cases_shortcuts`, which injects `self.app`, `self.patching` and
`self.Celery` into class-based tests.

Unit tests mirror the package layout: `t/unit/app`, `backends`, `bin`,
`concurrency`, `contrib`, `events`, `fixups`, `security`, `tasks`,
`utils`, `worker`, plus `t/unit/test_canvas.py` and `test_loops.py`.

## Integration suite (`t/integration/`)

- `TEST_BROKER` (default `pyamqp://`) and `TEST_BACKEND` (default
  `redis://`) choose the services; tox integration factors set them, e.g.
  `rabbitmq` → `pyamqp://` + `rpc`, `redis` → `redis://` both, `dynamodb`,
  `azureblockblob`, `cache`, `cassandra`, `elasticsearch`, `docker`.
- Workers run **in-process** via `celery_session_worker` using the
  **prefork** pool and include `t.integration.tasks`.
- The `manager` fixture wraps `celery.contrib.testing.manager.Manager`, with
  helpers such as `wait_for`, `join`, `assert_accepted`, `assert_received`,
  `assert_task_worker_state`, and waits for idle at teardown.
- A local `flaky` decorator re-runs tests that fail with retryable errors.
- Key files: `test_canvas.py` (largest), `test_tasks.py`, `test_backend.py`,
  `test_inspect.py`, `test_security.py`, `test_serialization.py`,
  `test_connection_recovery.py`, `test_mem_leak_in_exception_handling.py`.
- `docker/docker-compose.yml` provides RabbitMQ, Redis, DynamoDB local and
  Azurite for running these locally.

## Smoke suite (`t/smoke/`)

Built on the external **pytest-celery** plugin and `pytest-docker-tools`:
workers run in Docker containers, so tests can kill, restart or terminate
real worker processes.

- `t/smoke/workers/` defines worker containers: `dev` (the current checkout,
  built from `workers/docker/dev`), `alt` and `other` (dev builds with a
  different worker name, and for `other` a different queue) for multi-worker
  scenarios, and `latest` (the latest Celery release from PyPI) for
  mixed-version clusters.
- `t/smoke/operations/` provides `TaskTermination`, `WorkerKill`,
  `WorkerRestart` helpers mixed into the test setup.
- Tests cover canvas, consumer behaviour, control, failover, quorum queues
  (RabbitMQ native delayed delivery), signals, stamping, thread safety and
  worker shutdown modes. tox runs them with `--reruns 5 --reruns-delay 10`.

## tox environments (`tox.ini`)

- `{3.10..3.14,pypy3}-unit` — `coverage run -m pytest` with JUnit XML output.
- `{...}-integration-{backend}` — `pytest -xsvv t/integration`.
- `{...}-smoke` — `pytest -xsvv t/smoke --reruns 5 --reruns-delay 10`.
- `lint` (pre-commit), `mypy`, `apicheck` / `configcheck` / `linkcheck`
  (Sphinx builders validating API docs and that every setting is documented),
  `bandit` (security lint of `celery/`), `clean` (removes coverage files and
  pytest-docker-tools containers/networks/volumes).

Installs use `--build-constraint requirements/constraints.txt` and an extra
wheel index; `Makefile` provides `test`, `test-all`, `lint`/`flakecheck`,
`apicheck`, `configcheck`, `docs` and readme/contributing generation targets.

## Testing helpers shipped with Celery

These are public APIs for user projects as well as Celery's own suites:

- **`celery.contrib.pytest`** – fixtures `celery_app` (a `TestApp` built
  from `celery_config`, `celery_parameters`, `celery_enable_logging`),
  `celery_worker` / `celery_session_worker` (embedded worker threads),
  `celery_session_app`, and overridable configuration fixtures
  `celery_config`, `celery_includes`, `celery_worker_pool` (default
  **solo**), `celery_worker_parameters`, `use_celery_app_trap`; plus the
  `@pytest.mark.celery(**overrides)` marker. Celery's own `setup.py` does not
  register it as a `pytest11` plugin — Celery's suites import the fixtures in
  their conftests, and user projects enable it via `pytest-celery` or
  `-p celery.contrib.pytest`.
- **`celery.contrib.testing.worker.start_worker(app, pool='solo', ...)`** –
  runs a `TestWorkController` in a daemon thread with mingle/gossip (and by
  default heartbeat) disabled, waits until it is ready, optionally verifies
  it with the built-in `celery.ping` task, and on exit stops it within
  `shutdown_timeout`.
- **`celery.contrib.testing.manager.Manager`** – polling/assertion utilities
  for integration tests.
- **`celery.contrib.testing.app.TestApp` / `setup_default_app`** – isolated
  app creation and the default-app trap.

See also: [Quickstart](../quickstart.md),
[Architecture overview](../architecture/overview.md).
