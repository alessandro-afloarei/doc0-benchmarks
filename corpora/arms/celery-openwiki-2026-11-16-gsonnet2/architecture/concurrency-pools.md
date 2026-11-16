---
type: architecture
title: Concurrency Pools
description: The execution-pool abstraction that runs task bodies for a worker (prefork/AsynPool, solo, threads, eventlet, gevent), how a pool is chosen and instantiated, what contract it fulfils, and where its behavior differs.
tags: [celery, worker, pool, prefork, gevent, eventlet, billiard, concurrency]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:56:17.091Z
sources:
  - id: openwiki-source-965d19cff645fcce36529be3
    resource: repo://celery/__main__.py
  - id: openwiki-source-03401290efe2e461d5c3013a
    resource: repo://celery/concurrency/__init__.py
  - id: openwiki-source-81590679ef53145be3061fc1
    resource: repo://celery/concurrency/asynpool.py
  - id: openwiki-source-799e2e026f2aa536a3206b1f
    resource: repo://celery/concurrency/base.py
  - id: openwiki-source-a77ffa26d752c146df8b33c1
    resource: repo://celery/concurrency/eventlet.py
  - id: openwiki-source-6e802d4c51b7e3a934027fff
    resource: repo://celery/concurrency/gevent.py
  - id: openwiki-source-09faa18a62432ea5464530cc
    resource: repo://celery/concurrency/prefork.py
  - id: openwiki-source-90234bb9d85f93dc4271aa3c
    resource: repo://celery/concurrency/solo.py
  - id: openwiki-source-ee2dc9a85efc5eef479744a5
    resource: repo://celery/concurrency/thread.py
  - id: openwiki-source-cd5b25b412e425989370ceb9
    resource: repo://celery/worker/components.py
  - id: openwiki-source-328c66e40eb163230ad26cbc
    resource: repo://celery/worker/request.py
generated: { by: "claude-code", at: "2026-11-16T17:56:17.091Z" }
---

# Concurrency Pools

The worker does not run task code itself. It hands each received task to a *pool* that executes it in a child process, a thread, a greenlet, or inline. All pools live in `celery/concurrency/` and share one small interface, `BasePool` in `celery/concurrency/base.py`. This page explains that contract, the shipped implementations, and the cross-cutting assumptions the rest of the worker makes about them. The surrounding consumer logic is covered in [Worker and consumer](worker-and-consumer.md), and the code that runs inside the pool is covered in [Task execution and tracing](../workflows/task-execution-and-tracing.md).

## Selection

`celery/concurrency/__init__.py` has a registry, `ALIASES`, that maps a name to a dotted `module:TaskPool` path:

| Name | Implementation |
|---|---|
| `prefork` (alias `processes`) | `celery.concurrency.prefork:TaskPool` |
| `solo` | `celery.concurrency.solo:TaskPool` |
| `threads` | `celery.concurrency.thread:TaskPool` (when `concurrent.futures` is importable) |
| `eventlet` | `celery.concurrency.eventlet:TaskPool` |
| `gevent` | `celery.concurrency.gevent:TaskPool` |
| `custom` | whatever `CELERY_CUSTOM_WORKER_POOL` points to |

`get_implementation(name)` resolves a name with `symbol_by_name`, so any dotted path to a `BasePool` subclass also works. This is the extension seam for out-of-tree pools. The CLI's `-P/--pool` option validates against `get_available_pool_names()`, and a configured `worker_pool` overrides the default `prefork` (see [CLI and process management](cli-and-process-management.md)).

The eventlet and gevent pools must be chosen with `-P` on the command line. `maybe_patch_concurrency` in `celery/__init__.py` has to monkey-patch the standard library before other modules are imported, so setting only `worker_pool` in configuration triggers a warning (`W_POOL_SETTING` in `celery/worker/components.py`).

## The `BasePool` contract

A pool has a lifecycle (`start`, `close`, `stop`, `terminate`, with `RUN`, `CLOSE` and `TERMINATE` states) and one work entry point:

- `apply_async(target, args, kwargs, **options)` delegates to the subclass's `on_apply`. The options carry callbacks: `callback` (success), `error_callback`, `accept_callback` (called when execution begins, with the pid and a timestamp), `timeout_callback`, plus `soft_timeout` and `timeout`. `Request.execute_using_pool` in `celery/worker/request.py` is the caller. It passes `trace_task_ret` or `fast_trace_task` as `target`, and the serialized request and body as arguments.
- `apply_target` (`celery/concurrency/base.py`) is the shared in-process executor used by the non-process pools. It reports acceptance, runs the target, and routes the result to `callback`. A `BaseException` that is not a normal `Exception` is converted into a `WorkerLostError` result, except for `WorkerShutdown` and `WorkerTerminate`, which propagate.
- Capability flags are consulted elsewhere in the worker:
  - `uses_semaphore`: the worker adds a semaphore to bound outstanding jobs.
  - `is_green`: the control mailbox switches to a greenlet-friendly variant, and AMQP heartbeats are driven from the timer.
  - `task_join_will_block`: this value is set globally with `_set_task_join_will_block`, and it is what makes `AsyncResult.get()` inside a task raise a "would block" error unless `allow_join_result()` is used. It is `True` by default and `False` for the green pools.
  - `signal_safe`: whether the pool may be shut down from inside a signal handler (`False` for threads, gevent and eventlet).
  - `body_can_be_buffer`: whether the pool accepts the message body as a buffer, without copying it to bytes.
