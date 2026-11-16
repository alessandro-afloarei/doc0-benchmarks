---
title: "Command Line Interface"
---
## Overview

The `celery` program is a Click command group. The installed `celery` console script calls `celery.__main__:main`, which applies eventlet or gevent monkey patches when `-P` asks for them ([[Concurrency Pools]]) and then runs the group with `auto_envvar_prefix="CELERY"`, so options can also come from `CELERY_*` environment variables. Global options, most importantly `-A`, are given before the subcommand: `celery -A proj worker`, not `celery worker -A proj`.

Sources: [celery/__main__.py:1-18](repo://celery/__main__.py#L1-L18), [celery/bin/celery.py:217-227](repo://celery/bin/celery.py#L217-L227), [setup.py:155-159](repo://setup.py#L155-L159)

Additional subcommands can be installed by packages through the `celery.commands` entry-point group, which `click_plugins` adds to the group; mistyped subcommand names get suggestions from `click_didyoumean`.

Sources: [celery/bin/celery.py:44-56](repo://celery/bin/celery.py#L44-L56)

## Global options

| Option | Environment | Effect |
| --- | --- | --- |
| `-A`, `--app` | `APP` | The app to load: `module`, `module:attribute` or `module.attribute` |
| `-b`, `--broker` | `BROKER_URL` | Sets `CELERY_BROKER_URL`, which overrides the broker setting |
| `--result-backend` | `RESULT_BACKEND` | Sets `CELERY_RESULT_BACKEND` |
| `--loader` | `LOADER` | Sets `CELERY_LOADER` for the default app |
| `--config` | `CONFIG_MODULE` | Sets `CELERY_CONFIG_MODULE` |
| `--workdir` | | Changes directory before anything else (eager) |
| `-C`, `--no-color` | `NO_COLOR` | Disable colours |
| `-q`, `--quiet` | | Less output |
| `--version` | | Print the version banner and exit |
| `--skip-checks` | `SKIP_CHECKS` | Sets `CELERY_SKIP_CHECKS`, skipping Django checks at startup |

Sources: [celery/bin/celery.py:57-140](repo://celery/bin/celery.py#L57-L140)

The URLs are passed on through environment variables because `Settings` reads `CELERY_BROKER_URL` and `CELERY_RESULT_BACKEND` before the configured values ([[Configuration and Loaders]]). Without a subcommand, `celery` prints its help.

Sources: [celery/bin/celery.py:120-140](repo://celery/bin/celery.py#L120-L140), [celery/app/utils.py:96-109](repo://celery/app/utils.py#L96-L109)

## Loading the app

`-A` is resolved by `find_app`. A `module:attr` path is loaded directly. For a plain module it looks for an attribute `app`, then `celery`; if neither is an app and the module is a package, it tries the submodule `<package>.celery`; finally it returns the first `Celery` instance among the module's attributes. The command reports distinct errors for a missing module, an import error inside the module (with traceback), and a missing attribute. Using `-A` after the subcommand produces a message explaining that this form was removed in Celery 5.0.

Sources: [celery/app/utils.py:378-415](repo://celery/app/utils.py#L378-L415), [celery/bin/celery.py:142-162](repo://celery/bin/celery.py#L142-L162), [celery/bin/celery.py:191-214](repo://celery/bin/celery.py#L191-L214)

The loaded app is stored in a `CLIContext` on `ctx.obj`, together with the colour, quiet and workdir flags, and subcommands read it as `ctx.obj.app`. Without `-A`, the context falls back to the current app. `CLIContext` also provides the output helpers (`echo`, `error`, `secho`, `pretty`) that format command replies.

Sources: [celery/bin/celery.py:164-174](repo://celery/bin/celery.py#L164-L174), [celery/bin/base.py:37-121](repo://celery/bin/base.py#L37-L121)

## Subcommands

| Command | Purpose | Page |
| --- | --- | --- |
| `worker` | Start a worker | [[Worker Startup and Bootsteps]] |
| `beat` | Start the periodic task scheduler | [[Beat Scheduler]] |
| `events` | Curses monitor, event dump, or snapshot camera | [[Events and Monitoring]] |
| `multi` | Start, stop and restart several workers | [[Multi and Daemonization]] |
| `call NAME` | Send a task by name and print its id | |
| `result TASK_ID` | Print a task's return value or traceback | |
| `status` | Ping workers and print those online | |
| `inspect COMMAND` | Run an inspect command on workers | [[Remote Control and Revocation]] |
| `control COMMAND` | Run a control command on workers | [[Remote Control and Revocation]] |
| `purge` | Delete all messages from task queues | |
| `shell` | Python shell with the app and canvas names preloaded | |
| `migrate SOURCE DESTINATION` | Move task messages from one broker to another | |
| `list bindings` | Show queue bindings | |
| `graph bootsteps`, `graph workers` | Print dependency graphs | |
| `amqp` | AMQP administration shell (declare, bind, purge, delete) | |
| `upgrade settings FILE` | Rewrite old setting names to the new format | |
| `logtool` | Statistics, traces, errors and incomplete tasks from worker logs | |
| `report` | Print the bug-report information | |

Sources: [celery/bin/celery.py:176-195](repo://celery/bin/celery.py#L176-L195), [celery/bin/graph.py:11-36](repo://celery/bin/graph.py#L11-L36), [celery/bin/list.py:7-22](repo://celery/bin/list.py#L7-L22), [celery/bin/amqp.py:61-90](repo://celery/bin/amqp.py#L61-L90), [celery/bin/upgrade.py:12-73](repo://celery/bin/upgrade.py#L12-L73), [celery/bin/logtool.py:113-157](repo://celery/bin/logtool.py#L113-L157)

## Calling tasks and reading results

`celery call NAME` sends with `app.send_task`, so the task does not need to be importable in the calling process ([[Sending Tasks]]). Arguments are JSON: `-a '[2, 2]'` and `-k '{"x": 1}'`. Further options are `--eta` (ISO 8601), `--countdown` (seconds), `--expires` (ISO 8601 or seconds), `--serializer` (default `json`), `--queue`, `--exchange` and `--routing-key`. It prints the new task id.

Sources: [celery/bin/call.py:8-70](repo://celery/bin/call.py#L8-L70)

`celery result TASK_ID` builds an `AsyncResult` (the task's own class with `-t NAME`, for tasks with a custom backend) and prints `get()`, or the traceback with `--traceback`.

Sources: [celery/bin/result.py:7-29](repo://celery/bin/result.py#L7-L29)

## Talking to workers

`celery status`, `celery inspect COMMAND` and `celery control COMMAND` share `-t/--timeout` (default 1 second), `-d/--destination` (comma-separated node names) and `-j/--json`. `status` pings all workers and prints each reply and `N nodes online`; no reply raises an error with exit status `EX_UNAVAILABLE`.

Sources: [celery/bin/control.py:104-150](repo://celery/bin/control.py#L104-L150)

`inspect` and `control` take the command name and its arguments from the remaining command line. They check the name against `Panel.meta` for the right type and convert positional arguments with the converters registered with the command, collecting extra ones for variadic commands ([[Remote Control and Revocation]]). `--list` prints the available commands with their signatures and help.

Sources: [celery/bin/control.py:22-102](repo://celery/bin/control.py#L22-L102), [celery/bin/control.py:153-230](repo://celery/bin/control.py#L153-L230)

```bash
celery -A proj inspect active
celery -A proj control rate_limit tasks.add 10/m
celery -A proj control revoke 3f1e...-id
celery -A proj inspect --list
```

Sources: [celery/worker/control.py:134-140](repo://celery/worker/control.py#L134-L140), [celery/worker/control.py:255-259](repo://celery/worker/control.py#L255-L259), [celery/worker/control.py:444-449](repo://celery/worker/control.py#L444-L449)

Connection failures in these commands are turned into a `CeleryCommandException` with exit status `EX_UNAVAILABLE` and a message asking to check that the broker is running.

Sources: [celery/bin/base.py:123-140](repo://celery/bin/base.py#L123-L140)

## Purging queues

`celery purge` deletes waiting messages from every queue in `app.amqp.queues`, or from those given with `-Q`, minus those given with `-X`. The docstring warns there is no undo; the command asks for confirmation unless `-f/--force` is passed, then purges each queue, ignoring channel errors for missing ones, and prints the count.

Sources: [celery/bin/purge.py:8-70](repo://celery/bin/purge.py#L8-L70)

## Daemon options

`worker`, `beat` and `events` use `CeleryDaemonCommand`, which adds `--logfile/-f`, `--pidfile`, `--uid`, `--gid`, `--umask` and `--executable`. When one is not given, it is looked up in the configuration under the command's name as prefix, such as `worker_pidfile` or `beat_logfile`, if that key exists ([[Multi and Daemonization]]).

Sources: [celery/bin/base.py:197-227](repo://celery/bin/base.py#L197-L227)

## Extending the CLI

Apps can add options to commands through `app.user_options`, a mapping from command name to a set of Click options. The top-level command appends `user_options['worker']`, `['beat']` and `['events']` to those commands, and `user_options['preload']` to every subcommand. Commands decorated with `handle_preload_options` send the `user_preload_options` signal with the parsed values of the preload options, so an app can act on them (for example, to load extra configuration) before the command runs.

Sources: [celery/bin/celery.py:167-174](repo://celery/bin/celery.py#L167-L174), [celery/bin/base.py:143-160](repo://celery/bin/base.py#L143-L160), [celery/app/base.py:301-303](repo://celery/app/base.py#L301-L303), [celery/app/base.py:369-369](repo://celery/app/base.py#L369-L369)

`CeleryOption` adds a `help_group` used by `CeleryCommand` to group options under headings in `--help`, and command-specific parameter types handle comma-separated lists, JSON arrays and objects, ISO 8601 datetimes and log levels.

Sources: [celery/bin/base.py:163-195](repo://celery/bin/base.py#L163-L195), [celery/bin/base.py:230-329](repo://celery/bin/base.py#L230-L329)

`app.start(argv)` and `app.worker_main(argv)` run the same CLI from Python with the app preset as `-A`, which is how `if __name__ == '__main__': app.start()` in the examples works.

Sources: [celery/app/base.py:480-513](repo://celery/app/base.py#L480-L513), [examples/tutorial/tasks.py:11-12](repo://examples/tutorial/tasks.py#L11-L12)
