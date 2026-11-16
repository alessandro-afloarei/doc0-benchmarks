---
title: "Contrib Utilities"
---
## Overview

`celery/contrib` holds the helpers that sit beside the core package rather than inside it: an abortable-task base class, a tool that moves queued messages from one queue to another, a remote debugger, a Sphinx extension for documenting tasks, and the test helpers and Django task class covered on their own pages. The table below lists the four tools that have no page of their own, the public names each one provides, and the core machinery each one uses. The test helpers are on [[Testing Utilities]] and the Django task class is on [[Django Integration]].

Sources: [celery/contrib/abortable.py:1-20](repo://celery/contrib/abortable.py#L1-L20), [celery/contrib/rdb.py:1-17](repo://celery/contrib/rdb.py#L1-L17)

| Tool | Module | Public names | Core machinery it uses |
| --- | --- | --- | --- |
| Abortable tasks | `celery/contrib/abortable.py` | `AbortableTask`, `AbortableAsyncResult` | The result backend's `store_result` and `get_task_meta` |
| Queue migration | `celery/contrib/migrate.py` | `move`, `migrate_tasks`, `republish`, `State` | The broker connection and its consumer callbacks |
| Remote debugger | `celery/contrib/rdb.py` | `Rdb`, `set_trace`, `debugger` | The standard `pdb` debugger over a socket |
| Sphinx extension | `celery/contrib/sphinx.py` | `TaskDocumenter`, `TaskDirective`, `setup` | Sphinx's autodoc extension |

Sources: [celery/contrib/abortable.py:103-130](repo://celery/contrib/abortable.py#L103-L130), [celery/contrib/migrate.py:50-60](repo://celery/contrib/migrate.py#L50-L60), [celery/contrib/rdb.py:84-91](repo://celery/contrib/rdb.py#L84-L91), [celery/contrib/sphinx.py:58-62](repo://celery/contrib/sphinx.py#L58-L62)

## Abortable tasks

`AbortableTask` is a base class for tasks that can be stopped part way. Its subclasses must call `is_aborted` at regular points in the body and act when it returns true. The class also gives its `AsyncResult` the `AbortableAsyncResult` type.

Sources: [celery/contrib/abortable.py:130-146](repo://celery/contrib/abortable.py#L130-L146)

`is_aborted` asks the backend whether the task's state is `ABORTED`. `AbortableAsyncResult.abort` writes that state with `store_result`, so the abort is visible to the task the next time it checks. The method does not stop the task by itself, and the code comment says a call does not guarantee when the task will stop.

Sources: [celery/contrib/abortable.py:103-128](repo://celery/contrib/abortable.py#L103-L128), [celery/contrib/abortable.py:147-152](repo://celery/contrib/abortable.py#L147-L152)

## Queue migration

`republish` sends a received message again to an exchange and routing key. By default it reuses the message's own exchange and raw body, and it drops the content-type, content-encoding and header properties.

Sources: [celery/contrib/migrate.py:50-79](repo://celery/contrib/migrate.py#L50-L79)

`migrate_task` republishes one message, and the queue map gives the new exchange and routing key for the message's old ones. `migrate_tasks` consumes messages from a source connection and hands each one to the migrate function, and `move` filters the messages with a predicate before it does this. The predicate receives the standard consumer callback arguments, and `State` counts the messages seen and moved.

Sources: [celery/contrib/migrate.py:80-98](repo://celery/contrib/migrate.py#L80-L98), [celery/contrib/migrate.py:99-126](repo://celery/contrib/migrate.py#L99-L126), [celery/contrib/migrate.py:127-140](repo://celery/contrib/migrate.py#L127-L140)

## Remote debugger

`Rdb` is a `Pdb` subclass that listens on a socket and waits for a client to attach. The host and port come from `CELERY_RDB_HOST` and `CELERY_RDB_PORT`, with defaults of `127.0.0.1` and the module's default port. Its `say` method writes to the connected client, and `do_continue` and `do_quit` end the session.

Sources: [celery/contrib/rdb.py:58-59](repo://celery/contrib/rdb.py#L58-L59), [celery/contrib/rdb.py:84-116](repo://celery/contrib/rdb.py#L84-L116), [celery/contrib/rdb.py:137-170](repo://celery/contrib/rdb.py#L137-L170)

`set_trace` breaks at the caller's frame, or at a frame given as an argument, by calling `set_trace` on the debugger that `debugger` returns. A task can therefore call `set_trace` in its body to stop inside the worker process.

Sources: [celery/contrib/rdb.py:175-187](repo://celery/contrib/rdb.py#L175-L187)

## Sphinx extension

`setup` loads `sphinx.ext.autodoc` and checks the Sphinx version, because the newer autodoc rewrite needs the `TaskDocumenter` to run in legacy mode. The registration of the directive and the documenter follows in the same function.

Sources: [celery/contrib/sphinx.py:111-124](repo://celery/contrib/sphinx.py#L111-L124)

`TaskDocumenter` documents task definitions, and `TaskDirective` writes the signature with a task prefix. `autodoc_skip_member_handler` is the skip hook that the extension installs for autodoc members.

Sources: [celery/contrib/sphinx.py:58-97](repo://celery/contrib/sphinx.py#L58-L97), [celery/contrib/sphinx.py:98-110](repo://celery/contrib/sphinx.py#L98-L110)
