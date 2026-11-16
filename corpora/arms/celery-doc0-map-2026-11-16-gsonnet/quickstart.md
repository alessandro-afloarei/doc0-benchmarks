---
title: "Quickstart"
---
## Overview

This page takes one task from definition to a stored result using the repository's own example app, then adds a periodic schedule. Each step names the code that runs so you can follow it into the deeper pages: [[The Celery App and Configuration]], [[Publishing Tasks]], [[Worker Startup and Bootsteps]] and [[AsyncResult and GroupResult]].

Sources: [examples/app/myapp.py:1-45](repo://examples/app/myapp.py#L1-L45)

## Define an app and a task

`examples/app/myapp.py` creates a `Celery` instance with a broker URL and decorates a function with `@app.task`. Extra keyword arguments such as `task_acks_late=True` become configuration keys. Because `app.start()` is called under `__main__`, the same file can also run as a worker.

Sources: [examples/app/myapp.py:29-45](repo://examples/app/myapp.py#L29-L45)

```python
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
```

Sources: [examples/app/myapp.py:29-45](repo://examples/app/myapp.py#L29-L45)

The constructor moves `broker`, `backend` and any unknown keyword arguments into the app's pending configuration, and the decorator returns a lazy proxy until the app is finalized.

Sources: [celery/app/base.py:392-402](repo://celery/app/base.py#L392-L402), [celery/app/base.py:557-575](repo://celery/app/base.py#L557-L575)

## Start a worker

Either run the module (`python myapp.py worker -l INFO`) or use the umbrella command with `-A`, which locates the app instance in the module and also accepts the `module:attribute` form.

Sources: [celery/app/utils.py:378-415](repo://celery/app/utils.py#L378-L415)

```bash
celery -A myapp worker -l INFO
celery -A myapp:app worker -l INFO
```

Sources: [examples/app/myapp.py:1-24](repo://examples/app/myapp.py#L1-L24)

`Celery.start` hands `argv` to the click group in `celery.bin.celery`, and `worker_main` does the same but insists that `worker` appears in `argv`. The `worker` command builds `app.Worker(...)` and calls `start()`; see [[Command Line Interface]] for the full path.

Sources: [celery/app/base.py:480-513](repo://celery/app/base.py#L480-L513), [celery/bin/worker.py:358-367](repo://celery/bin/worker.py#L358-L367)

## Call the task and read the result

From another process, `add.delay(16, 16)` publishes a message and returns an `AsyncResult`; calling `.get()` waits for the value. The result is only retrievable when a result backend is configured, which the example leaves commented out.

Sources: [examples/app/myapp.py:29-35](repo://examples/app/myapp.py#L29-L35)

```python
from myapp import add
add.delay(16, 16).get()
```

Sources: [examples/app/myapp.py:1-12](repo://examples/app/myapp.py#L1-L12)

`delay` is a star-argument wrapper over `apply_async`, which calls `send_task` unless `task_always_eager` is on, in which case the task runs inline through `Task.apply`.

Sources: [celery/app/task.py:523-534](repo://celery/app/task.py#L523-L534), [celery/app/task.py:683-708](repo://celery/app/task.py#L683-L708)

`AsyncResult.get` returns immediately for a task with `ignore_result`, otherwise it registers itself as a pending result and waits on the backend.

Sources: [celery/result.py:191-280](repo://celery/result.py#L191-L280)

## Add a periodic task

`app.add_periodic_task(schedule, sig, ...)` stores an entry in `beat_schedule`, keyed by the `name` argument or by the signature's repr. If the app has not loaded its configuration yet, the call is queued on `_pending_periodic_tasks` and applied when the configuration loads. A beat process reads that schedule; see [[Beat: Periodic Task Scheduler]].

Sources: [celery/app/base.py:1295-1333](repo://celery/app/base.py#L1295-L1333)
