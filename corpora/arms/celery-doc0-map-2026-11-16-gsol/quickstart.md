---
title: "Quickstart"
---
## Overview

Run the repository's `examples/app/myapp.py` application to see a task cross the producer, broker and worker boundaries described in [[Celery Overview]]. The example declares an `add` task that sleeps for ten seconds and returns a sum. Its broker is `amqp://guest@localhost//`, and the result backend is deliberately left for you to configure. Enable that backend in both processes before attempting to retrieve the returned value.

Sources: [examples/app/myapp.py:25-41](repo://examples/app/myapp.py#L25-L41)

## Prepare Python and the broker

The package requires Python 3.10 or later. Its installation metadata registers the `celery` command with `celery.__main__:main` and loads dependencies from the repository's requirements files. Install the checkout into your Python environment with `python -m pip install -e .` from the repository root; this uses the local package whose worker and task code you are reading. The existing introductory documentation also describes installing the published package with `pip install celery`.

Sources: [setup.py:118-125](repo://setup.py#L118-L125), [setup.py:138-158](repo://setup.py#L138-L158), [docs/getting-started/first-steps-with-celery.rst:103-113](repo://docs/getting-started/first-steps-with-celery.rst#L103-L113)

The example expects a broker reachable on localhost using its AMQP URL. The repository's introductory guide gives `docker run -d -p 5672:5672 rabbitmq` as one way to start RabbitMQ. Use an already configured broker instead if you have one, setting `CELERY_BROKER_URL` in both shells. Celery's settings object checks that environment variable before configured broker values; [[Applications and Configuration]] explains the configuration loading path.

Sources: [examples/app/myapp.py:29-35](repo://examples/app/myapp.py#L29-L35), [docs/getting-started/first-steps-with-celery.rst:57-71](repo://docs/getting-started/first-steps-with-celery.rst#L57-L71), [celery/app/utils.py:100-105](repo://celery/app/utils.py#L100-L105)

## Select the example application

Change into `examples/app` so that `myapp` is importable. The module imports `Celery`, constructs the application and decorates this function:

Sources: [examples/app/myapp.py:13-41](repo://examples/app/myapp.py#L13-L41), [celery/app/utils.py:378-389](repo://celery/app/utils.py#L378-L389)

```python
@app.task
def add(x, y):
    sleep(10)
    return x + y
```

Sources: [examples/app/myapp.py:38-41](repo://examples/app/myapp.py#L38-L41)

The `-A myapp` option asks the CLI to locate an application in that module. The explicit form `-A myapp:app` names its attribute directly. `find_app` first resolves the requested symbol; for a module without a colon it tries `app`, then `celery`, and can search a package's `celery` submodule or other Celery instances. Using the example's explicit attribute is useful when following which application owns the task registry.

Sources: [examples/app/myapp.py:13-22](repo://examples/app/myapp.py#L13-L22), [celery/app/utils.py:378-415](repo://celery/app/utils.py#L378-L415)

## Enable a result backend

In both the worker shell and the client shell, set `CELERY_RESULT_BACKEND` to `rpc://` before importing the application or starting the command. The settings property gives this environment variable precedence, so this enables results without editing the example. The repository's first-steps guide uses RPC to send states back as messages. [[Results and Backends]] explains the lifetime and retrieval behavior behind this backend choice.

Sources: [celery/app/utils.py:107-112](repo://celery/app/utils.py#L107-L112), [docs/getting-started/first-steps-with-celery.rst:229-237](repo://docs/getting-started/first-steps-with-celery.rst#L229-L237)

The CLI also accepts `--result-backend` and `--broker` as global options and writes their values into the corresponding Celery environment variables. A CLI option affects the command process; your separate Python client must receive matching configuration through its own environment or application settings. Restart the worker and reopen the Python session after changing backend settings, as the introductory guide instructs.

Sources: [celery/bin/celery.py:67-75](repo://celery/bin/celery.py#L67-L75), [celery/bin/celery.py:123-131](repo://celery/bin/celery.py#L123-L131), [docs/getting-started/first-steps-with-celery.rst:248-255](repo://docs/getting-started/first-steps-with-celery.rst#L248-L255)

## Start the worker and call the task

From the example directory, start `celery -A myapp:app worker -l INFO`. The example documents this explicit app form. The worker command resolves the selected application, applies worker options and constructs `app.Worker`. Keep this process running while opening a second shell in the same directory with the same broker and result environment settings. [[Worker Lifecycle and Delivery]] follows the worker's initialization and consumption steps.

Sources: [examples/app/myapp.py:13-22](repo://examples/app/myapp.py#L13-L22), [celery/bin/worker.py:307-325](repo://celery/bin/worker.py#L307-L325), [celery/bin/worker.py:358-365](repo://celery/bin/worker.py#L358-L365)

Start Python in the second shell and follow the example's call. Its ten-second sleep means this is intentionally not an immediate result:

Sources: [examples/app/myapp.py:7-10](repo://examples/app/myapp.py#L7-L10), [examples/app/myapp.py:38-41](repo://examples/app/myapp.py#L38-L41)

```pycon
>>> from myapp import add
>>> add.delay(16, 16).get()
32
```

Sources: [examples/app/myapp.py:8-10](repo://examples/app/myapp.py#L8-L10)

`delay` passes the positional and keyword arguments to `apply_async`, which returns an asynchronous result handle. When retaining that handle in your own client, `get(timeout=30)` bounds the client wait; it does not terminate a task that takes longer. An execution failure is raised in the client by default. [[Tasks and Retries]] explains the distinction between calling the body locally and submitting a task message.

Sources: [celery/app/task.py:523-538](repo://celery/app/task.py#L523-L538), [celery/result.py:191-239](repo://celery/result.py#L191-L239)

## Diagnose a first run

If application loading fails, the CLI distinguishes a missing module, missing application attribute and an exception raised during import. Check the working directory and `-A` spelling against the example before investigating task delivery. Once a message reaches a worker, an unregistered task name follows a different path: the consumer rejects it and records `NotRegistered` through the backend. [[Publishing and Routing]] covers destination selection when the application imports correctly but work reaches an unexpected queue.

Sources: [celery/bin/celery.py:135-152](repo://celery/bin/celery.py#L135-L152), [celery/worker/consumer/consumer.py:677-707](repo://celery/worker/consumer/consumer.py#L677-L707)

A completed task and a retrievable result are separate checks. The first-steps guide explicitly says results require a backend, while `AsyncResult.get` delegates waiting to that backend. Retrieve or forget every retained result to release backend resources. To inspect workers independently of a particular result, use the facilities described in [[Monitoring and Remote Control]].

Sources: [docs/getting-started/first-steps-with-celery.rst:205-211](repo://docs/getting-started/first-steps-with-celery.rst#L205-L211), [celery/result.py:203-207](repo://celery/result.py#L203-L207), [celery/result.py:255-265](repo://celery/result.py#L255-L265)
