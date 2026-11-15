---
title: "Testing with Celery"
---
## Overview

Celery ships helpers for three kinds of tests. Unit tests of task logic can call the task directly or run it eagerly with `apply()`, without a broker. Tests that need real message passing can start an embedded worker in a thread, connected to an in-memory broker by default, with `celery.contrib.testing.worker.start_worker`. Pytest users get the same helpers as fixtures from `celery.contrib.pytest`. Mocks for task messages and a `Manager` class with waiting and assertion helpers for integration tests complete the set. This page covers them in that order.

Sources: [celery/contrib/pytest.py:1-50](repo://celery/contrib/pytest.py#L1-L50), [celery/contrib/testing/worker.py:99-136](repo://celery/contrib/testing/worker.py#L99-L136)

## Testing without a worker

Calling a task object runs its body inline, like a function, with `request.called_directly` set and no result storage. `task.apply(args, kwargs)` runs it through the same tracer a worker uses, including signals, retries and callbacks, and returns an `EagerResult`; exceptions propagate when `throw=True` or `task_eager_propagates` is set. [[Defining Tasks]] describes both.

Sources: [celery/app/task.py:495-502](repo://celery/app/task.py#L495-L502), [celery/app/task.py:869-951](repo://celery/app/task.py#L869-L951)

`task_always_eager = True` makes every `apply_async` and `delay` call run through `apply()` instead of sending a message. Arguments are still round-tripped through the configured serializer, so unserializable arguments fail as they would in production, and `get()` inside an eagerly run task is refused as it would be in a worker. Two consequences matter in tests: results are not stored unless `task_store_eager_result` is set, and `send_task` by name ignores the setting and warns. Eager mode does not exercise routing, the worker or the result backend, so it is no substitute for a test with a real worker.

Sources: [celery/app/task.py:683-701](repo://celery/app/task.py#L683-L701), [celery/app/base.py:868-872](repo://celery/app/base.py#L868-L872), [celery/backends/base.py:723-730](repo://celery/backends/base.py#L723-L730)

## Test apps

`TestApp(name=None, config=None, enable_logging=False, broker=None, backend=None, **kwargs)` creates a `Celery` app that is not set as current. It adds `DEFAULT_TEST_CONFIG` as defaults: the in-memory broker `memory://`, the `cache+memory://` result backend, JSON content only, UTC, no broker heartbeats, and no root-logger hijacking or colours. Logging setup is skipped unless `enable_logging=True`. Importing it also registers the `celery.ping` shared task that the embedded worker uses to check it is alive.

Sources: [celery/contrib/testing/app.py:10-65](repo://celery/contrib/testing/app.py#L10-L65), [celery/contrib/testing/tasks.py:1-9](repo://celery/contrib/testing/tasks.py#L1-L9)

`setup_default_app(app, use_trap=False)` is a context manager that saves the current app, the default app, the finalize callbacks and the set of live apps, and restores all of them afterwards, closing the test app. Shared tasks and app state therefore do not leak between tests. With `use_trap=True` it installs a `Trap` as both current and default app; any code that falls back to `current_app` instead of using the app it was given raises `RuntimeError('Test depends on current_app')`.

Sources: [celery/contrib/testing/app.py:23-112](repo://celery/contrib/testing/app.py#L23-L112)

## Embedded workers

### start_worker

`start_worker(app, concurrency=1, pool='solo', loglevel=..., perform_ping_check=True, ping_task_timeout=10.0, shutdown_timeout=10.0, **kwargs)` runs a worker in a daemon thread for the duration of a `with` block, in the steps below.

Sources: [celery/contrib/testing/worker.py:99-118](repo://celery/contrib/testing/worker.py#L99-L118)

1. Finalizes the app, makes it current and default, and sets up logging at `WORKER_LOGLEVEL` (default `error`).
2. Opens a broker connection (to `TEST_BROKER` if set) to fail fast when the broker is unreachable.
3. Creates a `TestWorkController` with a generated node name and without heartbeats, mingle and gossip, which keeps it from waiting on other workers. It starts it in a thread and waits until the consumer is ready.
4. Lifts the "no `get()` inside tasks" guard so test code can wait on results.
5. With `perform_ping_check`, sends `celery.ping` and waits for `'pong'`, proving the round trip works.
6. On exit, sets `state.should_terminate`, joins the thread, and raises `RuntimeError` if it does not stop within `shutdown_timeout`.

Sources: [celery/contrib/testing/worker.py:99-192](repo://celery/contrib/testing/worker.py#L99-L192), [celery/contrib/testing/worker.py:219-225](repo://celery/contrib/testing/worker.py#L219-L225)

```python
from celery.contrib.testing.worker import start_worker

def test_add(app):
    with start_worker(app, perform_ping_check=False):
        assert add.delay(2, 2).get(timeout=10) == 4
```

Sources: [celery/contrib/testing/worker.py:99-134](repo://celery/contrib/testing/worker.py#L99-L134)

### TestWorkController

`TestWorkController` signals readiness with a threading event from `on_consumer_ready`, and sends `test_worker_started`; `test_worker_starting` and `test_worker_stopped` are sent around it. With the prefork pool it also forwards log records from the child processes to the test process's root logger through a queue, so their output appears in test logs.

Sources: [celery/contrib/testing/worker.py:16-96](repo://celery/contrib/testing/worker.py#L16-L96)

The default pool is `solo`, so tasks run in the worker thread itself. That is the simplest choice for tests, but it means a task that waits on another task's result will block the only slot; tests that need that should use `pool='threads'` or a larger concurrency. [[Execution Pools]] compares the pools.

Sources: [celery/contrib/testing/worker.py:99-110](repo://celery/contrib/testing/worker.py#L99-L110), [celery/concurrency/solo.py:11-20](repo://celery/concurrency/solo.py#L11-L20)

## Pytest fixtures

### Enabling the plugin

`celery.contrib.pytest` is a pytest plugin. The package only registers the `celery` console script, so a project enables the plugin itself, for example with `pytest_plugins = ("celery.contrib.pytest",)` in `conftest.py`. The plugin registers the `celery` marker, which overrides configuration for one test.

Sources: [setup.py:155-159](repo://setup.py#L155-L159), [celery/contrib/pytest.py:22-29](repo://celery/contrib/pytest.py#L22-L29)

### Fixtures

| Fixture | Scope | Provides |
| --- | --- | --- |
| `celery_app` | function | A `TestApp` configured from `celery_config` and the `celery` marker, restored after the test |
| `celery_worker` | function | An embedded worker for `celery_app` (skipped when `NO_WORKER` is set) |
| `celery_session_app` | session | A `TestApp` shared by the session, set as default and current unless the trap is on |
| `celery_session_worker` | session | An embedded worker for the whole session, registering `celery_class_tasks` |
| `depends_on_current_app` | function | Makes `celery_app` the current app for code that needs one |

Sources: [celery/contrib/pytest.py:53-106](repo://celery/contrib/pytest.py#L53-L106), [celery/contrib/pytest.py:172-216](repo://celery/contrib/pytest.py#L172-L216)

Override these session fixtures in `conftest.py` to configure the others.

Sources: [celery/contrib/pytest.py:137-145](repo://celery/contrib/pytest.py#L137-L145)

| Fixture | Default | Used for |
| --- | --- | --- |
| `celery_config` | `{}` | Settings for the test app (merged over the test defaults) |
| `celery_parameters` | `{}` | Keyword arguments to the `Celery` constructor |
| `celery_includes` | `()` | Modules the worker imports before starting |
| `celery_worker_pool` | `'solo'` | Pool for embedded workers |
| `celery_worker_parameters` | `{}` | Extra `WorkController` arguments, such as `queues` |
| `celery_class_tasks` | `[]` | Class-based tasks to register for the session worker |
| `celery_enable_logging` | `False` | Let Celery configure logging |
| `use_celery_app_trap` | `False` | Raise on any use of the current or default app |

Sources: [celery/contrib/pytest.py:108-191](repo://celery/contrib/pytest.py#L108-L191)

```python
import pytest

pytest_plugins = ("celery.contrib.pytest",)

@pytest.fixture(scope='session')
def celery_config():
    return {'broker_url': 'memory://', 'result_backend': 'cache+memory://'}

@pytest.mark.celery(result_extended=True)
def test_mul(celery_app, celery_worker):
    @celery_app.task
    def mul(x, y):
        return x * y
    celery_worker.reload()
    assert mul.delay(4, 4).get(timeout=10) == 16
```

Sources: [celery/contrib/pytest.py:137-145](repo://celery/contrib/pytest.py#L137-L145), [celery/contrib/pytest.py:172-210](repo://celery/contrib/pytest.py#L172-L210), [celery/worker/worker.py:273-282](repo://celery/worker/worker.py#L273-L282)

A task defined after the worker has started is not in the worker's task strategies. `reload()` rebuilds them, as the example shows. Defining tasks at module level, or listing their modules in `celery_includes`, avoids the need.

Sources: [celery/worker/worker.py:273-282](repo://celery/worker/worker.py#L273-L282), [celery/worker/consumer/consumer.py:716-721](repo://celery/worker/consumer/consumer.py#L716-L721)

## Mocks for worker-level tests

`celery.contrib.testing.mocks` builds fake messages for testing code that consumes them, such as custom strategies, request classes or signal handlers.

Sources: [celery/contrib/testing/mocks.py:1-8](repo://celery/contrib/testing/mocks.py#L1-L8)

- `TaskMessage(name, id=None, args=(), kwargs=None, callbacks=None, errbacks=None, chain=None, shadow=None, **options)` returns a `Mock` shaped like a protocol-2 message: headers with the id, task name and any extra options, a JSON-encoded body of `(args, kwargs, embed)`, and the matching `payload`. `TaskMessage1` builds the old protocol-1 shape.
- `task_message_from_sig(app, sig)` freezes a signature and turns it into a `TaskMessage`, converting `countdown` and numeric `expires` into ISO times and links into callbacks and errbacks.
- `ContextMock()` is a `Mock` that works as a `with` context manager.

Sources: [celery/contrib/testing/mocks.py:11-111](repo://celery/contrib/testing/mocks.py#L11-L111), [celery/contrib/testing/mocks.py:114-137](repo://celery/contrib/testing/mocks.py#L114-L137)

## Integration test helpers

`celery.contrib.testing.manager.Manager(app)` collects helpers that Celery's own integration tests use against real brokers.

Sources: [celery/contrib/testing/manager.py:234-239](repo://celery/contrib/testing/manager.py#L234-L239)

- `wait_for(fun, catch, ...)` retries `fun` with backoff while it raises one of `catch`; `ensure_not_for_a_while` asserts that something does not happen for a while.
- `join(result)` waits for a result or result set, printing which ids are still missing on each timeout and retrying on connection loss, and fails with `Test failed: Missing task results`.
- `assert_received(ids)`, `assert_accepted(ids)` and `assert_task_worker_state` poll the workers with `inspect().query_task` until the tasks reach the expected state.
- `wait_until_idle()` purges the queues and waits until no worker reports active tasks.

Sources: [celery/contrib/testing/manager.py:27-132](repo://celery/contrib/testing/manager.py#L27-L132), [celery/contrib/testing/manager.py:134-239](repo://celery/contrib/testing/manager.py#L134-L239)
