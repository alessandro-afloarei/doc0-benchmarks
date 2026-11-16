---
type: operations
title: Beat and periodic scheduling
description: How Beat evaluates periodic schedules, publishes due tasks, persists scheduling history, and handles timing and scheduler extensions.
tags: [beat, scheduling, periodic-tasks, persistence, timezone]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:55:28.912Z
sources:
  - id: openwiki-source-2a32c4e613bc7be1d621d647
    resource: repo://celery/beat.py
  - id: openwiki-source-c3f5d48780ae239f4c7470eb
    resource: repo://celery/schedules.py
  - id: openwiki-source-c85dccec9c7e9801f152e45d
    resource: repo://docs/userguide/periodic-tasks.rst
generated: { by: "codex", at: "2026-11-16T07:55:28.912Z" }
---

# Beat and periodic scheduling

Beat is a task publisher. Workers execute the tasks it emits, so running Beat alone does not execute periodic work. Run one scheduler for a given schedule: the default implementation has no distributed leader election, and duplicate schedulers can publish duplicate tasks.

## Configure and start

For an application exposing a task named `tasks.add`:

```python
app.conf.beat_schedule = {
    "add-every-minute": {
        "task": "tasks.add",
        "schedule": 60.0,
        "args": (2, 3),
        "options": {"expires": 50},
    },
}
app.conf.timezone = "UTC"
```

```bash
celery -A tasks:app worker --loglevel=INFO
# In a separate terminal:
celery -A tasks:app beat --loglevel=INFO
```

The dictionary key names the schedule entry; `task` names the registered task, and `options` are publication options. Schedule types include intervals, crontab, and solar schedules. `app.add_periodic_task()` also populates the schedule and can be deferred during application configuration. See [application lifecycle](../architecture/application.md).

## Due checks and ordering

A ScheduleEntry owns the task name, arguments, options, schedule, last-run timestamp, and total run count. Advancing creates a replacement entry with a new timestamp and incremented count.

The scheduler maintains a heap and rebuilds it when the schedule changes. Each `tick()` publishes at most one due entry and returns the suggested sleep interval, capped by `beat_max_loop_interval`. It advances the entry before publication. Registered tasks use `Task.apply_async`; otherwise Beat uses `app.send_task` by name. A publication exception becomes a SchedulingError and is logged by the entry application path; advancement is not rolled back. Schedule history therefore records scheduling attempts rather than successful task completion.

The service loop sleeps between ticks and synchronizes state based on scheduler policy. A task taking longer than its interval can overlap the next invocation; Beat does not lock the task body. Use application-level coordination where overlap is unacceptable.

## Persistence and time

The default `PersistentScheduler` uses a shelve database at `beat_schedule_filename`; the CLI also accepts a schedule path. It stores entries and timezone/UTC metadata, merges the configured schedule, and syncs on setup and shutdown. It removes and recreates corrupted schedule files and resets the store when timezone or UTC settings change. Keep its storage writable and retain it when restart continuity matters.

This reset behavior belongs to the default scheduler; a custom database scheduler may have different migration/reset rules. Crontab due checks use `beat_cron_starting_deadline`, when configured, to suppress runs whose most recent feasible time is too far in the past. Interval timing, clock changes, and persistence are distinct from worker execution time.

When result expiration is enabled and the backend does not advertise automatic expiry, Beat installs a `celery.backend_cleanup` entry at 04:00 unless an entry of that name already exists. Database result cleanup therefore depends on actually running the scheduling and worker path.

## Extensions and diagnosis

A custom scheduler can be selected by class or an entry point in `celery.beat_schedulers`. The service provides the application, schedule filename, maximum interval, and lazy flag. Preserve the due-check, reservation, and synchronization contracts when changing storage.

If a periodic task is missing, check the entry's task name and due calculation, Beat publication logs, broker routing, worker registration, then result policy. A successful scheduling log is not evidence that user code completed.

[Beat tests](../../t/unit/app/test_beat.py) cover heap ticks, publication failures, syncing, and corrupt persistence. [Schedule tests](../../t/unit/app/test_schedules.py) cover due-time calculations. Continue with [task delivery](../workflows/task-delivery.md), [worker operations](workers.md), and [result backends](../integrations/result-backends.md).
