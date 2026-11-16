---
title: "The celery Command Line"
---
## Overview

The `celery` program is a single click command group. The installed script `celery` calls `celery.__main__:main`, which applies eventlet or gevent monkey patches before anything else is imported, then hands over to the group in `celery.bin.celery`. The group loads the application named by `-A`, wraps it in a `CLIContext`, and dispatches to a subcommand. Most subcommands are small: they build a call on the app (`send_task`, `control.inspect`, `Worker`, `Beat`) and print the result. This page explains the shared machinery and what each subcommand is for; the worker and beat internals are on [[Worker Architecture and Bootsteps]] and [[Periodic Tasks with Beat]].

Sources: [celery/__main__.py:1-14](repo://celery/__main__.py#L1-L14), [setup.py:155-159](repo://setup.py#L155-L159), [celery/bin/celery.py:1-33](repo://celery/bin/celery.py#L1-L33)

## Start-up: patches first

`main()` calls `maybe_patch_concurrency()` unless `multi` is in the arguments. It scans `sys.argv` for `-P` or `--pool`, applies the eventlet or gevent patch if that is the pool value, and imports the pool implementation early. This is why green pools must be chosen on the command line, not through settings (see [[Execution Pools]]).

Sources: [celery/__main__.py:10-14](repo://celery/__main__.py#L10-L14), [celery/__init__.py:123-153](repo://celery/__init__.py#L123-L153)

## The umbrella command

`celery` is a `DYMGroup` (a "did you mean" click group) that also loads plugins: the entry-point group `celery.commands` is read at import time and attached with `with_plugins`, so a package can add a subcommand without patching Celery. The global options, all shown under "Global Options" in help, are:

| Option | Environment variable | Effect |
| --- | --- | --- |
| `-A`, `--app` | `APP` | The app to load |
| `-b`, `--broker` | `BROKER_URL` | Sets `CELERY_BROKER_URL` |
| `--result-backend` | `RESULT_BACKEND` | Sets `CELERY_RESULT_BACKEND` |
| `--loader` | `LOADER` | Sets `CELERY_LOADER` |
| `--config` | `CONFIG_MODULE` | Sets `CELERY_CONFIG_MODULE` |
| `--workdir` | | Changes directory immediately (eager) |
| `-C`, `--no-color` | `NO_COLOR` | Disables colour |
| `-q`, `--quiet` | | Quiet output |
| `--skip-checks` | `SKIP_CHECKS` | Sets `CELERY_SKIP_CHECKS`; skips Django checks |
| `--version` | | Prints the version banner and exits |

Sources: [celery/bin/celery.py:44-112](repo://celery/bin/celery.py#L44-L112), [celery/bin/celery.py:113-154](repo://celery/bin/celery.py#L113-L154)

The function body first handles `--version` and a bare `celery` (which prints help). It exports the broker, backend, loader and config options as environment variables, because the default app and loaders read them from there. A string `-A` goes through `find_app` (see [[Quickstart]]), and failures become readable messages: module not found, an error raised while importing the module (with its traceback), or no app attribute in the module. The result is stored as `ctx.obj = CLIContext(app, no_color, workdir, quiet)`. `CLIContext` provides coloured `echo`, `error`, `pretty` and similar helpers that all honour `--no-color`.

Sources: [celery/bin/celery.py:113-170](repo://celery/bin/celery.py#L113-L170), [celery/bin/base.py:37-122](repo://celery/bin/base.py#L37-L122)

Finally the group appends the app's `user_options` to commands: options registered under `worker`, `beat` and `events` extend those commands, and `preload` options extend every command. This is how application code adds its own flags. `handle_preload_options` wraps a command so that when preload options exist they are collected and sent through the `user_preload_options` signal before the command runs (see [[Signals]]). A monkey-patched `NoSuchOption.show` replaces the confusing click error for `celery worker -A proj` with a message explaining `-A` must come before the subcommand.

Sources: [celery/bin/celery.py:154-166](repo://celery/bin/celery.py#L154-L166), [celery/bin/base.py:143-160](repo://celery/bin/base.py#L143-L160), [celery/bin/celery.py:192-218](repo://celery/bin/celery.py#L192-L218)

Shared option classes keep commands uniform: `CeleryOption` (with a `help_group` so help is grouped and an option default can come from the context), `CeleryCommand` (which prints options under their groups), and `CeleryDaemonCommand`, which adds `--logfile`, `--pidfile`, `--uid`, `--gid`, `--umask` and `--executable`. `DaemonOption` falls back to a setting named after the command, for example `worker_pidfile`. Other parameter types parse comma-separated lists, JSON arrays and objects, ISO 8601 dates and log levels.

Sources: [celery/bin/base.py:163-229](repo://celery/bin/base.py#L163-L229), [celery/bin/base.py:230-329](repo://celery/bin/base.py#L230-L329)

## Subcommands

| Command | What it does |
| --- | --- |
| `worker` | Starts a worker with `app.Worker(...)`, optionally detached; options cover pool, concurrency, queues, autoscale, embedded beat and logging |
| `beat` | Runs the beat scheduler as its own process |
| `events` | `--dump`, `--camera` or the curses monitor; see [[Events and Monitoring]] |
| `call` | Sends a task by name with `app.send_task` and prints the task id; accepts args and kwargs as JSON, `--eta`, `--countdown`, `--expires`, `--serializer`, `--queue`, `--exchange`, `--routing-key` |
| `result` | Prints a task's return value, or its traceback with `--traceback`; uses the task's own `AsyncResult` class if `--task` is given |
| `purge` | Deletes all messages from the known task queues (minus `--exclude-queues`), asking for confirmation unless `-f` |
| `status`, `inspect`, `control` | Remote control from the shell; see [[Remote Control: Inspect and Control]] |
| `list bindings` | Lists queue bindings through the broker's management interface; RabbitMQ needs its management plugin |
| `migrate` | Moves tasks from one broker to another |
| `graph` | Draws graphs of bootsteps and workers |
| `upgrade` | Upgrades settings between versions |
| `logtool` | Reports on log files |
| `amqp` | An AMQP 0.9.1 administration shell |
| `shell` | A REPL with convenient access to Celery symbols |
| `multi` | Starts, stops and restarts several workers (below) |
| `report` | Prints bug-report information; defined in the group module and imports the default modules first |

Sources: [celery/bin/celery.py:167-191](repo://celery/bin/celery.py#L167-L191), [celery/bin/call.py:56-71](repo://celery/bin/call.py#L56-L71), [celery/bin/result.py:15-30](repo://celery/bin/result.py#L15-L30), [celery/bin/purge.py:29-70](repo://celery/bin/purge.py#L29-L70), [celery/bin/list.py:11-38](repo://celery/bin/list.py#L11-L38), [celery/bin/migrate.py:49-63](repo://celery/bin/migrate.py#L49-L63), [celery/bin/upgrade.py:16-20](repo://celery/bin/upgrade.py#L16-L20), [celery/bin/amqp.py:65-70](repo://celery/bin/amqp.py#L65-L70), [celery/bin/shell.py:123-127](repo://celery/bin/shell.py#L123-L127)

The remote-control commands are generated rather than hand-written: `celery inspect` and `celery control` take a command name, check it against the `Panel` registry's metadata for that type, parse the arguments using each command's declared `args` and `signature`, and print replies from `inspect` or `broadcast`. `status` pings the workers and reports how many answered.

Sources: [celery/bin/control.py:16-128](repo://celery/bin/control.py#L16-L128), [celery/worker/control.py:39-77](repo://celery/worker/control.py#L39-L77)

## The worker command

`celery worker` is the richest command. Its options include `-l/--loglevel`, `-c/--concurrency`, `-P/--pool`, `-Q/--queues`, `--autoscale`, `-B/--beat` with `--schedule-filename` and `--scheduler`, plus daemonization options. Extra arguments after the options are parsed as `key=value` settings in the `worker` namespace (`config_from_cmdline`), and a failure to parse raises a usage error. `-B` is refused on Windows. `--detach` re-executes `python -m celery ...` without the detach flag through `detach(...)`.

Sources: [celery/bin/worker.py:162-258](repo://celery/bin/worker.py#L162-L258), [celery/bin/worker.py:307-371](repo://celery/bin/worker.py#L307-L371)

## celery multi

`celery multi` does not go through click. It runs a `MultiTool`: `start`, `stop`, `stopwait`, `restart`, `kill`, `show`, `names`, `get`, `expand` and `help`. Arguments are parsed by `NamespacedOptionParser`, where options prefixed with a node name (for example `-c:1 3`) apply to a single node, and `MultiParser` expands names and ranges into `Node` objects. Each `Node` builds a `celery worker` command line with defaults (hostname, pidfile and logfile templates), starts it as a subprocess and later stops it by sending a signal to the pid read from its pidfile. A `Cluster` coordinates the nodes; `stop` waits for them to stop, signalling with `SIGTERM` by default or another signal named by the `-<SIG>` argument.

Sources: [celery/bin/multi.py:139-170](repo://celery/bin/multi.py#L139-L170), [celery/bin/multi.py:226-345](repo://celery/bin/multi.py#L226-L345), [celery/apps/multi.py:70-125](repo://celery/apps/multi.py#L70-L125), [celery/apps/multi.py:192-285](repo://celery/apps/multi.py#L192-L285)
