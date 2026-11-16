---
title: "Command-Line Interface"
---
## Overview

Everything Celery runs from a terminal goes through one `celery` command: workers, beat, monitors, and tools for calling tasks, reading results, inspecting workers and administering the broker. It is a click application in `celery.bin`. The root group loads the app named by `-A` and stores it in a context object that every subcommand reads; each subcommand lives in its own module.

Sources: [celery/bin/celery.py:55-163](repo://celery/bin/celery.py#L55-L163), [celery/bin/celery.py:175-191](repo://celery/bin/celery.py#L175-L191), [celery/bin/base.py:37-45](repo://celery/bin/base.py#L37-L45)

## The root command

### Entry point

The `celery` console script runs `celery.__main__:main`, which applies eventlet or gevent monkey patching when `-P` asks for it (except for `celery multi`) and then calls the click group with `auto_envvar_prefix="CELERY"`, so options can also come from `CELERY_*` environment variables. `app.start(argv)` runs the same group in-process with the app preset.

Sources: [celery/__main__.py:10-15](repo://celery/__main__.py#L10-L15), [celery/bin/celery.py:220-227](repo://celery/bin/celery.py#L220-L227), [celery/app/base.py:480-497](repo://celery/app/base.py#L480-L497)

### Global options

Global options must come before the subcommand (`celery -A proj worker`, not `celery worker -A proj`); using `-A` after the subcommand prints a message explaining the Celery 5 change.

Sources: [celery/bin/celery.py:193-217](repo://celery/bin/celery.py#L193-L217)

| Option | Environment | Effect |
| --- | --- | --- |
| `-A`, `--app` | `CELERY_APP` | App to load (`module`, `module:attr`, or a package with a `celery` module) |
| `-b`, `--broker` | `CELERY_BROKER_URL` | Broker URL, overriding configuration |
| `--result-backend` | `CELERY_RESULT_BACKEND` | Result backend URL |
| `--loader` | `CELERY_LOADER` | Loader class |
| `--config` | `CELERY_CONFIG_MODULE` | Configuration module |
| `--workdir` | | `chdir` before anything else (evaluated eagerly) |
| `-C`, `--no-color` | `NO_COLOR` | Plain output |
| `-q`, `--quiet` | | Less output |
| `--version` | | Print the version banner |
| `--skip-checks` | `CELERY_SKIP_CHECKS` | Skip Django checks at start-up |

Sources: [celery/bin/celery.py:55-111](repo://celery/bin/celery.py#L55-L111)

The group callback turns `--broker`, `--result-backend`, `--loader` and `--config` into environment variables that the app's settings read with priority ([[Configuration and Loaders]]), so they also reach processes the command spawns. It then resolves `-A` with `find_app`, failing with a clear message when the module is missing, the attribute is missing, or importing raised. Finally it creates the `CLIContext` and appends the app's custom options (`app.user_options['worker']`, `['beat']`, `['events']`, `['preload']`) to the subcommands.

Sources: [celery/bin/celery.py:113-163](repo://celery/bin/celery.py#L113-L163), [celery/app/utils.py:378-415](repo://celery/app/utils.py#L378-L415)

### Plugins

Packages can add subcommands by registering click commands under the `celery.commands` entry-point group; they appear alongside the built-in ones. Mistyped commands get "did you mean" suggestions.

Sources: [celery/bin/celery.py:46-56](repo://celery/bin/celery.py#L46-L56)

## Building blocks for commands

### Context and output

`CLIContext` holds the app, colour and quiet flags and the working directory, and offers output helpers: `echo`, `secho`, `error`, `style`, and `pretty`, which formats remote-control replies (`{'ok': ...}` in green, `{'error': ...}` in red, dicts as highlighted JSON).

Sources: [celery/bin/base.py:37-121](repo://celery/bin/base.py#L37-L121)

### Options and types

`CeleryCommand` groups options into titled help sections using each `CeleryOption`'s `help_group`. `CeleryDaemonCommand` adds the daemon options `--logfile/-f`, `--pidfile`, `--uid`, `--gid`, `--umask` and `--executable`; each falls back to a setting named after the command (`worker_pidfile`, `beat_logfile`). Parameter types parse JSON arrays and objects, ISO 8601 datetimes, comma-separated lists and log levels.

Sources: [celery/bin/base.py:163-227](repo://celery/bin/base.py#L163-L227), [celery/bin/base.py:230-329](repo://celery/bin/base.py#L230-L329)

### Preload options and errors

`@handle_preload_options` collects the values of app-defined preload options and sends the `user_preload_options` signal before the command body runs, so an app can react to its own CLI flags. `handle_remote_command_error` turns broker connection failures into a readable message with exit code `EX_UNAVAILABLE`.

Sources: [celery/bin/base.py:123-160](repo://celery/bin/base.py#L123-L160)

## Subcommands

### Running services

| Command | Runs | Page |
| --- | --- | --- |
| `worker` | A worker node | [[Worker Startup and Bootsteps]] |
| `beat` | The periodic task scheduler | [[Periodic Tasks with Beat]] |
| `events` | The curses monitor, event dumper or snapshot camera | [[Events and Monitoring]] |
| `multi` | Several worker nodes as daemons | [[Running Multiple Workers with celery multi]] |

Sources: [celery/bin/celery.py:175-191](repo://celery/bin/celery.py#L175-L191)

### Working with tasks and results

| Command | Does |
| --- | --- |
| `call NAME [-a JSON] [-k JSON] [--countdown/--eta/--expires] [--queue/--exchange/--routing-key]` | `app.send_task` and print the task id |
| `result TASK_ID [-t NAME] [--traceback]` | Wait for and print a task's result or traceback |
| `purge [-f] [-Q queues] [-X queues]` | Delete all messages from task queues, after confirmation |
| `migrate SOURCE DEST [-n limit] [-Q queues] [-T tasks]` | Move task messages from one broker to another |

Sources: [celery/bin/call.py:8-69](repo://celery/bin/call.py#L8-L69), [celery/bin/result.py:7-29](repo://celery/bin/result.py#L7-L29), [celery/bin/purge.py:8-70](repo://celery/bin/purge.py#L8-L70), [celery/bin/migrate.py:9-55](repo://celery/bin/migrate.py#L9-L55)

`purge` asks for confirmation unless `-f` is given, purges each selected queue by name with `queue_purge` (ignoring missing queues), and reports how many messages were removed. `call` works with any task name, registered locally or not, because it uses `send_task` ([[Publishing Task Messages]]).

Sources: [celery/bin/purge.py:31-70](repo://celery/bin/purge.py#L31-L70), [celery/bin/call.py:56-69](repo://celery/bin/call.py#L56-L69)

### Talking to workers

| Command | Does |
| --- | --- |
| `status` | Ping all workers and list those that answer |
| `inspect COMMAND` | Run an inspect command (`active`, `stats`, `registered`…) |
| `control COMMAND` | Run a control command (`rate_limit`, `add_consumer`, `shutdown`…) |

Sources: [celery/bin/control.py:107-151](repo://celery/bin/control.py#L107-L151), [celery/bin/control.py:153-262](repo://celery/bin/control.py#L153-L262)

These are described in [[Remote Control and Inspection]].

Sources: [celery/bin/control.py:153-186](repo://celery/bin/control.py#L153-L186)

### Development and administration

| Command | Does |
| --- | --- |
| `shell [--ipython/--bpython/--python] [-T]` | Interactive shell with `app`, canvas primitives and all non-built-in tasks preloaded |
| `report` | Versions, platform and non-default settings for bug reports |
| `list bindings` | Show queue bindings on the broker |
| `amqp` | AMQP administration shell (`exchange.declare`, `queue.bind`, `basic.publish`…) |
| `graph bootsteps` / `graph workers` | Print the worker's bootstep graph or the cluster as Graphviz dot |
| `logtool stats/traces/errors/incomplete/debug FILES` | Analyse worker log files |
| `upgrade settings FILE [--django]` | Rewrite old upper-case setting names to the new names |

Sources: [celery/bin/shell.py:120-173](repo://celery/bin/shell.py#L120-L173), [celery/bin/celery.py:166-172](repo://celery/bin/celery.py#L166-L172), [celery/bin/list.py:7-30](repo://celery/bin/list.py#L7-L30), [celery/bin/amqp.py:61-140](repo://celery/bin/amqp.py#L61-L140), [celery/bin/graph.py:11-40](repo://celery/bin/graph.py#L11-L40), [celery/bin/logtool.py:113-157](repo://celery/bin/logtool.py#L113-L157), [celery/bin/upgrade.py:12-80](repo://celery/bin/upgrade.py#L12-L80)

The shell's `-T`/`--without-tasks` skips adding tasks to the namespace, and `--eventlet`/`--gevent` import the matching pool module first so its patches apply.

Sources: [celery/bin/shell.py:120-160](repo://celery/bin/shell.py#L120-L160)

## Exit codes

Commands exit with the worker's exit code, with `EX_UNAVAILABLE` when no worker answers a remote command or the broker is unreachable, and with click's usage error code for bad arguments. A `CeleryCommandException` carries its own exit code.

Sources: [celery/bin/worker.py:366-371](repo://celery/bin/worker.py#L366-L371), [celery/bin/base.py:123-140](repo://celery/bin/base.py#L123-L140), [celery/exceptions.py:307-312](repo://celery/exceptions.py#L307-L312)
