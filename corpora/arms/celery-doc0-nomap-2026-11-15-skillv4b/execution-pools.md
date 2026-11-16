---
title: "Execution Pools"
---
## Overview

The execution pool is where task code actually runs. The worker's main process receives messages and builds requests; the pool runs them concurrently, in child processes, threads or greenlets, and reports back through callbacks. Every pool implements the same small interface, `BasePool`, so the rest of the worker does not care which one is in use. This page describes that interface, each shipped pool and when to choose it, how time limits are enforced, and how the autoscaler resizes the pool. How a request is handed to the pool and what the callbacks do is on [[Task Execution and Tracing]].

Sources: [celery/concurrency/base.py:42-75](repo://celery/concurrency/base.py#L42-L75), [celery/concurrency/base.py:135-180](repo://celery/concurrency/base.py#L135-L180)

## Choosing a pool

The pool is chosen with `-P/--pool` (default `prefork`) and resolved through `concurrency.ALIASES`. Setting `CELERY_CUSTOM_WORKER_POOL` to a `package:Class` path adds a `custom` alias for an out-of-tree pool.

Sources: [celery/concurrency/__init__.py:11-48](repo://celery/concurrency/__init__.py#L11-L48), [celery/bin/worker.py:205-211](repo://celery/bin/worker.py#L205-L211)

| Pool | Runs tasks in | Choose it for | Limits |
| --- | --- | --- | --- |
| `prefork` (`processes`) | Child processes (billiard) | CPU-bound work, isolation, the default | Hard and soft time limits; `max_tasks_per_child`, `max_memory_per_child` |
| `threads` | A `ThreadPoolExecutor` | I/O-bound work without monkey patching | No time limits; not signal-safe |
| `gevent` | Greenlets in a gevent pool | Many concurrent I/O-bound tasks | Hard limit through `gevent.Timeout` |
| `eventlet` | Green threads in an eventlet pool | Many concurrent I/O-bound tasks | No time limits; `terminate_job` kills the greenlet |
| `solo` | The worker's main thread, one task at a time | Debugging, or one process per container | Blocks the worker while a task runs |

Sources: [celery/concurrency/prefork.py:107-216](repo://celery/concurrency/prefork.py#L107-L216), [celery/concurrency/thread.py:29-64](repo://celery/concurrency/thread.py#L29-L64), [celery/concurrency/gevent.py:28-40](repo://celery/concurrency/gevent.py#L28-L40), [celery/concurrency/gevent.py:85-140](repo://celery/concurrency/gevent.py#L85-L140), [celery/concurrency/eventlet.py:88-160](repo://celery/concurrency/eventlet.py#L88-L160), [celery/concurrency/solo.py:1-31](repo://celery/concurrency/solo.py#L1-L31)

Green pools must be selected on the command line, not with the `worker_pool` setting: `celery.__main__` looks for `-P eventlet` or `-P gevent` in `sys.argv` and monkey-patches the standard library before anything else is imported. The `Pool` step warns when `worker_pool` names a green pool, and embedded beat (`-B`) is refused with them.

Sources: [celery/__init__.py:107-147](repo://celery/__init__.py#L107-L147), [celery/worker/components.py:14-26](repo://celery/worker/components.py#L14-L26), [celery/worker/components.py:197-205](repo://celery/worker/components.py#L197-L205)

## The pool interface

`BasePool` holds a size limit and a state (`RUN`, `CLOSE`, `TERMINATE`) and exposes:

Sources: [celery/concurrency/base.py:42-75](repo://celery/concurrency/base.py#L42-L75)

- `start()`, `stop()` (graceful), `terminate()` (forceful) and `close()`, which call the `on_start`, `on_stop`, `on_terminate` and `on_close` hooks.
- `apply_async(target, args, kwargs, **options)`, which forwards to `on_apply` with `waitforslot` set from `putlocks`. The options include `callback`, `error_callback`, `accept_callback`, `timeout_callback`, `timeout` and `soft_timeout`.
- `terminate_job(pid, signal)`, `restart()`, `grow(n)` and `shrink(n)` where the pool supports them, plus `info` and `num_processes` for `inspect stats`.

Sources: [celery/concurrency/base.py:77-180](repo://celery/concurrency/base.py#L77-L180)

Class flags tell the worker how to treat the pool: `is_green` (greenlet-based), `signal_safe` (can be shut down from a signal handler; false for threads and green pools), `uses_semaphore` (prefork only: the worker limits in-flight tasks with a semaphore), `task_join_will_block` (forbids `result.get()` in tasks) and `body_can_be_buffer`.

Sources: [celery/concurrency/base.py:42-75](repo://celery/concurrency/base.py#L42-L75)

`apply_target` is the shared runner for in-process pools. It calls `accept_callback(pid, time)`, then the target, then `callback(result)`. A `BaseException` other than a worker shutdown, such as a `SystemExit` raised by the task, is converted into `WorkerLostError` and passed to the callback, so one task cannot exit the worker.

Sources: [celery/concurrency/base.py:19-39](repo://celery/concurrency/base.py#L19-L39)

## Prefork

### Child processes

The prefork `TaskPool` wraps billiard, a fork of `multiprocessing`. With the worker's event loop it uses `AsynPool`, a non-blocking pool driven by the hub; without it (Windows, green transports) it uses billiard's thread-based `BlockingPool`. Every child runs `process_initializer`, which:

Sources: [celery/concurrency/prefork.py:107-136](repo://celery/concurrency/prefork.py#L107-L136)

1. Asks the OS to kill the child when the parent dies, resets and ignores signals the child must not handle, and sets the process title.
2. Initializes the loader and logging (using `CELERY_LOG_*` variables the worker exported).
3. Makes the worker's app current and default, finalizes it, and rebuilds every task's tracer.
4. Forbids blocking `result.get()` calls, resets the worker state copied from the parent, and sends `worker_process_init`.

Sources: [celery/concurrency/prefork.py:40-88](repo://celery/concurrency/prefork.py#L40-L88)

When a child exits, `process_destructor` sends `worker_process_shutdown` with its pid and exit code. `on_stop` closes the pool and joins it; while it waits, a helper thread keeps firing the hub's timers so broker heartbeats continue during a long warm shutdown.

Sources: [celery/concurrency/prefork.py:91-99](repo://celery/concurrency/prefork.py#L91-L99), [celery/concurrency/prefork.py:141-195](repo://celery/concurrency/prefork.py#L141-L195)

### AsynPool

`AsynPool` gives each child its own pair of pipes (an input queue for jobs and an output queue for results), created in advance for every process. The parent registers the pipes with the event loop and writes jobs only when a child's input pipe is writable, so a slow child never blocks the worker. A child that does not report it is up within `worker_proc_alive_timeout` (4 seconds) is terminated.

Sources: [celery/concurrency/asynpool.py:1-15](repo://celery/concurrency/asynpool.py#L1-L15), [celery/concurrency/asynpool.py:414-488](repo://celery/concurrency/asynpool.py#L414-L488)

The `-O` option chooses the scheduling strategy, and both of its choices, `default` and `fair`, map to the fair strategy: a job is written only to a child that is not busy with another task, so a long task does not hold short ones queued behind it. The strategy table also has `fast`/`fcfs`, which writes to any child with a writable pipe and can leave jobs waiting behind long tasks.

Sources: [celery/concurrency/asynpool.py:75-87](repo://celery/concurrency/asynpool.py#L75-L87), [celery/concurrency/asynpool.py:770-787](repo://celery/concurrency/asynpool.py#L770-L787), [celery/concurrency/asynpool.py:825-834](repo://celery/concurrency/asynpool.py#L825-L834), [celery/bin/worker.py:169-175](repo://celery/bin/worker.py#L169-L175)

Before writing a job back after a child dies, `_put_back` checks the revoked set, so a revoked task is not resent to a new child.

Sources: [celery/concurrency/asynpool.py:745-768](repo://celery/concurrency/asynpool.py#L745-L768)

## Time limits

In the prefork pool, `AsynPool` schedules time limits on the event loop when a job starts: at the soft limit it calls the soft-timeout handler, which raises `SoftTimeLimitExceeded` inside the task, and schedules the hard limit for the remaining time; at the hard limit the child is killed and the job reported as timed out. The worker's `on_timeout` then records the failure ([[Task Execution and Tracing]]).

Sources: [celery/concurrency/asynpool.py:549-605](repo://celery/concurrency/asynpool.py#L549-L605)

The gevent pool wraps each task in `gevent.Timeout` when a hard limit is set and calls the timeout callback when it fires. The thread and solo pools pass no timeout to their runner, so limits have no effect there.

Sources: [celery/concurrency/gevent.py:28-40](repo://celery/concurrency/gevent.py#L28-L40), [celery/concurrency/thread.py:44-56](repo://celery/concurrency/thread.py#L44-L56)

## Autoscaling

`--autoscale=max,min` adds the autoscaler step. The pool starts with `min` processes, and the consumer's prefetch is sized for `max`. The `Autoscaler` compares the number of reserved requests with the current pool size: when more requests are reserved, it grows the pool up to `max`; when fewer, it shrinks it down to `min`, but only after `AUTOSCALE_KEEPALIVE` seconds (30 by default) since the last increase, so the pool does not oscillate. Shrinking fails quietly when all processes are busy.

Sources: [celery/worker/autoscale.py:28-28](repo://celery/worker/autoscale.py#L28-L28), [celery/worker/autoscale.py:61-130](repo://celery/worker/autoscale.py#L61-L130), [celery/worker/components.py:105-119](repo://celery/worker/components.py#L105-L119)

With the event loop, the check runs on every received task message and every `keepalive` seconds on the hub; without it, the autoscaler is a background thread that checks once a second. The `autoscale` remote-control command calls `update(max, min)`, which resizes at once and adjusts the consumer's prefetch count ([[Remote Control and Inspection]]).

Sources: [celery/worker/autoscale.py:31-58](repo://celery/worker/autoscale.py#L31-L58), [celery/worker/autoscale.py:77-112](repo://celery/worker/autoscale.py#L77-L112)
