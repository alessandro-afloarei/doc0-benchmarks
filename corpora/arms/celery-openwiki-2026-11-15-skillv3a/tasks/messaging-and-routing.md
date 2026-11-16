---
type: subsystem
title: Task Messages, Protocol and Routing
description: How app.amqp turns a task call into a broker message. Covers the protocol v2 header/property/body layout (with v1 compatibility), countdown/ETA/expires conversion, the Queues table and missing-queue creation, the Router and task_routes formats, publish retry, publish signals and task-sent events, and native delayed delivery for RabbitMQ quorum queues.
tags: [amqp, protocol, routing, queues, kombu, quorum-queues, delayed-delivery]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:49.645Z
sources:
  - id: openwiki-source-5a0b6982dd7ddb0fabfabd0c
    resource: repo://celery/app/amqp.py
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-51bdc9f790e9afc683dd8164
    resource: repo://celery/app/routes.py
  - id: openwiki-source-f7c134e9626dda7914739959
    resource: repo://celery/utils/quorum_queues.py
  - id: openwiki-source-e05a13d8343387f57526f632
    resource: repo://celery/worker/consumer/delayed_delivery.py
  - id: openwiki-source-337ca17b51d3603b5a2c09ec
    resource: repo://celery/worker/consumer/tasks.py
generated: { by: "claude-code", at: "2026-11-15T17:08:49.645Z" }
---

# Task Messages, Protocol and Routing

`celery/app/amqp.py` (`app.amqp`, class `AMQP`) owns everything between `app.send_task()` and kombu's `Producer.publish()`. `celery/app/routes.py` decides **where** a task goes. Worker-side decoding of messages is described in [Consumer, Strategies and Task Requests](../worker/consumer-and-requests.md).

## Message protocol v2 (default)

`app.amqp.create_task_message` resolves to `as_task_v2` (or `as_task_v1` when `task_protocol = 1`) and returns a `task_message(headers, properties, body, sent_event)` tuple.

**Headers** (the worker can route and schedule without deserializing the body):

| Header | Meaning |
|---|---|
| `lang`, `task`, `id` | `'py'`, task name, task ID |
| `shadow` | alternative name for logs and monitoring |
| `eta`, `expires` | ISO-8601 strings. A `countdown` is converted to an aware `eta` using `app.now()` and `app.timezone`. A numeric `expires` (seconds) becomes an absolute time. |
| `group`, `group_index` | group membership and ordering |
| `retries` | retry count |
| `timelimit` | `[hard, soft]` time limits |
| `root_id`, `parent_id` | workflow lineage. `root_id` defaults to the task's own ID. Both are inherited from the current worker task when publishing from inside a task. |
| `argsrepr`, `kwargsrepr` | `saferepr` truncated to 1024 characters, or caller-supplied redacted strings, used in logs and events |
| `origin` | publishing node name |
| `ignore_result` | per-call override |
| `replaced_task_nesting` | depth of `Task.replace` |
| `stamped_headers`, `stamps` | canvas stamping (see [Canvas](../canvas/workflows.md)) |

