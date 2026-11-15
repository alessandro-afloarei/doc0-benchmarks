---
title: "Testing Celery Applications"
---
## Overview

Code that sends tasks can be tested at three depths: run tasks in-process without a broker, run a real worker in a thread against an in-memory broker, or drive a full cluster in integration tests. `celery.contrib` provides the pieces for all three: pytest fixtures in `celery/contrib/pytest.py`, an embedded worker in `celery/contrib/testing/worker.py`, a test app factory in `celery/contrib/testing/app.py`, waiting and assertion helpers in `manager.py`, and message mocks in `mocks.py`. This page explains each and how they fit together. Other `celery.contrib` modules are on [[Contrib Extensions]].

Sources: [celery/contrib/pytest.py:1-30](repo://celery/contrib/pytest.py#L1-L30), [celery/contrib/testing/worker.py:1-27](repo://celery/contrib/testing/worker.py#L1-L27)

## Running tasks eagerly

The lightest approach needs no worker: with `task_always_eager`, `apply_async` runs the task in the calling process through `Task.apply` and returns an `EagerResult`. The arguments are still serialized and deserialized with the configured serializer, so values that could not travel in a real message fail here too. Exceptions are raised by `get()`, or at once with `task_eager_propagates`, and results are only stored in the backend with `task_store_eager_result`.

Sources: [celery/app/task.py:683-701](repo://celery/app/task.py#L683-L701), [celery/app/task.py:869-951](repo://celery/app/task.py#L869-L951)

Eager mode skips the broker, routing, the worker and its acknowledgement logic, so tests that depend on those need a real worker. `send_task` by name ignores eager mode and warns.

Sources: [celery/app/base.py:866-872](repo://celery/app/base.py#L866-L872)

## The pytest plugin

### The plugin module

`celery.contrib.pytest` defines the fixtures below (the `pytest` extra installs the `pytest-celery` package). It also registers a `celery` marker whose keyword arguments override configuration for one test: `@pytest.mark.celery(result_backend='redis://')`.

Sources: [celery/contrib/pytest.py:22-29](repo://celery/contrib/pytest.py#L22-L29), [requirements/extras/pytest.txt:1-1](repo://requirements/extras/pytest.txt#L1-L1)

### Fixtures

| Fixture | Scope | Provides |
| --- | --- | --- |
| `celery_app` | test | A fresh test app, configured from `celery_config`, `celery_parameters` and the marker |
| `celery_worker` | test | A worker for `celery_app`, running in a thread, stopped after the test |
| `celery_session_app` | session | One app for the session, made current and default |
| `celery_session_worker` | session | One worker for the whole session |
| `depends_on_current_app` | test | Makes `celery_app` the current app |

Sources: [celery/contrib/pytest.py:64-106](repo://celery/contrib/pytest.py#L64-L106), [celery/contrib/pytest.py:172-216](repo://celery/contrib/pytest.py#L172-L216)

### Configuration fixtures

A project overrides these session fixtures in its `conftest.py` to shape the app and worker:

Sources: [celery/contrib/pytest.py:108-192](repo://celery/contrib/pytest.py#L108-L192)

| Fixture | Default | Use |
| --- | --- | --- |
| `celery_config` | `{}` | Settings for the test app |
| `celery_parameters` | `{}` | Keyword arguments to `Celery(...)` |
| `celery_includes` | `()` | Modules the worker imports (tasks, signal handlers) |
| `celery_class_tasks` | `[]` | Class-based tasks registered on the session app |
| `celery_worker_pool` | `'solo'` | Pool of the embedded worker |
| `celery_worker_parameters` | `{}` | Keyword arguments to the `WorkController`, such as `queues` |
| `celery_enable_logging` | `False` | Keep Celery's logging setup |
| `use_celery_app_trap` | `False` | Fail any code that falls back to the current or default app |

Sources: [celery/contrib/pytest.py:53-61](repo://celery/contrib/pytest.py#L53-L61), [celery/contrib/pytest.py:108-192](repo://celery/contrib/pytest.py#L108-L192)

```python
import pytest

@pytest.fixture(scope='session')
def celery_config():
    return {'broker_url': 'memory://', 'result_backend': 'cache+memory://'}
```

Sources: [celery/contrib/pytest.py:137-145](repo://celery/contrib/pytest.py#L137-L145)

Setting the `NO_WORKER` environment variable makes the worker fixtures yield nothing, which lets the same suite run against an external worker.

Sources: [celery/contrib/pytest.py:16-16](repo://celery/contrib/pytest.py#L16-L16), [celery/contrib/pytest.py:97-105](repo://celery/contrib/pytest.py#L97-L105)

## The test app

`TestApp(name=None, config=None, enable_logging=False, set_as_current=False)` creates a `Celery` app with test defaults: the `memory://` broker, the `cache+memory://` result backend, JSON only, UTC, no broker heartbeats, colours off, and `worker_hijack_root_logger` off so pytest's log capture keeps working. Unless logging is enabled, it uses a logging class that reports logging as already set up. Creating it imports `celery.contrib.testing.tasks`, which defines the `celery.ping` task the embedded worker uses.

Sources: [celery/contrib/testing/app.py:10-65](repo://celery/contrib/testing/app.py#L10-L65), [celery/contrib/testing/tasks.py:1-9](repo://celery/contrib/testing/tasks.py#L1-L9)

`setup_default_app(app, use_trap=False)` saves the current app, the default app, the finalizer callbacks and the registered apps, and restores all of them after the test, so tests do not leak apps or shared tasks into each other. With the trap, `current_app` and the default app are replaced by a `Trap` object that raises `RuntimeError('Test depends on current_app')` on any use, which finds code that forgets to pass its app.

Sources: [celery/contrib/testing/app.py:23-112](repo://celery/contrib/testing/app.py#L23-L112)

## The embedded worker

`start_worker(app, concurrency=1, pool='solo', loglevel='error', perform_ping_check=True, ping_task_timeout=10.0, shutdown_timeout=10.0, **kwargs)` is a context manager that runs a real worker in a daemon thread:

Sources: [celery/contrib/testing/worker.py:99-136](repo://celery/contrib/testing/worker.py#L99-L136)

1. Send `test_worker_starting`, finalize the app, make it current and default, and set up logging.
2. Open a broker connection to fail early when the broker (or `TEST_BROKER`) is unreachable.
3. Create a `TestWorkController` with an anonymous node name and no mingle, gossip or heartbeat, start it in a thread, and wait until its consumer is ready (`test_worker_started`).
4. Allow `result.get()` in the test, which the worker's pool step would otherwise forbid.
5. With the ping check, send `celery.ping` and require `'pong'` within the timeout, proving the whole path works.
6. On exit, request termination and join the thread within `shutdown_timeout`, raising `RuntimeError` if it does not stop; then send `test_worker_stopped`.

Sources: [celery/contrib/testing/worker.py:139-225](repo://celery/contrib/testing/worker.py#L139-L225)

With the prefork pool, `TestWorkController` collects log records from the child processes through a queue and replays them in the test process, so they appear in pytest's output.

Sources: [celery/contrib/testing/worker.py:30-96](repo://celery/contrib/testing/worker.py#L30-L96)

## Integration helpers

`Manager(app)` (and `ManagerMixin`) gathers helpers used by Celery's own integration suite against real brokers:

Sources: [celery/contrib/testing/manager.py:27-38](repo://celery/contrib/testing/manager.py#L27-L38), [celery/contrib/testing/manager.py:234-239](repo://celery/contrib/testing/manager.py#L234-L239)

- `wait_for(fun, catch, ...)` retries `fun` with backoff while it raises one of `catch`; `ensure_not_for_a_while` checks that something does *not* happen during a period.
- `join(result)` waits for a result or result set, retrying on timeouts (printing which results are still missing) and on lost connections, and fails the test after `max_retries`.
- `query_tasks(ids)` and `assert_received`, `assert_accepted` and `assert_task_worker_state` use remote-control `query_task` to check what workers did with given ids.
- `wait_until_idle()` purges the queues and waits until no worker reports active tasks.

Sources: [celery/contrib/testing/manager.py:48-133](repo://celery/contrib/testing/manager.py#L48-L133), [celery/contrib/testing/manager.py:134-233](repo://celery/contrib/testing/manager.py#L134-L233)

`celery.contrib.testing.mocks` builds fake messages for unit-testing worker code without a broker: `TaskMessage(name, id, args, kwargs, ...)` returns a mock in the protocol 2 format with JSON body and headers, `TaskMessage1` the legacy format, and `task_message_from_sig(app, sig)` converts a signature, including countdown, ETA, expiry and links. `ContextMock` is a mock usable in a `with` statement.

Sources: [celery/contrib/testing/mocks.py:11-112](repo://celery/contrib/testing/mocks.py#L11-L112), [celery/contrib/testing/mocks.py:114-137](repo://celery/contrib/testing/mocks.py#L114-L137)
