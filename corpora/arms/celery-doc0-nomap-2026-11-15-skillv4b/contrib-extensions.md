---
title: "Contrib Extensions"
---
## Overview

`celery.contrib` holds optional modules that are not loaded unless imported. Four of them are general tools: `abortable` lets a caller ask a running task to stop, `rdb` attaches a debugger to a task inside a worker over a socket, `migrate` moves or filters messages between queues and brokers, and `sphinx` documents tasks with Sphinx autodoc. This page says what each is for and how it works. The testing helpers in the same package are on [[Testing Celery Applications]], and `DjangoTask` is on [[Django Integration]].

Sources: [celery/contrib/abortable.py:1-100](repo://celery/contrib/abortable.py#L1-L100), [celery/contrib/rdb.py:1-60](repo://celery/contrib/rdb.py#L1-L60)

| Module | Use it to | Cost |
| --- | --- | --- |
| `celery.contrib.abortable` | Let callers cancel long tasks cooperatively | A result-backend read each time the task checks |
| `celery.contrib.rdb` | Step through a task running in a worker | Blocks that pool process until a client connects |
| `celery.contrib.migrate` | Move messages to another broker or queue | Consumes and republishes every matching message |
| `celery.contrib.sphinx` | Document tasks with their real signatures | Build-time only |

Sources: [celery/contrib/abortable.py:103-165](repo://celery/contrib/abortable.py#L103-L165), [celery/contrib/rdb.py:84-114](repo://celery/contrib/rdb.py#L84-L114), [celery/contrib/migrate.py:99-118](repo://celery/contrib/migrate.py#L99-L118), [celery/contrib/sphinx.py:118-139](repo://celery/contrib/sphinx.py#L118-L139)

## Abortable tasks

Revoking with `terminate=True` kills the process running a task ([[Remote Control and Inspection]]); `AbortableTask` instead lets the task stop itself at a point of its choosing. The caller calls `result.abort()` on an `AbortableAsyncResult`, which stores the custom state `ABORTED` for the task id in the result backend. The task, declared with `base=AbortableTask`, calls `self.is_aborted()` at safe points; it reads the task's state from the backend and returns `True` once it is `ABORTED`, and the task then cleans up and returns.

Sources: [celery/contrib/abortable.py:100-165](repo://celery/contrib/abortable.py#L100-L165)

```python
from celery.contrib.abortable import AbortableTask
from celery.utils.log import get_task_logger

from proj.celery import app

logger = get_logger(__name__)

@app.task(bind=True, base=AbortableTask)
def long_running_task(self):
    results = []
    for i in range(100):
        # check after every 5 iterations...
        # (or alternatively, check when some timer is due)
        if not i % 5:
            if self.is_aborted():
                # respect aborted state, and terminate gracefully.
                logger.warning('Task aborted')
                return
            value = do_something_expensive(i)
            results.append(y)
    logger.info('Task complete')
    return results
```

Sources: [celery/contrib/abortable.py:30-51](repo://celery/contrib/abortable.py#L30-L51)

This needs a result backend that both sides share, and every check is a backend read, so the check interval trades responsiveness against load. Aborting does not guarantee the task stops: only tasks that call `is_aborted()` react. `is_aborted(task_id=...)` returns `False` for a task that is not abortable.

Sources: [celery/contrib/abortable.py:114-165](repo://celery/contrib/abortable.py#L114-L165)

## Remote debugger

A worker's pool processes have no terminal, so `pdb` cannot be used inside a task. `celery.contrib.rdb.set_trace()` opens a `Pdb` session on a TCP socket instead: it binds to `CELERY_RDB_HOST` (default `127.0.0.1`) on `CELERY_RDB_PORT` (default 6899), logs the address, and blocks until someone connects, for example with `telnet`. Each pool process offsets the port by its process number, and the next 100 ports are tried when one is busy, so several processes can debug at once.

Sources: [celery/contrib/rdb.py:54-70](repo://celery/contrib/rdb.py#L54-L70), [celery/contrib/rdb.py:84-135](repo://celery/contrib/rdb.py#L84-L135), [celery/contrib/rdb.py:175-187](repo://celery/contrib/rdb.py#L175-L187)

```python

from celery.contrib import rdb
from celery import task

@task()
def add(x, y):
    result = x + y
    rdb.set_trace()
    return result
```

Sources: [celery/contrib/rdb.py:13-21](repo://celery/contrib/rdb.py#L13-L21)

`continue` and `quit` close the socket and restore `stdin`/`stdout`. A worker started with the `CELERY_RDBSIG` environment variable set also opens a session at the current frame when it receives `SIGUSR2` ([[Worker Startup and Bootsteps]]).

Sources: [celery/contrib/rdb.py:146-173](repo://celery/contrib/rdb.py#L146-L173), [celery/apps/worker.py:502-514](repo://celery/apps/worker.py#L502-L514)

## Migrating and moving messages

`celery.contrib.migrate` consumes task messages and republishes them elsewhere, keeping their body, headers and properties. `Filterer` does the consuming: it declares the source queues passively to estimate how many messages there are, registers callbacks (filter, state counting, optional acknowledgement and progress) and consumes until `limit` messages were seen or no message arrived within `timeout`, or for ever with `forever`. Only task names in `tasks` are processed when that list is given.

Sources: [celery/contrib/migrate.py:27-78](repo://celery/contrib/migrate.py#L27-L78), [celery/contrib/migrate.py:247-355](repo://celery/contrib/migrate.py#L247-L355)

The module's entry points build on `Filterer`:

Sources: [celery/contrib/migrate.py:99-127](repo://celery/contrib/migrate.py#L99-L127)

- `migrate_tasks(source, dest, queues=None, tasks=None, ...)` copies every message from the source connection's queues to the destination broker, declaring the queues there (optionally renamed through a `{old: new}` mapping). `celery migrate SOURCE_URL DEST_URL` runs it with `--limit`, `--timeout`, `--ack-messages`, `--tasks`, `--queues` and `--forever`, printing each migrated task.
- `move(predicate, ...)` moves only the messages for which `predicate(body, message)` returns a destination: a queue, an `(exchange, routing_key)` pair, or any true value for the default destination. Moved messages are acknowledged on the source.
- `move_task_by_id(task_id, dest)`, `move_by_idmap({task_id: queue})` and `move_by_taskmap({task_name: queue})` are ready-made predicates; the id-based ones stop once every id has been found.

Sources: [celery/contrib/migrate.py:99-216](repo://celery/contrib/migrate.py#L99-L216), [celery/contrib/migrate.py:358-416](repo://celery/contrib/migrate.py#L358-L416), [celery/bin/migrate.py:9-63](repo://celery/bin/migrate.py#L9-L63)

> [!WARNING]
> The `migrate` command is marked experimental: back up the queued tasks before running it.

Sources: [celery/bin/migrate.py:48-55](repo://celery/bin/migrate.py#L48-L55)

## Sphinx extension

Adding `'celery.contrib.sphinx'` to `extensions` in a Sphinx `conf.py` lets autodoc document tasks as functions. A task object is an instance, not a function, so plain autodoc would document it as a class instance or skip it. `TaskDocumenter` recognizes task objects that wrap a function, documents them with the wrapped function's signature (dropping `self` for bound tasks), and checks the wrapped function's module. Tasks get a `(task)` prefix, configurable with `celery_task_prefix`, an `autotask` directive and a `:task:` cross-reference role.

Sources: [celery/contrib/sphinx.py:1-116](repo://celery/contrib/sphinx.py#L1-L116)

On Sphinx 9 or later, the extension needs autodoc's legacy class-based mode and switches `autodoc_use_legacy_class_based` on with a warning when the project has not set it.

Sources: [celery/contrib/sphinx.py:118-139](repo://celery/contrib/sphinx.py#L118-L139)
