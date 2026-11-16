---
title: "Execution Pools"
---
## Overview

A pool is the component that actually runs task bodies. The worker never calls a task function itself: `Request.execute_using_pool` passes the tracer and the raw message to `pool.apply_async`, and the pool runs it in a process, a thread or a green thread. Every pool subclasses `BasePool`, so the rest of the worker only uses one interface for starting, applying, growing, shrinking and terminating work, and the choice of concurrency model is a configuration name. How a request reaches the pool is described in [[Receiving and Executing Tasks]], and the `Pool` bootstep that creates it is in [[Worker Startup and Bootsteps]].

Sources: [celery/concurrency/base.py:47-80](repo://celery/concurrency/base.py#L47-L80), [celery/worker/request.py:341-372](repo://celery/worker/request.py#L341-L372)

## Choosing a pool

`get_implementation` resolves the pool name with `symbol_by_name` against a table of aliases, so either an alias or a full `module:Class` path works. The `-P` option and `worker_pool` setting supply the name, and the default is `prefork` (`DEFAULT_POOL`).

Sources: [celery/concurrency/__init__.py:11-43](repo://celery/concurrency/__init__.py#L11-L43), [celery/app/defaults.py:11](repo://celery/app/defaults.py#L11), [celery/app/defaults.py:352](repo://celery/app/defaults.py#L352)

| Alias | Class | Concurrency model |
| --- | --- | --- |
| `prefork` | `prefork:TaskPool` | Child processes via billiard |
| `processes` | `prefork:TaskPool` | Compatibility alias of `prefork` |
| `solo` | `solo:TaskPool` | The worker process itself, one task at a time |
| `threads` | `thread:TaskPool` | A `ThreadPoolExecutor` (available when `concurrent.futures` imports) |
| `eventlet` | `eventlet:TaskPool` | Eventlet green threads |
| `gevent` | `gevent:TaskPool` | Gevent green threads |
| `custom` | the value of `CELERY_CUSTOM_WORKER_POOL` | An out-of-tree `BasePool` subclass |

Sources: [celery/concurrency/__init__.py:11-39](repo://celery/concurrency/__init__.py#L11-L39)

An out-of-tree pool is registered by setting `CELERY_CUSTOM_WORKER_POOL` to a `package:class` name and selecting it with `--pool custom`.

Sources: [celery/concurrency/__init__.py:22-39](repo://celery/concurrency/__init__.py#L22-L39)

The Pool bootstep also treats eventlet and gevent specially: setting `worker_pool` to one of them in configuration produces a warning that `-P` must be used instead, so that the monkey-patching happens as early as possible, and the embedded `-B` beat is refused with these pools.

Sources: [celery/worker/components.py:18-30](repo://celery/worker/components.py#L18-L30), [celery/worker/components.py:141-142](repo://celery/worker/components.py#L141-L142), [celery/worker/components.py:195-202](repo://celery/worker/components.py#L195-L202)

## The BasePool contract

`BasePool` carries class flags that the worker reads: `signal_safe` (the pool can shut down inside a signal handler), `is_green`, `uses_semaphore`, `task_join_will_block` and `body_can_be_buffer`. The lifecycle hooks `on_start`, `on_stop`, `on_terminate` and `on_close` are no-ops that subclasses override, and `apply_async` logs the call and forwards to `on_apply` with `waitforslot` set from `putlocks`.

Sources: [celery/concurrency/base.py:47-80](repo://celery/concurrency/base.py#L47-L80), [celery/concurrency/base.py:140-157](repo://celery/concurrency/base.py#L140-L157)

`apply_target` is the function the in-process pools use to run a job. It calls `accept_callback` with the process or greenlet id and a monotonic time, which becomes `Request.on_accepted`, runs the target, and passes the return value to `callback`. An ordinary `Exception` propagates, and `WorkerShutdown` and `WorkerTerminate` propagate too, but any other `BaseException` is turned into `WorkerLostError` and passed to the callback as `ExceptionInfo`.

Sources: [celery/concurrency/base.py:22-45](repo://celery/concurrency/base.py#L22-L45)

## Prefork

The default pool wraps billiard's multiprocessing fork. `on_start` enables or disables forking, then builds either billiard's blocking `Pool` when the `threads` option is true or the `AsynPool` otherwise, passing `process_initializer` and `process_destructor`, `enable_timeouts=True` and the `worker_proc_alive_timeout` setting. It then binds `apply_async`, `maintain_pool`, `terminate_job`, `grow` and `shrink` straight to the underlying pool.

Sources: [celery/concurrency/prefork.py:95-126](repo://celery/concurrency/prefork.py#L95-L126)

Each child runs `process_initializer`. It asks the OS to kill the child if the parent dies (`set_pdeathsig('SIGKILL')`), resets and ignores signals, sets the process title and runs the loader's `init_worker` and `init_worker_process`. It then either finalizes the app or, in a child started with `FORKED_BY_MULTIPROCESSING`, calls `setup_worker_optimizations`. The child rebuilds a tracer for every task, resets the worker state module and sends `worker_process_init`.

Sources: [celery/concurrency/prefork.py:21-82](repo://celery/concurrency/prefork.py#L21-L82)

On a warm stop, `on_stop` closes the pool and joins it. If an event loop hub exists it starts a daemon thread that calls `hub.fire_timers()` every half second, so asynchronous broker heartbeats keep firing while long tasks finish, and stops the thread afterwards. `on_terminate` calls the pool's `terminate`.

Sources: [celery/concurrency/prefork.py:142-198](repo://celery/concurrency/prefork.py#L142-L198)

## Solo and threads

`solo` runs the task in the worker's own process: `on_apply` is `apply_target`, `limit` is fixed at 1 and `worker_process_init` is sent in the constructor. Its reported info lists the worker's own pid as the only process and `max-tasks-per-child` as `None`.

Sources: [celery/concurrency/solo.py:11-31](repo://celery/concurrency/solo.py#L11-L31)

`threads` creates a `ThreadPoolExecutor(max_workers=limit)` and submits `apply_target` for each job, wrapping the future in an `ApplyResult`. It sets `signal_safe = False`, so a signal-handler shutdown does not call into it, and `on_stop` shuts the executor down with `cancel_futures=True`.

Sources: [celery/concurrency/thread.py:21-64](repo://celery/concurrency/thread.py#L21-L64)

## Eventlet and gevent

Both green pools share a shape: `is_green = True`, `signal_safe = False`, `task_join_will_block = False`, a `Timer` class that replaces the default timer, and a pool map from greenlet id to greenlet so a job can be killed. `getpid` returns the id of the current greenlet, so `accept_callback` reports a greenlet rather than an OS process.

Sources: [celery/concurrency/eventlet.py:88-103](repo://celery/concurrency/eventlet.py#L88-L103), [celery/concurrency/gevent.py:85-105](repo://celery/concurrency/gevent.py#L85-L105)

The eventlet pool uses a `GreenPool` and sends `eventlet_pool_started`, `eventlet_pool_apply`, `eventlet_pool_preshutdown` and `eventlet_pool_postshutdown` around its lifecycle. At import time it warns with `RuntimeWarning` when celery, kombu or billiard modules that depend on threads or sockets were imported before eventlet patched them. It wraps each target in a `killable_target` that turns `GreenletExit` into a `(False, None, None)` result, and `terminate_job` kills and waits for the greenlet.

Sources: [celery/concurrency/eventlet.py:14-26](repo://celery/concurrency/eventlet.py#L14-L26), [celery/concurrency/eventlet.py:104-180](repo://celery/concurrency/eventlet.py#L104-L180)

The gevent pool uses a gevent `Pool` and supports a per-job timeout: when a timeout is set it runs the target through `apply_timeout`, calling `timeout_callback` on expiry. `grow` and `shrink` adjust the pool's semaphore counter and size, and `num_processes` is the number of greenlets in the pool.

Sources: [celery/concurrency/gevent.py:107-146](repo://celery/concurrency/gevent.py#L107-L146)

With a green pool the control `Pidbox` becomes `gPidbox`, which runs its loop in a spawned greenlet (see [[Remote Control and Revoking]]), and `synloop` sets up AMQP heartbeats itself when `pool.is_green` is true.

Sources: [celery/worker/consumer/control.py:20-25](repo://celery/worker/consumer/control.py#L20-L25), [celery/worker/loops.py:133-142](repo://celery/worker/loops.py#L133-L142)

## Autoscaling

When `--autoscale=max,min` is set, the `Autoscaler` runs as a background thread (or as repeated timer callbacks in the event loop) and resizes the pool through `grow` and `shrink`. `qty` is the number of reserved requests, and `processes` is the pool's current size. `_maybe_scale` grows the pool to `min(qty, max_concurrency)` when it is smaller, and shrinks it to `max(qty, min_concurrency)` when it is larger. `scale_down` only acts if more than `AUTOSCALE_KEEPALIVE` seconds (30 by default, from the environment) have passed since the last scale-up, and a shrink that fails with `ValueError` because every process is busy is only logged.

Sources: [celery/worker/autoscale.py:28](repo://celery/worker/autoscale.py#L28), [celery/worker/autoscale.py:61-130](repo://celery/worker/autoscale.py#L61-L130), [celery/worker/autoscale.py:140-154](repo://celery/worker/autoscale.py#L140-L154)

The autoscale step is created with the pool as its dependency. In the event loop it registers `maybe_scale` as a callback for every received task message, and `update(max, min)` also adjusts the consumer's prefetch count so the prefetch limit tracks the new maximum. The remote control `autoscale` command calls `update`.

Sources: [celery/worker/autoscale.py:31-58](repo://celery/worker/autoscale.py#L31-L58), [celery/worker/autoscale.py:98-110](repo://celery/worker/autoscale.py#L98-L110), [celery/worker/autoscale.py:133-139](repo://celery/worker/autoscale.py#L133-L139)
