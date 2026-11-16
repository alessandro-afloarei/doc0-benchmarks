---
type: operations
title: Command-Line Interface and Process Entrypoints
description: How the celery umbrella command is assembled from Click groups and subcommands, how it resolves the application and loads user options, which subcommands run worker, beat, events, remote control, and broker tooling, and how the worker, beat, and multi entrypoints start their processes.
tags: [celery, cli, click, worker, beat, multi, control, inspect, operations]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:42:35.525Z
sources:
  - id: openwiki-source-965d19cff645fcce36529be3
    resource: repo://celery/__main__.py
  - id: openwiki-source-4e8c69ddbd86a82c3201bc63
    resource: repo://celery/bin/celery.py
  - id: openwiki-source-bbacf43535335f110ab87e0d
    resource: repo://celery/bin/control.py
  - id: openwiki-source-5d9e0c235c9d77c7d6937cbd
    resource: repo://celery/bin/multi.py
generated: { by: "claude-code", at: "2026-11-16T10:42:35.525Z" }
---

# Command-Line Interface and Process Entrypoints

The `celery` command is a Click program. Its root group lives in `celery/bin/celery.py`, each subcommand lives in its own module under `celery/bin/`, and the process-level wrappers that actually start a worker or beat live in `celery/apps/`. The console script is `celery.__main__:main`, which first applies eventlet or gevent patching when needed and then calls the Click entrypoint (see [system overview](../architecture/overview.md)).

## Entrypoint and root group

`celery/__main__.py` defines `main`. Unless the first argument is `multi`, it calls `maybe_patch_concurrency()` so that eventlet or gevent monkeypatching happens before anything else is imported. It then calls `celery.bin.celery.main`, which runs the root `celery` group with `auto_envvar_prefix="CELERY"`.

The root group (`celery/bin/celery.py`, decorated at line 56 with `DYMGroup`, which offers "did you mean" suggestions) takes global options:

- `-A/--app` (environment variable `APP`) names the application to load;
- `-b/--broker`, `--result-backend`, and `--loader` override connection and loader settings;
- `--config`, `--workdir` (which `chdir`s before loading), `--no-color`, `--quiet`, `--version`, and `--skip-checks`.

When no subcommand is given, the group prints its help. With `--version`, it prints the version banner. The app is loaded at this point. If loading fails, the command reports that the application could not be loaded and exits with a failure status.

After the app is loaded, the root group stores a `CLIContext` on `ctx.obj` and extends the parameters of `worker`, `beat`, and `events`, plus every subcommand's `preload` options, from the app's `user_options`. This is how applications add their own command-line flags (see [application](../architecture/application.md)).

## Subcommands

`celery/bin/celery.py` registers these subcommands (lines 175–191) and the `report` command (line 166):

| Command | Module | Purpose |
|---|---|---|
| `worker` | `celery/bin/worker.py` | Start a worker process (see [worker](../architecture/worker.md)) |
| `beat` | `celery/bin/beat.py` | Start the periodic-task scheduler (see [beat](../architecture/beat.md)) |
| `events` | `celery/bin/events.py` | Dump, capture, or display the event stream (`--dump`, `--camera`, `--frequency`) |
| `multi` | `celery/bin/multi.py` | Start, stop, restart, and manage several named worker processes |
| `status` | `celery/bin/control.py` | Show the status of reachable workers |
| `inspect` | `celery/bin/control.py` | Run read-only inspect commands against workers |
| `control` | `celery/bin/control.py` | Run remote control commands (revoke, rate limit, pool grow or shrink, shutdown) |
| `call` | `celery/bin/call.py` | Send a task by name with arguments, ETA, expiry, and routing options |
| `result` | `celery/bin/result.py` | Show a stored result for a task ID |
| `purge` | `celery/bin/purge.py` | Remove messages from queues, with confirmation unless `--force` |
| `list` | `celery/bin/list.py` | List queue bindings |
| `amqp` | `celery/bin/amqp.py` | Low-level AMQP operations: declare and delete exchanges and queues, publish, get, ack |
| `graph` | `celery/bin/graph.py` | Render the canvas or dependency graph |
| `migrate` | `celery/bin/migrate.py` | Move messages from one broker to another |
| `upgrade` | `celery/bin/upgrade.py` | Rewrite old setting names in configuration files |
| `logtool` | `celery/bin/logtool.py` | Analyse worker log files |
| `shell` | `celery/bin/shell.py` | Open an interactive shell with the app loaded |

`status`, `inspect`, and `control` share the remote-control machinery in `celery/bin/control.py`. Command names are checked against the registered worker commands (`_verify_command_name`), and `_list_option` lists the available names. The commands send messages through the broadcast mailbox and print replies, which are handled by the worker's `Pidbox` (see [worker](../architecture/worker.md)).

Base behaviour common to most subcommands lives in `celery/bin/base.py`. `CeleryCommand` supplies formatted help and options. `CeleryOption` reads defaults from configuration. `CeleryDaemonCommand` adds the `--detach`, `--logfile`, `--pidfile`, `--uid`, and `--gid` options used by long-running commands. `CLIContext` provides coloured output helpers, and `handle_preload_options` runs the `preload` option handlers before a command body.

## Worker and beat entrypoints

`celery worker` (`celery/bin/worker.py`, decorated at line 136) parses worker options, including `-P/--pool` (default `prefork`), `-c/--concurrency`, `-Q/--queues`, `-B/--beat`, `--autoscale`, `-n/--hostname`, and `--without-*` flags. It builds a `Worker` from `celery/apps/worker.py` and starts it. `celery/apps/worker.py` installs the signal handlers that implement warm, cold, and hard shutdown, and it sets the process title.

`celery beat` (`celery/bin/beat.py`, decorated at line 10) and `celery/apps/beat.py` build the scheduler service. The scheduler class and schedule filename can be set on the command line or through `beat_scheduler` and `beat_schedule_filename`.

## Multi

`celery multi` (`celery/bin/multi.py`, command at line 463) manages a cluster of named workers. `NamespacedOptionParser` (line 70) parses per-node options in the `name@host` style, `MultiParser` (line 285) splits the argument list into node sections, and `Cluster` (line 367) and `Node` (line 122) start and stop the processes. `MultiTool` (line 226) implements the actions. `celery/apps/multi.py` contains the process-level helpers it uses.

## Invariants and failure behaviour

- The app is loaded once, in the root group, before any subcommand runs; subcommands receive it through `ctx.obj`.
- Preload options and user options are merged into command parameters before parsing, so applications can extend the CLI without changing Celery.
- A failed app load stops the command before any worker or beat process starts.
- Remote commands use the same mailbox as the worker, so they reach only workers that are running and listening on the broadcast exchange.

## Extension seams

- Register a third-party subcommand through the `celery.commands` entry-point group; the root group loads it alongside the built-in commands.
- Add flags to the built-in commands through `app.user_options` (keys `worker`, `beat`, `events`, `preload`).
- Subclass `CeleryCommand` or `CeleryDaemonCommand` to get Celery's help and daemon behaviour in a new command.

## Representative tests

`t/unit/bin/` contains tests for each subcommand module, and `t/unit/apps/` covers the worker and beat process wrappers. `t/integration/test_inspect.py` exercises the remote-control commands against a live worker.
