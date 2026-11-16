---
type: operations
title: CLI, Multi-node Management and Daemonization
description: How the click-based celery command is structured (global options, app discovery, subcommands, plugins, preload and user options), how workers detach and drop privileges, how celery multi manages node groups, the platform helpers for pidfiles and signals, and the deployment assets in extra/, docker/ and helm-chart/.
tags: [cli, click, multi, daemonization, pidfile, deployment, operations]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:57:55.789Z
sources:
  - id: openwiki-source-965d19cff645fcce36529be3
    resource: repo://celery/__main__.py
  - id: openwiki-source-ceca684addb7674df2c5c60b
    resource: repo://celery/app/utils.py
  - id: openwiki-source-3cfd5f9bf00aaf6b49d01291
    resource: repo://celery/apps/worker.py
  - id: openwiki-source-a437e97c9a2828206c6e0b16
    resource: repo://celery/bin/base.py
  - id: openwiki-source-4e8c69ddbd86a82c3201bc63
    resource: repo://celery/bin/celery.py
  - id: openwiki-source-5d9e0c235c9d77c7d6937cbd
    resource: repo://celery/bin/multi.py
  - id: openwiki-source-6de531038635a55bb6fb085b
    resource: repo://celery/bin/worker.py
  - id: openwiki-source-0f8d26932b6272605a1f8531
    resource: repo://celery/platforms.py
  - id: openwiki-source-c7437f530b07d7673c7665f6
    resource: repo://extra/systemd/celery.service
generated: { by: "claude-code", at: "2026-11-16T06:57:55.789Z" }
---

# CLI, Multi-node Management and Daemonization