**Properties:** `correlation_id = task_id` and `reply_to` (the RPC backend reply queue or the client's OID).

**Body:** `(args, kwargs, embed)`, where `embed = {callbacks, errbacks, chain, chord}`. This is the only part that is serialized with `task_serializer` (default JSON) and optionally compressed (`task_compression`). With the [auth serializer](../security/message-signing.md), only this body is signed.

`args` must be a list or tuple and `kwargs` a mapping, otherwise a `TypeError` is raised at publish time. The worker converts protocol 1 messages and hybrid messages (`proto1_to_proto2`, `hybrid_to_proto2` in `worker/strategy.py`), so mixed-version clusters still interoperate.

## `send_task` → `send_task_message`

`app.send_task()` (`celery/app/base.py`):

1. warns if `task_always_eager` is set, since it has no effect on `send_task`;
2. merges routing options via `router.route(options, name, args, kwargs, task_type)`;
3. applies native delayed delivery rewriting (below);
4. turns `expires` into an AMQP per-message TTL (`expiration` in seconds). A time in the past becomes 0, with a warning;
5. inherits `root_id`, `parent_id`, and optionally priority (`task_inherit_parent_priority`) from the current worker task;
6. builds the message, publishes it inside `producer_or_acquire()` (the app's producer pool, sized by `broker_pool_limit`), and calls `backend.on_task_call` first.

`amqp.send_task_message(producer, name, message, queue=..., exchange=..., routing_key=..., ...)` then:

- resolves `queue` by name from `app.amqp.queues`, defaulting to `amqp.default_queue`;
- picks `delivery_mode` from the queue's exchange or `task_default_delivery_mode` (2, persistent);
- **uses the default (anonymous) exchange** with `routing_key = queue name` when the exchange type is `direct` and no explicit exchange or routing key is given. Otherwise it uses the queue's exchange and routing key, or `task_default_routing_key`;
- declares the target queue on publish (`declare=[queue]`), except for `Broadcast` queues;
- publishes with retry according to `task_publish_retry` and `task_publish_retry_policy` (default 3 retries, interval 0 → 1s in 0.2s steps), merged with the per-call `retry_policy`;
- sends `before_task_publish` and `after_task_publish` signals (only if they have receivers), plus the deprecated `task_sent`;
- publishes a `task-sent` event with queue, exchange, and routing key when `task_send_sent_event` is set (see [Events](../operations/events-monitoring.md)).

## Queues

`app.amqp.queues` is a `Queues` dict (name → `kombu.Queue`) built from `task_queues`:

- If `task_queues` is empty, a single default queue `task_default_queue` (`celery`) is created on the default exchange. It is declared as a quorum queue if `task_default_queue_type = 'quorum'`.
- **Missing queues** are created on demand when `task_create_missing_queues` (default True) is on. Looking up an unknown name adds a queue with a same-named exchange and routing key, so routing a task to a new name just works. `task_create_missing_queue_type` (`classic`/`quorum`) and `task_create_missing_queue_exchange_type` control how new queues are declared.
- `task_queue_max_priority` adds `x-max-priority` to queues that don't set it.
- `select(include)` and `deselect(exclude)` implement the worker's `-Q` and `-X` options. `select_add` adds queues at run time (remote control `add_consumer`). `consume_from` is the active subset, and the others are used only for routing.
- `worker_direct=True` makes each worker also consume from `<hostname>.dq` (`utils/nodenames.worker_direct`), so tasks can target a specific node.

## Routing (`celery/app/routes.py`)

`task_routes` is normalized by `prepare()` into a list of routers, tried in order. The first non-`None` answer wins:

- **dict or list of pairs** → `MapRoute`. Exact names first, then glob patterns (`'feed.tasks.*'`) or compiled `re.Pattern` keys. Values may be a queue name or an options dict (`{'queue': ..., 'routing_key': ..., 'priority': ...}`).
- **string** → imported lazily as a router function, or as an old-style class with `route_for_task`.
- **callable** `router(name, args, kwargs, options, task=None)` → returns options or `None`.

`Router.route()` merges in this order: route result, then explicit call options, which take precedence via `lpmerge`, then `task_default_queue` if no queue was chosen. `expand_destination` turns queue names into `Queue` objects and raises `QueueNotFound` if the name is unknown and missing-queue creation is off. Per-task defaults (`Task.queue`, `routing_key`, `priority`, ...) arrive through `Task._get_exec_options()` before routing.

## Native delayed delivery (RabbitMQ quorum queues)

Quorum queues do not support the per-consumer QoS behaviour that Celery's in-worker ETA scheduling depends on. Celery therefore uses kombu's **native delayed delivery** topology when quorum queues are detected (`utils/quorum_queues.detect_quorum_queues`: an AMQP transport and any queue with `x-queue-type=quorum`).

- **Producer side** (`send_task`): for tasks with `eta` or `countdown` routed through a non-direct (topic or fanout) exchange, the remaining delay is encoded into the routing key (`kombu.transport.native_delayed_delivery.calculate_routing_key`), and the message is published to the `celery_delayed_27` topic exchange. Delays are encoded in binary across 28 levels, roughly 8.5 years at most. With a **direct** exchange, a warning is logged and the task falls back to in-worker ETA, which may block worker capacity.
- **Worker side**: the `DelayedDelivery` consumer bootstep (`worker/consumer/delayed_delivery.py`) is included only when quorum queues are detected. It validates `broker_url` (a list or a `;`-separated string) and `broker_native_delayed_delivery_queue_type` (`classic` or `quorum`, default `quorum`). For each broker URL it declares the delay exchanges and queues and binds every non-broadcast application queue to them, retrying `ConnectionRefusedError` and `OSError` up to 3 times. If setup fails for every URL, it logs a critical error and the worker continues without native delays.
- `worker_detect_quorum_queues` (default True) also makes the worker disable global QoS, which quorum queues don't support (see [Consumer](../worker/consumer-and-requests.md)).

## Tests

- `t/unit/app/test_amqp.py`: message building, queues, the sender.
- `t/unit/app/test_routes.py`: MapRoute, glob and regex routes, router precedence.
- `t/unit/worker/test_native_delayed_delivery.py` and `t/smoke/tests/quorum_queues/`.

## See also

- [Tasks: Definition, Invocation, Retries](task-lifecycle.md)
- [Consumer, Strategies and Task Requests](../worker/consumer-and-requests.md)
- [Message Signing](../security/message-signing.md)
