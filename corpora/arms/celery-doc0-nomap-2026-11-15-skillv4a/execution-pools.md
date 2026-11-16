---
title: "Execution Pools"
---
## Overview

The execution pool is where task code actually runs. The worker's `Pool` bootstep creates one pool of the class chosen with `-P/--pool` (or `worker_pool`), sized by `-c/--concurrency`. Every request reaches it through `pool.apply_async(trace_function, args, callbacks, time limits)`, as [[Task Execution and Tracing]] shows. Pools differ in what a slot is (a child process, a thread, a greenlet, or the worker's own thread), and so in isolation, time-limit support, how many tasks can run at once, and whether the worker uses its event loop. This page describes the common interface, each pool, the startup monkey patching that green pools need, and the autoscaler.

Sources: [celery/worker/components.py:100-172](repo://celery/worker/components.py#L100-L172), [celery/concurrency/__init__.py:11-48](repo://celery/concurrency/__init__.py#L11-L48)

## Choosing a pool

| Name | Class | A slot is | Time limits | Use when |
| --- | --- | --- | --- | --- |
| `prefork` (default) | `celery.concurrency.prefork:TaskPool` | A child process (billiard) | Soft and hard | CPU-bound or mixed work; tasks need isolation from each other |
| `threads` | `celery.concurrency.thread:TaskPool` | A thread in a `ThreadPoolExecutor` | No | I/O-bound tasks that release the GIL; platforms without fork |
| `eventlet` | `celery.concurrency.eventlet:TaskPool` | A green thread | Hard limit via timer | Many concurrent I/O-bound tasks with eventlet-compatible libraries |
| `gevent` | `celery.concurrency.gevent:TaskPool` | A greenlet | Hard limit via `gevent.Timeout` | Many concurrent I/O-bound tasks with gevent-compatible libraries |
| `solo` | `celery.concurrency.solo:TaskPool` | The worker's main thread | No | One task at a time; debugging; environments without processes or threads |
| `custom` | `$CELERY_CUSTOM_WORKER_POOL` | Defined by the class | | An out-of-tree `BasePool` subclass |

Sources: [celery/concurrency/__init__.py:11-48](repo://celery/concurrency/__init__.py#L11-L48), [celery/concurrency/solo.py:11-31](repo://celery/concurrency/solo.py#L11-L31), [celery/concurrency/thread.py:30-64](repo://celery/concurrency/thread.py#L30-L64)

`get_implementation(name)` resolves an alias or a `module:Class` path; `threads` is only offered when `concurrent.futures` is importable. Setting `CELERY_CUSTOM_WORKER_POOL=package:Class` and passing `-P custom` loads a third-party pool.

Sources: [celery/concurrency/__init__.py:19-48](repo://celery/concurrency/__init__.py#L19-L48)

The choice also affects how the worker reads messages. The consumer's asynchronous event loop is used only when the environment is not green, the transport supports async I/O and the platform is not Windows, so eventlet, gevent (and Windows) workers fall back to the blocking loop described in [[The Consumer]]. Green pools also set `task_join_will_block = False`, which lets tasks wait on results; prefork and the base class set it to true, as [[Task Results]] explains.

Sources: [celery/worker/worker.py:238-241](repo://celery/worker/worker.py#L238-L241), [celery/concurrency/base.py:60-71](repo://celery/concurrency/base.py#L60-L71), [celery/concurrency/eventlet.py:88-95](repo://celery/concurrency/eventlet.py#L88-L95)

## The BasePool interface

All pools subclass `BasePool`. Its `apply_async(target, args, kwargs, **options)` logs at debug level and calls the subclass's `on_apply` with `waitforslot=self.putlocks`. `start`, `stop`, `terminate` and `close` move the pool through `RUN`, `CLOSE` and `TERMINATE` and call `on_start`, `on_stop`, `on_terminate` and `on_close`. Optional operations, `terminate_job(pid, signal)` and `restart()`, raise `NotImplementedError` by default; `grow`/`shrink` exist only where the pool supports resizing.

Sources: [celery/concurrency/base.py:73-156](repo://celery/concurrency/base.py#L73-L156)

| Attribute | Meaning |
| --- | --- |
| `is_green` | The pool runs greenlets; the control mailbox and heartbeats adapt |
| `signal_safe` | The pool can be shut down from inside a signal handler (false for threads and green pools) |
| `uses_semaphore` | The worker should guard puts with a semaphore (prefork) |
| `task_join_will_block` | Waiting on a result inside a task would block a slot |
| `body_can_be_buffer` | The message body can be passed without copying |
| `Timer` | Timer class used when the worker has no event loop |
| `num_processes` | Current slot count, used for prefetch |

Sources: [celery/concurrency/base.py:47-72](repo://celery/concurrency/base.py#L47-L72), [celery/concurrency/base.py:178-180](repo://celery/concurrency/base.py#L178-L180)

`apply_target` is the shared runner for the non-process pools. It calls `accept_callback(pid, monotonic())`, runs the target, and passes the return value to `callback`. Ordinary exceptions and `WorkerShutdown`/`WorkerTerminate` propagate; any other `BaseException` is wrapped in a `WorkerLostError` and passed to the callback as an `ExceptionInfo`, so the request records a failure instead of the slot dying silently.

Sources: [celery/concurrency/base.py:22-44](repo://celery/concurrency/base.py#L22-L44)

## Prefork

### Child processes

`prefork.TaskPool.on_start` creates a billiard pool with `limit` processes, the `process_initializer` and `process_destructor` hooks, timeouts enabled and `worker_proc_alive_timeout`. It uses `AsynPool` when the worker has an event loop and billiard's blocking pool otherwise. It then binds `apply_async`, `maintain_pool`, `terminate_job`, `grow`, `shrink` and `flush` directly to the underlying pool.

Sources: [celery/concurrency/prefork.py:95-126](repo://celery/concurrency/prefork.py#L95-L126)

`process_initializer` runs in every child and performs the steps below.

Sources: [celery/concurrency/prefork.py:41-46](repo://celery/concurrency/prefork.py#L41-L46)

1. Asks the OS to kill the child with `SIGKILL` if the parent dies, and sets `task_join_will_block`.
2. Resets `SIGTERM`, `SIGHUP`, `SIGTTIN`, `SIGTTOU` and `SIGUSR1` to their defaults and ignores `SIGINT` (and `SIGTERM` when billiard remaps it), so only the parent decides how to shut down.
3. Sets the process title, runs the loader's worker and worker-process hooks, and sets up logging from the `CELERY_LOG_*` environment variables.
4. Makes the app current and finalizes it (or, after an `execv`, runs the full worker optimizations), rebuilds every task's tracer, and resets the worker state copied from the parent.
5. Sends `worker_process_init`.

Sources: [celery/concurrency/prefork.py:47-82](repo://celery/concurrency/prefork.py#L47-L82)

When a child exits, `process_destructor` sends `worker_process_shutdown` with its pid and exit code.

Sources: [celery/concurrency/prefork.py:85-92](repo://celery/concurrency/prefork.py#L85-L92)

`--max-tasks-per-child` and `--max-memory-per-child` are passed to billiard, which replaces a child after that many tasks or when its resident memory exceeds the limit, which contains leaks in task code. Before each new child is created, `AsynPool` sends `worker_before_create_process` and runs a garbage collection.

Sources: [celery/worker/components.py:152-169](repo://celery/worker/components.py#L152-L169), [celery/concurrency/asynpool.py:490-493](repo://celery/concurrency/asynpool.py#L490-L493)

### AsynPool and the event loop

`AsynPool` is billiard's pool rewritten to run without helper threads, driven by the worker's hub. Each child gets its own pair of pipes, created in advance, and `register_with_event_loop` adds the result pipes as readers, each child's sentinel (to notice exits and call `maintain_pool`), the time-limit and write handlers, and the pool's periodic timers.

Sources: [celery/concurrency/asynpool.py:428-488](repo://celery/concurrency/asynpool.py#L428-L488), [celery/concurrency/asynpool.py:495-547](repo://celery/concurrency/asynpool.py#L495-L547)

Sending a job is asynchronous too. `send_job` serializes the job and appends it to `outbound_buffer`. On each loop tick `on_poll_start` registers the input pipes of idle children as writers. When pipes become writable, `schedule_writes` round-robins over them, popping a job, marking that child busy, and writing the job with a generator that continues across loop iterations if the pipe fills up, so a large message never blocks the worker.

Sources: [celery/concurrency/asynpool.py:770-786](repo://celery/concurrency/asynpool.py#L770-L786), [celery/concurrency/asynpool.py:804-890](repo://celery/concurrency/asynpool.py#L804-L890)

The scheduling strategy comes from `-O`. The default, `fair`, only writes to children that are not busy, so a long task does not have short tasks queued behind it in its pipe. `fcfs` (also `fast`) writes to any writable pipe.

Sources: [celery/concurrency/asynpool.py:77-87](repo://celery/concurrency/asynpool.py#L77-L87), [celery/concurrency/asynpool.py:770-786](repo://celery/concurrency/asynpool.py#L770-L786)

Time limits are timers on the hub. When a job starts, a timer is set for the soft limit (or directly the hard limit). The soft timer schedules the hard one for the remaining time and signals the child, which raises `SoftTimeLimitExceeded` in the task; the hard timer kills the child, and billiard reports the job as lost with `TimeLimitExceeded`, which reaches `Request.on_timeout`.

Sources: [celery/concurrency/asynpool.py:549-605](repo://celery/concurrency/asynpool.py#L549-L605), [celery/worker/request.py:529-594](repo://celery/worker/request.py#L529-L594)

### Stopping

`on_stop` closes the pool and joins it, waiting for running tasks; while it waits, a helper thread keeps firing hub timers so broker heartbeats continue during a long warm shutdown. `on_terminate` kills the children. `restart()` replaces every child, for the `pool_restart` remote command.

Sources: [celery/concurrency/prefork.py:128-198](repo://celery/concurrency/prefork.py#L128-L198)

## Threads

The threads pool submits `apply_target` to a `ThreadPoolExecutor` with `limit` workers and returns a small wrapper around the future. It has no time limits, cannot terminate a running task, and is not signal-safe; stopping shuts the executor down and cancels futures that have not started.

Sources: [celery/concurrency/thread.py:21-64](repo://celery/concurrency/thread.py#L21-L64)

## Solo

The solo pool sets `on_apply = apply_target` and `limit = 1`, so `apply_async` runs the task inline in the worker's thread and returns only when it is done; the worker reads no new messages meanwhile. It sends `worker_process_init` when created, since the worker process is also the task process.

Sources: [celery/concurrency/solo.py:11-31](repo://celery/concurrency/solo.py#L11-L31)

## Eventlet and gevent

### Monkey patching

Green pools need the standard library patched before anything else imports sockets or threads. `celery.__main__.main` therefore calls `maybe_patch_concurrency()` before importing the CLI (except for `celery multi`). That function looks for `-P` or `--pool` in `sys.argv` and, for `eventlet` or `gevent`, runs `eventlet.monkey_patch()` (with blocking detection if `EVENTLET_NOBLOCK` is set) or `gevent.monkey.patch_all()`. Selecting a green pool through the `worker_pool` setting is too late for this, and the `Pool` step warns about it.

Sources: [celery/__main__.py:1-18](repo://celery/__main__.py#L1-L18), [celery/__init__.py:89-146](repo://celery/__init__.py#L89-L146), [celery/worker/components.py:25-29](repo://celery/worker/components.py#L25-L29), [celery/worker/components.py:140-142](repo://celery/worker/components.py#L140-L142)

### Running greenlets

Both pools spawn `apply_target` in a green pool of size `limit`, using the greenlet's id as its "pid", and keep a map from id to greenlet so `terminate_job` can kill it; a task killed this way returns an empty result instead of raising `GreenletExit`. Both support `grow` and `shrink`. The eventlet pool sends its own signals (`eventlet_pool_started`, `eventlet_pool_apply`, `eventlet_pool_preshutdown`, `eventlet_pool_postshutdown`) and waits for all green threads on stop. The gevent pool wraps a task in `gevent.Timeout` when a time limit is set, calling the timeout callback on expiry.

Sources: [celery/concurrency/eventlet.py:88-181](repo://celery/concurrency/eventlet.py#L88-L181), [celery/concurrency/gevent.py:21-39](repo://celery/concurrency/gevent.py#L21-L39), [celery/concurrency/gevent.py:85-171](repo://celery/concurrency/gevent.py#L85-L171)

Green workers cannot run an embedded beat (`-B`): the `Beat` step refuses with "use standalone beat instead".

Sources: [celery/worker/components.py:20-23](repo://celery/worker/components.py#L20-L23), [celery/worker/components.py:184-201](repo://celery/worker/components.py#L184-L201)

## Autoscaling

`--autoscale=max,min` enables the `Autoscaler` step (after `Pool`). The pool starts with `min` slots, and the prefetch count is computed from `max`. The autoscaler compares the number of reserved requests with the current pool size. It grows the pool, up to `max`, as soon as more requests are reserved than there are slots. It shrinks it, down to `min`, only when `AUTOSCALE_KEEPALIVE` seconds (30 by default) have passed since the last scale-up. With the event loop it runs on every received task message and on a repeating timer; otherwise it runs in a background thread once a second. A shrink that finds every process busy is skipped.

Sources: [celery/worker/autoscale.py:28-96](repo://celery/worker/autoscale.py#L28-L96), [celery/worker/autoscale.py:111-154](repo://celery/worker/autoscale.py#L111-L154), [celery/worker/components.py:76-88](repo://celery/worker/components.py#L76-L88)

The `autoscale` remote command calls `update(max, min)`, which resizes immediately if needed and adjusts the consumer's prefetch count to the new maximum. The `pool_grow` and `pool_shrink` commands call the pool directly; [[Remote Control and Inspection]] lists them.

Sources: [celery/worker/autoscale.py:98-138](repo://celery/worker/autoscale.py#L98-L138)
