---
type: architecture
title: Concurrency Pools
description: The worker's pluggable execution pools (prefork, solo, thread, eventlet, gevent), the shared BasePool interface they implement, how the worker selects one, and what each implies for task isolation, timeouts, and shutdown.
tags: [celery, worker, concurrency, pool, prefork, eventlet, gevent, threads]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:42:35.525Z
sources:
  - id: openwiki-source-03401290efe2e461d5c3013a
    resource: repo://celery/concurrency/__init__.py
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
generated: { by: "claude-code", at: "2026-11-16T10:42:35.525Z" }
---

# Concurrency Pools

A worker does not run tasks itself. It hands each accepted task to a *pool*, and the pool decides where the call executes: in a child process, a thread, a greenlet, or inline in the main thread. All pools implement the same interface defined by `BasePool` in `celery/concurrency/base.py`, so the worker's consumer logic does not depend on the execution model.

## Responsibility and ownership

Each pool module exposes a `TaskPool` class. The pool owns:

- the execution slots (processes, threads, or greenlets) and their limit;
- dispatch of `apply_async` / `on_apply` calls to a slot;
- lifecycle hooks (`on_start`, `on_stop`, `on_terminate`, `on_close`);
- timeout enforcement hooks (`on_soft_timeout`, `on_hard_timeout`, `terminate_job`);
- reporting (`info`, `num_processes`, `active`).

The worker's request handling (see [the worker](worker.md)) and the trace function that runs inside the slot (see [tasks and tracing](tasks-and-tracing.md)) are shared across pools.

## The BasePool contract

`BasePool` (`celery/concurrency/base.py`) defines:

- class flags that describe the pool to the worker: `signal_safe` (can be shut down from a signal handler), `is_green` (uses greenlets), `uses_semaphore`, `task_join_will_block`, and `body_can_be_buffer`;
- the lifecycle methods `start`, `stop`, `terminate`, `close`, and their `on_*` counterparts;
- `apply_async(target, args, kwargs, **options)`, which logs at debug level and delegates to `on_apply`, passing `waitforslot` and `callbacks_propagate`;
- `_get_info` and `info` for `celery inspect stats` output.

`on_apply` is the method each pool overrides. `BasePool.__init__` takes `limit` (the concurrency), `putlocks`, `forking_enable`, `callbacks_propagate`, and the application, and stores any extra options for the concrete pool.

## Pool implementations

Pool names resolve through `celery/concurrency/__init__.py`, which maps `prefork`, `eventlet`, `gevent`, and `solo` to their `TaskPool` classes, adds `processes` as a compatibility alias for `prefork`, and adds `threads` when `concurrent.futures` is available. An out-of-tree pool can be loaded by setting `CELERY_CUSTOM_WORKER_POOL` to a `package:class` path.

### prefork (default)

`celery/concurrency/prefork.py` wraps a process pool. On start it chooses between two implementations:

- `AsynPool` (`celery/concurrency/asynpool.py`), a process pool integrated with the worker's event loop. It tracks child processes, registers readers on the hub, and implements soft and hard timeouts (`_on_soft_timeout`, `_on_hard_timeout`).
- `BlockingPool`, a multiprocessing-based pool used when the worker is not running an event loop.

The worker picks the non-event-loop path when `use_eventloop` is false (or on Windows), which is passed to the pool as `threads=threaded`. Prefork uses `uses_semaphore = True` and implements `num_processes` and `_get_info`. Each task runs in a separate child process, so a crash or memory leak in task code affects only that child; `max_tasks_per_child` and `max_memory_per_child` recycle children.

### solo

`celery/concurrency/solo.py` runs `apply_target` inline in the main process with a limit of 1 and `body_can_be_buffer = True`. It is blocking and simple, suitable for debugging and for tests. A timeout or a crash is handled by the worker process itself, so it provides no isolation.

### thread

`celery/concurrency/thread.py` wraps a `concurrent.futures.ThreadPoolExecutor`. `on_apply` submits `apply_target` and wraps the future in an `ApplyResult`. `signal_safe = False`. The class also overrides `on_stop` to tear down the executor.

### eventlet and gevent

`celery/concurrency/eventlet.py` and `celery/concurrency/gevent.py` use greenlets with `is_green = True` and `task_join_will_block = False`. Each provides its own `Timer` subclass that schedules work on the green hub and a `TaskPool` whose `on_apply` spawns a greenlet, records it in `_pool_map` keyed by its ID, and removes it on completion (`_add_to_pool_map`, `_cleanup_after_job_finish`). Both implement `grow` and `shrink` by resizing the underlying pool, and `terminate_job` by killing the greenlet. Monkeypatching of the standard library happens early in process startup (see [the Celery package entrypoint](../operations/cli.md)), so these pools are only correct when that patching has run.

## Selection and configuration

The `celery worker` command takes `-P/--pool` with a default of `prefork`; `worker_pool` is the matching configuration key. The worker's `Pool` bootstep (`celery/worker/components.py`, around lines 140–165) instantiates the chosen class with the minimum concurrency, `putlocks`, `maxtasksperchild`, `max_memory_per_child`, soft and hard time limits, and `threads=threaded`. `worker_concurrency` sets the number of slots when the CLI option is not given.

## Invariants and failure behaviour

- A slot executes one task at a time, except for the thread and green pools, where the limit bounds concurrency.
- `signal_safe` tells the worker whether it may stop the pool from a signal handler. Thread pools set it to false.
- Timeout handling differs by pool: prefork kills the child process, while green pools terminate the greenlet and thread pools cannot forcibly stop a running thread.
- When a child process dies, the prefork pool replaces it (`maintain_pool`), subject to `allow_restart` and `max_restarts`.

## Extension seams

- Subclass `celery.concurrency.base.BasePool` (or a concrete `TaskPool`) and point `CELERY_CUSTOM_WORKER_POOL` at it.
- `BasePool.on_apply` is the single override point for dispatch; the lifecycle hooks are optional.

## Representative tests

`t/unit/concurrency/` contains per-pool tests (prefork, solo, thread, eventlet, gevent, and the base interface), and `t/integration/test_worker.py` exercises real worker runs.
