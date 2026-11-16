---
type: subsystem
title: Concurrency Pools
description: The worker's execution pools — the BasePool contract, the prefork pool built on billiard with the non-blocking AsynPool integrated into the event loop, child process initialization, scheduling strategies and time limits, the eventlet/gevent green pools, the thread and solo pools, pool selection and monkey-patching, and the autoscaler.
tags: [concurrency, pool, prefork, billiard, asynpool, eventlet, gevent, threads, autoscale]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:05:29.073Z
sources:
  - id: openwiki-source-6de531038635a55bb6fb085b
    resource: repo://celery/bin/worker.py
  - id: openwiki-source-03401290efe2e461d5c3013a
    resource: repo://celery/concurrency/__init__.py
  - id: openwiki-source-81590679ef53145be3061fc1
    resource: repo://celery/concurrency/asynpool.py
  - id: openwiki-source-799e2e026f2aa536a3206b1f
    resource: repo://celery/concurrency/base.py
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
  - id: openwiki-source-cd5b25b412e425989370ceb9
    resource: repo://celery/worker/components.py
  - id: openwiki-source-12d3bd623a53e489a785c641
    resource: repo://celery/worker/worker.py
generated: { by: "claude-code", at: "2026-11-16T17:05:29.073Z" }
---

# Concurrency Pools

The pool is where task code actually runs. The worker's `Pool` bootstep (`celery/worker/components.py`) instantiates the class chosen with `-P/--pool` (or `worker_pool`, default `prefork`) and the request layer submits work with `pool.apply_async(trace_fn, args, callback=..., accept_callback=..., timeout_callback=..., soft_timeout=..., timeout=...)` (see [Request Lifecycle](request-lifecycle.md)).

## Selecting a pool

`celery.concurrency.get_implementation(name)` resolves aliases from `ALIASES`:

| Alias | Class | Execution model |
|-------|-------|-----------------|
| `prefork` (default; `processes` compat) | `celery.concurrency.prefork:TaskPool` | Child processes (billiard) |
| `threads` | `celery.concurrency.thread:TaskPool` | `concurrent.futures.ThreadPoolExecutor` |
| `eventlet` | `celery.concurrency.eventlet:TaskPool` | Green threads (`GreenPool`) |
| `gevent` | `celery.concurrency.gevent:TaskPool` | Greenlets (`gevent.pool.Pool`) |
| `solo` | `celery.concurrency.solo:TaskPool` | Inline in the worker's main thread, one at a time |
| `custom` | `$CELERY_CUSTOM_WORKER_POOL` | Out-of-tree `BasePool` subclass |

Eventlet/gevent must be selected on the **command line**: `celery.__main__` monkey-patches the process before importing anything when it sees `-P eventlet|gevent` (setting them via `worker_pool` triggers a warning). Concurrency defaults to the CPU count.

## The `BasePool` contract (`celery/concurrency/base.py`)

