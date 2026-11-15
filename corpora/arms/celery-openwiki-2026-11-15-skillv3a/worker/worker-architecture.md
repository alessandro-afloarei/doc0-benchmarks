---
type: architecture
title: Worker Architecture and Bootsteps
description: How a Celery worker process is assembled and run. Covers the WorkController and its blueprint, the bootsteps framework (Blueprint, Step, StartStopStep, ConsumerStep, dependency ordering), the worker components (Timer, Hub, Pool, Beat, StateDB, Autoscaler, Consumer), the apps/worker.py program wrapper (banner, privilege check, signal handlers), and warm, cold, soft, and hard shutdown.
tags: [worker, bootsteps, workcontroller, shutdown, signals, components]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:49.645Z
sources:
  - id: openwiki-source-3cfd5f9bf00aaf6b49d01291
    resource: repo://celery/apps/worker.py
  - id: openwiki-source-7c9db0d3259470539a2d0756
    resource: repo://celery/bootsteps.py
  - id: openwiki-source-7a844ae59c546297a34da340
    resource: repo://celery/worker/state.py
  - id: openwiki-source-12d3bd623a53e489a785c641
    resource: repo://celery/worker/worker.py
generated: { by: "claude-code", at: "2026-11-15T17:08:49.645Z" }
---

# Worker Architecture and Bootsteps

A worker is a `WorkController` (`celery/worker/worker.py`). It is assembled from **bootsteps**: small components with declared dependencies that are started in dependency order and stopped in reverse. `celery worker` instantiates `app.Worker`, the `celery.apps.worker.Worker` subclass that adds program behaviour (logging, banner, signals) (see [CLI](../operations/cli.md)). Tests and embedded uses can use `WorkController` directly (`celery/contrib/testing/worker.py`).

```
WorkController (Blueprint "Worker")
├─ Timer         – kombu timer, or a pool-specific timer when there is no event loop
├─ Hub           – kombu async event loop (only if use_eventloop)
├─ Pool          – concurrency pool (+ semaphore)           → Concurrency Pools page
├─ Beat          – embedded beat (-B), optional
├─ StateDB       – persistent revoked set (--statedb), optional
├─ Autoscaler    – (--autoscale), optional
└─ Consumer      – nested Blueprint "Consumer" (last)       → Consumer page
     ├─ Connection, Mingle, Events, Gossip, Heart, Control, Tasks,
     └─ DelayedDelivery, Evloop (last), Agent
```

## Bootsteps framework (`celery/bootsteps.py`)

- **`Blueprint(steps, on_start, on_close, on_stopped)`** combines `default_steps` with user steps (`app.steps['worker']` or `app.steps['consumer']`). `apply(parent, **kwargs)` resolves step classes (`symbol_by_name`), builds a `DependencyGraph` from each step's `requires`, makes the step marked `last=True` depend on all the others, and **topologically sorts** the graph. An unknown dependency raises `KeyError('unknown bootstep: ...')`. Each step is then instantiated with `(parent, **kwargs)`, and its `include(parent)` decides whether it joins `parent.steps`.
- **`Step`**:
  - `__init__(parent, **kw)` can set attributes on the parent at construction time;
  - `include_if(parent)` defaults to `self.enabled`, and many steps set `enabled` from options such as `--without-gossip`;
  - `create(parent)` builds the component;
  - `name` defaults to the qualified class name, and `label` is the short name used in logs and graphs.
- **`StartStopStep`** stores the created object as `self.obj` and calls its `start`, `stop`, or `terminate`. **`ConsumerStep`** is a consumer-blueprint step that opens a channel and starts the kombu consumers returned by `get_consumers(channel)`.
- **`Blueprint.start`** sets `RUN`, calls `on_start`, then starts the steps in order, recording progress in `started`. **`stop(terminate=False)`** does nothing if the blueprint is already closing. If not all steps had started, it sets `TERMINATE` immediately. Otherwise it closes, then sends `stop` or `terminate` to the steps in reverse order, logging errors without propagating them, then calls `on_stopped` and signals `shutdown_complete`.
- `celery graph bootsteps` renders the graph.

Custom steps are a primary extension seam (see [Extension Seams](../extensions/contrib-utilities.md)). A step can add CLI options through `app.user_options['worker']` and read them in `__init__`.

## `WorkController` construction

1. `app.loader.init_worker()` imports default modules, which runs autodiscovery and Django setup.
2. `setup_defaults(...)` resolves every option against configuration with `app.either(setting, arg)`: concurrency, pool, prefetch, time limits, max tasks or memory per child, statedb, timers, and so on.
3. `setup_instance`:
   - selects queues (`-Q`/`-X`, plus `worker_direct`);
   - imports `--include` modules and records all task modules in `conf.include`, so execv children re-import them;
   - defaults concurrency to `cpu_count()`;
   - decides `use_eventloop`: true when the environment is not green, the transport supports async I/O, and the platform is not Windows;
   - sends `worker_init`;
   - resolves `pool_cls`, then builds and `apply()`s the blueprint.
