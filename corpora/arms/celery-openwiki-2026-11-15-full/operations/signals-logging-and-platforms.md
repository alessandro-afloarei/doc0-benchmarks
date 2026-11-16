---
type: reference
title: Signals, Logging and Platform Support
description: Celery's signal dispatcher and the catalog of task, worker, beat, logging and import signals; how worker logging is configured (setup_logging override, root logger hijacking, task logger format); and platform utilities for pidfiles, daemonization, privilege dropping, root checks and OS signal handling.
tags: [signals, logging, platforms, daemonization, security]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T09:27:53.075Z
sources:
  - id: openwiki-source-ac404435efa758dad4bbfc83
    resource: repo://celery/app/defaults.py
  - id: openwiki-source-0fa67a77205fc742989db5af
    resource: repo://celery/app/log.py
  - id: openwiki-source-0f8d26932b6272605a1f8531
    resource: repo://celery/platforms.py
  - id: openwiki-source-a9026ddc8502497a8b6b470f
    resource: repo://celery/signals.py
  - id: openwiki-source-7ef2718c0e261f897e55c1de
    resource: repo://celery/utils/dispatch/signal.py
generated: { by: "claude-code", at: "2026-11-15T09:27:53.075Z" }
---

# Signals, Logging and Platform Support

## Signal dispatcher

`celery/utils/dispatch/signal.py:Signal` is a fork of Django's dispatcher (`celery/signals.py` defines the instances):

- `signal.connect(receiver, sender=None, weak=True, dispatch_uid=None, retry=False)` — usable directly or as a decorator (`@task_success.connect(sender='tasks.add')`). Receivers must accept `**kwargs` and are weakly referenced by default (so connecting a locally defined function with `weak=True` can silently drop it). `dispatch_uid` deduplicates registrations.
- `retry=True` wraps the receiver with `retry_over_time` so it is retried (logging each failure) until it succeeds, forcing a strong reference.
- `send(sender, **named)` calls every live receiver for that sender; **exceptions are caught, logged, and returned** in the `(receiver, response)` list rather than propagated. `send_robust` is an alias. Callers that need to fail on receiver errors must inspect the responses (as `BaseLoader.import_default_modules` does for `import_modules`).
- A per-sender cache (`use_caching`) short-circuits sends with no receivers.

App instances also have their own signals: `app.on_configure`, `on_after_configure`, `on_after_finalize`, `on_after_fork` (see [Application Object and Configuration](../app/application-and-configuration.md)).

### Signal catalog

| Area | Signals |
| --- | --- |
| Publishing (client) | `before_task_publish`, `after_task_publish`, `task_sent` (deprecated) |
| Task execution (worker) | `task_received`, `task_prerun`, `task_postrun`, `task_success`, `task_retry`, `task_failure`, `task_internal_error`, `task_revoked`, `task_rejected`, `task_unknown` |
| Worker lifecycle | `celeryd_init`, `celeryd_after_setup`, `worker_init`, `worker_before_create_process`, `worker_process_init`, `worker_process_shutdown`, `worker_ready`, `worker_shutting_down`, `worker_shutdown`, `heartbeat_sent` |
| Imports | `import_modules` (sent before default task modules are imported; drives lazy `autodiscover_tasks`) |
| Logging | `setup_logging`, `after_setup_logger`, `after_setup_task_logger` |
| Beat | `beat_init`, `beat_embedded_init` |
| Eventlet pool | `eventlet_pool_started`, `eventlet_pool_preshutdown`, `eventlet_pool_postshutdown`, `eventlet_pool_apply` |
| CLI | `user_preload_options` |

Where they are sent: publish signals in `AMQP.send_task_message` ([Publishing](../messaging/publishing-and-routing.md)); execution signals in the strategy, request and tracer ([Task Execution](../worker/task-execution.md)); `worker_process_init` in pool child initialisation ([Pools](../worker/concurrency-pools.md)). The tracer only sends `task_prerun`/`task_success`/`task_postrun` when receivers exist, to keep the hot path cheap.

## Logging (`celery/app/log.py`, `celery/utils/log.py`)

`app.log` is a `Logging` instance. `Logging.setup()` is called by the worker and beat programs:

