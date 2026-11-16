---
type: subsystem
title: Periodic Tasks (Beat) and Schedules
description: How celery beat publishes periodic tasks — the Service loop, Scheduler heap and tick algorithm, ScheduleEntry lifecycle, the shelve-backed PersistentScheduler and its reset rules, schedule types (interval, crontab, solar), add_periodic_task/beat_schedule configuration, embedded beat in workers, and custom schedulers.
tags: [beat, scheduler, periodic-tasks, crontab, schedules, solar]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:05:29.073Z
sources:
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-70554d3b023ee0266c9bffd6
    resource: repo://celery/apps/beat.py
  - id: openwiki-source-2a32c4e613bc7be1d621d647
    resource: repo://celery/beat.py
  - id: openwiki-source-c3f5d48780ae239f4c7470eb
    resource: repo://celery/schedules.py
  - id: openwiki-source-cd5b25b412e425989370ceb9
    resource: repo://celery/worker/components.py
generated: { by: "claude-code", at: "2026-11-16T17:05:29.073Z" }
---

# Periodic Tasks (Beat) and Schedules

Beat is a single process that **publishes** tasks on a schedule; it never executes them. Workers consume those messages like any other task. Code: `celery/beat.py` (service, scheduler, entries), `celery/schedules.py` (schedule types), `celery/apps/beat.py` (CLI-facing wrapper) and `celery/bin/beat.py` (`celery beat` command).

> Run exactly one beat per schedule. Two beat processes against the same schedule both send every task; Celery has no built-in leader election for beat.

## Defining the schedule

Two equivalent sources feed `app.conf.beat_schedule`:

```python
app.conf.beat_schedule = {
    'cleanup-every-30s': {
        'task': 'proj.tasks.cleanup',
        'schedule': 30.0,                      # number / timedelta / schedule object
        'args': (16,),
        'kwargs': {'now': BeatLazyFunc(datetime.now)},  # evaluated at send time
        'options': {'queue': 'periodic', 'expires': 25},
    },
}

@app.on_after_configure.connect
def setup(sender, **kw):
    sender.add_periodic_task(crontab(minute=0, hour='*/3'), refresh.s(), name='refresh')
```

`app.add_periodic_task(schedule, sig, name=None, **opts)` converts the signature into an entry keyed by `name` or, if no name is given, `repr(sig)` — so adding two unnamed periodic tasks with the same signature makes the second override the first (a warning is logged). Calls made before the app is configured are queued and applied when configuration loads.

`BeatLazyFunc(func, *args, **kwargs)` values in `args`/`kwargs` are called each time the entry is sent.

## Schedule types (`celery/schedules.py`)

All derive from `BaseSchedule` and implement `is_due(last_run_at) -> (is_due, next_check_seconds)` and `remaining_estimate(last_run_at)`; `now()` uses the app's timezone-aware clock (`app.now`) unless a `nowfun` is supplied.

| Type | Use |
|------|-----|
| `schedule(run_every, relative=False)` | Fixed interval (`timedelta`). Plain numbers and timedeltas in entries are wrapped by `maybe_schedule`. `relative=True` aligns to the interval boundary. |
| `crontab(minute, hour, day_of_week, day_of_month, month_of_year)` | cron(5)-style; each field is parsed by `crontab_parser` (`*`, ranges, steps like `*/15`, lists, weekday names). |
| `solar(event, lat, lon)` | Sunrise/sunset/dawn/dusk/solar noon events, computed with the optional `ephem` library. |

`crontab.is_due` honours `beat_cron_starting_deadline`: if the last feasible run time is further in the past than the deadline (e.g. beat was down), the missed run is **not** fired on startup.

## `ScheduleEntry`

Holds `name`, `task`, `schedule`, `args`, `kwargs`, `options`, `last_run_at` (defaults to now) and `total_run_count`. `next(entry)` returns a new entry with `last_run_at=now` and the count incremented. `update(other)` copies only editable fields (`task`, `schedule`, `args`, `kwargs`, `options`), preserving run history when configuration changes.

## The scheduler loop

