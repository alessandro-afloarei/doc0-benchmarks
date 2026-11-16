---
type: reference
title: Command-Line Interface
description: The click-based `celery` umbrella command. Covers the entry point and early eventlet/gevent patching, global options and their environment variables, app discovery for -A, the subcommands (worker, beat, events, inspect/control, call, purge, result, multi, and others), daemon options, and how user and preload options or plugin commands extend it.
tags: [cli, click, worker, multi, commands, daemonization]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:49.645Z
sources:
  - id: openwiki-source-39b293cb4d26aec690dfc284
    resource: repo://celery/__init__.py
  - id: openwiki-source-965d19cff645fcce36529be3
    resource: repo://celery/__main__.py
  - id: openwiki-source-ceca684addb7674df2c5c60b
    resource: repo://celery/app/utils.py
  - id: openwiki-source-bffba2579250d110123dbe63
    resource: repo://celery/apps/multi.py
  - id: openwiki-source-a437e97c9a2828206c6e0b16
    resource: repo://celery/bin/base.py
  - id: openwiki-source-4e8c69ddbd86a82c3201bc63
    resource: repo://celery/bin/celery.py
  - id: openwiki-source-6de531038635a55bb6fb085b
    resource: repo://celery/bin/worker.py
generated: { by: "claude-code", at: "2026-11-15T17:08:49.645Z" }
---

# Command-Line Interface

The `celery` console script maps to `celery.__main__:main` (`setup.py`). The CLI is built with **click** in `celery/bin/`. Long-running programs are implemented in `celery/apps/` (`worker.py`, `beat.py`, `multi.py`).

## Start-up sequence

1. `celery/__main__.py:main()` calls `maybe_patch_concurrency()` first, unless the command is `multi`. This function scans `sys.argv` for `-P` or `--pool`. If the value is `eventlet` or `gevent`, it applies that library's monkey-patching **before** anything else is imported, as green pools require.
2. `celery.bin.celery.main()` runs the root click group with `auto_envvar_prefix="CELERY"`, so every option can also be set as `CELERY_<OPTION>`.
3. The root group callback handles the global options:
   - `-A/--app` (env `APP`): resolved by `celery.app.utils.find_app`. The value can be `module:attr`, `module.attr`, or just a module or package. For a module, it tries `module.app`, then `module.celery`, then a `celery` submodule of a package (`pkg.celery`), then any `Celery` instance found in the module. Import failures are reported with specific messages: module not found, attribute missing, or a traceback for other errors.
   - `-b/--broker`, `--result-backend`, `--loader`, and `--config` are exported as the environment variables `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND`, `CELERY_LOADER`, and `CELERY_CONFIG_MODULE`. The app reads those when it configures itself.
   - `--workdir` runs `chdir` eagerly. `-C/--no-color`, `-q/--quiet`, and `--version` are also global.
   - `--skip-checks` sets `CELERY_SKIP_CHECKS`, which skips Django system checks.
   - It builds a `CLIContext` (`celery/bin/base.py`) holding the app plus output helpers, and stores it as `ctx.obj`.
   - It appends the app's `user_options['worker' | 'beat' | 'events']` to those commands, and `user_options['preload']` to **every** command.
4. Since Celery 5, `-A` is only valid **before** the subcommand. A click monkey-patch shows an explanatory error if `-A` is passed after the subcommand.

## Subcommands

