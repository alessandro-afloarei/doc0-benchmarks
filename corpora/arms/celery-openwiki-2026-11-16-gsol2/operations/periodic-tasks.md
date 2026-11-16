---
type: operations
title: Periodic scheduling with Beat
description: Beat's due-time calculation, publication loop, persistent schedule state, failure semantics, and deployment requirements.
tags: [beat, scheduling, periodic-tasks, persistence]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:38:41.370Z
sources:
  - id: openwiki-source-2a32c4e613bc7be1d621d647
    resource: repo://celery/beat.py
  - id: openwiki-source-c3f5d48780ae239f4c7470eb
    resource: repo://celery/schedules.py
  - id: openwiki-source-c85dccec9c7e9801f152e45d
    resource: repo://docs/userguide/periodic-tasks.rst
generated: { by: "codex", at: "2026-11-16T16:38:41.370Z" }
---

# Periodic scheduling with Beat

Beat is a task publisher. It evaluates schedule entries and sends due tasks through the same [messaging path](../architecture/messaging.md) used by application producers. Workers execute the resulting messages independently. Beat does not wait for the previous invocation to finish and does not hold a lock around task execution.

## Configure and run a schedule

Add entries to `app.conf.beat_schedule`, using a stable entry name separate from the task name:

```python
app.conf.beat_schedule = {
    'refresh-every-minute': {
        'task': 'tasks.refresh',
        'schedule': 60.0,
        'args': (),
        'options': {'queue': 'maintenance'},
    },
}
```

Run `celery -A tasks:app beat -l INFO --schedule=/var/lib/celery/beat-schedule` with a writable persistent location, and ensure a worker imports `tasks.refresh` and consumes `maintenance`. The task is an application-defined example; it must be implemented in that project. `--scheduler` selects another scheduler implementation. `app.add_periodic_task()` provides a signature-based alternative, including deferred registration before configuration finishes loading.

Use one scheduler for a given schedule. Multiple independent Beat instances can publish duplicate periodic tasks. The built-in scheduler has no distributed leader election; a local PID file is not a cross-host ownership mechanism. A worker can embed Beat, but embedding it in every worker replica repeats the scheduling responsibility. If a task can take longer than its interval, implement application-level overlap control when overlap is unacceptable.

## Entries, clocks, and heap dispatch

`ScheduleEntry` owns its name, task, schedule object, arguments/options, `last_run_at`, and `total_run_count`. Advancing it returns a new entry with an updated timestamp and incremented count. `is_due()` delegates to the schedule object using the previous run time.

Interval schedules and crontab schedules return whether an entry is due and how long until it should be checked again. Timezone and UTC settings affect date handling; crontab additionally supports `beat_cron_starting_deadline` to avoid running sufficiently old missed occurrences. Solar schedules are another implementation in `celery/schedules.py` and require the relevant optional dependency.

The scheduler keeps a heap of upcoming entries and rebuilds it when the schedule changes. A tick dispatches at most one due entry, inserts its successor, and returns zero to continue promptly. Otherwise it returns a bounded delay, capped by the scheduler's maximum loop interval. The service sleeps for that delay and syncs state as required. The suggested delay is a polling/scheduling decision, not a promise about worker start time.

## Publication and failure semantics

The tick reserves the next entry before attempting publication. `apply_async()` uses a registered task's `apply_async()` when available and otherwise sends by name; arguments and keyword arguments can contain lazy Beat values. Publication failures are wrapped as `SchedulingError` and logged by `apply_entry()`.

Advancing state before publication prevents a permanently failing due entry from spinning forever, but means a failed send is not automatically rolled back into the previous schedule position. A process crash can also separate broker publication from schedule synchronization. The persistent state file and broker do not form one atomic transaction; periodic tasks should tolerate duplicate or missed dispatches according to application requirements.

## Persistence and cleanup

`PersistentScheduler` uses shelve storage for entries and metadata. It syncs on setup, configured time/task intervals, and close. It removes/reopens corrupt schedule files, and resets stored state when timezone or UTC mode changes. The file stores dispatch timing/count state, not task results or the progress of running work. Retaining it helps preserve schedule timing across restarts, while resets change that timing history.

When `result_expires` is configured and the backend lacks automatic expiration, Beat installs a daily `celery.backend_cleanup` entry unless one already exists. This is the connection between the scheduler and [result retention](../architecture/results.md).

Scheduler extensions can customize entry loading, synchronization, and due-time behavior. The base scheduler's `sync()` is a hook; selecting a database scheduler supplied by an external package changes the persistence and refresh contract and must be checked in that package.

## Source and verification

Read [Beat service and scheduler](../../celery/beat.py), [schedule types](../../celery/schedules.py), [Beat CLI](../../celery/bin/beat.py), and the deployment/overlap guidance in [periodic task documentation](../../docs/userguide/periodic-tasks.rst). Focused tests are [Beat tests](../../t/unit/app/test_beat.py) and [schedule tests](../../t/unit/app/test_schedules.py). Diagnose published-but-unexecuted work with [worker operations](monitoring-control.md), then follow [application setup](../architecture/application.md) if entries or tasks are missing.
