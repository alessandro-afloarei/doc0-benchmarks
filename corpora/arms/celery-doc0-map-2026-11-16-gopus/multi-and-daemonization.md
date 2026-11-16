---
title: "Multi and Daemonization"
---
## Overview

In production a worker usually runs in the background, often several per machine. Celery supports this at two levels. `celery.platforms` provides the Unix primitives: detaching from the terminal, pidfile locks, dropping root privileges, and a signal-handler registry. `celery multi` builds on them to start, stop and restart a set of named worker nodes with one command, and the service files in `extra/` call `celery multi` from systemd or init.

Sources: [celery/platforms.py:140-259](repo://celery/platforms.py#L140-L259), [celery/bin/multi.py:1-110](repo://celery/bin/multi.py#L1-L110), [extra/systemd/celery.service:1-22](repo://extra/systemd/celery.service#L1-L22)

The worker's own shutdown modes and the signals it handles are described in [[Worker Startup and Bootsteps]]; the command-line options in [[Command Line Interface]].

Sources: [celery/apps/worker.py:254-274](repo://celery/apps/worker.py#L254-L274)

## Detaching

`celery worker --detach` (and `beat --detach`, `events --detach` with a camera) call `platforms.detached(logfile, pidfile, uid, gid, umask, workdir)` and re-execute the program inside it ([[Worker Startup and Bootsteps]]). `detached` raises `RuntimeError` on platforms without the `resource` module, resets `SIGCLD` to the default handler, drops privileges, and returns a `DaemonContext`.

Sources: [celery/bin/worker.py:108-133](repo://celery/bin/worker.py#L108-L133), [celery/platforms.py:376-433](repo://celery/platforms.py#L376-L433)

`DaemonContext.open()` performs the classic double fork: fork, `setsid()` in the child to start a new session, fork again and let the intermediate process exit, so the daemon cannot reacquire a controlling terminal. It then changes to the working directory, applies the umask (a string starting with `0` is read as octal), runs the `after_chdir` callback, closes every open file descriptor except the standard streams and `/dev/urandom` (kept because "shelve needs it, and Beat needs shelve"), redirects the standard streams to `/dev/null`, and runs multiprocessing's after-fork handlers. With `fake=True` (or the `C_FAKEFORK` environment variable for the worker) it skips the fork, for debugging.

Sources: [celery/platforms.py:313-374](repo://celery/platforms.py#L313-L374), [celery/bin/worker.py:105-114](repo://celery/bin/worker.py#L105-L114)

Because stderr is gone after detaching, the `after_chdir` callback first opens the log file for appending, so a log file that cannot be written fails while errors are still visible, and checks that the pidfile is not held by a running process. The worker formats the log file name with the node name before detaching for the same reason.

Sources: [celery/platforms.py:424-433](repo://celery/platforms.py#L424-L433), [celery/bin/worker.py:114-118](repo://celery/bin/worker.py#L114-L118)

## Pidfiles

`Pidfile(path)` implements a pidfile lock. `acquire()` writes `"<pid>\n"` with exclusive-create flags, flushes and `fsync`s, and reads the file back, raising `LockFailed` if the contents differ. `read_pid()` refuses a file without a trailing newline as partial. `remove_if_stale()` removes the file and returns true when it is broken, empty, contains the current process's pid (the comment mentions Kubernetes pods where the pid is 1), or names a process that does not answer signal 0.

Sources: [celery/platforms.py:140-241](repo://celery/platforms.py#L140-L241)

`create_pidlock(pidfile)` is what the worker and beat use when given `--pidfile`: if the file exists and is not stale, it prints that the pidfile is locked and exits with `EX_CANTCREAT`; otherwise it acquires the lock and registers an `atexit` handler to release it. The worker releases its lock in `on_stopped` ([[Worker Startup and Bootsteps]]).

Sources: [celery/platforms.py:244-273](repo://celery/platforms.py#L244-L273), [celery/worker/worker.py:150-165](repo://celery/worker/worker.py#L150-L165), [celery/apps/beat.py:93-96](repo://celery/apps/beat.py#L93-L96)

## Dropping privileges

`maybe_drop_privileges(uid=None, gid=None)` accepts names or numbers (resolved with `pwd` and `grp`). With a uid it calls `_setuid`, which takes the user's primary group when no gid is given, then calls `setgid`, `initgroups` and `setuid` in that order. The comment explains that the group must change first because `setuid` would otherwise remove the right to change it. It then checks that `setuid(0)` fails, raising `SecurityError` if a non-root user could restore root. After dropping, it raises `SecurityError` if the process is still root. With only a gid, only the group changes. Nothing happens on Windows.

Sources: [celery/platforms.py:528-591](repo://celery/platforms.py#L528-L591)

At startup the command-line worker also calls `check_privileges(accept_content)`. Running as root, or with the `sudo` or `wheel` group, raises `SecurityError` when `pickle` content is accepted, unless `C_FORCE_ROOT` is set; otherwise it only warns.

Sources: [celery/platforms.py:786-845](repo://celery/platforms.py#L786-L845), [celery/apps/worker.py:94-104](repo://celery/apps/worker.py#L94-L104)

## Signal handlers

`platforms.signals` is a `Signals` object that accepts names with or without the `SIG` prefix and ignores signals the platform does not support: `signals['TERM'] = handler`, `signals.update(INT=..., TERM=...)`, `signals.ignore(...)`, `signals.reset(...)`, `signals.signum('INT')`. The worker, beat and pool children all install their handlers through it ([[Concurrency Pools]]).

Sources: [celery/platforms.py:594-700](repo://celery/platforms.py#L594-L700)

## celery multi

### Commands

`celery multi COMMAND NODES [worker options]` runs `MultiTool`. The click wrapper moves the arguments after `multi` to the front, so global options such as `-A` before `multi` are still passed to each worker.

Sources: [celery/bin/multi.py:463-480](repo://celery/bin/multi.py#L463-L480)

| Command | Effect |
| --- | --- |
| `start NODES` | Start each node detached; exit status non-zero if any failed |
| `stop NODES [-SIG]` | Send the signal (default `TERM`) to each node's pid and return |
| `stopwait NODES [-SIG]` | Send the signal and wait until each node's process is gone |
| `restart NODES [-SIG]` | Stop each node, waiting, and start it again once it is down |
| `kill NODES` | Send `SIGKILL` |
| `show NODES` | Print the command line each node would run |
| `get NAME NODES` | Print one node's command line |
| `names NODES` | Print the expanded node names |
| `expand TEMPLATE NODES` | Expand a `%n`-style template for each node |

Sources: [celery/bin/multi.py:118-136](repo://celery/bin/multi.py#L118-L136), [celery/bin/multi.py:289-342](repo://celery/bin/multi.py#L289-L342), [celery/apps/multi.py:406-484](repo://celery/apps/multi.py#L406-L484)

The module docstring notes that pidfile and logfile options "aren't persisted anywhere", so `restart` and `stop` need the same `--pidfile` as `start`: stopping works by reading each node's pid from its pidfile.

Sources: [celery/bin/multi.py:10-23](repo://celery/bin/multi.py#L10-L23), [celery/apps/multi.py:254-262](repo://celery/apps/multi.py#L254-L262)

### Node names and per-node options

`MultiParser` turns the arguments into `Node` objects. A single number `N` means nodes `celery1` to `celeryN` (`--range-prefix` changes the prefix); otherwise each argument is a node name. Names without `@` get `@<hostname>` (or `--hostname`/`-n`), and `%h`-style placeholders are expanded. An option suffixed with `:selector` applies only to some nodes: `-c:1 10` changes the first node, `-c:image 10` the node named `image`, `-c:1-3 10` or `-c:1,2,3 10` several. Indexes start at 1 and an out-of-range index raises `KeyError`. Anything after `--` is passed through unchanged.

Sources: [celery/apps/multi.py:28-119](repo://celery/apps/multi.py#L28-L119), [celery/apps/multi.py:285-364](repo://celery/apps/multi.py#L285-L364)

```bash
celery multi start 3 -c 3 -c:1 10
# celery worker -n celery1@myhost -c 10
# celery worker -n celery2@myhost -c 3
# celery worker -n celery3@myhost -c 3

celery multi start 10 -l INFO -Q:1-3 images,video -Q:4,5 data \
    -Q default -L:4,5 DEBUG
```

Sources: [celery/bin/multi.py:57-80](repo://celery/bin/multi.py#L57-L80)

Each `Node` runs `python -m celery worker --detach` with `-n <name>` and defaults `--pidfile=/var/run/celery/%n.pid`, `--logfile=/var/log/celery/%n%I.log` and `--executable` set to the current interpreter, creating the pidfile and log directories if they do not exist. When building the command line, global options (`-A`, `-b`, `--result-backend`, `--loader`, `--config`, `--workdir`, `-C`, `-q`) are moved before the `worker` subcommand. In file names, `%n` is the node name, `%h` the full host name, `%d` the domain, and `%I` the pool process index prefixed with `-` (empty in the main process), so each child process can log to its own file.

Sources: [celery/apps/multi.py:122-190](repo://celery/apps/multi.py#L122-L190), [celery/utils/nodenames.py:83-114](repo://celery/utils/nodenames.py#L83-L114)

### Starting and stopping

`Cluster.start()` starts each node with `Popen` and waits for it; since the worker is started with `--detach`, the call returns once the daemon has forked. A negative return code is reported as a signal, a positive one as a failure.

Sources: [celery/apps/multi.py:208-229](repo://celery/apps/multi.py#L208-L229), [celery/apps/multi.py:406-421](repo://celery/apps/multi.py#L406-L421)

Stopping reads each pid; nodes without one are reported as down. `shutdown_nodes` sends the signal to the rest, treating a process that no longer exists as already stopped. With a retry interval (`stopwait` and `restart` use 2 seconds) it keeps checking each process with signal 0, reporting progress, until all are gone; `restart` starts each node again as soon as it is down.

Sources: [celery/apps/multi.py:192-206](repo://celery/apps/multi.py#L192-L206), [celery/apps/multi.py:423-496](repo://celery/apps/multi.py#L423-L496)

## Service files

`extra/systemd/celery.service` runs the workers as a `Type=forking` unit under the `celery` user and group. It reads `/etc/conf.d/celery` for variables, starts with `celery -A $CELERY_APP multi start $CELERYD_NODES --pidfile=... --logfile=... --loglevel=... $CELERYD_OPTS`, stops with `multi stopwait`, reloads with `multi restart`, and restarts always. The sample `extra/systemd/celery.conf` sets `CELERY_APP="proj"`, `CELERYD_NODES="worker"`, the pidfile `/var/run/celery/%n.pid` and the log file `/var/log/celery/%n%I.log`.

Sources: [extra/systemd/celery.service:1-22](repo://extra/systemd/celery.service#L1-L22), [extra/systemd/celery.conf:1-16](repo://extra/systemd/celery.conf#L1-L16)

The same directory has a `celerybeat.service` unit and a `celery.tmpfiles` entry; `extra/generic-init.d/` holds `celeryd` and `celerybeat` init scripts, `extra/supervisord/` supervisor programs, and `extra/macOS/` launchd property lists.

Sources: [extra/systemd/celerybeat.service:1-10](repo://extra/systemd/celerybeat.service#L1-L10), [extra/systemd/celery.tmpfiles:1-2](repo://extra/systemd/celery.tmpfiles#L1-L2), [extra/supervisord/celeryd.conf:1-10](repo://extra/supervisord/celeryd.conf#L1-L10)
