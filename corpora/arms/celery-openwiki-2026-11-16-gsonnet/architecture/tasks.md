---
type: architecture
title: Task Class, Publishing and Routing
description: The Task base class and its execution options, the publishing path from Task.apply_async to Celery.send_task to AMQP message creation, queue routing (task_routes, Router, Queues), native delayed delivery, eager execution, retries and autoretry, task replacement and add_to_chord.
tags: [celery, tasks, apply_async, send_task, routing, amqp, retry, eager]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:22:47.483Z
sources:
  - id: openwiki-source-f43ee4204a66938ed7ddea4f
    resource: repo://celery/app/autoretry.py
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-51bdc9f790e9afc683dd8164
    resource: repo://celery/app/routes.py
  - id: openwiki-source-3795aa577fa7b0f3bd2af81a
    resource: repo://celery/app/task.py
generated: { by: "claude-code", at: "2026-11-16T09:22:47.483Z" }
---

# Task Class, Publishing and Routing

This page covers the *producer side* of a task: what a `Task` object is, how a call turns into a broker message, and how routing, retries and eager execution behave. The consumer side is in [[/openwiki/architecture/worker.md]]; the end-to-end sequence is in [[/openwiki/workflows/task-lifecycle.md]].

## The Task class

`celery/app/task.py` defines `Task`. Tasks created by `@app.task` are dynamically generated subclasses (see [[/openwiki/architecture/application.md]]) whose `run` is the decorated function. The class carries *defaults for execution options* — `queue`/`exchange`/`routing_key`, `priority`, `serializer`, `compression`, `rate_limit`, `time_limit`/`soft_time_limit`, `max_retries`, `default_retry_delay`, `acks_late`, `reject_on_worker_lost`, `ignore_result`, `track_started`, `typing`, `autoretry_for`, `retry_backoff`, `trail`, `send_events` ... — that are merged into each call by `_get_exec_options()`.

Key instance members:

- `request`: a stack-backed `Context` (`push_request`/`pop_request`) holding the current invocation's id, args, retries, delivery_info, group/chord/chain info, callbacks/errbacks, `called_directly`, `is_eager` and stamps. The tracer pushes it before running the task.
- `backend`: the result backend, falling back to the app's.
- Signature helpers: `signature`/`subtask`, `s` (mutable), `si` (immutable), `map`, `starmap`, `chunks`.
- Hooks: `before_start`, `on_success`, `on_retry`, `on_failure`, `after_return`, `on_replace` — the tracer only calls the ones a subclass actually overrides.
- `__header__`: a function with the task's signature used to check call arguments at publish time when `typing` is enabled (it inherits the app's `strict_typing`, `True` by default; `@task(typing=False)` disables it), so a wrong argument list raises `TypeError` on the client rather than failing in the worker.

## Publishing: `delay` → `apply_async` → `send_task`

`Task.delay(*a, **kw)` is `apply_async(a, kw)`. `apply_async` (`celery/app/task.py#L536-L630`):

1. Validates `soft_time_limit <= time_limit` (`ValueError` otherwise) and, with `typing`, checks the arguments against `__header__`.
2. Computes the `shadow` name (customizable `shadow_name`, shown in worker logs) and merges class-level execution options under call-time options; `ignore_result` and `priority` default from the task.
3. If `task_always_eager` is set, it **round-trips args and kwargs through the configured serializer** (dump then load) before calling `apply()`, so eager runs catch serialization problems, and runs under `denied_join_result()`.
4. Otherwise calls `app.send_task(self.name, args, kwargs, ..., result_cls=self.AsyncResult, task_type=self, **options)`.

`Celery.send_task` (`celery/app/base.py#L846-L1040`) is the single place that publishes. Using it directly sends by *name* with no local task class required (useful for polyglot or remote tasks). It:

- generates a UUID `task_id` if none was supplied and warns that `task_always_eager` has no effect on `send_task`;
- when called with a plain name it looks up the local registry (without triggering finalization) and merges that task's execution options as defaults;
- pops `time_limit`, `soft_time_limit` and `expires` so explicit `None` clears a task-level default;
- **routes** via `router.route(options, name, args, kwargs, task_type)` (below);
- applies **native delayed delivery** when `eta`/`countdown` is used on a quorum-queue RabbitMQ transport with a non-direct exchange: the message is redirected to the `celery_delayed_27` topic exchange using a routing key computed from the countdown; for direct exchanges it only logs a warning that the task may block a worker until its ETA (this pairs with the `DelayedDelivery` consumer bootstep on the worker);
- converts `expires` to an absolute value and a per-message TTL (`expiration`), clamping past dates to 0 with an explanatory warning;
- fills `root_id`/`parent_id` from the current worker task (`current_worker_task`) so every task in a tree shares a root, and inherits the parent's priority if `task_inherit_parent_priority`;
- builds the message with `amqp.create_task_message` (protocol 2, see [[/openwiki/architecture/overview.md]]), acquires a producer from the pool (or uses the supplied one), calls `backend.on_task_call` (unless the result is ignored — the RPC backend uses it to declare the reply queue), and publishes with `amqp.send_task_message`;
- returns an `AsyncResult` (or `result_cls`) flagged `ignored` when appropriate, and, if called from inside a task with trailing enabled, appends the result to the parent's `request.children`.

