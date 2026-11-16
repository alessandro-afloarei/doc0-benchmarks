---
title: "Quickstart"
---
## Overview

This page takes a project from nothing to a task that runs on a worker and returns a result, then adds a periodic task. It follows the example projects in the repository: `examples/tutorial`, a single module, and `examples/next-steps`, a package with a separate app module. What each object does internally is left to [[The Celery Application]] and the command options to [[Command Line Interface]].

Sources: [examples/tutorial/tasks.py:1-12](repo://examples/tutorial/tasks.py#L1-L12), [examples/next-steps/proj/celery.py:1-14](repo://examples/next-steps/proj/celery.py#L1-L14)

## Install

Celery needs Python 3.10 or newer. Install it from PyPI, adding the bundles for the broker, result backend and serializers you plan to use; each bundle name maps to a requirements file in `requirements/extras/`.

Sources: [setup.py:10-47](repo://setup.py#L10-L47), [setup.py:151-153](repo://setup.py#L151-L153)

```bash
pip install -U celery
pip install "celery[redis]"
pip install "celery[redis,auth,msgpack]"
```

Sources: [README.rst:301-332](repo://README.rst#L301-L332)

Celery does not ship a broker. Run RabbitMQ (what the default `amqp://` URL points to) or Redis locally; the repository's own development compose file uses the `rabbitmq:management` and `redis:latest` images, and `docker run -d -p 5672:5672 rabbitmq` is enough for this page.

Sources: [docker/docker-compose.yml:27-31](repo://docker/docker-compose.yml#L27-L31)

## Define an app and a task

The smallest app names its main module and its broker, then decorates a function with `@app.task`. The first argument to `Celery` is used to build task names when the module runs as `__main__`, so a task defined here is registered as `tasks.add`. `app.start()` runs the `celery` command with this app, so `python tasks.py worker` works too.

Sources: [examples/tutorial/tasks.py:1-12](repo://examples/tutorial/tasks.py#L1-L12), [celery/app/base.py:480-497](repo://celery/app/base.py#L480-L497)

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

A real project keeps the app in its own module and lists the task modules in `include`, so the worker imports them at start-up. `backend='rpc://'` sends results back over the broker so callers can fetch them, and `result_expires` removes stored results after an hour. [[Configuration and Loaders]] lists the other ways to load settings.

Sources: [examples/next-steps/proj/celery.py:1-14](repo://examples/next-steps/proj/celery.py#L1-L14)

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

The task module imports the app and decorates its functions. [[Defining Tasks]] explains the options the decorator accepts, such as `bind=True`, `autoretry_for` and `rate_limit`.

Sources: [examples/next-steps/proj/tasks.py:1-16](repo://examples/next-steps/proj/tasks.py#L1-L16)

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

Sources: [examples/next-steps/proj/tasks.py:1-16](repo://examples/next-steps/proj/tasks.py#L1-L16)

## Start a worker

Run the worker from the directory that contains the `proj` package. `-A` names the module holding the app (or `module:attribute`), `-l` the log level, `-c` the number of concurrent processes, and `-P` the pool type. The worker prints a banner with its broker, result backend, concurrency and registered tasks, then waits for messages; [[Worker Startup and Shutdown]] follows what happens in between, and [[Execution Pools]] helps choose `-P`.

Sources: [celery/bin/worker.py:136-206](repo://celery/bin/worker.py#L136-L206)

```bash
celery -A proj worker -l INFO
celery -A proj worker -l INFO -c 4 -P prefork
```

Sources: [celery/bin/worker.py:136-206](repo://celery/bin/worker.py#L136-L206)

## Call the task and read the result

From a Python shell in the same directory, `delay` sends a message and returns at once with an `AsyncResult`. `ready` reports whether the task has finished, and `get` blocks until the worker stores the result; `timeout` bounds the wait.

Sources: [celery/app/task.py:523-535](repo://celery/app/task.py#L523-L535), [celery/result.py:191-260](repo://celery/result.py#L191-L260), [celery/result.py:369-378](repo://celery/result.py#L369-L378)

```python
>>> from proj.tasks import add
>>> result = add.delay(4, 4)
>>> result.ready()
True
>>> result.get(timeout=10)
8
```

Sources: [celery/result.py:191-260](repo://celery/result.py#L191-L260)

`apply_async` takes the arguments as a tuple and a dict, plus execution options such as `countdown`, `eta`, `expires` and `queue`, described on [[Calling Tasks and the Message Protocol]]. Tasks also combine into workflows with `chain` and `group`, which [[Signatures and Canvas Primitives]] covers.

Sources: [celery/app/task.py:536-560](repo://celery/app/task.py#L536-L560)

```python
>>> from celery import chain, group
>>> from proj.tasks import add, mul
>>> chain(add.s(2, 2), mul.s(8))().get()
32
>>> group(add.s(i, i) for i in range(5))().get()
[0, 2, 4, 6, 8]
```

Sources: [examples/next-steps/proj/tasks.py:4-11](repo://examples/next-steps/proj/tasks.py#L4-L11)

## Run a periodic task

Beat is a separate process that sends tasks on a schedule. The periodic-tasks example registers an entry from an `on_after_configure` handler; `add_periodic_task` queues the entry until configuration is loaded and then adds it to `beat_schedule`.

Sources: [celery/app/base.py:1295-1310](repo://celery/app/base.py#L1295-L1310)

```python
@app.task
def say(what):
    print(what)


@app.on_after_configure.connect
def setup_periodic_tasks(sender, **kwargs):
    # Calls say('hello') every 10 seconds.
    sender.add_periodic_task(10.0, say.s('hello'), name='add every 10')
```

Sources: [examples/periodic-tasks/myapp.py:45-53](repo://examples/periodic-tasks/myapp.py#L45-L53)

Run the worker and beat side by side. During development, `worker -B` embeds beat in the worker instead; [[Periodic Tasks with Beat]] explains the scheduler and [[Schedules: Intervals, Crontab and Solar]] the crontab syntax.

Sources: [examples/periodic-tasks/myapp.py:1-27](repo://examples/periodic-tasks/myapp.py#L1-L27), [celery/bin/worker.py:289-296](repo://celery/bin/worker.py#L289-L296)

```bash
celery -A myapp worker -l INFO
celery -A myapp beat -l INFO
```

Sources: [examples/periodic-tasks/myapp.py:1-12](repo://examples/periodic-tasks/myapp.py#L1-L12)

## Where to go next

Before running in production, read [[Worker Startup and Shutdown]] for shutdown behaviour, [[Running Workers in Production]] for `celery multi` and the Helm chart, and [[Message Signing and Serialization Security]] before enabling the `pickle` serializer. [[Testing Celery Applications]] shows how to test tasks without a broker, using the pytest plugin in `celery.contrib.pytest`.

Sources: [celery/contrib/pytest.py:1-40](repo://celery/contrib/pytest.py#L1-L40)