4. `apps.worker.Worker.on_before_init` runs `trace.setup_worker_optimizations`, sends `celeryd_init`, and calls **`check_privileges(accept_content)`**, which refuses root plus pickle unless `C_FORCE_ROOT` is set (see [Deployment](../operations/deployment.md)). `on_init_blueprint` sets up logging and re-applies the trace optimizations, which finalizes the app.

## Running

`WorkController.start()` runs `blueprint.start(self)`. The `Consumer` step is last, and its own `Evloop` step blocks in the event loop until shutdown.

- `on_start` (program wrapper): creates the pidlock, sends `celeryd_after_setup`, purges queues if `--purge`, prints the **startup banner** (app, transport, results, concurrency, task events, queues, and the task list at DEBUG), installs signal handlers, and redirects stdout and stderr to the logger (`worker_redirect_stdouts`).
- When the consumer is ready, `worker_ready` is sent.
- `WorkController._process_task(req)` is the consumer's `on_task_request`. It calls `req.execute_using_pool(self.pool)`. With prefork and the event loop it goes through `_process_task_sem` and the pool semaphore.
- `reload()` (remote `pool_restart`) re-imports or reloads task modules, rebuilds strategies and rate limits, and restarts the pool.
- `info()` and `rusage()` feed `inspect stats`.

## Shutdown modes

Shutdown is driven by flags in `celery/worker/state.py`. Signal handlers set `should_stop` (warm) or `should_terminate` (cold), and the event loop's `maybe_shutdown()` raises `WorkerShutdown` or `WorkerTerminate`. `WorkController.start()` turns these into `stop()` (warm) or `terminate()` (cold). If the pool isn't signal-safe and the call happens inside a signal handler, the blueprint shutdown is deferred.

| Trigger | Mode | Behaviour |
|---|---|---|
| `SIGTERM` | **Warm** | Stop consuming, let running tasks finish, then stop the pool and the steps in reverse. Further SIGTERMs only print a message. |
| `SIGINT` (Ctrl+C) | Warm first | The first Ctrl+C starts a warm shutdown and replaces itself with the cold handler ("hit Ctrl+C again..."). |
| `SIGQUIT`, or a second Ctrl+C | **Cold** | Optional **soft** phase first: if `worker_soft_shutdown_timeout > 0` and tasks are running (or `worker_enable_soft_shutdown_on_idle`), it waits up to that many seconds. It then cancels the task consumer, which stops new deliveries so requeued messages aren't immediately redelivered, cancels unacked active requests so late-ack tasks are requeued, sets `should_terminate`, and stops the pool so tasks that already finished can still run their success handling. |
| Signal during the soft or cold phase | | Cancels all unacked requests right away and arms the **hard** handler. |
| Next signal | **Hard** | Raises `WorkerTerminate(EX_FAILURE)` immediately. |
| `REMAP_SIGTERM=SIGQUIT` (billiard env) | | Makes SIGTERM behave like SIGQUIT (cold), which is useful on platforms that send SIGTERM before SIGKILL with short grace periods. |
| `SIGHUP` (detached only) | Restart | Re-executes the worker via `atexit` after a warm stop. On macOS a warning is shown instead. |
| `SIGUSR1` | — | Dumps the stack traces of all threads (`cry`). |
| `SIGUSR2` (with `CELERY_RDBSIG`) | — | Opens an rdb breakpoint. |

Every handler sends `worker_shutting_down`, and `worker_shutdown` is sent after stopping. Pool children ignore or reset these signals (prefork's `WORKER_SIGIGNORE` and `WORKER_SIGRESET`). With **late acks**, a cold shutdown requeues unfinished messages. With early acks, tasks interrupted by a cold shutdown are lost. See [Consumer](consumer-and-requests.md) for `cancel_active_requests`.

## Global worker state

`celery/worker/state.py` holds the module-level request maps, revoked sets, counters, and shutdown flags, together with the `Persistent` statedb. Pool children reset it after forking (`reset_state`). See [Remote Control](remote-control.md#worker-state-celeryworkerstatepy).

## Tests

- `t/unit/worker/test_worker.py` (WorkController and the shutdown matrix), `test_bootsteps.py` (graph ordering, include, and stop semantics), `test_components.py`, and `test_state.py`.
- `t/unit/bin/test_worker.py` (signal handlers and the program wrapper).
- `t/smoke/tests/test_worker.py` (real warm, cold, and soft shutdown with containers).

## See also

- [Consumer, Strategies and Task Requests](consumer-and-requests.md)
- [Concurrency Pools and Autoscaling](concurrency-pools.md)
- [Remote Control and Inspection](remote-control.md)
