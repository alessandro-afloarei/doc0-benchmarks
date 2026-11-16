---
type: operations
title: Periodic tasks and beat persistence
description: How beat evaluates schedules, publishes due entries, persists last-run metadata, recovers schedule storage and loads custom schedulers.
tags: [beat, scheduling, periodic-tasks, persistence]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:34:04.042Z
sources:
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-2a32c4e613bc7be1d621d647
    resource: repo://celery/beat.py
  - id: openwiki-source-c3f5d48780ae239f4c7470eb
    resource: repo://celery/schedules.py
  - id: openwiki-source-c85dccec9c7e9801f152e45d
    resource: repo://docs/userguide/periodic-tasks.rst
generated: { by: "codex", at: "2026-11-16T06:34:04.042Z" }
---

# Periodic tasks and beat persistence

Beat publishes task invocations when schedules become due. Workers still execute those invocations through the normal broker path. Run one scheduler for each schedule: multiple independent beat instances can publish duplicate periodic tasks. Periodic tasks can overlap if execution takes longer than their interval, so use application-level coordination when overlap is unacceptable.

## Define and run a schedule

For an app with a registered task named `proj.tasks.refresh`:

```python
app.conf.beat_schedule = {
    'refresh-every-minute': {
        'task': 'proj.tasks.refresh',
        'schedule': 60.0,
        'args': (),
        'options': {'expires': 50},
    },
}
```

Run `celery -A proj beat -l INFO` and a worker consuming the selected task queue. Schedule entries carry the task name, arguments, publish options, last-run time and run count. The last two fields describe scheduling attempts, not successful task execution. `app.add_periodic_task()` also populates the schedule; use distinct names when adding the same signature more than once.

## Due checks and publication

Schedule objects implement `is_due(last_run_at)`, returning whether to publish and the next check delay. Implementations include intervals, crontab and solar schedules. They use application time and timezone settings. Crontab additionally respects `beat_cron_starting_deadline` to suppress overdue runs outside a configured lookback window.

The scheduler maintains a heap of next checks and rebuilds it when schedule definitions change. Each `tick()` dispatches at most one due entry and returns the next sleep delay, bounded by the scheduler's maximum interval. The service repeatedly ticks and sleeps; it also syncs storage when required.

The entry is reserved before publication, advancing last-run time and count. Publishing calls the registered task's `apply_async()` or falls back to `send_task()` by name. Publication errors are wrapped as `SchedulingError` and logged by `apply_entry()`, while sync accounting runs in `finally`. Advancing before publishing prevents a failure from causing an immediate endless reschedule loop, but a reserved entry is not proof that a message reached the broker. Diagnose the [publishing boundary](../workflows/publishing.md) separately from task execution.

## Persistent schedule state

`PersistentScheduler` uses `shelve`, with its filename supplied by the CLI or `beat_schedule_filename`. It merges current `beat_schedule` definitions into stored entries and saves version, timezone and UTC metadata. If timezone or UTC settings change, it clears stored scheduling state. Corrupted storage is removed, including known database suffixes, then reopened.

Keep this local state accessible and writable by the beat process. Treat deleting it as resetting scheduling history. The storage code offers corruption recovery, not coordination among multiple scheduler processes.

Beat installs `celery.backend_cleanup` at 04:00 when results expire and the backend does not automatically expire them. This connects scheduler availability to retention for those [result backends](../integrations/result-backends.md).

## Extension and verification

`Service.get_scheduler()` resolves the configured scheduler class, including `celery.beat_schedulers` entry-point aliases. A custom scheduler owns its schedule storage and synchronization but must preserve the due-check and tick contract. Embedded beat uses a process by default when multiprocessing is available, with a thread alternative; green worker pools reject embedded beat.

Focused tests are `t/unit/app/test_beat.py`, `t/unit/app/test_schedules.py` and `t/unit/bin/test_beat.py`. Exercise restart persistence, timezone changes, publication errors and custom due-check delays when changing scheduling. Compare beat logs with [worker inspection](monitoring.md): `inspect scheduled` shows worker ETA requests, not beat's recurring schedule.
