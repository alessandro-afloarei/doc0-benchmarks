---
type: subsystem
title: Message Publishing, Protocol and Routing
description: How a task call becomes a broker message — task message protocol v2 (and v1) headers/body, queue and exchange declarations in app.amqp, task_routes routers, send_task option handling (eta, countdown, expires, priority), producer/connection pools, publish retry, and publish signals.
tags: [messaging, amqp, routing, protocol, kombu, producer]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T09:27:53.075Z
sources:
  - id: openwiki-source-5a0b6982dd7ddb0fabfabd0c
    resource: repo://celery/app/amqp.py
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-ac404435efa758dad4bbfc83
    resource: repo://celery/app/defaults.py
  - id: openwiki-source-51bdc9f790e9afc683dd8164
    resource: repo://celery/app/routes.py
generated: { by: "claude-code", at: "2026-11-15T09:27:53.075Z" }
---

# Message Publishing, Protocol and Routing

Publishing is split between `Celery.send_task` (`celery/app/base.py`), which resolves options and identity, and `app.amqp` (`celery/app/amqp.py`, class `AMQP`), which owns queue definitions, the router, message construction and the actual `kombu.Producer.publish` call. Routing rules live in `celery/app/routes.py`.

## Flow

```text
Task.apply_async(args, kwargs, **options)
  └─ app.send_task(name, ...)
       1. merge registered task's exec options (plain send_task only)
       2. pop time_limit / soft_time_limit / expires
       3. options = amqp.router.route(options, name, args, kwargs, task_type)
       4. quorum queues + eta/countdown → rewrite to native delayed delivery exchange
       5. expires → message 'expiration' TTL (seconds; negative → 0 with warning)
       6. root_id / parent_id (and optional priority) from current worker task
       7. message = amqp.create_task_message(...)          # as_task_v2 by default
       8. with producer_or_acquire(producer):
             backend.on_task_call(P, task_id)             # unless ignore_result
             amqp.send_task_message(P, name, message, **options)
       9. return AsyncResult; add to parent's trail
```

`send_task` never executes eagerly (it warns `AlwaysEagerIgnored` when `task_always_eager` is set) and does not auto-finalize the app: it looks up `name` in the raw registry only to merge locally known task options, so sending tasks that only exist on remote workers works.

## Task message protocol

`task_protocol` (default `2`) selects `AMQP.as_task_v2` or the legacy `as_task_v1`. A v2 message is a `task_message(headers, properties, body, sent_event)`:

- **Headers**: `lang`, `task` (name), `id`, `shadow`, `eta`, `expires` (ISO-8601 strings), `group`, `group_index`, `retries`, `timelimit` `[hard, soft]`, `root_id` (defaults to the task id), `parent_id`, `argsrepr`/`kwargsrepr` (saferepr truncated at 1024 chars), `origin` (node name), `ignore_result`, `replaced_task_nesting`, `stamped_headers`, `stamps`.
- **Properties**: `correlation_id` = task id, `reply_to` (the app's per-thread oid, used by the RPC backend).
- **Body**: the tuple `(args, kwargs, embed)` where `embed` has `callbacks`, `errbacks`, `chain`, `chord`.

`countdown` is converted to an absolute `eta` using `app.now()` and the app timezone; numeric `expires` becomes an absolute time. Args must be a list/tuple and kwargs a mapping (`TypeError` otherwise).

Because the task name is in a header, the worker can pick a strategy without deserializing the body — v2 bodies are only decoded inside the pool. The worker converts v1 and "hybrid" messages to the v2 layout (`proto1_to_proto2`, `hybrid_to_proto2` in `celery/worker/strategy.py`).

## Queues and exchanges

`app.amqp.queues` is a `Queues` dict built from `task_queues`. When `task_queues` is empty, a single default queue `task_default_queue` (`celery`) is created on the default exchange (`task_default_exchange`, falling back to the queue name; type `task_default_exchange_type`, `direct`) — declared as a quorum queue if `task_default_queue_type='quorum'`.

`Queues` behaviour:

- Missing queues are auto-created on lookup when `task_create_missing_queues` is true (default); otherwise `KeyError`. New queues get an exchange named after the queue (or of type `task_create_missing_queue_exchange_type`) and `x-queue-type` from `task_create_missing_queue_type` (`classic` or `quorum`; anything else raises `ValueError`).
- `task_queue_max_priority` adds `x-max-priority` to queues without it.
- `select(include)` / `deselect(exclude)` define the subset consumed by a worker (`-Q`/`-X`); `select_add` adds a queue that stays active even after selection (used by `add_consumer`). `consume_from` returns the active set.

## Routing

`app.amqp.router` is a `Router` over `task_routes`, prepared by `routes.prepare()`:

- A dict (or list of pairs) becomes a `MapRoute`: exact task names first, then glob patterns (`'feeds.*'`) and compiled regexes, in order. A value may be a dict of options or just a queue name.
- A string is lazily imported as a router; old-style classes with `route_for_task` are instantiated.
- Any callable `router(name, args, kwargs, options, task=task_type)` returning a dict, queue name, or `None`.

`Router.route()` expands `queue` names into `kombu.Queue` objects (raising `QueueNotFound` if missing and creation is disabled), asks routers in order (first non-`None` wins), merges the route **under** explicit call options (`lpmerge` — explicit options win), and falls back to `task_default_queue`. Changing `task_routes` at runtime rebuilds the router (`_handle_conf_update`).

## Publishing (`send_task_message`)

`AMQP._create_task_sender()` returns a closure capturing defaults (serializer, compression, delivery mode, routing key, retry policy) so the hot path is cheap:

1. Merges extra `headers` and properties into the message.
2. Resolves the queue (default queue when neither queue nor exchange is given).
3. Picks `delivery_mode` from the queue's exchange or `task_default_delivery_mode` (2 = persistent).
4. For **direct** exchanges without explicit exchange/routing key, publishes to the default exchange `''` with the queue name as routing key; otherwise uses the queue's exchange/routing key.
5. Declares the target queue (unless it is a `Broadcast` queue) and publishes with `retry=task_publish_retry` (default `True`) and `task_publish_retry_policy` (default `max_retries=3`, `interval_start=0`, `interval_step=0.2`, `interval_max=1`).
6. Sends `before_task_publish` / `after_task_publish` signals (and deprecated `task_sent`) and a `task-sent` event when `task_send_sent_event` is enabled.

## Connections and producer pools

- `app.connection_for_write()` / `connection_for_read()` use `broker_write_url` / `broker_read_url` (falling back to `broker_url`).
- `app.pool` is a kombu connection pool limited by `broker_pool_limit`; `app.amqp.producer_pool` is the kombu producers pool for the write connection with the same limit.
- `producer_or_acquire()` / `connection_or_acquire()` reuse a supplied producer/connection or acquire one, waiting up to `broker_pool_acquire_timeout`; exhaustion raises `OperationalError` advising to raise `broker_pool_limit`.
- Pools are dropped after fork (`app._after_fork`).

## Identity and priority inheritance

When called from inside a worker task, `send_task` inherits `root_id` and sets `parent_id` to the current task, and with `task_inherit_parent_priority` copies the parent's delivery priority. Unless `add_to_parent=False`, the new result is appended to the parent request's `children` (the "trail").

## Native delayed delivery

On RabbitMQ with quorum queues, ETA/countdown tasks sent to non-direct exchanges are rewritten to the `celery_delayed_27` topic exchange with a routing key computed by kombu's `calculate_routing_key(countdown, routing_key)`. See [Native Delayed Delivery and Quorum Queues](../worker/delayed-delivery-and-quorum-queues.md).

## Related

- Consumption side: [Worker Consumer and Event Loop](../worker/consumer.md).
- Serializer security (`accept_content`, `auth`): [Message Signing Security](../security/message-signing.md).
- Tests: `t/unit/app/test_amqp.py`, `t/unit/app/test_routes.py`, `t/unit/tasks/test_tasks.py`.
