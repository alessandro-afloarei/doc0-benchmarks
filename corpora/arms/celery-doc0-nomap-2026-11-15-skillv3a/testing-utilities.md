---
title: "Testing Utilities"
---
## Overview

Code that sends or runs Celery tasks can be tested at three levels: calling the task function directly, running tasks eagerly in the test process, or running a real worker in a background thread against a broker. `celery.contrib.testing` and the pytest plugin in `celery.contrib.pytest` support the last two: they create an isolated app with in-memory broker and backend defaults, start and stop an embedded worker, and provide helpers for integration tests and fake task messages.

Sources: [celery/contrib/pytest.py:1-30](repo://celery/contrib/pytest.py#L1-L30), [celery/contrib/testing/app.py:10-20](repo://celery/contrib/testing/app.py#L10-L20)

## Choosing a level

### Direct calls and eager mode

Calling `add(2, 2)` runs the function body only; `add.apply((2, 2))` runs it through the tracer in-process, with signals, handlers and callbacks; `task_always_eager = True` makes `delay()` and `apply_async()` do the same while still round-tripping arguments through the serializer ([[Defining Tasks]], [[Publishing Task Messages]]).

Sources: [celery/app/task.py:495-502](repo://celery/app/task.py#L495-L502), [celery/app/task.py:683-701](repo://celery/app/task.py#L683-L701), [celery/app/task.py:869-951](repo://celery/app/task.py#L869-L951)

Eager mode is fast and needs no broker, but it differs from production in ways that hide bugs:

Sources: [celery/app/task.py:884-951](repo://celery/app/task.py#L884-L951)

- No routing, no message headers on the wire, no acknowledgement, prefetch, time limits or rate limits.
- Results are `EagerResult`s and are not stored in the backend unless `task_store_eager_result` is set.
- Failures are captured in the result instead of raised unless `task_eager_propagates` is on.
- `send_task` ignores eager mode entirely and still publishes.
- `get()` inside an eagerly run task still raises the deadlock guard, as in a worker.

Sources: [celery/app/trace.py:490-496](repo://celery/app/trace.py#L490-L496), [celery/app/base.py:868-872](repo://celery/app/base.py#L868-L872), [celery/app/task.py:699-701](repo://celery/app/task.py#L699-L701), [celery/result.py:1024-1070](repo://celery/result.py#L1024-L1070)

An embedded worker exercises the real consumer, strategy, request and tracer code, at the cost of needing a broker (the in-memory transport works for a single process).

Sources: [celery/contrib/testing/worker.py:139-192](repo://celery/contrib/testing/worker.py#L139-L192)

## The test app

### TestApp

`TestApp(name=None, config=None, enable_logging=False, set_as_current=False, ...)` creates a `Celery` app with test defaults layered under the given config: `memory://` broker, `cache+memory://` result backend, JSON only, UTC, no broker heartbeats, no root-logger hijacking and no colours. Passing `broker=` or `backend=` drops the corresponding default. Unless `enable_logging` is true, a logging class that reports itself as already set up prevents the app from touching logging. Creating a test app also registers the `celery.ping` task.

Sources: [celery/contrib/testing/app.py:10-65](repo://celery/contrib/testing/app.py#L10-L65), [celery/contrib/testing/tasks.py:1-9](repo://celery/contrib/testing/tasks.py#L1-L9)

### Isolation and the app trap

`setup_default_app(app, use_trap=False)` saves the current app, default app, app finalizers and the registry of live apps, and restores them when the test ends, closing the test app. With `use_trap=True` the current and default apps are replaced by a `Trap` object that raises `RuntimeError('Test depends on current_app')` on any attribute access, which catches library code that relies on the global app instead of the one it was given ([[The Celery Application]]).

Sources: [celery/contrib/testing/app.py:23-36](repo://celery/contrib/testing/app.py#L23-L36), [celery/contrib/testing/app.py:68-112](repo://celery/contrib/testing/app.py#L68-L112)

## Embedded workers

### start_worker

`start_worker(app, concurrency=1, pool='solo', loglevel=..., perform_ping_check=True, ping_task_timeout=10.0, shutdown_timeout=10.0, **kwargs)` is a context manager:

Sources: [celery/contrib/testing/worker.py:99-136](repo://celery/contrib/testing/worker.py#L99-L136)

1. Finalizes the app, makes it current and default, and sets up logging at `WORKER_LOGLEVEL` (default `error`).
2. Opens a connection to the broker (`TEST_BROKER` if set) to fail fast when it is unreachable.
3. Creates a `TestWorkController` with a generated node name, heartbeats off by default and mingle and gossip always off, and starts it in a daemon thread.
4. Waits until the consumer is ready, then clears the "joining would block" flag so the test can call `get()`.
5. Sends a `celery.ping` task and asserts the answer is `pong`, proving that the worker consumes and that results come back.
6. On exit, sets the worker's terminate flag, joins the thread and raises `RuntimeError` if it has not stopped within `shutdown_timeout`.

Sources: [celery/contrib/testing/worker.py:139-192](repo://celery/contrib/testing/worker.py#L139-L192), [celery/contrib/testing/worker.py:219-225](repo://celery/contrib/testing/worker.py#L219-L225)

```python
from celery.contrib.testing.worker import start_worker

def test_add(app):
    with start_worker(app, perform_ping_check=False):
        assert add.delay(2, 2).get(timeout=10) == 4
```

Sources: [celery/contrib/testing/worker.py:99-136](repo://celery/contrib/testing/worker.py#L99-L136)

`perform_ping_check` requires the `celery.ping` task to be registered in the app (it is for `TestApp`); pass `False` for apps created otherwise.

Sources: [celery/contrib/testing/worker.py:155-156](repo://celery/contrib/testing/worker.py#L155-L156)

### TestWorkController

`TestWorkController` is a `WorkController` that sets an event when the consumer is ready (`ensure_started()` waits on it) and sends `test_worker_started` with the worker and consumer; `test_worker_starting` and `test_worker_stopped` bracket the context. With the prefork pool it forwards log records from child processes to the test process through a queue so they appear in test output. The default pool is `solo`, so tasks run in the worker thread of the test process.

Sources: [celery/contrib/testing/worker.py:14-96](repo://celery/contrib/testing/worker.py#L14-L96)

## The pytest plugin

### Enabling it

The fixtures live in `celery.contrib.pytest`. Enable them with `pytest_plugins = ('celery.contrib.pytest',)` in a `conftest.py`, or install the `pytest` extra, which pulls in the `pytest-celery` package. The plugin registers a `celery` marker for per-test configuration.

Sources: [celery/contrib/pytest.py:22-29](repo://celery/contrib/pytest.py#L22-L29), [requirements/extras/pytest.txt:1](repo://requirements/extras/pytest.txt#L1)

### Fixtures

| Fixture | Scope | Provides |
| --- | --- | --- |
| `celery_app` | test | A `TestApp` configured from `celery_config`, `celery_parameters` and the `@pytest.mark.celery(...)` marker |
| `celery_worker` | test | An embedded worker for `celery_app`, started and stopped around the test |
| `celery_session_app` | session | One app for the whole session, made current and default |
| `celery_session_worker` | session | One embedded worker for the session; also registers `celery_class_tasks` |
| `depends_on_current_app` | test | Makes `celery_app` the current app |

Sources: [celery/contrib/pytest.py:53-105](repo://celery/contrib/pytest.py#L53-L105), [celery/contrib/pytest.py:172-216](repo://celery/contrib/pytest.py#L172-L216)

Behaviour is customized by overriding session-scoped configuration fixtures in `conftest.py`:

Sources: [celery/contrib/pytest.py:108-191](repo://celery/contrib/pytest.py#L108-L191)

| Fixture to override | Default | Use |
| --- | --- | --- |
| `celery_config` | `{}` | Settings for the test app (broker, backend…) |
| `celery_parameters` | `{}` | Arguments to the `Celery` constructor |
| `celery_includes` | `()` | Modules the worker imports (tasks, signal handlers) |
| `celery_worker_pool` | `'solo'` | Pool for embedded workers |
| `celery_worker_parameters` | `{}` | Arguments to the worker (queues, concurrency…) |
| `celery_enable_logging` | `False` | Let the app configure logging |
| `use_celery_app_trap` | `False` | Install the app trap |
| `celery_class_tasks` | `[]` | Class-based tasks to register on the session app |

Sources: [celery/contrib/pytest.py:53-61](repo://celery/contrib/pytest.py#L53-L61), [celery/contrib/pytest.py:108-191](repo://celery/contrib/pytest.py#L108-L191)

```python
import pytest

@pytest.fixture(scope='session')
def celery_config():
    return {'broker_url': 'redis://localhost:6379/0',
            'result_backend': 'redis://localhost:6379/1'}

def test_mul(celery_app, celery_worker):
    @celery_app.task
    def mul(x, y):
        return x * y
    celery_worker.reload()
    assert mul.delay(4, 4).get(timeout=10) == 16
```

Sources: [celery/contrib/pytest.py:137-145](repo://celery/contrib/pytest.py#L137-L145), [celery/contrib/pytest.py:194-210](repo://celery/contrib/pytest.py#L194-L210), [celery/worker/worker.py:269-279](repo://celery/worker/worker.py#L269-L279)

A task defined after the worker started is unknown to its consumer; `celery_worker.reload()` rebuilds the task strategies, as above. Setting the `NO_WORKER` environment variable makes the worker fixtures yield nothing, for running the same tests against an external worker.

Sources: [celery/contrib/pytest.py:16](repo://celery/contrib/pytest.py#L16), [celery/contrib/pytest.py:204-210](repo://celery/contrib/pytest.py#L204-L210)

## Integration helpers and mocks

### Manager

`celery.contrib.testing.manager.Manager(app)` bundles helpers used by Celery's own integration tests: `wait_for(fun, catch)` retries until a call stops raising, `ensure_not_for_a_while` asserts something does not happen, `join(result)` collects results with progress output and retries, `assert_received`/`assert_accepted` poll workers with `inspect query_task` until tasks reach a state, and `wait_until_idle()` purges queues and waits until no worker has active tasks.

Sources: [celery/contrib/testing/manager.py:27-139](repo://celery/contrib/testing/manager.py#L27-L139), [celery/contrib/testing/manager.py:148-239](repo://celery/contrib/testing/manager.py#L148-L239)

### Fake messages

`celery.contrib.testing.mocks.TaskMessage(name, id=None, args=(), kwargs=None, callbacks=None, errbacks=None, chain=None, **headers)` builds a `Mock` shaped like a protocol 2 message with JSON-encoded body; `TaskMessage1` builds a protocol 1 one; `task_message_from_sig(app, sig)` turns a signature, including countdown, ETA, expiry and links, into such a message. They feed worker components such as strategies and `Request` directly in unit tests ([[Consumer and Message Handling]]). `ContextMock` is a `Mock` usable as a context manager.

Sources: [celery/contrib/testing/mocks.py:11-112](repo://celery/contrib/testing/mocks.py#L11-L112), [celery/contrib/testing/mocks.py:114-130](repo://celery/contrib/testing/mocks.py#L114-L130)
