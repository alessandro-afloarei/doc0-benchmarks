---
title: "Periodic Tasks with Beat"
---
## Overview

Beat is Celery's scheduler: a single process that watches a table of periodic entries and, when one is due, publishes the task message exactly as a client would. It does not run tasks itself; workers do. Because it only calls `apply_async` or `send_task` (see [[Calling Tasks: apply_async and send_task]]), a schedule entry is just a task name, arguments, options and a schedule object that answers "is this due, and when should I look again?". This page covers the schedule types, the `Scheduler` loop, the persistent store, and how beat is started on its own or embedded in a worker.

Sources: [celery/beat.py:219-250](repo://celery/beat.py#L219-L250), [celery/beat.py:393-421](repo://celery/beat.py#L393-L421)

## Declaring periodic tasks

Entries come from the `beat_schedule` setting, a dict keyed by entry name with the fields `task`, `schedule`, `args`, `kwargs` and `options`, or from `app.add_periodic_task(schedule, sig, args, kwargs, name, **opts)`. The latter converts the signature into an entry keyed by `name` or, without one, the signature's repr, so adding the same unnamed signature twice makes the second override the first (a warning says so). If the app is not configured yet, the entry is queued in `_pending_periodic_tasks` and applied during `_load_config`.

Sources: [celery/app/base.py:1295-1334](repo://celery/app/base.py#L1295-L1334), [celery/app/base.py:1269-1274](repo://celery/app/base.py#L1269-L1274)

A `ScheduleEntry` holds `name`, `task`, `schedule`, `args`, `kwargs`, `options`, `last_run_at` and `total_run_count`. It normalizes the schedule with `maybe_schedule`, defaults `last_run_at` to now, and `next()` returns a copy with the run count incremented and the time updated, so entries are treated as immutable values that the scheduler replaces. Equality compares only the editable fields (`task`, `args`, `kwargs`, `options`, `schedule`), which is how a changed schedule is detected. `BeatLazyFunc` can wrap an argument so it is evaluated at send time.

Sources: [celery/beat.py:50-80](repo://celery/beat.py#L50-L80), [celery/beat.py:82-216](repo://celery/beat.py#L82-L216)

## Schedule types

All schedules derive from `BaseSchedule` and answer two questions: `remaining_estimate(last_run_at)` (how long until the next run) and `is_due(last_run_at)`, which returns `schedstate(is_due, next)`, where `next` is the number of seconds until the scheduler should check again.

| Type | Meaning | Notes |
| --- | --- | --- |
| `schedule(run_every, relative)` | Run every N seconds (a `timedelta` or number) | Due when no time remains; then `next` is the full interval. `relative` is passed through to the `remaining` calculation |
| `crontab(minute, hour, day_of_week, day_of_month, month_of_year)` | Cron-like times; field specs are parsed by `crontab_parser` | `crontab.from_string` accepts a cron string; honours `beat_cron_starting_deadline` |
| `solar(event, lat, lon)` | Sunrise, sunset, solar noon and related events for a location | Takes the observer's latitude and longitude |

`maybe_schedule` accepts a number, a `timedelta` or a schedule object: numbers and timedeltas become `schedule`, and any object has its `app` set.

Sources: [celery/schedules.py:65-110](repo://celery/schedules.py#L65-L110), [celery/schedules.py:111-174](repo://celery/schedules.py#L111-L174), [celery/schedules.py:323-345](repo://celery/schedules.py#L323-L345), [celery/schedules.py:703-725](repo://celery/schedules.py#L703-L725)

The crontab deadline works like this: with `beat_cron_starting_deadline` set, `is_due` finds the latest run the crontab allowed since `last_run_at`, and if that is older than the deadline it reports not due. This prevents a beat that was down from firing a stale run when it comes back. When due, or past the deadline, `next` is recomputed from now.

Sources: [celery/schedules.py:641-688](repo://celery/schedules.py#L641-L688)

## The Scheduler loop

`Scheduler.__init__` takes the app, optional initial `schedule`, `max_interval` (argument, else `beat_max_loop_interval`, else the default) and the sync settings. Unless `lazy`, it calls `setup_schedule`, which installs the default entries and merges `app.conf.beat_schedule` with `merge_inplace`. `merge_inplace` removes entries not in the new schedule, updates the editable fields of existing ones, and adds new ones, so config changes take effect without losing run history.

Sources: [celery/beat.py:252-278](repo://celery/beat.py#L252-L278), [celery/beat.py:423-472](repo://celery/beat.py#L423-L472)

`install_default_entries` adds `celery.backend_cleanup` at 04:00 daily with a 12-hour expiry, but only if `result_expires` is set and the backend does not `supports_autoexpire` (see [[Result Backend Catalogue]]).

Sources: [celery/beat.py:268-277](repo://celery/beat.py#L268-L277)

`tick()` is one iteration and returns how long to sleep. It keeps entries in a heap of `(time, priority, entry)`:

1. If the heap is missing or the schedule changed (`schedules_equal` against the last copy), it rebuilds the heap with `populate_heap`, computing each entry's `is_due`.
2. It looks at the earliest entry and calls `is_due`.
3. If due, it pops it, `reserve`s the entry (replacing it in the schedule with `next(entry)`, which updates `last_run_at` and the count), publishes with `apply_entry`, and pushes the next occurrence back. It returns 0 so the next tick runs at once.
4. If not due, it returns the time until it is due, adjusted by a small drift and capped at `max_interval`.

Only one due task runs per tick. If the popped entry is not the one examined (a schedule change under it), it is pushed back.

Sources: [celery/beat.py:279-365](repo://celery/beat.py#L279-L365)

`apply_async(entry, producer, advance=True)` first reserves the entry, so timestamps and counts are updated even if sending raises; a failure is re-raised as `SchedulingError` ("Couldn't apply scheduled task"). It evaluates lazy arguments, then calls `task.apply_async(args, kwargs, producer=..., **entry.options)` if the task is registered in this process, or `app.send_task` with the same options if it is not, which lets beat run without importing task code. After each send it counts tasks since the last sync and syncs when `should_sync()` says so (`sync_every` seconds, or `beat_sync_every` tasks). `apply_entry` logs and swallows exceptions so one bad entry does not stop the loop.

Sources: [celery/beat.py:279-291](repo://celery/beat.py#L279-L291), [celery/beat.py:381-421](repo://celery/beat.py#L381-L421)

## Persistence

The default scheduler class is `PersistentScheduler`, configured by `beat_scheduler`, which keeps the schedule in a `shelve` database at `beat_schedule_filename` (default `celerybeat-schedule`). On start it opens the file; a corrupt file is removed and recreated. `_create_schedule` resets stores written by older versions that lack the `__version__`, `tz` or `utc_enabled` keys. It also clears the stored entries (and warns) if the configured timezone or the `enable_utc` setting has changed since the file was written, because stored times would be wrong. It then merges the configured schedule, installs the default entries, stores the version, timezone and UTC flag, and syncs.

Sources: [celery/beat.py:505-568](repo://celery/beat.py#L505-L568), [celery/beat.py:569-611](repo://celery/beat.py#L569-L611)

Because `Service.get_scheduler` resolves the class through `symbol_by_name` with the `celery.beat_schedulers` entry-point aliases, a scheduler backed by a database can be installed as a plugin and selected with `--scheduler`.

Sources: [celery/beat.py:666-680](repo://celery/beat.py#L666-L680)

## The Service and running beat

`Service` owns the loop. `start()` sends `beat_init` (and `beat_embedded_init` plus a process title if embedded), then repeats `scheduler.tick()`, sleeping for the returned interval when positive and syncing as needed, until a shutdown event or `KeyboardInterrupt`; `finally` syncs and closes the scheduler. `stop(wait=True)` sets the shutdown flag and waits for the stop event.

Sources: [celery/beat.py:612-665](repo://celery/beat.py#L612-L665)

`celery beat` runs the `Beat` program class from `celery.apps.beat`, which resolves the schedule filename and scheduler class from arguments or settings (`either`), then starts the `Service`. With `celery worker -B`, the worker's `Beat` bootstep (see [[Worker Architecture and Bootsteps]]) creates an `EmbeddedService`: by default a separate `multiprocessing` process, or, with `thread=True` or when multiprocessing is not available, a daemon thread with `max_interval=1` so it can be stopped promptly. The worker refuses `-B` with the gevent and eventlet pools.

Sources: [celery/apps/beat.py:40-70](repo://celery/apps/beat.py#L40-L70), [celery/beat.py:682-738](repo://celery/beat.py#L682-L738), [celery/worker/components.py:181-205](repo://celery/worker/components.py#L181-L205)