- Optional operations are `terminate_job(pid, signal)`, `grow(n)` and `shrink(n)` (used by autoscale and remote control), `restart`, `maintain_pool`, `flush`, `register_with_event_loop(hub)`, and the `info` dict that the `stats` control command exposes.

The worker's `Pool` bootstep (`celery/worker/components.py`) builds the pool from worker settings: concurrency, `max_tasks_per_child`, `max_memory_per_child`, time limits, `worker_lost_wait`, and the optimization strategy. When the worker has no event loop, or on Windows, the pool is treated as threaded and gets no semaphore. Otherwise a `LaxBoundedSemaphore(procs)` limits outstanding jobs, and `max_restarts=100` is set. Autoscale arguments (`max,min`) set `max_concurrency` and `min_concurrency`.

## Prefork

`celery/concurrency/prefork.py` wraps `billiard`, Celery's multiprocessing fork. `TaskPool.on_start` picks the pool class:

- When the `threads` option is false it uses `AsynPool` (`celery/concurrency/asynpool.py`). The worker's `Pool` bootstep passes `threads=False` when it runs with an event loop on a non-Windows platform, which is the common case.
- Otherwise (`threads` true, the default) it uses billiard's blocking `Pool`, which uses helper threads for I/O.

The pool methods (`apply_async`, `terminate_job`, `grow`, `shrink`, `maintain_pool`) are bound directly to the underlying pool. Time limits are enabled (`enable_timeouts=True`).

**Child initialization.** `process_initializer` runs in every child:

1. It sets the parent-death signal to `SIGKILL`.
2. It resets the signals in `WORKER_SIGRESET` and ignores `SIGINT`.
3. It sets the process title and calls `app.loader.init_worker()` and `init_worker_process()`.
4. It reconfigures logging for the child.
5. It makes the app current and finalized, and rebuilds the `__trace__` handler (via `build_tracer`) for every registered task.
6. It resets worker state and sends `worker_process_init`.

`process_destructor` sends `worker_process_shutdown`. On shutdown, `on_stop` closes the pool and joins it. If an event-loop hub exists, a helper thread keeps firing hub timers every 0.5 seconds while the pool drains, so heartbeats on async transports are not starved.

### AsynPool

`AsynPool` replaces billiard's thread-based I/O with callbacks on the kombu hub, so the main process needs no helper threads:

- Each child gets a dedicated inbound pipe (jobs in), an outbound pipe (results out), and an optional ack channel. File descriptors are mapped back to processes in `_fileno_to_inq`, `_fileno_to_outq` and `_fileno_to_synq`.
- Jobs wait in `outbound_buffer`. `schedule_writes` writes job payloads to children incrementally (length header plus body), as the pipes become writable. A pipe that stays unavailable for more than 100 attempts is treated as damaged: the child is terminated and the job is put back.
- **Scheduling strategy:** the default is `fair`, which avoids handing a new job to a child that is mid-task. `fcfs` (alias `fast`) takes the first writable child. The strategy is selected by the worker's `-O` optimization option (`sched_strategy`).
- **Time limits** use hub timers. The soft timeout fires the soft-timeout handler and then schedules the hard timeout for the remaining time. The hard timeout terminates the job's process.
- **Liveness:** a child must send a `WORKER_UP` message within `proc_alive_timeout` (default 4 seconds, from `worker_proc_alive_timeout`) or it is terminated and replaced.
- `human_write_stats` exposes per-process write counts through the `stats` command.

## Solo

`solo.TaskPool` runs each task inline in the worker process (`on_apply = apply_target`, `limit = 1`). It blocks the event loop while a task runs, but it avoids fork and IPC overhead. It fires `worker_process_init` in the constructor, because there is no child process to do it.

## Threads

`thread.TaskPool` wraps `concurrent.futures.ThreadPoolExecutor(max_workers=limit)` and returns an `ApplyResult` that wraps the future. It has no per-job timeout or termination, and it is not signal-safe. Stopping it calls `executor.shutdown(cancel_futures=True)`.

## Eventlet and gevent

Both green pools use a greenlet pool (`GreenPool` or `gevent.pool.Pool`) of size `limit` and run `apply_target` in a greenlet.

- Their `Timer` replaces the thread-based timer with greenlets (`spawn_later`).
- `_make_killable_target` turns `GreenletExit` into a failed result so `terminate_job` (which kills the greenlet) completes cleanly. A `_pool_map` from greenlet id to greenlet supports that. The gevent pool also supports a per-task `timeout` using `gevent.Timeout` (`apply_timeout`).
- `grow` and `shrink` resize the pool in place. Eventlet additionally sends the signals `eventlet_pool_started`, `eventlet_pool_apply`, `eventlet_pool_preshutdown` and `eventlet_pool_postshutdown`.
- Embedded beat (`worker -B`) is refused for these pools. See [Beat scheduler](beat-scheduler.md).

## Constraints to remember

- Only prefork provides hard isolation, per-job hard time limits that kill the process, `max_tasks_per_child` and `max_memory_per_child`. The other pools share the worker's address space.
- Task time limits and `terminate_job` have pool-specific semantics. Consult `terminate_job` and the `on_soft_timeout` and `on_hard_timeout` hooks for each pool before relying on them.
- The `-O` strategy and the semaphore only matter for prefork.

## Tests

`t/unit/concurrency/` has one file per pool (`test_prefork.py`, `test_gevent.py`, `test_eventlet.py`, `test_thread.py`, `test_solo.py`, `test_pool.py`) plus `test_concurrency.py` for the base class and registry. See [Testing, CI and development workflow](../testing/test-strategy.md).
