---
title: "Execution Pools"
---
## Overview

A pool is the component that actually runs task bodies. The worker's main process receives messages and builds requests, then hands each one to a pool through a single method, `apply_async`; the pool decides whether that means a child process, a thread or a green thread, and reports back through the callbacks described on [[Task Execution, Tracing and Acknowledgement]]. Five implementations ship with Celery and a sixth can be plugged in from the environment. This page describes the shared interface and what each implementation does.

Sources: [celery/concurrency/base.py:47-71](repo://celery/concurrency/base.py#L47-L71), [celery/concurrency/__init__.py:12-48](repo://celery/concurrency/__init__.py#L12-L48)

## Selecting a pool

`celery worker -P NAME` (or the `worker_pool` setting) is resolved by `get_implementation`, which uses `symbol_by_name` with an alias table:

| Alias | Class | Availability |
| --- | --- | --- |
| `prefork`, `processes` | `celery.concurrency.prefork:TaskPool` | always; `processes` is a compatibility alias |
| `eventlet` | `celery.concurrency.eventlet:TaskPool` | always listed; needs eventlet installed |
| `gevent` | `celery.concurrency.gevent:TaskPool` | always listed; needs gevent installed |
| `solo` | `celery.concurrency.solo:TaskPool` | always |
| `threads` | `celery.concurrency.thread:TaskPool` | when `concurrent.futures` imports |
| `custom` | the class named by `CELERY_CUSTOM_WORKER_POOL` | only when that variable is set |

Sources: [celery/concurrency/__init__.py:12-48](repo://celery/concurrency/__init__.py#L12-L48)

An out-of-tree pool must subclass `BasePool` and be named in the standard `package:class` format in `CELERY_CUSTOM_WORKER_POOL`, then selected with `--pool custom`. `get_available_pool_names` returns every alias key.

Sources: [celery/concurrency/__init__.py:21-48](repo://celery/concurrency/__init__.py#L21-L48)

The `Pool` bootstep warns (`W_POOL_SETTING`) if the `worker_pool` setting rather than the `-P` argument selects eventlet or gevent, because the monkey patches must be applied as early as possible.

Sources: [celery/worker/components.py:20-29](repo://celery/worker/components.py#L20-L29), [celery/worker/components.py:138-143](repo://celery/worker/components.py#L138-L143)

## The BasePool interface

`BasePool(limit, putlocks, forking_enable, callbacks_propagate, app, **options)` has a lifecycle (`start` calls `on_start` and sets state to `RUN`; `close`, `stop` and `terminate` move through `CLOSE` and `TERMINATE`) and two public entry points. `apply_async(target, args, kwargs, **options)` logs at debug level and forwards to `on_apply` with `waitforslot` and `callbacks_propagate`; the callbacks it passes along are supposed to return quickly, because otherwise the thread handling results would block. `info` returns JSON-friendly statistics from `_get_info`: implementation name and `max-concurrency`.

Sources: [celery/concurrency/base.py:73-179](repo://celery/concurrency/base.py#L73-L179)

Class attributes describe capabilities the worker consults:

| Attribute | Default | Meaning |
| --- | --- | --- |
| `signal_safe` | `True` | The pool can be shut down from a signal handler; `WorkController.stop` only shuts down from a handler if so |
| `is_green` | `False` | Uses greenlets; this chooses `gPidbox` for remote control and the blocking loop |
| `uses_semaphore` | `False` | Only the prefork pool; makes the `Pool` step wrap `process_task` with a semaphore |
| `task_join_will_block` | `True` | Whether `AsyncResult.get` inside a task would block; the `Pool` step passes it to `_set_task_join_will_block` |
| `body_can_be_buffer` | `False` | Whether the message body can be passed as a buffer |

Sources: [celery/concurrency/base.py:47-71](repo://celery/concurrency/base.py#L47-L71), [celery/worker/worker.py:223-232](repo://celery/worker/worker.py#L223-L232), [celery/worker/components.py:138-178](repo://celery/worker/components.py#L138-L178), [celery/worker/consumer/control.py:18-30](repo://celery/worker/consumer/control.py#L18-L30)

`apply_target` is the helper the simpler pools call: it invokes the accept callback with the pid and a monotonic time, calls the target, passes the return value to `callback`, lets `WorkerShutdown`, `WorkerTerminate` and ordinary exceptions propagate, and converts any other `BaseException` into a `WorkerLostError` handed to the callback.

Sources: [celery/concurrency/base.py:22-44](repo://celery/concurrency/base.py#L22-L44)

The `Pool` bootstep gives every pool its sizing: minimum concurrency, `maxtasksperchild`, `max_memory_per_child`, the worker-wide time limits, the lost-worker wait and `putlocks`; the details are on [[Worker Architecture and Bootsteps]].

Sources: [celery/worker/components.py:138-172](repo://celery/worker/components.py#L138-L172)

## Prefork

The default pool runs tasks in child processes built on billiard, a fork of `multiprocessing`. On start `TaskPool.on_start` enables or disables forking and picks the pool class: `BlockingPool` (billiard's pool) when the `threads` option is true, which is the case without an event loop, and `AsynPool` otherwise. It creates the pool with `process_initializer` and `process_destructor`, `enable_timeouts=True` and the sizing options, and aliases `on_apply`, `maintain_pool`, `terminate_job`, `grow`, `shrink` and `flush` to the pool's own methods.

Sources: [celery/concurrency/prefork.py:95-127](repo://celery/concurrency/prefork.py#L95-L127)

`AsynPool` is a non-blocking version of the multiprocessing pool that integrates with the worker's event loop; its module states three problems it solves: starting child processes and keeping them running, sending jobs and receiving results, and shutting down safely.

Sources: [celery/concurrency/asynpool.py:1-13](repo://celery/concurrency/asynpool.py#L1-L13), [celery/concurrency/asynpool.py:414-420](repo://celery/concurrency/asynpool.py#L414-L420)

`process_initializer` runs in each child. It sets the parent-death signal to `SIGKILL`, marks that joining results will block, resets and ignores signals, sets the process title, runs the loader's worker initialization, sets up logging, and either sets up worker optimizations (when started by `execv`) or sets the app current, finalizes it and sets `trace._tasks` for the fast trace path. It rebuilds the tracer for every task, resets worker state and sends `worker_process_init`. `process_destructor` sends `worker_process_shutdown`. See [[Signals]].

Sources: [celery/concurrency/prefork.py:41-92](repo://celery/concurrency/prefork.py#L41-L92)

`on_stop` closes and joins the pool; if an event loop exists it runs a daemon thread that keeps firing hub timers every half second during the join, so broker heartbeats are not missed while tasks drain. `on_terminate` terminates it. `_get_info` adds the pids, `max-tasks-per-child`, the time limits and write statistics.

Sources: [celery/concurrency/prefork.py:142-216](repo://celery/concurrency/prefork.py#L142-L216)

## Solo

`solo` runs each task inline in the worker's own process. `on_apply` is just `apply_target`, the limit is fixed at 1, and `worker_process_init` is sent when the pool is constructed. It reports one "process" with the current pid and no timeouts.

Sources: [celery/concurrency/solo.py:11-31](repo://celery/concurrency/solo.py#L11-L31)

## Threads

`threads` wraps a `ThreadPoolExecutor(max_workers=limit)`. `on_apply` submits `apply_target` and returns an `ApplyResult` that exposes the future's `result` as `get`. It sets `signal_safe = False` and `body_can_be_buffer = True`, shuts the executor down cancelling pending futures on stop, and reports the thread count.

Sources: [celery/concurrency/thread.py:17-64](repo://celery/concurrency/thread.py#L17-L64)

## Gevent and Eventlet

Both green pools set `is_green = True`, `signal_safe = False` and `task_join_will_block = False`, use their own `Timer` classes (the `Timer` step picks the pool's timer when there is no event loop), and create a greenlet pool of size `limit` on start, with `getpid` returning the greenlet's id. They differ in details:

| | Gevent | Eventlet |
| --- | --- | --- |
| Pool object | `gevent.pool.Pool` | `eventlet.greenpool.GreenPool` |
| Time limits | `apply_timeout` wraps the call in a gevent `Timeout` and calls `timeout_callback(False, timeout)` on expiry | Not applied in `on_apply` |
| `grow`/`shrink` | Adjust the pool's semaphore counter and size | `resize` the pool and update `limit` |
| Kill a job | `gevent.kill` on the greenlet | `kill()` then `wait()` |
| Extra signals | none | `eventlet_pool_started`, `eventlet_pool_apply`, `eventlet_pool_preshutdown`, `eventlet_pool_postshutdown` |
| Stop | `join` | `waitall` |

Sources: [celery/concurrency/gevent.py:26-171](repo://celery/concurrency/gevent.py#L26-L171), [celery/concurrency/eventlet.py:88-181](repo://celery/concurrency/eventlet.py#L88-L181)

Eventlet also warns at import if `billiard`, `celery` or `kombu` modules were imported before patching and already refer to `thread`, `threading` or `socket`. Green pools cannot be combined with the embedded beat (`-B`): the `Beat` step raises `ImproperlyConfigured`.

Sources: [celery/concurrency/eventlet.py:14-26](repo://celery/concurrency/eventlet.py#L14-L26), [celery/worker/components.py:181-205](repo://celery/worker/components.py#L181-L205)

A green pool uses the synchronous loop and `gPidbox`, the greenlet-based remote-control consumer, as described on [[The Consumer: Receiving Tasks]] and [[Remote Control: Inspect and Control]].

Sources: [celery/worker/loops.py:146-183](repo://celery/worker/loops.py#L146-L183), [celery/worker/pidbox.py:75-126](repo://celery/worker/pidbox.py#L75-L126)
