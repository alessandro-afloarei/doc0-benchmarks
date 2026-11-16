---
title: "Quickstart"
---
## Overview

Run the addition task included in `examples/tutorial/tasks.py` to exercise the producer, broker and worker described in [[Celery Overview]]. The example creates a Celery application with an AMQP broker and registers `add(x, y)`. This guide uses RabbitMQ for messages and the RPC result backend for the return value. Keep the worker and the calling Python interpreter connected to the same broker, and configure the result backend in both processes before their applications load.

Sources: [examples/tutorial/tasks.py:1-12](repo://examples/tutorial/tasks.py#L1-L12), [docs/getting-started/first-steps-with-celery.rst:229-250](repo://docs/getting-started/first-steps-with-celery.rst#L229-L250), [celery/app/utils.py:100-112](repo://celery/app/utils.py#L100-L112)

## Install this checkout

The package metadata requires Python 3.10 or newer and installs a `celery` command that enters `celery.__main__.main`. From the repository root, install the checkout in development mode using the contributor workflow. This makes the task example run against the checked-out implementation. The package declares its default dependencies and optional extras separately; the AMQP tutorial uses the default installation.

Sources: [setup.py:118-125](repo://setup.py#L118-L125), [setup.py:138-159](repo://setup.py#L138-L159), [CONTRIBUTING.rst:527-527](repo://CONTRIBUTING.rst#L527-L527), [examples/tutorial/tasks.py:1-3](repo://examples/tutorial/tasks.py#L1-L3)

```bash
python -m pip install -e .
```

Sources: [CONTRIBUTING.rst:527-527](repo://CONTRIBUTING.rst#L527-L527)

## Prepare the broker and application

The task's `amqp://` setting expects an AMQP broker. If you already have the tutorial's local RabbitMQ service, use it; otherwise the repository's getting-started instructions provide this Docker command. A broker is a separate running service: installing the Python package alone does not start one. [[Application and Configuration]] explains how to replace the tutorial connection settings when your broker is elsewhere.

Sources: [examples/tutorial/tasks.py:1-3](repo://examples/tutorial/tasks.py#L1-L3), [docs/getting-started/first-steps-with-celery.rst:38-71](repo://docs/getting-started/first-steps-with-celery.rst#L38-L71), [celery/app/utils.py:100-112](repo://celery/app/utils.py#L100-L112)

```bash
docker run -d -p 5672:5672 rabbitmq
```

Sources: [docs/getting-started/first-steps-with-celery.rst:64-71](repo://docs/getting-started/first-steps-with-celery.rst#L64-L71)

The application is already present in the checkout. Its complete task definition is small enough to inspect before running it. `@app.task()` registers the function, and the body simply returns the sum; there is no separate worker-specific copy to create. Run the following worker and Python commands from `examples/tutorial` so `tasks` resolves to this module.

Sources: [examples/tutorial/tasks.py:1-12](repo://examples/tutorial/tasks.py#L1-L12), [celery/bin/celery.py:135-152](repo://celery/bin/celery.py#L135-L152)

```python
from celery import Celery

app = Celery('tasks', broker='amqp://')


@app.task()
def add(x, y):
    return x + y
```

Sources: [examples/tutorial/tasks.py:1-8](repo://examples/tutorial/tasks.py#L1-L8)

## Start the worker

In a terminal, change to `examples/tutorial`, set `CELERY_RESULT_BACKEND` to `rpc://`, and run `celery -A tasks worker -l INFO`. These arguments select the example application, start its worker and enable informational logging. The environment setting supplies a backend without editing the example. Repeat that environment setting in the client terminal: configuration in one shell does not configure another process's application.

Sources: [celery/bin/celery.py:57-75](repo://celery/bin/celery.py#L57-L75), [celery/bin/celery.py:135-152](repo://celery/bin/celery.py#L135-L152), [celery/bin/worker.py:162-168](repo://celery/bin/worker.py#L162-L168), [celery/bin/worker.py:307-320](repo://celery/bin/worker.py#L307-L320), [celery/app/utils.py:107-112](repo://celery/app/utils.py#L107-L112), [celery/app/backends.py:15-19](repo://celery/app/backends.py#L15-L19)

The worker command constructs `app.Worker` with the selected options. Pool and concurrency flags are available when you need to change execution capacity; the CLI defaults to prefork and describes concurrency as the available CPU count. [[Worker Lifecycle and Concurrency]] explains those choices and startup behavior. For this first call, leave the ordinary worker defaults in place and keep its console visible to see receipt and completion messages.

Sources: [celery/bin/worker.py:194-210](repo://celery/bin/worker.py#L194-L210), [celery/bin/worker.py:358-365](repo://celery/bin/worker.py#L358-L365), [docs/getting-started/first-steps-with-celery.rst:193-207](repo://docs/getting-started/first-steps-with-celery.rst#L193-L207)

## Submit and retrieve a task

Open a Python interpreter in `examples/tutorial` with `CELERY_RESULT_BACKEND=rpc://` configured. Import the task, submit the addition and retain its result handle. `delay` forwards its arguments to `apply_async`; it returns a result handle after publishing. A direct call such as `add(4, 4)` executes the task body in the current process instead, so use `delay` to test the worker path described in [[Task Publishing]].

Sources: [celery/app/task.py:495-502](repo://celery/app/task.py#L495-L502), [celery/app/task.py:523-534](repo://celery/app/task.py#L523-L534), [celery/app/task.py:702-708](repo://celery/app/task.py#L702-L708), [docs/getting-started/first-steps-with-celery.rst:248-255](repo://docs/getting-started/first-steps-with-celery.rst#L248-L255)

```pycon
>>> from tasks import add
>>> result = add.delay(4, 4)
>>> result.get(timeout=1)
8
```

Sources: [docs/getting-started/first-steps-with-celery.rst:248-271](repo://docs/getting-started/first-steps-with-celery.rst#L248-L271), [examples/tutorial/tasks.py:6-8](repo://examples/tutorial/tasks.py#L6-L8)

The one-second timeout limits this client's wait, and a busy worker can take longer. A timeout does not terminate the task; retain the handle and wait again if appropriate. By default `get` raises a remote task exception in the caller. [[Results and State]] covers nonblocking state inspection and the `propagate=False` alternative. The result API also requires eventual `get` or `forget` calls to release backend resources.

Sources: [celery/result.py:191-241](repo://celery/result.py#L191-L241)

## Diagnose the first run

An application-import failure occurs before the worker starts: the CLI distinguishes a missing module, a missing application attribute and another import-time exception. Check the working directory and the `-A tasks` selection first. If the worker receives a name it has not registered, its unknown-task handler rejects the message and records `NotRegistered`. The registration and discovery mechanisms in [[Application and Configuration]] explain that second failure boundary.

Sources: [celery/bin/celery.py:135-152](repo://celery/bin/celery.py#L135-L152), [celery/worker/consumer/consumer.py:677-708](repo://celery/worker/consumer/consumer.py#L677-L708)

A broker connection failure can surface from `apply_async` as an `OperationalError`; a result-backend omission is a different problem. Without a backend, selection falls back to `disabled`, even though a task can still be published. Configure the backend before launching both processes, and restart them after changing configuration so the application uses the new settings. [[Result Backends]] describes alternatives when the tutorial's RPC result transport no longer fits your application.

Sources: [celery/app/task.py:646-653](repo://celery/app/task.py#L646-L653), [celery/app/backends.py:41-49](repo://celery/app/backends.py#L41-L49), [docs/getting-started/first-steps-with-celery.rst:248-250](repo://docs/getting-started/first-steps-with-celery.rst#L248-L250)
