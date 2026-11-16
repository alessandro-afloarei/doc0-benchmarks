---
type: subsystem
title: Concurrency Pools and Autoscaling
description: The worker's execution pools in celery/concurrency. Covers pool selection and aliases, the BasePool contract and capability flags, the prefork pool (billiard, AsynPool with the event loop, child initializer, scheduling strategies, time limits, recycling by task count or memory), threads, solo, eventlet/gevent green pools, custom pools, and the autoscaler.
tags: [concurrency, prefork, billiard, asynpool, eventlet, gevent, threads, autoscale]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:49.645Z
sources:
  - id: openwiki-source-03401290efe2e461d5c3013a
    resource: repo://celery/concurrency/__init__.py
  - id: openwiki-source-81590679ef53145be3061fc1
    resource: repo://celery/concurrency/asynpool.py
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
  - id: openwiki-source-cd5b25b412e425989370ceb9
    resource: repo://celery/worker/components.py
generated: { by: "claude-code", at: "2026-11-15T17:08:49.645Z" }
---

# Concurrency Pools and Autoscaling

The worker's `Pool` bootstep (`worker/components.py`) creates one **task pool**. `Request.execute_using_pool` submits work to it (see [Consumer, Strategies and Task Requests](consumer-and-requests.md)). The pool decides *where* task bodies run: child processes, threads, greenlets, or the main thread.

## Selection

`-P/--pool` or `worker_pool` (default `prefork`) is resolved by `celery.concurrency.get_implementation` through these aliases:

| Alias | Class | Execution |
|---|---|---|
| `prefork` (`processes`) | `concurrency/prefork.py:TaskPool` | billiard child processes |
| `threads` | `concurrency/thread.py:TaskPool` | `concurrent.futures.ThreadPoolExecutor` |
| `solo` | `concurrency/solo.py:TaskPool` | inline in the consumer's thread, concurrency 1 |
| `eventlet` / `gevent` | `concurrency/eventlet.py`, `gevent.py` | greenlet pools |
| `custom` | `$CELERY_CUSTOM_WORKER_POOL` (`module:Class`) | any `BasePool` subclass |

Green pools must be chosen on the **command line** (`-P eventlet` or `-P gevent`), because `celery/__main__.py` monkey-patches before importing anything else (see [CLI](../operations/cli.md)). Setting them via `worker_pool` triggers a warning. `-c/--concurrency` (`worker_concurrency`) defaults to the CPU count.

## `BasePool` contract (`concurrency/base.py`)

- Lifecycle: `start()` → `on_start`, `stop()` → `on_stop`, `terminate()`, `restart()`, `close()`. Optional methods include `register_with_event_loop(hub)`, `grow(n)`/`shrink(n)`, `terminate_job(pid, sig)`, `maintain_pool`, `flush`, and `info`/`_get_info` (shown by `inspect stats`).
- `apply_async(target, args, kwargs, callback=, error_callback=, accept_callback=, timeout_callback=, soft_timeout=, timeout=, correlation_id=)` calls `on_apply`. The default `apply_target` runs `target` inline and invokes the accept and result callbacks.
- Capability flags read by the worker:
  - `uses_semaphore` (prefork): `Request` submission is gated by a `LaxBoundedSemaphore` sized to the concurrency;
  - `is_green`;
  - `signal_safe`: False for threads and green pools;
  - `task_join_will_block`: True except for green pools. It is copied into the global flag that forbids `result.get()` in tasks;
  - `body_can_be_buffer` (solo and threads): the raw message body can be passed through without copying.

## Prefork pool

`prefork.TaskPool.on_start` creates either a **`BlockingPool`** (plain billiard `Pool` with helper threads), used when the worker has no event loop (Windows, or a transport without async I/O), or an **`AsynPool`** (`concurrency/asynpool.py`), which is non-blocking and integrated into the worker's kombu `Hub`. Both are created with:

