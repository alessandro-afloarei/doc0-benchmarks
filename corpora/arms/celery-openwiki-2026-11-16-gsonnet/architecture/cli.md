---
type: architecture
title: Command-Line Interface
description: How the celery umbrella command is built with Click — early pool monkey-patching, global options and app discovery, subcommand registry and plugins, preload options, worker/beat startup, detaching, and celery multi node management.
tags: [celery, cli, click, worker, multi, app-discovery]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:22:47.483Z
sources:
  - id: openwiki-source-39b293cb4d26aec690dfc284
    resource: repo://celery/__init__.py
  - id: openwiki-source-965d19cff645fcce36529be3
    resource: repo://celery/__main__.py
  - id: openwiki-source-ceca684addb7674df2c5c60b
    resource: repo://celery/app/utils.py
  - id: openwiki-source-bffba2579250d110123dbe63
    resource: repo://celery/apps/multi.py
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
generated: { by: "claude-code", at: "2026-11-16T09:22:47.483Z" }
---

# Command-Line Interface

The `celery` console script (`celery = celery.__main__:main` in `setup.py`) is a Click application defined in `celery/bin/celery.py`. Each subcommand lives in its own module under `celery/bin/`; long-running commands delegate to program classes in `celery/apps/` (`Worker`, `Beat`, `multi`). The CLI's job is mostly to find the right `Celery` app (see [[/openwiki/architecture/application.md]]), translate options into app/worker arguments, and start the corresponding service.

## Entrypoint and early monkey-patching

`celery.__main__.main` first calls `maybe_patch_concurrency()` (unless the command is `multi`), then imports and runs `celery.bin.celery.main`. `maybe_patch_concurrency` (`celery/__init__.py#L123-L147`) scans `sys.argv` for `-P`/`--pool` and, if the value is `eventlet` or `gevent`, applies that library's monkey-patching *before* the rest of Celery and the user's modules are imported. This ordering is why pool patching cannot be deferred to the worker startup. `multi` is excluded because it only spawns child `celery worker --detach` processes and must not be patched itself.

`main()` calls the root group with `auto_envvar_prefix="CELERY"`, so every option can also be set via `CELERY_*` environment variables.

## Root group and app discovery

The root `celery` group (`celery/bin/celery.py#L108-L165`) is a `DYMGroup` ("did you mean" suggestions) wrapped in `click_plugins.with_plugins` so third parties can add commands through the `celery.commands` entry-point group. Global options: `-A/--app`, `-b/--broker`, `--result-backend`, `--loader`, `--config`, `--workdir` (eagerly `chdir`s), `-C/--no-color`, `-q/--quiet`, `--version`, `--skip-checks`.

When invoked it:

1. Exports `--loader`, `--broker`, `--result-backend`, `--config` and `--skip-checks` as `CELERY_LOADER`, `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND`, `CELERY_CONFIG_MODULE` and `CELERY_SKIP_CHECKS` environment variables so the default app and loaders pick them up.
2. Resolves `--app` with `find_app` (`celery/app/utils.py#L378-L415`) when it is a string. `find_app` imports the module or `module:attr` symbol relative to the current directory and, for a bare module name, tries the module's `app` attribute, then `celery`, then (for packages) `<package>.celery`, and finally any `Celery` instance found in the module namespace. Import errors are reported with distinct messages for "module not found", "error while importing" and "app attribute missing". `app` may also be a `Celery` object when the CLI is invoked programmatically, hence `click.UNPROCESSED`.
3. Stores a `CLIContext` (`celery/bin/base.py`) in `ctx.obj` carrying the app, color/quiet flags and helpers (`echo`, `error`, `pretty*`).
4. Extends the `worker`, `beat` and `events` commands with the app's `user_options` (added through `app.user_options['worker']` etc.) and applies `preload` options to all commands.

A monkey-patch on `click.exceptions.NoSuchOption.show` produces a specific message when `-A/--app` is passed after the subcommand, a usage removed in Celery 5.0.

### Preload options

User-defined preload options are declared on the app. `handle_preload_options` (`celery/bin/base.py#L143-L160`) wraps commands: it gathers the values of the declared preload options and sends the `user_preload_options` signal with them before running the command, letting extensions react to custom flags without subclassing commands.

### Shared option helpers

`celery/bin/base.py` also defines `CeleryOption` / `CeleryCommand` (grouped help output), `DaemonOption` and `CeleryDaemonCommand` (adds `--logfile`, `--pidfile`, `--uid`, `--gid`, `--umask`, `--executable`; each defaults from an app setting named `<command>_<option>`, e.g. `worker_pidfile`) and Click param types such as `CommaSeparatedList`, `JsonArray`, `JsonObject`, `ISO8601DateTime` and `LogLevel`. `handle_remote_command_error` formats failures when a control command cannot reach workers.

