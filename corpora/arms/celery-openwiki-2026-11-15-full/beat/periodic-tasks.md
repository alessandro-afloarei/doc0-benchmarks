---
type: subsystem
title: Beat and Periodic Scheduling
description: How celery beat schedules periodic tasks — the Service tick loop, Scheduler heap, PersistentScheduler shelve storage, ScheduleEntry, schedule/crontab/solar schedule types, timezone resets, and embedding beat inside a worker.
tags: [beat, scheduler, crontab, periodic-tasks, schedules]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T09:27:53.075Z
sources:
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-2a32c4e613bc7be1d621d647
    resource: repo://celery/beat.py
  - id: openwiki-source-c3f5d48780ae239f4c7470eb
    resource: repo://celery/schedules.py
  - id: openwiki-source-cd5b25b412e425989370ceb9
    resource: repo://celery/worker/components.py
generated: { by: "claude-code", at: "2026-11-15T09:27:53.075Z" }
---

# Beat and Periodic Scheduling

`celery beat` is a single process that **publishes** due periodic tasks; it never executes them. Workers consume those messages like any other task. The implementation lives in `celery/beat.py` (service and schedulers), `celery/schedules.py` (schedule types) and `celery/apps/beat.py` (the CLI-facing program wrapper).

> Only one beat instance should run per schedule — the default schedulers have no distributed locking, so two beats would send every task twice.

## Defining the schedule

Entries come from two sources:

- The `beat_schedule` setting: a dict `name -> {'task', 'schedule', 'args', 'kwargs', 'options', 'relative'}`.
- `app.add_periodic_task(schedule, sig, args, kwargs, name=None, **opts)` — converts a signature into a `beat_schedule` entry keyed by `name` or `repr(sig)`. If called before configuration is loaded, the entry is queued and applied in `_load_config`. An unnamed entry that overwrites an existing key logs a "shadowed a previous unnamed periodic task" warning. Typically used inside an `on_after_configure` signal handler.

`schedule` may be a number of seconds, a `timedelta` (both converted by `maybe_schedule` into `schedules.schedule`), or any `BaseSchedule` instance.

## Schedule types (`celery/schedules.py`)

All schedules implement `is_due(last_run_at) -> schedstate(is_due, next)` where `next` is the number of seconds until the scheduler should check again, and `remaining_estimate(last_run_at)`. They use the app's `now()` and `timezone` unless a `nowfun` is supplied.

- **`schedule(run_every, relative=False)`** — fixed interval. Due when the remaining time is zero; then `next` is the full interval. `relative=True` rounds to the interval's resolution.
- **`crontab(minute, hour, day_of_week, day_of_month, month_of_year)`** — Unix cron semantics, parsed by `crontab_parser` (ranges, steps, lists, names). `crontab.from_string('*/5 * * * *')` is supported. `is_due` honours `beat_cron_starting_deadline`: if the last *feasible* run time is older than the deadline, missed runs are not executed on startup.
- **`solar(event, lat, lon)`** — sunrise/sunset/dawn/dusk events computed with the optional `ephem` library.

## ScheduleEntry

`ScheduleEntry` holds `name`, `task`, `schedule`, `args`, `kwargs`, `options`, `last_run_at` and `total_run_count`. `next(entry)` returns a **new** entry with `last_run_at=now` and an incremented count. `update(other)` only copies the editable fields (`task`, `schedule`, `args`, `kwargs`, `options`), so run history survives configuration changes. `args`/`kwargs` may contain `BeatLazyFunc` objects that are evaluated at send time.

## Scheduler

`Scheduler` keeps the entries in `self.schedule` (a dict) and drives them with a min-heap:

1. `tick()` (re)builds the heap whenever the schedule changed (compared with `schedules_equal`), using each entry's next due time.
2. It peeks at the earliest entry. If due, it pops it, `reserve()`s it (replacing the entry with `next(entry)` **before** sending, so an exception can't cause it to fire forever), sends it with `apply_entry`, pushes the updated entry back, and returns `0` so the loop immediately ticks again — **one task per tick**.
3. If nothing is due, it returns the time until the next entry, capped at `max_interval` (`beat_max_loop_interval`, default 300 seconds for the built-in schedulers).

`apply_async(entry)` uses the locally registered task's `apply_async` if available, otherwise `app.send_task` by name, passing the entry's `options`. Any exception is re-raised as `SchedulingError`; `apply_entry` logs it so the scheduler keeps running.

`install_default_entries` adds `celery.backend_cleanup` at 04:00 daily (`crontab('0', '4', '*')`) when `result_expires` is set and the backend does not support auto-expiry.

Syncing happens every `sync_every` seconds (3 minutes) or every `beat_sync_every` sent tasks (`should_sync`).

`merge_inplace(beat_schedule)` removes entries no longer configured, updates existing ones in place and adds new ones.

### PersistentScheduler (default)

The default `beat_scheduler` is `celery.beat:PersistentScheduler`, which stores entries in a `shelve` database at `beat_schedule_filename` (default `celerybeat-schedule`):

- A corrupted or unreadable file is deleted (all known suffixes `.db`, `.dat`, `.bak`, `.dir`) and recreated.
- The store records `__version__`, `tz` and `utc_enabled`. If the configured `timezone` or `enable_utc` differs from what was stored, **the stored schedule is cleared** with a "Reset" warning; last-run times are not reinterpreted across timezone changes.
- `sync()` flushes the shelve; `close()` syncs and closes.

Custom schedulers (e.g. `django-celery-beat`'s database scheduler) are selected via `beat_scheduler` / `--scheduler`. `Service.get_scheduler` also resolves aliases registered under the `celery.beat_schedulers` entry-point namespace.

## Service and process wrappers

`Service.start()` sends `beat_init` (and `beat_embedded_init` when embedded), then loops: `interval = scheduler.tick()`; sleep `interval`; sync if due. `KeyboardInterrupt`/`SystemExit` stop the loop and the scheduler is closed (synced) on exit.

`celery/apps/beat.py:Beat` is the program behind `celery beat`: it sets up logging, prints the banner, optionally creates a pidfile lock (`platforms.create_pidlock`), sets the process title and installs SIGTERM/SIGINT handlers that sync the schedule before exiting.

## Embedded beat (`worker -B`)

The worker's `Beat` bootstep (`celery/worker/components.py`) creates an `EmbeddedService` when `beat=True`:

- By default a `multiprocessing` child process (`_Process`) that resets signals, closes inherited file descriptors and runs the service.
- A daemon thread (`_Threaded`, forced `max_interval=1` so it can stop quickly) when `thread=True` or multiprocessing is unavailable.
- It raises `ImproperlyConfigured` for gevent/eventlet pools ("use standalone beat instead").

Embedded beat is convenient for development; production deployments generally run a standalone beat (see [Deployment and Daemonization](../operations/deployment.md)).

## Related

- CLI options: [Command-Line Interface](../cli/command-line.md) (`celery beat -s/--schedule`, `-S/--scheduler`, `--max-interval`).
- Config keys under the `beat_` namespace: [Application Object and Configuration](../app/application-and-configuration.md).
- Tests: `t/unit/app/test_beat.py`, `t/unit/app/test_schedules.py`, `t/unit/bin/test_beat.py`.
