---
type: concept
title: "Tasks: Definition, Invocation, Retry"
description: The Task class and how tasks are bound to an app and configuration, invoked with delay/apply_async/apply, given request context, retried manually or automatically with backoff, replaced by other signatures, annotated from configuration, and controlled by acknowledgement and rejection semantics.
tags: [task, retry, autoretry, apply_async, acks_late, annotations, request-context]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:57:55.789Z
sources:
  - id: openwiki-source-6906cd292e916d4dea5699c8
    resource: repo://celery/app/annotations.py
  - id: openwiki-source-f43ee4204a66938ed7ddea4f
    resource: repo://celery/app/autoretry.py
  - id: openwiki-source-3795aa577fa7b0f3bd2af81a
    resource: repo://celery/app/task.py
  - id: openwiki-source-4a982797c89fcb3ea5c5d0ee
    resource: repo://celery/app/trace.py
generated: { by: "claude-code", at: "2026-11-16T06:57:55.789Z" }
---

# Tasks: Definition, Invocation, Retry

A Celery task is an instance of a `celery.app.task.Task` subclass registered
in an app's registry by name (see
[App and configuration](../architecture/app-and-configuration.md) for how
`@app.task` creates the class). The same class is used on the producer side
(to build messages) and the worker side (to run `run()`).

## Class attributes and configuration binding

`Task` defines per-task options as class attributes, e.g. `name`,
`max_retries = 3`, `default_retry_delay = 180` s, `rate_limit`,
`ignore_result`, `serializer`, `time_limit`, `soft_time_limit`,
`track_started`, `acks_late`, `acks_on_failure`, `acks_on_timeout`,
`reject_on_worker_lost`, `throws`, `expires`, `priority`, `typing`,
`Strategy`, `Request`, `send_events`, `trail`, `resultrepr_maxsize`.
Options passed to `@app.task(...)` become class attributes.

`Task.bind(app)` runs when the app is finalized (or on first `task.app`
access):

- every attribute listed in `from_config` that is still `None` is filled from
  the matching setting (`serializer` ← `task_serializer`, `acks_late` ←
  `task_acks_late`, `time_limit` ← `task_time_limit`, `ignore_result` ←
  `task_ignore_result`, ...) — so **task-level values override settings**;
- `acks_on_failure` / `acks_on_timeout` default to
  `acks_on_failure_or_timeout`, or `True`;
- `typing` defaults to the app's `strict_typing`;
- on first bind, **annotations** are applied and a thread-local
  `request_stack` is created.

### Annotations

`task_annotations` (`celery/app/annotations.py`) patches task classes from
configuration: a dict `{task_name | '*': {attr: value}}`, an object with
`annotate(task)` / `annotate_any()`, or a list of those. Keys starting with
`@` wrap methods (`add_around`), e.g. `{'@on_failure': wrapper}`.

## Invocation

| Call | Behaviour |
|------|-----------|
| `task(*a)` / `task.__call__` | Runs `run()` in the current process with a request pushed (`called_directly=True`); no message, no result stored |
| `task.delay(*a, **kw)` | `apply_async(a, kw)` |
| `task.apply_async(args, kwargs, **options)` | Publishes a message (below) and returns `AsyncResult` |
| `task.apply(args, kwargs, ...)` | Runs eagerly in-process through `build_tracer(eager=True)`, returns `EagerResult`; re-runs eagerly on `Retry` |
| `task.s()/si()/signature()` | Builds a [signature](canvas.md) |

`apply_async` (`celery/app/task.py`):

1. Rejects `soft_time_limit > time_limit` with `ValueError`.
2. If `typing` is on, checks the arguments against the function signature
   (`__header__`), raising `TypeError` early on the client.
3. Computes `shadow_name` (a display name override), merges the task's
   cached execution options (`queue`, `routing_key`, `exchange`,
   `priority`, ...) with call options and sets `ignore_result`.
4. With `task_always_eager`, round-trips args through the serializer (so
   unserializable arguments fail like in production) and calls `apply()`
   inside `denied_join_result()`; `task_eager_propagates` makes exceptions
   propagate.
5. Otherwise calls `app.send_task(self.name, ..., task_type=self)` — see
   [publishing and routing](../workflows/task-publishing-and-routing.md).

Options include `countdown`/`eta`, `expires`, `retry`/`retry_policy`
(publishing retries on connection errors), `queue`, `routing_key`,
`exchange`, `priority`, `serializer`, `compression`, `link`, `link_error`,
`headers`, `task_id`, `shadow`, `time_limit`, `soft_time_limit`,
`ignore_result`, `add_to_parent`, `stamped_headers`, plus any
`kombu.Producer.publish` keyword.

## Request context

