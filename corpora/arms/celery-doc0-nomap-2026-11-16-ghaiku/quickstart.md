---
title: "Quickstart"
---
## Overview

This page runs one task end to end with the example project in `examples/next-steps`: an app module, a task module, a caller and a worker. Each step names the code it calls and the page that explains it. The example uses an AMQP broker and an RPC result backend; any broker and backend URL works the same way.

Sources: [examples/next-steps/proj/celery.py:1-14](repo://examples/next-steps/proj/celery.py#L1-L14)

## Create the app

The app is one `Celery` object. Its first argument names the main module, the `broker` and `backend` keywords pick the transport and the result store, and `include` lists the modules a worker imports at start-up. `app.conf.update` sets further options after construction.

Sources: [examples/next-steps/proj/celery.py:1-14](repo://examples/next-steps/proj/celery.py#L1-L14)

```python
from celery import Celery

app = Celery('proj',
             broker='amqp://',
             backend='rpc://',
             include=['proj.tasks'])

app.conf.update(
    result_expires=3600,
)
```

Sources: [examples/next-steps/proj/celery.py:1-14](repo://examples/next-steps/proj/celery.py#L1-L14)

The constructor records the loader and component classes it is given. The settings are read later, when the configuration is first loaded. See [[The Celery App]] for the construction order and [[Configuration]] for the keys.

Sources: [celery/app/base.py:352-357](repo://celery/app/base.py#L352-L357), [celery/app/base.py:1247-1256](repo://celery/app/base.py#L1247-L1256)

## Define a task

The `@app.task` decorator turns a function into a task registered on the app under a generated name. The task module imports the app object, so the decorator runs against the same registry the worker uses.

Sources: [examples/next-steps/proj/tasks.py:1-6](repo://examples/next-steps/proj/tasks.py#L1-L6)

```python
from .celery import app


@app.task
def add(x, y):
    return x + y
```

Sources: [examples/next-steps/proj/tasks.py:1-6](repo://examples/next-steps/proj/tasks.py#L1-L6)

`app.task` returns a decorator that calls `_task_from_fun` to build the task class, and `register_task` stores the class in the app's task registry under its name. [[Defining Tasks]] covers the decorator, the registry and the task options.

Sources: [celery/app/base.py:590-600](repo://celery/app/base.py#L590-L600), [celery/app/base.py:635-653](repo://celery/app/base.py#L635-L653)

## Send the task and read the result

Calling `add.delay(4, 4)` is shorthand for `apply_async((4, 4), {})`. `apply_async` publishes a message unless `task_always_eager` is set, and returns an `AsyncResult` holding the task id.

Sources: [celery/app/task.py:523-535](repo://celery/app/task.py#L523-L535), [celery/app/task.py:682-708](repo://celery/app/task.py#L682-L708)

```python
from proj.tasks import add

result = add.delay(4, 4)
result.get(timeout=10)
```

Sources: [celery/app/task.py:523-535](repo://celery/app/task.py#L523-L535), [celery/app/task.py:682-708](repo://celery/app/task.py#L682-L708)

`get` waits until the state is ready, then returns the value or re-raises the stored exception. [[AsyncResult and Result Sets]] describes the wait loop and the other read methods, and [[Sending a Task Message]] traces the publish call.

Sources: [celery/result.py:191-200](repo://celery/result.py#L191-L200)

## Start a worker

From the project directory, the `celery` command loads the app named by `-A` and starts the worker command. The worker imports the modules in `include`, connects to the broker and starts consuming the default queue.

Sources: [celery/bin/celery.py:57-60](repo://celery/bin/celery.py#L57-L60), [celery/bin/worker.py:307-310](repo://celery/bin/worker.py#L307-L310)

```bash
celery -A proj worker --loglevel=INFO
```

Sources: [celery/bin/celery.py:57-60](repo://celery/bin/celery.py#L57-L60), [celery/bin/worker.py:307-310](repo://celery/bin/worker.py#L307-L310)

The worker command builds a `WorkController` and runs its blueprint of steps. [[Worker Startup and Bootsteps]] explains the start order, and [[Command Line Entry Point]] covers the global options that come before the subcommand.

Sources: [celery/apps/worker.py:91-100](repo://celery/apps/worker.py#L91-L100), [celery/bin/celery.py:113-120](repo://celery/bin/celery.py#L113-L120)

## Where to go next

- [[Overview]] shows how the pieces above connect.
- [[Routing and Queues]] explains which queue a task is sent to when the default is not right.
- [[Retries, Failures and Time Limits]] covers the options for failed or slow tasks.
- [[Signatures]] describes the objects that chains, groups and chords are built from.

Sources: [celery/app/routes.py:56-70](repo://celery/app/routes.py#L56-L70), [celery/canvas.py:233-250](repo://celery/canvas.py#L233-L250)
