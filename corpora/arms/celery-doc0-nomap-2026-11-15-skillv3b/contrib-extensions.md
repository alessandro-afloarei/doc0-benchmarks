---
title: "Contrib Extensions"
---
## Overview

`celery.contrib` holds optional add-ons that are not part of the core task flow and are imported only when you use them. This page is a catalogue of the general-purpose ones: cooperative task abortion, a remote debugger for tasks running in pool processes, tools to move messages between queues and brokers, and a Sphinx extension for documenting tasks. The testing helpers in `celery.contrib.pytest` and `celery.contrib.testing` are on [[Testing Celery Applications]], and `celery.contrib.django` is on [[Django Integration]].

Sources: [celery/contrib/abortable.py:1-20](repo://celery/contrib/abortable.py#L1-L20), [celery/contrib/rdb.py:1-50](repo://celery/contrib/rdb.py#L1-L50), [celery/contrib/migrate.py:1-30](repo://celery/contrib/migrate.py#L1-L30), [celery/contrib/sphinx.py:1-36](repo://celery/contrib/sphinx.py#L1-L36)

| Module | Use it to | Choose it when |
| --- | --- | --- |
| `celery.contrib.abortable` | Ask a running task to stop at its next checkpoint | A long task can stop cleanly and you want a stop button without killing processes |
| `celery.contrib.rdb` | Open a `pdb` session over TCP from inside a task | You need to debug a task in a pool child, where `pdb` has no terminal |
| `celery.contrib.migrate` | Copy or move task messages between brokers or queues | Changing brokers, or moving stuck tasks to another queue |
| `celery.contrib.sphinx` | Document tasks with Sphinx autodoc | Your API docs should list tasks with their real signatures |

Sources: [celery/contrib/abortable.py:100-161](repo://celery/contrib/abortable.py#L100-L161), [celery/contrib/rdb.py:84-187](repo://celery/contrib/rdb.py#L84-L187), [celery/contrib/sphinx.py:111-139](repo://celery/contrib/sphinx.py#L111-L139)

## Abortable tasks

### How abortion works

Celery has no built-in way to stop a running task gracefully: revoking with `terminate=True` kills the process ([[Remote Control and Inspection]]). `AbortableTask` adds a cooperative alternative through the result backend. The caller's `AbortableAsyncResult.abort()` stores the custom state `ABORTED` for the task id. The task calls `self.is_aborted()` at points where it can stop safely; that reads the task's state from the backend and returns true when it is `ABORTED`. The task then cleans up and returns.

Sources: [celery/contrib/abortable.py:100-161](repo://celery/contrib/abortable.py#L100-L161)

```python
from celery.contrib.abortable import AbortableTask


@app.task(bind=True, base=AbortableTask)
def long_running_task(self):
    results = []
    for i in range(100):
        if not i % 5 and self.is_aborted():
            return results          # stop at a safe point
        results.append(do_something_expensive(i))
    return results


result = long_running_task.delay()
result.abort()
```

Sources: [celery/contrib/abortable.py:27-70](repo://celery/contrib/abortable.py#L27-L70)

### Limits

Abortion is a request, not a guarantee: a task that never checks keeps running, and the `ABORTED` state is overwritten when the task stores its final result. Each `is_aborted()` call is a backend read, so check every few iterations rather than in a tight loop. It needs a result backend that stores arbitrary states and lets the caller and the worker see the same record, such as the database or Redis backends; with RPC the worker never sees the caller's state change.

Sources: [celery/contrib/abortable.py:71-84](repo://celery/contrib/abortable.py#L71-L84), [celery/contrib/abortable.py:147-161](repo://celery/contrib/abortable.py#L147-L161)

## Remote debugger

`rdb.set_trace()` stops a task inside a prefork pool child, where there is no terminal for `pdb`. `Rdb` subclasses `pdb.Pdb`: it binds a TCP socket on `CELERY_RDB_HOST` (`127.0.0.1` by default) starting at `CELERY_RDB_PORT` (6899), adding the pool process index so each child gets its own port and trying up to 100 ports. It logs the port, waits for a connection, and runs the debugger over the socket. `continue` or `quit` closes the session and the task resumes.

Sources: [celery/contrib/rdb.py:56-81](repo://celery/contrib/rdb.py#L56-L81), [celery/contrib/rdb.py:84-187](repo://celery/contrib/rdb.py#L84-L187)

```python
from celery.contrib import rdb


@app.task
def add(x, y):
    result = x + y
    rdb.set_trace()
    return result
```

Sources: [celery/contrib/rdb.py:11-21](repo://celery/contrib/rdb.py#L11-L21)

Connect with `telnet localhost 6899` (or the logged port). Setting the `CELERY_RDBSIG` environment variable also makes the worker open a remote debugger at the current frame when it receives `SIGUSR2`, which helps inspect a worker that seems stuck ([[Worker Startup and Shutdown]]). The debugger listens on localhost by default because anyone who connects can run arbitrary code in the worker.

Sources: [celery/apps/worker.py:502-514](repo://celery/apps/worker.py#L502-L514), [celery/contrib/rdb.py:22-50](repo://celery/contrib/rdb.py#L22-L50)

## Moving messages

### Migrating between brokers

`migrate_tasks(source, dest, ...)` consumes task messages from the queues on the source connection and republishes each one to the destination, keeping its body, headers, properties, priority and routing, optionally renaming queues; messages are acknowledged on the source only with `ack_messages=True`. `celery migrate SOURCE_URL DEST_URL` wraps it, with `-n/--limit`, `-t/--timeout`, `-a/--ack-messages`, `-T/--tasks`, `-Q/--queues` and `-F/--forever`. The command is marked experimental: back up the messages first.

Sources: [celery/contrib/migrate.py:50-119](repo://celery/contrib/migrate.py#L50-L119), [celery/bin/migrate.py:9-63](repo://celery/bin/migrate.py#L9-L63)

```bash
celery -A proj migrate redis://old-host:6379/0 amqp://new-host// --ack-messages
```

Sources: [celery/bin/migrate.py:9-48](repo://celery/bin/migrate.py#L9-L48)

### Moving within a broker

`move(predicate, ...)` consumes from the app's queues (or `source`) and calls `predicate(body, message)` for each message. A true result moves the message, republishing it to the returned `Queue`, the returned `(exchange, routing_key)` pair, or the default `exchange` and `routing_key`, and acknowledging the original. Helpers cover common cases: `move_task_by_id(task_id, dest)`, `move_by_idmap({task_id: queue})`, which stops once all ids are found, and `move_by_taskmap({task_name: queue})`.

Sources: [celery/contrib/migrate.py:127-216](repo://celery/contrib/migrate.py#L127-L216), [celery/contrib/migrate.py:358-407](repo://celery/contrib/migrate.py#L358-L407)

```python
from kombu import Queue
from celery.contrib.migrate import move_by_taskmap

move_by_taskmap({'reports.tasks.nightly': Queue('reports')}, app=app)
```

Sources: [celery/contrib/migrate.py:392-407](repo://celery/contrib/migrate.py#L392-L407)

Both are built on `Filterer`, which declares the source queues, consumes with the given filter until `limit` messages are handled or nothing arrives for `timeout` seconds (or forever), and reports progress through a callback.

Sources: [celery/contrib/migrate.py:247-356](repo://celery/contrib/migrate.py#L247-L356)

## Sphinx extension

Tasks created with `@app.task` are instances, not functions, so Sphinx autodoc would skip them or document a generic signature. Adding `'celery.contrib.sphinx'` to `extensions` in `conf.py` registers a `TaskDocumenter` that recognizes task objects, documents them with the wrapped function's signature (dropping `self` for bound tasks), and checks their module through the wrapped function. It adds an `autotask` directive, a `:task:` cross-reference role, and the `celery_task_prefix` setting (`'(task)'`) shown before task names.

Sources: [celery/contrib/sphinx.py:58-109](repo://celery/contrib/sphinx.py#L58-L109), [celery/contrib/sphinx.py:111-139](repo://celery/contrib/sphinx.py#L111-L139)

```python
# docs/conf.py
extensions = [
    'sphinx.ext.autodoc',
    'celery.contrib.sphinx',
]
celery_task_prefix = '(task)'
autodoc_use_legacy_class_based = True   # needed with Sphinx 9+
```

Sources: [celery/contrib/sphinx.py:1-36](repo://celery/contrib/sphinx.py#L1-L36)

The extension needs Sphinx 2.0 or later. Sphinx 9 rewrote autodoc, and the documenter depends on the legacy class-based mode; the extension turns `autodoc_use_legacy_class_based` on automatically with a warning when it is not set.

Sources: [celery/contrib/sphinx.py:111-127](repo://celery/contrib/sphinx.py#L111-L127)
