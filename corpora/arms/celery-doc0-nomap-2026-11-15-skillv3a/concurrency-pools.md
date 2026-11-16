---
title: "Concurrency Pools"
---
## Overview

The execution pool is where task code actually runs. The worker's main process receives messages and keeps bookkeeping; it hands each request to a pool, which runs the tracer in a child process, a thread, a greenlet, or inline, and reports back through callbacks ([[Task Execution and Tracing]]). The choice of pool decides how many tasks run at once, whether CPU-bound tasks run in parallel, whether time limits can be enforced, and how much memory each slot costs.

Sources: [celery/concurrency/base.py:47-71](repo://celery/concurrency/base.py#L47-L71), [celery/worker/request.py:832-853](repo://celery/worker/request.py#L832-L853)

Pools are selected with `-P`/`--pool` (or `worker_pool`) and created by the worker's `Pool` bootstep ([[Worker Startup and Bootsteps]]). `-c`/`--concurrency` sets their size, defaulting to the CPU count.

Sources: [celery/concurrency/__init__.py:11-48](repo://celery/concurrency/__init__.py#L11-L48), [celery/worker/components.py:138-172](repo://celery/worker/components.py#L138-L172)

## Choosing a pool

| Pool (`-P`) | Runs tasks in | Parallel CPU | Time limits | Good for |
| --- | --- | --- | --- | --- |
| `prefork` (default) | Child processes | yes | soft and hard | General use, CPU-bound work, isolation from crashes and leaks |
| `threads` | A `ThreadPoolExecutor` | no (GIL) | no | I/O-bound tasks, platforms without `fork` |
| `solo` | The main process, one at a time | no | no | Debugging, containers that scale by process count |
| `eventlet` | Green threads | no | no | Thousands of concurrent I/O-bound tasks |
| `gevent` | Greenlets | no | hard only | Thousands of concurrent I/O-bound tasks |
| `custom` | `CELERY_CUSTOM_WORKER_POOL` class | depends | depends | Out-of-tree pools |

Sources: [celery/concurrency/__init__.py:11-48](repo://celery/concurrency/__init__.py#L11-L48), [celery/concurrency/thread.py:30-56](repo://celery/concurrency/thread.py#L30-L56), [celery/concurrency/solo.py:11-31](repo://celery/concurrency/solo.py#L11-L31), [celery/concurrency/gevent.py:116-126](repo://celery/concurrency/gevent.py#L116-L126), [celery/concurrency/eventlet.py:123-135](repo://celery/concurrency/eventlet.py#L123-L135)

The green pools set `task_join_will_block = False`, so `AsyncResult.get()` inside a task is allowed there ([[Task Results]]); they also cannot be stopped from a signal handler (`signal_safe = False`), and embedding beat with `-B` is refused.

Sources: [celery/concurrency/gevent.py:85-95](repo://celery/concurrency/gevent.py#L85-L95), [celery/concurrency/eventlet.py:88-98](repo://celery/concurrency/eventlet.py#L88-L98), [celery/worker/components.py:195-205](repo://celery/worker/components.py#L195-L205)

## The pool interface

### BasePool

Every pool subclasses `BasePool`. The worker calls `start()`, `apply_async(target, args, callback=..., accept_callback=..., timeout_callback=..., error_callback=..., timeout=..., soft_timeout=...)`, `close()`, `stop()` (graceful) and `terminate()` (forced); `terminate_job(pid, signal)`, `grow(n)`, `shrink(n)` and `restart()` are optional. `num_processes` and `info` feed prefetch sizing and `inspect stats`.

Sources: [celery/concurrency/base.py:73-180](repo://celery/concurrency/base.py#L73-L180)

### apply_target

The non-process pools all run tasks through `apply_target`: it calls `accept_callback(pid, time)` (which acknowledges early-ack tasks and sends `task-started`), runs the target, and passes the result to `callback`. Ordinary exceptions propagate (the tracer already caught task errors); any other `BaseException` other than worker shutdown is converted to `WorkerLostError` and reported through the callback.

Sources: [celery/concurrency/base.py:22-44](repo://celery/concurrency/base.py#L22-L44)

## Prefork

### Child processes

`prefork.TaskPool` wraps billiard, Celery's fork of `multiprocessing`. With the event loop it uses `AsynPool`; without it, billiard's blocking pool. Each child runs `process_initializer`: it asks the OS to kill it if the parent dies, sets "joining would block", resets signal handlers, sets its process title, initializes the loader and logging, finalizes the app, rebuilds every task's tracer for the child, resets worker state and sends `worker_process_init`. When a child exits, `worker_process_shutdown` is sent from the parent.

Sources: [celery/concurrency/prefork.py:40-92](repo://celery/concurrency/prefork.py#L40-L92), [celery/concurrency/prefork.py:95-126](repo://celery/concurrency/prefork.py#L95-L126)

Children are replaced automatically: after `--max-tasks-per-child` tasks, or after a task leaves the child using more than `--max-memory-per-child` KiB of resident memory (the task completes first). This contains leaks in long-running workers. A child that does not report it is up within `worker_proc_alive_timeout` (4 s by default) is killed and replaced.

Sources: [celery/bin/worker.py:233-248](repo://celery/bin/worker.py#L233-L248), [celery/worker/components.py:154-163](repo://celery/worker/components.py#L154-L163), [celery/concurrency/asynpool.py:447-455](repo://celery/concurrency/asynpool.py#L447-L455)

### AsynPool

`AsynPool` is a non-blocking version of the multiprocessing pool that plugs into the worker's kombu hub, so the main process never blocks on a pipe. It creates one pair of pipes (in-queue and out-queue) per child up front and registers them with the hub: result pipes are readable events that call the result handler, process sentinels trigger `maintain_pool` when a child exits, and time limits become hub timers.

Sources: [celery/concurrency/asynpool.py:1-13](repo://celery/concurrency/asynpool.py#L1-L13), [celery/concurrency/asynpool.py:428-474](repo://celery/concurrency/asynpool.py#L428-L474), [celery/concurrency/asynpool.py:522-547](repo://celery/concurrency/asynpool.py#L522-L547)

Jobs are pickled and appended to `outbound_buffer`. On each poll, `schedule_writes` walks the writable in-queues round-robin and starts a write coroutine for the next job on each, so large arguments are written in pieces without blocking.

Sources: [celery/concurrency/asynpool.py:804-880](repo://celery/concurrency/asynpool.py#L804-L880)

### Scheduling strategy

`-O` chooses how jobs are assigned to children. The default, `fair`, only writes a job to a child that is not already busy, so a long task never has short ones queued behind it in its pipe. `fast` (`fcfs`) writes to any child whose pipe is writable, which keeps every child's pipe full and gives slightly more throughput for uniform short tasks.

Sources: [celery/concurrency/asynpool.py:76-88](repo://celery/concurrency/asynpool.py#L76-L88), [celery/concurrency/asynpool.py:826-831](repo://celery/concurrency/asynpool.py#L826-L831)

### Time limits

When a job is accepted with a soft limit, a hub timer fires `_on_soft_timeout` (which signals the child so `SoftTimeLimitExceeded` is raised in the task) and, if there is also a hard limit, schedules `_on_hard_timeout` for the remaining time, which kills the child; the parent then reports `TimeLimitExceeded`. The pool replaces the killed process.

Sources: [celery/concurrency/asynpool.py:549-605](repo://celery/concurrency/asynpool.py#L549-L605)

### Stopping

`on_stop` closes the pool and joins it, waiting for running tasks. While waiting, a helper thread keeps firing the hub's timers so AMQP heartbeats continue and the broker does not drop the connection during a long warm shutdown. `on_terminate` kills the children.

Sources: [celery/concurrency/prefork.py:142-194](repo://celery/concurrency/prefork.py#L142-L194)

## Threads and solo

The `threads` pool submits each job to a `concurrent.futures.ThreadPoolExecutor` with `concurrency` workers; stopping cancels queued futures. Tasks share the process, so they need to be thread-safe and are limited by the GIL for CPU work.

Sources: [celery/concurrency/thread.py:30-64](repo://celery/concurrency/thread.py#L30-L64)

The `solo` pool runs `apply_target` directly in the main process with a limit of 1, so the consumer is blocked while a task runs (remote control and heartbeats wait too). It sends `worker_process_init` itself, since there are no children.

Sources: [celery/concurrency/solo.py:11-31](repo://celery/concurrency/solo.py#L11-L31)

## Eventlet and gevent

### Monkey patching first

Green pools only work if the standard library's sockets and threading are patched before anything imports them. The `celery` entry point therefore calls `maybe_patch_concurrency()` before loading the app: it scans `argv` for `-P eventlet`/`-P gevent` and applies `eventlet.monkey_patch()` or `gevent.monkey.patch_all()`. Selecting these pools through the `worker_pool` setting instead is too late, and the worker warns about it. `EVENTLET_NOBLOCK` enables eventlet's blocking detector.

Sources: [celery/__init__.py:101-150](repo://celery/__init__.py#L101-L150), [celery/__main__.py:10-15](repo://celery/__main__.py#L10-L15), [celery/worker/components.py:25-29](repo://celery/worker/components.py#L25-L29), [celery/worker/components.py:141-142](repo://celery/worker/components.py#L141-L142)

### Behaviour

Both pools spawn one green thread per task in a pool of size `concurrency`, keep a map from green-thread id to green thread so `terminate_job` can kill one, and wrap the target so a killed task returns quietly. They support `grow`/`shrink` by resizing the pool. The gevent pool enforces the hard time limit with `gevent.Timeout`; the eventlet pool sends `eventlet_pool_started`, `eventlet_pool_apply`, `eventlet_pool_preshutdown` and `eventlet_pool_postshutdown` signals. These pools use the blocking `synloop` consumer loop, and results are drained by a greenlet ([[Result Backends]]).

Sources: [celery/concurrency/gevent.py:28-39](repo://celery/concurrency/gevent.py#L28-L39), [celery/concurrency/gevent.py:97-166](repo://celery/concurrency/gevent.py#L97-L166), [celery/concurrency/eventlet.py:100-181](repo://celery/concurrency/eventlet.py#L100-L181)

## Autoscaling

`--autoscale=max,min` enables the `Autoscaler`. It compares the number of reserved requests with the current pool size: when more tasks are waiting than processes exist it grows the pool up to `max`; when fewer, it shrinks toward `min`, but only after `AUTOSCALE_KEEPALIVE` seconds (30 by default) have passed since the last scale-up, to avoid oscillating. Shrinking fails quietly when all processes are busy. With the event loop it runs on every task message and on a hub timer; otherwise in a background thread once a second.

Sources: [celery/worker/autoscale.py:28](repo://celery/worker/autoscale.py#L28), [celery/worker/autoscale.py:31-58](repo://celery/worker/autoscale.py#L31-L58), [celery/worker/autoscale.py:61-154](repo://celery/worker/autoscale.py#L61-L154)

The prefetch count follows the pool size: the initial prefetch is `max × prefetch_multiplier`, and the `autoscale` control command adjusts it when `max` changes. The `pool_grow` and `pool_shrink` control commands resize a pool by hand ([[Remote Control and Inspection]]).

Sources: [celery/worker/components.py:227-230](repo://celery/worker/components.py#L227-L230), [celery/worker/autoscale.py:98-138](repo://celery/worker/autoscale.py#L98-L138)
