---
type: workflow
title: "Task Publishing: apply_async to Broker"
description: How a task call becomes a broker message. Covers Task.delay/apply_async, option merging, Celery.send_task, routing to queues, countdown/eta/expires handling (including quorum-queue native delayed delivery), protocol-2 message construction, producer pools and publish signals, parent/child tracking, and eager mode.
tags: [celery, publishing, apply_async, send_task, routing, amqp, producers, eager]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:56:17.091Z
sources:
  - id: openwiki-source-5a0b6982dd7ddb0fabfabd0c
    resource: repo://celery/app/amqp.py
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-51bdc9f790e9afc683dd8164
    resource: repo://celery/app/routes.py
  - id: openwiki-source-3795aa577fa7b0f3bd2af81a
    resource: repo://celery/app/task.py
generated: { by: "claude-code", at: "2026-11-16T17:56:17.091Z" }
---

# Task Publishing: `apply_async` to Broker

This is the client side of the task lifecycle: everything between `add.delay(2, 2)` and a message sitting in a broker queue. The worker side is covered in [Worker and consumer](../architecture/worker-and-consumer.md). The code is in `celery/app/task.py` (`Task`), `celery/app/base.py` (`Celery.send_task` and connection and producer pools), `celery/app/amqp.py` (queues, message building, sending) and `celery/app/routes.py` (routers).

## Call chain

```
task.delay(*a, **kw)
  └─ task.apply_async(args, kwargs, **options)
       ├─ task_always_eager → serialize round-trip → task.apply()  (no broker)
       └─ app.send_task(name, args, kwargs, **options)
            ├─ merge task exec options, normalize time limits / expires
            ├─ router.route(options, name, args, kwargs, task_type)   → queue / exchange / routing_key
            ├─ eta/countdown handling (native delayed delivery for quorum queues)
            ├─ parent/root ids from the current worker task
            ├─ amqp.create_task_message(...)  → as_task_v2 → (headers, properties, body, sent_event)
            ├─ producer_or_acquire() → backend.on_task_call() → amqp.send_task_message(producer, ...)
            └─ returns AsyncResult(task_id)   (and records it on the parent task's trail)
```

`Task.delay` is `apply_async(args, kwargs)`. The `Signature` form (`task.s(...).apply_async()`) merges stored and call-time arguments and then reaches the same method, or `app.send_task` for tasks not registered locally. See [Canvas](../architecture/canvas-workflows.md).

## `Task.apply_async`

1. **Validate limits:** `soft_time_limit > time_limit` raises `ValueError`.
2. **Check arguments** against the task's signature (`__header__`) when `typing` is enabled. A wrong call fails fast on the client with `TypeError`, before anything is sent.
3. **Shadow name:** `shadow_name(...)` lets a task override the name shown in worker logs and monitoring.
4. **Merge options:** task-level execution options (`_get_exec_options`, such as queue, routing key, serializer, compression, time limits, expires, priority) are overlaid with the call's options. `ignore_result` defaults to the task's value, and the task `priority` is set if not given.
5. **Eager mode** (`task_always_eager`): the args and kwargs are serialized and deserialized with the configured serializer, to surface serialization bugs, and then `self.apply(...)` runs the task in-process under a "denied join" guard. No broker is used. Eager `send_task` is not affected, and it warns that `task_always_eager` has no effect there (`AlwaysEagerIgnored`).
6. Otherwise delegate to `app.send_task(self.name, ..., task_type=self, result_cls=self.AsyncResult)`.

## `Celery.send_task`

`send_task(name, args, kwargs, countdown, eta, task_id, producer, connection, router, expires, link, link_error, group_id, chord, chain, time_limit, soft_time_limit, root_id, parent_id, ...)` works on a *name*, so it can call tasks defined in another codebase or language, as long as the worker has them registered.

- **Task id:** `task_id or uuid()`. The id is stored in the message and also used as AMQP `correlation_id`.
- **Local defaults:** if the caller gave no `task_type`, it looks the name up in the registry (without finalizing the app) and merges the registered task's non-`None` exec options. When `apply_async` already merged them, it does not do so again.
- **Normalization:** `time_limit`, `soft_time_limit` and `expires` are popped from `options` and passed explicitly to the message builder. An explicit `None` clears a task-level default. `expires` can be seconds, a `datetime` or an ISO string, and is converted to a relative `expiration` in seconds for the broker (a past date becomes 0 with a warning).
- **Routing:** `router.route(options, name, args, kwargs, task_type)` (below).
- **Delayed delivery on quorum queues:** if `eta` or `countdown` is set and quorum queues are detected (`detect_quorum_queues`), a non-direct exchange triggers *native delayed delivery*. The countdown is converted to a delayed routing key on the `celery_delayed_27` topic exchange, and the `queue` option is dropped. A direct exchange logs a warning that native delayed delivery will not work and the task may block a worker until the ETA. Otherwise ETA tasks are published normally and held by the worker (see [Worker and consumer](../architecture/worker-and-consumer.md)).
- **Lineage:** when `root_id` or `parent_id` is missing and the call happens inside a worker task, they are taken from that task's request (`root_id` falls back to the parent's id). With `task_inherit_parent_priority` the parent's priority is inherited.
- **Message:** `amqp.create_task_message(...)` builds the message (below).
- **Publish:** acquire a producer, translate connection errors into library errors, call `backend.on_task_call(producer, task_id)` unless the result is ignored (the RPC backend declares its reply queue there), then `amqp.send_task_message(...)`.
- **Result:** return `AsyncResult(task_id)` with `ignored` set. If `add_to_parent` and called inside a worker task, append the result to that task's `request.children` through `add_trail`.

