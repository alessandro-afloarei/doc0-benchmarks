---
title: "Logging"
---
## Overview

Celery configures Python's standard `logging` for its programs. `app.log` (`celery.app.log.Logging`) sets up the root logger, the multiprocessing logger and a separate `celery.task` logger whose formatter adds the task name and id; `celery.utils.log` provides `get_logger`, `get_task_logger`, the colour formatter and the proxy that turns `print` output into log records. Setup happens once per process and can be replaced entirely by connecting to the `setup_logging` signal ([[Signals]]). This page follows what `celery worker -l INFO -f worker.log` does to logging, and what task code should use.

Sources: [celery/app/log.py:1-60](repo://celery/app/log.py#L1-L60), [celery/utils/log.py:17-36](repo://celery/utils/log.py#L17-L36)

## Logger hierarchy

All Celery loggers hang under `celery`. `get_logger(name)` returns the standard logger and, unless it is the root logger or a direct child of root, reparents it under `celery`, so configuring `celery` covers every module. `get_task_logger(name)` reparents the logger under `celery.task` instead, which is what makes task messages use the task formatter; the names `celery` and `celery.task` are reserved and raise `RuntimeError`.

Sources: [celery/utils/log.py:30-36](repo://celery/utils/log.py#L30-L36), [celery/utils/log.py:72-113](repo://celery/utils/log.py#L72-L113)

```python
from celery.utils.log import get_task_logger

logger = get_task_logger(__name__)

@app.task
def add(x, y):
    logger.info('Adding %s + %s', x, y)
    return x + y
```

Sources: [celery/utils/log.py:109-113](repo://celery/utils/log.py#L109-L113)

`mlevel` converts level names such as `'INFO'` to numbers and passes numbers through; the CLI's `LOG_LEVEL` type uses it.

Sources: [celery/utils/log.py:116-120](repo://celery/utils/log.py#L116-L120), [celery/bin/base.py:308-321](repo://celery/bin/base.py#L308-L321)

## Setting up logging

### Logging.setup

`app.log.setup(loglevel, logfile, redirect_stdouts=False, redirect_level='WARNING', colorize=None, hostname=None)` calls `setup_logging_subsystem`, redirects stdout and stderr when asked and nobody else handled logging, and records `CELERY_LOG_LEVEL` and `CELERY_LOG_FILE` in the environment so pool child processes can repeat the setup. It also makes Celery's deprecation warnings always show and routes warnings into logging.

Sources: [celery/app/log.py:61-85](repo://celery/app/log.py#L61-L85)

The worker calls it from `on_init_blueprint` with its `-l` level, `-f` log file and hostname (stdout redirection is applied separately later, in `on_start`). Beat calls it from `start_scheduler`.

Sources: [celery/apps/worker.py:122-126](repo://celery/apps/worker.py#L122-L126), [celery/apps/worker.py:184-190](repo://celery/apps/worker.py#L184-L190), [celery/apps/worker.py:152-155](repo://celery/apps/worker.py#L152-L155), [celery/apps/beat.py:86-91](repo://celery/apps/beat.py#L86-L91)

### setup_logging_subsystem

1. Returns immediately if logging was already set up in this process (`Logging._setup`).
2. Expands node placeholders in the log file name (`%n`, `%i` …) with the hostname.
3. Resolves the level (default `WARNING`), format (`worker_log_format`) and colour.
4. Sends `setup_logging`. If any receiver is connected, Celery assumes the application configured logging and stops here.
5. Otherwise, with `worker_hijack_root_logger` (on by default), removes existing handlers from the root, `celery`, `celery.task` and `celery.redirected` loggers.
6. Adds a handler to the root logger and to billiard's multiprocessing logger (at `ERROR` unless `MP_LOG` is set), sends `after_setup_logger`, and sets up the task logger.
7. Exports `_MP_FORK_LOGLEVEL_`, `_MP_FORK_LOGFILE_` and `_MP_FORK_LOGFORMAT_` so logging works in a child before it runs.

Sources: [celery/app/log.py:87-146](repo://celery/app/log.py#L87-L146), [celery/app/log.py:54-59](repo://celery/app/log.py#L54-L59)

Turning `worker_hijack_root_logger` off keeps handlers the application already installed and adds Celery's alongside them. Connecting a receiver to `setup_logging` disables all of Celery's configuration instead.

Sources: [celery/app/log.py:107-119](repo://celery/app/log.py#L107-L119), [celery/app/defaults.py:346-348](repo://celery/app/defaults.py#L346-L348)

### Handlers

`setup_handlers` adds a handler only if the logger has no real handler yet. With no log file it writes to the original `sys.__stderr__`; with a path it uses a `WatchedFileHandler` in UTF-8, which reopens the file when log rotation moves it; an object with `write` is used as a stream.

Sources: [celery/app/log.py:213-237](repo://celery/app/log.py#L213-L237)

Colour is used only when not explicitly disabled, there is no log file, stderr is a terminal and the platform is not Windows. `ColorFormatter` colours `DEBUG` blue, `WARNING` yellow, `ERROR` red and `CRITICAL` magenta, and if colouring a message fails it logs a placeholder `<Unrepresentable ...>` rather than raising.

Sources: [celery/app/log.py:199-211](repo://celery/app/log.py#L199-L211), [celery/utils/log.py:123-175](repo://celery/utils/log.py#L123-L175)

## Task logging

`setup_task_loggers` gives `celery.task` a handler with `TaskFormatter` and `worker_task_log_format`, sets its level, turns off propagation (so task records are not printed twice by the root handler) and sends `after_setup_task_logger`. `TaskFormatter` fills `task_id` and `task_name` from the currently executing task, or `???` outside a task.

Sources: [celery/app/log.py:156-181](repo://celery/app/log.py#L156-L181), [celery/app/log.py:32-43](repo://celery/app/log.py#L32-L43)

The default formats are:

Sources: [celery/app/defaults.py:13-18](repo://celery/app/defaults.py#L13-L18)

```text
[%(asctime)s: %(levelname)s/%(processName)s] %(message)s
[%(asctime)s: %(levelname)s/%(processName)s] %(task_name)s[%(task_id)s]: %(message)s
```

Sources: [celery/app/defaults.py:13-18](repo://celery/app/defaults.py#L13-L18)

The worker itself logs each task's life cycle through `celery.app.trace` with fixed messages: `Task name[id] received`, `succeeded in Ns: result`, `retry: reason`, and failures. A failure is logged at `ERROR` with traceback, except exceptions listed in the task's `throws`, which are logged at `INFO` as "raised expected" without traceback; `Reject` is logged at `WARNING` and `Ignore` at `INFO`. Each record carries the message context in `extra['data']` for custom handlers.

Sources: [celery/app/trace.py:50-103](repo://celery/app/trace.py#L50-L103), [celery/app/trace.py:126-147](repo://celery/app/trace.py#L126-L147)

## Redirecting stdout and stderr

With `worker_redirect_stdouts` (on by default), the worker replaces `sys.stdout` and `sys.stderr` with a `LoggingProxy` on the `celery.redirected` logger at `worker_redirect_stdouts_level` (`WARNING`), so `print` in a task becomes a log record. It does this only when the application did not take over logging through `setup_logging`.

Sources: [celery/app/log.py:78-85](repo://celery/app/log.py#L78-L85), [celery/app/log.py:183-197](repo://celery/app/log.py#L183-L197), [celery/apps/worker.py:106-117](repo://celery/apps/worker.py#L106-L117), [celery/apps/worker.py:152-155](repo://celery/apps/worker.py#L152-L155), [celery/app/defaults.py:360-365](repo://celery/app/defaults.py#L360-L365)

`LoggingProxy.write` strips trailing newlines and logs each non-empty write. It guards against recursion when a handler writes back to the proxy, and inside a signal handler it prints to the real stderr instead, since logging is not safe there. The proxy wraps the logger's handlers so their own errors go to `sys.__stderr__` rather than looping. `isatty()` is false and `flush()` does nothing.

Sources: [celery/utils/log.py:178-260](repo://celery/utils/log.py#L178-L260), [celery/utils/log.py:39-69](repo://celery/utils/log.py#L39-L69)

## Pool processes

A prefork child repeats logging setup in `process_initializer` from the `CELERY_LOG_*` variables. When the log file name contains `%i`, it first clears the "already set up" flag so each child opens its own file, numbered by its pool process index (`current_process_index`).

Sources: [celery/concurrency/prefork.py:56-67](repo://celery/concurrency/prefork.py#L56-L67), [celery/utils/log.py:284-295](repo://celery/utils/log.py#L284-L295)

When beat runs embedded, its child process closes inherited file descriptors except those of open log handlers, found by `iter_open_logger_fds` ([[Periodic Tasks with Beat]]).

Sources: [celery/beat.py:707-720](repo://celery/beat.py#L707-L720), [celery/utils/log.py:45-60](repo://celery/utils/log.py#L45-L60)
