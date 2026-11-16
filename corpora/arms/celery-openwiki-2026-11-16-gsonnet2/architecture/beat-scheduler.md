---
type: architecture
title: Beat Periodic Task Scheduler
description: How celery beat decides when periodic tasks are due and publishes them, covering schedule types, ScheduleEntry, the heap-based Scheduler tick loop, the shelve-backed PersistentScheduler, the Service wrapper, and embedded beat.
tags: [celery, beat, scheduler, periodic-tasks, crontab, schedules]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:56:17.091Z
sources:
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-2a32c4e613bc7be1d621d647
    resource: repo://celery/beat.py
  - id: openwiki-source-c3f5d48780ae239f4c7470eb
    resource: repo://celery/schedules.py
  - id: openwiki-source-cd5b25b412e425989370ceb9
    resource: repo://celery/worker/components.py
generated: { by: "claude-code", at: "2026-11-16T17:56:17.091Z" }
---

# Beat Periodic Task Scheduler

Beat is a separate producer. It never executes tasks itself. It keeps a table of named schedule entries, works out which one is due next, and publishes the corresponding task message through the normal [publishing path](../workflows/task-publishing.md). Workers then run those messages like any other.

The code lives in `celery/beat.py` (entries, schedulers, service), `celery/schedules.py` (schedule types) and `celery/apps/beat.py` (the CLI-facing launcher). The click command is `celery/bin/beat.py`.

## Layers

| Layer | Class | Role |
|---|---|---|
| Launcher | `celery.apps.beat.Beat` | Resolves options from arguments or config, sets up logging, pidfile and loader, then runs the `Service`. |
| Service | `celery.beat.Service` | Owns the run loop: tick, sleep, periodic sync, shutdown events. |
| Scheduler | `Scheduler`, `PersistentScheduler` | Holds the entry table and a heap of next-run times, and applies due entries. |
| Entry | `ScheduleEntry` | One task plus its schedule, args, options, `last_run_at` and `total_run_count`. |
| Schedule | `schedule`, `crontab`, `solar` | Answer `is_due(last_run_at)`. |

## Schedule types

All schedule types derive from `BaseSchedule` in `celery/schedules.py`. They provide `now()`, using an injectable `nowfun` or `app.now`, plus timezone helpers. The key contract is `is_due(last_run_at)`, which returns `(is_due, next_check_seconds)`.

- `schedule(run_every, relative=...)` is a fixed interval. `maybe_schedule` converts bare numbers and `timedelta`s into it.
- `crontab(minute, hour, day_of_week, day_of_month, month_of_year)` implements cron semantics. `beat_cron_starting_deadline` can bound how late a missed cron run may still fire.
- `solar(event, lat, lon)` schedules on sunrise, sunset and related events.

The "next check" value is only a hint that saves CPU. It is always clamped by the scheduler's `max_interval`.

## The tick loop

`Service.start` repeats `interval = scheduler.tick()` and sleeps for the returned interval until a shutdown event is set. After waking it syncs if `should_sync()` says so. It sends the `beat_init` signal first (and `beat_embedded_init` when embedded). On exit it always calls `sync()`, which closes the scheduler.

`Scheduler.tick` (`celery/beat.py`):

1. It rebuilds the min-heap with `populate_heap` if the heap is missing or the schedule differs from `old_schedulers`. Heap items are `(timestamp, priority, entry)` events.
2. It looks at the heap head. If the entry is due, it pops it, calls `reserve(entry)`, then `apply_entry`, and pushes the next instance back. It returns `0`, so due entries are processed **one per tick** with no sleep in between.
3. If nothing is due, it returns `min(next_time_to_run, max_interval)`. A small negative drift, `adjust`, slightly shortens waits.

`reserve` replaces the entry in the schedule with `next(entry)`. That bumps `last_run_at` and `total_run_count` before the task is sent. The code comment states the reason: timestamps are updated first so that a publishing failure cannot cause the entry to be rescheduled forever.

`Scheduler.apply_async` resolves the task from `app.tasks` and calls `task.apply_async(args, kwargs, producer=..., **entry.options)`. For unregistered names it falls back to `app.send_task`. Failures are re-raised as `SchedulingError`. A `finally` block counts tasks since the last sync and triggers `_do_sync` when `should_sync()` is true. `apply_entry` wraps all of this and only logs errors, so one bad entry does not stop beat. Entry args and kwargs may contain `BeatLazyFunc` values, which are evaluated at send time.

`max_interval` defaults to 300 seconds (`DEFAULT_MAX_INTERVAL`) and can be overridden with `beat_max_loop_interval`. Because the loop only re-reads the schedule when it wakes, changes made at runtime take effect at the next tick.

## Where entries come from

- `beat_schedule` in configuration, which `setup_schedule` merges in with `merge_inplace`.
- `app.add_periodic_task(schedule, sig, ...)` (`celery/app/base.py`). It builds an entry dict keyed by the given `name` or the repr of the signature. If the app is not yet configured, the entry is queued in `_pending_periodic_tasks` and applied by `_load_config` (see [App and configuration](app-and-configuration.md)). Adding two unnamed periodic tasks with the same signature repr silently shadows the first, and a warning is logged.
- Built-in defaults. `install_default_entries` adds `celery.backend_cleanup`, a daily crontab at 04:00 with a 12-hour expiry, when `result_expires` is set and the backend does not support auto-expiry. See [Result backends](result-backends.md).

## Persistence

`Scheduler` keeps entries in memory. `PersistentScheduler`, the default `beat_scheduler`, stores them in a `shelve` database opened with `writeback=True`, so `last_run_at` and run counts survive restarts. Its `setup_schedule` is defensive:

- A corrupted or unreadable file is deleted and recreated.
- A missing `__version__`, `tz` or `utc_enabled` marker clears the store.
- A change in the `timezone` or `enable_utc` settings clears the stored schedule and logs a "Reset" warning.

It then merges the config schedule, installs the default entries and syncs. `merge_inplace` updates only the editable fields (task, schedule, args, kwargs, options) of entries that already exist, so persisted run state is kept. Entries that were removed from the configuration are dropped from the store.

Custom schedulers can be selected by dotted path, or by name through the `celery.beat_schedulers` entry-point namespace (`Service.get_scheduler`). Database-backed schedulers from third-party packages plug in here. Subclasses must be idempotent when `lazy=True`, because the `Service` may instantiate a scheduler only for introspection.

## Running beat

- **Standalone:** `celery beat` goes through `celery.apps.beat.Beat`, which resolves options with `app.either(config_key, arg)`, takes a pidlock if `--pidfile` is set, and starts the `Service`.
- **Embedded in a worker:** `worker -B` enables the `Beat` bootstep (`celery/worker/components.py`), which creates `EmbeddedService`. By default it is a `multiprocessing.Process`. With `thread=True`, or when multiprocessing is unavailable, it is a daemon thread with `max_interval=1` so it can be stopped promptly. The step raises `ImproperlyConfigured` for eventlet and gevent pools, and the CLI rejects `-B` on Windows. Every worker started with `-B` runs its own scheduler, so when you run several workers use a single standalone beat instead, or tasks will be published once per embedded beat.

## Related pages

- [Task publishing](../workflows/task-publishing.md) covers what happens inside `apply_async`.
- [Worker and consumer](worker-and-consumer.md) covers the bootstep system that hosts embedded beat.
- [CLI and process management](cli-and-process-management.md) covers daemonizing `celery beat`.
- Tests: `t/unit/app/test_beat.py` and `t/unit/app/test_schedules.py`.
