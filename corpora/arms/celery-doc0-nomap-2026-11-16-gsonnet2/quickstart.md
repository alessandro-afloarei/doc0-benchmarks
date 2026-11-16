---
title: "Quickstart"
---
## Overview

This page takes one task from definition to result: create an app with a broker, define a task, start a worker, call the task, and read the answer. Each step names the code it triggers; the deeper pages are linked where a step deserves more. For the shape of the whole system see [[Celery Overview]].

Sources: [celery/app/base.py:252-345](repo://celery/app/base.py#L252-L345)

## Create the app and a task

The README's smallest application is an app with a broker URL and one decorated function. Put it in a module such as `hello.py`:

Sources: [README.rst:190-199](repo://README.rst#L190-L199)

```python
from celery import Celery

app = Celery('hello', broker='amqp://guest@localhost//')

@app.task
def hello():
    return 'hello world'
```

Sources: [README.rst:190-199](repo://README.rst#L190-L199)

The `broker` keyword is not stored as an attribute: `__init__` copies it, and `backend` and `include`, into a pre-configuration dict as `broker_url`, `result_backend` and `include`, and wraps that dict in a lazy `Settings` object. Nothing is read or validated until configuration is first used, see [[The Celery Application and Configuration]].

Sources: [celery/app/base.py:381-405](repo://celery/app/base.py#L381-L405), [celery/app/base.py:447-450](repo://celery/app/base.py#L447-L450)

`@app.task` does not build the task class immediately for a non-finalized app. It returns a proxy that evaluates on first use and is queued in the app's `_pending` deque until `finalize()` runs. Details, including the `shared_task` variant, are in [[Defining Tasks and the Task Class]].

Sources: [celery/app/base.py:547-585](repo://celery/app/base.py#L547-L585)

## Start a worker

Run the worker with the app's module given to the global `-A` option:

Sources: [celery/bin/celery.py:113-137](repo://celery/bin/celery.py#L113-L137)

```bash
celery -A hello worker -l INFO
```

Sources: [celery/bin/worker.py:162-166](repo://celery/bin/worker.py#L162-L166)

The `-A` value reaches `find_app`, which imports the module and looks for an attribute named `app`, then `celery`; for a package it then tries the `celery` submodule, and finally it falls back to any `Celery` instance found in the module. The `worker` subcommand then constructs `app.Worker(...)` with the options and calls `worker.start()`.

Sources: [celery/bin/celery.py:132-170](repo://celery/bin/celery.py#L132-L170), [celery/app/utils.py:378-415](repo://celery/app/utils.py#L378-L415), [celery/bin/worker.py:355-371](repo://celery/bin/worker.py#L355-L371)

The worker options most often needed are `-l/--loglevel`, `-c/--concurrency`, `-P/--pool` and `-Q/--queues`.

Sources: [celery/bin/worker.py:162-210](repo://celery/bin/worker.py#L162-L210), [celery/bin/worker.py:254-258](repo://celery/bin/worker.py#L254-L258)

Starting the worker applies its bootstep blueprint (hub, pool, timer, consumer, and so on) and then connects to the broker and begins consuming; that sequence is covered in [[Worker Architecture and Bootsteps]] and [[The Consumer: Receiving Tasks]]. The full list of subcommands is on [[The celery Command Line]].

Sources: [celery/worker/worker.py:76-139](repo://celery/worker/worker.py#L76-L139)

## Call the task and read the result

From any process that can import the module, `delay` is the star-argument shortcut for `apply_async`, and both return an `AsyncResult`:

Sources: [celery/app/task.py:523-534](repo://celery/app/task.py#L523-L534)

```python
from hello import hello

result = hello.delay()
result.get(timeout=10)
```

Sources: [celery/app/task.py:523-534](repo://celery/app/task.py#L523-L534), [celery/result.py:191-270](repo://celery/result.py#L191-L270)

`apply_async` validates the arguments, merges the task's execution options, and (unless `task_always_eager` is set) calls `app.send_task`, which publishes a message to the broker. That path is in [[Calling Tasks: apply_async and send_task]] and queue selection is in [[Routing and Queues]].

Sources: [celery/app/task.py:659-708](repo://celery/app/task.py#L659-L708)

`AsyncResult.get` waits on the result backend, so a backend must be configured with the `result_backend` setting (or the `backend=` keyword) for `get` to return a value. If a task is configured with `ignore_result`, `get` returns `None` without waiting. How results are stored and how the backend is chosen is covered in [[Results, AsyncResult and the Result Backend]] and [[Result Backend Catalogue]].

Sources: [celery/result.py:191-270](repo://celery/result.py#L191-L270), [celery/app/backends.py:36-69](repo://celery/app/backends.py#L36-L69)

> [!NOTE]
> Waiting for a task's result from inside another task is refused by default: `get` calls `assert_will_not_block()` unless `disable_sync_subtasks=False` is passed.

Sources: [celery/result.py:191-270](repo://celery/result.py#L191-L270)

## Where to go next

- Chain tasks or fan them out: [[Canvas: Signatures, Chains and Groups]] and [[Chords: Header, Body and Completion]].
- Run tasks on a timetable: [[Periodic Tasks with Beat]].
- Observe and steer workers: [[Events and Monitoring]] and [[Remote Control: Inspect and Control]].

Sources: [celery/canvas.py:1322-1384](repo://celery/canvas.py#L1322-L1384), [celery/beat.py:219-250](repo://celery/beat.py#L219-L250), [celery/worker/control.py:39-77](repo://celery/worker/control.py#L39-L77)