Connection errors are re-raised as library errors (`kombu.exceptions.OperationalError`) through `_reraise_as_library_errors`; publishing retries are controlled by `task_publish_retry` / `task_publish_retry_policy`.

## Routing

`celery/app/routes.py` implements `task_routes` resolution; queue definitions live in `celery/app/amqp.py` (`Queues`).

- `prepare(routes)` normalizes the setting: dicts/lists of `(pattern, route)` pairs become `MapRoute` objects, strings are lazily imported router classes or functions, callables are used as-is.
- `MapRoute` matches exact task names first, then glob (`*`) or regex patterns in order. A route value may be a dict of options (`queue`, `routing_key`, `exchange`, `priority`...) or just a queue name.
- `Router.route` first expands a `queue` option to a `Queue` object, consults each router in order (the first non-`None` answer wins — routers are called as `router(name, args, kwargs, options, task=task_type)`, and legacy `route_for_task` routers are also supported), and merges the route under explicit call options (**call-time options win**). With no queue, it falls back to `task_default_queue`.
- `expand_destination` resolves queue names through the `Queues` mapping and raises `QueueNotFound` if the queue is missing from `task_queues`.
- `Queues` auto-creates missing queues when `task_create_missing_queues` is on (the default), supports `select`/`deselect` for worker `-Q`/`-X`, and supports `Broadcast` queues (fanout). The default queue, exchange and routing key come from `task_default_*`.

Message publishing then maps the chosen queue to an exchange/routing key (anonymous exchange for direct queues) in `AMQP._create_task_sender`, declaring the queue along with the publish unless it is a broadcast queue.

## Eager execution

`Task.apply()` (`#L869-L1000`) runs the task in-process. It builds a request dict marked `is_eager`, uses `build_tracer(..., eager=True, propagate=throw)` and returns an `EagerResult`. Whether exceptions propagate defaults to `task_eager_propagates`. If the task retried (`Retry` with a signature), the retry is executed immediately by applying the signature again with `retries + 1`. Eager mode is used heavily in tests but differs from real execution: no broker, serialization is simulated, no worker-side rate limits or time limits.

## Retries

`Task.retry(exc=None, countdown=None, eta=None, max_retries=None, throw=True, **options)` (`#L756-L867`):

- If the task was called directly (`request.called_directly`, not by a worker), it simply re-raises the exception — a retry has no meaning there.
- It increments `request.retries`, picks a default delay from `default_retry_delay` (3 minutes) when neither `eta` nor `countdown` is given, and builds a signature for the *same task and arguments* via `signature_from_request`, preserving options and delivery info (a message sent to the anonymous exchange keeps its queue).
- If `retries > max_retries` (default 3; `None` means unlimited), it raises the supplied `exc` or `MaxRetriesExceededError`.
- Otherwise it publishes the new message immediately (`S.apply_async()`), failing with `Reject(requeue=False)` if the publish itself fails, and raises `Retry` so the tracer records state `RETRY` and stops executing the current attempt (set `throw=False` to continue).
- In eager mode the `Retry` carries the signature so `apply()` can run it.

Auto-retry (`celery/app/autoretry.py`) is applied by `add_autoretry_behaviour` when a task is created: if `autoretry_for` is non-empty, `run` is wrapped so that matching exceptions call `task.retry(exc=exc, **retry_kwargs)`. `Ignore` and `Retry` are never retried, and exceptions in `dont_autoretry_for` pass through. `retry_backoff` enables exponential backoff (`retry_backoff_max`, default 600s, with `retry_jitter` on by default) by setting `countdown` for each attempt.

## Replace and chord extension

- `Task.replace(sig)` replaces the running task with another signature while preserving identity: the replacement is frozen with the current task id, inherits `chord`, `group_id`, `root_id`, callbacks and errbacks, increments `replaced_task_nesting`, and re-appends any remaining `request.chain` steps. A group replacement is uplifted into a chord with `celery.accumulate`; a replacement already inside a chord raises `ImproperlyConfigured`. In a worker it ends the current execution by raising `Ignore` after sending (`on_replace` hook).
- `Task.add_to_chord(sig, lazy=False)` adds a task to the currently running chord from within a header task; it requires a backend implementing `add_to_chord` (Redis).
- `update_state(task_id, state, meta)` stores custom intermediate states in the backend.

## Related

- [[/openwiki/architecture/canvas-workflows.md]] — signatures, chains, groups and chords built on `apply_async`.
- [[/openwiki/architecture/result-backends.md]] — what `AsyncResult` and `backend.on_task_call` do.
- [[/openwiki/architecture/beat-scheduler.md]] — beat's use of `apply_async`/`send_task`.
