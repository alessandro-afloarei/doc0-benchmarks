---
title: "Quickstart"
---
## Overview

This page takes the two small projects in `examples/` from nothing to a returned result: define an app with a broker and a result backend, declare tasks, start a worker with the `celery` command, call a task and read its value. Each step names the page that explains what happens underneath; [[Celery Overview]] shows how the steps connect.

Sources: [examples/app/myapp.py:1-45](repo://examples/app/myapp.py#L1-L45), [examples/next-steps/proj/celery.py:1-14](repo://examples/next-steps/proj/celery.py#L1-L14)

## Install

The package installs a single console script, `celery`, that points at `celery.__main__:main`. Optional dependencies (brokers, result backends, pools, serializers) are extras, one per file in `requirements/extras`, so `pip install "celery[redis]"` pulls the Redis client. The package requires Python 3.10 or newer.

Sources: [setup.py:12-24](repo://setup.py#L12-L24), [setup.py:123-159](repo://setup.py#L123-L159)

## Define an app and tasks

The smallest app passes its name, a broker URL and any setting as keyword arguments, then decorates functions with `@app.task`. The first argument, `'myapp'`, becomes the prefix of generated task names when the module runs as `__main__`. `task_acks_late=True` is an ordinary setting passed as a keyword: the constructor stores it with the other settings ([[Configuration]]).

Sources: [examples/app/myapp.py:29-41](repo://examples/app/myapp.py#L29-L41), [celery/app/base.py:395-401](repo://celery/app/base.py#L395-L401)

```python
from time import sleep

from celery import Celery

app = Celery(
    'myapp',
    broker='amqp://guest@localhost//',
    # ## add result backend here if needed.
    # backend='rpc'
    task_acks_late=True
)


@app.task
def add(x, y):
    sleep(10)
    return x + y


if __name__ == '__main__':
    app.start()
```

Sources: [examples/app/myapp.py:25-45](repo://examples/app/myapp.py#L25-L45)

A project with several modules keeps the app in its own module and lists the task modules in `include`, so the worker imports them at start. This app also sets the `rpc://` result backend, which sends results back to the caller as messages, and updates one more setting through `app.conf.update`.

Sources: [examples/next-steps/proj/celery.py:3-11](repo://examples/next-steps/proj/celery.py#L3-L11)

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

The task module imports the app and decorates plain functions. [[Defining Tasks]] lists the options the decorator accepts.

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

## Start a worker

Run the worker with the global `-A`/`--app` option before the subcommand. `-A proj` imports `proj` and looks for an attribute named `app`, then one named `celery`, then a `proj.celery` submodule, and finally any `Celery` instance in the module; `-A myapp:app` names the attribute directly.

Sources: [celery/app/utils.py:378-415](repo://celery/app/utils.py#L378-L415)

```bash
celery -A proj worker -l INFO
```

Sources: [celery/bin/celery.py:54-66](repo://celery/bin/celery.py#L54-L66)

A module that calls `app.start()` under `__main__` can also be run directly, as in `python myapp.py worker -l INFO`: `start` makes the app the default of the `-A` option and runs the same click command group.

Sources: [examples/app/myapp.py:3-16](repo://examples/app/myapp.py#L3-L16), [celery/app/base.py:480-497](repo://celery/app/base.py#L480-L497)

The worker command's most used options:

Sources: [celery/bin/worker.py:162-168](repo://celery/bin/worker.py#L162-L168)

| Option | Default | Effect |
| --- | --- | --- |
| `-l`, `--loglevel` | `WARNING` | Log level of the worker |
| `-c`, `--concurrency` | `worker_concurrency` (CPU count) | Number of pool workers |
| `-P`, `--pool` | `prefork` | Pool implementation ([[Execution Pools]]) |
| `-Q`, `--queues` | all configured queues | Queues to consume from |
| `-E`, `--task-events` | off | Send task events for monitors ([[Events and Monitoring]]) |
| `-B`, `--beat` | off | Run the periodic scheduler inside the worker ([[Periodic Tasks with Beat]]) |

Sources: [celery/bin/worker.py:194-219](repo://celery/bin/worker.py#L194-L219), [celery/bin/worker.py:253-294](repo://celery/bin/worker.py#L253-L294)

Before the click command is even loaded, `celery.__main__.main` looks for `-P eventlet` or `-P gevent` in `sys.argv` and applies their monkey patches, because those libraries must patch the standard library before anything else is imported.

Sources: [celery/__main__.py:10-15](repo://celery/__main__.py#L10-L15), [celery/__init__.py:121-147](repo://celery/__init__.py#L121-L147)

## Call a task and get the result

From another Python process, `delay` sends the message and returns an `AsyncResult`; `get()` waits for the worker to store the return value in the result backend.

Sources: [celery/app/task.py:523-534](repo://celery/app/task.py#L523-L534)

```python
>>> from myapp import add
>>> add.delay(16, 16).get()
32
```

Sources: [examples/app/myapp.py:7-10](repo://examples/app/myapp.py#L7-L10)

The same can be done from a shell. `celery call` sends a task by name with JSON arguments through `app.send_task` and prints the new task id; `celery result` builds an `AsyncResult` for an id and prints `get()`, or the traceback with `--traceback`. [[Command Line Interface]] covers the other subcommands, and [[Task Results and States]] explains what `get()` waits on.

Sources: [celery/bin/call.py:56-71](repo://celery/bin/call.py#L56-L71), [celery/bin/result.py:21-30](repo://celery/bin/result.py#L21-L30)

```bash
celery -A proj call proj.tasks.add --args='[2, 2]'
celery -A proj result <task-id>
```

Sources: [celery/bin/call.py:8-58](repo://celery/bin/call.py#L8-L58), [celery/bin/result.py:7-21](repo://celery/bin/result.py#L7-L21)