`Service.start()` sends `beat_init` (and `beat_embedded_init` when embedded), then loops:

```text
while not shutdown:
    interval = scheduler.tick()
    sleep(interval) if interval > 0
    if scheduler.should_sync(): scheduler._do_sync()
```

`Scheduler.tick()`:

1. Rebuilds a min-heap of `(next_run_timestamp, priority, entry)` when the schedule changed (`schedules_equal` compares entries).
2. Looks at the earliest entry; if due, pops it, `reserve()`s a successor entry (advancing `last_run_at` **before** sending so a failing send does not cause a tight loop), publishes it via `apply_entry`, pushes the successor, and returns `0` to process the next one immediately.
3. Otherwise returns the time until the next entry is due, capped by `max_interval` (`beat_max_loop_interval`, default 300 s; 1 s for threaded embedded beat). Small negative drift (`-0.010`) is applied so beat wakes slightly early.

`Scheduler.apply_async(entry)` evaluates lazy args, publishes through the registered task's `apply_async` (or `app.send_task` for tasks unknown to the beat process) with the entry's `options` and the scheduler's producer, and wraps failures in `SchedulingError`; `apply_entry` logs errors rather than crashing beat. The schedule is synced every `sync_every` (180 s) or after `beat_sync_every` tasks.

`install_default_entries` adds `celery.backend_cleanup` (daily at 04:00) when results expire and the backend cannot auto-expire (see [Result Backends](../results/backends.md)).

## `PersistentScheduler`

The default `beat_scheduler` (`celery.beat:PersistentScheduler`) stores entries in a `shelve` file (`beat_schedule_filename`, default `celerybeat-schedule`, possibly with `.db/.dat/.dir/.bak` suffixes):

- On open errors or corrupt files, the files are deleted and recreated.
- The store records `__version__`, `tz` and `utc_enabled`; if the timezone or `enable_utc` changed (or old fields are missing), the store is **cleared**, resetting `last_run_at` history.
- Entries from `beat_schedule` are merged in place: entries no longer configured are removed, existing ones updated (keeping run state), new ones added.
- `sync()` flushes the shelve; `close()` syncs and closes. `celery.apps.beat.Beat` installs `SIGTERM`/`SIGINT` handlers that sync the schedule before exiting.

Custom schedulers (for example django-celery-beat's database scheduler) subclass `Scheduler` and override `setup_schedule`, `schedule` (`get_schedule`/`set_schedule`), `sync`, etc. They are selected with `beat_scheduler`/`--scheduler`, which accepts class paths or aliases registered under the `celery.beat_schedulers` entry-point group. Schedulers may be instantiated with `lazy=True` purely for introspection, so `__init__` must be idempotent.

## Running beat

- **Standalone:** `celery -A proj beat [-s schedule_file] [--scheduler cls] [--max-interval N] [--pidfile ...] [--detach]`. `celery.apps.beat.Beat` sets up logging, prints a banner, creates the pidlock, and starts the `Service`.
- **Embedded in a worker:** `celery -A proj worker -B`. The worker's `Beat` bootstep (`celery/worker/components.py`) creates `EmbeddedService`, which runs beat in a separate `multiprocessing` process (or a daemon thread with `max_interval=1` if multiprocessing is unavailable or `thread=True`). It is refused with eventlet/gevent pools. Embedded beat is intended for development or single-worker deployments.

## Configuration summary

`beat_schedule`, `beat_scheduler`, `beat_schedule_filename`, `beat_sync_every`, `beat_max_loop_interval`, `beat_cron_starting_deadline`, plus `timezone`/`enable_utc` which affect how crontab times are interpreted and whether the persistent store resets.

## Tests

- `t/unit/app/test_beat.py` — scheduler tick/heap, entry merging, persistent store resets, embedded service.
- `t/unit/app/test_schedules.py` — interval, crontab parsing and due-time calculation, deadlines, solar.
- `t/unit/bin/test_beat.py` — CLI.

## Related

- [Command-Line Interface and Deployment](../operations/cli.md)
- [Worker Architecture and Bootsteps](../worker/worker-architecture.md)
