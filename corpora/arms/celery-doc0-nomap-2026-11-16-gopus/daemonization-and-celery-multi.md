---
title: "Daemonization and celery multi"
---
## Overview

In production a worker runs in the background under a service manager. Celery supports this at three levels. `celery/platforms.py` holds the Unix plumbing: pidfile locks, detaching from the terminal, dropping root privileges, signal helpers and the root-user check. `celery worker --detach` and `celery beat --detach` use it to daemonize a single process. `celery multi` starts, stops and restarts several named workers with per-node options, and is what the shipped init scripts and systemd units call. This page covers all three plus the deployment files under `extra/` and `helm-chart/`. How a worker shuts down once signalled is in [[Worker Startup and Bootsteps]].

Sources: [celery/platforms.py:1-62](repo://celery/platforms.py#L1-L62), [celery/bin/worker.py:336-356](repo://celery/bin/worker.py#L336-L356), [celery/bin/multi.py:1-110](repo://celery/bin/multi.py#L1-L110)

## Pidfiles

`Pidfile(path)` writes the current pid followed by a newline with `O_CREAT | O_EXCL`, so creation fails if the file exists, fsyncs it and reads it back, raising `LockFailed` if the content differs. `read_pid` rejects a file without the trailing newline as partial. `remove_if_stale` deletes a broken file, one holding our own pid, or one whose process no longer exists (`os.kill(pid, 0)` failing with `ESRCH` or `EPERM`).

Sources: [celery/platforms.py:125-241](repo://celery/platforms.py#L125-L241)

`create_pidlock(path)` removes a stale pidfile and acquires a new one, registering release at exit. If a live process holds it, it prints "Pidfile (...) already exists. Seems we're already running?" and exits with `EX_CANTCREAT`. The worker takes the lock in `on_start` when given `--pidfile`, and beat does the same.

Sources: [celery/platforms.py:244-272](repo://celery/platforms.py#L244-L272), [celery/platforms.py:64-65](repo://celery/platforms.py#L64-L65), [celery/worker/worker.py:150-152](repo://celery/worker/worker.py#L150-L152), [celery/apps/beat.py:93-95](repo://celery/apps/beat.py#L93-L95)

## Detaching

`detached(logfile, pidfile, uid, gid, umask, workdir, fake=False)` prepares the daemon and returns a `DaemonContext`. Before forking it resets `SIGCLD`, drops privileges, and arranges for the child to check, after changing directory, that the log file can be opened and that the pidfile is not locked by a running process (the child creates the real pidfile itself). It raises `RuntimeError` on platforms without the `resource` module.

Sources: [celery/platforms.py:376-429](repo://celery/platforms.py#L376-L429)

Entering `DaemonContext` forks twice with a `setsid()` in between, so the process is detached from the terminal and cannot reacquire one, then changes to the working directory (default `/`, though `detached` passes the current directory), applies the umask (a string with a leading `0` is octal), runs the after-chdir checks, closes every file descriptor except stdin/stdout/stderr and `/dev/urandom`, points the standard streams at `/dev/null`, and runs multiprocessing's after-fork hooks. `fake=True` skips the fork and the descriptor handling for debugging.

Sources: [celery/platforms.py:310-373](repo://celery/platforms.py#L310-L373), [celery/platforms.py:275-307](repo://celery/platforms.py#L275-L307)

`celery worker --detach` re-executes `python -m celery ...` inside this context with `--detach`, `--uid` and `--gid` removed from the arguments, so the daemon runs the normal worker code path ([[Command-Line Interface]]).

Sources: [celery/bin/worker.py:336-356](repo://celery/bin/worker.py#L336-L356), [celery/bin/worker.py:108-133](repo://celery/bin/worker.py#L108-L133)

## Privileges

`maybe_drop_privileges(uid, gid)` accepts names or numbers. With a uid it sets the group (the user's primary group if none given), initializes supplementary groups and then the uid, in that order because setting the group after the user could fail and leave the process in a privileged group. It then tries `setuid(0)` and raises `SecurityError` if that succeeds, and also raises if the process is still root afterwards. It does nothing on Windows or when not running as root.

Sources: [celery/platforms.py:528-584](repo://celery/platforms.py#L528-L584)

`check_privileges(accept_content)`, called by the worker at start, refuses to run as root (or with the `sudo` or `wheel` group) when pickle is an accepted content type, raising `SecurityError` with "Running a worker with superuser privileges when the worker accepts messages serialized with pickle is a very bad idea!", unless `C_FORCE_ROOT` is set. Without pickle it only warns.

Sources: [celery/platforms.py:788-845](repo://celery/platforms.py#L788-L845), [celery/platforms.py:67-84](repo://celery/platforms.py#L67-L84), [celery/apps/worker.py:94-104](repo://celery/apps/worker.py#L94-L104)

## Signal and process helpers

`platforms.signals` is a `Signals` object that takes signal names with or without the `SIG` prefix and silently ignores signals the platform lacks: `signals['INT'] = handler`, `signals.ignore('USR1')`, `signals.reset(...)`, `signals.update(TERM=..., HUP=...)`, `signals.signum('TERM')`. The worker and beat install their handlers through it.

Sources: [celery/platforms.py:594-699](repo://celery/platforms.py#L594-L699)

`set_process_title` and `set_mp_process_title` set the `ps` name (for example `[celeryd: worker1@host:MainProcess]`) when `setproctitle` is installed; `NOSETPS` disables it. `set_pdeathsig('SIGKILL')` asks Linux to kill a pool child when its parent dies. `EX_OK`, `EX_FAILURE`, `EX_UNAVAILABLE`, `EX_USAGE` and `EX_CANTCREAT` are the exit codes used across the commands.

Sources: [celery/platforms.py:713-750](repo://celery/platforms.py#L713-L750), [celery/platforms.py:49-53](repo://celery/platforms.py#L49-L53)

## celery multi

### Naming nodes

`celery multi COMMAND NODES [worker options]` takes either a number (`3` gives `celery1`, `celery2`, `celery3`, with `--range-prefix` to change the prefix) or a list of names, each becoming `name@hostname` unless already fully qualified; `--hostname`, `--prefix` and `--suffix` adjust this. The module docstring has worked examples.

Sources: [celery/bin/multi.py:1-100](repo://celery/bin/multi.py#L1-L100), [celery/apps/multi.py:285-332](repo://celery/apps/multi.py#L285-L332), [celery/apps/multi.py:28-39](repo://celery/apps/multi.py#L28-L39)

Options apply to every node, and an option with a `:selector` suffix applies to some nodes only: `-c:1 10` to the first node, `-c:1-3 10` to a range, `-c:foo,bar 10` to named nodes. `NamespacedOptionParser` collects these and `MultiParser` merges them per node.

Sources: [celery/apps/multi.py:70-120](repo://celery/apps/multi.py#L70-L120), [celery/apps/multi.py:334-365](repo://celery/apps/multi.py#L334-L365)

```console
$ celery multi start 10 -A proj -l INFO -Q:1-3 images,video -Q:4,5 data -Q default -L:4,5 DEBUG
$ celery multi start 3 -c 3 -c:1 10
```

Sources: [celery/bin/multi.py:55-75](repo://celery/bin/multi.py#L55-L75)

### Nodes

Each `Node` runs `python -m celery worker --detach` with `-n <nodename>` and default `--pidfile=/var/run/celery/%n.pid` and `--logfile=/var/log/celery/%n%I.log`, creating those directories when missing. Global options such as `-A`, `-b` and `--config` are moved before `worker` in the command, since they belong to the `celery` group. `%n`, `%N`, `%d`, `%h`, `%i` and `%I` are expanded per node.

Sources: [celery/apps/multi.py:122-190](repo://celery/apps/multi.py#L122-L190), [celery/apps/multi.py:42-52](repo://celery/apps/multi.py#L42-L52)

A node's pid is read from its pidfile; `alive()` sends signal 0 and `send(sig)` delivers a signal, reporting a node whose process is gone. That is why the docstring warns that `restart` and `stop` need the same `--pidfile` arguments as `start`: nothing else is stored.

Sources: [celery/apps/multi.py:192-278](repo://celery/apps/multi.py#L192-L278), [celery/bin/multi.py:12-22](repo://celery/bin/multi.py#L12-L22)

### Commands

| Command | Does |
| --- | --- |
| `start` | Starts each node; exit status is non-zero if any failed |
| `stop` | Sends `SIGTERM` (or `-SIGNAL`) to every node with a pid, without waiting |
| `stopwait` | Sends the signal and waits, polling until each node is gone |
| `restart` | Stops each node and starts it again as soon as it is down |
| `kill` | Sends `SIGKILL` |
| `show`, `get NAME`, `names`, `expand TEMPLATE` | Print commands, one node's argv, node names, or a template expanded per node |

Sources: [celery/bin/multi.py:291-342](repo://celery/bin/multi.py#L291-L342), [celery/apps/multi.py:406-496](repo://celery/apps/multi.py#L406-L496)

`Cluster.shutdown_nodes` signals all nodes, then (with a retry interval) loops calling `alive()` on the remaining ones and sleeping between rounds, reporting each node as it goes down. `MultiTool` prints the progress (`> Stopping nodes...`, `OK`, `DOWN`). `celery multi` is a click command that reorders `sys.argv` so global options given before `multi` reach the tool, and the entry point does not apply eventlet or gevent patching for it.

Sources: [celery/apps/multi.py:443-483](repo://celery/apps/multi.py#L443-L483), [celery/bin/multi.py:226-261](repo://celery/bin/multi.py#L226-L261), [celery/bin/multi.py:462-480](repo://celery/bin/multi.py#L462-L480), [celery/__main__.py:10-15](repo://celery/__main__.py#L10-L15)

## Deployment files

### systemd and init scripts

`extra/systemd/celery.service` is a `Type=forking` unit running as user and group `celery` that reads `/etc/conf.d/celery` and calls `celery multi start`, `stopwait` and `restart` with `$CELERYD_NODES`, the pid and log file patterns and `$CELERYD_OPTS`. The sample `celery.conf` sets `CELERY_APP`, `CELERYD_NODES="worker"`, the binary path and the `%n` file patterns; `celerybeat.service` and `celery.tmpfiles` cover beat and the run directory.

Sources: [extra/systemd/celery.service:1-22](repo://extra/systemd/celery.service#L1-L22), [extra/systemd/celery.conf:1-16](repo://extra/systemd/celery.conf#L1-L16)

`extra/generic-init.d/celeryd` and `celerybeat` are SysV init scripts configured through `/etc/default/<script name>` (or `/usr/local/etc` on BSD). They refuse to run unless invoked as root, telling unprivileged users to use `celery multi` or `celery worker --detach`, and default to the same pid and log file patterns. Copying the script under another name gives a second, separately configured service. `extra/supervisord`, `extra/macOS` (launchd plists) and `extra/WindowsCMD-AzureWebJob` hold equivalents for those environments, and `extra/bash-completion` and `extra/zsh-completion` provide shell completion.

Sources: [extra/generic-init.d/celeryd:1-66](repo://extra/generic-init.d/celeryd#L1-L66), [extra/generic-init.d/celeryd:111-145](repo://extra/generic-init.d/celeryd#L111-L145)

### Helm chart

`helm-chart/` is a Helm chart (version 0.1.0) deploying `replicaCount: 4` worker pods from the `celery/celery:dev` image with a service account, a ConfigMap of environment variables (`CELERY_BROKER_URL` empty by default) and an optional Secret, both injected with `envFrom`. Its liveness and readiness probes run a Python one-liner that imports `celery.task.control` and a placeholder `<APP>`; there is no `celery/task` package in this tree, so the probes must be edited before use.

Sources: [helm-chart/Chart.yaml:1-6](repo://helm-chart/Chart.yaml#L1-L6), [helm-chart/values.yaml:1-72](repo://helm-chart/values.yaml#L1-L72), [helm-chart/templates/deployment.yaml:30-45](repo://helm-chart/templates/deployment.yaml#L30-L45), [helm-chart/templates/configmap.yaml:1-8](repo://helm-chart/templates/configmap.yaml#L1-L8)
