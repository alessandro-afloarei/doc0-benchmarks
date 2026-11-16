---
type: architecture
title: Beat Scheduler
description: How celery beat turns periodic schedule entries into task publications, including the tick loop, the persistent shelve-backed scheduler, schedule types, and the Service lifecycle.
tags: [celery, beat, scheduler, periodic-tasks, schedules, crontab]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:42:35.525Z
sources:
  - id: openwiki-source-ac404435efa758dad4bbfc83
    resource: repo://celery/app/defaults.py
  - id: openwiki-source-2a32c4e613bc7be1d621d647
    resource: repo://celery/beat.py
  - id: openwiki-source-c3f5d48780ae239f4c7470eb
    resource: repo://celery/schedules.py
generated: { by: "claude-code", at: "2026-11-16T10:42:35.525Z" }
---

# Beat Scheduler

Celery beat is the periodic-task scheduler. It does not execute tasks itself; it decides when a scheduled task is due and then publishes it through the normal `apply_async` path, so the worker receives it like any other task. The implementation lives in `celery/beat.py` (the `Scheduler`, `PersistentScheduler`, `ScheduleEntry`, and `Service` classes), the schedule types in `celery/schedules.py`, and the process wrapper in `celery/apps/beat.py`.

## Responsibility and ownership

Beat owns three things:

- the set of schedule entries (`ScheduleEntry` objects keyed by name), taken from the `beat_schedule` setting plus any entries added at runtime;
- the timing decision: which entry is due next, computed from each entry's schedule and last run time;
- the publication of due entries via `Scheduler.apply_async`.

Beat holds no task state of its own. Results and worker-side execution belong to the usual task pipeline described in [the task execution lifecycle](../workflows/task-execution-lifecycle.md).

## Process and entrypoints

`celery/apps/beat.py` defines `Beat`, which resolves its scheduler class and schedule filename (from `beat_scheduler` and `beat_schedule_filename`, with CLI arguments taking precedence), installs signal handlers for syncing, and then starts a `Service`. The `celery beat` subcommand reaches this wrapper (see [command-line interface](../operations/cli.md)).

`Service.start()` (around lines 633–655 of `celery/beat.py`) sends `beat_init` (and `beat_embedded_init` when embedded), then loops while not shut down:

1. calls `self.scheduler.tick()`, which returns the delay until the next due entry;
2. sleeps for that interval when it is positive;
3. syncs the schedule store if `should_sync()` says so.

On exit (including `KeyboardInterrupt` or `SystemExit`), the `finally` branch calls `sync()` so that the persistent store is flushed. `Service.get_scheduler` resolves `scheduler_cls` through the `celery.beat_schedulers` extension namespace, so custom schedulers can be plugged in by name.

## The tick loop

`Scheduler.tick()` (lines ~326–365) executes one iteration. It keeps a binary heap of `(time, priority, entry)` events:

- If the heap is empty or the set of schedules has changed (checked by `schedules_equal` against a copy of the previous schedule), it repopulates the heap with `populate_heap`.
- It inspects the earliest event. If the entry is due, it pops the event, verifies it is still the same object, calls `reserve(entry)` to advance the entry's `last_run_at` and get the next instance, runs `apply_entry`, and pushes the next event.
- It returns the preferred sleep interval. An empty heap returns `max_interval`.

Only one due task is dispatched per call to `tick()`. Multiple entries due at the same instant are handled over successive iterations, each returning a near-zero delay.

## Publishing a due entry

`Scheduler.apply_async(entry, ...)` (lines ~393–418):

1. calls `reserve(entry)` **before** publishing, so the entry's timestamps and counters move forward even if publication fails. This prevents a failing entry from being retried on every tick.
2. looks up the task by name in `app.tasks`. If the task is registered locally, it calls `task.apply_async(...)`; otherwise it calls `send_task`, which publishes by name so beat can schedule tasks that only exist on workers.
3. wraps any exception in `SchedulingError`, and in `finally` increments `_tasks_since_sync` and runs `_do_sync()` when `should_sync()` is true.

Arguments stored in an entry may be lazy: `BeatLazyFunc` wraps a callable that is evaluated at publication time via `_evaluate_entry_args` and `_evaluate_entry_kwargs`.

## Persistence and sync

`Scheduler` keeps the schedule in memory. `should_sync()` (lines ~381–387) returns true when either the time since the last sync exceeds `sync_every` seconds, or the number of tasks since the last sync reaches `sync_every_tasks`. `sync_every_tasks` defaults to the `beat_sync_every` setting.

`PersistentScheduler` (line ~505) stores entries in a `shelve` database (`persistence = shelve`), using the filename from `beat_schedule_filename` (default `celerybeat-schedule`). Its `setup_schedule` (line ~531) opens the store and:

- clears the store when the stored timezone or UTC flag differs from the current configuration, because cached timestamps would be wrong;
- clears the store when it lacks the `__version__`, `tz`, or `utc_enabled` markers that newer releases write, so entries from an incompatible older layout are dropped;
- destroys and recreates the store when it is corrupted, via `_destroy_open_corrupted_schedule`;
- merges the configured `beat_schedule` into the stored entries (`merge_inplace`) and installs the default entries, then writes the current markers.

`sync()` calls `self._store.sync()`. The store is shelve-based, so it is local to one machine: running two beat processes against the same file is not supported.

## Schedule types

`celery/schedules.py` provides:

- `schedule` (line ~111) — interval-based, `run_every` as a number of seconds or a `timedelta`; `is_due` returns `(due, remaining)`.
- `crontab` (line ~323) — minute/hour/day-of-week/day-of-month/month-of-year fields, parsed by `crontab_parser`; `is_due` and `remaining_estimate` compute the next matching time.
- `solar` (line ~717) — sunrise and sunset events for a latitude and longitude, based on a tuple of event names.

All of them derive from `BaseSchedule` (line ~65), which provides `is_due` and `remaining_estimate` and accepts an injectable `nowfun` and optional app for timezone handling.

## Configuration

Beat settings are in the `beat` namespace of `celery/app/defaults.py` (lines ~73–80): `max_loop_interval` (default `0`, meaning the scheduler decides), `schedule` (the dict of entries), `scheduler` (default `celery.beat:PersistentScheduler`), `schedule_filename` (default `celerybeat-schedule`), and `sync_every`. Older `celerybeat_*` names are accepted through the `__old__` mapping.

## Invariants and failure behaviour

- An entry is advanced before it is published. A failure during publication is raised as `SchedulingError` but does not cause the entry to re-fire immediately on the next tick.
- A schedule change (added, removed, or edited entry) is detected by comparing against the previous snapshot, which triggers a heap rebuild on the next tick.
- Interruption (`KeyboardInterrupt`, `SystemExit`) leads to a final `sync()` so the shelve file reflects the last published state.

## Extension seams

- Subclass `Scheduler` or `PersistentScheduler` and register it under `celery.beat_schedulers`, or set `beat_scheduler` to a dotted path.
- `Scheduler.add(**kwargs)` and `update_from_dict` allow runtime changes to entries.
- The `beat_init` and `beat_embedded_init` signals fire at startup (see [events and signals](events-and-signals.md)).

## Representative tests

Unit tests for the scheduler and schedules live under `t/unit/` (the `t/unit/app` and `t/unit/worker` trees are the closest starting points); `t/unit/apps` covers the beat wrapper.
