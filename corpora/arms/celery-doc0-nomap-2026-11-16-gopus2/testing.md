---
title: "Testing and Debugging Tasks"
---
## Overview

There are three ways to test code that uses Celery, from cheapest to most realistic: run tasks **eagerly** in the test process, which needs no broker or worker; use the **pytest fixtures** in `celery.contrib.pytest`, which give each test an isolated app and, if needed, an embedded worker running in a thread over an in-memory broker; or start real workers and drive them with the **integration test helpers** in `celery.contrib.testing`. For a task that misbehaves in a running worker, `celery.contrib.rdb` opens a remote `pdb` session inside the pool process.

Sources: [celery/contrib/pytest.py:1-19](repo://celery/contrib/pytest.py#L1-L19), [celery/contrib/testing/worker.py:1-27](repo://celery/contrib/testing/worker.py#L1-L27), [celery/contrib/rdb.py:1-46](repo://celery/contrib/rdb.py#L1-L46)

## Eager mode

### task_always_eager

With `task_always_eager`, `apply_async` and `delay` call `Task.apply()` instead of sending a message: the task runs in the caller's process and returns an `EagerResult`. The arguments are still serialized and deserialized first with the configured serializer, so a non-serializable argument fails as it would in production. `task_eager_propagates` makes exceptions raised by the task propagate to the caller; `task_store_eager_result` stores eager results in the backend. See [[Calling Tasks and the Message Protocol]].

Sources: [celery/app/task.py:686-703](repo://celery/app/task.py#L686-L703), [celery/app/task.py:869-951](repo://celery/app/task.py#L869-L951), [celery/app/trace.py:497-501](repo://celery/app/trace.py#L497-L501)

Eager mode also covers workflows: chains, groups and chords run their parts with `apply` (see [[Chains]] and [[Groups and Chords]]), and retries are executed immediately and recursively (see [[Retries and Task Errors]]). `send_task` ignores eager mode and warns with `AlwaysEagerIgnored`, because it does not know the task's code.

Sources: [celery/canvas.py:1036-1046](repo://celery/canvas.py#L1036-L1046), [celery/app/base.py:868-872](repo://celery/app/base.py#L868-L872)

> [!WARNING]
> Eager mode skips the broker, routing, serialization of the result and the worker's acknowledgement logic, so it does not exercise the code paths described on [[Task Requests and Strategies]].

Sources: [celery/app/task.py:686-703](repo://celery/app/task.py#L686-L703)

## The pytest plugin

### Fixtures

`celery.contrib.pytest` provides fixtures and registers a `celery(**overrides)` marker that overrides configuration for one test. It is enabled like any pytest plugin module; the package's `setup.py` registers only the `celery` console script, not a pytest entry point.

Sources: [celery/contrib/pytest.py:22-29](repo://celery/contrib/pytest.py#L22-L29), [setup.py:155-159](repo://setup.py#L155-L159)

| Fixture | Scope | Provides |
| --- | --- | --- |
| `celery_app` | test | A fresh `TestApp`, configured from `celery_config` and the `celery` marker |
| `celery_worker` | test | An embedded worker for `celery_app`, stopped when the test returns |
| `celery_session_app` | session | One app for the whole session, set as default and current |
| `celery_session_worker` | session | One embedded worker for the whole session |
| `depends_on_current_app` | test | Makes `celery_app` the current app |

Sources: [celery/contrib/pytest.py:64-105](repo://celery/contrib/pytest.py#L64-L105), [celery/contrib/pytest.py:172-216](repo://celery/contrib/pytest.py#L172-L216)

These session fixtures are meant to be overridden in a project's `conftest.py`:

Sources: [celery/contrib/pytest.py:137-145](repo://celery/contrib/pytest.py#L137-L145)

| Override | Default | Purpose |
| --- | --- | --- |
| `celery_config` | `{}` | Settings for the test app |
| `celery_parameters` | `{}` | Keyword arguments for the `Celery` constructor |
| `celery_includes` | `()` | Modules the worker imports (tasks, signal handlers) |
| `celery_class_tasks` | `[]` | Class-based tasks to register with the session app |
| `celery_worker_pool` | `'solo'` | Pool used by embedded workers |
| `celery_worker_parameters` | `{}` | Keyword arguments for the `WorkController`, e.g. queues |
| `celery_enable_logging` | `False` | Let the app configure logging |
| `use_celery_app_trap` | `False` | Raise if code uses the implicit current app |

Sources: [celery/contrib/pytest.py:53-62](repo://celery/contrib/pytest.py#L53-L62), [celery/contrib/pytest.py:108-169](repo://celery/contrib/pytest.py#L108-L169), [celery/contrib/pytest.py:188-191](repo://celery/contrib/pytest.py#L188-L191)

```python
import pytest

@pytest.fixture(scope='session')
def celery_config():
    return {'broker_url': 'memory://', 'result_backend': 'cache+memory://'}

def test_add(celery_app, celery_worker):
    @celery_app.task
    def mul(x, y):
        return x * y
    celery_worker.reload()
    assert mul.delay(4, 4).get(timeout=10) == 16
```

Sources: [celery/contrib/pytest.py:137-145](repo://celery/contrib/pytest.py#L137-L145), [celery/contrib/pytest.py:194-210](repo://celery/contrib/pytest.py#L194-L210), [celery/worker/worker.py:269-279](repo://celery/worker/worker.py#L269-L279)

Setting the environment variable `NO_WORKER` makes the worker fixtures yield nothing, for test runs against workers started elsewhere.

Sources: [celery/contrib/pytest.py:16](repo://celery/contrib/pytest.py#L16), [celery/contrib/pytest.py:97-105](repo://celery/contrib/pytest.py#L97-L105)

### TestApp and isolation

`TestApp` creates a `Celery` app named `celery.tests` that is not set as current, with test defaults: in-memory broker (`memory://`), in-memory cache result backend (`cache+memory://`), JSON only, UTC, no broker heartbeat, and logging that is considered already set up so tests do not reconfigure the root logger. It imports `celery.contrib.testing.tasks`, which defines the shared `celery.ping` task returning `'pong'`.

Sources: [celery/contrib/testing/app.py:10-65](repo://celery/contrib/testing/app.py#L10-L65), [celery/contrib/testing/tasks.py:1-9](repo://celery/contrib/testing/tasks.py#L1-L9)

`setup_default_app` records the current and default apps, the finalize callbacks and the set of live apps, and restores all of them afterwards, so one test's app cannot leak into the next. With the trap enabled, a `Trap` object replaces the current and default app and raises `RuntimeError('Test depends on current_app')` on any use — a way to find code that forgets to pass the app explicitly.

Sources: [celery/contrib/testing/app.py:23-36](repo://celery/contrib/testing/app.py#L23-L36), [celery/contrib/testing/app.py:68-112](repo://celery/contrib/testing/app.py#L68-L112)

## Embedded workers

### start_worker

`start_worker(app, concurrency=1, pool='solo', loglevel=..., perform_ping_check=True, ping_task_timeout=10.0, shutdown_timeout=10.0, **kwargs)` is a context manager that runs a real `WorkController` in a daemon thread. It finalizes the app and makes it current and default, sets up logging at `WORKER_LOGLEVEL` (default `error`), checks that the broker is reachable, and starts a `TestWorkController` without heartbeat, mingle or gossip. It waits until the consumer is ready, allows joining results from the test thread, and with `perform_ping_check` sends `celery.ping` and asserts it returns `'pong'`.

Sources: [celery/contrib/testing/worker.py:99-177](repo://celery/contrib/testing/worker.py#L99-L177), [celery/contrib/testing/worker.py:219-225](repo://celery/contrib/testing/worker.py#L219-L225)

On exit it sets `state.should_terminate` to stop the worker and joins the thread, raising `RuntimeError` if it has not exited within `shutdown_timeout`. The signals `test_worker_starting`, `test_worker_started` and `test_worker_stopped` mark the lifecycle.

Sources: [celery/contrib/testing/worker.py:14-27](repo://celery/contrib/testing/worker.py#L14-L27), [celery/contrib/testing/worker.py:178-192](repo://celery/contrib/testing/worker.py#L178-L192)

With the prefork pool, `TestWorkController` forwards log records from the child processes to the test process through a billiard queue and a `QueueListener`, and installs `tblib` pickling support when available so tracebacks survive the trip.

Sources: [celery/contrib/testing/worker.py:30-96](repo://celery/contrib/testing/worker.py#L30-L96)

## Integration helpers

### Manager

`celery.contrib.testing.manager.Manager(app)` bundles helpers used by Celery's own integration tests: `wait_for(fun, catch)` retries a check with backoff until it stops raising, `ensure_not_for_a_while` asserts that something does *not* happen, `join` collects results, `assert_received`/`assert_accepted` poll workers with `inspect query_task`, and `wait_until_idle` purges the queues and waits until no worker reports active tasks.

Sources: [celery/contrib/testing/manager.py:27-133](repo://celery/contrib/testing/manager.py#L27-L133), [celery/contrib/testing/manager.py:134-239](repo://celery/contrib/testing/manager.py#L134-L239)

### Mocks

`celery.contrib.testing.mocks` builds fake task messages for unit tests of worker code: `TaskMessage(name, id, args, kwargs, callbacks, errbacks, chain, ...)` returns a mock message in protocol 2 with JSON-encoded body, `TaskMessage1` the protocol 1 form, and `task_message_from_sig(app, sig)` freezes a signature and converts its options (links, countdown, expiry) into such a message. `ContextMock` is a `Mock` usable as a context manager.

Sources: [celery/contrib/testing/mocks.py:11-44](repo://celery/contrib/testing/mocks.py#L11-L44), [celery/contrib/testing/mocks.py:79-131](repo://celery/contrib/testing/mocks.py#L79-L131)

## Remote debugging

### rdb.set_trace

Prefork pool children have no terminal, so `pdb.set_trace()` cannot be used in a task. `celery.contrib.rdb.set_trace()` instead opens a TCP socket and waits for a connection; the worker log shows `Ready to connect: telnet <host> <port>`. Connecting with telnet gives a normal `pdb` session on the task's frame, with stdin and stdout redirected to the socket. `continue` or `quit` ends the session and restores stdio.

Sources: [celery/contrib/rdb.py:10-21](repo://celery/contrib/rdb.py#L10-L21), [celery/contrib/rdb.py:84-187](repo://celery/contrib/rdb.py#L84-L187)

The debugger binds to `CELERY_RDB_HOST` (default `127.0.0.1`, so only local connections) and searches for a free port starting at `CELERY_RDB_PORT` (default 6899) plus the pool process number, trying up to 100 ports, so several children can debug at once.

Sources: [celery/contrib/rdb.py:52-59](repo://celery/contrib/rdb.py#L52-L59), [celery/contrib/rdb.py:116-135](repo://celery/contrib/rdb.py#L116-L135)

With the environment variable `CELERY_RDBSIG` set, sending `SIGUSR2` to a worker opens such a session at whatever the process is doing, and `SIGUSR1` prints the stack of every thread; see [[Worker Signals and Shutdown]].

Sources: [celery/apps/worker.py:490-514](repo://celery/apps/worker.py#L490-L514)
