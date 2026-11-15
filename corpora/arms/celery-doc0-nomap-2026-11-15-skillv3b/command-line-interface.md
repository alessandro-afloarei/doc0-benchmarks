---
title: "Command Line Interface"
---
## Overview

`celery` is a single command with subcommands, built on click. The top-level group loads the application named by `-A`, stores it in a context object, and hands it to the subcommand: `worker`, `beat`, `events`, `inspect`, `call` and the rest. Every subcommand therefore runs against the same configured app, and the group exposes hooks for applications to add their own options and for packages to add their own subcommands. The long-running programs have their own pages: [[Worker Startup and Shutdown]], [[Periodic Tasks with Beat]], [[Events and Monitoring]], [[Remote Control and Inspection]] and [[Running Workers in Production]].

Sources: [celery/bin/celery.py:55-163](repo://celery/bin/celery.py#L55-L163), [celery/bin/celery.py:175-191](repo://celery/bin/celery.py#L175-L191)

## Entry point

The `celery` console script runs `celery.__main__:main`. Before importing anything else, it calls `maybe_patch_concurrency`, which looks for `-P eventlet` or `-P gevent` in `sys.argv` and monkey-patches the standard library first, as green pools require ([[Execution Pools]]); `celery multi` is skipped because it only starts other processes. It then calls the click group with `auto_envvar_prefix='CELERY'`, so options can also come from `CELERY_*` environment variables. `python -m celery` and `app.start()` use the same group.

Sources: [celery/__main__.py:1-19](repo://celery/__main__.py#L1-L19), [setup.py:155-159](repo://setup.py#L155-L159), [celery/bin/celery.py:220-227](repo://celery/bin/celery.py#L220-L227), [celery/app/base.py:480-497](repo://celery/app/base.py#L480-L497)

## Global options

Global options go before the subcommand name. Since Celery 5, `-A` after the subcommand is an error, and click's message is patched to explain the new order.

Sources: [celery/bin/celery.py:193-217](repo://celery/bin/celery.py#L193-L217)

| Option | Environment | Effect |
| --- | --- | --- |
| `-A`, `--app` | `CELERY_APP` | Module or `module:attribute` of the app |
| `-b`, `--broker` | `CELERY_BROKER_URL` | Broker URL, exported as `CELERY_BROKER_URL` |
| `--result-backend` | `CELERY_RESULT_BACKEND` | Result backend URL |
| `--loader` | `CELERY_LOADER` | Loader class |
| `--config` | `CELERY_CONFIG_MODULE` | Configuration module for the loader |
| `--workdir` | | Change directory before loading the app |
| `-C`, `--no-color` | `CELERY_NO_COLOR` | Disable colours |
| `-q`, `--quiet` | | Less output |
| `--version` | | Print the version banner |
| `--skip-checks` | `CELERY_SKIP_CHECKS` | Skip Django system checks at start |

Sources: [celery/bin/celery.py:55-133](repo://celery/bin/celery.py#L55-L133)

The broker, backend, loader and config options are exported as environment variables rather than set on the app, because the `Settings` properties read those variables first ([[Configuration and Loaders]]); this way they override any configuration file the app loads later.

Sources: [celery/bin/celery.py:123-133](repo://celery/bin/celery.py#L123-L133), [celery/app/utils.py:84-112](repo://celery/app/utils.py#L84-L112)

## Finding the app

`find_app(name)` resolves `-A` with `symbol_by_name`, importing from the current directory. When the name is a module (and has no `:attribute`), it tries in order: an attribute named `app`, an attribute named `celery` (rejecting the `celery` package itself), the submodule `<name>.celery` if the module is a package, and finally any attribute that is a `Celery` instance. So `-A proj` works for `proj/celery.py` defining `app`, which is the layout most projects use.

Sources: [celery/app/utils.py:378-415](repo://celery/app/utils.py#L378-L415)

The group turns the failures into readable errors: a missing module, a module that raises while being imported (with the traceback), or a module without an app.

Sources: [celery/bin/celery.py:135-152](repo://celery/bin/celery.py#L135-L152)

## Shared command classes

### CLIContext

`CLIContext` is stored as `ctx.obj` and carries the app, colour and quiet flags and the working directory. It provides output helpers used by all subcommands: `echo`, `secho`, `error`, `say_chat` for request and reply lines, and `pretty` for formatting control replies with `OK` or `ERROR` markers.

Sources: [celery/bin/base.py:37-121](repo://celery/bin/base.py#L37-L121)

### Commands and options

`CeleryCommand` groups options in the help output by their `help_group`. `CeleryDaemonCommand` adds the daemon options `--logfile/-f`, `--pidfile`, `--uid`, `--gid`, `--umask` and `--executable`; each `DaemonOption` falls back to a setting named after the command, such as `worker_pidfile` or `beat_logfile`, when not given. Parameter types parse comma-separated lists, JSON arrays and objects, ISO 8601 dates (or a number of seconds) and log level names.

Sources: [celery/bin/base.py:163-228](repo://celery/bin/base.py#L163-L228), [celery/bin/base.py:230-329](repo://celery/bin/base.py#L230-L329)

`handle_remote_command_error` turns a broker connection failure into `Could not connect to the message broker` with exit code `EX_UNAVAILABLE`, instead of a traceback.

Sources: [celery/bin/base.py:123-141](repo://celery/bin/base.py#L123-L141)

## Extending the command

Applications add options to existing commands through `app.user_options`, a dict of lists of click options keyed by `worker`, `beat`, `events` or `preload`. The group appends them to the commands when it starts; `preload` options go on every subcommand, and `handle_preload_options` sends their values through the `user_preload_options` signal so the app can act on them before the command runs.

Sources: [celery/bin/celery.py:157-163](repo://celery/bin/celery.py#L157-L163), [celery/bin/base.py:143-160](repo://celery/bin/base.py#L143-L160)

```python
from click import Option
from celery import signals

app.user_options['preload'].append(
    Option(('--monitoring',), is_flag=True, help='Enable monitoring.'))


@signals.user_preload_options.connect
def on_preload_parsed(options, **kwargs):
    if options['monitoring']:
        enable_monitoring()
```

Sources: [celery/bin/base.py:143-160](repo://celery/bin/base.py#L143-L160)

Packages add whole subcommands through the `celery.commands` entry point group, loaded with `click_plugins`. The group also uses `click_didyoumean`, so a mistyped subcommand suggests the closest name.

Sources: [celery/bin/celery.py:46-56](repo://celery/bin/celery.py#L46-L56)

## Subcommands

### Catalogue

| Command | Purpose | Page |
| --- | --- | --- |
| `worker` | Start a worker | [[Worker Startup and Shutdown]] |
| `beat` | Start the periodic task scheduler | [[Periodic Tasks with Beat]] |
| `multi` | Start, stop and restart several workers | [[Running Workers in Production]] |
| `events` | Curses monitor, event dump, or snapshot camera | [[Events and Monitoring]] |
| `inspect`, `control`, `status` | Query and command live workers | [[Remote Control and Inspection]] |
| `call` | Send a task by name | |
| `result` | Print a task's result or traceback | |
| `purge` | Delete all waiting messages from task queues | |
| `shell` | Python shell with the app and tasks loaded | |
| `migrate` | Move messages from one broker to another | [[Contrib Extensions]] |
| `upgrade settings` | Rewrite a settings file to the new setting names | |
| `graph bootsteps`, `graph workers` | Print dot graphs of bootsteps or the cluster | |
| `logtool` | Analyse worker log files | |
| `amqp` | Interactive AMQP administration shell | |
| `list bindings` | List queue bindings on the broker | |
| `report` | Print versions and settings for bug reports | |

Sources: [celery/bin/celery.py:166-191](repo://celery/bin/celery.py#L166-L191)

### call and result

`celery call NAME` sends a task with `app.send_task`, so the task code does not need to be importable; `-a/--args` and `-k/--kwargs` take JSON, and `--countdown`, `--eta`, `--expires`, `--queue`, `--exchange`, `--routing-key` and `--serializer` map to the send options. It prints the task id. `celery result ID` prints the value from the result backend, waiting for it, or the traceback with `--traceback`.

Sources: [celery/bin/call.py:1-71](repo://celery/bin/call.py#L1-L71), [celery/bin/result.py:1-30](repo://celery/bin/result.py#L1-L30)

```bash
celery -A proj call tasks.add -a '[2, 2]' --countdown 10
celery -A proj result 3f6d5b1c-...
```

Sources: [celery/bin/call.py:9-71](repo://celery/bin/call.py#L9-L71)

### purge

`celery purge` deletes every waiting message from the app's known queues, or from `-Q` queues minus `-X` queues. It asks for confirmation unless `-f` is given, purges each queue with `queue_purge` (ignoring queues that do not exist), and reports the number of messages removed. Messages already reserved by workers are not affected, and there is no undo.

Sources: [celery/bin/purge.py:1-70](repo://celery/bin/purge.py#L1-L70)

### shell

`celery shell` imports the default modules and opens IPython, bpython or the plain interpreter (chosen with `-I`, `-B`, `--python` or by what is installed) with `app`, `celery`, `Task`, `chain`, `group`, `chord`, `chunks`, `xmap`, `xstarmap`, `signature` and every non-built-in task already in scope; `-T` leaves the tasks out.

Sources: [celery/bin/shell.py:82-173](repo://celery/bin/shell.py#L82-L173)

### report and upgrade

`celery report` imports the task modules and prints `app.bugreport()`: Celery, kombu, billiard and Python versions, platform, loader, transport and result backend, and the non-default settings with secrets masked. `celery upgrade settings FILE` rewrites a configuration file from the old uppercase setting names to the new ones (or to `CELERY_`-prefixed names with `--django`), keeping a backup unless `--no-backup`.

Sources: [celery/bin/celery.py:166-172](repo://celery/bin/celery.py#L166-L172), [celery/app/utils.py:346-376](repo://celery/app/utils.py#L346-L376), [celery/bin/upgrade.py:12-91](repo://celery/bin/upgrade.py#L12-L91)
