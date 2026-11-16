---
type: architecture
title: Beat Periodic Scheduler
description: How celery beat schedules periodic tasks — the Service loop, Scheduler heap and tick algorithm, the shelve-backed PersistentScheduler, ScheduleEntry, and the schedule/crontab/solar schedule types.
tags: [beat, scheduler, periodic-tasks, crontab, schedules]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:57:55.789Z
sources:
  - id: openwiki-source-ac404435efa758dad4bbfc83
    resource: repo://celery/app/defaults.py
  - id: openwiki-source-2a32c4e613bc7be1d621d647
    resource: repo://celery/beat.py
  - id: openwiki-source-c3f5d48780ae239f4c7470eb
    resource: repo://celery/schedules.py
  - id: openwiki-source-cd5b25b412e425989370ceb9
    resource: repo://celery/worker/components.py
generated: { by: "claude-code", at: "2026-11-16T06:57:55.789Z" }
---

# Beat Periodic Scheduler

`celery beat` is a separate long-running process (or an embedded worker
component) that **publishes** periodic tasks at the right time. It never
executes tasks itself — it calls `apply_async`/`send_task` exactly like any
client, and workers consume the resulting messages. Exactly one beat should run
per schedule; running two will publish duplicates.

Main modules:

| Module | Role |
|--------|------|
| `celery/beat.py` | `ScheduleEntry`, `Scheduler`, `PersistentScheduler`, `Service`, `EmbeddedService` |
| `celery/schedules.py` | Schedule types: `schedule` (interval), `crontab`, `solar`, `maybe_schedule` |
| `celery/apps/beat.py` | `Beat` application wrapper: banner, logging, pidlock, signal handlers |
| `celery/bin/beat.py` | `celery beat` click command |
| `celery/utils/time.py` | `remaining()`, timezone helpers, `maybe_make_aware` |

## Defining the schedule

Entries come from two places:

1. The `beat_schedule` setting — a dict of `name -> {task, schedule, args,
   kwargs, options, relative}`.
2. `app.add_periodic_task(schedule, sig, name=...)` (`celery/app/base.py`). It
   converts a signature into the same dict form keyed by `name or repr(sig)`;
   adding the same signature twice without a distinct `name` overrides the first.
   Calls made before the app is configured are queued in
   `_pending_periodic_tasks` and applied during config loading (typically
   from an `on_after_configure` handler).

`ScheduleEntry.__init__` normalises `schedule` through `maybe_schedule`:
numbers become `timedelta(seconds=...)`, timedeltas become `schedule(...)`
instances, and existing schedule objects get their `app` attached.

## Settings

From the `beat` namespace in `celery/app/defaults.py`:

| Setting | Default | Meaning |
|---------|---------|---------|
| `beat_schedule` | `{}` | Static entries |
| `beat_scheduler` | `celery.beat:PersistentScheduler` | Scheduler class (aliases loaded from the `celery.beat_schedulers` entry-point namespace, e.g. django-celery-beat) |
| `beat_schedule_filename` | `celerybeat-schedule` | Shelve file for `PersistentScheduler` |
| `beat_max_loop_interval` | `0` (falls back to `DEFAULT_MAX_INTERVAL = 300` s) | Upper bound on sleep between ticks |
| `beat_sync_every` | `0` | Force a sync after N published tasks |
| `beat_cron_starting_deadline` | `None` | Skip missed crontab runs older than this many seconds |

## Service loop

`Service.start()` sends `beat_init` (and `beat_embedded_init` when embedded),
then loops until shutdown:

```
while not shutdown:
    interval = scheduler.tick()
    if interval > 0:
        sleep(interval)
        if scheduler.should_sync(): scheduler._do_sync()
finally: sync()  ->  scheduler.close()
```

`Service.get_scheduler()` resolves `scheduler_cls` with aliases from the
`celery.beat_schedulers` entry points, passing `schedule_filename`,
`max_interval` and `lazy`. `lazy=True` creates a scheduler without calling
`setup_schedule()`; it is used for introspection and subclasses must be
idempotent under it.

## Scheduler.tick algorithm

The `Scheduler` keeps a min-heap of `event_t(time, priority, entry)`:

1. If the heap is empty or the schedule changed (`schedules_equal` compares a
   copy of the previous schedule), rebuild it with `populate_heap()`, computing
   each entry's absolute UTC due time via `_when()`.
2. Look at the earliest entry and call `entry.is_due()` →
   `schedule.is_due(last_run_at)`, which returns `(is_due, next_seconds)`.
