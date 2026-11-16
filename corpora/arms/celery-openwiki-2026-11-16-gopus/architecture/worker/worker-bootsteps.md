---
type: architecture
title: Worker Startup and Bootsteps
description: How a Celery worker is assembled and run — the bootsteps dependency-graph framework, WorkController and its default components (Timer, Hub, Pool, Beat, StateDB, Consumer, Autoscaler), the Worker application wrapper, shared worker state, and warm/cold/soft shutdown signal handling.
tags: [worker, bootsteps, startup, shutdown, signals, workcontroller]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:57:55.789Z
sources:
  - id: openwiki-source-3cfd5f9bf00aaf6b49d01291
    resource: repo://celery/apps/worker.py
  - id: openwiki-source-7c9db0d3259470539a2d0756
    resource: repo://celery/bootsteps.py
  - id: openwiki-source-cd5b25b412e425989370ceb9
    resource: repo://celery/worker/components.py
  - id: openwiki-source-7a844ae59c546297a34da340
    resource: repo://celery/worker/state.py
  - id: openwiki-source-12d3bd623a53e489a785c641
    resource: repo://celery/worker/worker.py
generated: { by: "claude-code", at: "2026-11-16T06:57:55.789Z" }
---

# Worker Startup and Bootsteps

A worker process is a `WorkController` (`celery/worker/worker.py`) whose
functionality is composed from **bootsteps** — small start/stop units arranged
in a dependency graph. The CLI uses the subclass `celery.apps.worker.Worker`,
which adds banners, logging and signal handlers. The broker-facing half of the
worker is a second blueprint, the [Consumer](consumer.md).

## Bootsteps framework (`celery/bootsteps.py`)

- **`Step`** – has `name` (derived from module + class by the `StepType`
  metaclass), optional `label`, `requires` (other steps, as classes or
  `"module:Class"` strings), `conditional`/`enabled`, `include_if(parent)`,
  and `create(parent)`. `__init__(parent, **kwargs)` runs while the parent is
  being constructed and typically sets attributes on it.
- **`StartStopStep`** – a step whose `create()` returns an object with
  `start/stop/terminate`; when included it is appended to `parent.steps`,
  which defines start order.
- **`ConsumerStep`** – a `StartStopStep` for the consumer blueprint that
  creates kombu consumers from `get_consumers(channel)` on a new channel of
  the consumer connection (an easy way for extensions to consume custom queues).
- **`Blueprint`** – holds `default_steps` plus user steps.
  `apply(parent, **kwargs)`:
  1. resolves all step classes and, transitively, their `requires`;
  2. builds a `DependencyGraph`; the step marked `last = True` is made to
     depend on every other step;
  3. topologically sorts it (unknown dependency → `KeyError('unknown
     bootstep: ...')`), instantiates each step with the parent and kwargs, and
     calls `include(parent)`.
- `Blueprint.start` starts `parent.steps` in order; `stop` closes them and
  then calls `stop` (or `terminate`) **in reverse order**, with errors logged
  rather than propagated. If the blueprint never fully started, `stop` just
  marks it terminated. `send_all(parent, method)` broadcasts a method call
  (e.g. `register_with_event_loop`, `shutdown`).

**Extension seam:** `app.steps['worker'].add(MyStep)` and
`app.steps['consumer'].add(MyStep)` add custom steps; `celery graph bootsteps`
renders the graph.

## WorkController construction

`WorkController.__init__(app, hostname, **kwargs)`:

1. `default_nodename(hostname)`, `app.loader.init_worker()` (imports
   `imports`/`include` modules and runs loader hooks).
2. `setup_defaults(...)` resolves every option from kwargs or `worker_*`
   settings (concurrency, pool, time limits, prefetch, statedb, ...).
3. `setup_instance(...)`:
   - `setup_queues(-Q, -X)` selects/deselects queues from `task_queues`
     (unknown names raise `ImproperlyConfigured` unless
     `task_create_missing_queues`), and adds the worker-direct queue if
     `worker_direct`;
   - `setup_includes` imports `-I` modules and records every module that
     defines a task in `conf.include` (so children started with execv import
     the same tasks);
   - concurrency defaults to the CPU count;
   - `use_eventloop = should_use_eventloop()`;
   - sends `worker_init`;
   - resolves `pool_cls` and builds the worker `Blueprint` with
     `on_start` (create the pidfile lock), `on_close`
     (`loader.shutdown_worker()`), `on_stopped` (stop timer, shut down the
     consumer, release the pidlock).

## Default worker steps

