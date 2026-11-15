---
title: "Command-Line Interface"
---
## Overview

The `celery` command is one umbrella program built with click: a group with global options that locate the app, and one subcommand per tool, from `worker` and `beat` to `inspect`, `call` and `purge`. The console script points at `celery.__main__:main`, which applies eventlet or gevent monkey patches before anything else is imported and then runs the click group. Third-party packages can add subcommands through the `celery.commands` entry point. This page covers the shared machinery and lists each subcommand with the page that explains what it drives.

Sources: [celery/__main__.py:1-18](repo://celery/__main__.py#L1-L18), [celery/bin/celery.py:46-56](repo://celery/bin/celery.py#L46-L56), [celery/bin/celery.py:175-227](repo://celery/bin/celery.py#L175-L227)

## Global options

Global options go before the subcommand: `celery -A proj worker`, not `celery worker -A proj`. Using `-A` after the subcommand fails with a message explaining the Celery 5 change.

Sources: [celery/bin/celery.py:193-217](repo://celery/bin/celery.py#L193-L217)

| Option | Environment variable | Effect |
| --- | --- | --- |
| `-A`, `--app` | `CELERY_APP` | Module or `module:attribute` of the app |
| `-b`, `--broker` | `CELERY_BROKER_URL` | Broker URL |
| `--result-backend` | `CELERY_RESULT_BACKEND` | Result backend URL |
| `--loader` | `CELERY_LOADER` | Loader class |
| `--config` | `CELERY_CONFIG_MODULE` | Configuration module |
| `--workdir` | | Change directory before anything else |
| `-C`, `--no-color` | `NO_COLOR` | Plain output |
| `-q`, `--quiet` | | Less output |
| `--version` | | Print the version banner |
| `--skip-checks` | `CELERY_SKIP_CHECKS` | Skip Django system checks |

Sources: [celery/bin/celery.py:55-111](repo://celery/bin/celery.py#L55-L111), [celery/bin/celery.py:220-227](repo://celery/bin/celery.py#L220-L227)

The group callback turns `--broker`, `--result-backend`, `--loader`, `--config` and `--skip-checks` into the environment variables above, which take precedence over configured values when the app reads its settings ([[Configuration and Loaders]]). It then resolves `-A` with `find_app`, failing with a specific message when the module is not found, an attribute is missing, or importing raised. The resolved app is stored in a `CLIContext` on `ctx.obj`, and the app's custom options in `app.user_options` are added to `worker`, `beat`, `events` and, for `preload`, to every command.

Sources: [celery/bin/celery.py:113-163](repo://celery/bin/celery.py#L113-L163), [celery/app/utils.py:378-415](repo://celery/app/utils.py#L378-L415)

`app.start(argv)` runs the same group with the app preset as the default for `-A`, which is how `python tasks.py worker` works.

Sources: [celery/app/base.py:480-497](repo://celery/app/base.py#L480-L497)

## Shared building blocks

### Context, options and types

`celery/bin/base.py` holds what subcommands share, listed below.

Sources: [celery/bin/base.py:37-46](repo://celery/bin/base.py#L37-L46)

- `CLIContext` carries the app and output settings, and provides `echo`, `error`, `secho` and the `OK`/`ERROR` styles. `pretty()` renders replies: lists as bullets, `{'ok': ...}` and `{'error': ...}` dicts with a status, other dicts as highlighted JSON.
- `CeleryOption` adds a `help_group`, and `CeleryCommand` prints options grouped under those headings.
- `CeleryDaemonCommand` adds `--logfile/-f`, `--pidfile`, `--uid`, `--gid`, `--umask` and `--executable`. Each falls back to the setting named after the command, such as `worker_pidfile` or `beat_logfile`.
- Parameter types parse JSON arrays and objects, ISO 8601 datetimes (or floats), comma-separated lists and log level names.
- `handle_preload_options` sends `user_preload_options` with the values of custom preload options.
- `handle_remote_command_error` turns a broker connection failure into a clear "Could not connect to the message broker" error with exit code `EX_UNAVAILABLE`.

Sources: [celery/bin/base.py:37-121](repo://celery/bin/base.py#L37-L121), [celery/bin/base.py:123-160](repo://celery/bin/base.py#L123-L160), [celery/bin/base.py:163-228](repo://celery/bin/base.py#L163-L228), [celery/bin/base.py:230-329](repo://celery/bin/base.py#L230-L329)

### Adding options to commands

An app adds its own options by appending click options to `app.user_options[...]`. Values of `preload` options reach the `user_preload_options` signal, so an application can act on them before the command runs.

Sources: [celery/bin/base.py:143-160](repo://celery/bin/base.py#L143-L160)

```python
from celery import Celery, signals
from celery.bin.base import CeleryOption

app = Celery()
app.user_options['preload'].add(CeleryOption(
    ('--monitoring',), is_flag=True, help='Enable monitoring hooks.'))

@signals.user_preload_options.connect
def on_preload_parsed(options, **kwargs):
    if options['monitoring']:
        enable_monitoring()
```

Sources: [celery/bin/celery.py:157-163](repo://celery/bin/celery.py#L157-L163), [celery/bin/base.py:143-160](repo://celery/bin/base.py#L143-L160)

## Subcommands

### Catalogue

| Command | What it does | See |
| --- | --- | --- |
| `worker` | Start a worker; `-c`, `-P`, `-Q`, `-X`, `-l`, `-n`, `-B`, `-E`, `--autoscale`, `--detach` and more | [[Worker Startup and Bootsteps]] |
| `beat` | Start the periodic task scheduler; `-s`, `-S`, `--max-interval`, `--detach` | [[Periodic Tasks with Beat]] |
| `events` | Curses monitor; `--dump` prints events; `--camera` takes snapshots | [[Events and Monitoring]] |
| `status` | Ping all workers and list those that reply | [[Remote Control and Inspection]] |
| `inspect <command>` | Run an inspect command (`active`, `reserved`, `stats`, ...) | [[Remote Control and Inspection]] |
| `control <command>` | Run a control command (`revoke`, `rate_limit`, `shutdown`, ...) | [[Remote Control and Inspection]] |
| `call <name>` | Send a task by name and print its id | [[Sending Tasks and Routing]] |
| `result <task_id>` | Print a task's result (or `--traceback`) | [[Task Results]] |
| `purge` | Delete all messages from the task queues | |
| `shell` | Python shell with the app, canvas primitives and tasks imported | |
| `migrate <source> <destination>` | Move task messages from one broker to another | |
| `list bindings` | Show queue bindings on the broker | |
| `amqp` | Interactive AMQP shell: declare, bind, publish, get, purge | |
| `multi` | Start and manage several worker nodes | [[celery multi and Daemonization]] |
| `graph bootsteps` / `graph workers` | Print bootstep or cluster graphs in dot format | |
| `logtool` | Statistics, traces, errors and incomplete tasks from worker log files | |
| `upgrade settings <file>` | Rewrite a settings file from old upper-case names to new ones | [[Configuration and Loaders]] |
| `report` | Print `app.bugreport()` for bug reports | |

Sources: [celery/bin/celery.py:166-191](repo://celery/bin/celery.py#L166-L191), [celery/bin/control.py:107-150](repo://celery/bin/control.py#L107-L150), [celery/bin/control.py:211-262](repo://celery/bin/control.py#L211-L262), [celery/bin/result.py:7-22](repo://celery/bin/result.py#L7-L22), [celery/bin/graph.py:11-36](repo://celery/bin/graph.py#L11-L36), [celery/bin/upgrade.py:55-73](repo://celery/bin/upgrade.py#L55-L73)

### inspect, control and status

`celery inspect <command> [args...]` and `celery control <command> [args...]` validate the command name against the remote-control `Panel` registry, showing the list of known commands of that type when the name is wrong; `--list` prints them with their signatures. Extra positional arguments are converted using the command's declared argument types, and a variadic tail (such as task ids for `revoke`) is passed as a list. Both take `-t/--timeout` (default 1 second), `-d/--destination` (comma-separated node names) and `-j/--json`. Replies are printed as they arrive. When no node answers in time, the command exits with `No nodes replied within time constraint` and `EX_UNAVAILABLE`. `celery status` is `inspect ping` with a count of online nodes.

Sources: [celery/bin/control.py:16-104](repo://celery/bin/control.py#L16-L104), [celery/bin/control.py:129-209](repo://celery/bin/control.py#L129-L209), [celery/bin/control.py:236-262](repo://celery/bin/control.py#L236-L262)

```bash
celery -A proj inspect active -d celery@worker1
celery -A proj control rate_limit tasks.add 10/m
celery -A proj control revoke 1b7d... 4c2e...
celery -A proj inspect --list
```

Sources: [celery/bin/control.py:26-53](repo://celery/bin/control.py#L26-L53), [celery/worker/control.py:255-263](repo://celery/worker/control.py#L255-L263)

### call

`celery call <name>` sends a task through `app.send_task`, so the calling process does not need the task code. `-a/--args` takes a JSON array, `-k/--kwargs` a JSON object, `--eta` an ISO 8601 time, `--countdown` seconds, `--expires` seconds or an ISO time, and `--serializer`, `--queue`, `--exchange` and `--routing-key` set the routing. It prints the new task id.

Sources: [celery/bin/call.py:8-71](repo://celery/bin/call.py#L8-L71)

### purge and migrate

`celery purge` deletes every message from the app's known task queues, or from those given with `-Q`, minus those in `-X`. It asks for confirmation unless `-f` is passed, and reports how many messages were removed; there is no undo. `celery migrate` moves messages between brokers, optionally limited to some queues (`-Q`) or task names (`-T`), a number of messages (`-n`), or running until killed (`-F`).

Sources: [celery/bin/purge.py:8-70](repo://celery/bin/purge.py#L8-L70), [celery/bin/migrate.py:9-60](repo://celery/bin/migrate.py#L9-L60)

### shell

`celery shell` imports the default task modules and starts IPython, bpython or the plain Python shell, with `app`, `celery`, `Task`, `chord`, `group`, `chain`, `chunks`, `xmap`, `xstarmap`, `signature` and every non-built-in task in the namespace. `-T` leaves the tasks out, and `--eventlet`/`--gevent` import the pool module first so its patches apply.

Sources: [celery/bin/shell.py:82-173](repo://celery/bin/shell.py#L82-L173)