3. If due and the heap top is still the same event: `reserve()` replaces the
   entry with `next(entry)` (updated `last_run_at`, `total_run_count + 1`),
   `apply_entry()` publishes it, the next occurrence is pushed back on the heap,
   and `tick()` returns `0` so the loop immediately checks again. **One due
   task is sent per tick.**
4. Otherwise return `min(next_seconds - 10ms drift, max_interval)`.

`apply_async` evaluates `BeatLazyFunc` args/kwargs, uses the registered task's
`apply_async` if the task is known locally or `app.send_task` otherwise, and
passes `entry.options` (queue, expires, etc.). Errors are re-raised as
`SchedulingError`, but `apply_entry` logs them so one broken entry does not
kill beat. Run counters are advanced before sending, so a failing entry is not
retried in a tight loop. Every send increments `_tasks_since_sync` and may
trigger a sync.

`setup_schedule()` installs default entries and merges `beat_schedule`.
`install_default_entries` adds `celery.backend_cleanup` at 04:00 daily
(`crontab('0', '4', '*')`, expiring after 12 h) when `result_expires` is set and
the backend does not support automatic expiry.

`merge_inplace(b)` removes entries that are in the stored schedule but not
in the configuration (symmetric difference), updates the editable fields
(`task`, `schedule`, `args`, `kwargs`, `options`) of existing ones, and adds
new ones — so a persisted `last_run_at` survives restarts while the
configuration remains authoritative.

## PersistentScheduler

The default scheduler stores entries in a `shelve` database at
`beat_schedule_filename`, so `last_run_at` and run counts survive restarts.

- If opening or reading the file fails, the file (all suffixes `''`, `.db`,
  `.dat`, `.bak`, `.dir`) is deleted and recreated.
- The store also records `__version__`, `tz` and `utc_enabled`. If the
  configured `timezone` or `enable_utc` differs from the stored value, the
  whole schedule is cleared with a warning; legacy files missing these fields
  are also reset.
- `sync()` calls `shelve.sync()`; it runs every `sync_every` (3 minutes),
  after `beat_sync_every` tasks, and on close.

Custom schedulers (database-backed etc.) subclass `Scheduler` and override
`setup_schedule`, `schedule` (get/set), `sync`, and `info`.

## Schedule types

All derive from `BaseSchedule` (`celery/schedules.py`), which supplies `now()`
from the app (respecting `timezone`/`enable_utc`) and `is_due(last_run_at)`
returning a `schedstate(is_due, next)`.

- **`schedule(run_every, relative=False)`** – fixed interval. `is_due` is true
  when `remaining_estimate` reaches zero, and then returns the full interval as
  the next check. `relative=True` rounds to the interval's resolution.
- **`crontab(minute, hour, day_of_week, day_of_month, month_of_year)`** –
  cron-like; fields are parsed by `crontab_parser` into sets of allowed values
  and `crontab.from_string()` accepts a five-field cron expression.
  `remaining_delta` computes the next matching datetime, handling day/month
  roll-over. With `beat_cron_starting_deadline`, `is_due` walks forward to the
  last feasible missed run and refuses to run it if it is older than the
  deadline (prevents a burst of stale runs after downtime).
- **`solar(event, lat, lon)`** – sunrise/sunset/dawn/dusk/solar-noon
  schedules computed with the optional `ephem` package.

## Running beat

- **Standalone:** `celery -A proj beat` → `celery.apps.beat.Beat.run()`
  sets up logging, prints the banner, creates a pidlock if `--pidfile` is
  given, and installs SIGTERM/SIGINT handlers that sync the schedule before
  exit.
- **Embedded:** `celery worker -B` enables the worker's `Beat` bootstep
  (`celery/worker/components.py`), which starts `EmbeddedService`: a
  separate `multiprocessing` process by default, or a daemon thread with
  `max_interval=1` when `thread=True` or multiprocessing is unavailable. It is
  refused with `ImproperlyConfigured` for gevent/eventlet pools.

## Tests

- `t/unit/app/test_beat.py` – Scheduler tick/heap logic, PersistentScheduler
  corruption and timezone resets, Service and embedded service.
- `t/unit/app/test_schedules.py` – `schedule`, `crontab` (parser, deltas,
  starting deadline), `solar`.
- `t/unit/bin/test_beat.py` – CLI wiring.

See also: [Worker bootsteps](worker/worker-bootsteps.md),
[CLI and daemonization](../operations/cli-and-daemonization.md).
