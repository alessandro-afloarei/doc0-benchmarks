---
type: architecture
title: Concurrency Pools
description: The worker's execution pool abstraction (BasePool) and its implementations — prefork on billiard's AsynPool, solo, threads, eventlet and gevent — including how the worker builds a pool, how requests are submitted and traced in child processes, and how timeouts, termination and lost workers are handled.
tags: [celery, concurrency, pool, prefork, gevent, eventlet, billiard, worker]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:22:47.483Z
sources:
  - id: openwiki-source-4a982797c89fcb3ea5c5d0ee
    resource: repo://celery/app/trace.py
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
generated: { by: "claude-code", at: "2026-11-16T09:22:47.483Z" }
---

# Concurrency Pools

A **pool** is where task code actually runs. The worker's `Pool` bootstep creates exactly one pool object per worker, and each received task is submitted to it as a call to a *trace* function (see [[/openwiki/workflows/task-lifecycle.md]]). Pool code is in `celery/concurrency/`; the consumer/bootstep side is described in [[/openwiki/architecture/worker.md]].

## Selecting a pool

`celery/concurrency/__init__.py` maps `-P/--pool` names to classes (`ALIASES`): `prefork` (and the compatibility alias `processes`), `eventlet`, `gevent`, `solo`, and `threads` (only when `concurrent.futures` is importable). An out-of-tree pool can be registered by setting `CELERY_CUSTOM_WORKER_POOL` to a `package:class` path and selecting `--pool custom`. `get_implementation` resolves names with `symbol_by_name`. Eventlet/gevent monkey-patching happens even earlier, in the CLI entrypoint (see [[/openwiki/architecture/cli.md]]).

## The `BasePool` contract

`BasePool` (`celery/concurrency/base.py`) defines the lifecycle (`start` → `RUN`, `close` → `CLOSE`, `stop`/`terminate` → `TERMINATE`) with hooks `on_start`, `on_stop`, `on_close`, `on_terminate`, and the work method `apply_async(target, args, kwargs, **options)`, which forwards to `on_apply` with `waitforslot=putlocks` and `callbacks_propagate`. Capability flags tell the rest of the worker what to expect:

- `signal_safe` — whether the pool can be shut down from inside a signal handler (false for threads/gevent/eventlet).
- `is_green` / `task_join_will_block` — greenlet pools set `is_green=True` and `task_join_will_block=False`, which the worker propagates into `celery._state` via `_set_task_join_will_block` so `AsyncResult.get()` inside tasks is allowed or rejected appropriately.
- `uses_semaphore` — only the multiprocessing pool; combined with `pool_putlocks` it makes the worker limit in-flight jobs with a bounded semaphore.
- `body_can_be_buffer` — solo and threads can receive the raw message body buffer rather than bytes.
- `info` / `_get_info` — JSON-friendly stats shown by `celery inspect stats`; `grow`/`shrink` support autoscale; `terminate_job(pid, signal)` and `restart()` raise `NotImplementedError` unless overridden.

`apply_target` is the in-process executor used by solo, threads and the green pools: it reports the accept callback with the pid and monotonic time, runs the target, and sends the result to `callback`. Exceptions deriving from `Exception` propagate (so the caller can record failure), `WorkerShutdown`/`WorkerTerminate` are re-raised, and any other `BaseException` is wrapped as billiard's `WorkerLostError` and delivered through the callback.

## How the worker creates and feeds the pool

The `Pool` bootstep (`celery/worker/components.py#L101-L178`) requires the `Hub`, parses `--autoscale max,min`, and instantiates the pool class with: `min_concurrency` as the process count, `initargs=(app, hostname)`, `maxtasksperchild`, `max_memory_per_child`, `timeout`/`soft_timeout` (task time limits), `lost_worker_timeout`, `allow_restart`, `forking_enable` and the scheduling strategy. `threaded` is true when the worker has no event loop or runs on Windows; otherwise (the normal Linux prefork case) the pool is the async, event-loop-driven variant guarded by a `LaxBoundedSemaphore` of size `concurrency`, with up to 100 restarts. Setting `worker_pool` to a green pool in config emits a warning because patching must happen via `-P` at startup.

`Request.execute_using_pool` (`celery/worker/request.py#L341-L372`) is the hand-off. It raises `TaskRevokedError` if the task is revoked, then calls `pool.apply_async(trace, args=(type, task_id, request_dict, body, content_type, content_encoding), accept_callback=on_accepted, timeout_callback=on_timeout, callback=on_success, error_callback=on_failure, soft_timeout=..., timeout=..., correlation_id=task_id)`. `trace` is `fast_trace_task` when `app.use_fast_trace_task` is enabled (set by `setup_worker_optimizations` for forked pools) and `trace_task_ret` otherwise. Both decode the message body with the app's accepted content types in the *child* and return `(1, exception_info, runtime)` on failure or `(0, result_repr, runtime)` on success. `fast_trace_task` relies on a per-process registry populated at startup and raises an explicit `RuntimeError` if it is empty (spawned rather than forked children, e.g. prefork on Windows) advising `--pool=solo` or `--pool=threads`.

