---
title: "Concurrency Pools"
---
## Overview

The execution pool is where task functions run. The consumer decides *what* to run; the pool decides *where*: in forked child processes, in threads, in greenlets, or inline in the worker's own thread. Every pool implements the small `BasePool` interface, so the rest of the worker only calls `apply_async` with the trace function and a set of callbacks, and reacts when they fire. Pools are chosen with `celery worker -P <name>` (or `worker_pool`) and created by the worker's `Pool` bootstep.

Sources: [celery/concurrency/base.py:47-80](repo://celery/concurrency/base.py#L47-L80), [celery/worker/components.py:138-172](repo://celery/worker/components.py#L138-L172)

This page describes the interface and each pool. How the prefork pool exchanges work with its children without blocking the event loop is on [[The Prefork Pool Internals]].

Sources: [celery/concurrency/prefork.py:95-99](repo://celery/concurrency/prefork.py#L95-L99)

## Choosing a pool

| Name | Class | Runs tasks in | Notes |
| --- | --- | --- | --- |
| `prefork` (default) | `celery.concurrency.prefork:TaskPool` | Child processes (billiard) | Time limits, process recycling, autoscale |
| `threads` | `celery.concurrency.thread:TaskPool` | `ThreadPoolExecutor` | Not signal-safe |
| `solo` | `celery.concurrency.solo:TaskPool` | The worker thread itself | One task at a time |
| `eventlet` | `celery.concurrency.eventlet:TaskPool` | Eventlet green threads | Requires `-P` for early patching |
| `gevent` | `celery.concurrency.gevent:TaskPool` | Gevent greenlets | Requires `-P` for early patching |
| `custom` | from `CELERY_CUSTOM_WORKER_POOL` | Out-of-tree pool | `package:Class` of a `BasePool` |

Sources: [celery/concurrency/__init__.py:11-47](repo://celery/concurrency/__init__.py#L11-L47), [celery/app/defaults.py:11](repo://celery/app/defaults.py#L11)

`get_implementation(name)` resolves an alias or a dotted path. `processes` is kept as a compatibility alias for `prefork`, and `threads` is only registered when `concurrent.futures` is importable.

Sources: [celery/concurrency/__init__.py:11-47](repo://celery/concurrency/__init__.py#L11-L47)

The eventlet and gevent pools must be selected on the command line: `maybe_patch_concurrency` reads `-P`/`--pool` from `argv` before anything else is imported and monkey-patches the process. Setting `worker_pool` to a green pool only logs a warning, because by then it is too late to patch. The eventlet module also warns at import if Celery, kombu or billiard modules that use threads or sockets were imported before patching.

Sources: [celery/__init__.py:105-146](repo://celery/__init__.py#L105-L146), [celery/worker/components.py:25-29](repo://celery/worker/components.py#L25-L29), [celery/concurrency/eventlet.py:14-26](repo://celery/concurrency/eventlet.py#L14-L26)

## The BasePool interface

### Lifecycle and flags

`BasePool` stores the concurrency `limit`, `putlocks` and the remaining options, and moves between `RUN`, `CLOSE` and `TERMINATE`. `start`, `stop`, `close` and `terminate` call the hooks `on_start`, `on_stop`, `on_close` and `on_terminate`. A pool also offers `did_start_ok`, `flush`, `register_with_event_loop`, `maintain_pool`, `terminate_job(pid, signal)` and `restart` (the last two raise `NotImplementedError` by default), and reports `info` and `num_processes`.

Sources: [celery/concurrency/base.py:47-138](repo://celery/concurrency/base.py#L47-L138), [celery/concurrency/base.py:158-180](repo://celery/concurrency/base.py#L158-L180)

| Flag | Default | Meaning |
| --- | --- | --- |
| `signal_safe` | `True` | The worker may stop the pool from inside a signal handler |
| `is_green` | `False` | Uses greenlets; the consumer uses `synloop` and a green pidbox |
| `uses_semaphore` | `False` | Supports the worker's put-lock semaphore |
| `task_join_will_block` | `True` | Waiting on a result inside a task would block the pool |
| `body_can_be_buffer` | `False` | The message body can be passed as a buffer |
| `Timer` | `timer2.Timer` | Timer class for workers without the event loop |

Sources: [celery/concurrency/base.py:50-71](repo://celery/concurrency/base.py#L50-L71)

### apply_async

`apply_async(target, args, kwargs, **options)` logs the call at DEBUG and forwards to `on_apply` with `waitforslot=putlocks`. The worker passes `accept_callback`, `callback`, `error_callback`, `timeout_callback`, the soft and hard timeouts and the task id as `correlation_id`; see [[Task Requests and Strategies]].

Sources: [celery/concurrency/base.py:140-156](repo://celery/concurrency/base.py#L140-L156), [celery/worker/request.py:356-370](repo://celery/worker/request.py#L356-L370)

The in-process pools run the target through `apply_target`: it calls `accept_callback(pid, monotonic())`, runs the target, and passes the return value to `callback`. Ordinary exceptions propagate (the trace function already catches task errors). `WorkerShutdown` and `WorkerTerminate` propagate too. Any other `BaseException` is converted to `WorkerLostError` and reported to `callback` as an `ExceptionInfo`.

Sources: [celery/concurrency/base.py:22-44](repo://celery/concurrency/base.py#L22-L44)

## Prefork

The prefork `TaskPool` wraps billiard. In `on_start` it creates an `AsynPool` when the worker runs the event loop, and billiard's blocking `Pool` in threaded mode, with `process_initializer` and `process_destructor`, timeouts enabled and `worker_proc_alive_timeout`. It then exposes the pool's `apply_async`, `maintain_pool`, `terminate_job`, `grow`, `shrink` and `flush` as its own methods. It is the only built-in pool with `uses_semaphore = True`.

Sources: [celery/concurrency/prefork.py:95-133](repo://celery/concurrency/prefork.py#L95-L133)

`process_initializer` runs in every child. It asks the OS to `SIGKILL` the child when the parent dies, resets `SIGTERM`, `SIGHUP`, `SIGTTIN`, `SIGTTOU` and `SIGUSR1` to defaults and ignores `SIGINT` (and `SIGTERM` when remapped), sets the process title, runs the loader's worker and worker-process hooks, sets up logging from `CELERY_LOG_*` environment variables, makes the app current and finalized, rebuilds the tracer of every task, resets the worker state and sends `worker_process_init`. `process_destructor` sends `worker_process_shutdown` when a child exits.

Sources: [celery/concurrency/prefork.py:26-92](repo://celery/concurrency/prefork.py#L26-L92)

`on_stop` closes the pool and joins it. While joining, a daemon thread keeps firing the hub's timers every 0.5 s so heartbeats on asynchronous transports continue while children drain. `info` reports the child pids, `max-tasks-per-child`, whether puts are guarded by the semaphore, the timeouts and write statistics.

Sources: [celery/concurrency/prefork.py:142-216](repo://celery/concurrency/prefork.py#L142-L216)

Only prefork enforces both time limits by killing processes and supports `max_tasks_per_child` and `max_memory_per_child`; see [[The Prefork Pool Internals]].

Sources: [celery/worker/components.py:155-172](repo://celery/worker/components.py#L155-L172)

## Solo

The solo pool runs `apply_target` directly: `on_apply` is `apply_target` and the limit is fixed at 1, so the consumer blocks while a task runs. It sends `worker_process_init` when created, since there is no child process to send it.

Sources: [celery/concurrency/solo.py:11-31](repo://celery/concurrency/solo.py#L11-L31)

## Threads

The threads pool submits `apply_target` to a `ThreadPoolExecutor` with `limit` workers and returns a small `ApplyResult` around the future. Stopping shuts the executor down and cancels queued futures. It is not signal-safe, so the worker does not stop it from inside a signal handler.

Sources: [celery/concurrency/thread.py:21-64](repo://celery/concurrency/thread.py#L21-L64), [celery/worker/worker.py:244-259](repo://celery/worker/worker.py#L244-L259)

## Eventlet and gevent

### Green pools

Both green pools spawn each task in a pool of green threads sized by `limit`, use a green `Timer` that schedules timer entries with `spawn_after`/`spawn_later`, set `is_green = True`, `signal_safe = False` and `task_join_will_block = False`, and use the greenlet's `id` as its "pid". They keep a map from that id to the greenlet so `terminate_job` can kill a running task; the target is wrapped so that a killed greenlet returns a neutral result instead of raising `GreenletExit`. `grow` and `shrink` resize the green pool.

Sources: [celery/concurrency/eventlet.py:36-60](repo://celery/concurrency/eventlet.py#L36-L60), [celery/concurrency/eventlet.py:88-181](repo://celery/concurrency/eventlet.py#L88-L181), [celery/concurrency/gevent.py:42-82](repo://celery/concurrency/gevent.py#L42-L82), [celery/concurrency/gevent.py:85-166](repo://celery/concurrency/gevent.py#L85-L166)

The eventlet pool sends its own signals: `eventlet_pool_started`, `eventlet_pool_apply` for each task, and `eventlet_pool_preshutdown`/`eventlet_pool_postshutdown` around waiting for running green threads at stop.

Sources: [celery/concurrency/eventlet.py:110-135](repo://celery/concurrency/eventlet.py#L110-L135)

The gevent pool can enforce a hard time limit: when a timeout is set it wraps the call in `gevent.Timeout` and calls the request's `timeout_callback` when it fires.

Sources: [celery/concurrency/gevent.py:28-39](repo://celery/concurrency/gevent.py#L28-L39), [celery/concurrency/gevent.py:116-126](repo://celery/concurrency/gevent.py#L116-L126)

## Autoscaling

`celery worker --autoscale=max,min` adds the `Autoscaler` step. It compares the number of reserved requests (`qty`) with the pool size. If more requests are waiting than processes exist, it grows the pool up to `max`. If fewer, it shrinks down to `min`, but only when the last scale-up was more than `AUTOSCALE_KEEPALIVE` seconds ago (30 by default), so the pool does not oscillate. Shrinking fails quietly when every process is busy. After a change it calls `pool.maintain_pool()`.

Sources: [celery/worker/autoscale.py:28](repo://celery/worker/autoscale.py#L28), [celery/worker/autoscale.py:61-154](repo://celery/worker/autoscale.py#L61-L154)

Without the event loop the autoscaler runs as a background thread checking once a second. With the event loop it is driven by the hub: it registers `maybe_scale` as an `on_task_message` callback and calls it every keepalive interval. `update(max, min)` — used by the `autoscale` remote control command — changes the limits and adjusts the consumer's prefetch count.

Sources: [celery/worker/autoscale.py:31-58](repo://celery/worker/autoscale.py#L31-L58), [celery/worker/autoscale.py:98-109](repo://celery/worker/autoscale.py#L98-L109), [celery/worker/autoscale.py:133-138](repo://celery/worker/autoscale.py#L133-L138)
