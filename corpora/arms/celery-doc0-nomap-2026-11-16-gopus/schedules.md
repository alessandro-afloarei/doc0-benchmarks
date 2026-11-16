---
title: "Schedules"
---
## Overview

A schedule object answers one question for the beat scheduler: given when an entry last ran, is it due now, and how long until it should be checked again? `celery/schedules.py` provides three kinds: `schedule` for fixed intervals, `crontab` for cron-style calendars, and `solar` for sunrise, sunset and twilight at a location. All derive from `BaseSchedule` and implement `remaining_estimate` and `is_due`. How the scheduler uses them is described in [[Periodic Tasks with Beat]].

Sources: [celery/schedules.py:65-109](repo://celery/schedules.py#L65-L109)

## The is_due contract

`is_due(last_run_at)` returns a `schedstate(is_due, next)` pair where `next` is a number of seconds. The `schedule.is_due` docstring defines it: `(True, 20)` means run now and check again in 20 seconds; `(False, 12.3)` means not due, check again in 12.3 seconds. The value only needs to be roughly right, and the scheduler never sleeps longer than `beat_max_loop_interval` (5 minutes for the default scheduler, as the docstring notes, while `django-celery-beat` uses 5 seconds), which also bounds how quickly a schedule changed at run time takes effect.

Sources: [celery/schedules.py:138-173](repo://celery/schedules.py#L138-L173)

## Time and time zones

`BaseSchedule.now()` uses the schedule's `nowfun` or `app.now()`, which returns the current time in the app's timezone. `tz` is `app.timezone`: the `timezone` setting, else UTC when `enable_utc` is on (the default), else the system's local zone. `maybe_make_aware` treats naive datetimes as UTC and converts them to the schedule's zone; `to_local` falls back to the local zone when UTC is disabled.

Sources: [celery/schedules.py:65-103](repo://celery/schedules.py#L65-L103), [celery/app/base.py:1196-1200](repo://celery/app/base.py#L1196-L1200), [celery/app/base.py:1619-1632](repo://celery/app/base.py#L1619-L1632)

The helpers live in `celery/utils/time.py`. `timezone` (a `_Zone`) gives `utc`, `local` (from `tzlocal`, falling back to a `LocalTimezone` class with a warning) and `get_timezone(name)` returning a `ZoneInfo`. `remaining(start, ends_in, now, relative)` computes `start + ends_in - now` in UTC; the comment explains that Python otherwise uses wall-clock arithmetic between datetimes in the same non-UTC zone, which goes wrong across daylight-saving changes.

Sources: [celery/utils/time.py:121-181](repo://celery/utils/time.py#L121-L181), [celery/utils/time.py:214-250](repo://celery/utils/time.py#L214-L250), [celery/utils/time.py:375-402](repo://celery/utils/time.py#L375-L402)

## schedule: fixed intervals

`schedule(run_every, relative=False)` takes a `timedelta` or a number of seconds. `remaining_estimate` is `remaining(last_run_at, run_every, now, relative)`, and `is_due` returns `(True, run_every)` when no time remains, otherwise `(False, seconds_left)`. With `relative=True`, the end time is rounded with `delta_resolution` to the interval's unit (days, hours or minutes), so an hourly schedule fires on the hour.

Sources: [celery/schedules.py:111-194](repo://celery/schedules.py#L111-L194), [celery/utils/time.py:191-211](repo://celery/utils/time.py#L191-L211)

`maybe_schedule` is what beat entries use to accept plain numbers and `timedelta` values: it wraps them in `schedule`, and gives any schedule object the app.

Sources: [celery/schedules.py:703-714](repo://celery/schedules.py#L703-L714)

## crontab

### Fields

`crontab(minute='*', hour='*', day_of_week='*', day_of_month='*', month_of_year='*')` keeps the original specs and expands each to a set of allowed values: minutes 0–59, hours 0–23, days of week 0–6 with Sunday as 0, days of month 1–31, months 1–12. A spec may be an int, a set, any iterable, or a string; any other type raises `TypeError`, and values out of range raise `ValueError`. `crontab.from_string('m h dom mon dow')` takes the usual five-field order.

Sources: [celery/schedules.py:323-432](repo://celery/schedules.py#L323-L432), [celery/schedules.py:434-478](repo://celery/schedules.py#L434-L478)

A day must match all three day fields. The docstring's example: `day_of_week=1` with `day_of_month='1-7,15-21'` means the first and third Monday of each month in `month_of_year`. It also warns that `day_of_week='*/2'` means days whose number is divisible by two, not every other day.

Sources: [celery/schedules.py:345-392](repo://celery/schedules.py#L345-L392)

```python
from celery.schedules import crontab

crontab(minute=0, hour='*/3')                 # every three hours
crontab(minute=30, hour=7, day_of_week='mon-fri')
crontab(0, 0, day_of_month='1', month_of_year='*/3')
crontab.from_string('*/15 * * * *')
```

Sources: [celery/schedules.py:401-432](repo://celery/schedules.py#L401-L432)

### The parser

`crontab_parser(max_, min_)` accepts comma-separated groups of `*`, `*/step`, `a-b`, `a-b/step` or a single value. Values can be numbers, weekday names (`mon`) or month names; a range whose end is below its start wraps around (`fri-mon`). Negative numbers, empty parts and empty steps raise `ParseException`, and out-of-range values raise `ValueError`.

Sources: [celery/schedules.py:196-249](repo://celery/schedules.py#L196-L249), [celery/schedules.py:250-321](repo://celery/schedules.py#L250-L321)

### Finding the next run

`remaining_delta(last_run_at)` works out the next firing time after the last run as an `ffwd` (a relative date jump), from the smallest unit up:

Sources: [celery/schedules.py:572-628](repo://celery/schedules.py#L572-L628)

1. If the last run's date matches the day fields, it ran earlier today, and a later minute in this hour is allowed, jump to that minute.
2. Else if a later hour today is allowed, jump to that hour at the first allowed minute.
3. Else, when `day_of_month` and `month_of_year` are both `*`, jump to the next allowed weekday (a week ahead if it is the same weekday).
4. Otherwise `_delta_to_next` walks forward through allowed days and months, skipping dates that do not exist (31 April) or are before the last run, until it finds a date whose weekday is allowed; it gives up with `RuntimeError` after 2000 roll-overs, since the specification is then probably impossible.

Sources: [celery/schedules.py:480-556](repo://celery/schedules.py#L480-L556), [celery/schedules.py:572-628](repo://celery/schedules.py#L572-L628)

### Due checks and the starting deadline

`crontab.is_due` is due when the remaining time is zero or negative, and then reports the wait until the run after this one. With `beat_cron_starting_deadline` set, it steps forward through missed runs and, if the latest one it could still have run is older than the deadline, reports not due. This keeps a beat that was down for a long time from firing a stale run on start.

Sources: [celery/schedules.py:641-688](repo://celery/schedules.py#L641-L688), [celery/app/defaults.py:73-81](repo://celery/app/defaults.py#L73-L81)

## solar

`solar(event, lat, lon)` fires at a solar event computed with the `ephem` library: `dawn_astronomical`, `dawn_nautical`, `dawn_civil`, `sunrise`, `solar_noon`, `sunset`, `dusk_civil`, `dusk_nautical` or `dusk_astronomical`. An unknown event or a latitude outside ±90 or longitude outside ±180 raises `ValueError`. Each event maps to a horizon angle (for example −6° for civil twilight, −0:34 for sunrise and sunset) and to `next_rising`, `next_transit` or `next_setting`, using the sun's centre for twilight events.

Sources: [celery/schedules.py:717-818](repo://celery/schedules.py#L717-L818)

`remaining_estimate` sets the observer's date to the last run in UTC and asks for the next event; where the sun never rises or sets that day (`CircumpolarError`), it checks again a minute after the next anti-transit. `is_due` follows the same pattern as `crontab`. The `solar` extra installs `ephem`.

Sources: [celery/schedules.py:828-878](repo://celery/schedules.py#L828-L878), [setup.py:12-47](repo://setup.py#L12-L47)

## Equality and pickling

Schedules compare by value (`run_every`; the five expanded crontab fields; event, latitude and longitude), which is how the beat scheduler detects a changed `beat_schedule`. Each defines `__reduce__` with its constructor arguments so it can be stored in the persistent schedule file.

Sources: [celery/schedules.py:178-186](repo://celery/schedules.py#L178-L186), [celery/schedules.py:557-570](repo://celery/schedules.py#L557-L570), [celery/schedules.py:690-701](repo://celery/schedules.py#L690-L701), [celery/schedules.py:820-826](repo://celery/schedules.py#L820-L826), [celery/schedules.py:880-887](repo://celery/schedules.py#L880-L887)
