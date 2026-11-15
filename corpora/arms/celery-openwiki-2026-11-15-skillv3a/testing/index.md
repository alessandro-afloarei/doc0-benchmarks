# Files

- [Testing: Unit, Integration and Smoke Suites](test-suite.md) - How Celery is tested and how to run focused tests. Covers the three suites under t/ (unit with in-memory transport, integration against real brokers and backends selected by TEST_BROKER/TEST_BACKEND, docker-based smoke tests with pytest-celery), tox environments and lint targets, and the testing utilities Celery ships for user projects (celery.contrib.pytest fixtures, start_worker, TestApp).
