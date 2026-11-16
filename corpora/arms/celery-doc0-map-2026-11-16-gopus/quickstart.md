---
title: "Quickstart"
---
## Overview

This page takes you from an empty module to a task that runs on a worker and returns a result. It uses the two example projects shipped in `examples/`: the one-file tutorial and the `next-steps` package. Each step names the page that explains what happens underneath, starting with [[Celery Overview]] for the overall flow.

Sources: [examples/tutorial/tasks.py:1-12](repo://examples/tutorial/tasks.py#L1-L12), [examples/next-steps/proj/celery.py:1-14](repo://examples/next-steps/proj/celery.py#L1-L14)

## Install

Celery is installed from PyPI and needs Python 3.10 or newer. Its required dependencies are `billiard` (the process pool), `kombu` (messaging), `vine`, `click` with its plugins, `python-dateutil` and `tzlocal`.

Sources: [setup.py:151-159](repo://setup.py#L151-L159), [requirements/default.txt:1-10](repo://requirements/default.txt#L1-L10)

```bash
pip install celery
# with the Redis broker/backend client
pip install "celery[redis]"
```

Sources: [setup.py:12-40](repo://setup.py#L12-L40)

Optional integrations are installed as extras named after the files in `requirements/extras/`: for example `redis`, `mongodb`, `dynamodb`, `s3`, `gevent`, `eventlet`, `auth` (message signing), `pydantic` and `pytest`. The installed package provides the `celery` console script, which points at `celery.__main__:main`.

Sources: [setup.py:12-40](repo://setup.py#L12-L40), [setup.py:120-126](repo://setup.py#L120-L126), [setup.py:155-159](repo://setup.py#L155-L159)

## Define an app and a task

The smallest Celery program creates an app with a name and a broker URL, and decorates a function with `@app.task`:

Sources: [examples/tutorial/tasks.py:1-8](repo://examples/tutorial/tasks.py#L1-L8)

```python
from celery import Celery

app = Celery('tasks', broker='amqp://')


@app.task()
def add(x, y):
    return x + y


if __name__ == '__main__':
    app.start()
```

Sources: [examples/tutorial/tasks.py:1-12](repo://examples/tutorial/tasks.py#L1-L12)

The first argument, `'tasks'`, is the main module name; Celery uses it as the prefix for automatically generated task names, so this task is registered as `tasks.add`. `broker='amqp://'` points at a local RabbitMQ; any Kombu transport URL works. What the constructor stores and when it actually reads the configuration is covered in [[The Celery Application]], and how the decorator turns `add` into a `Task` class in [[Defining Tasks]].

Sources: [celery/app/base.py:252-260](repo://celery/app/base.py#L252-L260), [celery/app/base.py:385-392](repo://celery/app/base.py#L385-L392)

## Structure a project

A real project keeps the app in its own module and lists the task modules the worker must import. The `next-steps` example does this:

Sources: [examples/next-steps/proj/celery.py:3-6](repo://examples/next-steps/proj/celery.py#L3-L6)

```python
from celery import Celery

app = Celery('proj',
             broker='amqp://',
             backend='rpc://',
             include=['proj.tasks'])

# Optional configuration, see the application user guide.
app.conf.update(
    result_expires=3600,
)

if __name__ == '__main__':
    app.start()
```

Sources: [examples/next-steps/proj/celery.py:1-14](repo://examples/next-steps/proj/celery.py#L1-L14)

`backend='rpc://'` enables results, sent back to the caller as messages ([[Result Backend Catalogue]]). `include` names modules every worker imports at startup, and `app.conf.update` sets any further setting; other ways to load configuration are in [[Configuration and Loaders]]. The task module imports the app and declares its tasks against it:

Sources: [examples/next-steps/proj/celery.py:3-11](repo://examples/next-steps/proj/celery.py#L3-L11), [examples/next-steps/proj/tasks.py:1-1](repo://examples/next-steps/proj/tasks.py#L1-L1)

```python
from .celery import app


@app.task
def add(x, y):
    return x + y


@app.task
def mul(x, y):
    return x * y


@app.task
def xsum(numbers):
    return sum(numbers)
```

Sources: [examples/next-steps/proj/tasks.py:1-16](repo://examples/next-steps/proj/tasks.py#L1-L16), [celery/app/base.py:385-392](repo://celery/app/base.py#L385-L392)

## Start a worker

Run the worker with `-A` pointing at the app's module:

Sources: [celery/bin/celery.py:57-65](repo://celery/bin/celery.py#L57-L65)

```bash
celery -A proj worker -l INFO
```

Sources: [celery/bin/celery.py:57-75](repo://celery/bin/celery.py#L57-L75), [celery/bin/worker.py:162-168](repo://celery/bin/worker.py#L162-L168)

`-A`/`--app` is a global option of the `celery` command and can also come from the `APP` environment variable; `-b`/`--broker` and `--result-backend` override the URLs in the same way. `worker` then takes its own options. The ones you reach for first:

Sources: [celery/bin/celery.py:57-75](repo://celery/bin/celery.py#L57-L75)

| Option | Meaning |
| --- | --- |
| `-l`, `--loglevel` | Logging level, default `WARNING` |
| `-c`, `--concurrency` | Number of pool workers, default `worker_concurrency` |
| `-P`, `--pool` | Pool implementation, default `prefork` |
| `-Q`, `--queues` | Comma-separated queues to consume from |
| `-E`, `--task-events` | Send task events for monitors |
| `-B`, `--beat` | Run the periodic task scheduler inside this worker |
| `-D`, `--detach` | Start as a background process |

Sources: [celery/bin/worker.py:136-215](repo://celery/bin/worker.py#L136-L215), [celery/bin/worker.py:254-294](repo://celery/bin/worker.py#L254-L294)

The full set is described in [[Command Line Interface]], what the worker does with them while starting in [[Worker Startup and Bootsteps]], and the pool choices in [[Concurrency Pools]].

Sources: [celery/bin/worker.py:205-211](repo://celery/bin/worker.py#L205-L211)

## Call the task

From any Python process that imports the app, call the task through the message queue rather than directly:

Sources: [celery/app/task.py:523-535](repo://celery/app/task.py#L523-L535)

```python
from proj.tasks import add

result = add.delay(4, 4)
result.get(timeout=10)   # 8
```

Sources: [celery/app/task.py:523-535](repo://celery/app/task.py#L523-L535), [celery/result.py:191-215](repo://celery/result.py#L191-L215)

`delay(*args, **kwargs)` is shorthand for `apply_async(args, kwargs)`, which also accepts execution options such as `countdown`, `eta`, `expires` and `queue` ([[Sending Tasks]]). Both return an `AsyncResult`. `get(timeout=...)` waits until the task is ready and re-raises the task's exception when `propagate` is true; the timeout applies to the waiting client only, and the docstring stresses that "the task isn't terminated even if timeout occurs". It also warns that every `AsyncResult` should eventually see `get()` or `forget()` so the backend can release what it holds ([[Task States and AsyncResult]]).

Sources: [celery/app/task.py:523-560](repo://celery/app/task.py#L523-L560), [celery/result.py:191-215](repo://celery/result.py#L191-L215)

> [!WARNING]
> Calling `get()` inside another task can deadlock the worker. Celery refuses it by default: `get` takes `disable_sync_subtasks=True`, as described in [[Task States and AsyncResult]].

Sources: [celery/result.py:191-200](repo://celery/result.py#L191-L200)

## Run tasks without a worker

For tests, setting `task_always_eager` makes `apply_async` run the task in the calling process instead of sending a message. The arguments are still serialized and deserialized with the configured serializer, so a task that would fail to serialize in production fails the same way here. [[Testing Utilities]] covers this and the pytest fixtures that start a real in-process worker.

Sources: [celery/app/task.py:682-702](repo://celery/app/task.py#L682-L702)
