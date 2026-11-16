---
type: "Reference"
title: "Beat Scheduler and Schedules"
openwiki_generated: true
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:22:47.483Z
sources:
  - id: openwiki-source-ac404435efa758dad4bbfc83
    resource: repo://celery/app/defaults.py
  - id: openwiki-source-2a32c4e613bc7be1d621d647
    resource: repo://celery/beat.py
  - id: openwiki-source-c3f5d48780ae239f4c7470eb
    resource: repo://celery/schedules.py
  - id: openwiki-source-cd5b25b412e425989370ceb9
    resource: repo://celery/worker/components.py
generated: { by: "claude-code", at: "2026-11-16T09:22:47.483Z" }
---


# Beat Scheduler and Schedules

Celery beat is a standalone clock that publishes tasks to the broker when they come due; it never executes tasks itself. Workers consume what it sends like any other message (see [[/openwiki/workflows/task-lifecycle.md]]). Code lives in `celery/beat.py` (scheduler and service), `celery/schedules.py` (when is something due) and `celery/apps/beat.py` (CLI-facing application wrapper).

## Building blocks

- **`ScheduleEntry`** (`celery/beat.py`) holds `name`, `task`, `schedule`, `args`, `kwargs`, `options`, `last_run_at` and `total_run_count`. `schedule` is normalized through `maybe_schedule`, which turns numbers and timedeltas into a `schedule` object. `is_due()` delegates to the schedule using `last_run_at`. `next()` returns a *new* entry with an updated `last_run_at` and an incremented run count rather than mutating. Equality and `update()` only consider the *editable* fields (`task`, `schedule`, `args`, `kwargs`, `options`), which is what lets a reloaded config be merged without losing run history.
- **Schedules** (`celery/schedules.py`) share the `BaseSchedule` contract: `is_due(last_run_at)` returns `(is_due, seconds_until_next_check)` and `remaining_estimate()` returns a timedelta. `schedule` is a fixed interval (optionally `relative`, rounded to the interval resolution). `crontab` supports cron-style fields parsed by `crontab_parser`. `solar` schedules at sunrise/sunset-style events for a latitude/longitude. All accept `nowfun` for testing and resolve the app timezone through `app.timezone` / `enable_utc`.
- **Scheduler** drives the entries; **PersistentScheduler** adds on-disk state; **Service** runs the loop.

## The tick loop

`Service.start` (`celery/beat.py#L633-L665`) sends `beat_init` (plus `beat_embedded_init` and a process title when embedded), then loops until shutdown: call `scheduler.tick()`, sleep for the returned interval, and sync the schedule if `should_sync()`. `KeyboardInterrupt`/`SystemExit` end the loop and `finally` syncs and closes the scheduler.

`Scheduler.tick` (`#L326-L364`) keeps a min-heap of `(time, priority, entry)` events:

1. If the heap does not exist, or `schedules_equal(old_schedulers, schedule)` is false (entries added, removed or changed — so runtime changes to the schedule are picked up), it is rebuilt by `populate_heap`.
2. It looks at the earliest event. If the entry is due, it pops it, `reserve`s the next instance of the entry (updating `last_run_at` and the run count *before* sending), calls `apply_entry`, pushes the next occurrence back, and returns `0` to tick again immediately — so **one due task is dispatched per tick**.
3. If nothing is due, it returns the time until the next entry, adjusted by a small drift and capped at `max_interval` (`beat_max_loop_interval`, default 5 minutes for the stock scheduler). Because of that cap, changes to a dynamic schedule take effect at most one max interval later.

`Scheduler.apply_async` (`#L393-L421`) advances the entry first "so we have that done if an exception is raised (doesn't schedule forever)". It then looks the task up in `app.tasks`: registered tasks go through `task.apply_async(args, kwargs, producer=..., **entry.options)`; unknown names fall back to `app.send_task`. Argument values can be `BeatLazyFunc` objects evaluated at send time. Failures are re-raised as `SchedulingError`, and `apply_entry` logs rather than propagating, so one broken entry does not stop beat. The `finally` block counts tasks since the last sync and triggers `_do_sync` when `sync_every` seconds (`beat_sync_every`, 3 minutes by default) or `sync_every_tasks` has been reached.

The scheduler publishes on its own long-lived producer (`auto_declare=False`) over `connection_for_write()`, with `ensure_connection` retries bounded by `broker_connection_max_retries`.

## Populating the schedule

`setup_schedule` installs default entries and merges `beat_schedule` from config. `install_default_entries` adds `celery.backend_cleanup` (daily crontab at 04:00, 12-hour expiry) only when `result_expires` is set and the backend does not natively auto-expire results (`#L268-L277`). `merge_inplace` (`#L458-L474`) removes entries no longer in config, adds new ones and calls `update()` on existing ones, preserving their run history. Tasks added with `app.add_periodic_task` before the app is configured are queued and merged on configuration (see [[/openwiki/architecture/application.md]]).

## Persistence

`PersistentScheduler` (`#L505-L610`) stores entries in a `shelve` database (`beat_schedule_filename`, `celerybeat-schedule` by default) opened with `writeback=True`, so `last_run_at` survives restarts and missed intervals are computed correctly.

- A corrupt or unreadable file is detected (by reading keys on open and in `_create_schedule`) and **deleted and recreated** with an error log.
- Metadata keys `__version__`, `tz` and `utc_enabled` are stored; if the stored timezone or UTC setting differs from current config, or older-format files lack those fields, the whole store is cleared with a warning ("Reset"). Operators changing `timezone`/`enable_utc` should therefore expect run history to reset.
- `sync()` flushes the shelve; `close()` syncs and closes it. `apps/beat.py` installs SIGTERM/SIGINT handlers that call `service.sync()` before exiting so the state is saved.

Other schedulers (e.g. database-backed ones from third-party packages) plug in through `scheduler_cls`; `Service.get_scheduler` resolves the class by name using aliases from the `celery.beat_schedulers` entry-point namespace. The `lazy` constructor argument lets the CLI instantiate a scheduler for introspection without setting it up, so subclasses must be idempotent in that mode.

## Running beat

- **Standalone**: `celery beat` creates `celery.apps.beat.Beat`, which resolves the scheduler class with `either('beat_scheduler', ...)`, sets up logging, builds a `Service`, prints a banner and starts it (see [[/openwiki/architecture/cli.md]]).
- **Embedded in a worker** (`celery worker -B`): the `Beat` bootstep in `celery/worker/components.py#L181-L204` is conditional on the `beat` flag and creates `EmbeddedService`. It raises `ImproperlyConfigured` when the pool is gevent or eventlet. `EmbeddedService` (`celery/beat.py#L727-L738`) runs beat as a separate `multiprocessing` process by default (resetting signals and closing inherited fds) or as a daemon thread with `max_interval=1` (so it can stop quickly) when `thread=True` or multiprocessing is unavailable. Embedded beat is convenient for development; running more than one beat per schedule duplicates task dispatches, so production deployments run exactly one.

## Related

- [[/openwiki/architecture/worker.md]] for the bootstep framework hosting the embedded beat.
- [[/openwiki/architecture/tasks.md]] for `apply_async` / `send_task` publishing used by the scheduler.