1. `setup_logging_subsystem()` runs **once per process** (`Logging._setup`). It node-formats the log file name (`%n`, `%i`, `%I`), resets the multiprocessing logger, and sends `setup_logging`.
2. **If any receiver handles `setup_logging`, Celery configures nothing else** — this is the supported way to take over logging completely (e.g. with `logging.config.dictConfig`).
3. Otherwise, when `worker_hijack_root_logger` is true (default) it removes existing handlers from the root, `celery`, `celery.task` and `celery.redirected` loggers, then attaches a handler (stderr stream, an open file, or a `WatchedFileHandler` for a path) with `worker_log_format` to the root logger, configures the multiprocessing logger (ERROR unless `MP_LOG` is set), sends `after_setup_logger`, and sets up the task logger.
4. `setup_task_loggers()` configures the `celery.task` logger with `TaskFormatter` and `worker_task_log_format` (which includes `%(task_name)s[%(task_id)s]`, filled from the current task), non-propagating, and sends `after_setup_task_logger`.
5. With `worker_redirect_stdouts` (default on), `sys.stdout`/`sys.stderr` are replaced by a `LoggingProxy` writing to `celery.redirected` at `worker_redirect_stdouts_level`.
6. The log level/file are exported in `CELERY_LOG_LEVEL`, `CELERY_LOG_FILE` and `_MP_FORK_*` environment variables so `execv`-spawned children can configure logging before `Process.run`.

Colour output is used only when no log file is set and stderr is a TTY (never on Windows), unless forced.

In task code use `celery.utils.log.get_task_logger(__name__)`: it returns a logger parented under `celery.task` so records get task name/id formatting. `get_logger(name)` returns a plain logger.

## Platform utilities (`celery/platforms.py`)

### Pidfiles

`Pidfile` writes the PID with `O_CREAT|O_EXCL`, then re-reads it to verify consistency (`LockFailed` otherwise). `remove_if_stale()` removes pidfiles whose process no longer exists (or that are empty/corrupt). `create_pidlock(path)` acquires the lock, exits with an error if another live process owns it, and registers an `atexit` release. Used by `worker --pidfile`, `beat --pidfile`, and `celery multi`.

### Daemonization

`detached(logfile, pidfile, uid, gid, umask, workdir, fake)`:

- Resets `SIGCLD` to the default handler and **drops privileges first** (`maybe_drop_privileges(uid, gid)`), so files are created as the target user.
- Returns a `DaemonContext` that, when entered, double-`fork()`s with `setsid()`, `chdir`s to `workdir` (the current directory when not given), sets `umask` (string umasks are parsed as octal when prefixed with `0`), then — still with stderr available — checks that the log file can be opened for append and that the pidfile is not locked by a live process. Finally it closes all open file descriptors except stdio and `/dev/urandom`, redirects stdio to `/dev/null`, and runs multiprocessing after-fork hooks.
- `fake=True` (or the `C_FAKEFORK` env var for the worker) skips the actual fork for debugging.
- Raises `RuntimeError` on platforms without the `resource` module (e.g. Windows).

`celery worker --detach` and `celery beat --detach` use it, then `execv` a fresh interpreter (see [Command-Line Interface](../cli/command-line.md)).

### Privilege dropping and root checks

- `maybe_drop_privileges(uid, gid)` is a no-op on Windows. As root it calls `initgroups`/`setgid`/`setuid` (resolving names via `pwd`/`grp`); it then verifies it cannot regain root and raises `SecurityError('Still root uid/gid after drop privileges!')` otherwise. A non-root process with real uid 0 raises `SecurityError`.
- `check_privileges(accept_content)` (called on worker startup) refuses to run as root, or with a `sudo`/`wheel` group, **when pickle-based content is accepted**, unless `C_FORCE_ROOT` is set; in other cases it only emits a `SecurityWarning`.

### OS signals and process titles

- `platforms.signals` (a `Signals` instance) is a dict-like wrapper: `signals['SIGTERM'] = handler`, `signals.update(SIGINT=..., SIGQUIT=...)`, `ignore()`, `reset()`, `supported()` and `arm_alarm()`. Unsupported signal names on a platform are silently skipped.
- `set_process_title()` / `set_mp_process_title()` use `setproctitle` when installed.
- `set_pdeathsig()` asks Linux to signal a child when its parent dies.
- `close_open_fds()`, `fd_by_path()`, `ignore_errno()` are helpers used by beat, the worker and daemonization.

Worker shutdown signal semantics (warm `SIGTERM`, cold `SIGQUIT`, soft shutdown, `SIGHUP` restart, `SIGUSR1` stack dump) are documented in [Worker Bootsteps and WorkController](../worker/bootsteps-and-workcontroller.md).

## Related tests

`t/unit/utils/test_platforms.py`, `t/unit/app/test_log.py`, `t/unit/utils/test_dispatcher.py`, `t/smoke/tests/test_signals.py`.
