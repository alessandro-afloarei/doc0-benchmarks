---
title: "Execution Pools"
---
## Overview

The execution pool is where task functions run. The worker's main process receives messages and builds requests ([[Task Requests and Strategies]]), then submits the tracer to the pool with `pool.apply_async`; the pool runs it in a child process, a thread, a green thread or inline, and reports back through callbacks. Celery ships five pools behind one interface, `BasePool`, chosen with `celery worker -P` (or `worker_pool`), and an autoscaler that resizes the pool with the load. Which pool fits depends on whether tasks spend their time on the CPU or waiting on I/O.

Sources: [celery/concurrency/base.py:47-145](repo://celery/concurrency/base.py#L47-L145), [celery/concurrency/__init__.py:11-48](repo://celery/concurrency/__init__.py#L11-L48)

## Choosing a pool

| Pool (`-P`) | Runs tasks in | Choose it for | Limits |
| --- | --- | --- | --- |
| `prefork` (default) | Child processes (billiard) | CPU-bound work; isolation, time limits, `max_tasks_per_child` | Memory per process; children must be forkable |
| `threads` | A `ThreadPoolExecutor` | I/O-bound work that releases the GIL; Windows | No hard time limits; one process, shared memory |
| `eventlet` | Eventlet green threads | Thousands of concurrent I/O-bound tasks | Needs monkey-patching; blocking calls stall all tasks |
| `gevent` | Gevent greenlets | Same as eventlet, with gevent libraries | Same; embedded beat (`-B`) refused |
| `solo` | The worker's main thread, one task at a time | Debugging, or one long task per container | No concurrency; the worker cannot answer control commands while a task runs |
| `custom` | Class named by `CELERY_CUSTOM_WORKER_POOL` | Third-party pools | As implemented |

Sources: [celery/concurrency/__init__.py:11-38](repo://celery/concurrency/__init__.py#L11-L38), [celery/worker/components.py:181-205](repo://celery/worker/components.py#L181-L205)

`get_implementation(name)` resolves an alias to its class with `symbol_by_name`, so a dotted path also works. `threads` is only registered when `concurrent.futures` imports, and `processes` is an old alias for `prefork`.

Sources: [celery/concurrency/__init__.py:11-48](repo://celery/concurrency/__init__.py#L11-L48)

## The pool interface

### BasePool

`BasePool` holds the concurrency `limit`, the put-lock flag and options, and a state of `RUN`, `CLOSE` or `TERMINATE`. Subclasses implement hooks rather than the public methods: `on_start`, `on_stop`, `on_terminate`, `on_close`, and `on_apply`, which receives the target and the callbacks.

Sources: [celery/concurrency/base.py:47-148](repo://celery/concurrency/base.py#L47-L148)

| Attribute | Meaning |
| --- | --- |
| `signal_safe` | The pool can be stopped from inside a signal handler; false for threads and green pools |
| `is_green` | Uses green threads; selects the green pidbox and the sync loop's heartbeats |
| `uses_semaphore` | Wants the worker's put-lock semaphore (prefork) |
| `task_join_will_block` | Calling `result.get()` inside a task would deadlock; true except for green pools |
| `body_can_be_buffer` | The message body may be passed as a buffer without copying |
| `Timer` | Timer class used when the worker has no event loop |

Sources: [celery/concurrency/base.py:49-75](repo://celery/concurrency/base.py#L49-L75)

`apply_async(target, args, kwargs, **options)` logs the call at debug level and passes everything to `on_apply` with `waitforslot=self.putlocks`. `terminate_job`, `restart`, `grow` and `shrink` are optional; the base class raises `NotImplementedError` for the first two, which the worker reports when a control command needs them.

Sources: [celery/concurrency/base.py:84-145](repo://celery/concurrency/base.py#L84-L145)

### apply_target

Pools that run the target in the worker's own process (threads, solo, eventlet, gevent) wrap it in `apply_target`. It calls `accept_callback(pid, monotonic())` first, then the target, then `callback(result)`. Ordinary exceptions propagate (the tracer has already turned task errors into a result), `WorkerShutdown` and `WorkerTerminate` propagate, and any other `BaseException` (such as `SystemExit` from a task) is reported as `WorkerLostError` through the callback.

Sources: [celery/concurrency/base.py:22-44](repo://celery/concurrency/base.py#L22-L44)

## The prefork pool

### Starting child processes

`prefork.TaskPool.on_start` creates the billiard pool: the blocking `billiard.pool.Pool` when the worker runs without an event loop, and Celery's `AsynPool` when it has one. Children run `process_initializer` and report their exit through `process_destructor`, which sends `worker_process_shutdown`. Timeouts are enabled, and `worker_proc_alive_timeout` bounds how long a child may take to report that it is up.

Sources: [celery/concurrency/prefork.py:95-127](repo://celery/concurrency/prefork.py#L95-L127)

`process_initializer` prepares each child: it asks the kernel to kill the child when the parent dies, marks joins as blocking, resets and ignores the signals the parent handles (a child ignores `SIGINT` so Ctrl+C reaches only the main process), sets the process title, initializes the loader, sets up logging (again, when the log file name contains `%i`), installs the tracer optimizations, rebuilds every task's tracer, clears inherited worker state, and sends `worker_process_init`. Database connections and other resources that must not be shared across fork are best opened in a `worker_process_init` handler.

Sources: [celery/concurrency/prefork.py:41-92](repo://celery/concurrency/prefork.py#L41-L92)

### AsynPool

`AsynPool` makes the prefork pool non-blocking. Instead of the threads billiard uses to feed tasks and read results, every child gets its own pair of pipes, and the worker's event loop watches their file descriptors. `register_with_event_loop` installs readers for the result pipes, handlers for process start and exit, time-limit timers, periodic maintenance, and a write scheduler.

Sources: [celery/concurrency/asynpool.py:414-489](repo://celery/concurrency/asynpool.py#L414-L489), [celery/concurrency/asynpool.py:522-547](repo://celery/concurrency/asynpool.py#L522-L547)

Jobs wait in `outbound_buffer` until a child's input pipe is writable. `schedule_writes` walks the writable descriptors round-robin and starts a write coroutine for the next job, so a large message is written in pieces as the pipe drains without blocking the loop. The `-O` option chooses the strategy: `fair` (the default) skips children that are already running a task, so a long task does not queue short ones behind it in a pipe buffer, while `fast`/`fcfs` writes to any writable pipe.

Sources: [celery/concurrency/asynpool.py:77-86](repo://celery/concurrency/asynpool.py#L77-L86), [celery/concurrency/asynpool.py:804-875](repo://celery/concurrency/asynpool.py#L804-L875)

### Time limits and recycling

Time limits are hub timers in `AsynPool`. When a job starts, `on_timeout_set` schedules the soft limit (or the hard limit if there is no soft one). The soft limit raises `SoftTimeLimitExceeded` inside the child, then schedules the hard limit for the remaining time; the hard limit kills the child, and the request records `TimeLimitExceeded` ([[Task Requests and Strategies]]). Finished jobs cancel their timers.

Sources: [celery/concurrency/asynpool.py:549-605](repo://celery/concurrency/asynpool.py#L549-L605)

`--max-tasks-per-child` and `--max-memory-per-child` (in kilobytes) make billiard replace a child after that many tasks or when its resident memory grows past the limit, which contains memory leaks in task code. A child that exits for any reason is noticed through its sentinel descriptor, and `maintain_pool` starts a replacement. Before each new process, `worker_before_create_process` is sent and garbage is collected so the fork copies less.

Sources: [celery/concurrency/asynpool.py:490-520](repo://celery/concurrency/asynpool.py#L490-L520), [celery/worker/components.py:150-168](repo://celery/worker/components.py#L150-L168)

### Stopping

`on_stop` closes the pool and joins it, waiting for running tasks. While it waits, a helper thread keeps firing the hub's timers every half second so broker heartbeats continue and the connection survives a long drain. `on_terminate` kills the children at once. `restart` (the `pool_restart` command) replaces every child, so reloaded modules take effect.

Sources: [celery/concurrency/prefork.py:129-205](repo://celery/concurrency/prefork.py#L129-L205)

## Threads, solo and green pools

### Threads

The thread pool submits `apply_target` to a `ThreadPoolExecutor` with `limit` workers and wraps the future in a small `ApplyResult`. Stopping shuts the executor down and cancels futures not yet started. There is no `terminate_job`, so revoking with `terminate=True` and hard time limits do not apply.

Sources: [celery/concurrency/thread.py:21-64](repo://celery/concurrency/thread.py#L21-L64)

### Solo

The solo pool sets `on_apply = apply_target` and `limit = 1`: the task runs inline in the worker's main thread before the next message is processed. It sends `worker_process_init` once at creation, since there is no child process to do it.

Sources: [celery/concurrency/solo.py:1-31](repo://celery/concurrency/solo.py#L1-L31)

### Eventlet and gevent

Both green pools spawn a green thread per task from a pool of size `limit`, keep a map from green-thread id to green thread so `terminate_job` can kill one, and support `grow` and `shrink`. They set `task_join_will_block = False`, since a green thread can wait on a result without blocking the others. The gevent pool also implements time limits with gevent timeouts, and the eventlet pool sends the `eventlet_pool_*` signals around start, apply and shutdown.

Sources: [celery/concurrency/eventlet.py:88-181](repo://celery/concurrency/eventlet.py#L88-L181), [celery/concurrency/gevent.py:21-40](repo://celery/concurrency/gevent.py#L21-L40), [celery/concurrency/gevent.py:85-171](repo://celery/concurrency/gevent.py#L85-L171)

Green pools only help when the libraries tasks use are patched to yield. `celery/__init__.py` applies `eventlet.monkey_patch()` or `gevent.monkey.patch_all()` when it sees `-P eventlet` or `-P gevent` on the command line, before anything else is imported; that is why the worker warns when these pools are selected through the `worker_pool` setting instead. `EVENTLET_NOBLOCK` turns on eventlet's detector for code that blocks the hub.

Sources: [celery/__init__.py:84-148](repo://celery/__init__.py#L84-L148), [celery/worker/components.py:23-27](repo://celery/worker/components.py#L23-L27)

## Autoscaling

`--autoscale=max,min` adds the `Autoscaler` bootstep. Its target is the number of reserved requests: when that exceeds the current size it grows the pool up to `max`, and when it falls below it shrinks toward `min`, but only after `AUTOSCALE_KEEPALIVE` seconds (30 by default) since the last scale-up, so the pool does not oscillate. A shrink that finds every process busy is skipped.

Sources: [celery/worker/autoscale.py:28-29](repo://celery/worker/autoscale.py#L28-L29), [celery/worker/autoscale.py:61-140](repo://celery/worker/autoscale.py#L61-L140)

With an event loop, scaling is checked on every received task message and on a repeating hub timer; without one, it runs in a background thread once a second. The `autoscale` control command calls `update(max, min)`, which also adjusts the consumer's prefetch count to the new maximum.

Sources: [celery/worker/autoscale.py:31-58](repo://celery/worker/autoscale.py#L31-L58), [celery/worker/autoscale.py:76-110](repo://celery/worker/autoscale.py#L76-L110)
