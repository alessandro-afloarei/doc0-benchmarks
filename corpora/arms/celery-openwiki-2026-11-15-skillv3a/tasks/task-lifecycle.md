---
type: subsystem
title: "Tasks: Definition, Invocation, Retries"
description: The Task class in celery/app/task.py. Covers lazy binding and configuration-derived defaults, annotations, the request Context, apply_async/delay/apply (eager) semantics including argument checking, retry and autoretry with backoff, replace and add_to_chord, update_state, lifecycle hooks, acknowledgement options, and the task states and predicate exceptions.
tags: [task, retry, autoretry, eager, states, exceptions, acks]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:49.645Z
sources:
  - id: openwiki-source-f43ee4204a66938ed7ddea4f
    resource: repo://celery/app/autoretry.py
  - id: openwiki-source-3795aa577fa7b0f3bd2af81a
    resource: repo://celery/app/task.py
  - id: openwiki-source-2e7d7978d05b06a7d21c065a
    resource: repo://celery/exceptions.py
  - id: openwiki-source-30739e9c6aac84ef121d58dc
    resource: repo://celery/states.py
  - id: openwiki-source-ba302f60f72816369ae1924d
    resource: repo://celery/utils/time.py
generated: { by: "claude-code", at: "2026-11-15T17:08:49.645Z" }
---

# Tasks: Definition, Invocation, Retries

Every task is a **singleton instance of a `celery.app.task.Task` subclass**, registered by name in `app.tasks`. `@app.task` and `@shared_task` generate the subclass from a function (see [Application Object](../architecture/application.md)). Class-based tasks can be registered with `app.register_task`.

## Binding and defaults

Tasks are bound lazily to an app (`Task.bind(app)`, called on registration, at finalize, or on first access to `Task.app`). Binding:

- copies configuration defaults into any task attribute that is still `None`, through `from_config`: `serializer` ← `task_serializer`, plus `rate_limit`, `priority`, `time_limit`, `soft_time_limit`, `track_started`, `acks_late`, `acks_on_failure`, `acks_on_timeout`, `reject_on_worker_lost`, `ignore_result`, `store_eager_result`, and `store_errors_even_if_ignored`. Explicit class or decorator values always win;
- sets `acks_on_failure` and `acks_on_timeout` from the deprecated `acks_on_failure_or_timeout` when given, otherwise to True;
- sets `typing` (argument checking) from `app.strict_typing`;
- on first bind, applies **annotations** (`task_annotations`: dicts keyed by task name or `'*'`, or callables returning a dict). Keys starting with `@` wrap a method with an "around" function (`add_around`). It also creates the thread-local `request_stack`;
- calls the `on_bound(app)` hook.

Other notable attributes: `max_retries = 3`, `default_retry_delay = 180`, `throws` (expected exceptions, logged at INFO), `expires`, `trail` (record children), `send_events`, `resultrepr_maxsize`, `Request` (worker request class), and `Strategy`.

## Request context

`task.request` is the top of the `request_stack`, a `Context` with `id`, `args`, `kwargs`, `retries`, `is_eager`, `called_directly`, `delivery_info`, `hostname`, `group`/`group_index`, `chord`, `chain`, `callbacks`/`errbacks`, `root_id`/`parent_id`, `reply_to`/`correlation_id`, `timelimit`, `eta`/`expires`, `origin`, `stamps`, `replaced_task_nesting`, and any custom headers. The worker builds it from the message (see [Execution Tracing](execution-tracing.md)). Calling a task directly as a function (`task(...)`) pushes a minimal context with `called_directly=True` and runs `run()` in-process.

## Invocation

| Call | Behaviour |
|---|---|
| `task.delay(*a, **kw)` | Shortcut for `apply_async(a, kw)`. |
| `task.apply_async(args, kwargs, countdown/eta, expires, queue, routing_key, priority, link, link_error, task_id, shadow, headers, ...)` | Validates `soft_time_limit <= time_limit`. When `typing` is on, checks arguments against the function signature (`__header__`) and raises `TypeError` at **call time**. Merges task-level execution options (`_get_exec_options`), sets `ignore_result` and `priority` defaults, then either runs eagerly (`task_always_eager`) or calls `app.send_task(...)` → [messaging](messaging-and-routing.md). Returns `AsyncResult`. |
| `task.apply(args, kwargs, throw=None, ...)` | Runs **locally and synchronously** through `build_tracer(eager=True, propagate=throw)`, where `throw` defaults to `task_eager_propagates`. Builds an eager request inheriting `parent_id`/`root_id` from any current task. Returns `EagerResult`. |
| `task.s()/si()/signature()` | Builds a [Signature](../canvas/workflows.md). `map`, `starmap`, and `chunks` build bulk primitives. |

With `task_always_eager`, `apply_async` first **round-trips the arguments through the configured serializer**, so eager tests catch arguments that can't be serialized. It then runs `apply()` inside `denied_join_result()`.

`shadow_name(args, kwargs, options)` can be overridden to choose the name shown in logs and monitoring.

## Retrying

`self.retry(args=None, kwargs=None, exc=None, throw=True, eta=None, countdown=None, max_retries=None, **options)`:

1. If the task was called directly (not by a worker or `apply`), it re-raises `exc` or a `Retry`.
2. The countdown defaults to `default_retry_delay`. It builds a new signature from the current request (`signature_from_request`) with `retries + 1`, keeping the same task ID, links, chord, group, and stamps.
3. If `retries > max_retries`, it re-raises `exc` when given, otherwise raises `MaxRetriesExceededError` (with `task_args`/`task_kwargs`). `max_retries=None` means retry forever.
4. Eager mode raises or returns the `Retry` so that `apply()` re-runs locally.
5. Otherwise it **publishes the retry message first** (`S.apply_async()`). If publishing fails, it raises `Reject(exc, requeue=False)`. Then it raises `Retry(exc, when, sig)`. The tracer records state `RETRY` and calls `on_retry`, but not errbacks. Because the original message is acked normally, the retry is a **new message** with the same ID.

**Autoretry** (`celery/app/autoretry.py`, applied at registration): if `autoretry_for=(Exc, ...)` is set on the decorator or class, `run` is wrapped so that matching exceptions call `task.retry(exc=exc, **retry_kwargs)`. `Ignore`, `Retry`, and anything in `dont_autoretry_for` are re-raised untouched. Options:

- `retry_kwargs`, for example `{'max_retries': 5}`;
- `retry_backoff`: `True` or a factor, giving exponential `countdown = factor * 2**retries`, capped at `retry_backoff_max` (600s);
- `retry_jitter` (default True): full jitter randomizes the countdown between 0 and the computed value.

A per-call `max_retries` passed to `self.retry` is remembered in `override_max_retries` for autoretry.

## Replacing and extending workflows

- `self.replace(sig)` hands the current task's identity to `sig`. It freezes `sig` with the current task ID, carries over callbacks and errbacks, chord, group and `group_index`, and `root_id`, increments `replaced_task_nesting`, and appends the remaining `request.chain`. A group is first chained with `celery.accumulate` so the result is a list. Inside a worker it then calls `sig.delay()` and **raises `Ignore`**, which ends the current task without storing a result. In eager mode it returns `sig.apply().get()`. A signature that is itself part of a chord, or an empty chain, is rejected with `ImproperlyConfigured`.
- `self.add_to_chord(sig, lazy=False)` adds a new member to the running chord. It sets group, chord, and `root_id` on `sig` and calls `backend.add_to_chord`. The docstring notes this is currently only supported by the Redis backend.
- `self.update_state(state='PROGRESS', meta={...})` stores a custom state and metadata, typically for progress reporting.

## Lifecycle hooks (override in a base Task)

`before_start(task_id, args, kwargs)` → `run` → `on_success(retval, ...)` / `on_retry(exc, ...)` / `on_failure(exc, ..., einfo)` → `after_return(status, retval, ...)`, plus `on_replace(sig)`. The tracer only calls hooks that a subclass actually overrides (`task_has_custom`), and `after_return` is skipped for the IGNORED, RETRY, and REJECTED states.

## Acknowledgement and reliability options

| Option | Effect in the worker ([Request](../worker/consumer-and-requests.md)) |
|---|---|
| `acks_late=False` (default) | The message is acked **before** execution, so a crash loses the task. |
| `acks_late=True` | Acked after completion, so the message is redelivered if the worker dies before acking. |
| `acks_on_failure` / `acks_on_timeout` (default True) | With late acks, whether failures and time-limit kills are acked, or rejected and requeued. |
| `reject_on_worker_lost` | With late acks, requeue when the pool process dies (`WorkerLostError`) instead of failing. Can cause redelivery loops for tasks that crash the process. |
| `time_limit` / `soft_time_limit` | Hard kill, or `SoftTimeLimitExceeded` raised inside the task (prefork; see [Pools](../worker/concurrency-pools.md)). |
| `rate_limit` | Per-worker token bucket, for example `'10/m'`. |
| `expires` | Messages received after expiry are revoked (`REVOKED`). |

## States (`celery/states.py`)

- `PENDING` (unknown or not yet run), `RECEIVED`, `STARTED` (only with `track_started`), `SUCCESS`, `FAILURE`, `RETRY`, `REVOKED`, `REJECTED`, and the internal `IGNORED`. Custom states are allowed through `update_state`.
- `READY_STATES = {SUCCESS, FAILURE, REVOKED}`, `EXCEPTION_STATES = {RETRY, FAILURE, REVOKED}`, `PROPAGATE_STATES = {FAILURE, REVOKED}`.
- `precedence(state)` orders states as SUCCESS > FAILURE > (custom) > REVOKED > STARTED > RECEIVED > REJECTED > RETRY > PENDING. Event monitors use it to merge out-of-order events (see [Events](../operations/events-monitoring.md)).

## Exceptions (`celery/exceptions.py`)

- **Task predicates** control flow and are not errors: `Retry`, `Ignore` (stop without storing a state), and `Reject(reason, requeue)` (reject or requeue the message; needs late acks to be meaningful).
- **Errors:** `MaxRetriesExceededError`, `TimeoutError` (client-side `get()` timeout), `SoftTimeLimitExceeded` and `TimeLimitExceeded` (from billiard), `TaskRevokedError`, `WorkerLostError`, `InvalidTaskError`, `NotRegistered`, `QueueNotFound`, `ChordError`, `ImproperlyConfigured`, `SecurityError`, `BackendGetMetaError` / `BackendStoreError`.
- `WorkerShutdown` and `WorkerTerminate` are `SystemExit` subclasses used to stop the worker.

## Tests

- `t/unit/tasks/test_tasks.py`: apply_async, retry, autoretry, replace, typing, eager.
- `t/unit/tasks/test_context.py`, `test_states.py`, `t/unit/app/test_annotations.py`.

## See also

- [Task Execution Tracing](execution-tracing.md)
- [Task Messages, Protocol and Routing](messaging-and-routing.md)
- [Canvas](../canvas/workflows.md)
