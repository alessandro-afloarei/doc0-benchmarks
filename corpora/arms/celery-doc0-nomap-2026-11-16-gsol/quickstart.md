---
title: "Quickstart"
---
## Overview

This walkthrough runs the repository's tutorial addition task with a broker and a worker, then enables a result backend to retrieve its return value. It exercises the producer-to-worker flow described in [[Celery Overview]]. Keep the worker running while submitting tasks from a second terminal: submission returns a result handle before the worker computes the answer.

Sources: [examples/tutorial/tasks.py:1-12](repo://examples/tutorial/tasks.py#L1-L12), [celery/app/task.py:702-708](repo://celery/app/task.py#L702-L708), [celery/app/base.py:1025-1041](repo://celery/app/base.py#L1025-L1041)

## Install this checkout

Use Python 3.10 or newer for this checkout: that is the requirement enforced by `setup.py`. The package defines a `celery` console script pointing to `celery.__main__:main`. Install the repository in development mode from its root so the command imports this source tree.

Sources: [setup.py:138-159](repo://setup.py#L138-L159), [CONTRIBUTING.rst:527-527](repo://CONTRIBUTING.rst#L527-L527)

```bash
python -m pip install -e .
```

Sources: [CONTRIBUTING.rst:527-527](repo://CONTRIBUTING.rst#L527-L527)

The package has optional dependency groups for transports and integrations, including `redis`, `sqlalchemy`, `gevent`, and `django`. This walkthrough uses the tutorial's AMQP broker configuration. If you later select a backend or transport that needs an optional client, install the corresponding extra; [[Results and Backends]] explains the backend boundary.

Sources: [setup.py:12-47](repo://setup.py#L12-L47), [setup.py:113-125](repo://setup.py#L113-L125), [examples/tutorial/tasks.py:1-8](repo://examples/tutorial/tasks.py#L1-L8)

## Start a broker

The tutorial uses RabbitMQ. If Docker is available, the repository's first-steps guide provides this command to expose the broker on port 5672. Keep it running while the application and worker communicate. The broker carries task messages; result retrieval is configured separately below.

Sources: [docs/getting-started/first-steps-with-celery.rst:38-71](repo://docs/getting-started/first-steps-with-celery.rst#L38-L71), [docs/getting-started/first-steps-with-celery.rst:209-233](repo://docs/getting-started/first-steps-with-celery.rst#L209-L233)

```bash
docker run -d -p 5672:5672 rabbitmq
```

Sources: [docs/getting-started/first-steps-with-celery.rst:64-71](repo://docs/getting-started/first-steps-with-celery.rst#L64-L71)

## Load the tutorial application

Work from `examples/tutorial` so Python can import its `tasks` module. Its essential application is the following code. `Celery('tasks', broker='amqp://')` creates the application, and the decorator makes `add` available as a task. The function itself still just returns the sum of its arguments; [[Application and Configuration]] explains how decoration creates the registry entry.

Sources: [examples/tutorial/tasks.py:1-8](repo://examples/tutorial/tasks.py#L1-L8), [celery/app/base.py:590-633](repo://celery/app/base.py#L590-L633)

```python
from celery import Celery

app = Celery('tasks', broker='amqp://')


@app.task()
def add(x, y):
    return x + y
```

Sources: [examples/tutorial/tasks.py:1-8](repo://examples/tutorial/tasks.py#L1-L8)

Run the worker from that directory using the tutorial command below. `-A tasks` selects the application module and `--loglevel=INFO` makes task receipt and completion visible. [[Worker Lifecycle and Execution]] follows the startup path behind this command; use `celery worker --help` to see the options implemented by the command.

Sources: [docs/getting-started/first-steps-with-celery.rst:154-178](repo://docs/getting-started/first-steps-with-celery.rst#L154-L178), [celery/bin/celery.py:55-66](repo://celery/bin/celery.py#L55-L66)

```bash
celery -A tasks worker --loglevel=INFO
```

Sources: [docs/getting-started/first-steps-with-celery.rst:154-162](repo://docs/getting-started/first-steps-with-celery.rst#L154-L162)

## Submit work

Open a Python interpreter in another terminal with the same tutorial directory available for imports. `delay` is the convenient argument-only interface; it calls `apply_async`. Watch the worker's console for the task execution. The handle returned by submission identifies the asynchronous work, while [[Task Publishing and Routing]] explains how to supply queue, timing, and publication options.

Sources: [docs/getting-started/first-steps-with-celery.rst:190-211](repo://docs/getting-started/first-steps-with-celery.rst#L190-L211), [celery/app/task.py:523-534](repo://celery/app/task.py#L523-L534)

```pycon
>>> from tasks import add
>>> add.delay(4, 4)
```

Sources: [docs/getting-started/first-steps-with-celery.rst:199-200](repo://docs/getting-started/first-steps-with-celery.rst#L199-L200)

## Retrieve the answer

The tutorial application initially configures only a broker. To retrieve results, replace its `app = Celery(...)` line with the first-steps guide's RPC backend configuration below. Restart the worker and reopen the Python interpreter so both processes import the changed application. This is a separate configuration step from getting messages delivered to a worker.

Sources: [examples/tutorial/tasks.py:1-8](repo://examples/tutorial/tasks.py#L1-L8), [docs/getting-started/first-steps-with-celery.rst:229-250](repo://docs/getting-started/first-steps-with-celery.rst#L229-L250)

```python
app = Celery('tasks', backend='rpc://', broker='pyamqp://')
```

Sources: [docs/getting-started/first-steps-with-celery.rst:229-237](repo://docs/getting-started/first-steps-with-celery.rst#L229-L237)

Hold the returned handle and wait for the sum. The timeout limits the client's wait; a timeout does not terminate the worker's task. The answer is `8` once execution completes, and `get` propagates a remote exception by default. [[Results and Backends]] describes state inspection, exception propagation, and result cleanup in detail.

Sources: [docs/getting-started/first-steps-with-celery.rst:248-275](repo://docs/getting-started/first-steps-with-celery.rst#L248-L275), [celery/result.py:209-240](repo://celery/result.py#L209-L240)

```pycon
>>> from tasks import add    # close and reopen to get updated 'app'
>>> result = add.delay(4, 4)
>>> result.get(timeout=1)
8
```

Sources: [docs/getting-started/first-steps-with-celery.rst:254-255](repo://docs/getting-started/first-steps-with-celery.rst#L254-L255), [docs/getting-started/first-steps-with-celery.rst:270-271](repo://docs/getting-started/first-steps-with-celery.rst#L270-L271)

## Diagnose the first run

If the application cannot load, check that `tasks` is importable from the command's working directory. The CLI distinguishes a missing application module from an error raised during import. If the worker reports an unknown task, its local registry did not supply that task's strategy; the consumer rejects that message and records `NotRegistered`. Inspect registration through [[Monitoring and Worker Control]] before changing routing or retry policy.

Sources: [celery/bin/celery.py:32-43](repo://celery/bin/celery.py#L32-L43), [celery/worker/consumer/consumer.py:677-721](repo://celery/worker/consumer/consumer.py#L677-L721)

If submission cannot connect to the transport, `apply_async` can raise `kombu.exceptions.OperationalError`. If execution succeeds but a result is unavailable, check the backend configuration and that both processes reloaded it. For application tests that do not need separate command terminals, [[Development and Testing]] covers the embedded worker helper and the distinct eager execution path.

Sources: [celery/app/task.py:643-653](repo://celery/app/task.py#L643-L653), [docs/getting-started/first-steps-with-celery.rst:248-250](repo://docs/getting-started/first-steps-with-celery.rst#L248-L250), [celery/contrib/testing/worker.py:99-134](repo://celery/contrib/testing/worker.py#L99-L134), [celery/app/task.py:682-701](repo://celery/app/task.py#L682-L701)
