---
title: "Command-Line Interface"
---
## Overview

Everything Celery runs from a shell goes through one `celery` command built with click. The `celery` group parses the global options, loads the app named by `-A`, and hands a `CLIContext` to the subcommand: `worker`, `beat`, `events`, `multi`, the remote control commands, and a set of utilities for sending tasks, reading results, purging queues and inspecting the broker. Plugins can add subcommands through the `celery.commands` entry point. This page covers the shared machinery and each subcommand; the worker and beat programs themselves are described in [[Worker Startup and Bootsteps]] and [[Periodic Tasks with Beat]], and `celery multi` in [[Daemonization and celery multi]].

Sources: [celery/bin/celery.py:1-80](repo://celery/bin/celery.py#L1-L80), [celery/bin/celery.py:166-227](repo://celery/bin/celery.py#L166-L227)

## Entry point

`celery.__main__:main` applies eventlet or gevent monkey patching when `-P/--pool` asks for it (except for `celery multi`, which only spawns other processes), then calls `celery.bin.celery.main()`, which runs the group with `auto_envvar_prefix="CELERY"` so options can also come from `CELERY_*` environment variables. `app.start(argv)` runs the same group with a given app.

Sources: [celery/__main__.py:1-19](repo://celery/__main__.py#L1-L19), [celery/bin/celery.py:221-227](repo://celery/bin/celery.py#L221-L227), [celery/app/base.py:480-497](repo://celery/app/base.py#L480-L497)

## Global options

| Option | Environment | Effect |
| --- | --- | --- |
| `-A`, `--app` | `APP` | App to load (`module`, `module:attr` or `module.attr`) |
| `-b`, `--broker` | `BROKER_URL` | Sets `CELERY_BROKER_URL` |
| `--result-backend` | `RESULT_BACKEND` | Sets `CELERY_RESULT_BACKEND` |
| `--loader` | `LOADER` | Sets `CELERY_LOADER` |
| `--config` | `CONFIG_MODULE` | Sets `CELERY_CONFIG_MODULE` |
| `--workdir` | | `chdir` before anything else (eager option) |
| `-C`, `--no-color` | `NO_COLOR` | Plain output |
| `-q`, `--quiet` | | Less output |
| `--version` | | Print the version banner |
| `--skip-checks` | `SKIP_CHECKS` | Skip Django checks (sets `CELERY_SKIP_CHECKS`) |

Sources: [celery/bin/celery.py:55-110](repo://celery/bin/celery.py#L55-L110), [celery/bin/celery.py:113-128](repo://celery/bin/celery.py#L113-L128)

The group sets those environment variables rather than touching configuration directly, so the app's settings object picks them up when it is configured ([[Configuration and Loaders]]). It then resolves `--app` with `find_app`, printing a specific message for a missing module, an error raised while importing it, or a missing attribute. With no subcommand it prints help.

Sources: [celery/bin/celery.py:113-150](repo://celery/bin/celery.py#L113-L150), [celery/app/utils.py:378-415](repo://celery/app/utils.py#L378-L415)

Because `-A` is a global option, `celery worker -A proj` is wrong since 5.0; click's "no such option" error is patched to explain that the app option must come before the subcommand.

Sources: [celery/bin/celery.py:189-218](repo://celery/bin/celery.py#L189-L218)

## Shared CLI machinery

### CLIContext

`ctx.obj` is a `CLIContext` holding the app (or the current app), `no_color`, `quiet` and `workdir`. Its `echo`, `secho` and `error` honour `--no-color`, `pretty()` renders replies (lists as bullets, `{'ok': ...}`/`{'error': ...}` with OK/ERROR labels, other dicts as highlighted JSON when pygments is available), and `say_chat` prints the request/reply arrows used by remote control commands.

Sources: [celery/bin/base.py:37-121](repo://celery/bin/base.py#L37-L121)

`handle_remote_command_error` turns a broker `OperationalError` into "Could not connect to the message broker ..." and any other failure into "Unable to run the `<command>` command", both with exit code `EX_UNAVAILABLE`.

Sources: [celery/bin/base.py:123-140](repo://celery/bin/base.py#L123-L140)

### Options, commands and daemon options

`CeleryOption` adds a `help_group` (used by `CeleryCommand.format_options` to print options in sections such as "Worker Options") and can take its default from the context. `CeleryDaemonCommand` adds `--logfile/-f`, `--pidfile`, `--uid`, `--gid`, `--umask` and `--executable`; each `DaemonOption` falls back to a setting named after the command, such as `worker_pidfile` or `beat_logfile`.

Sources: [celery/bin/base.py:163-227](repo://celery/bin/base.py#L163-L227)

Parameter types convert arguments: `COMMA_SEPARATED_LIST`, `JSON_ARRAY`, `JSON_OBJECT` (which fail with a clear message for non-JSON or the wrong type), `ISO8601` and `ISO8601_OR_FLOAT` dates, and `LOG_LEVEL`, a case-insensitive choice of `DEBUG` to `FATAL` converted to a logging level.

Sources: [celery/bin/base.py:230-329](repo://celery/bin/base.py#L230-L329)

### User options

Apps can add click options to `app.user_options['worker']`, `['beat']`, `['events']` or `['preload']`; the group appends them to those commands (preload options to every command). `handle_preload_options` collects preload option values and sends the `user_preload_options` signal with them before the command runs ([[Signals]]).

Sources: [celery/bin/celery.py:150-155](repo://celery/bin/celery.py#L150-L155), [celery/bin/base.py:143-158](repo://celery/bin/base.py#L143-L158)

## Subcommands

### Programs

| Command | Does | Page |
| --- | --- | --- |
| `worker` | Start a worker | [[Worker Startup and Bootsteps]] |
| `beat` | Start the periodic task scheduler | [[Periodic Tasks with Beat]] |
| `events` | Curses monitor, `--dump`, or `-c` snapshot camera | [[Events and Monitoring]] |
| `multi` | Start, stop and restart many workers | [[Daemonization and celery multi]] |
| `inspect`, `control`, `status` | Remote control and inspection | [[Remote Control and Inspection]] |

Sources: [celery/bin/celery.py:166-182](repo://celery/bin/celery.py#L166-L182)

### call, result, purge

`celery call NAME` sends a task by name with `app.send_task`, taking `-a/--args` as a JSON array, `-k/--kwargs` as a JSON object, `--eta`, `--countdown`, `--expires`, `--serializer`, `--queue`, `--exchange` and `--routing-key`, and prints the task id. The worker does not need to be importable locally.

Sources: [celery/bin/call.py:8-71](repo://celery/bin/call.py#L8-L71)

`celery result TASK_ID` builds an `AsyncResult` (with `-t/--task` it uses that task's result class and backend) and prints `get()`, or the stored traceback with `--traceback`.

Sources: [celery/bin/result.py:7-30](repo://celery/bin/result.py#L7-L30)

`celery purge` purges every queue in `app.amqp.queues`, or those given with `-Q`, minus `-X`, after a confirmation prompt that `-f/--force` skips, and reports how many messages were removed. Channel errors for a queue count as zero messages. There is no undo.

Sources: [celery/bin/purge.py:8-68](repo://celery/bin/purge.py#L8-L68)

### shell

`celery shell` imports the task modules and opens an interactive shell with `app`/`celery`, `Task`, the canvas primitives and every non-built-in task by its function name in the namespace (`-T` leaves the tasks out). It uses IPython, bpython or the standard Python REPL (`-I`, `-B`, `--python`), and `--eventlet`/`--gevent` import that pool module first so patching applies.

Sources: [celery/bin/shell.py:82-173](repo://celery/bin/shell.py#L82-L173)

### Broker utilities

`celery list bindings` declares the task queues and prints the broker's queue bindings (RabbitMQ needs the management plugin). `celery amqp` is an administration shell with commands such as `exchange.declare`, `queue.declare`, `queue.bind`, `queue.purge`, `basic.get`, `basic.publish` and `basic.ack`; its docstring notes it also works on non-AMQP transports that do not keep declarations in memory.

Sources: [celery/bin/list.py:10-38](repo://celery/bin/list.py#L10-L38), [celery/bin/amqp.py:64-72](repo://celery/bin/amqp.py#L64-L72), [celery/bin/amqp.py:74-90](repo://celery/bin/amqp.py#L74-L90), [celery/bin/amqp.py:236-300](repo://celery/bin/amqp.py#L236-L300)

`celery migrate SOURCE DESTINATION` moves task messages from one broker URL to another with `contrib.migrate.migrate_tasks`, with `--limit`, `--timeout`, `--ack-messages`, `--tasks`, `--queues` and `--forever`. The docstring calls it experimental and asks for a backup first.

Sources: [celery/bin/migrate.py:9-63](repo://celery/bin/migrate.py#L9-L63)

### Diagnostics

| Command | Does |
| --- | --- |
| `report` | Imports task modules and prints `app.bugreport()` (versions, transport, settings with secrets masked) |
| `graph bootsteps [worker] [consumer]` | Writes the bootstep dependency graph as Graphviz dot |
| `graph workers` | Writes a dot graph of the workers, with thread nodes per worker |
| `logtool stats/traces/errors/incomplete/debug FILES` | Parses worker log files: totals per state, tracebacks, error lines, tasks received but never completed, debug lines |
| `upgrade settings FILE` | Rewrites old upper-case setting names to the new names (`--django` or `--compat` keeps a `CELERY_`-prefixed upper-case form), backing the file up unless `--no-backup` |

Sources: [celery/bin/celery.py:158-164](repo://celery/bin/celery.py#L158-L164), [celery/bin/graph.py:14-80](repo://celery/bin/graph.py#L14-L80), [celery/bin/logtool.py:116-157](repo://celery/bin/logtool.py#L116-L157), [celery/bin/upgrade.py:15-90](repo://celery/bin/upgrade.py#L15-L90)
