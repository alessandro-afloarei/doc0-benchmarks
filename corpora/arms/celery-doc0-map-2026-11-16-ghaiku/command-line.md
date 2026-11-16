---
title: "Command-Line Interface"
---
## Overview

The `celery` command is one click group whose subcommands start processes or talk to running ones: `worker`, `beat`, `events`, `multi`, `inspect`, `control`, `result`, `purge` and the rest. The group loads the application once, from `-A`, and each subcommand then works through that app. Detaching a process to the background and changing its user are handled by the platform helpers that the `worker` and `beat` commands call. The processes that the commands start are described in [[Worker Startup]] and [[Periodic Tasks with Beat]], and the remote commands in [[Remote Control and Events]].

Sources: [celery/bin/celery.py:113-120](repo://celery/bin/celery.py#L113-L120)

Sources: [celery/bin/celery.py:175-191](repo://celery/bin/celery.py#L175-L191)

## Entry point and the app option

`main` is the console entry point. It calls the `celery` group with the `CELERY` prefix for environment variables, so options can be set from variables named `CELERY_` followed by the option name.

Sources: [celery/bin/celery.py:220-227](repo://celery/bin/celery.py#L220-L227)

The `-A`/`--app` option names the application, and the environment variable `APP` supplies it when the flag is absent. The group imports the name with `find_app` when it is a string; an import error stops the command with a message naming the app.

Sources: [celery/bin/celery.py:57-62](repo://celery/bin/celery.py#L57-L62)

Sources: [celery/bin/celery.py:130-146](repo://celery/bin/celery.py#L130-L146)

When `-A` is given in the wrong place, the option prints a usage message that shows it before the subcommand name.

Sources: [celery/bin/celery.py:200-214](repo://celery/bin/celery.py#L200-L214)

The group stores a `CLIContext` with the app, the colour, the working directory and the quiet flag. It also adds the app's `user_options` to the `worker`, `beat` and `events` commands, and the `preload` options to every command, so a project can declare its own flags.

Sources: [celery/bin/celery.py:150-162](repo://celery/bin/celery.py#L150-L162)

Sources: [celery/bin/base.py:143-160](repo://celery/bin/base.py#L143-L160)

## Subcommands

Each subcommand is added to the group with `add_command`. `worker`, `beat`, `events`, `multi`, `control`, `inspect` and `status` start a process or talk to one; `purge`, `result`, `migrate`, `upgrade`, `graph`, `logtool`, `amqp` and `shell` are operator tools.

Sources: [celery/bin/celery.py:175-191](repo://celery/bin/celery.py#L175-L191)

## Detaching

`worker` and `beat` accept a detach flag. The worker's `detach` function passes the arguments to `detached`, which forks, makes a new session, and redirects the standard streams, then runs the program with `os.execv` in the detached child.

Sources: [celery/bin/worker.py:108-124](repo://celery/bin/worker.py#L108-L124)

`beat` uses the same flags: its `detach`, log file, pidfile, uid, gid, umask and working directory are the same options the worker takes.

Sources: [celery/bin/beat.py:47-52](repo://celery/bin/beat.py#L47-L52)

`detached` is the context manager behind it. It changes the working directory and the umask, and it duplicates the log file onto the standard output and error. A double fork with `setsid` detaches the process from its terminal.

Sources: [celery/platforms.py:316-345](repo://celery/platforms.py#L316-L345)

Sources: [celery/platforms.py:360-373](repo://celery/platforms.py#L360-L373)

Sources: [celery/platforms.py:376-400](repo://celery/platforms.py#L376-L400)

## Dropping privileges

`maybe_drop_privileges` changes the user and group of the process when a UID or GID is given. It returns at once on Windows, and the worker calls it before it builds the `Worker`.

Sources: [celery/platforms.py:528-546](repo://celery/platforms.py#L528-L546)

Sources: [celery/bin/worker.py:355-356](repo://celery/bin/worker.py#L355-L356)

## Multi

`celery multi` is also available as a standalone tool, `MultiTool`, with its own entry point. It describes each worker as a `Node`, collects the nodes in a `Cluster`, and its `start` method starts the cluster.

Sources: [celery/bin/multi.py:139-141](repo://celery/bin/multi.py#L139-L141)

Sources: [celery/bin/multi.py:291-293](repo://celery/bin/multi.py#L291-L293)

Sources: [celery/apps/multi.py:122-130](repo://celery/apps/multi.py#L122-L130)

Sources: [celery/apps/multi.py:367-372](repo://celery/apps/multi.py#L367-L372)
