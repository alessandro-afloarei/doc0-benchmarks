---
type: architecture
title: Worker Bootsteps and WorkController
description: How a Celery worker process is assembled and run — the bootsteps dependency-graph mechanism, the WorkController blueprint (Timer, Hub, Pool, Beat, StateDB, Consumer, Autoscaler), the apps.worker.Worker program layer, worker-global state, and warm/cold/soft shutdown and signal handling.
tags: [worker, bootsteps, workcontroller, shutdown, lifecycle]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T09:27:53.075Z
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
generated: { by: "claude-code", at: "2026-11-15T09:27:53.075Z" }
---

# Worker Bootsteps and WorkController

A worker is a `WorkController` (`celery/worker/worker.py`) — usually the `app.Worker` subclass from `celery/apps/worker.py` started by `celery worker`. It is built from **bootsteps**: small components with dependencies that the worker instantiates in topological order and starts/stops as a unit. The consumer inside it is a second blueprint (see [Worker Consumer and Event Loop](consumer.md)).

## The bootsteps mechanism (`celery/bootsteps.py`)

- A **`Step`** has a `name` (auto-set to `module.ClassName` by the `StepType` metaclass), `requires` (steps or dotted names it depends on), `conditional`, `enabled`/`include_if(parent)`, `last`, and `create(parent)`.
- A **`StartStopStep`** keeps the object returned by `create()` in `self.obj` and is appended to `parent.steps` when included; its `start/stop/terminate/close` delegate to that object.
- A **`ConsumerStep`** (requires the consumer `Connection` step) opens a channel and starts the kombu consumers returned by `get_consumers(channel)` — the hook for adding custom message consumers to a worker.
- A **`Blueprint`** holds `default_steps` plus extra steps (from `app.steps['worker']` / `app.steps['consumer']`):
  - `apply(parent, **kwargs)` resolves all steps and their transitive `requires`, builds a `DependencyGraph` (adding edges so the `last=True` step comes after everything else), topologically sorts it (`KeyError: unknown bootstep` on missing dependencies), instantiates each step with the parent and the worker kwargs, then calls `include(parent)`.
  - `start(parent)` starts `parent.steps` in order, tracking how many started.
  - `stop(parent, terminate=False)` — if the blueprint never fully started it just marks itself terminated; otherwise it sends `close` to all steps, then `stop` (or `terminate`) in **reverse** order with errors logged rather than raised, calls `on_stopped`, and sets `shutdown_complete`.
  - `send_all(parent, method, ...)` broadcasts a method to steps (used for `shutdown`, `register_with_event_loop`).
- `celery graph bootsteps` renders the graph.

Extending a worker therefore means writing a `Step`/`StartStopStep`/`ConsumerStep` and adding it with `app.steps['worker'].add(MyStep)` (or `'consumer'`); constructor kwargs from the CLI (including user options) reach every step's `__init__`.

## WorkController

### Construction

`WorkController.__init__(app, hostname, **kwargs)`:

1. Formats the node name (`default_nodename`), records `startup_time`, and calls `app.loader.init_worker()` — which sends `import_modules` and imports `imports`/`include` task modules.
2. `on_before_init` / `setup_defaults` / `on_after_init`: `setup_defaults` resolves each option from kwargs or settings via `app.either(...)` (`worker_concurrency`, `worker_pool`, `worker_prefetch_multiplier`, `task_time_limit`, `worker_max_tasks_per_child`, `worker_max_memory_per_child`, `worker_state_db`, `beat_scheduler`, ...).
3. `setup_instance`: selects queues (`-Q`/`-X`, raising `ImproperlyConfigured` for unknown names; adds the worker-direct queue when `worker_direct` is set), imports `--include` modules and records every registered task's module in `conf.include` (so `execv`-spawned children import them), defaults concurrency to the CPU count, decides `use_eventloop` (true when the environment is not monkey-patched by eventlet/gevent, the transport implements asynchronous I/O, and the platform is not Windows), sends `worker_init`, resolves the pool class, then builds and applies the blueprint.

### Default worker steps

| Step | Module | Role |
| --- | --- | --- |
| `Timer` | `components.py` | ETA/rate-limit/heartbeat scheduling: kombu's async timer when the event loop is used, otherwise the pool's `Timer` class (a thread for prefork) |
| `Hub` | `components.py` | Creates the kombu event loop (`requires_hub` of the transport or the default `Hub`) when `use_eventloop`; swaps billiard/clock locks for dummy locks since everything runs in one thread |
| `Pool` | `components.py` | Instantiates the concurrency pool (see [Concurrency Pools](concurrency-pools.md)); parses `--autoscale max,min`; with the event loop uses a `LaxBoundedSemaphore` to bound in-flight tasks; sets the global `task_join_will_block` flag from the pool |
| `Beat` | `components.py` | Embedded beat with `-B` (conditional; refused for gevent/eventlet) — see [Beat](../beat/periodic-tasks.md) |
| `StateDB` | `components.py` | With `--statedb`, loads persistent worker state and saves it at exit |
| `Consumer` | `components.py` | `last=True`: creates the consumer with `initial_prefetch_count = concurrency (or max autoscale) × prefetch_multiplier` |
| `WorkerComponent` | `autoscale.py` | Autoscaler thread/timer when autoscaling is enabled |