## Implementations

### prefork (`celery/concurrency/prefork.py`, `asynpool.py`)

`TaskPool` wraps billiard's multiprocessing pool: the async `AsynPool` when `threads` is false (the event-loop mode) or `BlockingPool` otherwise. `on_start` builds the pool with `process_initializer` and `process_destructor` and aliases its methods (`apply_async`, `maintain_pool`, `terminate_job`, `grow`, `shrink`, `flush`) onto the `TaskPool`.

`process_initializer` runs in every child: sets `PDEATHSIG` so children die with the parent, resets/ignores signals (children ignore SIGINT so only the parent handles Ctrl-C), sets the process title, calls `app.loader.init_worker()` and `init_worker_process()`, configures logging from `CELERY_LOG_*` environment variables, finalizes and sets the app as current, **rebuilds `task.__trace__` with `build_tracer` for every registered task**, resets worker state and sends `worker_process_init`. If the child was started with exec (`FORKED_BY_MULTIPROCESSING`), `setup_worker_optimizations` is run instead.

`AsynPool` (`asynpool.py`) replaces billiard's threaded handler threads with non-blocking I/O driven by the kombu event loop (`register_with_event_loop`): it writes job payloads to child pipes with scheduled writes and fairness (`sched_strategy`), reads results and acks through `ResultHandler`, tracks child process exit through the hub, and installs soft/hard timer handlers (`_on_soft_timeout`, `_on_hard_timeout`, which call the pool's `on_soft_timeout`/`on_hard_timeout`; on the request side `Request.on_timeout` logs a soft-limit warning, and for a hard limit records a `TimeLimitExceeded` failure through `mark_as_failure` and fires the task's failure hooks). If a child dies, `on_job_process_down` re-queues jobs that were only scheduled (no bytes written) and handles partially written jobs, while `on_job_process_lost` calls `mark_as_worker_lost`, surfacing `WorkerLostError` for the task. `flush`, `human_write_stats` and queue cleanup support graceful shutdown and `inspect stats`.

`TaskPool.on_stop` closes the pool and joins it; when a hub exists it spawns a short-lived timer thread that keeps firing hub timers every 0.5s during the join so broker heartbeats continue on async transports while long tasks drain.

### solo (`solo.py`)

Runs tasks inline in the worker's own process: `on_apply = apply_target`, `limit = 1`, `body_can_be_buffer = True`. It sends `worker_process_init` at construction. No timeouts or termination, but lowest overhead and no fork — useful for containers (one process per worker) and platforms where prefork is unavailable.

### threads (`thread.py`)

Uses `concurrent.futures.ThreadPoolExecutor(max_workers=limit)`; `on_apply` submits `apply_target` and returns an `ApplyResult` wrapper. `signal_safe = False`; `on_stop` shuts the executor down cancelling pending futures. There is no per-task kill or time limit enforcement.

### eventlet and gevent (`eventlet.py`, `gevent.py`)

Greenlet pools with `is_green = True`, `signal_safe = False`, `task_join_will_block = False`. Each task is spawned into a `GreenPool`/gevent `Pool` of size `limit`; the pool also provides its own `Timer` implementation based on greenlets (`spawn_later`) so the worker's timer integrates with the green hub. `grow`/`shrink` adjust the pool semaphore for autoscale. `terminate_job` kills the greenlet recorded in `_pool_map` (keyed by greenlet id, used as the "pid"), and targets are wrapped so `GreenletExit` becomes a non-error result. When a timeout is configured gevent wraps the call in `Timeout`, invoking `timeout_callback`. Both modules warn if Celery was imported before the library was patched. Embedded beat is rejected for these pools (see [[/openwiki/architecture/beat-scheduler.md]]).

## Practical consequences

- CPU-bound tasks need prefork (or multiple worker processes); I/O-bound high concurrency fits green pools; solo/threads trade isolation for simplicity.
- Time limits (`task_time_limit`, `task_soft_time_limit`) and `terminate` revoke are fully supported only where the pool can signal or kill a child (prefork) or greenlet.
- A child killed by the OS (OOM, SIGKILL) shows up as `WorkerLostError`. `Request.on_failure` requeues the message only when the task uses `acks_late` *and* `reject_on_worker_lost` (or a timeout with `acks_on_timeout` false); otherwise the failure is recorded and the message acknowledged or dropped according to `acks_on_failure`.