| Step | Requires | Responsibility |
|------|----------|----------------|
| `Timer` | – | With an event loop: a kombu timer driven by the hub. Otherwise a timer thread (`pool_cls.Timer`, e.g. eventlet-specific). Used for ETA tasks, rate limits, heartbeats |
| `Hub` | Timer | Only if `use_eventloop`. Creates/sets the kombu `Hub` and replaces thread locks (clock, billiard `pool.Lock`) with `DummyLock` since everything runs in one thread |
| `Pool` | Hub | Creates the execution pool ([pools](concurrency-pools.md)); parses `--autoscale` |
| `Beat` | – | Conditional on `-B`: embedded beat service ([beat](../beat-scheduler.md)) |
| `StateDB` | – | If `--statedb`: `Persistent` shelve storing revoked ids and the logical clock, saved at exit |
| `Consumer` | – | `last = True`. Creates the Consumer with `prefetch_count = (max_concurrency or concurrency) × prefetch_multiplier` |
| `Autoscaler` | Pool | Conditional on `--autoscale` |

`WorkController.start()` runs `blueprint.start`. `WorkerTerminate` →
`terminate()`; any other exception is logged as *Unrecoverable error* and
`stop(exitcode=EX_FAILURE)`; `SystemExit`/`KeyboardInterrupt` → `stop`.

Other operations: `reload()` (re-import task modules, rebuild strategies,
restart the pool — remote `pool_restart`), `info()`/`stats()` (used by
`inspect stats`), `rusage()`.

## Shared worker state (`celery/worker/state.py`)

Module-level globals shared by all components in the main process:

- `requests` (id → Request), `reserved_requests`, `active_requests`,
  `successful_requests` (bounded `LimitedSet`), `total_count`;
- `revoked` and `revoked_stamps` (see
  [remote control](../remote-control-and-events.md));
- `should_stop` / `should_terminate` flags set by signal handlers;
  `maybe_shutdown()` raises `WorkerShutdown` / `WorkerTerminate` when they are
  set, and is polled by the consumer loop;
- helpers `task_reserved`, `task_accepted`, `task_ready`;
- `Persistent` – the zlib-compressed shelve used by `StateDB`, merging revoked
  ids saved in older formats.

## The Worker application (`celery/apps/worker.py`)

`celery worker` instantiates `app.Worker`, which subclasses `WorkController`
and adds:

- logging setup, `--purge` (discard all waiting messages before starting),
  the ASCII banner (`startup_info`), process title updates;
- `celeryd_after_setup` signal after the worker is configured (a common place
  to change queues);
- a deprecated-settings warning recommending `celery upgrade settings`;
- `install_platform_tweaks` → signal handlers.

### Shutdown signals

| Signal | Behaviour |
|--------|-----------|
| `SIGTERM` | **Warm shutdown**: stop consuming, wait for running tasks, then exit (`should_stop`). If billiard's `REMAP_SIGTERM=SIGQUIT`, SIGTERM is treated as cold instead |
| `SIGINT` (Ctrl+C) | Warm shutdown; the handler then reinstalls itself so a second Ctrl+C starts a cold shutdown |
| `SIGQUIT` | **Cold shutdown** (`on_cold_shutdown`): optionally wait `worker_soft_shutdown_timeout` (*soft shutdown*, only if tasks are running unless `worker_enable_soft_shutdown_on_idle`), cancel the task consumer, cancel all unacked active requests (so `acks_late` messages are redelivered), set `should_terminate`, stop the pool. A further SIGINT/SIGQUIT during this phase forces a hard exit |
| `SIGHUP` | Only when not attached to a TTY: restart by `execv` of the same command line (on macOS only a warning is printed) |
| `SIGUSR1` | Dump stack traces of all threads (`cry`) |
| `SIGUSR2` | Open a remote debugger (`celery.contrib.rdb`) if `CELERY_RDBSIG` is set |

Handlers run only in the `MainProcess`, send `worker_shutting_down`, and set
the state flag; the actual teardown happens in the main loop through
`maybe_shutdown()` → `WorkController.stop/terminate`, which signal the
consumer to close and call `blueprint.stop(terminate=not warm)` under a 5 s
default socket timeout, then send `worker_shutdown`.

## Tests

- `t/unit/worker/test_bootsteps.py` – graph ordering, include/conditional
  logic, stop semantics.
- `t/unit/worker/test_worker.py`, `test_components.py`, `test_state.py`.
- `t/unit/bin/test_worker.py` – signal handlers and the Worker app.
- `t/smoke/tests/test_worker.py` – warm/cold/soft shutdown against real
  workers.

See also: [CLI and daemonization](../../operations/cli-and-daemonization.md).
