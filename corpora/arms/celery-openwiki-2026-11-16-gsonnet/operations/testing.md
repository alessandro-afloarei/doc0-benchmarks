---
type: operations
title: Testing, Linting and CI
description: How Celery's test suite is organized (unit, integration, smoke), the pytest fixtures and embedded-worker helpers in celery.contrib, tox environments and the broker/backend matrix, Makefile and lint targets, coverage and mypy configuration, and the GitHub workflows.
tags: [celery, testing, pytest, tox, ci, lint, integration, smoke]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:22:47.483Z
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
  - id: openwiki-source-c1a3ee23b76f6fe827119427
    resource: repo://setup.cfg
  - id: openwiki-source-6168ccd1870abc65a264f683
    resource: repo://t/integration/conftest.py
  - id: openwiki-source-8aa386b793247662031e0f63
    resource: repo://t/smoke/conftest.py
  - id: openwiki-source-fd9bfe0969a721f12fafb53d
    resource: repo://t/unit/conftest.py
  - id: openwiki-source-ccd2623ea7a88d6abc2d9b5a
    resource: repo://tox.ini
generated: { by: "claude-code", at: "2026-11-16T09:22:47.483Z" }
---

# Testing, Linting and CI

Celery ships three test tiers under `t/`, plus reusable pytest fixtures in the package itself (`celery.contrib.pytest`, `celery.contrib.testing`) that third-party projects also use. Tooling is driven by `tox.ini`, `Makefile`, `pyproject.toml`, `setup.cfg` and `.pre-commit-config.yaml`. For how to choose which area to read first, see [[/openwiki/quickstart.md]].

## Test tiers

| Tier | Path | Broker/backend | Notes |
|---|---|---|---|
| Unit | `t/unit/` (default `testpaths`) | in-memory (`memory://`, `cache+memory://`) | Fast, no services; mirrors the package layout: `app/`, `backends/`, `worker/`, `concurrency/`, `events/`, `security/`, `bin/`, `utils/`, `tasks/`, `contrib/`, `fixups/`, plus top-level `test_canvas.py`, `test_loops.py`. |
| Integration | `t/integration/` | real brokers/backends chosen via env vars | Starts a real worker (`celery_session_worker`, prefork) and runs tasks end-to-end: `test_canvas.py`, `test_tasks.py`, `test_worker.py`, `test_backend.py`, `test_connection_recovery.py`, `test_security.py`, etc. |
| Smoke | `t/smoke/` | Docker containers via `pytest-celery` / `pytest-docker-tools` | Runs workers in containers (`workers/`: `dev`, `latest`, `alt`, `other`) with helper operations (`worker_kill`, `worker_restart`, `task_termination`) and suites for canvas, consumer, control, signals, stamping, failover and quorum queues. |

pytest options in `pyproject.toml`: `--strict-markers`, `python_classes = "test_*"` (test classes are named `test_xxx`, so test *classes* are lowercase by convention), `xfail_strict = true`, and registered markers (`sleepdeprived_patched_module`, `masked_modules`, `patched_environ`, `patched_module`, `flaky`, `timeout`, `amqp`, plus the `celery(**overrides)` marker from the pytest plugin). `t/skip.py` provides shared skip markers such as `if_pypy`.

## Fixtures and the embedded worker

`celery/contrib/pytest.py` is a pytest plugin (registered by importing its fixtures in the conftest files). It provides `celery_app` (function scope), `celery_session_app`, `celery_worker` and `celery_session_worker`, and overridable session-scoped configuration fixtures: `celery_config`, `celery_parameters`, `celery_worker_parameters`, `celery_includes`, `celery_worker_pool`, `celery_enable_logging`, `use_celery_app_trap`, `celery_class_tasks`. The `@pytest.mark.celery(**overrides)` marker overrides config per test.

`celery/contrib/testing/` supplies the machinery:

