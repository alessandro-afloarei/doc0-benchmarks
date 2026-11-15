---
title: "Schedules: Intervals, Crontab and Solar"
---
## Overview

A schedule object answers one question for beat: given when an entry last ran, should it run now, and if not, how long until it should be asked again? `celery/schedules.py` ships three answers: `schedule` for fixed intervals, `crontab` for calendar patterns like cron, and `solar` for sunrise, sunset and other sun positions. All three share `BaseSchedule`, which gives them a clock and the app's timezone. This page explains how each computes its next run, and the time helpers they rely on. How beat uses the answer is on [[Periodic Tasks with Beat]].

Sources: [celery/schedules.py:65-109](repo://celery/schedules.py#L65-L109)

## The schedule protocol

Every schedule implements two methods:

Sources: [celery/schedules.py:74-78](repo://celery/schedules.py#L74-L78)

- `remaining_estimate(last_run_at)` returns a `timedelta` until the next run; zero or negative means it is due.
- `is_due(last_run_at)` returns `schedstate(is_due, next)`, where `next` is the number of seconds until beat should check again. When the entry is due, `next` is the time until the run *after* this one.

Sources: [celery/schedules.py:132-173](repo://celery/schedules.py#L132-L173)

`BaseSchedule.now()` calls the schedule's `nowfun` when one was given, or `app.now()`, which is the current time in the app's timezone. `maybe_make_aware` treats naive datetimes as UTC and converts them to the app's timezone, `tz` is `app.timezone`, and with `enable_utc` off, `to_local` falls back to local time. A custom `nowfun` lets tests or special clocks drive a schedule.

Sources: [celery/schedules.py:65-103](repo://celery/schedules.py#L65-L103), [celery/app/base.py:1197-1200](repo://celery/app/base.py#L1197-L1200), [celery/app/base.py:1619-1632](repo://celery/app/base.py#L1619-L1632)

`maybe_schedule` turns what users write into a schedule: a number becomes a `timedelta` of that many seconds, a `timedelta` becomes a `schedule`, and an existing schedule object is bound to the app.

Sources: [celery/schedules.py:703-714](repo://celery/schedules.py#L703-L714)

## Intervals: schedule

`schedule(run_every, relative=False)` runs every `run_every` (seconds or a `timedelta`). Its remaining time is `last_run_at + run_every - now`, computed in UTC so that daylight-saving changes do not shift the result. When due, `is_due` returns `(True, run_every in seconds)`; otherwise `(False, seconds remaining)`.

Sources: [celery/schedules.py:111-194](repo://celery/schedules.py#L111-L194), [celery/utils/time.py:214-250](repo://celery/utils/time.py#L214-L250)

With `relative=True`, the end time is rounded down to the interval's resolution with `delta_resolution`: an interval measured in days rounds to the day, in hours to the hour, in minutes to the minute. An hourly task then runs on the hour instead of an hour after beat started.

Sources: [celery/utils/time.py:191-211](repo://celery/utils/time.py#L191-L211)

## Calendar patterns: crontab

### Creating a crontab

`crontab(minute='*', hour='*', day_of_week='*', day_of_month='*', month_of_year='*')` mirrors cron's five fields. `crontab.from_string('0 4 * * *')` takes a cron line in cron's order: minute, hour, day of month, month, day of week.

Sources: [celery/schedules.py:401-432](repo://celery/schedules.py#L401-L432)

```python
from celery.schedules import crontab

crontab(minute=0, hour='*/3')              # every three hours
crontab(minute='*/15', day_of_week='mon-fri')
crontab(0, 4, day_of_month='1-7,15-21')
crontab.from_string('30 2 * * 0')
```

Sources: [celery/schedules.py:323-399](repo://celery/schedules.py#L323-L399)

### Field expansion

Each field is expanded once, when the crontab is created, into a set of numbers: an `int` becomes a one-item set, a list or set is taken as is, and a string is parsed by `crontab_parser`. The parser accepts comma-separated parts of `*`, `*/step`, `a-b`, `a-b/step` and single values. Values may be names (`mon`, `jan`) as well as numbers, and a range whose end is smaller than its start wraps around (`fri-mon`). Every number is checked against the field's bounds: minutes 0–59, hours 0–23, day of week 0–6 with Sunday as 0, day of month 1–31, month 1–12.

Sources: [celery/schedules.py:250-321](repo://celery/schedules.py#L250-L321), [celery/schedules.py:434-478](repo://celery/schedules.py#L434-L478)

> [!NOTE]
> A day must match all three day fields. `day_of_week='*/2'` means days whose number is divisible by two, not every other day.

Sources: [celery/schedules.py:347-399](repo://celery/schedules.py#L347-L399)

### Finding the next run

`remaining_delta(last_run_at)` computes the next matching time after the last run, from the smallest unit up:

Sources: [celery/schedules.py:572-575](repo://celery/schedules.py#L572-L575)

1. If the last run's date and hour still match and there is a later minute in `minute`, the next run is that minute in the same hour.
2. Otherwise, if the date matches and there is a later hour, the next run is that hour at the first matching minute.
3. Otherwise, when day of month and month are both `*`, it moves to the next matching weekday, possibly a week later, at the first hour and minute.
4. Otherwise `_delta_to_next` walks forward through the days and months, rolling over the year when needed, to the next date matching all three day fields.

Sources: [celery/schedules.py:576-628](repo://celery/schedules.py#L576-L628), [celery/schedules.py:480-555](repo://celery/schedules.py#L480-L555)

The result is expressed as an `ffwd` ("fast-forward") delta that sets fields such as `hour=4, minute=0` rather than adding a duration, and `remaining` applies it to the last run time.

Sources: [celery/utils/time.py:404-446](repo://celery/utils/time.py#L404-L446), [celery/schedules.py:630-639](repo://celery/schedules.py#L630-L639)

### Missed runs and the starting deadline

`crontab.is_due` is due when the remaining time is zero or negative. When beat was down across several matching times, the entry runs once on restart, not once per missed time. `beat_cron_starting_deadline` (seconds) narrows that: `is_due` steps forward from the last run to the latest matching time that has passed, and if that time is older than the deadline, the entry is not run and simply waits for its next time. When due (or skipped), the returned `next` is computed from now.

Sources: [celery/schedules.py:641-688](repo://celery/schedules.py#L641-L688), [celery/app/defaults.py:73-81](repo://celery/app/defaults.py#L73-L81)

## Sun positions: solar

`solar(event, lat, lon)` runs at a solar event for an observer at that latitude and longitude, computed with the `ephem` library. The events are `dawn_astronomical`, `dawn_nautical`, `dawn_civil`, `sunrise`, `solar_noon`, `sunset`, `dusk_civil`, `dusk_nautical` and `dusk_astronomical`; each maps to a horizon angle (for example −18° for astronomical twilight and −0:34 for sunrise and sunset) and to `next_rising`, `next_transit` or `next_setting`. An unknown event, or coordinates outside ±90 and ±180, raise `ValueError`.

Sources: [celery/schedules.py:717-818](repo://celery/schedules.py#L717-L818)

`remaining_estimate` asks `ephem` for the next event after the last run, in UTC. At latitudes where the sun does not rise or set that day, it checks again a minute after the next anti-transit, so a polar task is rechecked the following day instead of failing.

Sources: [celery/schedules.py:828-877](repo://celery/schedules.py#L828-L877)

## Time helpers

`celery/utils/time.py` holds the conversions the schedules and the rest of Celery share:

Sources: [celery/utils/time.py:184-189](repo://celery/utils/time.py#L184-L189)

| Helper | Use |
| --- | --- |
| `maybe_timedelta` | Numbers to `timedelta` (seconds) |
| `remaining`, `delta_resolution` | Time left until `start + delta`, optionally rounded |
| `rate` | `'100/m'`, `'2/h'` or `'0.5/s'` to tasks per second, used by rate limits |
| `humanize_seconds` | Durations in words for logs |
| `maybe_iso8601` | Parse ETA and expiry headers |
| `make_aware`, `localize`, `to_utc`, `maybe_make_aware` | Timezone conversion; naive values are treated as UTC |
| `ffwd` | Field-setting delta used by crontab |
| `get_exponential_backoff_interval` | `min(maximum, factor × 2^retries)`, optionally with full jitter, used by task auto-retry and backend retries |

Sources: [celery/utils/time.py:214-326](repo://celery/utils/time.py#L214-L326), [celery/utils/time.py:363-477](repo://celery/utils/time.py#L363-L477)
