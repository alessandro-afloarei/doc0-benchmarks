---
title: "Quickstart"
---
## Overview

This page takes a task from definition to result: install Celery, write a module with an app and a task, start a worker against a broker, call the task and read its return value. Each step names what happens inside Celery and the page that explains it. It uses the tutorial example shipped in `examples/tutorial` and the `celery` console script that the package installs.

Sources: [examples/tutorial/tasks.py:1-12](repo://examples/tutorial/tasks.py#L1-L12), [setup.py:151-159](repo://setup.py#L151-L159)

## Install

Celery needs Python 3.10 or newer. The base package brings kombu and billiard; transports and result backends that need extra libraries are optional extras named after them (`redis`, `sqs`, `mongodb`, `sqlalchemy`, `eventlet`, `gevent`, `pytest` and so on), declared from the `requirements/extras/*.txt` files.

Sources: [setup.py:12-42](repo://setup.py#L12-L42), [setup.py:123-125](repo://setup.py#L123-L125), [setup.py:151-153](repo://setup.py#L151-L153)

```bash
pip install "celery[redis]"
```

Sources: [setup.py:12-42](repo://setup.py#L12-L42)

You also need a running broker. The tutorial uses RabbitMQ (`amqp://`); with the Redis extra installed, a `redis://localhost:6379/0` URL works the same way.

Sources: [examples/tutorial/tasks.py:3](repo://examples/tutorial/tasks.py#L3)

## Define an app and a task

Create `tasks.py`. The `Celery` constructor takes the main module name (used as the prefix of generated task names) and any setting as a keyword; `broker` and `backend` are stored as `broker_url` and `result_backend`. Add a backend if you want to read results: `rpc://` sends results back as messages over the broker, `redis://` stores them in Redis.

Sources: [celery/app/base.py:343-400](repo://celery/app/base.py#L343-L400)

```python
from celery import Celery

app = Celery('tasks', broker='amqp://', backend='rpc://')


@app.task()
def add(x, y):
    return x + y


if __name__ == '__main__':
    app.start()
```

Sources: [examples/tutorial/tasks.py:1-12](repo://examples/tutorial/tasks.py#L1-L12)

`@app.task` registers `add` under the name `tasks.add` and returns a task object that still works as a plain function when called directly. [[The Celery Application]] explains how the app is built and finalized, and [[Defining Tasks]] what the decorator produces.

Sources: [celery/app/base.py:515-585](repo://celery/app/base.py#L515-L585)

## Start a worker

Run the worker from the directory that holds `tasks.py`:

Sources: [celery/bin/worker.py:313-318](repo://celery/bin/worker.py#L313-L318)

```bash
celery -A tasks worker --loglevel=INFO
```

Sources: [celery/bin/worker.py:313-322](repo://celery/bin/worker.py#L313-L322)

The `celery` console script is `celery.__main__:main`. It first applies eventlet or gevent monkey patches if `-P` asks for them, then runs the click group. The global `-A` option is resolved by `find_app`: a module name is imported and its `app` or `celery` attribute is used, falling back to `<module>.celery` for packages and then to any `Celery` instance found in the module. `-A tasks:app` names the attribute explicitly.

Sources: [celery/__main__.py:10-15](repo://celery/__main__.py#L10-L15), [celery/bin/celery.py:113-155](repo://celery/bin/celery.py#L113-L155), [celery/app/utils.py:378-415](repo://celery/app/utils.py#L378-L415)

The `worker` subcommand builds `app.Worker(...)` with the parsed options and calls `start()`. Useful options for a first run:

Sources: [celery/bin/worker.py:357-367](repo://celery/bin/worker.py#L357-L367)

| Option | Meaning |
| --- | --- |
| `-l`, `--loglevel` | Log level (`DEBUG`, `INFO`, `WARNING`…) |
| `-c`, `--concurrency` | Number of pool processes or threads; defaults to the CPU count |
| `-P`, `--pool` | Pool implementation: `prefork` (default), `threads`, `solo`, `eventlet`, `gevent` |
| `-Q`, `--queues` | Only consume from these queues |
| `-E`, `--events` | Send task events for monitoring |
| `-B`, `--beat` | Embed the periodic task scheduler |

Sources: [celery/bin/worker.py:162-215](repo://celery/bin/worker.py#L162-L215), [celery/bin/worker.py:254-302](repo://celery/bin/worker.py#L254-L302)

[[Worker Startup and Bootsteps]] follows what `worker.start()` does, and [[Command-Line Interface]] lists the other subcommands. Running `python tasks.py worker` works too: `app.start()` runs the same click command with this app preset as the `-A` value.

Sources: [celery/app/base.py:480-497](repo://celery/app/base.py#L480-L497)

## Call the task and read the result

From another shell, import the task and call it asynchronously:

Sources: [celery/app/task.py:523-535](repo://celery/app/task.py#L523-L535)

```python
>>> from tasks import add
>>> result = add.delay(4, 4)
>>> result.ready()
True
>>> result.get(timeout=10)
8
```

Sources: [celery/app/task.py:523-535](repo://celery/app/task.py#L523-L535), [celery/result.py:191-268](repo://celery/result.py#L191-L268)

`delay(4, 4)` is shorthand for `apply_async((4, 4))`. It publishes a message to the default queue and returns an `AsyncResult` at once; the worker log prints `Task tasks.add[<id>] received` and then `succeeded`. `get()` blocks until the backend reports a final state, raises `celery.exceptions.TimeoutError` after `timeout` seconds, and re-raises the task's exception if it failed (pass `propagate=False` to get the exception object instead). Without a configured backend, `get()` cannot work: the default backend is `disabled`.

Sources: [celery/app/task.py:683-708](repo://celery/app/task.py#L683-L708), [celery/app/backends.py:41-46](repo://celery/app/backends.py#L41-L46)

> [!WARNING]
> Do not call `result.get()` inside another task: by default `get()` raises `RuntimeError` when it runs in a worker task, because waiting for a subtask can deadlock the pool. Use a chain or chord instead ([[Signatures and Chains]]).

Sources: [celery/result.py:37-60](repo://celery/result.py#L37-L60)

## Where to go next

Calls can carry options such as `countdown`, `eta`, `expires`, `queue` and `priority`, described in [[Publishing Task Messages]] and [[Routing and Queues]]. Results, their states and waiting on several tasks are covered in [[Task Results]]; settings files and `config_from_object` in [[Configuration and Loaders]]; running tasks on a timetable in [[Periodic Tasks with Beat]].

Sources: [celery/app/task.py:536-640](repo://celery/app/task.py#L536-L640)