- `TestApp` / `setup_default_app` (`testing/app.py`): builds a throwaway `Celery('celery.tests')` with `DEFAULT_TEST_CONFIG`, a quiet `UnitLogging`, and **snapshots and restores global state** (current/default app, app finalizers, registered apps). With `use_trap=True` a `Trap` app replaces the current/default app so any code that implicitly touches `current_app` raises — this catches missing explicit `app=` arguments (the same idea as `C_STRICT_APP`, see [[/openwiki/architecture/overview.md]]). `t/unit/conftest.py` enables the trap for the whole unit suite.
- `start_worker` / `TestWorkController` (`testing/worker.py`): runs an **embedded worker in a thread** (default `solo` pool, concurrency 1) and by default verifies readiness by sending a built-in `ping` task and expecting `'pong'` before yielding. It emits `test_worker_starting` / `test_worker_stopped` signals. With the prefork pool, logs from forked children are forwarded through a billiard queue to the parent logger, and `tblib` pickling support is installed if available.
- `testing/manager.py` (`ManagerMixin`, used by `t/integration/conftest.py`'s `Manager`) offers helpers such as waiting until the system is idle between tests; `testing/mocks.py` and `testing/tasks.py` hold mocks and the `ping` task.

### Unit-test configuration

`t/unit/conftest.py` overrides `celery_config` with an in-memory broker (polling interval 0.1s), `cache+memory://` result backend, a dedicated `testcelery` queue/exchange/routing key and `accept_content=('json', 'pickle')`, plus optional MongoDB settings read from `MONGO_*` env vars. An autouse fixture resets the cache backend's in-memory state after each test, and `assert_signal_called` is a helper context manager for signal assertions.

### Integration configuration

`t/integration/conftest.py` reads `TEST_BROKER` (default `pyamqp://`) and `TEST_BACKEND` (default `redis://`), enables `result_extended`, and merges overrides from an optional `integration-tests-config.json` in the repo root. It forces the **prefork** pool, enables logging, and registers `t.integration.tasks` as the worker's includes. A `flaky` decorator retries on retryable exceptions (used on timing-sensitive canvas tests). The chord regression for nested chain members (`test_chord_unlock_with_failed_task_in_nested_chain_member`) lives here and is skipped on backends that do not support chords (see [[/openwiki/architecture/canvas-workflows.md]]).

## tox environments (`tox.ini`)

- **Envlist**: `{3.10…3.14, pypy3}-unit`, `-integration-{rabbitmq_redis,rabbitmq,redis,dynamodb,azureblockblob,cache,cassandra,elasticsearch,docker}`, `-smoke`, plus `flake8`, `apicheck`, `configcheck`, `bandit`.
- **Commands**: unit runs `coverage run --source=celery -m pytest ... --maxfail=10 --junitxml=junit.xml` then `coverage xml/report`; integration runs `pytest -xsvv t/integration`; smoke runs `pytest -xsvv t/smoke --reruns 5 --reruns-delay 10` (xdist-enabled requirements).
- **Broker/backend matrix** is set through `TEST_BROKER`/`TEST_BACKEND` per factor, e.g. `redis` → `redis://` for both, `rabbitmq` → `pyamqp://` + `rpc`, `rabbitmq_redis` → `pyamqp://` + `redis://`, `cache` → `redis://` + `cache+pylibmc://`, `dynamodb`/`azureblockblob`/`cassandra`/`elasticsearch` → redis broker with that backend, `docker` → containers named `rabbit` and `redis`.
- Requirements come from `requirements/` (`test.txt`, `test-ci-default.txt`, `test-integration.txt`, `docs.txt`, `pkgutils.txt`, `constraints.txt` for build constraints). `usedevelop = True`.
- Other envs: `lint` (pre-commit), `mypy`, `apicheck`/`configcheck`/`linkcheck` (Sphinx builders that check that every public API and every setting is documented), `bandit` (`bandit -b bandit.json -r celery/` — baseline file), and `clean` (also removes pytest-docker-tools containers, networks and volumes).

## Makefile

Key targets: `make test` (`setup.py test`), `make cov` (pytest with HTML coverage), `make test-all` (tox), `make lint` (= `flakecheck apicheck configcheck readmecheck`), `make flakecheck` (flake8 on `celery` and `t`), `make docs`, `make clean*`, `make bump*`/`release`/`dist`/`build`, `make graph` (worker bootstep graph image), and Docker helpers `docker-unit-tests`, `docker-integration-tests`, `docker-lint`, `docker-docs`.

## Lint and quality configuration

- `setup.cfg [flake8]`: max line length 117, ignores a few docstring/black-incompat codes (E203, D102, D104, D105, D107, D401...); `t/*`, `setup.py`, `examples/*`, `docs/*`, `extra/*` skip docstring checks.
- `.pre-commit-config.yaml`: pyupgrade, flake8, yesqa, codespell, standard pre-commit hooks, isort, mypy and local hooks.
- `pyproject.toml`: **mypy is only enforced on an allow-list of files** (`celery/__main__.py`, `states.py`, `signals.py`, `fixups`, `concurrency/thread.py`, `security/certificate.py`, `utils/text.py`, `schedules.py`, `apps/beat.py`) with `disallow_untyped_defs`; coverage uses branch coverage and omits `asynpool.py`, `contrib/testing/*`, `contrib/pytest.py`, `bin/graph.py`, `bin/logtool.py`, `utils/debug.py` and a few others.

## CI workflows (`.github/workflows/`)

`python-package.yml` (unit tests across Python versions on pushes/PRs touching Python, requirements or toml files), `integration-tests.yml`, `smoke-tests.yml`, `linter.yml`, `docker.yml`, `codeql-analysis.yml`, `semgrep.yml`, and `openwiki-update.yml` — an OpenWiki-managed scheduled workflow (daily, plus manual dispatch) that refreshes the generated `openwiki/` pages; do not hand-edit it.

## Practical guidance

- Run a focused unit test with `pytest t/unit/worker/test_request.py -k <name>`; the unit tier needs no services.
- For chord/chain behavior, add both a unit test in `t/unit/backends/test_base.py` or `t/unit/tasks/test_canvas.py` (mock the backend, e.g. the `mark_as_failure` chained-chord test) *and*, when it depends on real backend behavior, an integration test in `t/integration/test_canvas.py`.
- Use `celery_app` / `celery_worker` fixtures and `@pytest.mark.celery(...)` rather than constructing apps manually, so global-state cleanup and the app trap apply.
- Contribution conventions (branching, PR checklist, coding style, documentation requirements) are in `CONTRIBUTING.rst`; new settings and public APIs must also be documented or `configcheck`/`apicheck` fail.