Inside a running task, `self.request` (a `Context`) exposes the message
metadata: `id`, `args`, `kwargs`, `retries`, `eta`, `expires`, `delivery_info`
(exchange, routing key, priority, `redelivered`), `hostname`, `root_id`,
`parent_id`, `group`, `group_index`, `chord`, `chain`, `callbacks`, `errbacks`,
`correlation_id`, `reply_to`, `is_eager`, `called_directly`, `headers` (custom
headers), `stamps`, `timelimit`, `replaced_task_nesting`. Use
`@app.task(bind=True)` to receive the task instance as `self`.
`Context.as_execution_options()` converts a request back into publish options,
which `signature_from_request` uses for retries.

## Lifecycle hooks

Override on a base class (`@app.task(base=MyTask)` or `Celery(task_cls=...)`):
`before_start`, `on_success(retval, task_id, args, kwargs)`,
`on_retry(exc, ...)`, `on_failure(exc, task_id, args, kwargs, einfo)`,
`after_return(status, retval, ...)`, `on_replace(sig)`, and the class methods
`on_bound(app)`. The tracer calls only hooks that are actually overridden
([execution tracing](../architecture/worker/task-execution-trace.md)).
`update_state(state, meta)` stores a custom state (e.g. progress) in the
backend; `send_event` emits a custom event.

## Retry

`task.retry(args=None, kwargs=None, exc=None, throw=True, eta=None,
countdown=None, max_retries=None, **options)`:

1. If called directly (not in a worker/eager context) it simply re-raises
   `exc` (or a `Retry`).
2. Default delay is `default_retry_delay` when neither `eta` nor
   `countdown` is given.
3. Builds a new signature from the current request with `retries + 1`.
4. If `retries > max_retries` (and `max_retries` is not `None`), re-raises
   `exc` if given, else `MaxRetriesExceededError`.
5. Publishes the retry message (**same task id**); if publishing fails the
   current message is rejected (`Reject(exc, requeue=False)`).
6. Raises `Retry` (unless `throw=False`). The tracer records `RETRY`,
   calls `on_retry`, sends `task_retry`, and acknowledges the original
   message. In eager mode the retry is executed eagerly instead.

### Autoretry

`add_autoretry_behaviour` (`celery/app/autoretry.py`) is applied to every
registered task. If `autoretry_for` is set, `run` is wrapped so that matching
exceptions (excluding `dont_autoretry_for`, `Ignore` and `Retry`) call
`task.retry(exc=exc, **retry_kwargs)`. With `retry_backoff` (True or a factor
in seconds) the countdown is `get_exponential_backoff_interval(factor,
retries, retry_backoff_max=600, full_jitter=retry_jitter=True)`.

## Replacing and extending

- `self.replace(sig)` substitutes the current task with another signature:
  groups are upgraded to a chord with `celery.accumulate`, the current
  callbacks/errbacks and remaining chain are transferred, the new signature is
  frozen with **the current task id** (so existing `AsyncResult`s resolve to
  the replacement's result), `replaced_task_nesting` is incremented, then
  `on_replace` publishes it and raises `Ignore` (or applies it eagerly).
- `self.add_to_chord(sig)` adds a task to the chord the current task belongs
  to (requires a backend implementing `add_to_chord`, such as Redis).

## Control-flow exceptions (`celery/exceptions.py`)

| Exception | Meaning |
|-----------|---------|
| `Retry` | Raised by `retry()`; task state `RETRY` |
| `Ignore` | Don't store state or ack specially; message is acked |
| `Reject(reason, requeue)` | Reject (optionally requeue) the message; useful with `acks_late` |
| `MaxRetriesExceededError` | Retries exhausted |
| `SoftTimeLimitExceeded` | Raised inside the task at the soft limit |
| `TimeLimitExceeded` | Hard limit; task killed |
| `WorkerLostError` | Child process died during execution |
| `NotRegistered`, `TaskRevokedError`, `ChordError`, `QueueNotFound`, `ImproperlyConfigured` | Registry, revocation, chord and configuration errors |

Exceptions listed in `Task.throws` are expected errors logged at a lower
severity without traceback.

## Acknowledgement semantics

- Default (**early ack**): the message is acked when the pool accepts the
  task — a crash during execution loses the task.
- `acks_late=True`: acked after the task returns, so tasks must be
  idempotent; a worker crash causes redelivery. Combine with
  `reject_on_worker_lost=True` to requeue when the child process is killed,
  and `worker_deduplicate_successful_tasks` to skip redelivered tasks that
  already succeeded.
- `acks_on_failure=False` / `acks_on_timeout=False` (with `acks_late`)
  reject failed or timed-out messages instead of acking, enabling
  dead-lettering.

Details of how the worker applies these rules are in
[Consumer](../architecture/worker/consumer.md#request-lifecycle).

## Tests

- `t/unit/tasks/test_tasks.py` – apply_async options, retry, autoretry,
  replace, typing.
- `t/unit/tasks/test_context.py`, `t/unit/app/test_annotations.py`.
- `t/integration/test_tasks.py`, `t/smoke/tests/test_tasks.py`.
