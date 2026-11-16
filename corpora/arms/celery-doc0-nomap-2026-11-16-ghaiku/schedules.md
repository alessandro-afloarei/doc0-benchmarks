---
title: "Schedules"
---
## Overview

A schedule answers one question for the beat loop: given the time an entry last ran, is it due now, and if not, how long until it might be. The classes are in `celery/schedules.py`: `schedule` for a fixed interval, `crontab` for calendar times, and `solar` for sunrise and sunset events. They share the base class `BaseSchedule`, which supplies the clock and the timezone. The loop that asks these questions is covered in [[Beat Scheduler]].

Sources: [celery/schedules.py:65-110](repo://celery/schedules.py#L65-L110), [celery/schedules.py:111-125](repo://celery/schedules.py#L111-L125)

## The shared contract

`BaseSchedule` returns a `(is_due, next)` pair from `is_due`. Its `next` value is a delay in seconds, and the docstring says it need not be exact, because the beat loop sleeps no longer than its own maximum interval. Every schedule gets the current time from `now`, and `maybe_make_aware` makes the last run time timezone-aware before any arithmetic.

Sources: [celery/schedules.py:67-100](repo://celery/schedules.py#L67-L100), [celery/schedules.py:138-160](repo://celery/schedules.py#L138-L160)

## Interval schedules

`schedule` holds `run_every` as a timedelta and a `relative` flag. `remaining_estimate` calls the `remaining` helper with the last run, the interval, the current time and the `relative` flag.

Sources: [celery/schedules.py:125-136](repo://celery/schedules.py#L125-L136), [celery/utils/time.py:214-230](repo://celery/utils/time.py#L214-L230)

`is_due` returns due, with the interval in seconds as the next check time, when the remaining time is zero. Otherwise it returns the remaining seconds as the next check time.

Sources: [celery/schedules.py:168-173](repo://celery/schedules.py#L168-L173)

## Crontab schedules

`crontab` takes five fields: minute, hour, day of week, day of month and month of year. Each field is expanded once in the constructor into the set of allowed values, using the field's own range: 60 for minutes, 24 for hours and 7 for days of the week. The original text of each field is kept for `__repr__` and pickling.

Sources: [celery/schedules.py:401-416](repo://celery/schedules.py#L401-L416), [celery/schedules.py:434-445](repo://celery/schedules.py#L434-L445)

`crontab_parser` turns one field's text into those values. It splits the field on commas, parses each part, and returns the union. A part can be a number, a range, a step, or a star, and each of those has its own handler.

Sources: [celery/schedules.py:250-275](repo://celery/schedules.py#L250-L275), [celery/schedules.py:275-300](repo://celery/schedules.py#L275-L300)

`remaining_delta` finds the next matching time after the last run. It first checks whether the last run's date matches the day and month sets, then the hour and minute. If the date or the hour does not match, it moves forward to the next allowed value, rolling over days, months and years where needed.

Sources: [celery/schedules.py:572-600](repo://celery/schedules.py#L572-L600), [celery/schedules.py:480-520](repo://celery/schedules.py#L480-L520)

`is_due` for a crontab computes the remaining time with `remaining_estimate`. When the schedule has a starting deadline, the code checks whether the last feasible run is older than the deadline. In that case the crontab does not run again, so a missed run is not replayed after a long outage.

Sources: [celery/schedules.py:641-680](repo://celery/schedules.py#L641-L680)

## Solar schedules

`solar` takes an event name, a latitude and a longitude. Its `remaining_estimate` computes the time to the next event from the last run, and `is_due` returns due when that time is zero. When the event is due, `is_due` recomputes the remaining time from the current time, so the next check is for the following event.

Sources: [celery/schedules.py:792-830](repo://celery/schedules.py#L792-L830), [celery/schedules.py:863-878](repo://celery/schedules.py#L863-L878)

## The settings they read

The beat loop's maximum interval comes from `beat_max_loop_interval`, and the crontab starting deadline from `beat_cron_starting_deadline`. The schedule reads its own value when it checks the deadline, so changing the setting affects the next check.

Sources: [celery/beat.py:255-258](repo://celery/beat.py#L255-L258), [celery/schedules.py:661-662](repo://celery/schedules.py#L661-L662)
