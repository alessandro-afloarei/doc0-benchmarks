---
title: "Worker Pool Implementations"
---
## Overview

A pool is the component that actually runs task bodies. The worker's `Pool` bootstep ([[Worker Startup and Bootsteps]]) creates one pool instance; the request submits work to it with `pool.apply_async` ([[Task Execution, Tracing and Acknowledgement]]). Celery ships five implementations that all follow the `BasePool` contract: `prefork` (the default process pool), `solo`, `threads`, `eventlet` and `gevent`. This page describes that contract, how a name is resolved to a class, and what is different about each pool.

Sources: [celery/concurrency/base.py:47-80](repo://celery/concurrency/base.py#L47-L80), [celery/concurrency/__init__.py:10-20](repo://celery/concurrency/__init__.py#L10-L20)

## The pool contract

`BasePool` keeps a `limit` (the concurrency), `putlocks`, the app and any extra options. `start` calls `on_start` and moves to `RUN`; `stop` calls `on_stop` and `terminate` calls `on_terminate`, both moving to `TERMINATE`; `close` moves to `CLOSE`. `apply_async` forwards to the subclass's `on_apply` with `waitforslot=putlocks` and `callbacks_propagate`. Hooks with default no-op behaviour include `register_with_event_loop`, `flush` and `maintain_pool`; `terminate_job` and `restart` raise `NotImplementedError` unless overridden.

Sources: [celery/concurrency/base.py:73-146](repo://celery/concurrency/base.py#L73-L146)

Class attributes tell the rest of Celery how a pool behaves:

Sources: [celery/concurrency/base.py:47-71](repo://celery/concurrency/base.py#L47-L71)

| Attribute | Default | Meaning |
| --- | --- | --- |
| `signal_safe` | `True` | The pool can be shut down from a signal handler; `WorkController.stop` checks it |
| `is_green` | `False` | The pool uses greenlets; the consumer then enables AMQP heartbeats and the green remote-control box |
| `uses_semaphore` | `False` | Only multiprocessing: whether the worker guards sends to the pool with a semaphore |
| `task_join_will_block` | `True` | Whether `AsyncResult.get` inside a task would block the pool |
| `body_can_be_buffer` | `False` | Whether the message body can be passed as a buffer |
| `Timer` | `timer2.Timer` | The timer class the worker uses when there is no event loop |

Sources: [celery/concurrency/base.py:47-71](repo://celery/concurrency/base.py#L47-L71), [celery/worker/worker.py:244-252](repo://celery/worker/worker.py#L244-L252), [celery/worker/components.py:41-56](repo://celery/worker/components.py#L41-L56)

`apply_target` is the helper the non-process pools use to run a job. It calls `accept_callback(pid, monotonic())` first (which is how a `Request` learns the task started), runs the target, and passes the return value to `callback`. An ordinary `Exception` propagates; `WorkerShutdown` and `WorkerTerminate` propagate; any other `BaseException` is converted into a `WorkerLostError` and delivered to the callback as an `ExceptionInfo`.

Sources: [celery/concurrency/base.py:22-44](repo://celery/concurrency/base.py#L22-L44)

## Choosing a pool by name

`ALIASES` maps `prefork` and its compatibility alias `processes` to `celery.concurrency.prefork:TaskPool`, plus `eventlet`, `gevent`, `solo`, and `threads` when `concurrent.futures` imports. If the environment variable `CELERY_CUSTOM_WORKER_POOL` is set, its `package:class` value is registered as `custom`, so `--pool custom` selects a pool outside the repository that subclasses `BasePool`. `get_implementation` resolves a name with `symbol_by_name`, so a full class path also works, and `get_available_pool_names` lists the aliases.

Sources: [celery/concurrency/__init__.py:10-48](repo://celery/concurrency/__init__.py#L10-L48)

The `-P/--pool` option must be used to select eventlet or gevent; the `worker_pool` setting is not enough. The docstring in `components.py` says that setting should not be used for these pools because the patches must be applied as early as possible, and the `Pool` step warns if `worker_pool` names one of them. The reason is in `celery/__init__.py`: `maybe_patch_concurrency` scans the command-line for `-P` or `--pool`, and runs `eventlet.monkey_patch()` or `gevent.monkey.patch_all()` before the rest of Celery is imported (see [[Quickstart]]).

Sources: [celery/worker/components.py:25-33](repo://celery/worker/components.py#L25-L33), [celery/worker/components.py:141-142](repo://celery/worker/components.py#L141-L142), [celery/__init__.py:88-153](repo://celery/__init__.py#L88-L153)

## prefork

`prefork` is the multiprocessing pool, built on `billiard`. `on_start` calls `forking_enable` and chooses `BlockingPool` (billiard's `Pool`) when the worker runs without an event loop (`threads` option true) or `AsynPool` otherwise. It creates the pool with `processes=limit`, a `process_initializer`, a `process_destructor`, timeouts enabled and the app's `worker_proc_alive_timeout`, then aliases the pool's `apply_async`, `maintain_pool`, `terminate_job`, `grow`, `shrink` and `flush` as its own. It sets `uses_semaphore = True`.

Sources: [celery/concurrency/prefork.py:95-127](repo://celery/concurrency/prefork.py#L95-L127)

`AsynPool` is a non-blocking version of `multiprocessing.Pool` written for the event loop; its module docstring lists three problems it solves: starting and keeping child processes running, sending jobs and receiving results, and safe shutdown. It notes that the module "will be moved soon, so don't use it directly".

Sources: [celery/concurrency/asynpool.py:1-14](repo://celery/concurrency/asynpool.py#L1-L14), [celery/concurrency/asynpool.py:414-426](repo://celery/concurrency/asynpool.py#L414-L426)

`process_initializer` runs in every child. It sets a parent-death signal of `SIGKILL`, resets or ignores signals, sets the process title, calls the loader's `init_worker` and `init_worker_process`, and sets up logging again if the log file path contains `%i`. It then finalizes the app (or calls `setup_worker_optimizations` after an `execv`), rebuilds every task's tracer, clears worker state inherited from the parent, and sends `worker_process_init`.

Sources: [celery/concurrency/prefork.py:41-79](repo://celery/concurrency/prefork.py#L41-L79)

On stop, prefork closes the pool and joins it. If an event loop hub exists it runs a daemon thread that calls `hub.fire_timers()` every half second, so heartbeats keep firing while the pool drains, and stops the thread afterwards; `on_terminate` terminates the pool directly. `restart` restarts the billiard pool and sends it a no-op job.

Sources: [celery/concurrency/prefork.py:128-198](repo://celery/concurrency/prefork.py#L128-L198)

## solo and threads

`solo` runs each task inline in the worker process: `on_apply` is `apply_target` itself and the limit is fixed at 1. It sends `worker_process_init` when created, since there is no child process to send it. Its `body_can_be_buffer` is true.

Sources: [celery/concurrency/solo.py:11-31](repo://celery/concurrency/solo.py#L11-L31)

`threads` wraps a `concurrent.futures.ThreadPoolExecutor` with `max_workers=limit`. `on_apply` submits `apply_target` to the executor and returns an `ApplyResult` wrapper whose `wait` waits on the future. `signal_safe` is `False`, and `on_stop` shuts the executor down, cancelling pending futures.

Sources: [celery/concurrency/thread.py:21-64](repo://celery/concurrency/thread.py#L21-L64)

## eventlet and gevent

Both green pools set `is_green = True`, `signal_safe = False` and `task_join_will_block = False`, and provide their own `Timer` class so the worker's timer (used when there is no kombu hub) is greenlet-friendly. They keep a `_pool_map` of running greenlets so a job can be killed by `terminate_job`, and wrap each target so a `GreenletExit` returns `(False, None, None)` instead of an error.

Sources: [celery/concurrency/eventlet.py:36-108](repo://celery/concurrency/eventlet.py#L36-L108), [celery/concurrency/gevent.py:42-106](repo://celery/concurrency/gevent.py#L42-L106), [celery/concurrency/eventlet.py:160-181](repo://celery/concurrency/eventlet.py#L160-L181)

They differ in details:

Sources: [celery/concurrency/eventlet.py:88-123](repo://celery/concurrency/eventlet.py#L88-L123), [celery/concurrency/gevent.py:85-127](repo://celery/concurrency/gevent.py#L85-L127)

- `eventlet` builds a `GreenPool` and spawns each job on it; it emits the signals `eventlet_pool_started`, `eventlet_pool_apply`, `eventlet_pool_preshutdown` and `eventlet_pool_postshutdown`, and its `on_stop` waits for all greenlets. Its `grow` and `shrink` resize the pool.
- `gevent` builds a gevent `Pool` and supports a per-job timeout through `apply_timeout`, returning the greenlet from `on_apply`; its `grow` and `shrink` adjust the pool's semaphore counter and size, and `on_stop` joins the pool.

Sources: [celery/concurrency/eventlet.py:88-158](repo://celery/concurrency/eventlet.py#L88-L158), [celery/concurrency/gevent.py:28-40](repo://celery/concurrency/gevent.py#L28-L40), [celery/concurrency/gevent.py:85-146](repo://celery/concurrency/gevent.py#L85-L146)

The embedded beat service is refused with these pools; see [[Beat: Periodic Task Scheduling]]. With a green pool the consumer uses the blocking `synloop` unless a hub is present; see [[The Consumer: From Broker Message to Pool]].

Sources: [celery/worker/components.py:186-210](repo://celery/worker/components.py#L186-L210), [celery/worker/consumer/consumer.py:238-246](repo://celery/worker/consumer/consumer.py#L238-L246)
