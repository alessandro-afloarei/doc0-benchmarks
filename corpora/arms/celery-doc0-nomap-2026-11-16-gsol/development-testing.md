---
title: "Development and Testing"
---
## Overview

The repository separates unit tests, service-backed integration tests, and smoke tests. Pytest defaults to `t/unit`, while tox provides explicit environments for the other suites. Application tests can use Celery's pytest fixtures and embedded worker helper. These exercise different boundaries from eager execution, so choose the path that matches the behavior under test: [[Task Publishing and Routing]] and [[Worker Lifecycle and Execution]] explain those production boundaries.

Sources: [pyproject.toml:1-6](repo://pyproject.toml#L1-L6), [tox.ini:1-12](repo://tox.ini#L1-L12), [tox.ini:47-52](repo://tox.ini#L47-L52), [celery/contrib/pytest.py:194-210](repo://celery/contrib/pytest.py#L194-L210), [celery/app/task.py:682-708](repo://celery/app/task.py#L682-L708)

## Prepare the checkout

This checkout packages for Python 3.10 or newer and derives runtime and optional requirements from files under `requirements`. [[Quickstart]] shows an editable installation. For contributor tests, install the default requirements and test requirements; the latter includes pytest plugins, service mocks, typing tools, pre-commit, and selected optional integrations. Extra service-specific dependencies are also selected by tox environments.

Sources: [setup.py:93-125](repo://setup.py#L93-L125), [setup.py:150-159](repo://setup.py#L150-L159), [requirements/test.txt:1-19](repo://requirements/test.txt#L1-L19), [tox.ini:30-43](repo://tox.ini#L30-L43)

```bash
pip install -U -r requirements/test.txt
pip install -U -r requirements/default.txt
```

Sources: [CONTRIBUTING.rst:586-592](repo://CONTRIBUTING.rst#L586-L592)

The unit-test configuration uses a memory transport, a memory cache backend, and a named test queue. It enables an application trap to catch accidental dependence on implicit current/default applications. Some backend-specific tests still read service settings from environment variables, so the unit configuration is not a guarantee that every optional test is independent of external services.

Sources: [t/unit/conftest.py:59-92](repo://t/unit/conftest.py#L59-L92), [celery/contrib/testing/app.py:23-36](repo://celery/contrib/testing/app.py#L23-L36)

## Run repository tests

The contributor guide provides separate unit and integration commands. Pytest enforces strict markers and strict expected-failure handling in this checkout. To narrow feedback, pass a file path such as the worker test example below; the guide also documents `-x` to stop at the first failure, `-s` to show output, and `-v` for verbose reporting.

Sources: [CONTRIBUTING.rst:594-621](repo://CONTRIBUTING.rst#L594-L621), [pyproject.toml:1-6](repo://pyproject.toml#L1-L6)

```bash
pytest t/unit
```

Sources: [CONTRIBUTING.rst:594-599](repo://CONTRIBUTING.rst#L594-L599)

```bash
pytest t/unit/worker/test_worker.py
```

Sources: [CONTRIBUTING.rst:616-621](repo://CONTRIBUTING.rst#L616-L621)

Integration fixtures default `TEST_BROKER` to `pyamqp://` and `TEST_BACKEND` to `redis://`, enable extended result metadata, import integration tasks, and use a prefork worker. They optionally merge configuration from `integration-tests-config.json` in the repository root. Supply working services or environment overrides before using the integration command; [[Results and Backends]] explains why changing the backend can affect workflow capabilities.

Sources: [t/integration/conftest.py:21-22](repo://t/integration/conftest.py#L21-L22), [t/integration/conftest.py:61-97](repo://t/integration/conftest.py#L61-L97)

```bash
pytest t/integration
```

Sources: [CONTRIBUTING.rst:594-600](repo://CONTRIBUTING.rst#L594-L600)

Tox lists Python 3.10 through 3.14 and PyPy environments, with separate unit, integration, and smoke variants. Integration factors set broker/backend combinations such as RabbitMQ plus Redis, RabbitMQ plus RPC, or Redis for both. Smoke tests run from `t/smoke` with rerun settings. Consult the checked-in factors when reproducing a particular service combination rather than assuming the default unit invocation covers it.

Sources: [tox.ini:1-7](repo://tox.ini#L1-L7), [tox.ini:47-80](repo://tox.ini#L47-L80)

## Configure application fixtures

`celery_app` merges the `celery_config` fixture with the nearest `celery` mark's keyword overrides and creates an app in a cleanup context. `celery_parameters` controls constructor inputs, while `celery_config` controls settings. The test-app factory defaults to JSON, UTC, a memory broker, and `cache+memory` results; explicit broker/backend constructor values remove the corresponding default settings so they can take effect.

Sources: [celery/contrib/pytest.py:137-156](repo://celery/contrib/pytest.py#L137-L156), [celery/contrib/pytest.py:172-185](repo://celery/contrib/pytest.py#L172-L185), [celery/contrib/testing/app.py:10-20](repo://celery/contrib/testing/app.py#L10-L20), [celery/contrib/testing/app.py:47-65](repo://celery/contrib/testing/app.py#L47-L65)

| Fixture | Purpose |
| --- | --- |
| `celery_app` | App scoped to a test |
| `celery_session_app` | App shared by session fixtures |
| `celery_worker` | Worker in a thread for a test |
| `celery_session_worker` | Worker shared across the test session |
| `celery_worker_pool` | Pool selection, defaulting to `solo` |
| `celery_worker_parameters` | Controller arguments, including queue selection |
| `celery_includes` | Task modules imported before worker startup |

Sources: [celery/contrib/pytest.py:64-105](repo://celery/contrib/pytest.py#L64-L105), [celery/contrib/pytest.py:115-134](repo://celery/contrib/pytest.py#L115-L134), [celery/contrib/pytest.py:159-210](repo://celery/contrib/pytest.py#L159-L210)

The fixtures construct apps with `set_as_current=False`; tests that need implicit current-app resolution can use `depends_on_current_app`. The optional trap deliberately raises on implicit access. Cleanup restores the previous current and default apps, finalizers, and active-app set, closing the test app where appropriate. This isolation matters when testing the shared-task proxy described in [[Framework Integration and Extensions]].

Sources: [celery/contrib/pytest.py:32-61](repo://celery/contrib/pytest.py#L32-L61), [celery/contrib/pytest.py:213-216](repo://celery/contrib/pytest.py#L213-L216), [celery/contrib/testing/app.py:90-112](repo://celery/contrib/testing/app.py#L90-L112)

## Exercise an embedded worker

`start_worker` is a context manager with default concurrency one and pool `solo`. It emits test-worker lifecycle signals, starts a controller in a thread, and optionally submits `celery.ping` and waits for `pong` before yielding. The pytest worker fixture imports configured includes before entering this helper. A `NO_WORKER` environment value suppresses fixture worker startup.

Sources: [celery/contrib/testing/worker.py:99-136](repo://celery/contrib/testing/worker.py#L99-L136), [celery/contrib/pytest.py:16-16](repo://celery/contrib/pytest.py#L16-L16), [celery/contrib/pytest.py:194-210](repo://celery/contrib/pytest.py#L194-L210)

The thread helper verifies broker connectivity, constructs the test controller without mingle or gossip and normally without heartbeat, starts a daemon thread, and waits for readiness. On exit it requests termination and joins within `shutdown_timeout`; a surviving thread raises `RuntimeError` explaining that the timeout may need to increase. It is real worker execution with explicit test defaults, so it can exercise consumption and backend behavior that eager calls bypass.

Sources: [celery/contrib/testing/worker.py:140-192](repo://celery/contrib/testing/worker.py#L140-L192)

## Understand eager-test coverage

`task_always_eager` causes `Task.apply_async` to serialize and deserialize arguments locally, then call `apply` under a join guard. It does not publish through a consumer, and `send_task` ignores this setting with a warning. Eager result storage additionally depends on `store_eager_result` and ignore-result policy. Use the embedded worker path when a test needs the broker-to-worker boundary rather than only function tracing.

Sources: [celery/app/task.py:682-708](repo://celery/app/task.py#L682-L708), [celery/app/base.py:869-872](repo://celery/app/base.py#L869-L872), [celery/app/trace.py:500-506](repo://celery/app/trace.py#L500-L506)

## Run configured quality checks

The pre-commit configuration includes Python modernization, flake8, unused suppression checks, spelling, merge-conflict/TOML/YAML/line-ending checks, import ordering, mypy, and a local CI test-matrix check. Mypy uses a selected file list in `pyproject.toml`, so its configured scope is narrower than every Python file. Coverage enables branch tracking and limits reporting to Celery, with explicit omissions for test helpers and selected modules.

Sources: [.pre-commit-config.yaml:1-55](repo://.pre-commit-config.yaml#L1-L55), [pyproject.toml:8-25](repo://pyproject.toml#L8-L25), [pyproject.toml:31-55](repo://pyproject.toml#L31-L55)

The contributor guide's HTML coverage command writes a report under `htmlcov`. Tox's unit environment also emits XML and terminal coverage. These checks complement targeted tests: they measure or inspect the configured code scope without changing the runtime contracts documented in the task, workflow, and integration pages.

Sources: [CONTRIBUTING.rst:636-649](repo://CONTRIBUTING.rst#L636-L649), [tox.ini:47-50](repo://tox.ini#L47-L50)

```bash
pytest --cov=celery --cov-report=html
```

Sources: [CONTRIBUTING.rst:639-645](repo://CONTRIBUTING.rst#L639-L645)
