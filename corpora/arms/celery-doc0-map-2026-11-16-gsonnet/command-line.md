---
title: "Command Line Interface"
---
## Overview

Every `celery` subcommand is a click command attached to one group, `celery.bin.celery.celery`. The group handles what is common to all of them: it finds the application, turns the global options into environment variables the app reads, and puts a `CLIContext` on the click context so each subcommand can reach the app. The subcommands themselves are thin: they build the objects described on other pages (`app.Worker`, `Beat`, `app.control.inspect()`, `app.send_task`) and call them.

Sources: [celery/bin/celery.py:55-165](repo://celery/bin/celery.py#L55-L165), [celery/bin/celery.py:175-191](repo://celery/bin/celery.py#L175-L191)

`main()` is the console entry point: it calls the group with `auto_envvar_prefix="CELERY"`, so any option can also be given as a `CELERY_*` environment variable, and a handful of options declare their own variable names such as `APP` and `BROKER_URL`.

Sources: [celery/bin/celery.py:220-226](repo://celery/bin/celery.py#L220-L226), [celery/bin/celery.py:55-110](repo://celery/bin/celery.py#L55-L110)

## The global group

The group is declared with `DYMGroup` (suggestions for mistyped command names) and `invoke_without_command=True`. Its global options are `-A/--app`, `-b/--broker`, `--result-backend`, `--loader`, `--config`, `--workdir`, `-C/--no-color`, `-q/--quiet`, `--version` and `--skip-checks`. `with_plugins` adds commands from the `celery.commands` entry-point group, so third-party packages can add subcommands.

Sources: [celery/bin/celery.py:34-54](repo://celery/bin/celery.py#L34-L54), [celery/bin/celery.py:55-112](repo://celery/bin/celery.py#L55-L112)

When the group runs it handles these cases in order:

Sources: [celery/bin/celery.py:113-165](repo://celery/bin/celery.py#L113-L165)

1. `--version` prints the banner and exits, and no subcommand prints the help text.
2. `--loader`, `--broker`, `--result-backend`, `--config` and `--skip-checks` are copied into `CELERY_LOADER`, `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND`, `CELERY_CONFIG_MODULE` and `CELERY_SKIP_CHECKS`. The default app reads these when it is created.
3. A string `app` is resolved with `find_app`, and the three kinds of failure (module missing, attribute missing, any other error) each produce their own message through `ctx.fail`.
4. `ctx.obj` becomes a `CLIContext(app, no_color, workdir, quiet)`.
5. Options registered by the application in `app.user_options` are added to the `worker`, `beat` and `events` commands, and the `preload` options are added to every command.

Sources: [celery/bin/celery.py:113-165](repo://celery/bin/celery.py#L113-L165)

The `-A` option is declared with `click.UNPROCESSED` because it may be a string from the command line or a `Celery` object when `Celery.start` runs the CLI programmatically ([[The Celery App and Configuration]]). Using `-A` after a subcommand name is a usage error: the monkey-patched `NoSuchOption.show` replaces click's message with one explaining that `--app` is global since Celery 5.0.

Sources: [celery/bin/celery.py:57-66](repo://celery/bin/celery.py#L57-L66), [celery/bin/celery.py:193-217](repo://celery/bin/celery.py#L193-L217), [celery/app/base.py:480-497](repo://celery/app/base.py#L480-L497)

## Finding the app

`find_app(name)` first tries to resolve the name as `module:attribute` with `symbol_by_name`; if the last part is not an attribute it imports it as a module. When the result is a module and the name had no colon, it looks for an attribute called `app`, then `celery` (ignoring one that is the `celery` package), then for a package tries `<name>.celery`, and finally scans the module for any `Celery` instance. That is why `-A proj` works for a project with `proj/celery.py`.

Sources: [celery/app/utils.py:378-415](repo://celery/app/utils.py#L378-L415)

## The CLI context and options

`CLIContext` holds the app (falling back to the current app), the colour and quiet flags and the working directory. It provides styled output helpers (`secho`, `echo`, `error`) that skip colours when `--no-color` is set, and `pretty` formats replies: lists as bullet lines, a dict with `ok` or `error` keys as a status line and indented body, other dicts as highlighted JSON.

Sources: [celery/bin/base.py:37-121](repo://celery/bin/base.py#L37-L121)

Celery subclasses click's `Option` and `Command` for grouped help output. `CeleryOption` adds `help_group`, and `CeleryCommand.format_options` prints options in sections. `CeleryDaemonCommand` adds `--logfile`, `--pidfile`, `--uid`, `--gid`, `--umask` and `--executable`, each a `DaemonOption` whose value falls back to a setting named after the command, for example `worker_pidfile`. `handle_preload_options` wraps a command so the preload options registered by the app are collected and sent to the `user_preload_options` signal before it runs.

Sources: [celery/bin/base.py:143-228](repo://celery/bin/base.py#L143-L228)

## Subcommands

| Command | Does |
| --- | --- |
| `worker` | Starts a worker (below) |
| `beat` | Starts the scheduler, see [[Beat: Periodic Task Scheduler]] |
| `events` | Event dump, snapshot camera or curses monitor, see [[Events and Monitoring]] |
| `inspect`, `control`, `status` | Send inspect or control commands and print the replies, see [[Remote Control and Revoking]] |
| `call` | Publishes a task by name through `app.send_task` and prints the task id |
| `result` | Prints the return value or, with `--traceback`, the traceback of a task id |
| `purge` | Discards waiting messages |
| `multi` | Runs several workers (below) |
| `list`, `migrate`, `graph`, `upgrade`, `logtool`, `amqp`, `shell`, `report` | Utilities |

Sources: [celery/bin/celery.py:166-191](repo://celery/bin/celery.py#L166-L191), [celery/bin/call.py:58-71](repo://celery/bin/call.py#L58-L71), [celery/bin/result.py:20-30](repo://celery/bin/result.py#L20-L30)

`inspect` checks the command name, converts the extra command-line arguments to keyword arguments, and calls `app.control.inspect(...)._request(command, **arguments)`. With no replies it raises a `CeleryCommandException` with exit code `EX_UNAVAILABLE` and the message that no nodes replied within the time constraint; with `--json` it prints the replies as JSON, and otherwise it prints each reply through the callback followed by the number of nodes online.

Sources: [celery/bin/control.py:178-205](repo://celery/bin/control.py#L178-L205)

## Starting a worker

The `worker` command is a `CeleryDaemonCommand` with options in groups for worker, pool, queue, features and embedded beat settings (`-n`, `-D`, `-S`, `-P`, `-c`, `-Q`, `-B`, `--autoscale` and others). Its body does the following:

Sources: [celery/bin/worker.py:310-371](repo://celery/bin/worker.py#L310-L371)

1. Applies `--disable-prefetch` to the app's `worker_disable_prefetch`, and any extra `--name=value` arguments with `app.config_from_cmdline(ctx.args, namespace='worker')`, turning parse errors into click usage errors.
2. If `--detach` was given, builds an argument list from `sys.argv` with the detach, `--uid` and `--gid` options removed, and calls `detach`, which returns instead of starting a worker.
3. Otherwise calls `maybe_drop_privileges(uid, gid)`, creates `app.Worker(...)` with the hostname, pool, log level, pidfile and state db after node-name formatting (`%h`, `%n`, `%d`), and calls `worker.start()`.
4. Exits with the worker's exit code. A `SecurityError` is printed and exits 1.

Sources: [celery/bin/worker.py:136-176](repo://celery/bin/worker.py#L136-L176), [celery/bin/worker.py:310-371](repo://celery/bin/worker.py#L310-L371)

The worker's constructor then follows the path in [[Worker Startup and Bootsteps]]. The concrete class is `celery.apps.worker.Worker`, whose `on_before_init` also sends `celeryd_init` and calls `check_privileges(accept_content)`.

Sources: [celery/app/base.py:1431-1437](repo://celery/app/base.py#L1431-L1437), [celery/apps/worker.py:94-104](repo://celery/apps/worker.py#L94-L104)

## Detaching

`detach` formats the log file name and uses the `detached` context manager to daemonize. Inside it, it calls `os.execv` to replace the process with `python -m celery ...` using the remaining arguments, and if that fails logs a critical error through the logging subsystem and returns `EX_FAILURE`. The `C_FAKEFORK` environment variable makes it skip the actual detach for debugging.

Sources: [celery/bin/worker.py:108-133](repo://celery/bin/worker.py#L108-L133)

`detached` refuses to run on platforms without `resource`, resets `SIGCLD`, drops privileges, and returns a `DaemonContext` whose `after_chdir` hook opens the log file for append, so a bad path fails before the process disappears, and acquires and releases the pidlock to test it is not stale. `DaemonContext` skips the real detach when `fake` is set.

Sources: [celery/platforms.py:310-345](repo://celery/platforms.py#L310-L345), [celery/platforms.py:376-425](repo://celery/platforms.py#L376-L425)

## Privileges and pidfiles

`maybe_drop_privileges` does nothing on Windows. If the process is not root it only guards against an inconsistent real uid. When a uid is given, `_setuid` first sets the group (the user's primary group if none was given), calls `initgroups`, then `setuid`, and then tries `setuid(0)`: if that succeeds it raises `SecurityError`, because the drop was not permanent. Afterwards, a uid or gid that is still 0 also raises.

Sources: [celery/platforms.py:528-585](repo://celery/platforms.py#L528-L585)

`check_privileges(accept_content)` is called when the worker is built. If the process runs as root, or in the `sudo` or `wheel` group, and the worker accepts `pickle` (or the Python serializer content type), it raises `SecurityError` unless `C_FORCE_ROOT` is set; otherwise it only emits a `SecurityWarning`. A group id with no database entry is treated as a possible risk.

Sources: [celery/platforms.py:67-90](repo://celery/platforms.py#L67-L90), [celery/platforms.py:788-845](repo://celery/platforms.py#L788-L845)

`create_pidlock` builds a `Pidfile`, and if the file exists and the process it names is still running, prints the `PIDLOCKED` message and exits with `EX_CANTCREAT`. A stale pidfile is removed. It registers an `atexit` handler to release the lock. The worker takes this lock in `on_start`, and beat does the same.

Sources: [celery/platforms.py:244-275](repo://celery/platforms.py#L244-L275), [celery/worker/worker.py:150-153](repo://celery/worker/worker.py#L150-L153)

## Running several workers

`celery multi` hands the remaining arguments to `MultiTool.execute_from_commandline`, after moving the `multi` word to the front of the arguments, because `--app` is global. The library part is in `celery/apps/multi.py`.

Sources: [celery/bin/multi.py:454-480](repo://celery/bin/multi.py#L454-L480)

`MultiParser` turns a list such as `3`, `image video data` or `foo@host` into `Node` objects, expanding ranges (the `--range-prefix` option) and applying namespaced options, such as `-c:1 4` for node 1 only. Each `Node` builds its command line in `_prepare_argv`: global options (`-A`, `-b`, `--loader`, `--config`, `--workdir`, `-C`, `-q`) are inserted right after `celery`, so they precede the `worker` subcommand, and the rest follow it. The default command is `celery worker --detach`, and `start` runs it through `Popen` and waits for it, so each node detaches itself and the wait returns once it has started. Defaults for `--pidfile` and `--logfile` are `/var/run/celery/%n.pid` and `/var/log/celery/%n%I.log`.

Sources: [celery/apps/multi.py:122-192](repo://celery/apps/multi.py#L122-L192), [celery/apps/multi.py:125-136](repo://celery/apps/multi.py#L125-L136), [celery/apps/multi.py:208-232](repo://celery/apps/multi.py#L208-L232), [celery/apps/multi.py:285-330](repo://celery/apps/multi.py#L285-L330)

`Cluster` is the list of nodes with `start`, `restart`, `stop`, `stopwait` and `kill`. Starting calls each node's `start` and reports the return code through callbacks, and stopping sends a signal (`SIGTERM` by default) to each live node, found from its pidfile, and with `stopwait` retries until the nodes have gone.

Sources: [celery/apps/multi.py:367-460](repo://celery/apps/multi.py#L367-L460)
