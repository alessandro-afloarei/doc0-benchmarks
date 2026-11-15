---
title: "Running Multiple Workers and Daemonization"
---
## Overview

`celery multi` manages a group of worker nodes on one host from a single command line: it expands names, ranges and per-node options into one `celery worker --detach` command per node, starts them, and later finds them again through their pidfiles to stop, restart or kill them. It has no daemon of its own and keeps no state besides the pidfiles. Underneath, `celery/platforms.py` provides the process-level pieces every Celery program uses to run as a service: detaching from the terminal, pidfile locks, dropping privileges and signal handling. This page covers both. What a worker does once started is on [[Worker Startup and Bootsteps]].

Sources: [celery/bin/multi.py:1-100](repo://celery/bin/multi.py#L1-L100), [celery/apps/multi.py:122-140](repo://celery/apps/multi.py#L122-L140)

## Commands

| Command | Effect |
| --- | --- |
| `start <nodes> [worker options]` | Start each node with `celery worker --detach` and report its exit status |
| `stop <nodes> [-SIG]` | Send the signal (default `TERM`) to every node with a pidfile and return |
| `stopwait <nodes> [-SIG]` | Like `stop`, then poll until every node has exited |
| `restart <nodes> [-SIG] [worker options]` | Stop each node and start it again as soon as it is down |
| `kill <nodes>` | Send `SIGKILL` |
| `show <nodes> [worker options]` | Print the command line for each node |
| `get <nodename> <nodes> [worker options]` | Print one node's arguments |
| `names <nodes>` | Print the expanded node names |
| `expand <template> <nodes>` | Expand a `%n`-style template for each node |

Sources: [celery/bin/multi.py:101-137](repo://celery/bin/multi.py#L101-L137), [celery/bin/multi.py:291-342](repo://celery/bin/multi.py#L291-L342)

Options such as `--app` are global to `celery` but per-worker for `multi`, so the click command moves the arguments before `multi` to after it and hands everything to `MultiTool`, which does its own parsing. `--nosplash`, `--quiet`, `--verbose` and `--no-color` are reserved options of `multi` itself.

Sources: [celery/bin/multi.py:463-480](repo://celery/bin/multi.py#L463-L480), [celery/bin/multi.py:262-289](repo://celery/bin/multi.py#L262-L289)

```bash
celery multi start 3 -A proj -c 3 -c:1 10 --pidfile=/var/run/celery/%n.pid --logfile=/var/log/celery/%n%I.log
celery multi restart 3 -A proj -c 3 -c:1 10 --pidfile=/var/run/celery/%n.pid --logfile=/var/log/celery/%n%I.log
celery multi stopwait 3 --pidfile=/var/run/celery/%n.pid
```

Sources: [celery/bin/multi.py:9-23](repo://celery/bin/multi.py#L9-L23), [celery/bin/multi.py:68-74](repo://celery/bin/multi.py#L68-L74)

> [!NOTE]
> `multi` keeps nothing between calls: `restart` and `stop` must be given the same `--pidfile` pattern (and, for `restart`, the same worker options) as `start`, because each node's pid is read from its pidfile.

Sources: [celery/bin/multi.py:16-21](repo://celery/bin/multi.py#L16-L21), [celery/apps/multi.py:254-262](repo://celery/apps/multi.py#L254-L262)

## From arguments to nodes

### Parsing

`NamespacedOptionParser` splits the arguments into positional values (the node names), global options and per-node options. An option written `-c:1 10` or `--loglevel:image=DEBUG` goes into the namespace after the colon instead of the global options. Everything after `--` is passed through unchanged.

Sources: [celery/apps/multi.py:70-120](repo://celery/apps/multi.py#L70-L120)

`MultiParser.parse` then builds the nodes:

Sources: [celery/apps/multi.py:285-321](repo://celery/apps/multi.py#L285-L321)

1. A single number `N` means N nodes named `celery1` … `celeryN` (the prefix changes with `--range-prefix`); otherwise each value is a node name. Names without `@` get `@` and the host name (`--hostname`, or the machine's), and `%h`-style placeholders in a full name are expanded.
2. Numeric namespaces (`-c:1`) are moved to the node at that position, counting from 1; `-c:1-3` and `-c:1,2,3` apply to several nodes.
3. Each node's options are the global options overlaid with its namespace's options.

Sources: [celery/apps/multi.py:28-40](repo://celery/apps/multi.py#L28-L40), [celery/apps/multi.py:323-365](repo://celery/apps/multi.py#L323-L365)

### Node command lines

A `Node` sets `-n` to its name and defaults `--pidfile` to `/var/run/celery/%n.pid`, `--logfile` to `/var/log/celery/%n%I.log` and `--executable` to the current Python, creating the directories when needed. The command is `-m celery worker --detach` with the global `celery` options (`-A`, `-b`, `--result-backend`, `--loader`, `--config`, `--workdir`, `-C`, `-q`) moved before `worker`, so they reach the `celery` group. Every value goes through the node's expander.

Sources: [celery/apps/multi.py:122-190](repo://celery/apps/multi.py#L122-L190)

The expander is `node_format` with the node's names: `%n` is the short name, `%h` the full node name, `%d` the domain, and `%i`/`%I` are left in place for the worker to expand per pool process (`%I` becomes empty in the main process and `-1`, `-2`, … in children). This is why the default log file `%n%I.log` gives one file per process.

Sources: [celery/apps/multi.py:42-51](repo://celery/apps/multi.py#L42-L51), [celery/utils/nodenames.py:82-113](repo://celery/utils/nodenames.py#L82-L113)

## Starting, stopping and restarting

`Cluster.start` runs each node's command with `Popen` and waits for it. Because the worker detaches, the command returns as soon as the background process is forked; a negative return code is reported as killed by a signal and a positive one as a failure. `start` returns non-zero when any node failed.

Sources: [celery/apps/multi.py:406-421](repo://celery/apps/multi.py#L406-L421), [celery/apps/multi.py:208-229](repo://celery/apps/multi.py#L208-L229)

Stopping works through pidfiles. `getpids` keeps the nodes whose pidfile holds a pid and reports the others as already down. `shutdown_nodes` sends the signal to each; a node whose process no longer exists counts as down. With a retry interval (`stopwait` and `restart` use 2 seconds), it then polls with signal 0 until each process is gone, printing progress. `restart` starts each node again from its `on_down` callback, so nodes come back one by one as soon as they have stopped.

Sources: [celery/apps/multi.py:423-496](repo://celery/apps/multi.py#L423-L496), [celery/apps/multi.py:192-206](repo://celery/apps/multi.py#L192-L206)

## Detaching

`celery worker --detach` (and `beat`, `events --detach`) runs the program in the background through `platforms.detached(logfile, pidfile, uid, gid, umask, workdir)`. Before forking it resets `SIGCLD` and drops privileges. The returned `DaemonContext` then forks twice with `setsid` in between, so the process has no controlling terminal and is not a session leader; changes to the working directory and sets the umask; checks that the log file is writable and that the pidfile is not held by a live process; closes all file descriptors except the standard streams and `/dev/urandom` (which `shelve` needs for beat); and redirects stdin, stdout and stderr to `/dev/null`.

Sources: [celery/platforms.py:310-428](repo://celery/platforms.py#L310-L428)

The worker's `--detach` path re-executes `python -m celery …` without `--detach`, `--uid` and `--gid` inside that context, so the background process is a fresh interpreter.

Sources: [celery/bin/worker.py:336-356](repo://celery/bin/worker.py#L336-L356)

## Pidfiles

`create_pidlock(path)` is how programs claim their pidfile. If the file exists, it checks whether it is stale: an unreadable file, an empty pid, our own pid (common for PID 1 in containers) or a pid that no longer answers signal 0 is removed and the program continues; a live pid makes the program print an error and exit with `EX_CANTCREAT`. Otherwise it writes the pid with exclusive-create flags, syncs and re-reads it to detect races, and registers removal at exit. `multi` reads the same files with `Pidfile.read_pid`.

Sources: [celery/platforms.py:121-212](repo://celery/platforms.py#L121-L212), [celery/platforms.py:215-272](repo://celery/platforms.py#L215-L272)

## Privileges and root

`maybe_drop_privileges(uid, gid)` changes the real user and group: with a uid, the group (by default the user's primary group) is set first, supplementary groups are initialized, then the user; with only a gid, just the group changes. It then checks that `setuid(0)` fails, so privileges cannot be regained, and raises `SecurityError` if the process is still root afterwards. It does nothing on Windows.

Sources: [celery/platforms.py:528-584](repo://celery/platforms.py#L528-L584)

`check_privileges(accept_content)`, called when a worker starts, refuses to run as root (or with the `sudo` or `wheel` group) when the accepted content types include `pickle`, since a message could then run code as root; it raises `SecurityError` unless `C_FORCE_ROOT` is set, and otherwise only warns.

Sources: [celery/platforms.py:788-845](repo://celery/platforms.py#L788-L845), [celery/apps/worker.py:94-104](repo://celery/apps/worker.py#L94-L104)

## Signals and process titles

`platforms.signals` is a mapping-like wrapper over the `signal` module: `signals['SIGTERM'] = handler` installs a handler by name (silently skipping signals the platform lacks), `ignore` and `reset` set `SIG_IGN` and `SIG_DFL`, and `signum('TERM')` converts names. The worker's shutdown handlers and beat's sync handler are installed through it. `set_process_title` sets the title shown by `ps` when `setproctitle` is installed, and `set_pdeathsig` asks the OS to kill pool children when their parent dies, where supported.

Sources: [celery/platforms.py:594-700](repo://celery/platforms.py#L594-L700), [celery/platforms.py:713-750](repo://celery/platforms.py#L713-L750)
