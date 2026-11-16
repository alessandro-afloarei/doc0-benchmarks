---
type: workflow
title: Task Publishing, Message Protocol and Routing
description: Step-by-step path of app.send_task — option merging, routing through task_routes and task_queues, protocol v2 message construction (headers, properties, body, ETA/expires encoding), producer pools and publish retry, native delayed delivery for quorum queues, parent/root tracking, and the publish signals.
tags: [publishing, routing, protocol, queues, amqp, producer, eta]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:57:55.789Z
sources:
  - id: openwiki-source-5a0b6982dd7ddb0fabfabd0c
    resource: repo://celery/app/amqp.py
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-ac404435efa758dad4bbfc83
    resource: repo://celery/app/defaults.py
  - id: openwiki-source-51bdc9f790e9afc683dd8164
    resource: repo://celery/app/routes.py
  - id: openwiki-source-4a74724fd0043fb3763dcbaf
    resource: repo://celery/utils/collections.py
generated: { by: "claude-code", at: "2026-11-16T06:57:55.789Z" }
---

# Task Publishing, Message Protocol and Routing

Every message that starts a task — from `task.delay()`, `apply_async()`,
canvas primitives, beat, retries, or `celery call` — goes through
`Celery.send_task` (`celery/app/base.py`) and the `AMQP` helper
(`celery/app/amqp.py`, `app.amqp`). Despite its name, `AMQP` is transport
agnostic: it relies on kombu, so the same code publishes to RabbitMQ, Redis,
SQS, etc.

## send_task step by step

1. **Eager warning.** `task_always_eager` has no effect on `send_task`
   (a warning is emitted); only `Task.apply_async` honours it.
2. **Task options.** If `task_type` is not given, the task is looked up in
   the raw registry *without finalizing the app* (so unknown/remote task
   names can still be sent). Its cached execution options (`queue`,
   `routing_key`, `exchange`, `priority`, `time_limit`, `expires`, ...) are
   merged under the call options; `time_limit`, `soft_time_limit` and
   `expires` explicit arguments win, and an explicit `None` clears a task
   default.
3. **Routing.** `router.route(options, name, args, kwargs, task_type)`
   resolves the destination (below).
