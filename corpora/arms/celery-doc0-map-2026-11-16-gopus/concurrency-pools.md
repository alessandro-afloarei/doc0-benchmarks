---
title: "Concurrency Pools"
---
## Overview

The execution pool is where task code actually runs. The consumer accepts messages in the worker's main process and hands each `Request` to `pool.apply_async(...)` with the tracer function and callbacks ([[Task Execution Pipeline]]); the pool runs the tracer in a child process, a thread, a greenlet or inline, and calls back when the job is accepted, finishes, fails or times out. Pools are chosen with `-P`/`--pool` (default `prefork`) and sized with `-c`/`--concurrency` (default: the number of CPUs).

Sources: [celery/concurrency/base.py:47-160](repo://celery/concurrency/base.py#L47-L160), [celery/bin/worker.py:194-211](repo://celery/bin/worker.py#L194-L211), [celery/worker/worker.py:105-111](repo://celery/worker/worker.py#L105-L111)

The worker's `Pool` bootstep creates the pool with the concurrency, time limits, per-child limits and a semaphore when the event loop is used ([[Worker Startup and Bootsteps]]).

Sources: [celery/worker/components.py:101-176](repo://celery/worker/components.py#L101-L176)

## Choosing a pool

`celery.concurrency.get_implementation(name)` resolves the name through `ALIASES`:

Sources: [celery/concurrency/__init__.py:41-43](repo://celery/concurrency/__init__.py#L41-L43)

| Name | Class | Runs tasks in |
| --- | --- | --- |
| `prefork` (`processes`) | `celery.concurrency.prefork:TaskPool` | Child processes (billiard) |
| `threads` | `celery.concurrency.thread:TaskPool` | A `ThreadPoolExecutor` |
| `solo` | `celery.concurrency.solo:TaskPool` | The worker's own thread, one at a time |
| `eventlet` | `celery.concurrency.eventlet:TaskPool` | Eventlet green threads |
| `gevent` | `celery.concurrency.gevent:TaskPool` | Gevent greenlets |
| `custom` | from `CELERY_CUSTOM_WORKER_POOL` | An out-of-tree `BasePool` subclass |

Sources: [celery/concurrency/__init__.py:11-48](repo://celery/concurrency/__init__.py#L11-L48)

Green pools need their libraries' monkey patches applied before anything imports sockets or threads. The `celery` entry point therefore calls `maybe_patch_concurrency()` before importing the CLI, which looks for `-P`/`--pool` in `sys.argv` and runs the eventlet or gevent patcher. For the same reason the `Pool` step warns when `worker_pool` in the configuration names a green pool: "you *must use the -P* argument so that patches are applied as early as possible". The eventlet module warns at import if Celery, Kombu or billiard modules using threads or sockets were already loaded.

Sources: [celery/__main__.py:1-18](repo://celery/__main__.py#L1-L18), [celery/__init__.py:123-153](repo://celery/__init__.py#L123-L153), [celery/worker/components.py:20-25](repo://celery/worker/components.py#L20-L25), [celery/concurrency/eventlet.py:12-26](repo://celery/concurrency/eventlet.py#L12-L26)

The pools differ in what the rest of the worker can do with them:

Sources: [celery/concurrency/base.py:52-70](repo://celery/concurrency/base.py#L52-L70)

| Pool | Time limits | Terminate a job | Grow/shrink | `get()` inside tasks | Signal-safe |
| --- | --- | --- | --- | --- | --- |
| prefork | soft and hard | yes (signal to the child) | yes | refused | yes |
| threads | no | no | no | refused | no |
| solo | no | no | no | refused | yes |
| eventlet | no | kill the green thread | yes | allowed | no |
| gevent | hard only, as `gevent.Timeout` | kill the greenlet | yes | allowed | no |

Sources: [celery/concurrency/base.py:52-70](repo://celery/concurrency/base.py#L52-L70), [celery/concurrency/prefork.py:95-130](repo://celery/concurrency/prefork.py#L95-L130), [celery/concurrency/thread.py:30-58](repo://celery/concurrency/thread.py#L30-L58), [celery/concurrency/solo.py:11-30](repo://celery/concurrency/solo.py#L11-L30), [celery/concurrency/eventlet.py:88-140](repo://celery/concurrency/eventlet.py#L88-L140), [celery/concurrency/gevent.py:28-40](repo://celery/concurrency/gevent.py#L28-L40), [celery/concurrency/gevent.py:85-140](repo://celery/concurrency/gevent.py#L85-L140)

Embedded beat (`-B`) is refused with the eventlet and gevent pools ("use standalone beat instead"), and green pools make the consumer use the blocking `synloop` with AMQP heartbeats on the timer ([[The Consumer]]).

Sources: [celery/worker/components.py:16-19](repo://celery/worker/components.py#L16-L19), [celery/worker/components.py:181-205](repo://celery/worker/components.py#L181-L205), [celery/worker/loops.py:138-148](repo://celery/worker/loops.py#L138-L148)

## The BasePool interface

`BasePool(limit, putlocks=True, forking_enable=True, callbacks_propagate=(), app=None, **options)` defines the life cycle `start()` / `stop()` / `terminate()` / `close()` with hooks `on_start`, `on_stop`, `on_terminate`, `on_close`, and `apply_async(target, args, kwargs, **options)`, which forwards to the subclass's `on_apply` with `waitforslot=putlocks`. Optional operations (`terminate_job`, `restart`) raise `NotImplementedError` unless implemented, and `info` reports the implementation and `max-concurrency`.

Sources: [celery/concurrency/base.py:47-110](repo://celery/concurrency/base.py#L47-L110), [celery/concurrency/base.py:110-180](repo://celery/concurrency/base.py#L110-L180)

Class attributes tell the worker how to treat the pool: `Timer` (the timer class used when there is no event loop), `signal_safe` (whether shutdown may run inside a signal handler), `is_green`, `uses_semaphore` (only prefork), `task_join_will_block` (whether `AsyncResult.get()` inside a task is forbidden; see [[Task States and AsyncResult]]), and `body_can_be_buffer`.

Sources: [celery/concurrency/base.py:52-71](repo://celery/concurrency/base.py#L52-L71)

The in-process pools share `apply_target`, which calls `accept_callback(pid, monotonic())`, runs the target, and passes the return value to `callback`. A `BaseException` that is not `WorkerShutdown` or `WorkerTerminate` (for example `KeyboardInterrupt` in a thread) is converted into a `WorkerLostError` delivered through `callback` as failure info.

Sources: [celery/concurrency/base.py:22-44](repo://celery/concurrency/base.py#L22-L44)

## Prefork

`prefork.TaskPool.on_start` creates billiard's pool with `process_initializer` and `process_destructor`, timeouts enabled, and `worker_proc_alive_timeout`. It uses `AsynPool`, the non-blocking pool, when the worker runs an event loop, and billiard's blocking `Pool` with its own threads otherwise. The pool's `apply_async`, `maintain_pool`, `terminate_job`, `grow`, `shrink` and `flush` become the task pool's methods.

Sources: [celery/concurrency/prefork.py:95-130](repo://celery/concurrency/prefork.py#L95-L130), [celery/worker/components.py:139-158](repo://celery/worker/components.py#L139-L158)

`process_initializer(app, hostname)` prepares each child: it asks the OS to send `SIGKILL` to the child when the parent dies, forbids joining results, resets `SIGTERM`, `SIGHUP`, `SIGTTIN`, `SIGTTOU` and `SIGUSR1` and ignores `SIGINT`, sets the process title, runs the loader's worker and worker-process init hooks, sets up logging from the `CELERY_LOG_*` environment variables, makes the app current and default and finalizes it, rebuilds every task's tracer, resets the worker state copied from the parent, and sends `worker_process_init`. `process_destructor` sends `worker_process_shutdown` with the pid and exit code.

Sources: [celery/concurrency/prefork.py:23-92](repo://celery/concurrency/prefork.py#L23-L92)

A graceful stop closes the pool and joins it; while joining, a helper thread keeps firing the hub's timers every half second so heartbeats continue on asynchronous transports while running tasks finish. `terminate` kills the processes. `info` adds the child pids, `max-tasks-per-child`, whether puts are guarded by the semaphore, the timeouts, and write statistics.

Sources: [celery/concurrency/prefork.py:141-216](repo://celery/concurrency/prefork.py#L141-L216)

## AsynPool

`AsynPool` is "a non-blocking version of multiprocessing.Pool" that runs inside the worker's event loop without helper threads. Its module docstring names its three problems: starting and keeping child processes running, sending jobs and receiving results, and shutting down safely. It creates a set of non-blocking pipes per process in advance and keeps maps from file descriptor to process for input, output and sync queues, plus the set of busy workers and an outbound buffer of jobs waiting to be written.

Sources: [celery/concurrency/asynpool.py:1-12](repo://celery/concurrency/asynpool.py#L1-L12), [celery/concurrency/asynpool.py:414-488](repo://celery/concurrency/asynpool.py#L414-L488)

`register_with_event_loop(hub)` connects it to the hub: the result handler reads results whenever an output pipe is readable, each child's sentinel fd is watched so an exiting process triggers `maintain_pool()`, time-limit handlers are created, periodic maintenance timers are added, and `on_poll_start` runs on every tick. That function registers idle input pipes for writing when jobs are waiting. With the default `fair` scheduling strategy (`-O fair`), it does so only while some workers are not busy, so a job is written only to a process that can start it; `fcfs` (also `fast`) writes whenever there is data, which may queue jobs behind a busy process.

Sources: [celery/concurrency/asynpool.py:77-87](repo://celery/concurrency/asynpool.py#L77-L87), [celery/concurrency/asynpool.py:522-547](repo://celery/concurrency/asynpool.py#L522-L547), [celery/concurrency/asynpool.py:760-788](repo://celery/concurrency/asynpool.py#L760-L788), [celery/bin/worker.py:169-175](repo://celery/bin/worker.py#L169-L175)

A child must report `WORKER_UP` within `PROC_ALIVE_TIMEOUT` (4 seconds, or `worker_proc_alive_timeout`), otherwise it is terminated and replaced; on first start the consumer refuses to run if processes did not come up ([[The Consumer]]). Before creating a process the pool sends `worker_before_create_process` and runs the garbage collector (issue #2927).

Sources: [celery/concurrency/asynpool.py:70-75](repo://celery/concurrency/asynpool.py#L70-L75), [celery/concurrency/asynpool.py:456-494](repo://celery/concurrency/asynpool.py#L456-L494)

Time limits are timers on the hub: when a job starts, the soft limit is scheduled; when it passes, the pool signals the child (raising `SoftTimeLimitExceeded` in the task) and schedules the hard limit for the remaining time, at which point the job is killed and the request's `on_timeout` runs ([[Retries, Failures and Time Limits]]).

Sources: [celery/concurrency/asynpool.py:549-605](repo://celery/concurrency/asynpool.py#L549-L605)

`flush()`, called when the broker connection is lost, clears the outbound buffer, discards jobs whose writes had not started, finishes writes already in progress to keep message boundaries intact, completes pending acknowledgements so children do not hang, and keeps only the workers still running accepted jobs marked busy, so the fair scheduler keeps avoiding them after reconnecting.

Sources: [celery/concurrency/asynpool.py:999-1114](repo://celery/concurrency/asynpool.py#L999-L1114)

`--max-tasks-per-child` and `--max-memory-per-child` are passed to the billiard pool as `maxtasksperchild` and `max_memory_per_child`, its limits on how many tasks, and how much memory, a child may use before it is replaced.

Sources: [celery/worker/components.py:145-149](repo://celery/worker/components.py#L145-L149), [celery/bin/worker.py:233-248](repo://celery/bin/worker.py#L233-L248)

## Solo and threads

The solo pool, "blocking, inline, fast", sets its limit to 1, uses `apply_target` directly as `on_apply`, and sends `worker_process_init` at construction. A task blocks the consumer while it runs, so the worker cannot process remote control commands or other messages until it returns.

Sources: [celery/concurrency/solo.py:1-30](repo://celery/concurrency/solo.py#L1-L30)

The threads pool submits `apply_target` to a `ThreadPoolExecutor` with `limit` workers and returns an `ApplyResult` wrapping the future; stopping shuts the executor down with `cancel_futures=True`. It is not signal-safe and implements no time limits or job termination.

Sources: [celery/concurrency/thread.py:21-64](repo://celery/concurrency/thread.py#L21-L64)

## Eventlet and gevent

Both green pools spawn each job into a pool of green threads of size `limit`, keep a map from greenlet id to greenlet so `terminate_job` can kill one (used by revoke with `terminate`), wrap targets so a killed greenlet returns an empty result instead of raising `GreenletExit`, and use a green `Timer`. They support `grow` and `shrink` for autoscaling and remote control, set `task_join_will_block = False`, and are not signal-safe. The eventlet pool sends its own `eventlet_pool_started`, `eventlet_pool_apply`, `eventlet_pool_preshutdown` and `eventlet_pool_postshutdown` signals; the gevent pool enforces the hard time limit by running the job inside `gevent.Timeout` and calling the timeout callback when it fires.

Sources: [celery/concurrency/eventlet.py:88-181](repo://celery/concurrency/eventlet.py#L88-L181), [celery/concurrency/gevent.py:21-40](repo://celery/concurrency/gevent.py#L21-L40), [celery/concurrency/gevent.py:85-171](repo://celery/concurrency/gevent.py#L85-L171)

## Autoscaling

With `--autoscale=max,min`, the `Autoscaler` adjusts the pool between the two sizes based on demand, measured as the number of reserved requests (`len(state.reserved_requests)`). `_maybe_scale` grows the pool to `min(qty, max)` when there are more requests than processes and shrinks it towards `max(qty, min)` otherwise, then calls `maintain_pool()`. Scaling down happens only when the last scale-up was more than `keepalive` seconds ago (30 by default, from `AUTOSCALE_KEEPALIVE`), so the pool does not oscillate; a pool whose processes are all busy refuses to shrink.

Sources: [celery/worker/autoscale.py:28-28](repo://celery/worker/autoscale.py#L28-L28), [celery/worker/autoscale.py:60-154](repo://celery/worker/autoscale.py#L60-L154)

Without the event loop the autoscaler is a background thread checking every second. With it, the `Autoscaler` bootstep registers `maybe_scale` as an `on_task_message` callback and as a repeating hub timer instead. `update(max, min)`, used by the `autoscale` remote-control command, resizes immediately and adjusts the consumer's prefetch count when the maximum changes ([[Remote Control and Revocation]]).

Sources: [celery/worker/autoscale.py:31-54](repo://celery/worker/autoscale.py#L31-L54), [celery/worker/autoscale.py:76-107](repo://celery/worker/autoscale.py#L76-L107), [celery/worker/autoscale.py:128-133](repo://celery/worker/autoscale.py#L128-L133)
