---
title: "Quickstart"
---
## Overview

Run a broker, define an importable application and task, start a worker, then submit work from a second process. This follows the message flow in [[Celery Overview]]. The examples below use RabbitMQ for task delivery and the RPC backend for the return value, both combinations shown in the repository's getting-started material. The backend is optional when you only need execution, but it is required for this result retrieval exercise.

Sources: [docs/getting-started/first-steps-with-celery.rst:118-150](repo://docs/getting-started/first-steps-with-celery.rst#L118-L150), [docs/getting-started/first-steps-with-celery.rst:193-237](repo://docs/getting-started/first-steps-with-celery.rst#L193-L237)

## Prepare the runtime

Use Python 3.10 or newer for this checkout: that is the requirement declared by the package metadata. Installation also creates the `celery` console command pointing to `celery.__main__:main`. The CLI imports its command implementation after applying any required concurrency patching, so the installed executable and module entry point share the command machinery.

Sources: [setup.py:145-160](repo://setup.py#L145-L160), [celery/__main__.py:10-19](repo://celery/__main__.py#L10-L19)

The repository tutorial installs Celery through pip. Run this in the Python environment that will run both the worker and your client:

Sources: [docs/getting-started/first-steps-with-celery.rst:105-113](repo://docs/getting-started/first-steps-with-celery.rst#L105-L113)

```bash
pip install celery
```

Sources: [docs/getting-started/first-steps-with-celery.rst:108-113](repo://docs/getting-started/first-steps-with-celery.rst#L108-L113)

Start a local RabbitMQ service before starting the worker. The tutorial includes this Docker invocation, which exposes the broker's port for the local application:

Sources: [docs/getting-started/first-steps-with-celery.rst:57-71](repo://docs/getting-started/first-steps-with-celery.rst#L57-L71)

```bash
docker run -d -p 5672:5672 rabbitmq
```

Sources: [docs/getting-started/first-steps-with-celery.rst:64-71](repo://docs/getting-started/first-steps-with-celery.rst#L64-L71)

## Create the task module

Create `tasks.py` with the tutorial's minimal application. The first argument supplies the application's main-module name; the broker argument selects the transport endpoint. Decorating `add` registers a task whose body returns the sum. [[Applications and Configuration]] explains generated task names, lazy registration and how this expands into multiple modules.

Sources: [docs/getting-started/first-steps-with-celery.rst:127-150](repo://docs/getting-started/first-steps-with-celery.rst#L127-L150), [celery/app/base.py:604-630](repo://celery/app/base.py#L604-L630)

```python
from celery import Celery

app = Celery('tasks', broker='pyamqp://guest@localhost//')

@app.task
def add(x, y):
    return x + y
```

Sources: [docs/getting-started/first-steps-with-celery.rst:129-137](repo://docs/getting-started/first-steps-with-celery.rst#L129-L137)

To retrieve the return value in this exercise, replace the application construction line with the tutorial's RPC-enabled version below. Configure the same application in the worker and client. If either process has already imported the old module, restart it so both use the new backend configuration. [[Result Backend Catalogue]] explains why backend capabilities matter when moving beyond a single task.

Sources: [docs/getting-started/first-steps-with-celery.rst:229-250](repo://docs/getting-started/first-steps-with-celery.rst#L229-L250)

```python
app = Celery('tasks', backend='rpc://', broker='pyamqp://')
```

Sources: [docs/getting-started/first-steps-with-celery.rst:229-237](repo://docs/getting-started/first-steps-with-celery.rst#L229-L237)

## Start the worker

Run the command from a directory where Python can import `tasks`. `-A` selects the application and belongs before the `worker` subcommand. The CLI resolves the supplied application string with `find_app` and reports module-import, missing-attribute and other initialization failures separately. Keep this terminal open to see task receipt and completion; [[Worker Lifecycle and Concurrency]] follows the startup process beyond the CLI.

Sources: [celery/bin/celery.py:135-155](repo://celery/bin/celery.py#L135-L155), [celery/bin/celery.py:193-213](repo://celery/bin/celery.py#L193-L213), [docs/getting-started/first-steps-with-celery.rst:154-178](repo://docs/getting-started/first-steps-with-celery.rst#L154-L178)

```bash
celery -A tasks worker --loglevel=INFO
```

Sources: [docs/getting-started/first-steps-with-celery.rst:157-162](repo://docs/getting-started/first-steps-with-celery.rst#L157-L162)

## Submit and retrieve work

Open a second Python process using the same environment and importable module. Keep the handle returned by `delay`; it identifies the asynchronous invocation. `delay` forwards positional and keyword arguments to `apply_async`, while execution options belong on `apply_async` itself. [[Task Publishing and Routing]] explains that invocation boundary and how queues are selected.

Sources: [celery/app/task.py:523-538](repo://celery/app/task.py#L523-L538), [docs/getting-started/first-steps-with-celery.rst:248-255](repo://docs/getting-started/first-steps-with-celery.rst#L248-L255)

```python
from tasks import add
result = add.delay(4, 4)
```

Sources: [docs/getting-started/first-steps-with-celery.rst:252-255](repo://docs/getting-started/first-steps-with-celery.rst#L252-L255)

The tutorial's result wait returns `8` when the task completes within the timeout. The timeout limits this client's wait; it does not terminate the running task. Failed tasks re-raise their stored exception by default. [[Results and State]] explains nonblocking state inspection, propagation control and forgetting results, including the requirement to eventually retrieve or forget returned result handles.

Sources: [docs/getting-started/first-steps-with-celery.rst:257-295](repo://docs/getting-started/first-steps-with-celery.rst#L257-L295), [celery/result.py:209-241](repo://celery/result.py#L209-L241)

```pycon
>>> result.get(timeout=1)
8
```

Sources: [docs/getting-started/first-steps-with-celery.rst:268-271](repo://docs/getting-started/first-steps-with-celery.rst#L268-L271)

## Diagnose the first failure

If startup cannot load the application, inspect the CLI's import error before changing broker settings: the application must resolve before the command receives its context. If a task reaches the worker under an unknown name, the consumer rejects it and records `NotRegistered`; ensure that worker task modules are imported. The repository's larger example demonstrates an explicit `include=['proj.tasks']` alongside its application configuration.

Sources: [celery/bin/celery.py:135-155](repo://celery/bin/celery.py#L135-L155), [celery/worker/consumer/consumer.py:677-708](repo://celery/worker/consumer/consumer.py#L677-L708), [examples/next-steps/proj/celery.py:1-11](repo://examples/next-steps/proj/celery.py#L1-L11)

A result wait requires the configured backend even when the worker visibly executes the function. The initial application intentionally has no backend, and the tutorial enables one separately. Also keep blocking result waits in the calling process: `AsyncResult.get` guards against synchronous subtask waits by default because waiting inside a task can deadlock. [[Task Execution and Retries]] covers worker-side failures once application loading and delivery work.

Sources: [docs/getting-started/first-steps-with-celery.rst:205-237](repo://docs/getting-started/first-steps-with-celery.rst#L205-L237), [celery/result.py:191-207](repo://celery/result.py#L191-L207), [celery/result.py:243-247](repo://celery/result.py#L243-L247)