| Command | Module | Purpose |
|---|---|---|
| `worker` | `bin/worker.py` → `apps/worker.py` | Start a worker. Options include `-n/--hostname`, `-c/--concurrency`, `-P/--pool`, `-Q/--queues`, `-X/--exclude-queues`, `-E/--task-events`, `-B/--beat`, `--autoscale`, `--max-tasks-per-child`, `--max-memory-per-child`, `--time-limit`/`--soft-time-limit`, `--prefetch-multiplier`, `--disable-prefetch`, `--without-gossip/mingle/heartbeat`, `-S/--statedb`, `-O` optimization, `--purge`, and `-D/--detach`. |
| `beat` | `bin/beat.py` → `apps/beat.py` | Run the periodic task scheduler. See [Beat](beat-scheduler.md). |
| `events` | `bin/events.py` | Default is the curses monitor (`evtop`). `--dump` prints events, and `--camera` runs a snapshot camera. See [Events](events-monitoring.md). |
| `inspect` / `control` / `status` | `bin/control.py` | Broadcast remote-control commands. The command names are validated against the worker-side registry. See [Remote Control](../worker/remote-control.md). |
| `call` | `bin/call.py` | `send_task` by name with `--args`/`--kwargs` JSON, `--eta`, `--countdown`, `--expires`, `--queue`, and so on. |
| `purge` | `bin/purge.py` | Delete all messages from the configured task queues. It asks for confirmation unless `-f`, and `-Q`/`-X` select which queues. |
| `result` | `bin/result.py` | Print a task's result or traceback from the backend. |
| `multi` | `bin/multi.py` → `apps/multi.py` | Start, stop, or restart several detached workers. See below. |
| `shell` | `bin/shell.py` | Interactive shell with the app and tasks preloaded (IPython, bpython, or plain Python). |
| `migrate` | `bin/migrate.py` | Move messages between brokers (`contrib.migrate`). |
| `amqp` | `bin/amqp.py` | AMQP admin REPL: declare, delete, and bind exchanges and queues, publish, and get. |
| `list bindings` | `bin/list.py` | List queue bindings when the transport supports it. |
| `graph bootsteps` / `graph workers` | `bin/graph.py` | Print dot graphs of the bootstep blueprint or the cluster. |
| `upgrade settings` | `bin/upgrade.py` | Rewrite old uppercase setting names to the new lowercase names. |
| `logtool` | `bin/logtool.py` | Summarize stats, traces, and errors from worker log files. |
| `report` | `bin/celery.py` | Print `app.bugreport()` (versions plus censored configuration) for bug reports. |

Third-party commands are added through the `celery.commands` entry-point group (`click_plugins`).

## Daemon options

`CeleryDaemonCommand` (used by `worker`, `beat`, and `events`) adds `--logfile/-f`, `--pidfile`, `--uid`, `--gid`, `--umask`, and `--executable`. Each `DaemonOption` falls back to the app setting `<command>_<option>`, for example `worker_pidfile` or `beat_logfile`, when the flag is not given. In `worker`:

- `--detach` re-executes the same argv without `--detach`, `--uid`, and `--gid`, through `celery.bin.worker.detach`, which daemonizes with `platforms.detached()`.
- In the foreground, privileges are dropped with `maybe_drop_privileges(uid, gid)` before `app.Worker(...)` is created.
- `%n`, `%h`, `%i`, and `%I` in `--pidfile`, `--logfile`, and `--statedb` are expanded per node (`node_format`).
- The process exits with `worker.exitcode`. A `SecurityError`, for example a misconfigured message signing setup, exits with code 1.

## `celery multi`

`multi` ignores click option parsing. It moves the global args after `multi` and passes them to `MultiTool.execute_from_commandline`, which supports `start`, `stop`, `stopwait`, `restart`, `kill`, `show`, `names`, `get`, `expand`, and `help`.

- **Node specification:** a count (`3` → `celery1..3@host`, with `--range-prefix` to change the prefix), names (`image video`), or full node names (`foo@%h`).
- **Per-node options:** `MultiParser` and `NamespacedOptionParser` support `-c:1-3 10`, `-Q:image images`, and `-c:foo,bar 10` to override options for ranges, lists, or named nodes.
- **Defaults per node:** `-n <name>`, `--pidfile /var/run/celery/%n.pid`, `--logfile /var/log/celery/%n%I.log`, and `--executable sys.executable`. Each node runs `python -m celery worker --detach ...`. The module docstring still says pidfiles default to the current directory, but the code uses `/var/run/celery`.
- **Stopping:** `Cluster.shutdown_nodes` reads each node's pidfile, sends the signal (default `SIGTERM`), and with `stopwait` or `restart` polls until the process is gone. Restarting requires passing the same arguments again, because multi persists nothing.

## Tests

- `t/unit/bin/` contains tests for the worker, beat, control, multi, and daemonization commands, plus `celery.py` and a `proj/` fixture app used by `find_app` tests.
- `t/unit/apps/test_multi.py` covers node parsing and cluster signaling.

## See also

- [Deployment, Daemonization and Packaging](deployment.md)
- [Worker Architecture and Bootsteps](../worker/worker-architecture.md)
- [Periodic Tasks: Beat and Schedules](beat-scheduler.md)
