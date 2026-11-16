---
title: "Testing Celery Apps"
---
## Overview

`celery.contrib` ships helpers for testing code that uses Celery: a pytest plugin with fixtures for a test app and an embedded worker, `start_worker` to run a real worker in a thread of the test process, `TestApp` with in-memory broker and backend defaults, a `celery.ping` task to check the worker is alive, mocks for building task messages, and a `Manager` with waiting and assertion helpers for integration tests. For tests that only need task logic, `task_always_eager` or `Task.apply` run tasks inline without a worker ([[Sending Tasks and Routing]]). This page covers each helper and how they fit together.

Sources: [celery/contrib/pytest.py:1-30](repo://celery/contrib/pytest.py#L1-L30), [celery/contrib/testing/worker.py:1-28](repo://celery/contrib/testing/worker.py#L1-L28), [celery/contrib/testing/app.py:1-21](repo://celery/contrib/testing/app.py#L1-L21)

## Running tasks without a worker

With `task_always_eager = True`, `apply_async` and `delay` call `Task.apply` in the calling process after round-tripping the arguments through the serializer, and return an `EagerResult`. `task_eager_propagates` makes exceptions raise in the caller. Eager tasks do not store results unless `task_store_eager_result` is set, and the backend warns when results are read in that mode. `Task.apply()` gives the same behaviour per call ([[Defining Tasks]], [[Task Results and States]]).

Sources: [celery/app/task.py:682-700](repo://celery/app/task.py#L682-L700), [celery/app/task.py:869-951](repo://celery/app/task.py#L869-L951), [celery/backends/base.py:723-730](repo://celery/backends/base.py#L723-L730)

Eager mode skips routing, the broker, the worker's strategy and request handling, so it does not exercise acknowledgements, time limits or retries over the wire. The embedded worker below does.

Sources: [celery/app/task.py:682-707](repo://celery/app/task.py#L682-L707)

## The test app

`TestApp(name=None, config=None, enable_logging=False, set_as_current=False, ...)` creates a `Celery` app named `celery.tests` and adds `DEFAULT_TEST_CONFIG` as defaults: the in-memory broker `memory://`, the in-memory cache result backend `cache+memory://`, JSON only, UTC, no broker heartbeat, no root-logger hijacking and no colours. Passing `broker` or `backend` replaces those defaults. Unless `enable_logging` is true, it uses `UnitLogging`, which marks logging as already set up so tests keep their own log configuration. Creating it imports `celery.contrib.testing.tasks`, which registers the `celery.ping` shared task returning `'pong'`.

Sources: [celery/contrib/testing/app.py:10-65](repo://celery/contrib/testing/app.py#L10-L65), [celery/contrib/testing/tasks.py:1-9](repo://celery/contrib/testing/tasks.py#L1-L9)

`setup_default_app(app, use_trap=False)` saves the current and default apps, the finalizer callbacks and the set of live apps, and restores all of them after the test, closing the test app. With `use_trap=True` it installs a `Trap` as both current and default app: any attribute access on it raises `RuntimeError('Test depends on current_app')`, which finds code that silently falls back to the implicit app instead of the one it was given ([[The Celery Application]]).

Sources: [celery/contrib/testing/app.py:23-36](repo://celery/contrib/testing/app.py#L23-L36), [celery/contrib/testing/app.py:68-112](repo://celery/contrib/testing/app.py#L68-L112)

## The embedded worker

### start_worker

`start_worker(app, concurrency=1, pool='solo', loglevel=WORKER_LOGLEVEL, logfile=None, perform_ping_check=True, ping_task_timeout=10.0, shutdown_timeout=10.0, **kwargs)` is a context manager yielding a running worker. The default log level comes from `WORKER_LOGLEVEL` (`error`).

Sources: [celery/contrib/testing/worker.py:99-136](repo://celery/contrib/testing/worker.py#L99-L136), [celery/contrib/testing/worker.py:14-14](repo://celery/contrib/testing/worker.py#L14-L14)

1. Sends `test_worker_starting`.
2. Finalizes the app, makes it current and default, and sets up logging again.
3. Checks the broker by opening a connection (to `TEST_BROKER` when set) and that `celery.ping` is registered when the ping check is on.
4. Creates a `TestWorkController` with heartbeats, Mingle and Gossip disabled and starts it in a daemon thread, waiting until the consumer is ready.
5. Turns the synchronous-subtask guard off so the test thread can call `get()`.
6. Sends `ping.delay()` and asserts the reply is `'pong'` within the timeout.
7. Yields the worker. On exit it sets `state.should_terminate = 0`, which makes the worker's loop raise and stop, joins the thread within `shutdown_timeout` (raising `RuntimeError` suggesting a larger timeout otherwise), and sends `test_worker_stopped`.

Sources: [celery/contrib/testing/worker.py:117-192](repo://celery/contrib/testing/worker.py#L117-L192), [celery/contrib/testing/worker.py:219-225](repo://celery/contrib/testing/worker.py#L219-L225)

```python
from celery.contrib.testing.worker import start_worker
from proj.celery import app
from proj.tasks import add

def test_add():
    with start_worker(app, pool='solo'):
        assert add.delay(2, 2).get(timeout=10) == 4
```

Sources: [celery/contrib/testing/worker.py:99-136](repo://celery/contrib/testing/worker.py#L99-L136)

### TestWorkController

`TestWorkController` is a `WorkController` whose `on_consumer_ready` sets an event (so `ensure_started()` can wait for it) and sends `test_worker_started` with the worker and consumer. With the prefork pool it also installs `tblib` pickling support if available and forwards log records from child processes through a queue to the test process's root logger; the comment warns those records appear twice in live logs. `__test__ = False` stops pytest from collecting it.

Sources: [celery/contrib/testing/worker.py:30-96](repo://celery/contrib/testing/worker.py#L30-L96)

`test_worker_starting`, `test_worker_started` and `test_worker_stopped` are module-level signals tests can connect to, for example to configure a worker before its first task.

Sources: [celery/contrib/testing/worker.py:16-27](repo://celery/contrib/testing/worker.py#L16-L27)

## The pytest plugin

### Enabling it

`celery.contrib.pytest` registers a `celery(**overrides)` marker and defines the fixtures. This tree's `setup.py` declares only the `celery` console script as an entry point, so the plugin is enabled explicitly, for example with `pytest_plugins = ("celery.contrib.pytest",)` in `conftest.py`.

Sources: [celery/contrib/pytest.py:22-29](repo://celery/contrib/pytest.py#L22-L29), [setup.py:155-159](repo://setup.py#L155-L159)

### Fixtures

| Fixture | Scope | Provides |
| --- | --- | --- |
| `celery_app` | test | A `TestApp` configured from `celery_config` plus the test's `@pytest.mark.celery(...)` overrides |
| `celery_worker` | test | `start_worker(celery_app)` after importing `celery_includes` |
| `celery_session_app` | session | A `TestApp` for the whole session, set as default and current unless the trap is on |
| `celery_session_worker` | session | A worker for the whole session; also registers `celery_class_tasks` |
| `celery_config` | session | Settings dict for the test app (override it); default `{}` |
| `celery_parameters` | session | Keyword arguments for the `Celery` constructor |
| `celery_worker_parameters` | session | Keyword arguments for the `WorkController`, such as queues |
| `celery_worker_pool` | session | Pool name, default `'solo'` |
| `celery_includes` | session | Modules to import before the worker starts |
| `celery_enable_logging` | session | Keep Celery's logging setup (default `False`) |
| `use_celery_app_trap` | session | Install the current-app trap (default `False`) |
| `depends_on_current_app` | test | Makes `celery_app` the current app |

Sources: [celery/contrib/pytest.py:53-135](repo://celery/contrib/pytest.py#L53-L135), [celery/contrib/pytest.py:137-216](repo://celery/contrib/pytest.py#L137-L216)

Session fixtures are overridden by defining a fixture of the same name in `conftest.py`. Setting the `NO_WORKER` environment variable makes the worker fixtures yield nothing, so the same tests can run against workers started elsewhere.

Sources: [celery/contrib/pytest.py:16-16](repo://celery/contrib/pytest.py#L16-L16), [celery/contrib/pytest.py:84-105](repo://celery/contrib/pytest.py#L84-L105), [celery/contrib/pytest.py:194-210](repo://celery/contrib/pytest.py#L194-L210)

```python
import pytest

@pytest.fixture(scope='session')
def celery_config():
    return {'broker_url': 'memory://', 'result_backend': 'cache+memory://'}

@pytest.fixture(scope='session')
def celery_includes():
    return ['proj.tasks']
```

Sources: [celery/contrib/pytest.py:115-145](repo://celery/contrib/pytest.py#L115-L145)

## Mocks

`celery.contrib.testing.mocks` builds fake broker messages for unit-testing worker code: `TaskMessage(name, id, args, kwargs, callbacks, errbacks, chain, shadow, ...)` returns a `Mock` with protocol v2 headers and a JSON-encoded `(args, kwargs, embed)` body, `TaskMessage1` the protocol v1 equivalent, and `task_message_from_sig(app, sig)` freezes a signature and converts its links, countdown, ETA and expiry into such a message. `ContextMock()` is a `Mock` usable in a `with` statement.

Sources: [celery/contrib/testing/mocks.py:11-77](repo://celery/contrib/testing/mocks.py#L11-L77), [celery/contrib/testing/mocks.py:79-131](repo://celery/contrib/testing/mocks.py#L79-L131)

## Integration test manager

`Manager(app)` (and `ManagerMixin`) collects helpers used by Celery's own integration suite. `wait_for(fun, catch, ...)` retries `fun` with backoff while it raises `catch`; `ensure_not_for_a_while` asserts something does not happen; `join(result)` collects results with retries; `assert_received`, `assert_accepted` and `assert_task_worker_state` poll `inspect().query_task` until tasks reach a state; `wait_until_idle()` purges the queues and waits until no worker reports active tasks.

Sources: [celery/contrib/testing/manager.py:23-133](repo://celery/contrib/testing/manager.py#L23-L133), [celery/contrib/testing/manager.py:134-239](repo://celery/contrib/testing/manager.py#L134-L239)

The repository's own development environment runs those integration tests against RabbitMQ and Redis started by `docker/docker-compose.yml`, passing `TEST_BROKER` and `TEST_BACKEND` ([[Quickstart]]).

Sources: [docker/docker-compose.yml:1-25](repo://docker/docker-compose.yml#L1-L25)
