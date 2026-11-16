---
title: "celery multi and Daemonization"
---
## Overview

Production workers usually run in the background, often several per machine with different queues or concurrency. Celery has two layers for this. `celery.platforms` provides the POSIX building blocks: detaching from the terminal, pidfile locks, dropping privileges, signal handling and process titles. `celery worker --detach` and `celery beat --detach` use them directly. `celery multi` (`celery.bin.multi` and `celery.apps.multi`) builds on top: it expands a short description of several nodes into one `celery worker --detach` command line per node, starts them, and stops, restarts or kills them using their pidfiles. This page covers both; [[Worker Startup and Bootsteps]] explains how a worker shuts down once it receives the signals described here.

Sources: [celery/platforms.py:376-430](repo://celery/platforms.py#L376-L430), [celery/apps/multi.py:122-142](repo://celery/apps/multi.py#L122-L142), [celery/bin/multi.py:226-260](repo://celery/bin/multi.py#L226-L260)

## Detaching a process

`detached(logfile, pidfile, uid, gid, umask, workdir)` returns a `DaemonContext`. Before detaching it resets `SIGCLD` and drops privileges to `uid`/`gid`. On entry the context goes through the steps below.

Sources: [celery/platforms.py:414-417](repo://celery/platforms.py#L414-L417)

1. Forks, starts a new session with `setsid`, and forks again, so the daemon has no controlling terminal and cannot get one (the classic double fork).
2. Changes to `workdir` (the current directory unless given) and applies the umask, which may be given as an octal string.
3. Touches the log file, so a log file that cannot be written fails now rather than silently after stderr is gone, and checks that the pidfile is not held by a running process.
4. Closes all open file descriptors except the standard streams and `/dev/urandom`, which `shelve` (used by beat) needs, and redirects stdin, stdout and stderr to `/dev/null`.

Sources: [celery/platforms.py:310-374](repo://celery/platforms.py#L310-L374), [celery/platforms.py:376-430](repo://celery/platforms.py#L376-L430)

`celery worker --detach` does not keep running in the detached process. Its `detach()` helper enters the context and then `execv`s `python -m celery ...` with the original arguments minus `--detach`, `-D`, `--uid` and `--gid`, so the daemon starts as a fresh interpreter. If the `exec` fails, the error is logged to the log file. `celery beat --detach` instead runs the beat service inside the context. Setting `C_FAKEFORK` skips the actual detaching, which helps debug a daemon that dies at startup.

Sources: [celery/bin/worker.py:108-133](repo://celery/bin/worker.py#L108-L133), [celery/bin/worker.py:336-357](repo://celery/bin/worker.py#L336-L357), [celery/bin/beat.py:62-72](repo://celery/bin/beat.py#L62-L72)

Every daemon command (`worker`, `beat`, `events` with `--detach`) gets `--logfile/-f`, `--pidfile`, `--uid`, `--gid`, `--umask` and `--executable` from `CeleryDaemonCommand`. Each falls back to a setting named after the command, such as `worker_pidfile`, so they can live in configuration.

Sources: [celery/bin/base.py:197-228](repo://celery/bin/base.py#L197-L228)

## Pidfiles

`Pidfile(path)` writes the pid with `O_CREAT | O_EXCL`, so two processes cannot both create it. It syncs the file to disk and reads it back, raising `LockFailed` if the content differs. `read_pid()` requires a trailing newline and a valid integer, raising `ValueError` otherwise.

Sources: [celery/platforms.py:125-241](repo://celery/platforms.py#L125-L241)

`create_pidlock(path)` is what the worker and beat call at startup. If the file exists, `remove_if_stale()` deletes it when it is unreadable, empty, contains this process's own pid (common for PID 1 in containers), or names a process that no longer exists or cannot be signalled. Otherwise the program prints `Pidfile (...) already exists. Seems we're already running?` and exits with `EX_CANTCREAT`. The lock is released at exit with `atexit`.

Sources: [celery/platforms.py:183-213](repo://celery/platforms.py#L183-L213), [celery/platforms.py:244-272](repo://celery/platforms.py#L244-L272), [celery/platforms.py:64-65](repo://celery/platforms.py#L64-L65)

## Privileges

`maybe_drop_privileges(uid, gid)` switches to another user and group when running as root; names and numbers are both accepted. With a uid it sets the group (the user's primary group if none is given) and the supplementary groups before the user, then checks that `setuid(0)` now fails. If privileges could be restored, or if the process is still root afterwards, it raises `SecurityError`. With only a gid it changes the group.

Sources: [celery/platforms.py:528-584](repo://celery/platforms.py#L528-L584)

The worker program also calls `check_privileges(accept_content)` at startup. Running as root, or in the `sudo` or `wheel` group, only warns, unless the worker accepts pickle content. In that case a message from the broker could run code as root, so it raises `SecurityError` unless the `C_FORCE_ROOT` environment variable is set.

Sources: [celery/platforms.py:788-845](repo://celery/platforms.py#L788-L845), [celery/platforms.py:67-89](repo://celery/platforms.py#L67-L89), [celery/apps/worker.py:94-104](repo://celery/apps/worker.py#L94-L104)

## Signals and process titles

`platforms.signals` is a small wrapper over the `signal` module. It accepts names with or without the `SIG` prefix and ignores signals the platform does not have. `signals['TERM'] = handler`, `signals.update(INT=..., TERM=...)`, `signals.reset(...)` and `signals.ignore(...)` install handlers, and `signum(name)` converts a name to a number. The worker uses it for its shutdown handlers, and prefork children use it to reset and ignore signals.

Sources: [celery/platforms.py:594-700](repo://celery/platforms.py#L594-L700)

`set_process_title` and `set_mp_process_title` set titles such as `celeryd: celery@host:MainProcess -active-` when `setproctitle` is installed, so `ps` shows which node and process is which. `set_pdeathsig('SIGKILL')` makes Linux kill a pool child when its parent dies.

Sources: [celery/platforms.py:713-750](repo://celery/platforms.py#L713-L750)

## Node names

A worker's node name is `name@host`. `-n` accepts a full name or a short one; `default_nodename` fills in `celery` and the machine's hostname. Node names and file paths may contain format codes expanded by `host_format` and `node_format`.

Sources: [celery/utils/nodenames.py:56-114](repo://celery/utils/nodenames.py#L56-L114)

| Code | Expands to |
| --- | --- |
| `%h` | Full host name (or node name in `multi`) |
| `%n` | Name part (node short name) |
| `%d` | Domain part of the host |
| `%i` | Pool process index, or `0` in the main process |
| `%I` | Pool process index with a `-` prefix, or empty in the main process |
| `%p` | Full node name (in `node_format`) |

Sources: [celery/utils/nodenames.py:83-114](repo://celery/utils/nodenames.py#L83-L114), [celery/apps/multi.py:42-51](repo://celery/apps/multi.py#L42-L51)

Using `%n` in `--pidfile` and `--logfile` gives every node its own files, and `%I` in a log file gives every pool process its own log. Non-worker processes use `anon_nodename()`, `gen<pid>@host`, for example as the `origin` of sent tasks.

Sources: [celery/bin/worker.py:358-365](repo://celery/bin/worker.py#L358-L365), [celery/utils/nodenames.py:61-66](repo://celery/utils/nodenames.py#L61-L66)

## celery multi

### Commands

`celery multi <command> <nodes> [worker options]` is a separate argument parser, not a click command, because worker options are passed through unchanged. The click wrapper moves global options such as `-A` after `multi` so the tool sees them. `--nosplash`, `--quiet`, `--verbose` and `--no-color` are reserved for `multi` itself.

Sources: [celery/bin/multi.py:117-135](repo://celery/bin/multi.py#L117-L135), [celery/bin/multi.py:226-290](repo://celery/bin/multi.py#L226-L290), [celery/bin/multi.py:460-480](repo://celery/bin/multi.py#L460-L480)

| Command | Effect |
| --- | --- |
| `start` | Start each node with `celery worker --detach`; exit non-zero if any failed |
| `stop` | Send a signal (default `TERM`, or `-SIG` such as `-KILL` or `-9`) to each node's pid and return |
| `stopwait` | Send the signal and wait until every node's process has exited |
| `restart` | Stop each node, waiting, and start it again as soon as it is down |
| `kill` | Send `SIGKILL` to every node |
| `show` | Print the full command line of each node |
| `names` | Print the expanded node names |
| `get <node>` | Print one node's arguments |
| `expand <template>` | Expand a template like `%n.pid` for every node |

Sources: [celery/bin/multi.py:240-357](repo://celery/bin/multi.py#L240-L357)

Nothing is persisted between invocations: `stop`, `restart` and `kill` find the processes only through the pidfiles. They must therefore be called with the same node names and `--pidfile` option as `start`.

Sources: [celery/bin/multi.py:1-30](repo://celery/bin/multi.py#L1-L30), [celery/apps/multi.py:246-266](repo://celery/apps/multi.py#L246-L266)

### Describing nodes

The node list is either names (`image video data`, or full `name@host` names) or a single number `N`, which creates `celery1` … `celeryN` (the prefix is set with `--range-prefix`). Short names get the host from `--hostname` (default: this machine) as suffix.

Sources: [celery/apps/multi.py:285-332](repo://celery/apps/multi.py#L285-L332), [celery/apps/multi.py:28-39](repo://celery/apps/multi.py#L28-L39)

Options apply to every node unless namespaced with `:`. `-c:1 10` targets the first node, `-c:image 10` a named node, `-Q:1-3 images,video` a range and `-c:foo,bar 10` a list. `NamespacedOptionParser` collects namespaced options separately, and `MultiParser` maps indexes and ranges to node names and merges them over the global options. Everything after `--` is passed to every worker unchanged.

Sources: [celery/apps/multi.py:70-119](repo://celery/apps/multi.py#L70-L119), [celery/apps/multi.py:334-364](repo://celery/apps/multi.py#L334-L364)

```bash
# 10 workers: 1-3 consume images,video; 4-5 consume data at DEBUG; the rest default
celery multi start 10 -A proj -l INFO -Q:1-3 images,video -Q:4,5 data \
    -Q default -L:4,5 DEBUG \
    --pidfile=/var/run/celery/%n.pid --logfile=/var/log/celery/%n%I.log
```

Sources: [celery/bin/multi.py:54-63](repo://celery/bin/multi.py#L54-L63)

### Building and running nodes

Each `Node` is given `-n <nodename>` and defaults of `--pidfile=/var/run/celery/%n.pid`, `--logfile=/var/log/celery/%n%I.log` and `--executable=<current python>`, creating the directories if needed. Its command is `python -m celery worker --detach`. Global options (`-A`, `-b`, `--result-backend`, `--loader`, `--config`, `--workdir`, `-C`, `-q`) are moved before `worker`, and every value is expanded with the node's format codes.

Sources: [celery/apps/multi.py:122-190](repo://celery/apps/multi.py#L122-L190)

`Node.start()` runs the command with `Popen` and waits for it. Because the worker detaches, this returns as soon as the daemon has forked, and a non-zero or signal exit is reported as a failure. `Node.pid` reads the pidfile, `send(sig)` signals it (a missing process counts as down), and `alive()` sends signal 0.

Sources: [celery/apps/multi.py:192-266](repo://celery/apps/multi.py#L192-L266)

`Cluster` runs those operations over all nodes and reports progress through callbacks, which `MultiTool` turns into terminal output. Stopping signals every node that has a pid, treating nodes without one as already down. With `retry`, `stopwait` and `restart` poll the remaining nodes with `alive()`, sleeping `retry` seconds between rounds, until all are gone. `restart` starts each node again as soon as it is seen to be down, so nodes come back one at a time.

Sources: [celery/apps/multi.py:367-447](repo://celery/apps/multi.py#L367-L447), [celery/apps/multi.py:449-506](repo://celery/apps/multi.py#L449-L506), [celery/bin/multi.py:373-393](repo://celery/bin/multi.py#L373-L393)
