---
type: interface
title: Command-Line Interface
description: The click-based `celery` umbrella command — entry point and early eventlet/gevent patching, global options and app discovery, preload/user options, daemonization options, the worker command and detaching, the list of subcommands, and the `celery multi` node manager.
tags: [cli, click, worker, multi, daemonization]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T09:27:53.075Z
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
  - id: openwiki-source-9fe3a610596da7b7f2c71115
    resource: repo://setup.py
generated: { by: "claude-code", at: "2026-11-15T09:27:53.075Z" }
---

# Command-Line Interface

The `celery` program is defined in `celery/bin/` using [click](https://click.palletsprojects.com/). The console script `celery = celery.__main__:main` is declared in `setup.py`; `python -m celery` uses the same entry point.

## Entry point and early patching

`celery/__main__.py:main()` calls `maybe_patch_concurrency()` **before importing anything else** (except for `celery multi`). It scans `sys.argv` for `-P/--pool`; if the value is `eventlet` or `gevent` it applies the corresponding monkey patching (`eventlet.monkey_patch()`, `gevent.monkey.patch_all()`) and pre-imports the pool implementation. This must happen before sockets/threads are created, which is why it lives in the package `__init__`. Then it runs `celery.bin.celery.main()`, which invokes the click group with `auto_envvar_prefix="CELERY"`, so every option can also be provided as a `CELERY_<OPTION>` environment variable.

## Global options and app discovery

Global options must come **before** the subcommand (`celery -A proj worker`, not `celery worker -A proj`; the latter prints a dedicated error explaining the Celery 5 change):

| Option | Effect |
| --- | --- |
| `-A/--app` | App to load (`module`, `module:attr`, or `module.attr`) |
| `-b/--broker`, `--result-backend` | Exported as `CELERY_BROKER_URL` / `CELERY_RESULT_BACKEND` env vars, which `Settings` gives priority over configuration |
| `--loader`, `--config` | Exported as `CELERY_LOADER` / `CELERY_CONFIG_MODULE` |
| `--workdir` | `chdir` eagerly before anything else |
| `-C/--no-color`, `-q/--quiet`, `--version` | Output control |
| `--skip-checks` | Sets `CELERY_SKIP_CHECKS` to skip Django system checks |

`find_app()` (`celery/app/utils.py`) resolves `-A`: for a module it looks for an attribute named `app`, then `celery` (rejecting the `celery` module itself), then — for packages — a `<pkg>.celery` submodule, and finally any `Celery` instance among the module's globals. Import errors are reported with clear messages rather than tracebacks.

The resolved app is stored on a `CLIContext` (`ctx.obj`) with output helpers (`echo`, `error`, `pretty`).

## Extension points

- **User options**: `app.user_options['worker' | 'beat' | 'events' | 'preload']` are lists of click options appended to the respective commands at startup. Preload options are added to every command; `handle_preload_options` sends the `user_preload_options` signal with their parsed values.
- **Plugins**: commands registered under the `celery.commands` entry-point group are added via `click_plugins.with_plugins`.
- Mistyped subcommands get suggestions via `click_didyoumean.DYMGroup`.

## Subcommands

| Command | Module | Purpose |
| --- | --- | --- |
| `worker` | `bin/worker.py` | Start a worker (`app.Worker(...).start()`) |
| `beat` | `bin/beat.py` | Start the periodic scheduler ([Beat](../beat/periodic-tasks.md)) |
| `events` | `bin/events.py` | Curses monitor, event dump (`--dump`) or snapshot camera (`--camera`) ([Events](../events/monitoring-events.md)) |
| `inspect`, `control`, `status` | `bin/control.py` | Remote control/inspection ([Remote Control](../worker/remote-control.md)) |
| `call` | `bin/call.py` | Send a task by name with JSON args/kwargs, eta/countdown/expires, queue/exchange/routing key |
| `result` | `bin/result.py` | Print a task's result or traceback |
| `purge` | `bin/purge.py` | Delete all messages from known (or selected) task queues |
| `migrate` | `bin/migrate.py` | Move tasks between brokers |
| `list bindings` | `bin/list.py` | Show queue bindings |
| `amqp` | `bin/amqp.py` | AMQP 0.9.1 administration REPL |
| `shell` | `bin/shell.py` | Python REPL (IPython/bpython/plain) with the app and tasks loaded |
| `graph bootsteps/workers` | `bin/graph.py` | Emit dot graphs of bootsteps or workers |
| `logtool` | `bin/logtool.py` | Analyse worker log files |
| `upgrade settings` | `bin/upgrade.py` | Rewrite old-style setting names |
| `report` | `bin/celery.py` | Print `app.bugreport()` (software versions and censored settings) |
| `multi` | `bin/multi.py` | Manage multiple worker nodes |

## Daemon commands

`CeleryDaemonCommand` (used by `worker`, `beat`, `events`) adds `--logfile/-f`, `--pidfile`, `--uid`, `--gid`, `--umask` and `--executable`. Each `DaemonOption` falls back to the app setting `<command>_<option>` (e.g. `worker_pidfile`) when not given on the command line.

### `celery worker`

The command (`celery/bin/worker.py`) exposes options such as `-n/--hostname` (expanded with `%h`, `%n`, `%d` via `host_format`), `-c/--concurrency`, `-P/--pool` (validated against available pool names; defaults to `worker_pool`), `-Q/--queues`, `-X/--exclude-queues`, `-I/--include`, `-E/--task-events`, `-l/--loglevel`, `-O` optimization profile, `--prefetch-multiplier`, `--disable-prefetch`, `--time-limit`, `--soft-time-limit`, `--max-tasks-per-child`, `--max-memory-per-child`, `--autoscale=max,min`, `--without-gossip/-mingle/-heartbeat`, `--heartbeat-interval`, `-B/--beat`, `-S/--statedb`, `--purge`.

Behaviour:

1. Extra `key=value` arguments after the options are parsed with `app.config_from_cmdline(..., namespace='worker')`.
2. With `-D/--detach`, the process re-executes itself (`os.execv(sys.executable, ['-m', 'celery', ...])`) inside `platforms.detached()` (double fork, pidfile, log file, uid/gid/umask/workdir), removing `--detach`, `--uid` and `--gid` from the new argv.
3. Otherwise it drops privileges (`maybe_drop_privileges`), constructs `app.Worker(...)` with pidfile/statedb names node-formatted (`%n`, `%I`), starts it, and exits with `worker.exitcode`. A `SecurityError` exits with status 1.

See [Worker Bootsteps and WorkController](../worker/bootsteps-and-workcontroller.md) for what happens after `worker.start()`.

## `celery multi`

`celery multi` (`celery/bin/multi.py` + `celery/apps/multi.py`) starts, stops and restarts groups of detached workers on one host, typically from init scripts:

- `start N` / `start name1 name2` / `start foo@host` create nodes named `celery1@<host>`, ... (`--range-prefix` changes the prefix).
- Per-node options use namespaces: `-c:1-3 10`, `-Q:image images`, `-L:4,5 DEBUG`.
- Every node gets defaults `--pidfile=/var/run/celery/%n.pid`, `--logfile=/var/log/celery/%n%I.log` and `--executable=sys.executable`; missing directories are created.
- `stop`/`stopwait`/`restart`/`kill` signal nodes by **pidfile**, so the same `--pidfile` must be passed as on start (options are not persisted). `stopwait` waits for shutdown; `restart` restarts each node once it is down.
- `show`, `names`, `get`, `expand` print the generated commands/names without running them.
- Because global options like `-A` must precede the subcommand in Celery 5, the `multi` command rearranges `sys.argv` so `MultiTool` sees them, and `_prepare_argv` forwards `-A/--app`, `-b/--broker`, `--result-backend`, etc. to each node's command line in the right position.

See [Deployment and Daemonization](../operations/deployment.md) for systemd/init.d usage.

## Related tests

`t/unit/bin/` (`test_worker.py`, `test_multi.py`, `test_beat.py`, `test_control.py`, `test_daemonization.py`), `t/unit/apps/test_multi.py`, `t/unit/app/test_preload_cli.py`.
