---
type: architecture
title: Worker Architecture and Bootsteps
description: How a Celery worker process is assembled and run — the bootsteps Blueprint/Step/StartStopStep dependency system, WorkController initialisation and its default components (Timer, Hub, Pool, Beat, StateDB, Consumer, Autoscaler), the celery.apps.worker CLI subclass, OS signal handling, and warm, soft and cold shutdown semantics.
tags: [worker, bootsteps, blueprint, workcontroller, shutdown, signals, components]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:05:29.073Z
sources:
  - id: openwiki-source-3cfd5f9bf00aaf6b49d01291
    resource: repo://celery/apps/worker.py
  - id: openwiki-source-7c9db0d3259470539a2d0756
    resource: repo://celery/bootsteps.py
  - id: openwiki-source-cd5b25b412e425989370ceb9
    resource: repo://celery/worker/components.py
  - id: openwiki-source-12d3bd623a53e489a785c641
    resource: repo://celery/worker/worker.py
generated: { by: "claude-code", at: "2026-11-16T17:05:29.073Z" }
---

# Worker Architecture and Bootsteps

A worker is a `WorkController` (`celery/worker/worker.py`) — in the CLI, its subclass `celery.apps.worker.Worker` (`app.Worker`). The controller itself does little: it computes settings and then builds and runs a **blueprint** of bootsteps. One of those steps is the [Consumer](consumer.md), which runs its own nested blueprint.

## Bootsteps (`celery/bootsteps.py`)

### Steps

- `Step` — a unit of initialisation. Class attributes: `requires` (other steps, by class or `'module:Class'` path), `last` (force to the end), `conditional`, `enabled`, `label`. `__init__(parent, **kwargs)` runs for every step; `include_if(parent)` (default: `enabled`) decides inclusion; `create(parent)` builds the component.
- `StartStopStep` — included steps are appended to `parent.steps` and get `start/stop/close/terminate` calls; the object returned by `create` (`self.obj`) is started/stopped by default.
- `ConsumerStep` — a `StartStopStep` requiring the consumer's `Connection`; it adds kombu consumers returned by `get_consumers(channel)` to the worker's broker connection.

### Blueprint

`Blueprint(steps, on_start, on_close, on_stopped)` combines `default_steps` with user-provided steps (`app.steps['worker' | 'consumer']`):

1. **`apply(parent, **kwargs)`** — `claim_steps()` loads step classes; `_firstpass` follows `requires` recursively, adding dependencies not listed explicitly; a `DependencyGraph` is built (the `last` step depends on everything) and topologically sorted (unknown names raise `KeyError('unknown bootstep')`). Each step is instantiated in order and `include(parent)` is called.
2. **`start(parent)`** — sets state `RUN`, calls `on_start`, then `step.start(parent)` for each included step in order, tracking how many started.
3. **`stop(parent, terminate=False)`** — `close` all steps (`on_close` first), then call `stop` (or `terminate`) on steps in **reverse order**, ignoring errors; then `on_stopped`, state `TERMINATE`, and signal `shutdown_complete`. If not all steps had started, it just marks the blueprint terminated.
4. `restart(parent, method)` sends a method to all steps (used by the consumer after connection loss); `send_all(parent, 'register_with_event_loop', args=(hub,))` lets steps register with the event loop; `info(parent)` merges per-step info for `inspect stats`.

`celery graph bootsteps` renders the dependency graph via `StepFormatter`.

## WorkController

`WorkController.__init__(app, hostname, **kwargs)`:

1. `app.loader.init_worker()` (imports `imports`/`include` modules, autodiscovery), `on_before_init`.
2. `setup_defaults(...)` — merges CLI kwargs with settings using `app.either(setting, value)`: concurrency (default CPU count), pool, consumer/timer/autoscaler classes, time limits, `max_tasks_per_child`, `max_memory_per_child`, prefetch multiplier, statedb, beat options, events, etc.
3. `setup_queues(include, exclude)` — `-Q`/`-X` select queues (unknown names → `ImproperlyConfigured`); `worker_direct` adds a per-node queue. `setup_includes` records all task modules in `conf.include` so pool children spawned via execv can import them.
4. Decides `use_eventloop` (default environment, async-capable transport, not Windows).
5. Sends `worker_init`, resolves the pool class, builds `Blueprint(steps=app.steps['worker'], on_start, on_close, on_stopped)` and applies it.

### Default worker components (`celery/worker/components.py`)