4. **Native delayed delivery.** With `eta`/`countdown` and quorum queues on
   RabbitMQ, the message is redirected to the `celery_delayed_27` topic
   exchange with a delay-encoding routing key (direct exchanges are not
   supported and only log a warning) — see
   [Consumer](../architecture/worker/consumer.md#native-delayed-delivery-quorum-queues).
5. **Expiry.** `expires` (seconds, `datetime` or ISO string) is also turned
   into the AMQP per-message TTL `expiration`; a past expiry is clamped to 0
   with a warning.
6. **Lineage.** When called from inside a worker task, `root_id` and
   `parent_id` are taken from the current request; with
   `task_inherit_parent_priority` the parent's priority is inherited.
7. **Message construction.** `amqp.create_task_message` picks the builder for
   `task_protocol` (default **2**: `as_task_v2`; `1`: legacy `as_task_v1`).
8. **Publishing.** Inside `producer_or_acquire(producer)` (a pooled kombu
   producer from `app.amqp.producer_pool`), unless `ignore_result` the
   backend's `on_task_call` hook runs (RPC declares its reply queue), then
   `amqp.send_task_message(...)` publishes. Library errors from the
   connection are re-raised as kombu errors (e.g. `OperationalError`).
9. **Result.** Returns `result_cls or app.AsyncResult(task_id)` with
   `ignored` set; with `add_to_parent` (default) the result is added to the
   calling task's trail so it appears in `request.children`.

## Protocol v2 message

`as_task_v2` validates that `args` is a list/tuple and `kwargs` a mapping,
then builds a `task_message(headers, properties, body, sent_event)`:

| Part | Content |
|------|---------|
| **headers** | `lang='py'`, `task` (name), `id`, `shadow`, `eta`, `expires`, `group`, `group_index`, `retries`, `timelimit=[hard, soft]`, `root_id` (defaults to the task id), `parent_id`, `argsrepr`, `kwargsrepr` (`saferepr`, truncated), `origin` (node name), `ignore_result`, `replaced_task_nesting`, `stamped_headers`, `stamps` |
| **properties** | `correlation_id = task_id`, `reply_to` (the caller's `thread_oid` by default) |
| **body** | `(args, kwargs, embed)` with `embed = {callbacks, errbacks, chain, chord}` |
| **sent_event** | Fields for a `task-sent` event, only if `task_send_sent_event` |

`countdown` is converted to an absolute timezone-aware `eta`; numeric
`expires` becomes an absolute time; both are sent as ISO 8601 strings in the
app timezone. Because routing data and metadata live in headers, the worker
can route, revoke, rate-limit and schedule a task **without deserializing the
body**, which is decoded only in the pool process
([execution tracing](../architecture/worker/task-execution-trace.md)). The
full specification is in `docs/internals/protocol.rst`.

## Routing

### Queues

`app.amqp.queues` is a `Queues` dict built from `task_queues`. If
`task_queues` is empty, a single queue named `task_default_queue` (default
`celery`) bound to the default exchange/routing key is created
(`x-queue-type: quorum` if `task_default_queue_type='quorum'`).

Unknown queue names are **created on the fly** when
`task_create_missing_queues` is true (default): `new_missing` builds a queue
with an exchange and routing key of the same name, optionally of type
`task_create_missing_queue_type` (`classic` / `quorum`) and
`task_create_missing_queue_exchange_type`. With it disabled, routing to an
unknown queue raises `QueueNotFound`. Workers use the same structure to pick
which queues to consume (`-Q` / `-X` call `select`/`deselect`).
`task_queue_max_priority` sets a default `x-max-priority`.

### Routers

`task_routes` is normalised by `celery.app.routes.prepare` into a list of
routers:

- a dict / list of pairs → `MapRoute`: exact task names, glob patterns
  (`'feed.tasks.*'`) or compiled regexes, mapping to a queue name or an
  options dict;
- a string → imported lazily (`module:callable`); classes with the pre-4.0
  `route_for_task` method are instantiated;
- a callable `router(name, args, kwargs, options, task=None)`.

`Router.route` (`celery/app/routes.py`):

1. expands an explicit `queue` option into the `Queue` object;
2. asks each router in order; the **first non-`None`** answer wins and is
   merged with `lpmerge(route, options)` — explicit call options that are
   not `None` override the route;
3. if no route and no `queue` option, uses `task_default_queue`.

### Publish-time defaults (`send_task_message`)

- No queue and no exchange → `app.amqp.default_queue`.
- For **direct** exchanges without an explicit exchange or routing key, the
  message is sent to the anonymous default exchange `''` with routing key =
  queue name; otherwise it uses the queue's exchange (or
  `task_default_exchange`) and its routing key (or
  `task_default_routing_key`).
- The queue is declared on publish (`declare=[queue]`), except for
  `Broadcast` queues.
- `delivery_mode` comes from the queue's exchange, else
  `task_default_delivery_mode` (2, persistent).
- Serializer and compression default to `task_serializer` /
  `task_compression` ([serialization](../integrations/security-and-serialization.md)).
- **Publish retry:** `task_publish_retry` (default true) with
  `task_publish_retry_policy` (`max_retries=3, interval_start=0,
  interval_step=0.2, interval_max=1`) merged with any per-call
  `retry_policy`.
- Signals: `before_task_publish` (may mutate headers/body), then
  `after_task_publish`; the deprecated `task_sent` signal; and the
  `task-sent` event via the app's event dispatcher.

## Producer and connection pools

- `app.pool` is a kombu connection pool for `connection_for_write()`
  (`broker_pool_limit` connections); `app.amqp.producer_pool` is a kombu
  producer pool over it.
- `producer_or_acquire(producer)` reuses a supplied producer (canvas
  publishes many messages on one) or acquires one from the pool.
- Both pools are discarded after fork (`app._after_fork`) because sockets
  must not be shared between processes.
- `broker_read_url` / `broker_write_url` allow separate brokers for consuming
  and publishing.

## Tests

- `t/unit/app/test_amqp.py` – message construction, queues, send_task_message.
- `t/unit/app/test_routes.py` – MapRoute, glob/regex routes, precedence.
- `t/unit/app/test_app.py` – `send_task` option merging, expires, lineage.
- `t/unit/tasks/test_tasks.py` – `apply_async` paths.
- `t/smoke/tests/quorum_queues/` – quorum queues and native delayed delivery.

See also: [Tasks](../concepts/tasks.md),
[Consumer](../architecture/worker/consumer.md).