## Routing (`celery/app/routes.py` and `Queues` in `amqp.py`)

`Router.route(options, name, args, kwargs, task_type)`:

1. Expands an explicit `queue` option into the full `Queue` object from `app.amqp.queues` (`QueueNotFound` if unknown and creation of missing queues is off).
2. Consults each router from `task_routes` in order. A router is a dict or list of mappings (`MapRoute`, with exact names and glob patterns), a callable `(name, args, kwargs, options, task=...)`, or a dotted-path string. The first non-`None` route wins. It is merged *under* the explicit options, so options given at the call site take priority.
3. If still no queue, uses `task_default_queue`.

`Queues` is a dict of name to `kombu.Queue`. With `task_create_missing_queues` (default true) an unknown queue name is declared on demand, as a `classic` or `quorum` queue depending on `task_create_missing_queue_type`, and with `task_queue_max_priority` as the default `x-max-priority`. Workers restrict consumption with `-Q` (`select`) and `-X` (`deselect`). Routing tables update when `task_routes` changes at runtime (`_handle_conf_update`).

## Message construction (`AMQP.as_task_v2`)

Produces a `task_message(headers, properties, body, sent_event)` tuple:

- `countdown` is converted to an absolute `eta`, and numeric `expires` to an absolute time, both as aware ISO-8601 strings. Non-numeric `countdown` or `expires` is rejected by `_verify_seconds`.
- **Headers** carry everything the worker needs *without decoding the body*: `lang`, `task` (name), `id`, `shadow`, `eta`, `expires`, `group`, `group_index`, `retries`, `timelimit` (`[hard, soft]`), `root_id` (defaults to the task id), `parent_id`, `argsrepr`, `kwargsrepr` (truncated reprs for logs and events), `origin`, `ignore_result`, `replaced_task_nesting`, `stamped_headers`, `stamps`.
- **Properties:** `correlation_id = task_id`, `reply_to` (the client's result queue for the RPC backend, otherwise empty).
- **Body:** `(args, kwargs, {callbacks, errbacks, chain, chord})`. The embedded dict is what makes canvas workflows work: the worker reads the chain and callbacks from the message itself.
- `sent_event`: if `task_send_sent_event` is enabled, a `task-sent` event payload is built, which is published after the message (see [Events and remote control](../architecture/events-and-remote-control.md)).

Protocol 1 (`as_task_v1`) still exists for compatibility, selected by `task_protocol = 1`. The default is 2.

## Sending (`AMQP._create_task_sender`)

`send_task_message(producer, name, message, exchange, routing_key, queue, ...)`:

- Resolves the destination: a queue name is looked up in `queues`. If neither queue nor exchange is given, it uses the default queue. For a direct exchange with no explicit exchange or routing key, it publishes to the anonymous default exchange with the queue name as routing key. Otherwise it uses the queue's exchange and routing key.
- Declares the queue with the publish (`declare=[queue]`), except for `Broadcast` queues.
- Merges retry options: `task_publish_retry` and `task_publish_retry_policy` with per-call overrides. Delivery mode, serializer (`task_serializer`) and compression (`task_compression`) come from settings unless given.
- Sends `before_task_publish`, calls `producer.publish(body, headers=..., **properties)`, then sends `after_task_publish`. The legacy `task_sent` signal is sent if it has receivers, and the `task-sent` event is published through the `EventDispatcher` using the same producer.
- With the `auth` serializer set as default, publishing signs the body (see [Message security](../operations/message-security.md)).

## Connections and producers

`app.amqp.producer_pool` is a kombu producer pool over `connection_for_write()`, sized by `broker_pool_limit` (the same pool limit as `app.pool`). `producer_or_acquire` blocks for a free producer up to `broker_pool_acquire_timeout`. If that expires it raises `OperationalError` with a message suggesting an increase of `broker_pool_limit`. `connection_for_read` and `connection_for_write` use `broker_read_url` and `broker_write_url`, which allows different brokers for consuming and publishing. In forked children `_after_fork` drops the producer pool, so each process builds its own (see [App and configuration](../architecture/app-and-configuration.md)).

## Failure and consistency notes

- Publishing is synchronous from the caller's view. With publish retry on, transient connection errors are retried per the policy, and exhaustion raises `kombu.exceptions.OperationalError`. Nothing is stored if publishing fails.
- The task is **not** transactional with the caller's database. For Django, `delay_on_commit` defers publishing until the transaction commits (see [Django integration and contrib](../integrations/django-and-contrib.md)).
- Without a result backend, or with `ignore_result`, no state is recorded, and the returned `AsyncResult` is only a handle.

## Tests

`t/unit/app/test_amqp.py` (queues and message building), `t/unit/app/test_routes.py`, `t/unit/app/test_app.py` (`send_task`, connections), `t/unit/tasks/test_tasks.py` (`apply_async`, eager), and `t/integration/test_tasks.py`. See [Testing, CI and development workflow](../testing/test-strategy.md).
