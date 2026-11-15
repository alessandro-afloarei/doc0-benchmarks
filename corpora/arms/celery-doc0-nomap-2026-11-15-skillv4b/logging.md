---
title: "Logging"
---
## Overview

Celery sets up Python's `logging` for its programs (worker, beat, events camera) through `app.log`, an instance of `celery.app.log.Logging`. It configures the root logger and a separate `celery.task` logger whose records carry the current task's name and id, can redirect `print` output into the log, and lets a project take over completely through the `setup_logging` signal. Helpers in `celery/utils/log.py` give modules and tasks loggers that fit into this hierarchy. The signal mechanism itself is on [[Signals]].

Sources: [celery/app/log.py:46-76](repo://celery/app/log.py#L46-L76), [celery/utils/log.py:28-36](repo://celery/utils/log.py#L28-L36)

## The logger hierarchy

All of Celery's loggers descend from the `celery` logger, and all task loggers from `celery.task`. `get_logger(name)` returns a logger and, unless it is the root or a direct child of it, makes `celery` its parent. `get_task_logger(name)` does the same with `celery.task` as the parent and refuses the reserved names `celery` and `celery.task`. Because task loggers inherit from `celery.task`, they get its handler and its `TaskFormatter`.

Sources: [celery/utils/log.py:28-36](repo://celery/utils/log.py#L28-L36), [celery/utils/log.py:91-113](repo://celery/utils/log.py#L91-L113)

```python
from celery.utils.log import get_task_logger

logger = get_task_logger(__name__)

@app.task
def add(x, y):
    logger.info('Adding %s + %s', x, y)
    return x + y
```

Sources: [celery/utils/log.py:109-113](repo://celery/utils/log.py#L109-L113)

`TaskFormatter` adds `task_id` and `task_name` from the task currently running in the process (or `???` outside a task) before formatting, so the default task format, `worker_task_log_format`, can show `%(task_name)s[%(task_id)s]`.

Sources: [celery/app/log.py:32-43](repo://celery/app/log.py#L32-L43), [celery/app/defaults.py:14-18](repo://celery/app/defaults.py#L14-L18)

## Setting up logging

`app.log.setup(loglevel, logfile, redirect_stdouts, redirect_level, colorize, hostname)` is called by the worker's `on_init_blueprint`, by beat, and by every prefork child. It calls `setup_logging_subsystem`, which runs only once per process:

Sources: [celery/app/log.py:61-76](repo://celery/app/log.py#L61-L76), [celery/apps/worker.py:184-190](repo://celery/apps/worker.py#L184-L190)

1. Expand node-name placeholders in the log file name with `node_format` and the worker's hostname.
2. Send `setup_logging` with the level, file, format and colour flag.
3. If no receiver is connected, configure logging: with `worker_hijack_root_logger` (the default), first remove every handler from the root, `celery`, `celery.task` and `celery.redirected` loggers; then add one handler to the root logger, configure the multiprocessing logger (at `ERROR` unless `MP_LOG` is set), send `after_setup_logger`, and set up the task logger and send `after_setup_task_logger`.
4. Export the level, file and format in `_MP_FORK_*` environment variables so a process started by fork-and-exec can log before it configures itself.

Sources: [celery/app/log.py:87-146](repo://celery/app/log.py#L87-L146), [celery/app/log.py:156-181](repo://celery/app/log.py#L156-L181)

`setup` also exports `CELERY_LOG_LEVEL` and `CELERY_LOG_FILE` (and `CELERY_LOG_REDIRECT*` when redirecting), which `process_initializer` reads to configure logging the same way in each prefork child, and routes Python warnings, including Celery's deprecation warnings, into logging.

Sources: [celery/app/log.py:61-85](repo://celery/app/log.py#L61-L85), [celery/concurrency/prefork.py:58-68](repo://celery/concurrency/prefork.py#L58-L68)

> [!IMPORTANT]
> Connecting any receiver to `setup_logging` disables Celery's logging configuration entirely, including the task logger. Connect to `after_setup_logger` or `after_setup_task_logger` instead to add handlers to what Celery set up, or set `worker_hijack_root_logger = False` to keep handlers configured before the worker starts.

Sources: [celery/app/log.py:98-131](repo://celery/app/log.py#L98-L131)

## Handlers and colours

`setup_handlers` adds a handler only to a logger that has no real handler yet. The handler is a `StreamHandler` on `sys.__stderr__` when no log file is given (or when the "file" is an open stream), and a `WatchedFileHandler` otherwise, which reopens the file when it is rotated by an external tool.

Sources: [celery/app/log.py:213-237](repo://celery/app/log.py#L213-L237)

Records are formatted with `ColorFormatter`, which colours lines by level (debug blue, warning yellow, error red, critical magenta) when colour is on. Colour is on only when there is no log file and stderr is a terminal, never on Windows, and can be forced with `worker_log_color` or switched off with `--no-color`.

Sources: [celery/utils/log.py:123-175](repo://celery/utils/log.py#L123-L175), [celery/app/log.py:199-211](repo://celery/app/log.py#L199-L211)

| Setting | Default | Effect |
| --- | --- | --- |
| `worker_log_format` | `[%(asctime)s: %(levelname)s/%(processName)s] %(message)s` | Root logger format |
| `worker_task_log_format` | adds `%(task_name)s[%(task_id)s]:` | `celery.task` logger format |
| `worker_log_color` | auto | Force or disable colours |
| `worker_hijack_root_logger` | `True` | Remove existing root handlers before configuring |
| `worker_redirect_stdouts` | `True` | Send `print` output to the log |
| `worker_redirect_stdouts_level` | `WARNING` | Level of redirected output |

Sources: [celery/app/defaults.py:14-18](repo://celery/app/defaults.py#L14-L18), [celery/app/defaults.py:343-357](repo://celery/app/defaults.py#L343-L357)

## Redirecting stdout and stderr

With `worker_redirect_stdouts` on and no custom logging, the worker replaces `sys.stdout` and `sys.stderr` with a `LoggingProxy` on the `celery.redirected` logger, so `print()` in a task becomes a log record at `worker_redirect_stdouts_level`. The proxy strips trailing newlines and ignores empty writes. It guards against loops: when the logger writes back to the proxy, a thread-local flag drops the nested write, and inside a signal handler it writes straight to the real stderr instead of logging. Handler errors are printed to `sys.__stderr__`, never to the redirected stream.

Sources: [celery/app/log.py:78-85](repo://celery/app/log.py#L78-L85), [celery/app/log.py:183-197](repo://celery/app/log.py#L183-L197), [celery/utils/log.py:178-261](repo://celery/utils/log.py#L178-L261), [celery/apps/worker.py:142-143](repo://celery/apps/worker.py#L142-L143)

## Logs of task execution

The worker and tracer log task lifecycles on the `celery.app.trace` and worker loggers: "Received task" when a message arrives, "succeeded in Ns" with the return value, and failures with their traceback. Failure logging follows a policy chosen by the exception: exceptions listed in the task's `throws` are logged at `INFO` without a traceback, `Ignore` at `INFO`, `Reject` at `WARNING`, errors inside Celery's own code at `CRITICAL`, and any other exception at `ERROR` with its traceback. Every message passes its fields as the record's `data` attribute too, for structured log handlers.

Sources: [celery/app/trace.py:87-102](repo://celery/app/trace.py#L87-L102), [celery/app/trace.py:123-148](repo://celery/app/trace.py#L123-L148), [celery/app/trace.py:284-311](repo://celery/app/trace.py#L284-L311), [celery/worker/strategy.py:150-160](repo://celery/worker/strategy.py#L150-L160)
