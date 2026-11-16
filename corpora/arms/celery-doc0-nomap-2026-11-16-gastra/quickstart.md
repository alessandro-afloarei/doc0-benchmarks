---
title: "Quickstart"
---
## Overview

This walkthrough runs the repository's addition task with RabbitMQ, then enables an RPC result backend so a Python client can retrieve the answer. Keep the application module importable in both the worker and the calling Python process: each process loads its own application. The separation between producer, worker and result storage is shown in [[Celery Overview]].

Sources: [examples/tutorial/tasks.py:1-12](repo://examples/tutorial/tasks.py#L1-L12), [docs/getting-started/first-steps-with-celery.rst:118-150](repo://docs/getting-started/first-steps-with-celery.rst#L118-L150), [docs/getting-started/first-steps-with-celery.rst:229-255](repo://docs/getting-started/first-steps-with-celery.rst#L229-L255)

## Install this checkout

Use Python 3.10 or newer, as required by this checkout's package metadata. From the repository root, install the local package in development mode with the following command. This makes the local code available through the `celery` console entry point; [[Testing and Contributing]] covers the extra dependencies used for repository tests.

Sources: [setup.py:138-158](repo://setup.py#L138-L158), [CONTRIBUTING.rst:520-527](repo://CONTRIBUTING.rst#L520-L527)

```bash
python -m pip install -e .
```

Sources: [CONTRIBUTING.rst:527-527](repo://CONTRIBUTING.rst#L527-L527)

## Start a broker

Celery uses a broker to send and receive task messages. The repository's first-steps tutorial supplies this Docker command for a local RabbitMQ instance on port 5672. Run it before starting the worker so the tutorial broker URL has a service to connect to. The broker moves task messages; enabling a result backend is a later, separate step.

Sources: [docs/getting-started/first-steps-with-celery.rst:38-71](repo://docs/getting-started/first-steps-with-celery.rst#L38-L71), [docs/getting-started/first-steps-with-celery.rst:205-211](repo://docs/getting-started/first-steps-with-celery.rst#L205-L211)

```bash
docker run -d -p 5672:5672 rabbitmq
```

Sources: [docs/getting-started/first-steps-with-celery.rst:64-71](repo://docs/getting-started/first-steps-with-celery.rst#L64-L71)

## Load the tutorial application

Use `examples/tutorial` as the working directory for the worker and the client shell. Its `tasks.py` already contains the application and task below. `Celery('tasks', ...)` supplies the application's main name, and the decorator registers `add` as a task. The function's return value is ordinary Python addition; the asynchronous boundary is introduced when the caller uses the task's submission methods.

Sources: [examples/tutorial/tasks.py:1-8](repo://examples/tutorial/tasks.py#L1-L8), [docs/getting-started/first-steps-with-celery.rst:139-150](repo://docs/getting-started/first-steps-with-celery.rst#L139-L150), [celery/app/task.py:523-538](repo://celery/app/task.py#L523-L538)

```python
from celery import Celery

app = Celery('tasks', broker='amqp://')


@app.task()
def add(x, y):
    return x + y
```

Sources: [examples/tutorial/tasks.py:1-8](repo://examples/tutorial/tasks.py#L1-L8)

For a larger application, move settings into an importable module and load it with `config_from_object`. [[Applications and Configuration]] explains the lazy loading and discovery behavior that matters once tasks live in several modules. For this first run, keeping the app and task together follows the repository tutorial and avoids introducing a separate configuration module.

Sources: [docs/getting-started/first-steps-with-celery.rst:118-127](repo://docs/getting-started/first-steps-with-celery.rst#L118-L127), [docs/getting-started/first-steps-with-celery.rst:336-354](repo://docs/getting-started/first-steps-with-celery.rst#L336-L354)

## Run the worker and submit a task

Start the worker with the command below from the directory containing `tasks.py`. The global `-A` option selects the application module, and `worker` chooses the worker command. The CLI resolves an application string before invoking the command, so a module import failure happens before the worker can consume tasks.

Sources: [docs/getting-started/first-steps-with-celery.rst:154-162](repo://docs/getting-started/first-steps-with-celery.rst#L154-L162), [celery/bin/celery.py:135-154](repo://celery/bin/celery.py#L135-L154)

```bash
celery -A tasks worker --loglevel=INFO
```

Sources: [docs/getting-started/first-steps-with-celery.rst:154-162](repo://docs/getting-started/first-steps-with-celery.rst#L154-L162)

In another terminal, open a Python shell with the same module available and submit the task. `delay` forwards positional and keyword arguments to `apply_async`; it does not accept the additional delivery options of that method. [[Publishing Tasks]] explains routing, countdowns and publication options once this basic call works.

Sources: [docs/getting-started/first-steps-with-celery.rst:190-203](repo://docs/getting-started/first-steps-with-celery.rst#L190-L203), [celery/app/task.py:523-538](repo://celery/app/task.py#L523-L538)

```python
from tasks import add
add.delay(4, 4)
```

Sources: [docs/getting-started/first-steps-with-celery.rst:199-203](repo://docs/getting-started/first-steps-with-celery.rst#L199-L203)

Check the worker's console output for the task's execution. At this stage, the tutorial application has no result backend. Receiving an `AsyncResult` from the call identifies the submission, but retrieving its stored value requires a configured backend. This is why the first verification uses worker output rather than immediately waiting on the result.

Sources: [docs/getting-started/first-steps-with-celery.rst:202-211](repo://docs/getting-started/first-steps-with-celery.rst#L202-L211), [examples/tutorial/tasks.py:1-8](repo://examples/tutorial/tasks.py#L1-L8)

## Enable and retrieve results

To follow the repository tutorial's RPC example, replace the application constructor in your tutorial module with the line below. Restart the worker and close and reopen the Python session after this change so both processes load the updated application. [[Result Backends]] explains how RPC differs from persistent result adapters.

Sources: [docs/getting-started/first-steps-with-celery.rst:229-255](repo://docs/getting-started/first-steps-with-celery.rst#L229-L255)

```python
app = Celery('tasks', backend='rpc://', broker='pyamqp://')
```

Sources: [docs/getting-started/first-steps-with-celery.rst:229-237](repo://docs/getting-started/first-steps-with-celery.rst#L229-L237)

Submit a new call and keep its result handle. The following interaction is copied from the tutorial; the timeout bounds the client's wait, and a task that takes longer can raise a timeout instead of immediately returning the example value. `ready()` is a nonblocking state check, while `get()` waits for completion.

Sources: [docs/getting-started/first-steps-with-celery.rst:248-271](repo://docs/getting-started/first-steps-with-celery.rst#L248-L271), [celery/result.py:188-213](repo://celery/result.py#L188-L213)

```pycon
>>> from tasks import add    # close and reopen to get updated 'app'
>>> result = add.delay(4, 4)
>>> result.get(timeout=1)
8
```

Sources: [docs/getting-started/first-steps-with-celery.rst:252-271](repo://docs/getting-started/first-steps-with-celery.rst#L252-L271)

## Diagnose the first run

If `-A tasks` cannot load the application, inspect the CLI error before looking at broker delivery: it distinguishes a missing application module, a missing attribute and an exception during import. If publication succeeds but a value cannot be retrieved, first check that the worker and client both reloaded the backend configuration. For failures raised by task code, `get()` normally re-raises the task exception; passing `propagate=False` returns it instead, and the result exposes a traceback.

Sources: [celery/bin/celery.py:135-152](repo://celery/bin/celery.py#L135-L152), [docs/getting-started/first-steps-with-celery.rst:248-287](repo://docs/getting-started/first-steps-with-celery.rst#L248-L287)

Result backends consume resources, so eventually consume or forget each result you create. [[Task Results]] explains timeout semantics, exception propagation and cleanup in detail. When moving this walkthrough into automated tests, [[Testing and Contributing]] provides an embedded worker lifecycle and isolation fixtures instead of relying on a manually started terminal process.

Sources: [docs/getting-started/first-steps-with-celery.rst:289-295](repo://docs/getting-started/first-steps-with-celery.rst#L289-L295), [celery/contrib/testing/worker.py:96-136](repo://celery/contrib/testing/worker.py#L96-L136)
