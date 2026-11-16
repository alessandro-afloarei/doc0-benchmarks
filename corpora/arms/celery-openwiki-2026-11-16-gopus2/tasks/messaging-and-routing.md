---
type: subsystem
title: Message Protocol, Queues and Routing
description: The app.amqp layer (celery/app/amqp.py) and routing (celery/app/routes.py) — task message protocol v2 headers/properties/body, publishing with retry policies, serializer/compression defaults, default and auto-created queues, router resolution order, expiration handling, and RabbitMQ quorum queues with native delayed delivery.
tags: [amqp, protocol, routing, queues, kombu, quorum-queues, serialization]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:05:29.073Z
sources:
  - id: openwiki-source-5a0b6982dd7ddb0fabfabd0c
    resource: repo://celery/app/amqp.py
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-51bdc9f790e9afc683dd8164
    resource: repo://celery/app/routes.py
  - id: openwiki-source-4a74724fd0043fb3763dcbaf
    resource: repo://celery/utils/collections.py
  - id: openwiki-source-f7c134e9626dda7914739959
    resource: repo://celery/utils/quorum_queues.py
generated: { by: "claude-code", at: "2026-11-16T17:05:29.073Z" }
---

# Message Protocol, Queues and Routing

`app.amqp` (`celery.app.amqp.AMQP`) is the bridge between Celery's task API and kombu. It owns the queue table, the router, the producer pool, and the functions that build and publish task messages. Routing rules are implemented in `celery/app/routes.py`.

## Task message format (protocol 2)

`task_protocol` defaults to `2`; `AMQP.create_task_message` dispatches to `as_task_v2` (or `as_task_v1` for the legacy dict-body format). A v2 message is a `task_message(headers, properties, body, sent_event)` tuple:

**Headers**

| Header | Meaning |
|--------|---------|
| `lang` | `'py'` |
| `task` | Registered task name |
| `id` | Task id (also `correlation_id` property) |
| `shadow` | Alternative name for logs/monitoring |
| `eta`, `expires` | ISO-8601 timestamps (countdown and numeric expires are converted using `app.now()`/timezone) |
| `group`, `group_index` | Group membership |
| `retries` | Retry count |
| `timelimit` | `[hard, soft]` |
| `root_id`, `parent_id` | Workflow lineage (root defaults to the task id) |
| `argsrepr`, `kwargsrepr` | `saferepr` previews (max 1024 chars) used for logs/events, so the full arguments need not be decoded |
| `origin` | Publisher node name |
| `ignore_result` | Per-call override |
| `replaced_task_nesting` | Depth of `Task.replace` |
| `stamped_headers`, `stamps` | Canvas stamping data |

