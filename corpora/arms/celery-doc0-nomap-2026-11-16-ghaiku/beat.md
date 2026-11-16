---
title: "Beat Scheduler"
---
## Overview

`celery beat` is a loop that sends periodic tasks when they are due. The loop lives in `Service.start`, and the decisions are made by a `Scheduler`, which keeps the entries in a heap ordered by their next run time. Each tick sends at most one due entry and returns the delay until the next one. The entries and their timetables are described in [[Schedules]]; this page covers the loop, the heap, and how an entry is sent.

Sources: [celery/beat.py:612-656](repo://celery/beat.py#L612-L656), [celery/beat.py:219-240](repo://celery/beat.py#L219-L240)

## The service loop

`Service.start` sends the `beat_init` signal, sets the process title, and then repeats: it calls `tick` on the scheduler, sleeps for the returned interval, and syncs the schedule when a sync is due. The loop stops when the shutdown flag is set, and it syncs once more on the way out.

Sources: [celery/beat.py:633-656](repo://celery/beat.py#L633-L656)

The scheduler's default `max_interval` is five minutes, and the default `sync_every` is three minutes. A tick never returns a longer delay than `max_interval`, so the loop wakes at least that often even when nothing is due.

Sources: [celery/beat.py:43](repo://celery/beat.py#L43), [celery/beat.py:239-242](repo://celery/beat.py#L239-L242), [celery/beat.py:256-265](repo://celery/beat.py#L256-L265)

## The heap

`populate_heap` builds the heap from the schedule. Each entry becomes one heap item with its next run time, and a due entry gets run time zero. The items are ordered by time, then by a priority, then by the entry itself, so the earliest entry is always at the top.

Sources: [celery/beat.py:310-323](repo://celery/beat.py#L310-L323), [celery/beat.py:300-309](repo://celery/beat.py#L300-L309)

The heap is rebuilt when it is missing or when the schedule has changed, and the old copy of the schedule is kept for the comparison that finds the changes.

Sources: [celery/beat.py:336-342](repo://celery/beat.py#L336-L342)

## One tick

`tick` looks at the top of the heap. When that entry is not due, `tick` returns the smaller of its wait and `max_interval`. When it is due, `tick` pops it, reserves it, applies it, and pushes it back with its next run time. The return value is zero, so the loop calls `tick` again at once for the next entry.

Sources: [celery/beat.py:343-364](repo://celery/beat.py#L343-L364)

```python
event = H[0]
entry = event[2]
is_due, next_time_to_run = self.is_due(entry)
```

Sources: [celery/beat.py:343-351](repo://celery/beat.py#L343-L351)

After a due entry is applied, `tick` pushes it back with the next run time from `_when`. If the item popped from the heap is not the entry that was examined, the popped item is pushed back and `tick` returns the wait for it.

Sources: [celery/beat.py:352-361](repo://celery/beat.py#L352-L361)

## Sending an entry

`apply_async` on the scheduler reserves the entry first, so its run count and last run time are updated before the send. If the send raises, the entry has already been moved on, and the error is re-raised as `SchedulingError`, so a failing task does not keep the scheduler stuck on the same entry.

Sources: [celery/beat.py:393-414](repo://celery/beat.py#L393-L414)

The task is looked up in the app's registry. A known name is sent with that task's `apply_async`, and an unknown name goes through `send_task`. Either way the entry's options are passed on. The send counts the message toward the next sync.

Sources: [celery/beat.py:397-421](repo://celery/beat.py#L397-L421)

## Persistence

`PersistentScheduler` keeps the schedule in a shelve file named by `schedule_filename`. Its `setup_schedule` opens the store, and if the file is corrupted it destroys it and starts over. It then creates the schedule and reads the timezone from the app's configuration.

Sources: [celery/beat.py:505-545](repo://celery/beat.py#L505-L545)

`sync` writes the store, and `close` syncs and then closes it when the scheduler is shut down. The `Service` decides when a sync is due: when the time since the last sync is more than `sync_every`, or when `sync_every_tasks` messages have been sent since the last one.

Sources: [celery/beat.py:599-606](repo://celery/beat.py#L599-L606), [celery/beat.py:380-388](repo://celery/beat.py#L380-L388)

The `beat` command is in [[Command Line Entry Point]], and the same scheduler can run inside a worker, as the `Beat` worker component described in [[Worker Startup and Bootsteps]] shows.

Sources: [celery/worker/components.py:181-206](repo://celery/worker/components.py#L181-L206)
