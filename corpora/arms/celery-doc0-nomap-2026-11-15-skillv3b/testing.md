---
title: "Testing Celery Applications"
---
## Overview

Code that uses Celery can be tested at three levels. Unit tests call the task function directly or with `apply()`, with no broker or worker. Tests of code that calls `delay()` can run tasks eagerly in the same process with `task_always_eager`. Integration tests start a real worker in a thread against an in-memory or real broker, using the pytest fixtures in `celery.contrib.pytest` and the helpers in `celery.contrib.testing`. This page covers each, from the cheapest to the most realistic.

Sources: [celery/contrib/pytest.py:1-30](repo://celery/contrib/pytest.py#L1-L30), [celery/contrib/testing/worker.py:1-28](repo://celery/contrib/testing/worker.py#L1-L28)

## Calling tasks without a worker

### Direct calls and apply()

Calling a task object (`add(2, 2)`) runs its function in the current process, through `Task.__call__`, with a request whose `called_directly` is true. `task.apply(args, kwargs)` goes further: it builds a full request (id, retries, eager flag, parent and root ids), runs the task through an eager tracer, and returns an `EagerResult` with the state and value, so handler hooks, `self.request`, retries and callbacks behave as in a worker ([[Defining Tasks]]). Exceptions are stored in the result unless `throw=True` or `task_eager_propagates` is set.

Sources: [celery/app/task.py:495-503](repo://celery/app/task.py#L495-L503), [celery/app/task.py:869-951](repo://celery/app/task.py#L869-L951)

```python
def test_add():
    assert add(2, 2) == 4
    result = add.apply(args=(2, 2))
    assert result.successful()
    assert result.get() == 4
```

Sources: [celery/app/task.py:869-951](repo://celery/app/task.py#L869-L951), [celery/result.py:1025-1070](repo://celery/result.py#L1025-L1070)

### Eager mode

With `task_always_eager = True`, `apply_async` and `delay` call `apply()` instead of sending a message, so code under test that calls `delay()` runs the task inline and gets an `EagerResult`. Before running, the arguments are serialized and deserialized with the task's serializer, so a test still fails when arguments are not JSON-serializable. Chains, groups and chords also run eagerly. `app.send_task` ignores eager mode and warns, because it sends by name without a task object.

Sources: [celery/app/task.py:677-698](repo://celery/app/task.py#L677-L698), [celery/app/base.py:863-868](repo://celery/app/base.py#L863-L868), [celery/canvas.py:1047-1056](repo://celery/canvas.py#L1047-L1056)

Eager mode does not exercise routing, the message protocol, acknowledgement, time limits or the result backend (unless `task_store_eager_result` is set), and reading results from a backend in eager mode warns. Use it for logic, and an embedded worker for anything involving delivery.

Sources: [celery/backends/base.py:723-730](repo://celery/backends/base.py#L723-L730), [celery/app/trace.py:478-489](repo://celery/app/trace.py#L478-L489)

## Test apps

`celery.contrib.testing.app.TestApp(name, config, enable_logging=False, ...)` creates an app with safe defaults merged under your configuration: the in-memory broker (`memory://`), the in-memory cache result backend (`cache+memory://`), JSON only, UTC, no broker heartbeat, and logging that does not take over the root logger. It also imports the `celery.ping` task used by worker start-up checks.

Sources: [celery/contrib/testing/app.py:10-65](repo://celery/contrib/testing/app.py#L10-L65), [celery/contrib/testing/tasks.py:1-9](repo://celery/contrib/testing/tasks.py#L1-L9)

`setup_default_app(app, use_trap=False)` is a context manager that restores the current app, default app, finalizers and live-app set afterwards, so one test's app does not leak into the next. With `use_trap=True` it installs a `Trap` as the current and default app, which raises `RuntimeError('Test depends on current_app')` on any use; this finds library code that relies on `current_app` instead of an explicit app ([[The Celery Application]]).

Sources: [celery/contrib/testing/app.py:23-112](repo://celery/contrib/testing/app.py#L23-L112)

## The pytest plugin

### Enabling it

`celery.contrib.pytest` is a pytest plugin. Enable it with `pytest_plugins = ('celery.contrib.pytest',)` in a `conftest.py` (or `-p celery.contrib.pytest`). It registers a `celery` marker whose keyword arguments override configuration for one test.

Sources: [celery/contrib/pytest.py:22-29](repo://celery/contrib/pytest.py#L22-L29)

### Fixtures

| Fixture | Scope | Provides |
| --- | --- | --- |
| `celery_app` | function | A `TestApp` configured from `celery_config`, `celery_parameters` and the `celery` marker |
| `celery_worker` | function | An embedded worker for `celery_app`, stopped after the test |
| `celery_session_app` | session | A `TestApp` shared by the session, set as current and default unless the trap is on |
| `celery_session_worker` | session | A worker for the whole session |
| `depends_on_current_app` | function | Makes `celery_app` the current app |

Sources: [celery/contrib/pytest.py:53-106](repo://celery/contrib/pytest.py#L53-L106), [celery/contrib/pytest.py:172-216](repo://celery/contrib/pytest.py#L172-L216)

The configuration fixtures are meant to be overridden in your `conftest.py`.

Sources: [celery/contrib/pytest.py:108-191](repo://celery/contrib/pytest.py#L108-L191)

| Fixture | Default | Purpose |
| --- | --- | --- |
| `celery_config` | `{}` | Settings for the test app |
| `celery_parameters` | `{}` | Keyword arguments to `Celery(...)` |
| `celery_includes` | `()` | Modules the worker imports (tasks, signal handlers) |
| `celery_worker_pool` | `'solo'` | Pool for embedded workers |
| `celery_worker_parameters` | `{}` | Keyword arguments to the worker, such as `queues` |
| `celery_class_tasks` | `[]` | Class-based tasks to register on the session app |
| `celery_enable_logging` | `False` | Let the app configure logging |
| `use_celery_app_trap` | `False` | Install the current-app trap |

Sources: [celery/contrib/pytest.py:53-61](repo://celery/contrib/pytest.py#L53-L61), [celery/contrib/pytest.py:108-191](repo://celery/contrib/pytest.py#L108-L191)

```python
# conftest.py
import pytest

pytest_plugins = ('celery.contrib.pytest',)


@pytest.fixture(scope='session')
def celery_config():
    return {'broker_url': 'memory://', 'result_backend': 'cache+memory://'}


# test_tasks.py
def test_mul(celery_app, celery_worker):
    @celery_app.task
    def mul(x, y):
        return x * y

    celery_worker.reload()
    assert mul.delay(4, 4).get(timeout=10) == 16
```

Sources: [celery/contrib/pytest.py:137-210](repo://celery/contrib/pytest.py#L137-L210), [celery/worker/worker.py:269-279](repo://celery/worker/worker.py#L269-L279)

Tasks defined inside a test after the worker started are unknown to its consumer; `celery_worker.reload()` rebuilds the strategies so the worker accepts them. With the session worker, register tasks through `celery_includes` or `celery_class_tasks` instead. Setting the `NO_WORKER` environment variable makes the worker fixtures yield nothing, for running the suite against workers started separately.

Sources: [celery/contrib/pytest.py:16-16](repo://celery/contrib/pytest.py#L16-L16), [celery/contrib/pytest.py:84-106](repo://celery/contrib/pytest.py#L84-L106), [celery/worker/consumer/consumer.py:716-721](repo://celery/worker/consumer/consumer.py#L716-L721)

## Embedded workers

### start_worker

`start_worker(app, concurrency=1, pool='solo', loglevel='error', perform_ping_check=True, ping_task_timeout=10.0, shutdown_timeout=10.0, **kwargs)` is the context manager behind the fixtures, usable without pytest. It finalizes the app and makes it current and default, checks that the broker is reachable, creates a `TestWorkController` with mingle, gossip and heartbeats off and an anonymous node name, starts it in a daemon thread, waits until the consumer is ready, and allows joins on results in the test thread. Unless disabled, it sends `celery.ping` and waits for `pong` to prove the round trip works.

Sources: [celery/contrib/testing/worker.py:99-192](repo://celery/contrib/testing/worker.py#L99-L192), [celery/contrib/testing/worker.py:219-225](repo://celery/contrib/testing/worker.py#L219-L225)

On exit it sets the worker's terminate flag and joins the thread for up to `shutdown_timeout` seconds, raising `RuntimeError` if the worker did not stop, which usually means a task is still running. The `test_worker_starting`, `test_worker_started` and `test_worker_stopped` signals bracket the worker's life for test hooks.

Sources: [celery/contrib/testing/worker.py:14-27](repo://celery/contrib/testing/worker.py#L14-L27), [celery/contrib/testing/worker.py:180-192](repo://celery/contrib/testing/worker.py#L180-L192)

```python
from celery.contrib.testing.worker import start_worker

with start_worker(app, pool='solo', perform_ping_check=False):
    assert add.delay(1, 2).get(timeout=5) == 3
```

Sources: [celery/contrib/testing/worker.py:99-136](repo://celery/contrib/testing/worker.py#L99-L136)

`TestWorkController` signals readiness through an event set in `on_consumer_ready`. With the prefork pool, it forwards log records from child processes to the test process through a queue so they appear in captured logs. The `solo` pool is the default because it runs tasks in the worker thread, keeping tests deterministic; use `prefork` to test behaviour that depends on child processes, such as time limits ([[Execution Pools]]).

Sources: [celery/contrib/testing/worker.py:30-96](repo://celery/contrib/testing/worker.py#L30-L96)

## Helpers for assertions

`celery.contrib.testing.manager.Manager(app)` wraps common waits for integration tests: `wait_for(fun, catch, timeout)` retries a check until it passes, `join(result)` waits for results with retries, `assert_accepted(ids)` and `assert_received(ids)` poll workers with `inspect query_task` until tasks reach that state, `ensure_not_for_a_while` asserts something stays false, and `wait_until_idle` waits until no worker has active or reserved tasks.

Sources: [celery/contrib/testing/manager.py:23-133](repo://celery/contrib/testing/manager.py#L23-L133), [celery/contrib/testing/manager.py:134-239](repo://celery/contrib/testing/manager.py#L134-L239)

`celery.contrib.testing.mocks` builds fake messages for unit-testing consumers and strategies: `TaskMessage` creates a protocol 2 message mock with JSON-encoded body, `TaskMessage1` a protocol 1 one, and `task_message_from_sig` one from a signature. `ContextMock` is a `Mock` usable as a context manager.

Sources: [celery/contrib/testing/mocks.py:11-113](repo://celery/contrib/testing/mocks.py#L11-L113), [celery/contrib/testing/mocks.py:114-137](repo://celery/contrib/testing/mocks.py#L114-L137)
