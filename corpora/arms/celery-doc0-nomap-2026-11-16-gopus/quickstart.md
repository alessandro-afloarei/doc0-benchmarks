---
title: "Quickstart"
---
## Overview

This page takes one task from definition to result: install the package, write an app module with a task, start a worker with the `celery` command, call the task and read the return value. Each step points to the page that explains what happens underneath; the overall flow is in [[Celery Overview]].

Sources: [examples/app/myapp.py:1-45](repo://examples/app/myapp.py#L1-L45)

## Install

The distribution installs a single console script, `celery`, pointing at `celery.__main__:main`, and declares `python_requires=">=3.10"`. Its required dependencies are billiard (the multiprocessing fork used by the prefork pool), Kombu (messaging), vine (promises), click with its plugins (the CLI), python-dateutil and tzlocal.

Sources: [setup.py:151-159](repo://setup.py#L151-L159), [requirements/default.txt:1-10](repo://requirements/default.txt#L1-L10)

```bash
pip install -U celery
```

Sources: [README.rst:301-312](repo://README.rst#L301-L312)

Optional features are extras, one per file in `requirements/extras/`: `setup.py` builds `extras_require` from the `EXTENSIONS` tuple, so `celery[redis]` pulls in `requirements/extras/redis.txt`. Extras exist for result backends (`redis`, `mongodb`, `dynamodb`, `s3`, `sqlalchemy` …), pools (`eventlet`, `gevent`), serializers (`msgpack`, `yaml`), message signing (`auth`), transports (`sqs`, `gcpubsub`, `librabbitmq`) and tooling (`pytest`, `pydantic`, `django`).

Sources: [setup.py:12-47](repo://setup.py#L12-L47), [setup.py:115-125](repo://setup.py#L115-L125)

```bash
pip install "celery[redis]"
```

Sources: [README.rst:325-331](repo://README.rst#L325-L331)

## Define an app and a task

A Celery app needs a name (used as the prefix for generated task names) and a broker URL. The tutorial example connects to a local RabbitMQ with `amqp://` and registers one task with `@app.task`:

Sources: [examples/tutorial/tasks.py:1-12](repo://examples/tutorial/tasks.py#L1-L12)

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

To read results you also need a result backend. The `next-steps` project passes `backend='rpc://'`, lists its task modules in `include` so every worker imports them, and sets a configuration value with `app.conf.update`. The constructor stores `broker`, `backend` and `include` as configuration, which [[The Celery Application]] and [[Configuration and Loaders]] explain.

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

The tasks module imports that app and decorates plain functions. The decorator's options (binding, retries, rate limits, serializers) are covered in [[Defining Tasks]].

Sources: [examples/next-steps/proj/tasks.py:1-12](repo://examples/next-steps/proj/tasks.py#L1-L12)

```python
from .celery import app


@app.task
def add(x, y):
    return x + y


@app.task
def mul(x, y):
    return x * y
```

Sources: [examples/next-steps/proj/tasks.py:1-12](repo://examples/next-steps/proj/tasks.py#L1-L12)

## Start a worker

Run the worker from the directory that contains the module. `-A` names the module to search for an app instance, or an explicit `module:attribute`:

Sources: [examples/app/myapp.py:13-22](repo://examples/app/myapp.py#L13-L22)

```bash
celery -A myapp worker -l INFO
celery -A myapp:app worker -l INFO
```

Sources: [examples/app/myapp.py:13-22](repo://examples/app/myapp.py#L13-L22)

The `celery` entry point applies eventlet or gevent monkey patching first when `-P`/`--pool` selects one of them (except for `celery multi`), then hands control to the click group in `celery/bin/celery.py`. That group reads `-A/--app`, `-b/--broker`, `--result-backend` and `--loader`, each also from an environment variable (`APP`, `BROKER_URL`, `RESULT_BACKEND`, `LOADER`). The options and every subcommand are listed in [[Command-Line Interface]]; what the worker does at start is in [[Worker Startup and Bootsteps]].

Sources: [celery/__main__.py:10-15](repo://celery/__main__.py#L10-L15), [celery/bin/celery.py:55-80](repo://celery/bin/celery.py#L55-L80)

A module whose last lines call `app.start()` can also be run directly, which makes `python myapp.py worker -l INFO` equivalent to the `celery` command with that app.

Sources: [examples/app/myapp.py:28-45](repo://examples/app/myapp.py#L28-L45), [celery/app/base.py:480-513](repo://celery/app/base.py#L480-L513)

## Call the task

With the worker running, call the task from another Python shell. `delay` publishes a message and returns an `AsyncResult` at once; `get()` blocks until the worker has stored the result:

Sources: [examples/app/myapp.py:5-10](repo://examples/app/myapp.py#L5-L10)

```pycon
>>> from myapp import add
>>> add.delay(16, 16).get()
32
```

Sources: [examples/app/myapp.py:5-10](repo://examples/app/myapp.py#L5-L10)

`delay(*args, **kwargs)` is shorthand for `apply_async(args, kwargs)`; `apply_async` accepts the execution options (`countdown`, `eta`, `expires`, `queue`, `priority` …) described in [[Sending Tasks and Routing]]. The returned object and its `get`, `ready` and `state` are described in [[Task Results and States]]. Combining calls into pipelines and fan-outs is the subject of [[Signatures and Chains]] and [[Groups and Chords]].

Sources: [celery/app/task.py:523-535](repo://celery/app/task.py#L523-L535)

> [!NOTE]
> `myapp.py` creates its app without a result backend (the `backend='rpc'` line is commented out), so `get()` there needs a backend configured first. The example also sets `task_acks_late=True` as a constructor keyword, which, like any extra keyword, becomes a configuration value.

Sources: [examples/app/myapp.py:28-35](repo://examples/app/myapp.py#L28-L35), [celery/app/base.py:399-406](repo://celery/app/base.py#L399-L406)

## Run it in tests or without a broker

Setting `task_always_eager` makes `apply_async` run the task in the calling process with `Task.apply` instead of publishing it, after round-tripping the arguments through the configured serializer. For tests against a real worker, [[Testing Celery Apps]] covers the pytest fixtures and the embedded worker.

Sources: [celery/app/task.py:682-700](repo://celery/app/task.py#L682-L700)

## Development environment

The `docker/` folder holds the development setup for working on Celery itself: `docker-compose.yml` builds a `celery/celery:dev` image with the source tree mounted, and starts RabbitMQ, Redis, DynamoDB Local and Azurite so the integration tests have a broker and backends (`TEST_BROKER: pyamqp://rabbit:5672`, `TEST_BACKEND: redis://redis`). A `docs` service serves the Sphinx documentation on port 7001.

Sources: [docker/docker-compose.yml:1-47](repo://docker/docker-compose.yml#L1-L47)
