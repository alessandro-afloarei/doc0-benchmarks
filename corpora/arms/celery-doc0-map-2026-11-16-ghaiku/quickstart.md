---
title: "Quickstart"
---
## Overview

This page runs one task from start to finish: one module defines the app and the task, a worker process runs it, and the caller reads the result. Each step links to the page that explains the code behind it.

## Define the app and a task

The repository's tutorial module creates a `Celery` app with a broker URL and decorates a function with `@app.task`. The decorator turns the function into a task object registered under the app.

```python
from celery import Celery

app = Celery('tasks', broker='amqp://')


@app.task()
def add(x, y):
    return x + y
```

Sources: [examples/tutorial/tasks.py:1-8](repo://examples/tutorial/tasks.py#L1-L8)

The first argument to `Celery` is `main`, the name used as the prefix of auto-generated task names, and the `broker` keyword sets the message broker. Settings and the registry are explained in [[Application and Configuration]], and the task object in [[Tasks]].

Sources: [celery/app/base.py:252-258](repo://celery/app/base.py#L252-L258)

## Start a worker

The `celery` command finds the app with `-A`, and its `worker` subcommand starts the worker process from the same module.

```bash
celery -A tasks worker
```

Sources: [celery/bin/celery.py:57-62](repo://celery/bin/celery.py#L57-L62)

Sources: [celery/bin/worker.py:136-140](repo://celery/bin/worker.py#L136-L140)

What the worker does at start-up, and which pool runs the tasks, is explained in [[Worker Startup]] and [[Concurrency Pools]].

## Send a task and read the result

Calling the task object with `delay` sends a message with the given arguments; `delay` is a shortcut for `apply_async`.

```python
from tasks import add

result = add.delay(4, 4)
print(result.get(timeout=10))
```

Sources: [celery/app/task.py:523-534](repo://celery/app/task.py#L523-L534)

`delay` returns an `AsyncResult`; `get` waits for the result and re-raises the task's exception when the task failed. Storing the result needs a result backend, which the tutorial does not set; the backend options are in [[Result Backends]].

Sources: [celery/result.py:191-194](repo://celery/result.py#L191-L194)

How the message is built and routed is in [[Sending Tasks]], and what the worker does with it is in [[Task Execution]].

## Next

- [[Celery Overview]]: how the parts fit.
- [[Tasks]]: the decorator, the task class and calling it.
