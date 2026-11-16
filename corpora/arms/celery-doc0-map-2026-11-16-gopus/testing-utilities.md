---
title: "Testing Utilities"
---
## Overview

Celery ships helpers for testing code that sends or runs tasks, at three levels. Eager execution runs tasks in the calling process with no broker or worker. `celery.contrib.testing` builds isolated test apps and runs a real worker in a background thread against an in-memory broker. `celery.contrib.pytest` wraps both as pytest fixtures. A further module, `celery.contrib.testing.mocks`, fabricates task messages for unit-testing worker components.

Sources: [celery/contrib/pytest.py:1-30](repo://celery/contrib/pytest.py#L1-L30), [celery/contrib/testing/app.py:1-20](repo://celery/contrib/testing/app.py#L1-L20), [celery/contrib/testing/worker.py:1-30](repo://celery/contrib/testing/worker.py#L1-L30)

## Eager execution

`Task.apply(args, kwargs, ...)` runs a task synchronously in the current process. It builds a request marked `is_eager`, takes the parent and root ids from the task currently executing (if any), runs the same tracer the worker uses with `eager=True`, and returns an `EagerResult` ([[Task States and AsyncResult]]). Exceptions are re-raised when `throw` is true, which defaults to the `task_eager_propagates` setting; otherwise they are returned in the result.

Sources: [celery/app/task.py:869-951](repo://celery/app/task.py#L869-L951)

With `task_always_eager`, `apply_async` and `delay` call `apply` instead of sending a message, after serializing and deserializing the arguments with the task's serializer, so a test still fails on arguments that cannot be serialized. Chains and chords run eagerly too, and results are not stored unless `task_store_eager_result` is set ([[Sending Tasks]], [[Signatures and Chains]]).

Sources: [celery/app/task.py:682-702](repo://celery/app/task.py#L682-L702), [celery/canvas.py:1036-1046](repo://celery/canvas.py#L1036-L1046), [celery/app/trace.py:490-495](repo://celery/app/trace.py#L490-L495)

Eager mode sends no message, so the router, the broker, the consumer and the pool are not involved; the embedded worker below runs tasks through all of them.

Sources: [celery/app/task.py:682-708](repo://celery/app/task.py#L682-L708)

## Test apps

`TestApp(name=None, config=None, enable_logging=False, set_as_current=False, log=UnitLogging, backend=None, broker=None, **kwargs)` creates a `Celery` app named `celery.tests` with test defaults added through `add_defaults`, so they can still be overridden by configuration:

Sources: [celery/contrib/testing/app.py:47-65](repo://celery/contrib/testing/app.py#L47-L65)

| Setting | Test default |
| --- | --- |
| `broker_url` | `memory://` (dropped when `broker` is given) |
| `result_backend` | `cache+memory://` (dropped when `backend` is given) |
| `accept_content` | `{'json'}` |
| `enable_utc`, `timezone` | `True`, `'UTC'` |
| `broker_heartbeat` | `0` |
| `worker_hijack_root_logger`, `worker_log_color` | `False`, `False` |

Sources: [celery/contrib/testing/app.py:10-65](repo://celery/contrib/testing/app.py#L10-L65)

Importing `TestApp` also imports `celery.contrib.testing.tasks`, which defines the shared task `celery.ping` returning `'pong'`, used to check that a worker is alive. Unless `enable_logging` is set, the app uses `UnitLogging`, which marks logging as already configured so tests do not reconfigure the root logger.

Sources: [celery/contrib/testing/app.py:39-50](repo://celery/contrib/testing/app.py#L39-L50), [celery/contrib/testing/tasks.py:1-9](repo://celery/contrib/testing/tasks.py#L1-L9)

`setup_default_app(app, use_trap=False)` is a context manager that saves the current app, the default app, the app finalizers and the set of active apps, and restores them on exit, closing the test app. With `use_trap=True` it installs a `Trap` as both current and default app: any attribute access on it raises `RuntimeError('Test depends on current_app')`, which finds code that falls back to the implicit app instead of using the one it was given ([[The Celery Application]]).

Sources: [celery/contrib/testing/app.py:23-36](repo://celery/contrib/testing/app.py#L23-L36), [celery/contrib/testing/app.py:68-112](repo://celery/contrib/testing/app.py#L68-L112)

## Embedded worker

`start_worker(app, concurrency=1, pool='solo', loglevel='error', logfile=None, perform_ping_check=True, ping_task_timeout=10.0, shutdown_timeout=10.0, **kwargs)` is a context manager that runs a worker in a daemon thread for the duration of the block:

Sources: [celery/contrib/testing/worker.py:99-117](repo://celery/contrib/testing/worker.py#L99-L117)

1. Finalize the app, make it current and default, and set up logging.
2. Check that the broker is reachable (using `TEST_BROKER` if set).
3. Create a `TestWorkController` with mingle and gossip disabled and heartbeats disabled by default, start it in a thread, and wait until its consumer is ready.
4. Allow `get()` inside the test by clearing the join-will-block flag ([[Task States and AsyncResult]]).
5. With `perform_ping_check`, send `celery.ping` and assert the reply is `'pong'` within `ping_task_timeout`.
6. On exit, set `should_terminate` so the worker shuts down, and join the thread, raising `RuntimeError` if it has not exited within `shutdown_timeout`.

Sources: [celery/contrib/testing/worker.py:99-192](repo://celery/contrib/testing/worker.py#L99-L192), [celery/contrib/testing/worker.py:219-225](repo://celery/contrib/testing/worker.py#L219-L225)

`TestWorkController` overrides `on_consumer_ready` to set an event that `ensure_started()` waits on, and sends `test_worker_started` with the worker and consumer; `start_worker` also sends `test_worker_starting` and `test_worker_stopped`. With the prefork pool, it collects log records from the child processes through a billiard queue and a `QueueListener`, so logs from tasks appear in the test output.

Sources: [celery/contrib/testing/worker.py:14-97](repo://celery/contrib/testing/worker.py#L14-L97)

The default `solo` pool runs tasks in the worker thread itself ([[Concurrency Pools]]).

Sources: [celery/contrib/testing/worker.py:99-110](repo://celery/contrib/testing/worker.py#L99-L110)

## The pytest plugin

`celery.contrib.pytest` is a pytest plugin module; the package's `setup.py` declares only the `celery` console script as an entry point, so a test suite loads it by naming the module as a pytest plugin. It registers a `celery(**overrides)` marker and these fixtures:

Sources: [celery/contrib/pytest.py:22-29](repo://celery/contrib/pytest.py#L22-L29)

| Fixture | Scope | Provides |
| --- | --- | --- |
| `celery_app` | test | A fresh `TestApp` configured from `celery_config`, `celery_parameters` and the test's `celery` marker |
| `celery_worker` | test | `start_worker(celery_app, pool=celery_worker_pool, **celery_worker_parameters)`, after importing `celery_includes` |
| `celery_session_app` | session | A `TestApp` for the whole session, made current and default unless the trap is enabled |
| `celery_session_worker` | session | A worker for the session app, also registering `celery_class_tasks` |
| `depends_on_current_app` | test | Makes `celery_app` the current app |

Sources: [celery/contrib/pytest.py:22-29](repo://celery/contrib/pytest.py#L22-L29), [celery/contrib/pytest.py:53-106](repo://celery/contrib/pytest.py#L53-L106), [celery/contrib/pytest.py:172-216](repo://celery/contrib/pytest.py#L172-L216), [setup.py:155-159](repo://setup.py#L155-L159)

Behaviour is changed by redefining configuration fixtures, all session-scoped:

Sources: [celery/contrib/pytest.py:137-145](repo://celery/contrib/pytest.py#L137-L145)

| Fixture | Default | Use |
| --- | --- | --- |
| `celery_config` | `{}` | Settings for the test app |
| `celery_parameters` | `{}` | Keyword arguments for `Celery(...)` |
| `celery_worker_parameters` | `{}` | Keyword arguments for the worker, such as queues |
| `celery_worker_pool` | `'solo'` | Pool for the embedded worker |
| `celery_includes` | `()` | Modules to import before the worker starts |
| `celery_class_tasks` | `[]` | Class-based tasks to register with the session app |
| `celery_enable_logging` | `False` | Let the app configure logging |
| `use_celery_app_trap` | `False` | Install the current-app trap |

Sources: [celery/contrib/pytest.py:53-62](repo://celery/contrib/pytest.py#L53-L62), [celery/contrib/pytest.py:108-191](repo://celery/contrib/pytest.py#L108-L191)

Setting the `NO_WORKER` environment variable makes the worker fixtures yield nothing instead of starting a worker.

Sources: [celery/contrib/pytest.py:16-16](repo://celery/contrib/pytest.py#L16-L16), [celery/contrib/pytest.py:194-210](repo://celery/contrib/pytest.py#L194-L210)

## Mocks and integration helpers

`celery.contrib.testing.mocks` builds `Mock` objects that look like Kombu messages, for testing strategies, requests and consumers without a broker. `TaskMessage(name, id=None, args=(), kwargs=None, callbacks=None, errbacks=None, chain=None, shadow=None, **options)` produces a protocol 2 message with headers and a JSON body, `TaskMessage1` a protocol 1 message, and `task_message_from_sig(app, sig)` converts a signature, turning `countdown` and numeric `expires` into ISO timestamps. `ContextMock` is a `Mock` usable in a `with` statement.

Sources: [celery/contrib/testing/mocks.py:11-112](repo://celery/contrib/testing/mocks.py#L11-L112), [celery/contrib/testing/mocks.py:114-137](repo://celery/contrib/testing/mocks.py#L114-L137)

`celery.contrib.testing.manager.Manager(app)` collects helpers used by Celery's own integration tests: `wait_for(fun, catch, ...)` retries until a call stops raising, `ensure_not_for_a_while` asserts that something does not happen, `join(result)` waits for results, and `assert_received`, `assert_accepted` and `wait_until_idle` poll workers through `app.control.inspect()` ([[Remote Control and Revocation]]).

Sources: [celery/contrib/testing/manager.py:27-133](repo://celery/contrib/testing/manager.py#L27-L133), [celery/contrib/testing/manager.py:134-239](repo://celery/contrib/testing/manager.py#L134-L239)
