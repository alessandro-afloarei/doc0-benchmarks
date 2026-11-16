---
title: "Schedules"
---
## Overview

A schedule object answers one question for beat: given when an entry last ran, is it due now, and if not, how long until it should be checked again. `celery.schedules` provides three: `schedule` for fixed intervals, `crontab` for cron-style calendar times, and `solar` for sunrise, sunset and similar events at a location. Each is the `schedule` field of a beat entry ([[Beat Scheduler]]); a plain number of seconds or a `timedelta` in `beat_schedule` is converted to a `schedule` by `maybe_schedule`.

Sources: [celery/schedules.py:65-110](repo://celery/schedules.py#L65-L110), [celery/schedules.py:703-714](repo://celery/schedules.py#L703-L714)

## The schedule interface

`BaseSchedule(nowfun=None, app=None)` defines two methods subclasses implement:

Sources: [celery/schedules.py:65-74](repo://celery/schedules.py#L65-L74)

| Method | Returns |
| --- | --- |
| `remaining_estimate(last_run_at)` | A `timedelta` until the next run (negative or zero when overdue) |
| `is_due(last_run_at)` | A `schedstate(is_due, next)` tuple; `next` is the number of seconds until beat should check again |

Sources: [celery/schedules.py:65-80](repo://celery/schedules.py#L65-L80)

The `is_due` docstring explains the contract: `(True, 20)` means run now and check again in 20 seconds, `(False, 12.3)` means not due and check again in 12.3 seconds. The next-check value "does not need to be accurate but will influence the precision of your schedule", and beat never sleeps longer than `beat_max_loop_interval` regardless; the docstring notes that the default scheduler's maximum is 5 minutes, which also bounds how quickly a changed schedule takes effect.

Sources: [celery/schedules.py:146-180](repo://celery/schedules.py#L146-L180)

The base class also provides `now()` (from `nowfun`, else `app.now()`), the app's timezone as `tz`, and `maybe_make_aware(dt)`, which treats naive datetimes as UTC and converts them to the app's timezone. Two schedules are equal when their attributes are, which is how beat notices a changed schedule and rebuilds its heap.

Sources: [celery/schedules.py:69-108](repo://celery/schedules.py#L69-L108), [celery/beat.py:338-352](repo://celery/beat.py#L338-L352)

## Interval schedules

`schedule(run_every, relative=False, nowfun=None, app=None)` runs every `run_every`, a `timedelta` or a number of seconds. `remaining_estimate` is `utils.time.remaining(last_run_at, run_every, now, relative)`: the time from now to `last_run_at + run_every`, computed in UTC so that daylight saving transitions do not distort it. With `relative=True` the end time is rounded to the interval's resolution (days, hours or minutes, via `delta_resolution`). `is_due` returns `(True, run_every_seconds)` when nothing remains and `(False, remaining_seconds)` otherwise.

Sources: [celery/schedules.py:111-195](repo://celery/schedules.py#L111-L195), [celery/utils/time.py:184-250](repo://celery/utils/time.py#L184-L250)

## Crontab

### Fields and patterns

`crontab(minute='*', hour='*', day_of_week='*', day_of_month='*', month_of_year='*')` follows cron's five fields. Each accepts an integer, a set or list of integers, or a cron pattern string; `crontab.from_string('m h dom mon dow')` parses a classic five-field expression in cron's order.

Sources: [celery/schedules.py:323-418](repo://celery/schedules.py#L323-L418), [celery/schedules.py:420-432](repo://celery/schedules.py#L420-L432)

```python
crontab()                                 # every minute
crontab(minute=0, hour='*/3')             # every three hours
crontab(minute='*/15')                    # every quarter hour
crontab(hour=7, minute=30, day_of_week='mon-fri')
crontab(0, 0, day_of_month='1-7,15-21')   # first and third weeks
crontab.from_string('0 4 * * *')          # 04:00 every day
```

Sources: [celery/schedules.py:337-388](repo://celery/schedules.py#L337-L388)

`_expand_cronspec` turns each field into the set of values it matches, using `crontab_parser(max, min)` for strings: minutes 0–59, hours 0–23, days of week 0–6 with Sunday as 0, days of month 1–31, months 1–12. The parser accepts `*`, numbers, ranges `a-b` (a range whose end is before its start wraps around), steps `*/n` and `a-b/n`, comma-separated groups, and names such as `mon` or `jan`. Negative numbers, empty parts, empty steps and values outside the field's range raise `ParseException` or `ValueError`. The docstring warns that `day_of_week='*/2'` means "every day that is divisible by two", not every other day.

Sources: [celery/schedules.py:196-315](repo://celery/schedules.py#L196-L315), [celery/schedules.py:434-478](repo://celery/schedules.py#L434-L478), [celery/schedules.py:359-366](repo://celery/schedules.py#L359-L366)

A day matches only when it is in all three day fields. The class docstring's example: with `day_of_week=1` and `day_of_month='1-7,15-21'`, the task runs on the first and third Monday of each month listed in `month_of_year`.

Sources: [celery/schedules.py:394-403](repo://celery/schedules.py#L394-L403)

### Computing the next run

`remaining_delta(last_run_at)` finds the next matching time after `last_run_at` and returns it as a relative `ffwd` delta:

Sources: [celery/schedules.py:572-576](repo://celery/schedules.py#L572-L576)

1. If `last_run_at` is today, in a matching hour, and a later minute in the set remains this hour, the next run is that minute.
2. Otherwise, if the date matches and a later hour remains today, the next run is the first minute of the next matching hour.
3. Otherwise the next run is the first minute and hour of the next matching day. With only `day_of_week` restricted, that is the next weekday in the set, possibly next week. With `day_of_month` or `month_of_year` restricted, `_delta_to_next` walks forward through months and days (up to 2,000 steps), skipping dates that do not exist, such as 31 February.

Sources: [celery/schedules.py:572-628](repo://celery/schedules.py#L572-L628), [celery/schedules.py:480-555](repo://celery/schedules.py#L480-L555)

`remaining_estimate` passes that result to `utils.time.remaining`. `is_due` treats zero or negative remaining time as due, and when due computes the next check from the current time rather than from `last_run_at`.

Sources: [celery/schedules.py:630-688](repo://celery/schedules.py#L630-L688)

### Starting deadline

When `beat_cron_starting_deadline` is set (in seconds), `is_due` steps forward from `last_run_at` to the latest run time that has already passed and refuses to run if that time is more than the deadline ago. The docstring describes the purpose: it "prevents tasks that could have been run according to the crontab, but didn't, from running again unexpectedly", for example after beat was down for a long time.

Sources: [celery/schedules.py:641-688](repo://celery/schedules.py#L641-L688), [celery/app/defaults.py:73-82](repo://celery/app/defaults.py#L73-L82)

## Solar events

`solar(event, lat, lon)` runs at a solar event for an observer at the given latitude and longitude, computed with the `ephem` package. Valid events are `dawn_astronomical`, `dawn_nautical`, `dawn_civil`, `sunrise`, `solar_noon`, `sunset`, `dusk_civil`, `dusk_nautical` and `dusk_astronomical`; an unknown event or out-of-range coordinates raise `ValueError`. Each event maps to a horizon angle (for example `-0:34` for sunrise and sunset, `-6` for civil twilight) and to `next_rising`, `next_transit` or `next_setting`; twilight events use the sun's centre.

Sources: [celery/schedules.py:717-818](repo://celery/schedules.py#L717-L818)

`remaining_estimate` asks the observer for the next event after `last_run_at` (in UTC). When the sun does not rise or set that day (`CircumpolarError`, near the poles), it checks again one minute after the next anti-transit. `is_due` works like the crontab version.

Sources: [celery/schedules.py:828-875](repo://celery/schedules.py#L828-L875)

## Time zones

All schedule arithmetic uses timezone-aware datetimes in the app's zone, `app.timezone`, taken from the `timezone` setting, else UTC when `enable_utc` is on, else the local zone ([[The Celery Application]]). `utils.time` provides the helpers: `make_aware` attaches a zone and resolves ambiguous or non-existent wall times around DST changes, `localize` converts between zones, `to_utc` marks a naive time as UTC, and `maybe_make_aware` makes a naive time aware (as UTC by default) in a target zone. `timezone.get_timezone(name)` returns a `ZoneInfo`, and `timezone.local` uses `tzlocal`, falling back to Celery's own `LocalTimezone` when that fails.

Sources: [celery/app/base.py:1619-1632](repo://celery/app/base.py#L1619-L1632), [celery/utils/time.py:121-181](repo://celery/utils/time.py#L121-L181), [celery/utils/time.py:363-401](repo://celery/utils/time.py#L363-L401)

With `enable_utc` off, `BaseSchedule.to_local` converts times to the local zone before comparisons. Because a stored `last_run_at` only makes sense in the zone it was written in, `PersistentScheduler` clears its schedule file when `timezone` or `enable_utc` changes ([[Beat Scheduler]]). Setting the `C_REMDEBUG` environment variable makes `remaining` print every input and the result, which the periodic-tasks example suggests for diagnosing calculated run times.

Sources: [celery/schedules.py:95-98](repo://celery/schedules.py#L95-L98), [celery/beat.py:540-553](repo://celery/beat.py#L540-L553), [celery/utils/time.py:242-249](repo://celery/utils/time.py#L242-L249), [examples/periodic-tasks/myapp.py:11-15](repo://examples/periodic-tasks/myapp.py#L11-L15)
