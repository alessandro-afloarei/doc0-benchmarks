---
title: "Development and Testing"
---
## Overview

This checkout separates unit tests, service-backed integration tests and Docker-oriented smoke tests. Pytest defaults to the unit tree; tox supplies interpreter/service combinations and documentation/static checks. [[Framework Integrations]] describes the public test-application and embedded-worker helpers, while this page explains how the repository configures and validates its own changes. Use the system page for the behavior under test, such as [[Canvas Workflows]] for composition or [[Task Execution and Retries]] for outcomes.

Sources: [pyproject.toml:1-6](repo://pyproject.toml#L1-L6), [tox.ini:1-12](repo://tox.ini#L1-L12), [tox.ini:47-52](repo://tox.ini#L47-L52), [t/integration/conftest.py:61-97](repo://t/integration/conftest.py#L61-L97), [t/smoke/conftest.py:5-27](repo://t/smoke/conftest.py#L5-L27)

## Install the checkout and test dependencies

The package metadata requires Python 3.10 or newer. Contributor guidance installs the checkout in editable mode so code edits remain visible to the environment. The package's runtime dependency list comes from `requirements/default.txt`, and test requirements include pytest, pytest-celery, timeout/retry helpers and backend-related extras. Test environments in tox additionally load packaging utilities and interpreter-specific dependency lists.

Sources: [setup.py:118-125](repo://setup.py#L118-L125), [setup.py:150-157](repo://setup.py#L150-L157), [CONTRIBUTING.rst:515-527](repo://CONTRIBUTING.rst#L515-L527), [requirements/test.txt:1-19](repo://requirements/test.txt#L1-L19), [tox.ini:30-45](repo://tox.ini#L30-L45)

```bash
python -m pip install -e .
```

Sources: [CONTRIBUTING.rst:525-527](repo://CONTRIBUTING.rst#L525-L527)

The contributor test setup installs the test and runtime requirement lists before invoking pytest. Development requirements are a separate list: they select Git versions of py-amqp, Kombu and billiard alongside vine and isort. That list is useful when working across Celery's dependencies, but it does not replace the test dependency list. Tox uses build constraints from `requirements/constraints.txt` in its pip install command.

Sources: [CONTRIBUTING.rst:587-600](repo://CONTRIBUTING.rst#L587-L600), [requirements/dev.txt:1-5](repo://requirements/dev.txt#L1-L5), [tox.ini:30-45](repo://tox.ini#L30-L45)

```bash
pip install -U -r requirements/test.txt
pip install -U -r requirements/default.txt
```

Sources: [CONTRIBUTING.rst:587-592](repo://CONTRIBUTING.rst#L587-L592)

## Run a focused unit check

Pytest configuration enables strict markers, discovers classes named `test_*`, treats unexpected passes of expected-failure tests as failures and selects `t/unit/` by default. The contributor guide shows both the whole unit tree and a single worker test module. Passing a file lets a contributor validate the subsystem being edited before running broader service-dependent suites.

Sources: [pyproject.toml:1-6](repo://pyproject.toml#L1-L6), [CONTRIBUTING.rst:595-621](repo://CONTRIBUTING.rst#L595-L621)

```bash
pytest t/unit/worker/test_worker.py
```

Sources: [CONTRIBUTING.rst:617-621](repo://CONTRIBUTING.rst#L617-L621)

The unit conftest imports Celery's pytest helpers explicitly. Its settings select an in-memory broker and result cache plus a dedicated test queue/exchange/routing key. The application trap is enabled, and an autouse fixture clears cache backend state after tests. Another session fixture patches multiprocessing process types because the comments identify coverage incompatibility with starting child processes in this suite. Unit tests therefore have different process boundaries from integration tests.

Sources: [t/unit/conftest.py:19-30](repo://t/unit/conftest.py#L19-L30), [t/unit/conftest.py:59-104](repo://t/unit/conftest.py#L59-L104), [t/unit/conftest.py:128-145](repo://t/unit/conftest.py#L128-L145)

## Exercise service-backed behavior

Integration configuration reads `TEST_BROKER` and `TEST_BACKEND`, defaulting to AMQP and Redis. It enables extended results, supplies Cassandra test settings and merges optional overrides from a root `integration-tests-config.json`. It chooses the prefork pool and imports integration task modules. The manager fixture waits for worker idleness during cleanup and logs cleanup failures. [[Result Backend Catalogue]] identifies dependencies and settings relevant to backend-specific tests.

Sources: [t/integration/conftest.py:21-22](repo://t/integration/conftest.py#L21-L22), [t/integration/conftest.py:61-112](repo://t/integration/conftest.py#L61-L112)

Tox's integration factors select broker/backend combinations, including RabbitMQ with RPC, Redis with Redis, RabbitMQ with Redis and a Docker network combination. Separate factors configure cache, Cassandra, Elasticsearch, DynamoDB and Azure Blob settings. The integration command explicitly targets `t/integration`; it does not depend on pytest's default unit selection. Provision the services corresponding to the chosen factor rather than interpreting a missing service as a task implementation failure.

Sources: [tox.ini:47-88](repo://tox.ini#L47-L88)

```bash
pytest t/integration
```

Sources: [CONTRIBUTING.rst:595-600](repo://CONTRIBUTING.rst#L595-L600)

## Validate container and cluster behavior

Smoke configuration uses pytest-celery and pytest-docker-tools, with a setup readiness check that explicitly includes Docker. It combines shared integration tasks and smoke tasks in workers. A dedicated Redis container is configured with the repository Redis configuration; host tests use the exposed port, while worker environments receive the container hostname. Suite operation mixins provide task termination, worker kill and restart scenarios.

Sources: [t/smoke/conftest.py:5-38](repo://t/smoke/conftest.py#L5-L38), [t/smoke/conftest.py:51-102](repo://t/smoke/conftest.py#L51-L102)

Tox invokes smoke tests separately with reruns and a delay. Its interpreter matrix covers CPython 3.10 through 3.14 and PyPy3 across unit, integration and smoke factors. Unit runs collect coverage and emit XML, a console report and JUnit output. The CI Python workflow installs tox and executes a selected tox environment, connecting repository configuration to automated validation.

Sources: [tox.ini:1-7](repo://tox.ini#L1-L7), [tox.ini:47-52](repo://tox.ini#L47-L52), [.github/workflows/python-package.yml:63-83](repo://.github/workflows/python-package.yml#L63-L83)

## Run static and documentation checks

| Check | Repository implementation |
| --- | --- |
| Lint | Tox runs pre-commit across files, showing differences on failure |
| API reference coverage | Sphinx `apicheck` builder |
| Configuration reference coverage | Sphinx `configcheck` builder |
| Documentation links | Sphinx `linkcheck` builder |
| Security scanning | Bandit with the checked-in baseline |
| Type checking | Mypy with the selected file set in `pyproject.toml` |

Sources: [tox.ini:101-124](repo://tox.ini#L101-L124), [pyproject.toml:8-25](repo://pyproject.toml#L8-L25)

Pre-commit configures pyupgrade, flake8, yesqa, spelling, merge/TOML/YAML checks, line endings, import sorting and mypy. A local hook invokes `scripts/check-ci-test-matrices` when relevant tests or CI matrix files change. The linter workflow runs pre-commit on pull requests and manual dispatch. Some hooks, including spelling correction, can write changes, so review their resulting diff as part of preparing the contribution.

Sources: [.pre-commit-config.yaml:1-55](repo://.pre-commit-config.yaml#L1-L55), [.github/workflows/linter.yml:1-17](repo://.github/workflows/linter.yml#L1-L17)

```bash
pre-commit run --all-files
```

Sources: [CONTRIBUTING.rst:848-854](repo://CONTRIBUTING.rst#L848-L854)

Coverage configuration tracks branches in Celery code and defines explicit exclusions for optional or specialized paths. Contributor guidance asks that unit coverage not decrease and names API/configuration documentation checks alongside pre-commit. Use those checks for their stated boundaries: passing unit tests validates the unit suite, while integration, smoke and documentation checks each exercise additional behavior and infrastructure.

Sources: [pyproject.toml:31-55](repo://pyproject.toml#L31-L55), [CONTRIBUTING.rst:833-875](repo://CONTRIBUTING.rst#L833-L875)