| Step | Purpose |
|------|---------|
| `Timer` | With the event loop: a `kombu.asynchronous.timer.Timer` driven by the hub (max interval 10 s). Otherwise the pool's `Timer` class (a thread, or green timers for eventlet/gevent). Used for ETA tasks, rate-limit rescheduling, heartbeats |
| `Hub` | Only with the event loop: creates/sets the kombu `Hub` (or a transport-required hub) and patches thread primitives to dummy locks, since everything runs in one thread |
| `Pool` | Instantiates the pool with concurrency, limits and `threads=not use_eventloop`; sets up the semaphore used with `worker_pool_putlocks`; parses `--autoscale` (see [Concurrency Pools](concurrency-pools.md)) |
| `Beat` | Conditional (`-B`): embedded beat via `EmbeddedService`; refused with green pools ([Beat](../scheduling/beat.md)) |
| `StateDB` | Conditional (`--statedb`): `state.Persistent` that loads revoked ids and clock, saved at exit |
| `Consumer` | `last = True`: creates the consumer with initial prefetch = concurrency × prefetch multiplier |
| `autoscale.WorkerComponent` | Conditional (`--autoscale`): the autoscaler |

### Running and stopping

- `start()` runs the blueprint; the `Consumer` step's start enters the consumer blueprint, whose final `Evloop` step blocks in the event loop until shutdown. `WorkerTerminate` → `terminate()`; `SystemExit`/`KeyboardInterrupt`/unexpected exceptions → `stop()` with an exit code (`Unrecoverable error` is logged at CRITICAL).
- **Warm shutdown** `stop()` — closes the consumer (no new messages), then stops steps in reverse; the pool waits for running tasks to finish. Sends `worker_shutdown`.
- **Cold shutdown** `terminate()` — stops steps with `terminate`, killing pool processes.
- `on_close` runs `loader.shutdown_worker()`; `on_stopped` stops the timer, shuts down the consumer and releases the pidfile lock.
- `reload()` (`pool_restart` command) re-imports modules, refreshes strategies and rate limits, and restarts the pool.
- `stats()` merges controller info (total counts, pid, clock, uptime), all step info and `rusage`.

Shutdown is requested asynchronously by setting `state.should_stop` / `state.should_terminate`; the event loop calls `state.maybe_shutdown()` each iteration and raises `WorkerShutdown`/`WorkerTerminate`.

## `celery.apps.worker.Worker` (CLI worker)

Adds process-level behaviour on top of `WorkController`:

- `on_before_init`: installs trace optimizations, sends `celeryd_init`, and runs `check_privileges` (refuses root with pickle unless `C_FORCE_ROOT`; see [Security](../operations/security.md)).
- `on_init_blueprint`: logging setup (`app.log.setup`, honouring `setup_logging` signal receivers, stdout redirection with `worker_redirect_stdouts`).
- `on_start`: sends `celeryd_after_setup`, optional `--purge`, prints the banner (version, transport, results, concurrency, task events, queues), sets the process title, and installs signal handlers.
- `on_consumer_ready`: sends `worker_ready` and logs "ready."

### OS signals

| Signal | Effect |
|--------|--------|
| `SIGTERM` | Warm shutdown (or cold if `REMAP_SIGTERM=SIGQUIT`) |
| `SIGINT` (Ctrl+C) | Warm shutdown; a second Ctrl+C escalates to cold |
| `SIGQUIT` | Cold shutdown |
| `SIGHUP` | Restart (re-exec) when detached from a terminal; not supported on macOS |
| `SIGUSR1` | Dump stack traces of all threads (`cry`) |
| `SIGUSR2` | Open a remote debugger (`rdb`), if `CELERY_RDBSIG` is set |

In the main process the shutdown handlers send `worker_shutting_down`, run an optional callback, and set the `should_stop`/`should_terminate` flags; the actual blueprint stop happens when the event loop next calls `maybe_shutdown()`. The cold-shutdown callback is the exception that does work directly (see below).

### Soft shutdown

With `worker_soft_shutdown_timeout > 0`, a cold shutdown first waits up to that many seconds for running tasks to finish (only if tasks are running, unless `worker_enable_soft_shutdown_on_idle`). Afterwards the cold-shutdown handler cancels the task consumer, cancels all unacked active requests via `consumer.cancel_active_requests()` (so `acks_late` tasks are redelivered elsewhere), sets `should_terminate` and stops the pool. A further `SIGQUIT`/`SIGINT` during this phase forces immediate termination.

## Extending the worker

Register custom steps with `app.steps['worker'].add(MyStep)` (e.g. a `StartStopStep` running a sidecar service that `requires = {'celery.worker.components:Pool'}`) or `app.steps['consumer'].add(MyConsumerStep)` for extra broker consumers. Add CLI options with `app.user_options['worker'].add(click.Option(...))`; the values arrive as keyword arguments to step constructors. See [Signals and Extension Points](../architecture/signals-and-extension-points.md).

## Tests

- `t/unit/worker/test_bootsteps.py` — blueprint ordering, dependencies, start/stop semantics.
- `t/unit/worker/test_worker.py`, `test_components.py` — controller setup, components, shutdown paths.
- `t/unit/bin/test_worker.py` — CLI worker, signal handlers, soft shutdown.
- `t/smoke/tests/test_worker.py` — warm/cold/soft shutdown against real containers.

## Related

- [Worker Consumer](consumer.md)
- [Concurrency Pools](concurrency-pools.md)
- [Signals and Extension Points](../architecture/signals-and-extension-points.md)
