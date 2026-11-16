---
title: "Periodic Tasks with Beat"
---
## Overview

Beat is the process that sends periodic tasks. It holds a schedule of entries, each with a task name, arguments and a schedule object, and it sleeps until the next entry is due, then sends it through the same path a manual call takes. The `Scheduler` class in `celery/beat.py` makes the decisions; `Service` runs it in a loop and keeps the schedule on disk. The schedule types are in `celery/schedules.py`. Sending is covered in [[Sending Tasks]].

Sources: [celery/beat.py:219-251](repo://celery/beat.py#L219-L251)

Sources: [celery/apps/beat.py:40-48](repo://celery/apps/beat.py#L40-L48)

## Entries and due times

A `ScheduleEntry` holds the name, the task name, the arguments and options, the schedule object and the time of its last run. Asking an entry whether it is due asks its schedule, given the last run time.

Sources: [celery/beat.py:82-100](repo://celery/beat.py#L82-L100)

Sources: [celery/beat.py:161-163](repo://celery/beat.py#L161-L163)

The base schedule defines two methods: `remaining_estimate`, which says how long until the next run, and `is_due`, which returns whether the entry runs now and the delay until the next check. The interval schedule `schedule` implements both from its run interval.

Sources: [celery/schedules.py:65-82](repo://celery/schedules.py#L65-L82)

Sources: [celery/schedules.py:111-150](repo://celery/schedules.py#L111-L150)

`crontab` is the schedule for cron-style times. It is a `BaseSchedule` and uses `crontab_parser` to read each field.

Sources: [celery/schedules.py:323-340](repo://celery/schedules.py#L323-L340)

## The heap and tick

`Scheduler.tick` is one iteration of the loop. It keeps a heap of entries ordered by their next run time, rebuilt by `populate_heap` whenever the schedule changes. `populate_heap` computes, for each entry, the time it is next due and pushes it onto the heap, then heapifies it.

Sources: [celery/beat.py:310-325](repo://celery/beat.py#L310-L325)

`_when` turns the schedule's delay into an absolute timestamp, and `adjust` subtracts a drift of 10 milliseconds from a positive delay.

Sources: [celery/beat.py:292-308](repo://celery/beat.py#L292-L308)

`tick` looks at the top of the heap. When that entry is due it removes it, reserves it, applies it, and pushes it back with its next time, then returns 0 so the loop calls again at once. When nothing is due it returns the delay to the next entry, capped at the maximum interval.

Sources: [celery/beat.py:326-364](repo://celery/beat.py#L326-L364)

The loop itself is `Service.start`. It calls `tick`, sleeps for the returned interval, and calls `sync` when `should_sync` says the schedule should be written back.

Sources: [celery/beat.py:633-656](repo://celery/beat.py#L633-L656)

## Sending a due entry

`reserve` replaces the entry in the schedule with its next state, so the last run time is recorded before the task is sent. This happens even if the send then fails.

Sources: [celery/beat.py:389-392](repo://celery/beat.py#L389-L392)

`apply_async` reserves the entry, evaluates its arguments, and sends it with `task.apply_async` when the name is registered locally or with `send_task` when it is not. Any error is wrapped in `SchedulingError`, and the sync counter is advanced in a `finally` block.

Sources: [celery/beat.py:393-419](repo://celery/beat.py#L393-L419)

## Persistence

`PersistentScheduler` keeps the schedule in a `shelve` file, named by `beat_schedule_filename`. `setup_schedule` opens it and reads its keys to check it; when that check fails the store goes through `_destroy_open_corrupted_schedule`.

Sources: [celery/beat.py:505-511](repo://celery/beat.py#L505-L511)

Sources: [celery/beat.py:531-545](repo://celery/beat.py#L531-L545)

`should_sync` is true when `sync_every` seconds have passed since the last sync, or when `sync_every_tasks` tasks have been sent since then. `_do_sync` calls `sync`, which writes the schedule out, and resets both counters.

Sources: [celery/beat.py:381-388](repo://celery/beat.py#L381-L388)

Sources: [celery/beat.py:427-434](repo://celery/beat.py#L427-L434)

Sources: [celery/beat.py:599-602](repo://celery/beat.py#L599-L602)

## Embedding beat in a worker

`Service` is the object the beat command runs. Its constructor takes the max interval, the schedule file and the scheduler class, and defaults to `PersistentScheduler`.

Sources: [celery/beat.py:612-631](repo://celery/beat.py#L612-L631)

`EmbeddedService` builds the same service for a worker that was started with the beat option. It returns a `_Threaded` object, a thread that runs the service.

Sources: [celery/beat.py:682-737](repo://celery/beat.py#L682-L737)

Sources: [celery/worker/components.py:181-205](repo://celery/worker/components.py#L181-L205)