The `celery` console script (`setup.py` entry point
`celery = celery.__main__:main`) is a [click](https://click.palletsprojects.com)
application defined in `celery/bin/celery.py`, with one module per
subcommand in `celery/bin/`.

## Startup sequence

1. `celery/__main__.py:main()` calls `maybe_patch_concurrency()` (unless the
   command is `multi`) so `-P eventlet|gevent` monkey patches are applied
   before any other import ([pools](../architecture/worker/concurrency-pools.md)).
2. `celery.bin.celery.main()` runs the `celery` group with
   `auto_envvar_prefix="CELERY"`, so options can also come from `CELERY_*`
   environment variables.
3. The group callback handles global options and **exports them as
   environment variables** before the app is imported: `--loader` →
   `CELERY_LOADER`, `-b/--broker` → `CELERY_BROKER_URL`, `--result-backend` →
   `CELERY_RESULT_BACKEND`, `--config` → `CELERY_CONFIG_MODULE`,
   `--skip-checks` → `CELERY_SKIP_CHECKS`; `--workdir` changes directory.
4. `-A/--app` (also env `APP`) is resolved by `celery.app.utils.find_app`:
   a `module:attr` path is imported directly; for a bare module it tries
   `module.app`, then `module.celery`, then the submodule `module.celery` for
   packages, and finally any `Celery` instance found in the module.
   Import failures produce tailored error messages.
5. A `CLIContext` (app, `no_color`, `workdir`, `quiet`) is stored in
   `ctx.obj`; app-provided options are appended to subcommands:
   `app.user_options['worker' | 'beat' | 'events']` and
   `app.user_options['preload']` (added to every command).
6. Using `-A` after the subcommand (Celery 4 style) prints an explanatory
   error (click's `NoSuchOption.show` is patched).

**Plugins:** extra subcommands are loaded from the `celery.commands`
entry-point group (`click_plugins.with_plugins`).

## Subcommands

| Command | Module | Purpose |
|---------|--------|---------|
| `worker` | `bin/worker.py` | Start a worker (`app.Worker(...).start()`) |
| `beat` | `bin/beat.py` | Start the periodic scheduler ([beat](../architecture/beat-scheduler.md)) |
| `events` | `bin/events.py` | Event dumper, curses monitor, or snapshot camera |
| `inspect`, `control`, `status` | `bin/control.py` | Remote control; commands generated from the worker `Panel` metadata ([remote control](../architecture/remote-control-and-events.md)) |
| `call` | `bin/call.py` | Send a task by name |
| `result` | `bin/result.py` | Show a task result |
| `purge` | `bin/purge.py` | Delete waiting messages from queues |
| `list bindings` | `bin/list.py` | List exchange bindings |
| `migrate` | `bin/migrate.py` | Move tasks between brokers (`contrib/migrate.py`) |
| `multi` | `bin/multi.py` | Manage multiple worker nodes |
| `amqp` | `bin/amqp.py` | AMQP admin REPL (`click-repl`) |
| `shell` | `bin/shell.py` | Python shell with the app loaded |
| `graph` | `bin/graph.py` | Render bootsteps / worker graphs as dot |
| `upgrade` | `bin/upgrade.py` | Rewrite old-style setting names |
| `logtool` | `bin/logtool.py` | Analyse worker logs |
| `report` | `bin/celery.py` | Print `app.bugreport()` |

Shared helpers in `celery/bin/base.py`: `CeleryOption` (help groups,
defaults from context), `CeleryCommand` (grouped help output),
`CeleryDaemonCommand`, parameter types (`CommaSeparatedList`, `JsonArray`,
`JsonObject`, `ISO8601DateTime`, `LogLevel`), and
`handle_preload_options`, which sends the `user_preload_options` signal with
the values of app-defined preload options before the command runs.

### Worker command specifics

- Extra `key=value` arguments after options are parsed with
  `app.config_from_cmdline(ctx.args, namespace='worker')`.
- `--detach/-D` re-executes `python -m celery ...` (without
  `--detach/--uid/--gid`) inside `platforms.detached(...)`.
- Otherwise `maybe_drop_privileges(uid, gid)` runs, `%n`/`%h`/`%i`-style
  node name patterns in `--pidfile` / `--statedb` are expanded with
  `node_format`, and the worker starts; the process exits with
  `worker.exitcode`. A `SecurityError` (e.g. refusing to run as root with
  pickle) prints the message and exits 1.

**Daemon options** (`--logfile/-f`, `--pidfile`, `--uid`, `--gid`,
`--umask`, `--executable`) are added by `CeleryDaemonCommand`; if a value is
not given on the command line it falls back to the setting
`<command>_<option>` (e.g. `worker_pidfile`, `beat_logfile`).

## Platform helpers (`celery/platforms.py`)

- **Pidfiles** – `Pidfile` writes the pid with `O_CREAT|O_EXCL`, fsyncs and
  re-reads to verify. `create_pidlock(path)` exits with an error if the lock
  is held by a live process, removes stale/broken pidfiles (including when the
  stored pid is the current pid — common for PID 1 in containers), and
  releases the lock at exit.
- **Detaching** – `detached(logfile, pidfile, uid, gid, umask, workdir,
  fake)` drops privileges, then returns a `DaemonContext` that double-forks,
  `setsid`s, changes directory and umask, redirects stdio to `/dev/null`, and
  after chdir verifies the logfile is writable and the pidfile isn't locked.
- **Privileges** – `maybe_drop_privileges(uid, gid)` changes user/group
  (primary group of the user if no gid is given, with `initgroups`) and raises
  `SecurityError` if root privileges remain afterwards.
  `check_privileges(accept_content)` (called on worker init) **refuses to run
  as root, or with group `sudo`/`wheel`, when `pickle` is accepted** unless
  `C_FORCE_ROOT` is set; otherwise it only warns.
- **Signals** – the `signals` object maps names to handlers
  (`signals['SIGTERM'] = fn`, `ignore`, `reset`, `update`, `arm_alarm`);
  `set_pdeathsig`, `set_process_title` / `set_mp_process_title` (uses
  `setproctitle` if installed), `close_open_fds`, `ignore_errno`.

## celery multi

`celery multi` (`celery/bin/multi.py` + `celery/apps/multi.py`) starts and
stops groups of workers without a process supervisor:

```console
$ celery multi start 3 -A proj -c 4 -Q:1 high -Q:2-3 default \
      --pidfile=/var/run/celery/%n.pid --logfile=/var/log/celery/%n%I.log
$ celery multi stopwait 3 --pidfile=/var/run/celery/%n.pid
```

- `MultiParser` expands node names (a count, explicit names, or
  `name@%h` templates) into `Node` objects; `NamespacedOptionParser`
  supports per-node options with `-opt:<node|range>` syntax.
- Each `Node` builds its own `celery worker --detach` argv with
  expanded `%n` (node name), `%h` (hostname), `%i`/`%I` (pool process index)
  placeholders.
- `Cluster` implements `start`, `stop` (send `SIGTERM`), `stopwait` (stop and
  wait, with retries), `restart` (stop then start each node as it goes down),
  `kill` (`SIGKILL`), and the `names`, `show` (print the generated commands), `get`, `expand` and `help` helpers.
  Node liveness is checked via the pidfile and `kill(pid, 0)`.
- Because `multi` itself only spawns detached workers, it is skipped by the
  early monkey patching.

## Deployment assets

| Path | Contents |
|------|----------|
| `extra/systemd/` | `celery.service` (uses `celery multi start/stopwait/restart`), `celerybeat.service`, `celery.conf` environment file, tmpfiles config |
| `extra/generic-init.d/` | SysV init scripts `celeryd` and `celerybeat` |
| `extra/supervisord/` | Supervisor program definitions |
| `extra/macOS/`, `extra/WindowsCMD-AzureWebJob/` | Platform examples |
| `extra/bash-completion/`, `extra/zsh-completion/` | Shell completion |
| `helm-chart/` | Kubernetes chart: worker `Deployment`, `ConfigMap` and `Secret` for configuration, `ServiceAccount`; parameters in `values.yaml` |
| `docker/` | Development image and `docker-compose.yml` with RabbitMQ, Redis, DynamoDB local and Azurite for running the test suites |

## Tests

- `t/unit/bin/` – CLI wiring, multi, daemonization, worker command.
- `t/unit/apps/test_multi.py` – node parsing and cluster operations.
- `t/unit/utils/test_platforms.py` – pidlocks, detaching, privilege checks.

See also: [Worker bootsteps](../architecture/worker/worker-bootsteps.md),
[Testing](../testing/test-suite.md).
