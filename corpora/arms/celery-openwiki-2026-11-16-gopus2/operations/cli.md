---
type: operations
title: Command-Line Interface and Deployment
description: The click-based `celery` umbrella command — global options, app discovery, early eventlet/gevent patching, subcommands (worker, beat, events, inspect/control/status, call, purge, result, shell, migrate, multi, etc.), plugin and user options — plus the deployment assets shipped in extra/, docker/ and helm-chart/.
tags: [cli, click, multi, deployment, systemd, docker, helm, operations]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:05:29.073Z
sources:
  - id: openwiki-source-39b293cb4d26aec690dfc284
    resource: repo://celery/__init__.py
  - id: openwiki-source-965d19cff645fcce36529be3
    resource: repo://celery/__main__.py
  - id: openwiki-source-ceca684addb7674df2c5c60b
    resource: repo://celery/app/utils.py
  - id: openwiki-source-bffba2579250d110123dbe63
    resource: repo://celery/apps/multi.py
  - id: openwiki-source-4e8c69ddbd86a82c3201bc63
    resource: repo://celery/bin/celery.py
  - id: openwiki-source-6de531038635a55bb6fb085b
    resource: repo://celery/bin/worker.py
  - id: openwiki-source-c7437f530b07d7673c7665f6
    resource: repo://extra/systemd/celery.service
  - id: openwiki-source-37e0b93d937b3f82655b267d
    resource: repo://helm-chart/values.yaml
  - id: openwiki-source-9fe3a610596da7b7f2c71115
    resource: repo://setup.py
generated: { by: "claude-code", at: "2026-11-16T17:05:29.073Z" }
---

# Command-Line Interface and Deployment

## Entry point

The `celery` console script maps to `celery.__main__:main` (`setup.py`). `main()`:

1. Calls `maybe_patch_concurrency()` (unless the command is `multi`), which scans `sys.argv` for `-P/--pool` and applies **eventlet or gevent monkey-patching before anything else is imported**. This is why `-P eventlet` must be given on the command line rather than only in configuration.
2. Invokes the click group `celery.bin.celery:celery` with `auto_envvar_prefix="CELERY"`, so every option can also be supplied as `CELERY_<OPTION>` (e.g. `CELERY_APP`, `CELERY_BROKER_URL`).

## Global options

Defined on the `celery` group in `celery/bin/celery.py` and must appear **before** the subcommand (`celery -A proj worker`, not `celery worker -A proj`; click is monkey-patched to print a specific error for the old Celery 4 form):

| Option | Effect |
|--------|--------|
| `-A/--app` | App to load (see discovery below) |
| `-b/--broker` | Sets `CELERY_BROKER_URL` env (overrides config, see [Configuration](../architecture/configuration.md)) |
| `--result-backend` | Sets `CELERY_RESULT_BACKEND` |
| `--loader`, `--config` | Set `CELERY_LOADER`, `CELERY_CONFIG_MODULE` |
| `--workdir` | `chdir` eagerly, before app import |
| `-C/--no-color`, `-q/--quiet`, `--version` | Output control |
| `--skip-checks` | Sets `CELERY_SKIP_CHECKS` (skip Django checks) |

**App discovery** (`celery.app.utils.find_app`): `-A proj` imports `proj` from the current directory; a `module:attr` path is used as is. For a module it tries `proj.app`, then `proj.celery`, then for packages the submodule `proj.celery`, then any `Celery` instance found in the module namespace.

After loading the app, the group appends the app's `user_options` for `worker`, `beat`, `events` and `preload` (the latter to every subcommand), and creates a `CLIContext` (`celery/bin/base.py`) shared by subcommands. Extra commands can be installed via the `celery.commands` entry-point group (`click-plugins`).

## Subcommands

| Command | Module | Purpose |
|---------|--------|---------|
| `worker` | `celery/bin/worker.py` | Start a worker (`app.Worker` → `celery.apps.worker.Worker`) |
| `beat` | `celery/bin/beat.py` | Start the periodic task scheduler ([Beat](../scheduling/beat.md)) |
| `events` | `celery/bin/events.py` | Curses monitor, `--dump`, or `--camera` snapshots ([Events](../events/monitoring.md)) |
| `inspect`, `control`, `status` | `celery/bin/control.py` | Remote control/inspection broadcasts ([Remote Control](../worker/remote-control.md)) |
| `call` | `celery/bin/call.py` | Send a task by name with JSON args/kwargs, ETA/countdown, routing |
| `result` | `celery/bin/result.py` | Fetch a task result/traceback by id |
| `purge` | `celery/bin/purge.py` | Delete all messages from configured queues (with `-Q/-X` selection) |
| `list bindings` | `celery/bin/list.py` | Show queue bindings (transport-dependent) |
| `migrate` | `celery/bin/migrate.py` | Move messages between brokers (`celery.contrib.migrate`) |
| `shell` | `celery/bin/shell.py` | Python/IPython/bpython shell with app and tasks preloaded |
| `amqp` | `celery/bin/amqp.py` | Interactive AMQP admin REPL (`click-repl`) |
| `multi` | `celery/bin/multi.py` | Manage several worker nodes |
| `graph` | `celery/bin/graph.py` | Dot graphs of bootsteps/workers |
| `report`, `upgrade`, `logtool` | various | Bug report, settings-name upgrader, log analysis |

