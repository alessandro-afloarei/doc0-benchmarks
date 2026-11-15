---
title: "Quickstart"
---
## Overview

This page takes one task from definition to result: create an application, declare a task, start a worker, call the task and read its return value. It uses the examples shipped in the repository's `examples/` folder; each step links to the page that explains what happens underneath.

Sources: [examples/tutorial/tasks.py:1-12](repo://examples/tutorial/tasks.py#L1-L12), [examples/next-steps/proj/celery.py:1-14](repo://examples/next-steps/proj/celery.py#L1-L14)

## Install

Celery is installed from PyPI with the `celery` console script pointing at `celery.__main__:main`. Brokers, backends and pools that need extra libraries are optional extras named after them (`redis`, `sqlalchemy`, `eventlet`, `gevent`, `auth` and others), each read from `requirements/extras/<name>.txt`.

Sources: [setup.py:12-42](repo://setup.py#L12-L42), [setup.py:113-125](repo://setup.py#L113-L125), [setup.py:156-158](repo://setup.py#L156-L158)

```bash
pip install celery            # RabbitMQ (amqp://) works with the default requirements
pip install "celery[redis]"   # adds the Redis transport and result backend
```

Sources: [setup.py:12-42](repo://setup.py#L12-L42)

## Create an app and a task

The smallest application is a module that creates a `Celery` instance and decorates a function with `@app.task`. The first argument, `'tasks'`, is the main module name and becomes the prefix of generated task names, so this task is registered as `tasks.add`.

Sources: [examples/tutorial/tasks.py:1-8](repo://examples/tutorial/tasks.py#L1-L8), [celery/app/base.py:343-347](repo://celery/app/base.py#L343-L347)

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

The tutorial app only sends tasks. To read return values, give the app a result backend as well, for example `backend='rpc://'`, which sends results back as AMQP messages. A larger project keeps the app in its own module, lists the task modules in `include` so every worker imports them, and adjusts settings through `app.conf.update`. [[The Celery Application]] describes the constructor and [[Configuration and Loaders]] the settings.

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

Sources: [examples/next-steps/proj/celery.py:1-14](repo://examples/next-steps/proj/celery.py#L1-L14), [examples/next-steps/proj/tasks.py:1-16](repo://examples/next-steps/proj/tasks.py#L1-L16)

The backend string is a URL whose scheme picks the backend class from `BACKEND_ALIASES`: `rpc`, `redis`, `db`, `cache`, `mongodb`, `s3` and others. [[Result Backends]] compares them.

Sources: [celery/app/backends.py:15-40](repo://celery/app/backends.py#L15-L40)

## Start a worker

Run the worker from the folder that contains the module, naming the app with `-A`:

Sources: [celery/bin/celery.py:55-66](repo://celery/bin/celery.py#L55-L66)

```bash
celery -A tasks worker --loglevel=INFO
```

Sources: [examples/app/myapp.py:13-34](repo://examples/app/myapp.py#L13-L34)

`-A` accepts a module or `module:attribute`. Given a bare module, `find_app` looks for an attribute named `app`, then one named `celery`, then a `celery` submodule of a package, and finally any `Celery` instance in the module. The worker's main options are `-l/--loglevel` (default `WARNING`), `-c/--concurrency` (defaults to the `worker_concurrency` setting, which falls back to the CPU count) and `-P/--pool` (default `prefork`). Running the module directly works too, because `app.start()` runs the `celery` command with that app as the default: `python tasks.py worker -l INFO`. What the worker does when it starts is the subject of [[Worker Startup and Bootsteps]], and [[Command-Line Interface]] lists the options of every subcommand.

Sources: [celery/app/utils.py:378-415](repo://celery/app/utils.py#L378-L415), [celery/bin/worker.py:162-211](repo://celery/bin/worker.py#L162-L211), [celery/app/base.py:480-497](repo://celery/app/base.py#L480-L497)

## Call the task

From another shell, import the task and call `delay`. It is the star-argument form of `apply_async` and returns an `AsyncResult` right away, while the task waits in the broker for a worker.

Sources: [celery/app/task.py:523-534](repo://celery/app/task.py#L523-L534)

```python
>>> from tasks import add
>>> result = add.delay(4, 4)
>>> result.ready()
True
>>> result.get(timeout=10)
8
```

Sources: [celery/app/task.py:523-534](repo://celery/app/task.py#L523-L534), [celery/result.py:369-375](repo://celery/result.py#L369-L375)

`apply_async` takes the options `delay` cannot: `countdown`, `eta`, `expires`, `queue`, `priority`, links and more; [[Defining Tasks]] lists them and [[Sending Tasks and Routing]] follows the message to the broker.

Sources: [celery/app/task.py:536-540](repo://celery/app/task.py#L536-L540)

## Read the result

`AsyncResult.get` waits until the task is ready and returns its value. With `propagate=True` (the default) an exception raised by the task is raised again in the caller; `timeout` raises `celery.exceptions.TimeoutError` if no result arrives in time, without stopping the task. A result whose task was sent with `ignore_result=True` returns `None` immediately. Calling `get` inside another task raises an error by default, because waiting for a subtask can deadlock the worker.

Sources: [celery/result.py:191-258](repo://celery/result.py#L191-L258)

`ready()` reports whether the state is one of the backend's ready states, and `successful()` and `failed()` compare it with `SUCCESS` and `FAILURE`. [[Task Results]] covers the result API and the states.

Sources: [celery/result.py:369-383](repo://celery/result.py#L369-L383)