## Subcommands

Registered on the group: `purge`, `call`, `beat`, `list`, `result`, `migrate`, `status`, `worker`, `events`, `inspect`, `control`, `graph`, `upgrade`, `logtool`, `amqp`, `shell`, `multi`, plus `report` (prints `app.bugreport()`).

- **Producer-side utilities**: `call` publishes a task by name with `--eta/--countdown/--expires/--queue...`; `result` fetches a result; `purge` discards queued messages (confirmation required unless `-f`); `migrate` moves tasks between brokers; `amqp` is a shell for raw AMQP operations.
- **Remote control**: `inspect`, `control` and `status` (`celery/bin/control.py`) turn the command-line words into arguments for the matching remote-control command by inspecting its metadata (`_compile_arguments`) and broadcast it through `app.control`; `--timeout`, `--destination` and `--json` shape the reply collection. See [[/openwiki/architecture/events-and-monitoring.md]].
- **Introspection/tools**: `events` (curses monitor, dumper, camera), `graph` (bootstep graph), `list`, `logtool`, `shell`, and `upgrade` (settings migration helpers).

## `celery worker`

`celery/bin/worker.py` declares the worker options (concurrency, pool, queues, autoscale, prefetch, time limits, max tasks per child, embedded beat via `-B`, state db, and more) grouped in help. The command function:

1. Applies any extra `--key=value` arguments as configuration with namespace `worker` via `app.config_from_cmdline`; parse errors become `click.UsageError`.
2. With `--detach`, rebuilds argv without the detach/uid/gid flags and calls `detach(...)` to daemonize (pidfile, logfile, uid/gid, umask, workdir).
3. Otherwise drops privileges (`maybe_drop_privileges`), builds `app.Worker(...)` with node-name-formatted pidfile/statedb and calls `worker.start()`, exiting with `worker.exitcode`. A `SecurityError` becomes a plain error message with exit code 1.

`celery.apps.worker.Worker` (a `WorkController` subclass, see [[/openwiki/architecture/worker.md]]) adds the "worker as a program" concerns: `on_before_init` sets up trace optimizations and sends `celeryd_init`; `on_init_blueprint` sets up logging and finalizes the app via `setup_worker_optimizations`; `on_start` sends `celeryd_after_setup`, optionally purges queued messages, prints the startup banner, sets the process title, installs platform signal handlers (`install_platform_tweaks`: warm/cold shutdown handlers, a stack-dump "cry" handler and a remote-debugger handler; a SIGHUP restart handler is installed only when stdout is not a TTY, so closing a terminal does not restart the worker, and macOS gets a "not supported" handler instead) and redirects stdout/stderr into logging. It also warns once about deprecated old-style setting names and points to `celery upgrade settings`.

## `celery beat`

`celery/bin/beat.py` is a daemon command with `--schedule`, `--scheduler`, `--max-interval`; extra arguments are applied to the app configuration, then `celery.apps.beat.Beat` builds the `Service` and installs a SIGTERM/SIGINT handler that syncs the schedule. Details: [[/openwiki/architecture/beat-scheduler.md]].

## `celery multi`

`celery multi` manages several worker nodes on one host. Its Click wrapper (`celery/bin/multi.py#L470-L480`) rearranges `sys.argv` so that arguments before `multi` (the global `-A ...`) come after it, because `MultiTool` still parses the old 4.x-style command line, then delegates to `MultiTool.execute_from_commandline`. Verbs include `start`, `stop`, `stopwait`, `restart`, `kill`, `show`, `get`, `names` and `expand`.

The node model lives in `celery/apps/multi.py`:

- `MultiParser` turns node names (or a numeric count / range, using a `celery` range prefix) into `Node` objects, merging namespaced options (`-c:1 3` style per-node overrides) via `NamespacedOptionParser`.
- `Node` builds the `celery worker --detach` command line, with defaults `--pidfile=/var/run/celery/%n.pid` and `--logfile=/var/log/celery/%n%I.log`, creating the directories if missing, and expands `%n`/`%h`/`%I`-style placeholders. It tracks liveness through its pidfile (`alive`, `send(sig)`, `pid`).
- `Cluster` is the node collection: `start` launches each node, `stop`/`stopwait`/`restart`/`kill` signal nodes (default `SIGTERM`, optional retry loop until pids disappear), with callbacks (`on_node_start`, `on_node_down`, `on_child_failure`...) that the terminal logger uses for output.

Because each node is a detached child, `multi` is a convenience for simple deployments; production setups usually use systemd/supervisor/Kubernetes instead and run `celery worker` directly.

## Related

- [[/openwiki/architecture/worker.md]] — the service started by `celery worker`.
- [[/openwiki/architecture/application.md]] — configuration, loader and env variables used by the CLI.