### `celery worker`

Key options map onto `WorkController` arguments and settings: `-n/--hostname` (supports `%h`, `%n`, `%d` expansion), `-c/--concurrency`, `-P/--pool`, `-Q/--queues`, `-X/--exclude-queues`, `-E/--task-events`, `-B/--beat` (embedded beat), `--autoscale=max,min`, `--prefetch-multiplier`, `--disable-prefetch`, `--time-limit`, `--soft-time-limit`, `--max-tasks-per-child`, `--max-memory-per-child`, `--without-gossip/mingle/heartbeat`, `-S/--statedb`, `-O` optimization profile, and daemon options (`--logfile`, `--pidfile`, `--uid`, `--gid`, `--umask`, `-D/--detach`).

Behaviour of the command function:

- Any trailing arguments are parsed as configuration overrides with `app.config_from_cmdline(ctx.args, namespace='worker')`.
- `--detach` re-executes `python -m celery ...` (minus the detach/uid/gid flags) inside `platforms.detached()` (double fork, pidfile, log file, privilege drop).
- Otherwise privileges are dropped with `maybe_drop_privileges`, `%n`-style node formatting is applied to pidfile/statedb, and `app.Worker(...).start()` runs until shutdown; the process exits with the worker's exit code.

`celery.apps.worker.Worker` (the CLI-flavoured `WorkController`) prints the banner, sets up logging, and installs OS signal handlers (warm/cold/soft shutdown on `SIGTERM`/`SIGQUIT`/`SIGINT`, restart on `SIGHUP`, stack dump on `SIGUSR1`, remote debugger on `SIGUSR2` with `CELERY_RDBSIG`). See [Worker Architecture](../worker/worker-architecture.md).

### `celery multi`

`celery multi` (CLI in `celery/bin/multi.py`, logic in `celery/apps/multi.py`) starts/stops many named workers from one command line:

- Actions: `start`, `stop`, `stopwait`, `restart`, `kill`, `show`, `names`, `get`, `expand`, `help`.
- Node names: a count (`3` → `celery1..3@host`), explicit names, or full `name@host`; `--range-prefix` customises numbered names.
- Per-node options use namespaces: `-c:1-3 10`, `-Q:image images`, `-L:4,5 DEBUG`.
- Defaults: `--pidfile=/var/run/celery/%n.pid` and `--logfile=/var/log/celery/%n%I.log`; missing directories are created. `%I` expands to the pool process index so each child can log to its own file.
- Nodes are always started detached; stop sends signals to the pids found in pidfiles, and `stopwait` waits for processes to exit. Pid/log options are not persisted, so the same options must be passed for `stop`/`restart`.

## Deployment assets

| Path | Contents |
|------|----------|
| `extra/systemd/` | `celery.service` (uses `celery multi start/stopwait/restart`), `celerybeat.service`, `celery.conf` env file, `celery.tmpfiles` for `/run/celery` |
| `extra/generic-init.d/` | SysV init scripts `celeryd`, `celerybeat` |
| `extra/supervisord/` | supervisord program configs |
| `extra/macOS/` | launchd plists |
| `extra/WindowsCMD-AzureWebJob/` | Azure WebJob command wrappers |
| `extra/bash-completion/`, `extra/zsh-completion/` | Shell completions |
| `docker/` | Development image (`Dockerfile`, `entrypoint`) and `docker-compose.yml` with RabbitMQ, Redis, DynamoDB Local, Azurite and a docs container — the environment for integration tests |
| `helm-chart/` | Kubernetes chart (Deployment, ConfigMap, Secret, ServiceAccount) using the `celery/celery` image; settings come from `values.yaml` via `envFrom` |

Note: the Helm chart's default liveness probe imports `celery.task.control`, a module that no longer exists in Celery 5 (`celery/task/` is absent); anyone using the chart should replace the probe with something like `celery -A <app> inspect ping -d celery@$HOSTNAME`.

The user-facing daemonization guide is `docs/userguide/daemonizing.rst`.

## Tests

- `t/unit/bin/` — CLI behaviour (`test_worker.py`, `test_beat.py`, `test_multi.py`, `test_control.py`, `test_daemonization.py`), using the sample app in `t/unit/bin/proj`.
- `t/unit/apps/test_multi.py` — node/option expansion and cluster actions.

## Related

- [Worker Architecture and Bootsteps](../worker/worker-architecture.md)
- [Periodic Tasks (Beat) and Schedules](../scheduling/beat.md)
- [Remote Control and Inspection](../worker/remote-control.md)
