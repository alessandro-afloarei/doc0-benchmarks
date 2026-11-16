---
title: "Command-Line Interface"
---
## Overview

`celery` is a single umbrella command built with `click`: global options select and configure the app, and subcommands run a worker, beat, a monitor, or a one-off operation. The console script points at `celery.__main__:main`, which applies eventlet or gevent monkey-patching first (if `-P eventlet` or `-P gevent` appears in the arguments, except for `celery multi`) and then runs the click group with the environment-variable prefix `CELERY`.

Sources: [celery/__main__.py:10-15](repo://celery/__main__.py#L10-L15), [celery/bin/celery.py:220-227](repo://celery/bin/celery.py#L220-L227)

`app.start(argv)` runs the same command with an app already chosen (see [[The Celery Application]]). Worker, beat and multi have pages of their own: [[Worker Startup and Bootsteps]], [[Periodic Tasks with Beat]] and [[Running Multiple Workers]].

Sources: [celery/app/base.py:480-497](repo://celery/app/base.py#L480-L497)

## Global options

### Option list

| Option | Environment | Effect |
| --- | --- | --- |
| `-A`, `--app` | `APP` | Module or `module:attr` of the app; resolved by `find_app` |
| `-b`, `--broker` | `BROKER_URL` | Sets `CELERY_BROKER_URL` |
| `--result-backend` | `RESULT_BACKEND` | Sets `CELERY_RESULT_BACKEND` |
| `--loader` | `LOADER` | Sets `CELERY_LOADER` |
| `--config` | `CONFIG_MODULE` | Sets `CELERY_CONFIG_MODULE` |
| `--workdir` | — | `chdir` before anything else |
| `-C`, `--no-color` | `NO_COLOR` | Disable colours |
| `-q`, `--quiet` | — | Less output |
| `--skip-checks` | `SKIP_CHECKS` | Skip Django checks on startup |
| `--version` | — | Print version and exit |

Sources: [celery/bin/celery.py:54-111](repo://celery/bin/celery.py#L54-L111)

Because `main` uses the `CELERY` prefix, the environment names above are read as `CELERY_APP`, `CELERY_BROKER_URL` and so on. The options mostly work by setting environment variables that the configuration reads later, so they apply to whatever app is loaded.

Sources: [celery/bin/celery.py:113-135](repo://celery/bin/celery.py#L113-L135), [celery/app/utils.py:84-111](repo://celery/app/utils.py#L84-L111)

### Loading the app

When `-A` is a string, the group imports it with `find_app` and fails with a red message that distinguishes a missing module, a module that raised during import (with its traceback), and a missing attribute. It then builds a `CLIContext` with the app, colour and quiet flags, and adds the app's custom options (`app.user_options['worker']`, `['beat']`, `['events']`, `['preload']`) to the matching commands. Passing `-A` after the subcommand, as Celery 4 allowed, shows an explanation that it must now come before.

Sources: [celery/bin/celery.py:136-163](repo://celery/bin/celery.py#L136-L163), [celery/bin/celery.py:194-217](repo://celery/bin/celery.py#L194-L217)

### Plugins

Commands registered in the `celery.commands` entry-point group are added to the group with `click-plugins`, and `click-didyoumean` suggests close matches for mistyped commands.

Sources: [celery/bin/celery.py:46-55](repo://celery/bin/celery.py#L46-L55)

## Command building blocks

### CLIContext

Every command receives `ctx.obj`, a `CLIContext` with the app and helpers for output that respect `--no-color` and `--quiet`: `echo`, `secho`, `error`, `style`, and `pretty`, which renders lists, `{'ok': ...}`/`{'error': ...}` replies and dicts (highlighted as JSON when `pygments` is installed).

Sources: [celery/bin/base.py:35-140](repo://celery/bin/base.py#L35-L140)

### Options and types

`CeleryOption` adds a `help_group` so `CeleryCommand` can print options in titled sections. `CeleryDaemonCommand` adds the daemon options `--logfile`/`-f`, `--pidfile`, `--uid`, `--gid`, `--umask` and `--executable`; each falls back to a setting named after the command (for example `worker_pidfile`). Parameter types parse comma-separated lists, JSON arrays and objects, ISO 8601 dates (optionally or a float), and log level names.

Sources: [celery/bin/base.py:163-238](repo://celery/bin/base.py#L163-L238), [celery/bin/base.py:240-329](repo://celery/bin/base.py#L240-L329)

`handle_preload_options` sends the `user_preload_options` signal with the values of the app's custom preload options before the command runs. `handle_remote_command_error` turns broker connection failures into a clear "Could not connect to the message broker" error with exit code `EX_UNAVAILABLE`.

Sources: [celery/bin/base.py:143-160](repo://celery/bin/base.py#L143-L160), [celery/bin/base.py:121-140](repo://celery/bin/base.py#L121-L140)

## Subcommands

### Catalogue

| Command | Purpose |
| --- | --- |
| `worker` | Start a worker |
| `beat` | Start the periodic task scheduler |
| `multi` | Start, stop and restart several workers |
| `events` | Curses monitor, event dump or snapshot camera |
| `inspect`, `control`, `status` | Remote control commands and worker ping |
| `call` | Send a task by name |
| `result` | Print a task's result or traceback |
| `purge` | Delete all messages from task queues |
| `list bindings` | List queue bindings from the broker |
| `amqp` | AMQP administration shell |
| `shell` | Python shell with the app and tasks imported |
| `graph bootsteps`, `graph workers` | Print graphs in dot format |
| `logtool` | Analyse worker log files |
| `migrate` | Move messages from one broker to another |
| `upgrade settings` | Rewrite old setting names |
| `report` | Print bug-report information |

Sources: [celery/bin/celery.py:165-186](repo://celery/bin/celery.py#L165-L186)

The remote control commands are described on [[Remote Control and Inspection]], `celery events` on [[Cluster State from Events]].

Sources: [celery/bin/control.py:129-150](repo://celery/bin/control.py#L129-L150), [celery/bin/events.py:83-98](repo://celery/bin/events.py#L83-L98)

### call and result

`celery call <name> -a '[1, 2]' -k '{"x": 1}'` sends a task through `app.send_task` with optional `--eta`, `--countdown`, `--expires`, `--serializer`, `--queue`, `--exchange` and `--routing-key`, and prints the task id. `celery result <id>` waits for and prints the result, or the traceback with `--traceback`; `-t <task>` uses that task's result class.

Sources: [celery/bin/call.py:10-71](repo://celery/bin/call.py#L10-L71), [celery/bin/result.py:9-30](repo://celery/bin/result.py#L9-L30)

### purge

`celery purge` deletes all messages from the known task queues, or those given with `-Q`, minus `-X`. It asks for confirmation unless `-f` is given, since there is no undo, and reports how many messages were removed.

Sources: [celery/bin/purge.py:11-70](repo://celery/bin/purge.py#L11-L70)

### shell, graph, list and amqp

`celery shell` imports the default modules and starts IPython, bpython or the plain Python shell with `app`, `celery`, the canvas primitives and every registered (non built-in) task in scope; `--eventlet`/`--gevent` import the corresponding pool first. `celery graph bootsteps` prints the worker and consumer bootstep graphs, and `graph workers` a graph of the cluster. `celery list bindings` declares the task queues and prints the broker's queue bindings when the transport can list them. `celery amqp` offers subcommands such as `queue.declare`, `queue.purge`, `exchange.declare`, `basic.publish` and `basic.get` for direct broker administration.

Sources: [celery/bin/shell.py:120-173](repo://celery/bin/shell.py#L120-L173), [celery/bin/graph.py:14-34](repo://celery/bin/graph.py#L14-L34), [celery/bin/list.py:18-38](repo://celery/bin/list.py#L18-L38), [celery/bin/amqp.py:64-72](repo://celery/bin/amqp.py#L64-L72)

### logtool

`celery logtool stats|traces|errors|incomplete|debug <files>` parses worker log files: summary statistics, tracebacks, task errors, tasks received but never completed, and debug output.

Sources: [celery/bin/logtool.py:113-157](repo://celery/bin/logtool.py#L113-L157)

### migrate

`celery migrate <source-url> <dest-url>` moves messages between brokers; the docstring marks it experimental and advises a backup. It calls `celery.contrib.migrate.migrate_tasks`, which consumes the source queues and republishes each message to the destination, optionally renaming queues and filtering by task name, and declares the destination queues with the new names.

Sources: [celery/bin/migrate.py:48-63](repo://celery/bin/migrate.py#L48-L63), [celery/contrib/migrate.py:99-118](repo://celery/contrib/migrate.py#L99-L118)

`celery.contrib.migrate` also provides `move(predicate, ...)` and helpers such as `move_task_by_id` and `move_by_taskmap` for moving selected messages to another queue from Python.

Sources: [celery/contrib/migrate.py:127-140](repo://celery/contrib/migrate.py#L127-L140), [celery/contrib/migrate.py:358-407](repo://celery/contrib/migrate.py#L358-L407)

### upgrade settings

`celery upgrade settings <file>` rewrites old-style setting names (`CELERY_...`) to the new lower-case names using the same mapping the configuration uses, keeping a backup unless `--no-backup`; `--django` and `--compat` keep a `CELERY_` prefix suitable for Django settings. See [[Configuration and Loaders]].

Sources: [celery/bin/upgrade.py:25-90](repo://celery/bin/upgrade.py#L25-L90)
