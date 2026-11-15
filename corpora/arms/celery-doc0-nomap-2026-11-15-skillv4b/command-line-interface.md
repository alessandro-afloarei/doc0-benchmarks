---
title: "Command Line Interface"
---
## Overview

Everything Celery runs from a terminal goes through one program, `celery`, a click command group defined in `celery/bin/celery.py`. Global options select the app and override the broker, backend and configuration; subcommands start long-running programs (`worker`, `beat`, `events`, `multi`), talk to running workers (`inspect`, `control`, `status`), act on the broker (`purge`, `call`, `migrate`, `amqp`, `list`) or help development (`shell`, `result`, `report`, `graph`, `logtool`, `upgrade`). Packages can add subcommands through the `celery.commands` entry point. This page describes the shared machinery and each subcommand; `multi` has its own page, [[Running Multiple Workers and Daemonization]].

Sources: [celery/bin/celery.py:1-55](repo://celery/bin/celery.py#L1-L55), [celery/bin/celery.py:173-189](repo://celery/bin/celery.py#L173-L189)

## Entry point and global options

The `celery` console script calls `celery.__main__.main`, which applies eventlet or gevent monkey patches when `-P eventlet` or `-P gevent` is on the command line (except for `multi`), then runs the click group with `auto_envvar_prefix="CELERY"`.

Sources: [celery/__main__.py:10-15](repo://celery/__main__.py#L10-L15), [celery/bin/celery.py:220-227](repo://celery/bin/celery.py#L220-L227)

| Option | Environment | Effect |
| --- | --- | --- |
| `-A`, `--app` | `APP` | Module or `module:attr` of the app, found with `find_app` |
| `-b`, `--broker` | `BROKER_URL` | Sets `CELERY_BROKER_URL` |
| `--result-backend` | `RESULT_BACKEND` | Sets `CELERY_RESULT_BACKEND` |
| `--loader` | `LOADER` | Sets `CELERY_LOADER` |
| `--config` | `CONFIG_MODULE` | Sets `CELERY_CONFIG_MODULE` |
| `--workdir` | — | `chdir` before anything else |
| `-C`, `--no-color` | `NO_COLOR` | Plain output |
| `-q`, `--quiet` | — | Less output |
| `--skip-checks` | `SKIP_CHECKS` | Skip Django checks at start |
| `--version` | — | Print the version banner |

Sources: [celery/bin/celery.py:54-131](repo://celery/bin/celery.py#L54-L131)

The global options must come before the subcommand. Since Celery 5, `celery worker -A proj` is an error; a patched click error message explains the right order (`celery -A proj worker`).

Sources: [celery/bin/celery.py:190-217](repo://celery/bin/celery.py#L190-L217)

When `-A` names a module that cannot be imported, the group tells apart a missing module, an import error inside the module (printed with its traceback), and a module without an app attribute. The loaded app is stored on a `CLIContext` passed to every subcommand as `ctx.obj`; it also holds the colour and quiet flags and the output helpers (`echo`, `error`, `secho`, `pretty`).

Sources: [celery/bin/celery.py:133-155](repo://celery/bin/celery.py#L133-L155), [celery/bin/base.py:37-121](repo://celery/bin/base.py#L37-L121)

## Extending the CLI

An app can add options to programs through `app.user_options`: options registered under `worker`, `beat` or `events` are appended to those commands, and `preload` options to every command. `handle_preload_options` collects the preload values and sends the `user_preload_options` signal before the command runs, so a receiver can configure the app from them.

Sources: [celery/bin/celery.py:157-162](repo://celery/bin/celery.py#L157-L162), [celery/bin/base.py:143-160](repo://celery/bin/base.py#L143-L160)

`CeleryOption` adds a `help_group` (options are listed under section headings in `--help`) and a default taken from the context. `CeleryDaemonCommand` adds the daemon options `--logfile`, `--pidfile`, `--uid`, `--gid`, `--umask` and `--executable` to `worker`, `beat` and `events`; each falls back to a setting named after the command, such as `worker_pidfile`. Parameter types convert comma-separated lists, JSON arrays and objects, ISO 8601 datetimes (or floats) and log level names.

Sources: [celery/bin/base.py:163-228](repo://celery/bin/base.py#L163-L228), [celery/bin/base.py:230-320](repo://celery/bin/base.py#L230-L320)

## Subcommands

### Command list

| Command | What it does | Page |
| --- | --- | --- |
| `worker` | Start a worker | [[Worker Startup and Bootsteps]] |
| `beat` | Start the periodic task scheduler | [[Periodic Tasks with Beat]] |
| `events` | Curses monitor, event dump or snapshot camera | [[Events and Monitoring]] |
| `multi` | Start, stop and restart several workers | [[Running Multiple Workers and Daemonization]] |
| `inspect`, `control`, `status` | Remote control and inspection of workers | [[Remote Control and Inspection]] |
| `call` | Send a task by name | this page |
| `result` | Print a task's result or traceback | this page |
| `purge` | Delete all messages from task queues | this page |
| `shell` | Python shell with the app and tasks loaded | this page |
| `migrate` | Move task messages between brokers | [[Contrib Extensions]] |
| `amqp` | AMQP administration shell | this page |
| `list bindings` | List queue bindings | this page |
| `report` | Versions and censored settings for bug reports | [[Configuration]] |
| `graph` | Bootstep and worker graphs in dot format | this page |
| `logtool` | Statistics and errors from worker log files | this page |
| `upgrade settings` | Rewrite old setting names | this page |

Sources: [celery/bin/celery.py:164-189](repo://celery/bin/celery.py#L164-L189)

### call and result

`celery call NAME --args '[1, 2]' --kwargs '{"x": 1}'` sends a task by name through `app.send_task`, so the task's code need not be importable, and prints the new id. It accepts `--eta`, `--countdown`, `--expires` (a float or ISO 8601 time), `--serializer` (default JSON) and the routing options `--queue`, `--exchange` and `--routing-key`. `celery result ID` waits for and prints the result; `--traceback` prints the traceback instead and `-t TASK` uses that task's result class and backend.

Sources: [celery/bin/call.py:8-71](repo://celery/bin/call.py#L8-L71), [celery/bin/result.py:7-30](repo://celery/bin/result.py#L7-L30)

### purge

`celery purge` deletes every waiting message in the app's known queues, or only those named with `-Q`, minus those in `-X`. It asks for confirmation unless `-f` is given, purges each queue on a write connection (a queue that does not exist counts as zero), and prints how many messages were removed. There is no undo.

Sources: [celery/bin/purge.py:8-70](repo://celery/bin/purge.py#L8-L70)

### shell

`celery shell` imports the app's task modules and starts IPython, bpython or the plain Python shell (`--ipython`, `--bpython`, `--python`; by default the first one available) with `app`, `celery`, the canvas primitives, `Task` and every non-built-in task in its namespace. `--without-tasks` leaves the tasks out, and `--eventlet` or `--gevent` import the green pool first.

Sources: [celery/bin/shell.py:68-79](repo://celery/bin/shell.py#L68-L79), [celery/bin/shell.py:110-173](repo://celery/bin/shell.py#L110-L173)

### amqp and list

`celery amqp` is a shell for AMQP administration with commands named after the protocol methods: `exchange.declare`, `exchange.delete`, `queue.bind`, `queue.declare`, `queue.delete`, `queue.purge`, `basic.get`, `basic.publish` and `basic.ack`. `celery list bindings` declares the app's queues and prints every binding (queue, exchange, routing key); transports that cannot list bindings give a usage error.

Sources: [celery/bin/amqp.py:61-72](repo://celery/bin/amqp.py#L61-L72), [celery/bin/amqp.py:74-160](repo://celery/bin/amqp.py#L74-L160), [celery/bin/amqp.py:186-300](repo://celery/bin/amqp.py#L186-L300), [celery/bin/list.py:1-38](repo://celery/bin/list.py#L1-L38)

### graph, logtool and upgrade

`celery graph bootsteps` prints the worker and consumer bootstep graphs in dot format, and `celery graph workers` builds a dot graph of workers from `key:value` arguments. `celery logtool` reads worker log files: `stats` reports counts of received, succeeded and failed tasks, `traces` and `errors` print tracebacks and task errors, `incomplete` lists tasks received but never completed, and `debug` prints debug lines. `celery upgrade settings FILE` rewrites a settings module from Celery 3 uppercase names to the new lowercase names, keeping a backup unless `--no-backup` is given; with `--django` or `--compat` it keeps the `CELERY_` prefix for namespaced settings.

Sources: [celery/bin/graph.py:14-60](repo://celery/bin/graph.py#L14-L60), [celery/bin/logtool.py:59-114](repo://celery/bin/logtool.py#L59-L114), [celery/bin/logtool.py:116-157](repo://celery/bin/logtool.py#L116-L157), [celery/bin/upgrade.py:15-91](repo://celery/bin/upgrade.py#L15-L91)
