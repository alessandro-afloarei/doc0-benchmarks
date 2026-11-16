---
title: "Quickstart"
---
## Overview

This page takes one small project from nothing to a returned result: install Celery, define an app and a task, start a worker, call the task and read its value. It follows the examples that ship in the repository, `examples/tutorial/tasks.py` and the `examples/next-steps/proj` package, and links to the pages that explain each step in depth. Celery needs Python 3.10 or newer. The `celery` console script is installed by the package and points at `celery.__main__:main`.

Sources: [setup.py:150-159](repo://setup.py#L150-L159)

## Install

Install the package together with the extras for the broker and result backend you use. Each extra name in `EXTENSIONS` corresponds to a file in `requirements/extras/` (for example `redis`, `sqlalchemy`, `msgpack`, `eventlet`).

Sources: [setup.py:12-47](repo://setup.py#L12-L47), [setup.py:113-125](repo://setup.py#L113-L125)

```bash
pip install "celery[redis]"
```

Sources: [setup.py:12-47](repo://setup.py#L12-L47), [setup.py:113-125](repo://setup.py#L113-L125)

The core dependencies are `billiard` (the multiprocessing fork used by the prefork pool), `kombu` (the messaging library), `vine` (promises), `click` and its plugins (the command line), `python-dateutil` and `tzlocal`.

Sources: [requirements/default.txt:1-10](repo://requirements/default.txt#L1-L10)

## Define an app and a task

The smallest app is a module that creates a `Celery` instance with a broker URL and decorates a function with `@app.task`. Calling `app.start()` under `__main__` lets the module itself act as the `celery` command.

Sources: [celery/app/base.py:480-497](repo://celery/app/base.py#L480-L497)

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

The first argument is the main module name, used as the prefix of generated task names, so this task is registered as `tasks.add`. The decorator does not build the task immediately; how it does so later is covered in [[The Celery Application]], and the options the decorator accepts are on [[Defining Tasks]].

Sources: [celery/app/base.py:252-258](repo://celery/app/base.py#L252-L258), [celery/app/base.py:590-633](repo://celery/app/base.py#L590-L633)

## Add a result backend and configuration

To read return values, the app needs a result backend. The `next-steps` example puts the app in its own module, passes `backend='rpc://'`, lists the task modules the worker must import in `include`, and changes a setting through `app.conf.update`.

Sources: [examples/next-steps/proj/celery.py:1-11](repo://examples/next-steps/proj/celery.py#L1-L11)

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
```

Sources: [examples/next-steps/proj/celery.py:1-11](repo://examples/next-steps/proj/celery.py#L1-L11)

The tasks live in a separate module that imports the app:

Sources: [examples/next-steps/proj/tasks.py:1-11](repo://examples/next-steps/proj/tasks.py#L1-L11)

```python
from .celery import app


@app.task
def add(x, y):
    return x + y


@app.task
def mul(x, y):
    return x * y
```

Sources: [examples/next-steps/proj/tasks.py:1-11](repo://examples/next-steps/proj/tasks.py#L1-L11)

The `broker`, `backend` and `include` arguments are stored as the `broker_url`, `result_backend` and `include` settings; [[Configuration and Loaders]] explains how they merge with the rest of the configuration, and [[Result Backend Interface]] lists the backend URL schemes.

Sources: [celery/app/base.py:385-393](repo://celery/app/base.py#L385-L393)

## Start a worker

Run the worker from the directory that contains the package, naming the app with `-A`:

Sources: [celery/bin/celery.py:56-66](repo://celery/bin/celery.py#L56-L66)

```bash
celery -A proj worker -l INFO
```

Sources: [examples/app/myapp.py:1-24](repo://examples/app/myapp.py#L1-L24)

`-A` (or the `APP` environment variable) is resolved by `find_app`. A value with a colon such as `proj.celery:app` names the attribute directly. A bare module name is imported and searched for an attribute named `app`, then `celery`; if the module is a package, `proj.celery` is tried; finally any `Celery` instance in the module is used.

Sources: [celery/bin/celery.py:56-66](repo://celery/bin/celery.py#L56-L66), [celery/bin/celery.py:136-152](repo://celery/bin/celery.py#L136-L152), [celery/app/utils.py:378-415](repo://celery/app/utils.py#L378-L415)

What the worker does on start is described on [[Worker Startup and Bootsteps]]; the full list of subcommands is on [[Command-Line Interface]].

Sources: [celery/__main__.py:10-15](repo://celery/__main__.py#L10-L15)

## Call the task and read the result

In another shell, import the task and call `delay`, which is `apply_async(args, kwargs)` without extra options. It returns an `AsyncResult` at once; `get()` waits for the worker to finish and returns the value.

Sources: [celery/app/task.py:523-534](repo://celery/app/task.py#L523-L534)

```python
>>> from proj.tasks import add
>>> result = add.delay(16, 16)
>>> result.get(timeout=10)
32
```

Sources: [celery/app/task.py:523-534](repo://celery/app/task.py#L523-L534), [celery/result.py:191-269](repo://celery/result.py#L191-L269)

`get()` re-raises the task's exception when it failed (unless `propagate=False`), returns `None` immediately for a task with `ignore_result=True`, and refuses to block when called from inside another task. Use `apply_async` instead of `delay` to pass options such as `countdown`, `queue` or `expires`; see [[Calling Tasks and the Message Protocol]]. Results are covered on [[Results and AsyncResult]]; to compose tasks into workflows see [[Signatures]], and to run them on a schedule see [[Periodic Tasks with Beat]].

Sources: [celery/result.py:245-259](repo://celery/result.py#L245-L259)

> [!WARNING]
> The docstring of `AsyncResult.get` notes that backends use resources to store and transmit results, so every `AsyncResult` returned from a call should eventually be read with `get()` or released with `forget()`.

Sources: [celery/result.py:202-207](repo://celery/result.py#L202-L207)
