---
title: "Schedules: Intervals, Crontab and Solar"
---
## Overview

Every beat entry has a schedule object that answers one question for the scheduler: given when this entry last ran, is it due now, and if not, how long until it is? `celery.schedules` provides three kinds: `schedule` for fixed intervals, `crontab` for calendar patterns, and `solar` for sunrise, sunset and similar events. All three implement `is_due(last_run_at)` and `remaining_estimate(last_run_at)`, and all work with time-zone-aware datetimes in the app's time zone. [[Periodic Tasks with Beat]] shows how the scheduler uses the answer; this page explains how each schedule computes it.

Sources: [celery/schedules.py:65-109](repo://celery/schedules.py#L65-L109)

## The schedule protocol

`BaseSchedule` defines the contract. `is_due(last_run_at)` returns a `schedstate(is_due, next)` pair, where `next` is the number of seconds until the scheduler should check again. `remaining_estimate(last_run_at)` returns a `timedelta` until the next run. `now()` uses the schedule's `nowfun` if given, otherwise `app.now()`. `tz` is the app's time zone, and `maybe_make_aware` treats naive datetimes as UTC and converts them to that zone.

Sources: [celery/schedules.py:65-103](repo://celery/schedules.py#L65-L103), [celery/utils/time.py:392-401](repo://celery/utils/time.py#L392-L401)

The `next` value only tells the scheduler when to look again; it does not need to be exact. The scheduler sleeps for the smaller of `next` and `beat_max_loop_interval`, so a change to a schedule at run time takes effect within that interval. When an entry is due, `next` is the time until the following run, which the scheduler uses to place the entry back in its heap.

Sources: [celery/schedules.py:138-173](repo://celery/schedules.py#L138-L173), [celery/beat.py:326-364](repo://celery/beat.py#L326-L364)

| Case | Returned | Meaning |
| --- | --- | --- |
| `(True, 20)` | Due | Run now; check again in 20 seconds |
| `(False, 12.3)` | Not due | Check again in 12.3 seconds |

Sources: [celery/schedules.py:138-155](repo://celery/schedules.py#L138-L155)

`maybe_schedule(value)` converts what users write in `beat_schedule` into a schedule: a number becomes a `timedelta` of seconds, a `timedelta` becomes `schedule(td, relative)`, and a schedule object gets the app attached.

Sources: [celery/schedules.py:703-714](repo://celery/schedules.py#L703-L714)

## Interval schedules

`schedule(run_every, relative=False)` runs every `run_every` (a `timedelta` or seconds). `remaining_estimate` calls `remaining(last_run_at, run_every, now, relative)`, which adds the interval to the last run time and subtracts now, converting both to UTC first, so a daylight-saving change does not stretch or shrink the interval. When the estimate reaches zero or below, the entry is due and the next check is a full interval away.

Sources: [celery/schedules.py:111-194](repo://celery/schedules.py#L111-L194), [celery/utils/time.py:214-250](repo://celery/utils/time.py#L214-L250)

With `relative=True`, the end time is rounded down to the interval's resolution with `delta_resolution`: an interval of a day or more rounds to the day, an hour or more to the hour, a minute or more to the minute. This aligns runs to clock boundaries rather than to the moment beat started. Setting the environment variable `C_REMDEBUG` makes `remaining` print each calculation.

Sources: [celery/utils/time.py:191-211](repo://celery/utils/time.py#L191-L211), [celery/utils/time.py:233-249](repo://celery/utils/time.py#L233-L249)

## Crontab schedules

### Fields and parsing

`crontab(minute='*', hour='*', day_of_week='*', day_of_month='*', month_of_year='*')` mirrors a cron line. Each field accepts an integer, a set or other iterable of integers, or a string pattern, and is expanded once, at construction, into a set of values. Out-of-range values raise `ValueError`, and other types raise `TypeError`. `crontab.from_string('30 7 * * 1-5')` splits a five-field cron expression in the usual order: minute, hour, day of month, month, day of week.

Sources: [celery/schedules.py:323-432](repo://celery/schedules.py#L323-L432), [celery/schedules.py:434-478](repo://celery/schedules.py#L434-L478)

| Field | Range | Example |
| --- | --- | --- |
| `minute` | 0–59 | `'*/15'`, `'1,13,30-45,50-59/2'` |
| `hour` | 0–23 | `'*/3'`, `'0,8-17/2'` |
| `day_of_week` | 0–6, Sunday = 0 | `'mon-fri'`, `'sun,sat'` |
| `day_of_month` | 1–31 | `'2-30/2'`, `'1-7,15-21'` |
| `month_of_year` | 1–12 | `'*/3'`, `'2-12/2'` |

Sources: [celery/schedules.py:330-398](repo://celery/schedules.py#L330-L398)

`crontab_parser(max_, min_)` implements the pattern grammar. Comma-separated parts are unioned. Each part is `*`, a number, a name, or a range `a-b`, optionally followed by `/step`. Numbers may be weekday names (`mon`) or month names (`jan`). A range whose end is lower than its start wraps around the maximum, so `fri-mon` on weekdays is Friday through Monday. Steps slice the expanded list, so `day_of_week='*/2'` means days whose number is even, not every second day. Empty parts, empty steps and negative numbers raise `ParseException`.

Sources: [celery/schedules.py:247-321](repo://celery/schedules.py#L247-L321)

### Finding the next run

`remaining_delta(last_run_at)` works from the last run time, converted to the app's time zone, and picks the earliest next match. It is a cheap cascade rather than a minute-by-minute search, tried in this order.

Sources: [celery/schedules.py:572-590](repo://celery/schedules.py#L572-L590)

1. If the last run's date matches all three day fields, the last run was today, its hour is allowed, and a later minute in the set remains this hour, jump to that minute.
2. Otherwise, if a later allowed hour remains today, jump to that hour at the first allowed minute.
3. Otherwise, when `day_of_month` and `month_of_year` are both `*`, jump to the next allowed weekday (a week ahead if it is the same weekday) at the first hour and minute.
4. Otherwise `_delta_to_next` walks forward through allowed months and days, skipping dates that do not exist (such as 31 February) or that fall before the last run, until it finds one whose weekday is also allowed. It gives up with `RuntimeError` after 2,000 roll-overs, which means the pattern cannot match.

Sources: [celery/schedules.py:572-628](repo://celery/schedules.py#L572-L628), [celery/schedules.py:480-555](repo://celery/schedules.py#L480-L555)

The jumps are expressed as `ffwd` objects, a minimal forward-only `relativedelta`. When added to a datetime, `ffwd` replaces the given fields, clamps the day to the month's length, and then moves forward to the requested weekday. `remaining_estimate` passes the result to `remaining`, which measures the gap in UTC.

Sources: [celery/utils/time.py:404-446](repo://celery/utils/time.py#L404-L446), [celery/schedules.py:630-639](repo://celery/schedules.py#L630-L639)

As the class documentation notes, a day must match all three day fields to run. `day_of_week=1, day_of_month='1-7,15-21'` therefore means the first and third Monday of each month, not every Monday plus those days.

Sources: [celery/schedules.py:390-398](repo://celery/schedules.py#L390-L398)

### Due checks and missed runs

`crontab.is_due` is due when the estimate from the last run is zero or negative. If beat was down and several runs were missed, the entry is due once, not once per missed run, and the next check is computed from now.

Sources: [celery/schedules.py:641-688](repo://celery/schedules.py#L641-L688)

The `beat_cron_starting_deadline` setting (seconds, unset by default) limits how stale a missed run may be. The check walks forward from the last run to find the latest run time that should already have happened. If that time is more than the deadline in the past, the entry is not run, and the schedule waits for the next run after now. This prevents a beat restarted after a long outage from firing a crontab job that is long overdue.

Sources: [celery/schedules.py:657-688](repo://celery/schedules.py#L657-L688), [celery/app/defaults.py:73-82](repo://celery/app/defaults.py#L73-L82)

## Solar schedules

`solar(event, lat, lon)` runs at a solar event for an observer at the given latitude and longitude. It needs the `ephem` package. The constructor validates the event name and coordinates, raising `ValueError` for an unknown event or out-of-range latitude/longitude, and configures an `ephem.Observer` with zero elevation and pressure and the event's horizon.

Sources: [celery/schedules.py:717-818](repo://celery/schedules.py#L717-L818)

| Event | Horizon | Computed with |
| --- | --- | --- |
| `dawn_astronomical`, `dawn_nautical`, `dawn_civil` | −18°, −12°, −6° | next rising, sun centre |
| `sunrise` | −0:34 | next rising, upper limb |
| `solar_noon` | 0 | next transit |
| `sunset` | −0:34 | next setting, upper limb |
| `dusk_civil`, `dusk_nautical`, `dusk_astronomical` | −6°, −12°, −18° | next setting, sun centre |

Sources: [celery/schedules.py:744-790](repo://celery/schedules.py#L744-L790)

`remaining_estimate` asks ephem for the next occurrence of the event after the last run (in UTC) and returns the time from now. Where the sun does not rise or set that day (polar regions), ephem raises `CircumpolarError`, and the schedule checks again one minute after the next anti-transit. `is_due` follows the same pattern as crontab: due at zero, with the next check computed from now.

Sources: [celery/schedules.py:828-878](repo://celery/schedules.py#L828-L878)

## Time zones

Schedules compute in the app's time zone: `app.timezone` is the `timezone` setting when set, otherwise UTC with `enable_utc` (the default), or the system's local zone without it. `celery.utils.time.timezone` resolves zone names with `ZoneInfo` and finds the local zone with `tzlocal`, falling back to a `LocalTimezone` built from the C library when that fails. With `enable_utc` off, crontab converts naive times with the local-zone fallback.

Sources: [celery/app/base.py:1619-1632](repo://celery/app/base.py#L1619-L1632), [celery/utils/time.py:121-181](repo://celery/utils/time.py#L121-L181), [celery/schedules.py:100-103](repo://celery/schedules.py#L100-L103)

Making a naive datetime aware during a daylight-saving transition needs care. `make_aware` picks the earlier of two ambiguous wall-clock times and moves a non-existent time forward to a real one with `dateutil`. Because a stored schedule's run times depend on the zone, `PersistentScheduler` resets its database when `timezone` or `enable_utc` change.

Sources: [celery/utils/time.py:363-372](repo://celery/utils/time.py#L363-L372), [celery/beat.py:536-549](repo://celery/beat.py#L536-L549)

## Writing a custom schedule

A custom schedule subclasses `BaseSchedule` and implements `is_due(last_run_at)` returning `schedstate`, and usually `remaining_estimate`. It should also implement `__eq__` and `__reduce__`, because the scheduler compares schedules to detect configuration changes and the persistent scheduler pickles them into its shelve file.

Sources: [celery/schedules.py:65-109](repo://celery/schedules.py#L65-L109), [celery/schedules.py:175-186](repo://celery/schedules.py#L175-L186), [celery/beat.py:186-199](repo://celery/beat.py#L186-L199)