- `processes = concurrency` (or the autoscaler minimum), `maxtasksperchild=worker_max_tasks_per_child`, `max_memory_per_child=worker_max_memory_per_child` (KiB resident; the child is replaced after the task that exceeds it);
- `timeout` and `soft_timeout` from `task_time_limit` and `task_soft_time_limit`. Per-task limits arrive through `Request`;
- `lost_worker_timeout=worker_lost_wait`, `proc_alive_timeout=worker_proc_alive_timeout` (a child that hasn't reported `WORKER_UP` within this time is killed and replaced), and `allow_restart=worker_pool_restarts` (enables `pool_restart` remote control).

**Child initialization** (`process_initializer`), in every forked child:

1. sets `PDEATHSIG=SIGKILL`, so children die with the parent, and sets `task_join_will_block = True`;
2. resets and ignores worker signals and sets the process title;
3. runs `loader.init_worker()` and `init_worker_process()`, then reconfigures logging (with per-child log files when `%i` is in the path);
4. makes the app current and default and finalizes it. With execv/spawn (`FORKED_BY_MULTIPROCESSING`), it runs the full `setup_worker_optimizations`;
5. rebuilds every task's tracer, resets worker state, and sends `worker_process_init`.

`process_destructor` sends `worker_process_shutdown` with the PID and exit code.

**AsynPool mechanics:**

- Each child gets its own pipe set (an in-queue, an out-queue, and an optional syn-queue). The parent's hub watches the file descriptors. Jobs are pickled and **written non-blockingly** by generator-based writers.
- Results are read from the out-queues by the event loop rather than by a result thread.
- A job is sent only to an idle child. `_busy_workers` tracks busy file descriptors.
- **Scheduling strategy** (`-O`, `sched_strategy`):
  - `fair` (default): write only to children that are not busy, so a long task never has short tasks queued behind it in its pipe;
  - `fast`/`fcfs`: write to any child with a writable pipe.
- Jobs revoked while still buffered are acked as terminated instead of being written (`_put_back`).
- Time limits are timers in the hub. On the soft limit, billiard signals the child so that `SoftTimeLimitExceeded` is raised inside the task, and a hard-limit timer is armed for the remaining time. On the hard limit the child is killed and the job fails with `TimeLimitExceeded`.
- Lost children (killed or segfaulted) fail their job with `WorkerLostError`, and new children are spawned (`maintain_pool`). How the message is acked depends on `acks_late` and `reject_on_worker_lost`.
- On stop, the pool closes and joins. A helper thread keeps firing hub timers, so async transport heartbeats continue while long tasks drain.

## Threads, solo, and green pools

- **threads:** `ThreadPoolExecutor(max_workers=concurrency)`. Results come through futures. Hard and soft time limits are **not enforced**, and termination cannot interrupt a running thread. `signal_safe=False`.
- **solo:** runs each task synchronously in the consumer's thread, with concurrency fixed at 1. It sends `worker_process_init` once at construction. While a task runs, the worker cannot consume, heartbeat, or answer remote control. It is useful for debugging and for Windows.
- **eventlet/gevent:** greenlet pools sized by `-c` (often hundreds). Suitable for I/O-bound tasks. `task_join_will_block=False`, so green tasks may wait on results. They use a green timer. Embedded beat (`-B`) is rejected. Time limits are implemented with green timeouts. Eventlet sends `eventlet_pool_*` signals.

## Autoscaling (`worker/autoscale.py`)

`--autoscale=max,min` enables the `Autoscaler` bootstep. With the event loop it runs on every task message and every `keepalive` seconds from the hub. Without the event loop it runs in a background thread that checks every second. Each check compares the number of reserved requests (`qty = len(state.reserved_requests)`) to the pool size:

- **Scale up** immediately, up to `max`.
- **Scale down** to `max(qty, min)` only if no scale-up happened within `AUTOSCALE_KEEPALIVE` seconds (environment variable, default 30). This avoids flapping. Shrinking skips busy processes, and if every process is busy it logs and waits.
- `update(max, min)` (remote control `autoscale`) also adjusts the consumer prefetch count by the change in `max`.
- The class is configurable with `worker_autoscaler`. It requires a pool that implements `grow` and `shrink`, which in practice means prefork.

## Tests

- `t/unit/concurrency/`: `test_prefork.py` (initializer, AsynPool handlers, scheduling), `test_pool.py`, `test_thread.py`, `test_solo.py`, `test_eventlet.py`, `test_gevent.py`, `test_concurrency.py` (base contract).
- `t/unit/worker/test_autoscale.py`.

## See also

- [Worker Architecture and Bootsteps](worker-architecture.md)
- [Consumer, Strategies and Task Requests](consumer-and-requests.md)
