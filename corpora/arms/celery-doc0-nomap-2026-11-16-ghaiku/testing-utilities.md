---
title: "Testing Utilities"
---
## Overview

`celery.contrib.testing` runs a Celery app and a worker inside the test process, so a test can send a task and read its result without a separate broker process. The package has four parts: an app factory and a context manager that restores global state, a worker that runs in a thread, helpers that build task messages, and a pytest plugin whose fixtures use the first three. The production worker these helpers stand in for is described in [[Worker Startup and Bootsteps]].

Sources: [celery/contrib/testing/app.py:47-51](repo://celery/contrib/testing/app.py#L47-L51), [celery/contrib/testing/worker.py:30-38](repo://celery/contrib/testing/worker.py#L30-L38)

## A test app

`TestApp` builds an app from a default test configuration with the caller's overrides applied on top. It imports the testing tasks module first, so the `celery.ping` task is registered before any test runs. Logging is left to the app's defaults unless `enable_logging` is set.

Sources: [celery/contrib/testing/app.py:47-68](repo://celery/contrib/testing/app.py#L47-L68)

`setup_default_app` is a context manager. It saves the current app, the default app, the set of app finalizers and the registry of apps, runs the test, and then restores all four and closes the app it was given. A test that changes the global app therefore cannot leak that change into the next test.

Sources: [celery/contrib/testing/app.py:90-112](repo://celery/contrib/testing/app.py#L90-L112)

`set_trap` makes the default app and the current app a `Trap` object for the duration of the block, and it replaces the thread-local storage with a non-thread-local one. A `Trap` raises `RuntimeError` on any attribute access, so code that reaches for the global app during a unit test fails at once.

Sources: [celery/contrib/testing/app.py:23-38](repo://celery/contrib/testing/app.py#L23-L38), [celery/contrib/testing/app.py:69-89](repo://celery/contrib/testing/app.py#L69-L89)

## A worker in a thread

`start_worker` is a context manager. It sends the `test_worker_starting` signal, starts a worker thread with the `solo` pool and one process by default, and yields the worker to the test. When the ping check is enabled, it sends the `celery.ping` task and asserts the reply is `pong` before yielding, so a test does not start before the consumer can take messages.

Sources: [celery/contrib/testing/worker.py:100-138](repo://celery/contrib/testing/worker.py#L100-L138)

`_start_worker_thread` configures the app for the worker, asserts that the ping task is registered, and then starts the worker in a thread. Its `WorkController` argument defaults to `TestWorkController`.

Sources: [celery/contrib/testing/worker.py:140-160](repo://celery/contrib/testing/worker.py#L140-L160)

`TestWorkController` subclasses the production controller. Its `start` adds a log handler that forwards records from child processes, its `on_consumer_ready` sets an event and sends `test_worker_started`, and `ensure_started` waits for that event.

Sources: [celery/contrib/testing/worker.py:73-99](repo://celery/contrib/testing/worker.py#L73-L99)

The `manager` module provides `ManagerMixin` for tests that need to wait on several results. `wait_for` polls a result until it is ready or a timeout passes, `join` waits for a group of results and reports the first failure, and `inspect` asks the workers for their state.

Sources: [celery/contrib/testing/manager.py:27-70](repo://celery/contrib/testing/manager.py#L27-L70), [celery/contrib/testing/manager.py:109-137](repo://celery/contrib/testing/manager.py#L109-L137)

## Building messages in tests

`TaskMessage` builds a protocol-2 task message from a name, an id and the arguments, the same layout the sender produces in [[Message Format and Serialization]]. `task_message_from_sig` builds the message from a signature, so a test can feed a message to the worker's strategy without sending it through a broker.

Sources: [celery/contrib/testing/mocks.py:11-44](repo://celery/contrib/testing/mocks.py#L11-L44), [celery/contrib/testing/mocks.py:79-113](repo://celery/contrib/testing/mocks.py#L79-L113)

`ContextMock` is a `Mock` that works as a context manager, so code that opens connections or producers can be given a mock without changing its `with` statements.

Sources: [celery/contrib/testing/mocks.py:114-132](repo://celery/contrib/testing/mocks.py#L114-L132)

## The pytest plugin

`pytest_configure` registers the `celery` marker. The plugin's fixtures build on the helpers above: `celery_app` creates an app per test, `celery_session_app` creates one per session, and `celery_worker` and `celery_session_worker` start a worker on the app that the test uses.

Sources: [celery/contrib/pytest.py:22-32](repo://celery/contrib/pytest.py#L22-L32), [celery/contrib/pytest.py:65-108](repo://celery/contrib/pytest.py#L65-L108), [celery/contrib/pytest.py:173-188](repo://celery/contrib/pytest.py#L173-L188), [celery/contrib/pytest.py:195-205](repo://celery/contrib/pytest.py#L195-L205)

A test configures the app through fixtures named `celery_config`, `celery_parameters`, `celery_worker_parameters`, `celery_includes`, `celery_enable_logging` and `celery_worker_pool`. Each returns a value the app factory reads, and a `celery` marker on a test merges its keyword arguments into the config for that test.

Sources: [celery/contrib/pytest.py:109-172](repo://celery/contrib/pytest.py#L109-L172), [celery/contrib/pytest.py:179-180](repo://celery/contrib/pytest.py#L179-L180)
