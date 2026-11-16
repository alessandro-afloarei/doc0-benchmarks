---
type: subsystem
title: "Periodic Tasks: Beat and Schedules"
description: How celery beat schedules periodic tasks. Covers the Scheduler heap/tick loop, the shelve-backed PersistentScheduler, the Service run loop, beat embedded in a worker (-B), schedule types (interval, crontab, solar), timezone resets, and the beat_* settings.
tags: [beat, scheduler, periodic-tasks, crontab, schedules]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:49.645Z
sources:
  - id: openwiki-source-ac404435efa758dad4bbfc83
    resource: repo://celery/app/defaults.py
  - id: openwiki-source-70554d3b023ee0266c9bffd6
    resource: repo://celery/apps/beat.py
  - id: openwiki-source-2a32c4e613bc7be1d621d647
    resource: repo://celery/beat.py
  - id: openwiki-source-c3f5d48780ae239f4c7470eb
    resource: repo://celery/schedules.py
  - id: openwiki-source-cd5b25b412e425989370ceb9
    resource: repo://celery/worker/components.py
generated: { by: "claude-code", at: "2026-11-15T17:08:49.645Z" }
---

# Periodic Tasks: Beat and Schedules

`celery beat` is a **producer-only** process. It keeps a set of schedule entries and publishes each task when it becomes due. Workers then execute the task normally. Beat does not execute tasks itself. **Run exactly one beat per schedule.** Beat has no built-in leader election, so two beat processes publish duplicates.

Code: `celery/beat.py` (the scheduler and service), `celery/schedules.py` (schedule types), `celery/apps/beat.py` (the program wrapper), `celery/bin/beat.py` (the CLI), and the `Beat` bootstep in `celery/worker/components.py` (embedded mode).

## Declaring entries

Entries come from three sources:

- the `beat_schedule` setting: a dict of `name -> {'task', 'schedule', 'args', 'kwargs', 'options', 'relative'}`;
- `app.add_periodic_task(schedule, sig, name=...)`. This writes into `conf.beat_schedule`, or queues the entry until the configuration is loaded. It is usually called from an `on_after_configure` or `on_after_finalize` receiver. Without a `name`, the key is `repr(sig)`, and adding the same signature twice overwrites the first entry with a warning;
- default entries: `celery.backend_cleanup` is added at 04:00 daily (`crontab('0','4','*')`, expiring after 12 hours) when `result_expires` is set and the backend does not support automatic expiry (`supports_autoexpire`).

A `schedule` value can be a number of seconds, a `timedelta` (converted by `maybe_schedule`), or any `BaseSchedule`. Args and kwargs may contain `BeatLazyFunc` objects, which are evaluated each time the entry is sent.

## Schedule types (`celery/schedules.py`)

All schedule types implement `is_due(last_run_at) -> schedstate(is_due, next)`. Here `next` is the number of seconds until beat should check again.

| Type | Meaning |
|---|---|
| `schedule(run_every)` | Fixed interval. Due when `remaining_estimate` reaches 0. `next` is the full interval after it fires. With `relative=True`, the interval is aligned to the time beat starts. |
| `crontab(minute, hour, day_of_week, day_of_month, month_of_year)` | Cron-style, parsed by `crontab_parser`. `crontab.from_string('*/5 * * * *')` is also supported. Computes the next matching time with `remaining_delta`, including roll-over and day validation. |
| `solar(event, lat, lon)` | Astronomical events (`sunrise`, `sunset`, `solar_noon`, and civil/nautical/astronomical `dawn`/`dusk`) computed with the `ephem` library. |

Schedules get the current time from `app.now()` and convert to the app timezone (`timezone`, `enable_utc`). With `beat_cron_starting_deadline` set, a crontab whose most recent feasible run time is older than the deadline is **not** treated as due. This stops beat from firing stale runs that were missed, for example after downtime.

## The scheduler loop

`Scheduler` (base, in-memory) and `PersistentScheduler` (the default, `beat_scheduler = 'celery.beat:PersistentScheduler'`) share one algorithm:

1. **Heap.** `populate_heap()` builds a min-heap of `(when_utc_timestamp, priority, entry)`. The heap is rebuilt whenever the schedule mapping differs from the last copy (`schedules_equal`), so schedulers that edit entries at run time take effect.
2. **Tick.** `tick()` looks at the earliest entry. If it is due, the method pops it and checks that the popped item is the expected one. It then **reserves** the entry, meaning it advances `last_run_at` and `total_run_count` with `next(entry)` *before* sending, so that a publish failure cannot cause a tight retry loop. It then sends the entry with `apply_entry`, pushes the next occurrence back on the heap, and returns `0`. If the entry is not due, it returns `min(next_check - 10ms drift, max_interval)`.
3. **Send.** `apply_async(entry)` uses `task.apply_async` if the task is registered in this process, or `app.send_task` otherwise, and passes `entry.options` (queue, expires, priority, and so on). Exceptions are wrapped in `SchedulingError`, which `apply_entry` logs. Beat does not crash when the broker refuses a message.
4. **Sync.** After each send, and after each sleep, `should_sync()` checks whether `sync_every` (3 minutes) has elapsed or `beat_sync_every` tasks have been sent. If so, `sync()` persists the schedule.

`Service.start()` sends `beat_init` (and `beat_embedded_init` when embedded) and then loops `tick()` and `sleep(interval)` until shutdown. On exit it calls `scheduler.close()`. `max_interval` comes from `beat_max_loop_interval`, which defaults to 300 seconds for the default scheduler (`DEFAULT_MAX_INTERVAL`).

### PersistentScheduler (shelve)

The schedule is stored in a `shelve` database at `beat_schedule_filename` (default `celerybeat-schedule`, which the dbm backend may extend with suffixes such as `.db`). The stored data includes `entries`, `__version__`, `tz`, and `utc_enabled`.

- If the database cannot be opened or read, it is deleted (every known suffix) and recreated, and an error is logged.
- If the stored `tz` or `utc_enabled` differs from the current configuration, the stored entries are **cleared**. This resets `last_run_at` history, so a timezone change makes all schedules start fresh.
- On startup, entries from `beat_schedule` are merged into the stored entries (`merge_inplace`). Existing entries keep their `last_run_at` and run count, and only their editable fields (`task`, `schedule`, `args`, `kwargs`, `options`) are updated. Stored entries that are no longer in the configuration are removed.

The database must be on writable local disk. In containers, point `--schedule` at a persistent volume, or use a database-backed scheduler such as `django-celery-beat`, which is selected via `--scheduler` or entry points.

## Running beat

- **Standalone:** `celery -A proj beat [--scheduler cls] [--schedule file] [--max-interval N] [--pidfile ...]`. `apps/beat.py:Beat` prints a banner, sets up logging, creates a pidlock when `--pidfile` is given, and installs a SIGTERM/SIGINT handler that syncs the schedule before it raises `SystemExit`.
- **Embedded:** `celery worker -B` enables the worker `Beat` bootstep, which creates `EmbeddedService`. By default it is a separate `multiprocessing` child process (`_Process`) that resets signals, closes inherited file descriptors, and runs `Service.start(embedded_process=True)`. With `thread=True`, or when multiprocessing is unavailable, it runs in a daemon thread with `max_interval=1`. Embedded beat is rejected with `ImproperlyConfigured` for gevent and eventlet pools. It is meant for development and single-worker setups. Embedded beat on several workers produces duplicate publishes.

Scheduler classes resolve through `symbol_by_name` with aliases from the `celery.beat_schedulers` entry-point group.

## Settings

| Setting | Default | Effect |
|---|---|---|
| `beat_schedule` | `{}` | static entries |
| `beat_scheduler` | `celery.beat:PersistentScheduler` | scheduler class |
| `beat_schedule_filename` | `celerybeat-schedule` | shelve path |
| `beat_max_loop_interval` | `0` (meaning the scheduler default of 300s) | maximum sleep between checks |
| `beat_sync_every` | `0` | sync after N sends, in addition to the 3-minute timer |
| `beat_cron_starting_deadline` | `None` | skip crontab runs missed by more than N seconds |

## Tests

- `t/unit/app/test_beat.py`: heap and tick, persistence and corruption handling, embedded service.
- `t/unit/app/test_schedules.py`: crontab, solar, and interval math.

## See also

- [Command-Line Interface](cli.md)
- [Configuration Settings Reference](../reference/configuration.md)
