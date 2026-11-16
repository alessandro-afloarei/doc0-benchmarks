---
type: architecture
title: CLI and Process Management
description: How the `celery` command is assembled (click group, global options, app loading, preload options), what each launcher in celery/apps does, and the platform layer for daemonizing, pidfiles, privilege dropping and signal handling in workers and `celery multi`.
tags: [celery, cli, click, worker, multi, daemonization, signals, platforms]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:56:17.091Z
sources:
  - id: openwiki-source-965d19cff645fcce36529be3
    resource: repo://celery/__main__.py
  - id: openwiki-source-bffba2579250d110123dbe63
    resource: repo://celery/apps/multi.py
  - id: openwiki-source-3cfd5f9bf00aaf6b49d01291
    resource: repo://celery/apps/worker.py
  - id: openwiki-source-a437e97c9a2828206c6e0b16
    resource: repo://celery/bin/base.py
  - id: openwiki-source-4e8c69ddbd86a82c3201bc63
    resource: repo://celery/bin/celery.py
  - id: openwiki-source-6de531038635a55bb6fb085b
    resource: repo://celery/bin/worker.py
  - id: openwiki-source-0f8d26932b6272605a1f8531
    resource: repo://celery/platforms.py
generated: { by: "claude-code", at: "2026-11-16T17:56:17.091Z" }
---

# CLI and Process Management

