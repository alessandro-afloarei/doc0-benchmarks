---
type: subsystem
title: Concurrency Pools and Autoscaling
description: The worker execution pools in celery.concurrency — BasePool contract, prefork (billiard Pool / AsynPool with non-blocking pipes and fair scheduling), threads, solo, eventlet and gevent green pools, custom pools — child-process initialisation, time limits, and the autoscaler.
tags: [worker, concurrency, prefork, eventlet, gevent, autoscale]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T09:27:53.075Z
sources:
  - id: openwiki-source-ac404435efa758dad4bbfc83
    resource: repo://celery/app/defaults.py
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
  - id: openwiki-source-e160c8ef896234d60dbce1c5
    resource: repo://celery/worker/autoscale.py
generated: { by: "claude-code", at: "2026-11-15T09:27:53.075Z" }
---

# Concurrency Pools and Autoscaling

The worker hands each accepted `Request` to a **pool** (`celery/concurrency/`) via `pool.apply_async(trace_fn, args, callback=..., error_callback=..., accept_callback=..., timeout_callback=..., timeout=..., soft_timeout=...)`. The pool is created by the worker's `Pool` bootstep ([Worker Bootsteps](bootsteps-and-workcontroller.md)) and is selected with `-P/--pool` or `worker_pool` (default `prefork`).

## Selecting a pool

`celery/concurrency/__init__.py` maps names to classes:

| Name | Class | Notes |
| --- | --- | --- |
| `prefork` (alias `processes`) | `celery.concurrency.prefork:TaskPool` | Default; multiple OS processes via billiard |
| `threads` | `celery.concurrency.thread:TaskPool` | `concurrent.futures.ThreadPoolExecutor` |
| `solo` | `celery.concurrency.solo:TaskPool` | Runs tasks inline in the worker's main thread |
| `eventlet` | `celery.concurrency.eventlet:TaskPool` | Green threads; requires monkey patching |
| `gevent` | `celery.concurrency.gevent:TaskPool` | Green threads; requires monkey patching |
| `custom` | value of `CELERY_CUSTOM_WORKER_POOL` env var | Out-of-tree `BasePool` implementation, selected with `--pool custom` |

