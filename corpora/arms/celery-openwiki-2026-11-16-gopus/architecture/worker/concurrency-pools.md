---
type: architecture
title: Concurrency Pools and Autoscaling
description: How the worker executes tasks through pluggable pools — prefork (billiard AsynPool), threads, eventlet, gevent and solo — including pool selection, monkey patching, time limits, child recycling, scheduling strategy and the autoscaler.
tags: [concurrency, pool, prefork, billiard, eventlet, gevent, autoscale]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:57:55.789Z
sources:
  - id: openwiki-source-39b293cb4d26aec690dfc284
    resource: repo://celery/__init__.py
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
  - id: openwiki-source-e160c8ef896234d60dbce1c5
    resource: repo://celery/worker/autoscale.py
  - id: openwiki-source-cd5b25b412e425989370ceb9
    resource: repo://celery/worker/components.py
  - id: openwiki-source-448ad2fc321c5e1d8e0a93fc
    resource: repo://celery/worker/consumer/control.py
  - id: openwiki-source-328c66e40eb163230ad26cbc
    resource: repo://celery/worker/request.py
  - id: openwiki-source-12d3bd623a53e489a785c641
    resource: repo://celery/worker/worker.py
generated: { by: "claude-code", at: "2026-11-16T06:57:55.789Z" }
---

# Concurrency Pools and Autoscaling

The worker never runs task code in the consumer directly; it hands each
`Request` to an execution **pool** (`celery/concurrency/`). The pool is created
by the `Pool` bootstep (`celery/worker/components.py`) and is selected with
`-P/--pool` or the `worker_pool` setting (default `prefork`).

## Pool selection

`celery/concurrency/__init__.py` maps names to classes:

| Alias | Class | Execution model |
|-------|-------|-----------------|
| `prefork` (`processes`) | `celery.concurrency.prefork:TaskPool` | Child processes via billiard |
| `threads` | `celery.concurrency.thread:TaskPool` | `concurrent.futures.ThreadPoolExecutor` |
| `eventlet` | `celery.concurrency.eventlet:TaskPool` | Green threads |
| `gevent` | `celery.concurrency.gevent:TaskPool` | Greenlets |
| `solo` | `celery.concurrency.solo:TaskPool` | Inline in the worker's main thread, concurrency 1 |
| `custom` | value of `CELERY_CUSTOM_WORKER_POOL` | Out-of-tree `BasePool` subclass |

**Green pools must be chosen with `-P` on the command line.** `celery/__main__.py`
calls `maybe_patch_concurrency()` before anything else is imported; it looks for
`-P`/`--pool` in `argv` and runs `eventlet.monkey_patch()` or
`gevent.monkey.patch_all()`. Selecting them through `worker_pool` only emits
`W_POOL_SETTING` because the patches would be applied too late.
`EVENTLET_NOBLOCK` enables eventlet's hub blocking detection.

Concurrency defaults to `os.cpu_count()` (fallback 2) when `-c` /
`worker_concurrency` is unset.

## BasePool contract

`celery/concurrency/base.py:BasePool` defines the interface used by
`Request.execute_using_pool`:

- `apply_async(target, args, kwargs, callback, accept_callback, timeout,
  soft_timeout, ...)` → `on_apply(...)`.
- Lifecycle: `start()` / `on_start`, `stop()` / `on_stop`, `terminate()`,
  `restart()`, `grow(n)`, `shrink(n)`, `terminate_job(pid, signal)`,
  `register_with_event_loop(hub)`, `info`/`_get_info`.
- Capability flags read by the worker: `is_green`, `signal_safe`,
  `uses_semaphore`, `task_join_will_block` (whether `result.get()` inside a
  task would deadlock; the `Pool` step publishes it via
  `_set_task_join_will_block`), `body_can_be_buffer`.

`apply_target()` runs a target in-process, calls `accept_callback(pid, time)`
before execution and `callback(ret)` afterwards; any non-`Exception`
`BaseException` other than `WorkerShutdown`/`WorkerTerminate` is converted to a
`WorkerLostError`. The solo and thread pools use it directly.

## Prefork

`prefork.TaskPool.on_start()` creates either:

- **`AsynPool`** (`celery/concurrency/asynpool.py`) – when the worker uses the
  kombu event loop (`threaded=False`). This is the normal mode with
  AMQP/Redis transports on non-Windows systems
  (`WorkController.should_use_eventloop`: default environment, transport
  implements asynchronous I/O, not Windows).
- **billiard's blocking `Pool`** – otherwise (`threads=True`), with its
  internal handler threads.