The `celery` console script (`setup.py` entry point `celery = celery.__main__:main`) is a [click](https://click.palletsprojects.com) application. The command modules in `celery/bin/` are thin: they parse options and then hand over to the launcher classes in `celery/apps/` (`Worker`, `Beat`, `multi`). Those launchers, together with `celery/platforms.py`, deal with processes, signals and daemonization.

## Entry and global options

1. `celery.__main__.main` first calls `maybe_patch_concurrency()` unless the command is `multi`. This monkey-patches eventlet or gevent *before* anything else is imported, when `-P eventlet|gevent` is on the command line. It then calls `celery.bin.celery.main`, which runs `celery(auto_envvar_prefix="CELERY")`, so any option can also come from a `CELERY_*` environment variable.
2. The `celery` click group (`celery/bin/celery.py`) accepts the global options `-A/--app`, `-b/--broker`, `--result-backend`, `--loader`, `--config`, `--workdir`, `--no-color`, `-q` and `--skip-checks`. It exports `--broker`, `--result-backend`, `--loader`, `--config` and `--skip-checks` into the environment (`CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND`, `CELERY_LOADER`, `CELERY_CONFIG_MODULE`, `CELERY_SKIP_CHECKS`). This is how those settings reach apps created later, such as the default app (see [App and configuration](app-and-configuration.md)).
3. The app string is resolved with `find_app` (`celery/app/utils.py`), with distinct error messages for a missing module, a missing attribute, and an import that raised. The result is stored in `ctx.obj = CLIContext(app, no_color, workdir, quiet)`, a small helper that colors and prints output.
4. **Preload options.** Apps can register extra options through `app.user_options` (the `worker`, `beat`, `events` and `preload` keys). The group adds them to the relevant commands. `handle_preload_options` (`celery/bin/base.py`) fires the `user_preload_options` signal with the parsed values before the command body runs.
5. **Plugins.** Extra subcommands are loaded from the `celery.commands` entry-point group using click-plugins' `with_plugins`.
6. **Option misuse.** The old placement `celery worker -A app` was removed in 5.0. `NoSuchOption.show` is patched to explain that `-A` is now a global option.

The registered subcommands are `worker`, `beat`, `multi`, `events`, `inspect`, `control`, `status`, `call`, `result`, `purge`, `list`, `migrate`, `graph`, `upgrade`, `logtool`, `amqp`, `shell` and `report`. Commands that talk to workers (`inspect`, `control`, `status`, `purge`, `call`, `result`) call the app's control and result APIs; see [Events and remote control](events-and-remote-control.md).

### Shared click helpers (`celery/bin/base.py`)

- `CeleryOption` and `CeleryCommand` add grouped help output and read defaults from the application config.
- `DaemonOption` and `CeleryDaemonCommand` add `--logfile`, `--pidfile`, `--uid`, `--gid`, `--umask` and `--executable`. If the value is not given on the command line, it is taken from config as `<command>_<option>` (for example `worker_pidfile`).
- Parameter types such as `CommaSeparatedList`, `JsonArray`, `JsonObject`, `ISO8601DateTime` and `LogLevel`.
- `handle_remote_command_error` gives a uniform message when a remote command fails.

## `celery worker`

`celery/bin/worker.py` defines the options (pool, concurrency, queues, autoscale, time limits, `-B`, events, and so on) and validates them in custom click types:

- `WorkersPool` offers the names from `concurrency.get_available_pool_names()`. If the CLI value is the default `prefork` but `worker_pool` is configured, the configured pool wins.
- `-B` is rejected on Windows.
- Unknown extra arguments are parsed as configuration overrides with `app.config_from_cmdline(..., namespace='worker')`.
- With `--detach` the command re-executes `python -m celery <args minus detach/uid/gid>` through `detach(...)`. Otherwise it drops privileges with `maybe_drop_privileges`, builds `app.Worker(...)` and calls `worker.start()`, then exits with `worker.exitcode`. A `SecurityError` is printed and exits with status 1.

`celery.apps.worker.Worker` subclasses `WorkController` (see [Worker and consumer](worker-and-consumer.md)) and adds the process-level behaviour:

- `on_before_init` calls `trace.setup_worker_optimizations`, sends the `celeryd_init` signal, and calls `check_privileges(accept_content)`.
- `on_init_blueprint` sets up logging and applies the task-execution optimizations. This is the point where the app gets finalized.
- `on_start` prints the banner and the task list, and installs signal handlers.

### Signal handling in the worker

`celery/apps/worker.py` installs handlers through `platforms.signals`:

| Signal | Behavior |
|---|---|
| `SIGTERM` | Warm shutdown. Sets `worker.state.should_stop` so running tasks finish. |
| `SIGINT` (Ctrl+C) | The first one starts a warm shutdown, and a second one escalates to cold shutdown. |
| `SIGQUIT` | Cold shutdown. Sets `state.should_terminate` with a failure exit code. |
| `SIGHUP` | Restarts the worker: it requests a warm stop and registers an `atexit` hook that re-`exec`s the same command line. A "not supported" warning handler is installed where restart is not possible. |
| `SIGUSR1` | Prints stack traces of all threads (the "cry" handler). |
| `SIGUSR2` | Starts the remote debugger (`celery.contrib.rdb`), enabled through the `CELERY_RDBSIG` environment variable. |

Handlers do their real work only in the main process (`current_process()._name == 'MainProcess'`). They send the `worker_shutting_down` signal before flipping the state flags that the worker loop polls.

## `celery multi`

`celery multi start|stop|stopwait|restart|kill|show|expand|names|get|help` (`celery/bin/multi.py`) manages several worker nodes using `celery/apps/multi.py`:

- `MultiParser` turns arguments such as `3 -c 3`, or named nodes with `--range-prefix`, into `Node` objects. Options can be namespaced per node (`-c:1 5`).
- Each `Node` runs the command `python -m celery worker --detach` (the default `cmd` in `Node.__init__`). `_prepare_argv` expands node-format placeholders (`%n`, `%h`, `%I`, and so on) in option values and moves the global options (`-A`, `-b`, `--loader`, `--workdir`, and similar) in front of the `worker` subcommand. `Node.alive` and `Node.send` use the pidfile.
- `Cluster` starts, signals, restarts and kills nodes, retrying stops until the processes disappear.
- State is **not persisted**. The pidfile is the only link, so the same pidfile and logfile arguments must be passed again to `stop` and `restart`.

## `celery beat`

`celery/bin/beat.py` is a `CeleryDaemonCommand`. It either detaches or builds `celery.apps.beat.Beat` and runs it. See [Beat scheduler](beat-scheduler.md) for the scheduler itself.

## Platform layer (`celery/platforms.py`)

- **Pidfile locking:** `Pidfile` and `create_pidlock` detect a stale pidfile, and fail with `LockFailed` if the recorded process is still alive.
- **Daemonization:** `DaemonContext` and `detached(...)` fork, `setsid`, redirect the standard file descriptors, and `chdir`. Before detaching they verify that the logfile is writable and that the pidfile is not locked, because errors would otherwise be silent. Privileges are dropped through `maybe_drop_privileges` (uid/gid parsing, `setgroups`, `initgroups`).
- **Signals:** the `Signals` helper maps signal names to handlers and supports `ignore`, `reset` and `update`.
- **Process title and parent death:** `set_process_title` and `set_pdeathsig`.
- **Root safety check:** `check_privileges(accept_content)` runs on worker init. When the process runs as root, or in the `sudo` or `wheel` groups, a warning is issued. If `pickle` (or the Python-serialize content type) is accepted and `C_FORCE_ROOT` is not set, it raises `SecurityError` instead. This ties process management to the [message security](../operations/message-security.md) guidance.

## Tests

CLI behaviour is covered in `t/unit/bin/` (`test_worker.py`, `test_multi.py`, `test_beat.py`, `test_control.py`, `test_daemonization.py`, and `celery.py` with a `proj` test app), plus `t/unit/apps/test_multi.py` and `t/unit/app/test_preload_cli.py`. See [Testing, CI and development workflow](../testing/test-strategy.md).