**Properties:** `correlation_id = task_id`, `reply_to` (the caller's oid; used by the RPC backend).

**Body:** `(args, kwargs, embed)` where `embed = {callbacks, errbacks, chain, chord}` — the workflow continuation (see [Canvas](../canvas/workflows.md)).

`args` must be a list/tuple and `kwargs` a mapping, otherwise `TypeError` is raised at publish time. Because headers carry routing-relevant metadata, workers can make decisions (revocation, ETA, rate limiting, time limits) **without deserialising the body** — that only happens in the pool when the task runs.

The `sent_event` part is filled only if `task_send_sent_event` is enabled and is published as a `task-sent` event after publishing.

## Publishing

`AMQP.send_task_message(producer, name, message, **options)` (built once by `_create_task_sender`):

1. Resolves the target: an explicit `queue` (name → `Queue` via `amqp.queues`), else the default queue.
2. Determines `delivery_mode` (queue's exchange, else `task_default_delivery_mode` = persistent) and the exchange type.
3. For **direct** exchanges without an explicit exchange/routing key it publishes to the default (anonymous) exchange with the queue name as routing key; otherwise it uses the queue's exchange and routing key (falling back to defaults).
4. Declares the queue (unless it is a `Broadcast` queue) as part of publishing.
5. Merges `task_publish_retry_policy` with per-call `retry_policy` (`task_publish_retry` default on: max 3 retries, 0–1 s intervals).
6. Sends `before_task_publish`, calls `producer.publish(body, serializer=task_serializer, compression=task_compression, headers=..., **properties)`, then `after_task_publish` (and the deprecated `task_sent`).

The producer comes from `app.amqp.producer_pool`, a kombu producer pool tied to `connection_for_write()` and sized by `broker_pool_limit`; it is reset after fork (see [Application Object](../architecture/application-object.md)).

`app.send_task()` is where options are prepared before reaching this function: `ignore_result` is extracted, the router is applied, ETA/expiry are normalised, and **`expires` is also converted to a message TTL** (`expiration` property, seconds). Expiry in the past is clamped to 0 with a warning (RabbitMQ then drops the message unless a consumer takes it immediately). It also links parent/root ids from the currently executing task and optionally inherits its priority (`task_inherit_parent_priority`).

## Serialization and compression

- `task_serializer` (default `json`), `result_serializer` (`json`), `event_serializer` (`json`), with `accept_content`/`result_accept_content` as whitelists — see [Message Signing and Security](../operations/security.md).
- `task_compression`/`result_compression` select kombu compressors (`gzip`, `bzip2`, `zstd`, `brotli`, ... depending on installed extras).
- `celery/utils/serialization.py` provides helpers for making exceptions pickleable (`get_pickleable_exception`, `UnpickleableExceptionWrapper`) and for JSON-safe exception data; JSON serialisation of datetimes, UUIDs and Decimals is handled by kombu's JSON encoder.

## Queues

`app.amqp.queues` is a `Queues` dict (name → `kombu.Queue`) created from `task_queues`:

- If `task_queues` is empty, a single queue named `task_default_queue` (`celery`) is created on the default exchange (`task_default_exchange`, defaulting to the queue name, type `task_default_exchange_type` = `direct`), with `x-queue-type: quorum` if `task_default_queue_type='quorum'`.
- **Missing queues are created on demand** when `task_create_missing_queues` is true (default): looking up an unknown name builds `Queue(name, Exchange(name), routing_key=name)`, optionally with `task_create_missing_queue_type` (`classic`/`quorum`) and `task_create_missing_queue_exchange_type`. With it disabled, unknown queues raise `KeyError`/`QueueNotFound`.
- `task_queue_max_priority` sets a default `x-max-priority` for queues that do not define one.
- `select(include)` / `deselect(exclude)` (driven by `celery worker -Q/-X`) restrict which queues are **consumed** (`consume_from`) while keeping all queues available for routing. With `worker_direct`, each worker also consumes a per-node direct queue.

## Routing

`app.amqp.router` is a `Router(routes, queues, create_missing)` built from `task_routes` via `routes.prepare()`:

- A **dict** (or list of pairs) becomes a `MapRoute`: exact task names first, then glob patterns (`'feed.tasks.*'`) or compiled regexes in insertion order. A route value may be a queue name or an options dict.
- A **string** is an import path to a router function/class, loaded lazily (pre-4.0 classes with `route_for_task` are instantiated).
- A **callable** is called as `router(name, args, kwargs, options, task=task)`; the first non-`None` result wins.

`Router.route(options, name, args, kwargs, task_type)`:

1. Expands `options['queue']` (name → `Queue`; unknown names raise `QueueNotFound` unless auto-created).
2. Consults the routers in order; a matching route is expanded and merged **under** the explicit call options (`lpmerge`: explicit non-`None` options win).
3. If still no queue, uses `task_default_queue`.

Changing `task_routes` at runtime via `app.conf` rebuilds the router (`AMQP._handle_conf_update`).

Task-level routing attributes (`Task.queue`, `routing_key`, `exchange`, `priority`) feed into the options that reach the router; see [Task Definition and Invocation](task-definition-and-invocation.md).

## Quorum queues and native delayed delivery

RabbitMQ quorum queues do not support global QoS or per-message ETA buffering well, so Celery adapts:

- `celery.utils.quorum_queues.detect_quorum_queues(app, driver_type)` reports whether any configured queue has `x-queue-type: quorum` (only for the `amqp` driver).
- When publishing a task with `eta`/`countdown` and quorum queues are detected, `send_task` routes the message through the **`celery_delayed_27` topic exchange** with a routing key encoding the delay (`kombu.transport.native_delayed_delivery.calculate_routing_key`), so the broker holds it until due. This requires the target queue's exchange to be **topic or fanout**; for direct exchanges a warning is logged and the task falls back to worker-side ETA handling.
- On the worker side, the `DelayedDelivery` consumer step declares the delay exchanges/bindings and the `Tasks` step disables global QoS when quorum queues are used (`worker_detect_quorum_queues`). See [Worker Consumer](../worker/consumer.md).

## Tests

- `t/unit/app/test_amqp.py` — v1/v2 message construction, queues, publish options, delivery modes, quorum default queue.
- `t/unit/app/test_routes.py` — `MapRoute` patterns, router precedence, `QueueNotFound`, create-missing behaviour.
- `t/smoke/tests/quorum_queues/` — end-to-end quorum queue and native delayed delivery behaviour.

## Related

- [Task Definition and Invocation](task-definition-and-invocation.md)
- [Worker Consumer](../worker/consumer.md)
- [Message Signing and Security](../operations/security.md)