- Lifecycle: `start()`/`on_start()`, `stop()`/`on_stop()`, `terminate()`/`on_terminate()`, `close()`, `restart()`, `did_start_ok()`.
- Work: `apply_async(target, args, kwargs, **options)` → `on_apply(...)`; `apply_target()` is the in-pool helper that calls `accept_callback(pid, time)`, runs the target, and invokes `callback(ret)`, converting unexpected `BaseException`s into `WorkerLostError` failures.
- Optional hooks: `register_with_event_loop(hub)`, `on_soft_timeout`, `on_hard_timeout`, `maintain_pool`, `terminate_job(pid, signal)`, `grow`/`shrink`, `flush`.
- Flags: `is_green`, `signal_safe`, `uses_semaphore`, `task_join_will_block` (default `True`; used to forbid `result.get()` in tasks — see [Result Objects](../results/result-objects.md#deadlock-prevention)), `body_can_be_buffer`.
- `info`/`num_processes` feed `celery inspect stats`.

## Prefork

`prefork.TaskPool` wraps billiard. On `on_start` it picks:

- `AsynPool` (`celery/concurrency/asynpool.py`) when the worker runs the **event loop** (default on non-Windows with an async-capable transport such as AMQP/Redis), or
- billiard's blocking `Pool` (with result-handler threads) otherwise (`threads=True`, e.g. Windows or transports without async support).

Both are created with `initializer=process_initializer`, `on_process_exit=process_destructor`, `enable_timeouts=True`, `maxtasksperchild` (`worker_max_tasks_per_child`), `max_memory_per_child`, hard/soft timeouts, `lost_worker_timeout` (`worker_lost_wait`), `proc_alive_timeout` and the scheduling strategy.

### Child process initialization (`process_initializer`)

In every child: set `PDEATHSIG=SIGKILL` so children die with the parent, set `task_join_will_block`, reset/ignore signals (children ignore `SIGINT`), set the process title, run `loader.init_worker()`/`init_worker_process()`, set up logging (re-done per child if the log file contains `%i`), install worker optimizations (or set the app current/default and finalize), **pre-build a tracer for every registered task**, reset worker state, and send `worker_process_init`. `process_destructor` sends `worker_process_shutdown`. With AsynPool, `worker_before_create_process` fires in the parent (followed by `gc.collect()`) before each child is forked.

### AsynPool

AsynPool is a non-blocking rewrite of `multiprocessing.Pool` driven by the worker's kombu `Hub`:

- Each child has its own inqueue/outqueue pipes (plus an optional synq); the parent registers their file descriptors with the hub and writes pickled jobs with non-blocking writes from an `outbound_buffer`, reading results via a `ResultHandler` callback rather than a thread.
- **Scheduling strategy** (`-O`): `fair` (the default, also used for `default`) only writes a job to a child that is not busy, avoiding head-of-line blocking behind long tasks; `fcfs`/`fast` writes to any child with a writable pipe.
- Before writing, jobs for revoked tasks are discarded and acked.
- Time limits are implemented with hub timers (`call_later`) per job: a soft timeout sends the soft-timeout signal (`SoftTimeLimitExceeded` raised inside the task), then schedules the hard timeout which terminates the child.
- `on_process_up`/`on_process_down` maintain fd mappings as children are replaced (after `max_tasks_per_child`, memory limits, crashes). Dead children with jobs in progress produce `WorkerLostError` for those jobs.
- `flush()` on shutdown drains pending writes; `on_stop` keeps firing hub timers in a helper thread while joining children so timeouts still apply during warm shutdown.

## Thread pool

`thread.TaskPool` submits `apply_target` to a `ThreadPoolExecutor(max_workers=concurrency)`. It is `signal_safe = False`, has no per-task time limit enforcement, and shares the process (and GIL) with the consumer. Shutdown cancels queued futures.

## Green pools (eventlet, gevent)

- Use `GreenPool`/`gevent.pool.Pool` sized by concurrency, a green `Timer`, `is_green = True`, `signal_safe = False`, and `task_join_will_block = False`.
- gevent supports a per-task hard timeout via `gevent.Timeout` (`apply_timeout`) and can kill individual greenlets (`terminate_job`) for `revoke(terminate=True)`; `grow`/`shrink` resize the pool.
- The worker does not use the hub event loop with green pools; the consumer runs the synchronous loop inside a green thread.
- Embedded beat (`-B`) is refused with green pools.

## Solo pool

`solo.TaskPool` runs tasks inline (`on_apply = apply_target`) with concurrency 1 and sends `worker_process_init` at construction. While a task runs, the worker cannot process other messages, heartbeats or control commands — useful for debugging and some constrained environments.

## Autoscaling

`--autoscale=max,min` enables the `WorkerComponent` bootstep (`celery/worker/autoscale.py`) which creates an `Autoscaler`:

- Target size = number of reserved requests (`state.reserved_requests`), clamped to `[min, max]`.
- Scale up immediately (`pool.grow`); scale down only if no scale-up happened within `keepalive` seconds (`AUTOSCALE_KEEPALIVE`, default 30) and only idle processes are shrunk.
- With the event loop it runs on each task message and on a repeating hub timer; otherwise as a background thread checking every second.
- `autoscale` remote control updates min/max at runtime and adjusts the consumer's prefetch count accordingly.

`pool_grow`/`pool_shrink` remote control commands resize the pool manually (see [Remote Control](remote-control.md)).

## Tests

- `t/unit/concurrency/` — `test_prefork.py`, `test_pool.py`, `test_eventlet.py`, `test_gevent.py`, `test_thread.py`, `test_solo.py`, `test_concurrency.py`.
- `t/unit/worker/test_autoscale.py`.

## Related

- [Worker Architecture and Bootsteps](worker-architecture.md)
- [Task Request Lifecycle in the Worker](request-lifecycle.md)