Eventlet/gevent monkey patching happens in `celery/__main__.py` before anything else is imported (see [Command-Line Interface](../cli/command-line.md#entry-point-and-early-patching)); setting `worker_pool='gevent'` in configuration alone is too late, which is why the Pool step warns when a green pool is configured via the setting.

## The `BasePool` contract (`celery/concurrency/base.py`)

- `limit` (concurrency), `options` (time limits, max tasks/memory per child, etc.), `start()/stop()/terminate()/restart()/close()`.
- `apply_async()` calls `on_apply(...)`; `apply_target()` is the default synchronous runner: it calls `accept_callback(pid, time)`, runs the target, then `callback(ret)`. Ordinary exceptions and `WorkerShutdown`/`WorkerTerminate` propagate (the tracer itself already turns task exceptions into results); any other `BaseException` is converted into a `WorkerLostError` and passed to `callback` as failure info.
- Capability flags used by the worker:
  - `signal_safe` — whether shutdown may run directly inside a signal handler (false for threads and green pools).
  - `is_green` — eventlet/gevent.
  - `uses_semaphore` — prefork uses the worker semaphore to bound in-flight tasks.
  - `task_join_will_block` — whether `result.get()` inside tasks would deadlock (true by default; false for green pools); the worker publishes it globally for the [result deadlock guard](../results/result-objects.md).
  - `body_can_be_buffer` — threads/solo can receive message bodies as buffers without copying.
- Hooks: `on_soft_timeout`, `on_hard_timeout`, `maintain_pool`, `terminate_job(pid, signal)`, `grow/shrink`, `register_with_event_loop(hub)`, `info`/`num_processes`.

## Prefork

`prefork.TaskPool` wraps billiard (a multiprocessing fork):

- With the worker event loop (AMQP/Redis transports, not Windows) it uses **`AsynPool`**; otherwise (`threads=True`) the classic blocking billiard `Pool` with result/timeout handler threads.
- Child processes start with `process_initializer(app, hostname)`:
  - `set_pdeathsig('SIGKILL')` so children die with the parent (Linux),
  - sets `task_join_will_block(True)`,
  - resets `SIGTERM`, `SIGHUP`, `SIGTTIN`, `SIGTTOU`, `SIGUSR1` and ignores `SIGINT` (and the remapped TERM signal),
  - runs `loader.init_worker()` / `init_worker_process()` (Django fixup DB cleanup happens here via `worker_process_init`),
  - sets up logging from the `CELERY_LOG_*` env vars (re-doing it when the file name contains `%i` so each child has its own file),
  - makes the app current/default and finalizes it (or calls `setup_worker_optimizations` if started via `execv`),
  - pre-builds a tracer for every registered task (`task.__trace__`),
  - resets worker state and sends `worker_process_init`.
- `process_destructor` sends `worker_process_shutdown(pid, exitcode)`.
- `max_tasks_per_child` / `max_memory_per_child` recycle children; `worker_proc_alive_timeout` (default 4s) bounds how long a new child may take to report `WORKER_UP`.
- Graceful `on_stop` closes the pool and keeps firing hub timers in a helper thread while joining, so in-flight result handling still completes.

### AsynPool (`celery/concurrency/asynpool.py`)

A non-blocking subclass of billiard's `Pool` integrated with the kombu `Hub`:

- Each child gets its **own** pair of pipes (`inq` non-blocking for writes, `outq` non-blocking for reads, optional `synq`), created in `create_process_queues()`; file descriptors are registered with the hub so the main thread writes jobs and reads results without blocking.
- Jobs are serialized and written incrementally (partial writes are resumed), results are read incrementally by `ResultHandler._recv_message`.
- **Scheduling strategy** (`-O`): `fair` (default, also `None`/`default`) only writes a job to a child that is not busy; `fast`/`fcfs` writes to any child whose pipe is writable. Fair scheduling avoids head-of-line blocking behind long tasks at the cost of some throughput.
- Child exit is detected by polling a dup of the process sentinel; `maintain_pool` replaces dead children. Jobs whose process died are reported as `WorkerLostError` (`on_job_process_lost`), which `Request` turns into a failure or requeue depending on `reject_on_worker_lost`/`acks_late` (see [Task Execution](task-execution.md)).
- Soft and hard time limits are scheduled on the hub timer: `_on_soft_timeout` delegates to billiard's timeout handler (which signals the child so the task sees `SoftTimeLimitExceeded`) and schedules the hard limit for `hard - soft` seconds later; `_on_hard_timeout` delegates to the handler that terminates the child.
- `worker_before_create_process` is sent (and `gc.collect()` run) before forking each child.

## Threads

`thread.TaskPool` submits `apply_target` to a `ThreadPoolExecutor(max_workers=limit)`. `signal_safe = False`; stopping cancels pending futures. Hard time limits cannot be enforced on threads.

## Solo

`solo.TaskPool` sets `on_apply = apply_target` and `limit = 1`: tasks run **synchronously in the consumer's thread**, blocking message consumption, heartbeats and remote control while a task runs. It sends `worker_process_init` at construction. Useful for debugging and some embedded/test setups (`celery.contrib.testing` defaults to it).

## Eventlet and gevent

Both green pools spawn a greenlet per task from a `GreenPool`/`gevent.pool.Pool` sized to `limit` (concurrency can be in the hundreds/thousands for I/O-bound work):

- `is_green = True`, `signal_safe = False`, `task_join_will_block = False`.
- They provide their own `Timer` (green `spawn_after`-style), used instead of the threaded timer.
- `terminate_job(pid)` kills the greenlet identified by `id(greenlet)`; targets are wrapped to treat `GreenletExit` as termination.
- gevent supports a `timeout` (hard time limit) via `apply_timeout`; eventlet sends `eventlet_pool_started/preshutdown/postshutdown/apply` signals.
- `grow`/`shrink` resize the green pool (used by autoscale / `pool_grow`).
- The worker does not use the kombu hub event loop under green pools; embedded beat (`-B`) is refused.

## Autoscaling (`celery/worker/autoscale.py`)

Enabled with `--autoscale=max,min` (`worker_autoscaler` selects the class):

- `WorkerComponent` (conditional bootstep requiring `Pool`) creates an `Autoscaler`. Without the event loop it runs as a background thread checking once per second; with the hub, `maybe_scale` is called on every received task message and every `keepalive` seconds.
- The desired size is the number of **reserved requests** (`state.reserved_requests`), clamped to `[min, max]`. Scale-up happens immediately; scale-down only after `AUTOSCALE_KEEPALIVE` seconds (env var, default 30) since the last scale-up, and fails gracefully when all processes are busy.
- `update(max, min)` (used by the `autoscale` control command) also adjusts the consumer's prefetch count by the change in `max`.
- The initial prefetch count is computed from `max` concurrency × `worker_prefetch_multiplier` (see the `Consumer` step).

## Related tests

`t/unit/concurrency/` (`test_prefork.py`, `test_pool.py`, `test_thread.py`, `test_solo.py`, `test_eventlet.py`, `test_gevent.py`, `test_concurrency.py`), `t/unit/worker/test_autoscale.py`.