Each child runs `process_initializer(app, hostname)`:

1. `set_pdeathsig('SIGKILL')` so children die with the parent;
2. sets `task_join_will_block` (so `result.get()` in a task raises);
3. resets/ignores worker signals and sets the process title;
4. runs the loader's `init_worker` / `init_worker_process` and sets up
   logging from `CELERY_LOG_*` environment variables;
5. makes the app current/default, finalizes it, rebuilds every task's
   `__trace__` with `build_tracer`, and resets worker state;
6. sends `worker_process_init`.

`process_destructor` sends `worker_process_shutdown` when a child exits.

### AsynPool

`AsynPool` subclasses billiard's pool but integrates with the worker's
`Hub` instead of using helper threads:

- Each child gets its own non-blocking in/out pipes
  (`create_process_queues`), and job payloads are pickled and written by
  generators registered as hub writers, so the worker's single thread can feed
  many children without blocking. Results are read by `ResultHandler`
  callbacks on the hub.
- **Scheduling strategy** (`-O/--optimization`): `fair`
  (default) only writes to idle children, so a long task does not block
  short tasks queued behind it in one child's pipe; `fcfs`/`fast` writes to
  any writable pipe.
- **Time limits:** `on_timeout_set` schedules `call_later` timers on the hub:
  the soft limit (`--soft-time-limit`, `task_soft_time_limit`) signals the
  child so `SoftTimeLimitExceeded` is raised inside the task; the hard limit
  (`--time-limit`, `task_time_limit`) terminates the child. The parent's
  `Request.on_timeout` marks the task failed with `TimeLimitExceeded` and
  runs failure handlers/errbacks.
- **Recycling:** `worker_max_tasks_per_child` and
  `worker_max_memory_per_child` replace children after N tasks / when RSS
  exceeds the limit; `maintain_pool` restarts dead children. A child that
  dies mid-task yields `WorkerLostError` (`Request.on_failure`), and the
  message is requeued or rejected per `acks_late` /
  `task_reject_on_worker_lost`.
- `worker_proc_alive_timeout` bounds how long the parent waits for a new
  child's `WORKER_UP` message.

When the worker uses the event loop, the `Pool` step also creates a
`LaxBoundedSemaphore(concurrency)` and, with `pool_putlocks`, routes requests
through `_process_task_sem` so no more requests are submitted than there are
processes.

## Threads, solo, eventlet, gevent

- **threads** – `ThreadPoolExecutor(max_workers=concurrency)`; tasks run
  through `apply_target`. `signal_safe = False`; there are no per-task time
  limits.
- **solo** – `on_apply = apply_target`, limit fixed at 1; the task runs
  synchronously in the consumer thread, which therefore stops consuming (and
  replying to remote control) while a task runs. Sends
  `worker_process_init` on creation.
- **eventlet / gevent** – `is_green = True`, `task_join_will_block = False`.
  Tasks are spawned as green threads (`spawn_n` / `spawn_raw`) into a pool
  that can `grow`/`shrink`; `terminate_job` kills the greenlet. The gevent
  pool applies the hard time limit with `gevent.Timeout`. Green pools cannot
  embed beat (`-B`), and remote control uses the green `gPidbox`.

## Autoscaler

`celery/worker/autoscale.py`, enabled with `--autoscale=max,min`:

- `WorkerComponent` (conditional bootstep requiring `Pool`) creates an
  `Autoscaler`. With the event loop it is driven from the hub
  (`call_repeatedly(keepalive, maybe_scale)` plus a hook on every received task
  message); otherwise it runs as a background thread polling every second.
- `_maybe_scale` compares the number of reserved requests (`qty`) with
  the current process count: it grows up to `max_concurrency` immediately, and
  shrinks toward `min_concurrency` only after `AUTOSCALE_KEEPALIVE` (default
  30 s, env var) since the last scale-up. Shrinking fails quietly if all
  processes are busy.
- `update(max, min)` (remote control `autoscale`) also adjusts the consumer
  prefetch count by the change in `max`.

## Tests

- `t/unit/concurrency/test_prefork.py`, `test_pool.py` – prefork pool and
  AsynPool helpers.
- `t/unit/concurrency/test_eventlet.py`, `test_gevent.py`,
  `test_thread.py`, `test_solo.py`, `test_concurrency.py` (BasePool).
- `t/unit/worker/test_autoscale.py`.

See also: [Worker bootsteps](worker-bootsteps.md),
[Execution tracing](task-execution-trace.md).
