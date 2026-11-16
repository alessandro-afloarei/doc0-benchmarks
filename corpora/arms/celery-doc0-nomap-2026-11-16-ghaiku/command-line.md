---
title: "Command Line Entry Point"
---
## Overview

The `celery` command is a click group. Its own options choose the app, the broker, the result backend, the loader and the configuration module, and each subcommand such as `worker`, `beat`, `inspect` or `result` runs with those choices already in place. The group lives in `celery/bin/celery.py`, the shared option and command classes are in `celery/bin/base.py`, and the subcommands are separate modules in `celery/bin/`. This page covers the path from the executable to a subcommand's callback. The worker and multi-node subcommands are explained in [[Worker Startup and Bootsteps]] and [[Multi Workers]].

Sources: [celery/bin/celery.py:113-120](repo://celery/bin/celery.py#L113-L120), [celery/bin/base.py:163-200](repo://celery/bin/base.py#L163-L200)

## Global options

The group takes `-A`/`--app`, `-b`/`--broker`, `--result-backend`, `--loader`, `--config`, `--workdir`, `-C`/`--no-color`, `-q`/`--quiet`, `--version` and `--skip-checks`. Each option is declared with `click.option`, so the help text and the parsing come from click.

Sources: [celery/bin/celery.py:57-106](repo://celery/bin/celery.py#L57-L106)

The four connection options are passed to the process as environment variables before the app is created. `--loader`, `--broker`, `--result-backend` and `--config` write `CELERY_LOADER`, `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND` and `CELERY_CONFIG_MODULE`, so the default app reads them when it first loads its configuration. `--skip-checks` sets `CELERY_SKIP_CHECKS`.

Sources: [celery/bin/celery.py:122-134](repo://celery/bin/celery.py#L122-L134), [celery/app/base.py:436-441](repo://celery/app/base.py#L436-L441)

## Finding the app

When `--app` is given, the group imports it with `find_app`. The function looks up the symbol by its dotted name. If the symbol is a module, it tries the attribute `app`, then `celery`, and then `<name>.celery`, and it refuses the bare `celery` module, which is the package and not an instance.

Sources: [celery/app/utils.py:378-415](repo://celery/app/utils.py#L378-L415), [celery/bin/celery.py:136-152](repo://celery/bin/celery.py#L136-L152)

A failure to import the module, a missing attribute, or any other error stops the command with a message that names the app. The group reports each case with its own text, so a missing module reads differently from an error inside the module.

Sources: [celery/bin/celery.py:136-152](repo://celery/bin/celery.py#L136-L152)

## Shared context

After the app is found, the group stores a `CLIContext` on the click context. It holds the app, the colour and quiet flags, and the working directory, and it provides the message helpers that every subcommand uses to print output. The app's `user_options` are added to the worker, beat, events and preload command parameters, so an application can add its own options to those commands.

Sources: [celery/bin/celery.py:154-164](repo://celery/bin/celery.py#L154-L164), [celery/bin/base.py:37-47](repo://celery/bin/base.py#L37-L47)

## Subcommands

Each subcommand is added to the group with `add_command`. The list includes `purge`, `call`, `beat`, `list`, `result`, `migrate`, `status`, `worker`, `events`, `inspect`, `control`, `graph`, `upgrade`, `logtool`, `amqp`, `shell` and `multi`.

Sources: [celery/bin/celery.py:166-191](repo://celery/bin/celery.py#L166-L191)

The subcommands are `CeleryCommand` instances. Their help output groups options by `help_group`, so the options of the worker and the embedded beat appear under their own headings.

Sources: [celery/bin/base.py:178-196](repo://celery/bin/base.py#L178-L196)

`CeleryCommand` and `CeleryOption` take their defaults from the context. A `default_value_from_context` on an option reads the value from `ctx.obj` when the option is not given, so a value set by the group flows to the subcommand.

Sources: [celery/bin/base.py:163-170](repo://celery/bin/base.py#L163-L170), [celery/bin/base.py:171-180](repo://celery/bin/base.py#L171-L180)

## The bugreport command

`report` is the one subcommand defined in the group module itself. It imports the default modules through the loader and prints the app's bug report, so the output includes the app's configuration and the versions in use.

Sources: [celery/bin/celery.py:166-172](repo://celery/bin/celery.py#L166-L172), [celery/app/utils.py:346-377](repo://celery/app/utils.py#L346-L377)

`main` calls the group with the environment prefix `CELERY`, which makes click read a `CELERY_` variable for each option that is not given on the command line.

Sources: [celery/bin/celery.py:220-227](repo://celery/bin/celery.py#L220-L227)
