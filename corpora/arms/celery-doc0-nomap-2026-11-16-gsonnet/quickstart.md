---
title: "Quickstart"
---
## Overview

This page takes the smallest working Celery program from `examples/app/myapp.py`: one app, one task, one worker, one call. It shows how the `celery` command finds the app and what each step touches. The mechanics behind each step live in [[The Celery Application and Configuration]], [[Defining Tasks, Retries and Task Options]], [[Publishing Tasks: apply_async, Routing and Messages]] and [[Worker Startup and Bootsteps]]; the big picture is in [[Celery Overview]].

Sources: [examples/app/myapp.py:1-45](repo://examples/app/myapp.py#L1-L45)

## Define an app and a task

Create a `Celery` instance with a name, a broker URL and any settings as keyword arguments, then decorate a function with `@app.task`. The example sets `task_acks_late=True` this way, and notes that a result backend can be added through the `backend` argument (for example `backend='rpc'`).

Sources: [examples/app/myapp.py:29-35](repo://examples/app/myapp.py#L29-L35)

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
```

Sources: [examples/app/myapp.py:25-41](repo://examples/app/myapp.py#L25-L41)

The constructor moves `broker`, `backend`, `include` and any extra keyword arguments into pre-configuration, so they become configuration keys when the settings are first read.

Sources: [celery/app/base.py:396-401](repo://celery/app/base.py#L396-L401)

## Start a worker

The `celery` console script is `celery.__main__:main`. That function first calls `maybe_patch_concurrency` (skipped when `multi` is in the arguments) so that `-P eventlet` or `-P gevent` can monkey-patch before anything else imports, then runs the click group in `celery.bin.celery`.

Sources: [setup.py:155-159](repo://setup.py#L155-L159), [celery/__main__.py:10-16](repo://celery/__main__.py#L10-L16), [celery/__init__.py:123-153](repo://celery/__init__.py#L123-L153)

Pass the app with `-A`/`--app` before the sub-command. The option declares `envvar='APP'`, and `main` runs the group with `auto_envvar_prefix="CELERY"`. A string is resolved with `find_app`, which accepts `module`, `module:attribute`, or a package whose `celery` submodule holds the app.

Sources: [celery/bin/celery.py:57-60](repo://celery/bin/celery.py#L57-L60), [celery/app/utils.py:378-415](repo://celery/app/utils.py#L378-L415)

```bash
celery -A myapp worker -l INFO
celery -A myapp:app worker --concurrency=4
```

Sources: [celery/bin/celery.py:57-60](repo://celery/bin/celery.py#L57-L60), [celery/bin/celery.py:220-227](repo://celery/bin/celery.py#L220-L227), [celery/app/utils.py:378-415](repo://celery/app/utils.py#L378-L415), [examples/app/myapp.py:1-22](repo://examples/app/myapp.py#L1-L22)

The `worker` command accepts `-l/--loglevel`, `-c/--concurrency`, `-P/--pool` and `-Q` for queues. Extra `--name=value` arguments are passed to `app.config_from_cmdline` in the `worker` namespace. The command then builds `app.Worker(...)` and calls `start()`, exiting with the worker's exit code.

Sources: [celery/bin/worker.py:162-165](repo://celery/bin/worker.py#L162-L165), [celery/bin/worker.py:194-207](repo://celery/bin/worker.py#L194-L207), [celery/bin/worker.py:324-368](repo://celery/bin/worker.py#L324-L368)

You can also start the app from inside the program: `app.start()` runs the same click group with the app preset as the default for `-A`, and `app.worker_main()` does the same but raises `ValueError` unless `worker` is in the arguments. That is why the example can be run as `python myapp.py worker -l INFO`.

Sources: [celery/app/base.py:480-513](repo://celery/app/base.py#L480-L513), [examples/app/myapp.py:44-45](repo://examples/app/myapp.py#L44-L45)

## Call the task

`add.delay(16, 16)` is the star-argument form of `add.apply_async((16, 16), {})`. Either call publishes a message and returns an `AsyncResult` at once; it does not wait for the task.

Sources: [celery/app/task.py:523-534](repo://celery/app/task.py#L523-L534)

```python
>>> from myapp import add
>>> result = add.delay(16, 16)
>>> result.get()
32
```

Sources: [celery/app/task.py:523-534](repo://celery/app/task.py#L523-L534), [examples/app/myapp.py:7-10](repo://examples/app/myapp.py#L7-L10)

`apply_async` accepts the execution options that `delay` cannot, such as `countdown`, `expires`, `queue`, and `link`. See [[Publishing Tasks: apply_async, Routing and Messages]] for how they become message headers and routing.

Sources: [celery/app/task.py:536-545](repo://celery/app/task.py#L536-L545), [celery/app/task.py:683-708](repo://celery/app/task.py#L683-L708)

## Read the result

`AsyncResult.get` returns immediately with `None` if the result is ignored; otherwise it waits on the backend until the task is ready, and re-raises the task's exception unless `propagate=False`. The example's backend line is commented out: without a configured result backend the backend is the disabled one, so enable one such as `backend='rpc'` before relying on `get()`. The state of every task and the backends are described in [[Task Results, States and Result Backends]].

Sources: [celery/result.py:191-270](repo://celery/result.py#L191-L270), [examples/app/myapp.py:32-33](repo://examples/app/myapp.py#L32-L33), [celery/app/backends.py:44-44](repo://celery/app/backends.py#L44-L44)

> [!WARNING]
> `get()` called from inside a task is refused by default (`disable_sync_subtasks=True` calls `assert_will_not_block`), because waiting on a subtask can deadlock a pool.

Sources: [celery/result.py:191-196](repo://celery/result.py#L191-L196), [celery/result.py:246-247](repo://celery/result.py#L246-L247)

## Where to go next

The pages below continue from here.

Sources: [celery/__init__.py:30-37](repo://celery/__init__.py#L30-L37)

- Schedule a task to repeat: [[Beat: Periodic Task Scheduling]].
- Combine tasks into workflows: [[Canvas: Signatures, Chains, Groups and Chords]].
- Choose a pool for I/O-bound or CPU-bound work: [[Worker Pool Implementations]].

Sources: [celery/beat.py:612-660](repo://celery/beat.py#L612-L660), [celery/canvas.py:233-260](repo://celery/canvas.py#L233-L260), [celery/concurrency/__init__.py:10-20](repo://celery/concurrency/__init__.py#L10-L20)