### Running and stopping

- `start()` runs `blueprint.start(self)`; the consumer step blocks in its loop. `WorkerTerminate` triggers `terminate()`; other exceptions are logged as "Unrecoverable error" and trigger `stop(exitcode=EX_FAILURE)`; `SystemExit` and `KeyboardInterrupt` call `stop()` with the corresponding exit code.
- `stop()` (**warm shutdown**) signals the consumer to close, stops the blueprint gracefully (waiting for running tasks), and sends `worker_shutdown`.
- `terminate()` (**cold shutdown**) stops the blueprint with `terminate=True`, killing pool processes.
- Inside signal handlers the actual shutdown only runs immediately if the pool is `signal_safe`; otherwise the flag set by the handler is acted upon by the loop.
- `on_start` creates the pidfile lock; `on_close` calls `loader.shutdown_worker()`; `on_stopped` stops the timer, shuts down the consumer and releases the pidlock.
- `reload()` (used by the `pool_restart` control command) re-imports modules, refreshes strategies/rate limits, and restarts the pool.

## The `Worker` program layer (`celery/apps/worker.py`)

`app.Worker` adds the user-facing behaviour:

- `on_before_init`: sends `celeryd_init` (configure workers by node name) and runs `check_privileges(accept_content)` (refuse root + pickle — see [Platform Support](../operations/signals-logging-and-platforms.md)).
- `on_init_blueprint`: sets up logging and calls `trace.setup_worker_optimizations()` (finalizes the app and enables the fast tracer).
- `on_start`: sends `celeryd_after_setup`, optionally purges queues (`--purge`), prints the banner (version, transport, results, concurrency, queues, task list), sets the process title, installs signal handlers, redirects stdouts, and warns about deprecated setting names.

### Signal handling

| Signal | Behaviour |
| --- | --- |
| `SIGTERM` | Warm shutdown: sets `state.should_stop`. If billiard's `REMAP_SIGTERM == "SIGQUIT"`, it is a cold shutdown instead. |
| `SIGINT` (Ctrl+C) | Warm shutdown the first time and re-arms itself as a cold-shutdown handler ("Hitting Ctrl+C again will initiate cold shutdown") |
| `SIGQUIT` | Cold shutdown (`on_cold_shutdown`) |
| `SIGHUP` | Restart via `execv` at exit — only when not attached to a TTY, and not on macOS (where a warning handler is installed instead) |
| `SIGUSR1` | Dump stack traces of all threads (`cry`) |
| `SIGUSR2` (only when the `CELERY_RDBSIG` env var is set) | Open a remote debugger at the current frame (`celery.contrib.rdb`) |

Handlers run only meaningful work in the `MainProcess`, send `worker_shutting_down`, and set `state.should_stop` / `state.should_terminate`. The consumer and event loops call `state.maybe_shutdown()`, which raises `WorkerShutdown` / `WorkerTerminate`, unwinding into `WorkController.start()`.

**Cold shutdown with soft shutdown**: `on_cold_shutdown` first re-installs `SIGINT`/`SIGQUIT` (and remapped `SIGTERM`) handlers that cancel unacked requests and then force a hard exit on the next signal; then it waits `worker_soft_shutdown_timeout` seconds (if > 0 and tasks are active, or always with `worker_enable_soft_shutdown_on_idle`) to let short tasks finish, cancels the task consumer, cancels active requests (so `acks_late` tasks are requeued), sets `should_terminate`, and stops the pool.

## Worker-global state (`celery/worker/state.py`)

Process-global, used by the consumer, control commands and the tracer:

- `requests` (id → request), `reserved_requests`, `active_requests` (weak sets), `total_count` (per-task counters), `all_total_count`.
- `revoked` — a `LimitedSet` (max `CELERY_WORKER_REVOKES_MAX`, default 50000; expiring after `CELERY_WORKER_REVOKE_EXPIRES`, default 10800 s) of revoked task ids; `revoked_stamps` for stamp-based revocation.
- `successful_requests` — `LimitedSet` used for redelivery deduplication (`worker_deduplicate_successful_tasks`).
- `should_stop` / `should_terminate` flags and `maybe_shutdown()`.
- `task_reserved`, `task_accepted`, `task_ready` hooks that maintain the sets above.
- `Persistent` — the `--statedb` shelve store; it saves the revoked set (zlib-compressed pickle) and the Lamport clock so revocations survive restarts.

## Related tests

`t/unit/worker/test_bootsteps.py`, `test_worker.py`, `test_components.py`, `test_state.py`; `t/unit/bin/test_worker.py`; `t/smoke/tests/test_worker.py` (shutdown modes), `t/smoke/tests/failover/`.
