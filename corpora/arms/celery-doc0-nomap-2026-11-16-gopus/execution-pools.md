---
title: "Execution Pools"
---
## Overview

The execution pool is where task code actually runs. The worker hands each request to `pool.apply_async(trace, args, callbacks...)` ([[Task Execution Pipeline]]) and the pool decides how: in forked child processes (prefork, the default), in threads, in green threads (eventlet, gevent), or inline in the worker itself (solo). All pools implement the `BasePool` interface, are chosen by name with `-P/--pool`, and are created by the worker's `Pool` bootstep ([[Worker Startup and Bootsteps]]). This page describes the shared interface, each pool, and the autoscaler that resizes a pool at run time.

Sources: [celery/concurrency/__init__.py:11-48](repo://celery/concurrency/__init__.py#L11-L48), [celery/concurrency/base.py:47-75](repo://celery/concurrency/base.py#L47-L75)

## Choosing a pool

| Name | Class | Runs tasks in | Concurrency | Green | Signal safe |
| --- | --- | --- | --- | --- | --- |
| `prefork` (`processes`) | `prefork.TaskPool` | Forked child processes via `AsynPool` | `-c`, default CPU count | no | yes |
| `threads` | `thread.TaskPool` | `ThreadPoolExecutor` threads | `-c` | no | no |
| `solo` | `solo.TaskPool` | The worker's own thread, one at a time | 1 | no | yes |
| `eventlet` | `eventlet.TaskPool` | Eventlet green threads | `-c` (often hundreds) | yes | no |
| `gevent` | `gevent.TaskPool` | Gevent greenlets | `-c` | yes | no |
| `custom` | `CELERY_CUSTOM_WORKER_POOL` | Whatever the named class does | | | |

Sources: [celery/concurrency/__init__.py:11-38](repo://celery/concurrency/__init__.py#L11-L38), [celery/concurrency/thread.py:28-37](repo://celery/concurrency/thread.py#L28-L37), [celery/concurrency/solo.py:9-17](repo://celery/concurrency/solo.py#L9-L17), [celery/concurrency/eventlet.py:88-96](repo://celery/concurrency/eventlet.py#L88-L96), [celery/concurrency/gevent.py:85-95](repo://celery/concurrency/gevent.py#L85-L95)

`get_implementation(name)` resolves the alias or any `module:Class` path. The eventlet and gevent pools need monkey patching before anything else is imported, so the `celery` entry point calls `maybe_patch_concurrency`, which finds `-P`/`--pool` in `argv`, patches, and imports the pool module early. The eventlet module warns at import time when Celery, Kombu or billiard modules that use threads or sockets were imported before patching.

Sources: [celery/concurrency/__init__.py:41-48](repo://celery/concurrency/__init__.py#L41-L48), [celery/__init__.py:105-148](repo://celery/__init__.py#L105-L148), [celery/concurrency/eventlet.py:11-27](repo://celery/concurrency/eventlet.py#L11-L27)

## The BasePool interface

`BasePool(limit, putlocks, forking_enable, callbacks_propagate, app, **options)` keeps the concurrency limit and options. `start()`, `stop()`, `terminate()` and `close()` move between the `RUN`, `CLOSE` and `TERMINATE` states and call the `on_start`, `on_stop`, `on_terminate` and `on_close` hooks. `apply_async(target, args, kwargs, **options)` logs the call and delegates to `on_apply` with `waitforslot=putlocks`. `terminate_job` and `restart` raise `NotImplementedError` unless a pool supports them.

Sources: [celery/concurrency/base.py:75-152](repo://celery/concurrency/base.py#L75-L152)

The class attributes describe the pool to the rest of the worker:

Sources: [celery/concurrency/base.py:47-71](repo://celery/concurrency/base.py#L47-L71)

| Attribute | Default | Used for |
| --- | --- | --- |
| `Timer` | `timer2.Timer` | Timer class when the worker has no event loop |
| `signal_safe` | `True` | Whether shutdown may run inside a signal handler |
| `is_green` | `False` | Selects the green pidbox, heartbeats in `synloop` |
| `uses_semaphore` | `False` | Whether the worker may guard `apply_async` with a semaphore |
| `task_join_will_block` | `True` | Sets the synchronous-subtask guard ([[Task Results and States]]) |
| `body_can_be_buffer` | `False` | Whether the message body may be passed as a buffer |

Sources: [celery/concurrency/base.py:47-71](repo://celery/concurrency/base.py#L47-L71), [celery/worker/worker.py:244-259](repo://celery/worker/worker.py#L244-L259)

`apply_target` is the function the in-process pools run. It calls the accept callback with the pid and a monotonic timestamp, runs the target, and passes the return value to the callback. Ordinary exceptions and the worker shutdown exceptions propagate; any other `BaseException` is wrapped in `WorkerLostError` and given to the callback as exception info.

Sources: [celery/concurrency/base.py:22-44](repo://celery/concurrency/base.py#L22-L44)

`info` reports the implementation name and maximum concurrency, extended by each pool, and is what `celery inspect stats` shows under `pool`.

Sources: [celery/concurrency/base.py:154-180](repo://celery/concurrency/base.py#L154-L180)

## Prefork

### The task pool

`prefork.TaskPool` wraps billiard's process pool. `on_start` creates an `AsynPool` when the worker runs the event loop, or billiard's `BlockingPool` when it uses threads, with `process_initializer` and `process_destructor`, timeouts enabled, and `worker_proc_alive_timeout`. It then exposes the pool's `apply_async`, `maintain_pool`, `terminate_job`, `grow`, `shrink` and `flush` directly. `uses_semaphore` is true, so the worker can limit queued jobs to free processes.

Sources: [celery/concurrency/prefork.py:95-127](repo://celery/concurrency/prefork.py#L95-L127)

`on_stop` closes the pool and joins it. With an event loop it runs a helper thread firing hub timers every half second meanwhile, so broker heartbeats keep going while running tasks finish. `on_terminate` kills the pool, and `info` adds the child pids, `max-tasks-per-child`, timeouts and write statistics.

Sources: [celery/concurrency/prefork.py:142-216](repo://celery/concurrency/prefork.py#L142-L216)

### Child process setup

`process_initializer(app, hostname)` runs in each child. It asks the OS to kill the child when the parent dies, turns the synchronous-subtask guard on, resets `SIGTERM`, `SIGHUP` and related signals and ignores `SIGINT` (and `SIGTERM` when billiard remaps it), sets the process title, and initializes the loader. It sets up logging from the `CELERY_LOG_*` environment variables, makes the app current and default, rebuilds every task's tracer, resets worker state, and sends `worker_process_init`. When billiard re-executed the child (`FORKED_BY_MULTIPROCESSING`), it runs the full worker optimizations instead.

Sources: [celery/concurrency/prefork.py:27-81](repo://celery/concurrency/prefork.py#L27-L81)

`process_destructor(pid, exitcode)` sends `worker_process_shutdown` when a child exits.

Sources: [celery/concurrency/prefork.py:84-92](repo://celery/concurrency/prefork.py#L84-L92)

### AsynPool

`AsynPool` is a non-blocking version of `multiprocessing.Pool` whose module docstring names its three problems: starting and keeping child processes running, sending jobs and receiving results, and shutting down safely. Each process gets a pre-created pair of pipes, an in-queue the parent writes jobs to without blocking and an out-queue it reads results from without blocking, plus an optional sync-ack queue.

Sources: [celery/concurrency/asynpool.py:1-14](repo://celery/concurrency/asynpool.py#L1-L14), [celery/concurrency/asynpool.py:428-488](repo://celery/concurrency/asynpool.py#L428-L488), [celery/concurrency/asynpool.py:1153-1169](repo://celery/concurrency/asynpool.py#L1153-L1169)

`register_with_event_loop(hub)` connects it to the worker's hub: the result handler reads out-queues when readable, time-limit and process up/down handlers are installed, write handlers schedule jobs onto writable in-queues, each child's sentinel is watched so a dead process triggers `maintain_pool`, and maintenance timers run repeatedly. `on_poll_start` is added to the hub only once, so a consumer restart does not register it twice.

Sources: [celery/concurrency/asynpool.py:522-547](repo://celery/concurrency/asynpool.py#L522-L547), [celery/concurrency/asynpool.py:495-520](repo://celery/concurrency/asynpool.py#L495-L520)

Jobs wait in `outbound_buffer` until a process's in-queue is writable. `schedule_writes` cycles through writable descriptors by a running count (the comment says about 30% faster than shuffling, and fairer); with the `fair` scheduling strategy (the default, `-O fair`) it skips processes that are already busy, so a long task does not have short ones queued behind it in its pipe, while `fast`/`fcfs` writes to any writable process.

Sources: [celery/concurrency/asynpool.py:75-85](repo://celery/concurrency/asynpool.py#L75-L85), [celery/concurrency/asynpool.py:716-743](repo://celery/concurrency/asynpool.py#L716-L743), [celery/concurrency/asynpool.py:804-830](repo://celery/concurrency/asynpool.py#L804-L830)

A child that does not report `WORKER_UP` within the alive timeout (4 seconds by default) is terminated so a new one can start. Before creating each process the pool sends `worker_before_create_process` and runs a garbage collection (Issue #2927).

Sources: [celery/concurrency/asynpool.py:440-454](repo://celery/concurrency/asynpool.py#L440-L454), [celery/concurrency/asynpool.py:490-493](repo://celery/concurrency/asynpool.py#L490-L493)

## Threads and solo

The `threads` pool submits `apply_target` to a `ThreadPoolExecutor` sized by the concurrency, returns an object whose `get` waits on the future, and cancels pending futures on stop. It is not signal safe, so shutdown from a signal handler is deferred.

Sources: [celery/concurrency/thread.py:20-64](repo://celery/concurrency/thread.py#L20-L64)

The `solo` pool sets its limit to 1 and uses `apply_target` directly as `on_apply`, so each task runs inline in the worker process and the worker does not receive the next message until it returns. It sends `worker_process_init` itself because there are no child processes.

Sources: [celery/concurrency/solo.py:9-31](repo://celery/concurrency/solo.py#L9-L31)

## Eventlet and gevent

Both green pools spawn one green thread per task in a pool of `limit` slots, use a timer built on their scheduler, report themselves `is_green` with `task_join_will_block = False`, and are not signal safe. The pid passed to callbacks is the id of the current green thread, and each green thread is recorded in a map so `terminate_job` can kill it; targets are wrapped so `GreenletExit` returns an empty result instead of an error. `grow` and `shrink` resize the pool, which is what the autoscaler uses.

Sources: [celery/concurrency/eventlet.py:88-181](repo://celery/concurrency/eventlet.py#L88-L181), [celery/concurrency/gevent.py:85-171](repo://celery/concurrency/gevent.py#L85-L171)

Eventlet sends the `eventlet_pool_started`, `eventlet_pool_apply`, `eventlet_pool_preshutdown` and `eventlet_pool_postshutdown` signals and waits for all green threads on stop. Gevent enforces the hard time limit itself: with a timeout, each task runs inside `gevent.Timeout` and an expiry calls the timeout callback ([[Signals]]).

Sources: [celery/concurrency/eventlet.py:110-137](repo://celery/concurrency/eventlet.py#L110-L137), [celery/concurrency/gevent.py:28-40](repo://celery/concurrency/gevent.py#L28-L40), [celery/concurrency/gevent.py:116-125](repo://celery/concurrency/gevent.py#L116-L125)

A green pool cannot be combined with `-B`: the embedded beat step refuses eventlet and gevent ([[Periodic Tasks with Beat]]).

Sources: [celery/worker/components.py:195-206](repo://celery/worker/components.py#L195-L206)

## Autoscaling

`--autoscale max,min` enables the `Autoscaler` bootstep, which requires the pool step. In event-loop mode it runs `maybe_scale` after every task message and every `AUTOSCALE_KEEPALIVE` seconds (30 by default) on the hub; otherwise it runs as a background thread checking once a second.

Sources: [celery/worker/autoscale.py:28-59](repo://celery/worker/autoscale.py#L28-L59), [celery/worker/autoscale.py:61-81](repo://celery/worker/autoscale.py#L61-L81)

The target is the number of reserved requests. When it exceeds the current process count, the pool grows towards it, up to `max`. When it drops below, the pool shrinks towards it (never below `min`), but only once `keepalive` seconds have passed since the last scale-up, so the pool does not flap. A shrink that fails because every process is busy is logged at debug level and retried later. After a change it calls `pool.maintain_pool()`.

Sources: [celery/worker/autoscale.py:83-131](repo://celery/worker/autoscale.py#L83-L131), [celery/worker/autoscale.py:148-154](repo://celery/worker/autoscale.py#L148-L154)

`update(max, min)` changes the limits at run time (the `autoscale` remote command), shrinking or growing immediately when the new limits require it and adjusting the consumer's prefetch count by the change in `max`.

Sources: [celery/worker/autoscale.py:98-138](repo://celery/worker/autoscale.py#L98-L138)
