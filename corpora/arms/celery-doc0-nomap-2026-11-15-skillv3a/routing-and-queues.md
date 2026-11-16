---
title: "Routing and Queues"
---
## Overview

Routing decides which queue, exchange and routing key a task message is published with, and therefore which workers can receive it. Celery keeps two structures for this on `app.amqp`: `queues`, a `Queues` mapping of queue names to kombu `Queue` declarations built from `task_queues`, and `router`, a `Router` that applies the `task_routes` setting. The publisher asks the router for a destination for each message ([[Publishing Task Messages]]); the worker consumes from a selected subset of the same queues ([[Consumer and Message Handling]]).

Sources: [celery/app/amqp.py:608-633](repo://celery/app/amqp.py#L608-L633), [celery/app/amqp.py:273-316](repo://celery/app/amqp.py#L273-L316)

This page also covers the RabbitMQ-specific features that interact with routing: priorities, quorum queues and native delayed delivery of ETA tasks.

Sources: [celery/utils/quorum_queues.py:4-20](repo://celery/utils/quorum_queues.py#L4-L20)

## Queue declarations

### The default queue

With no `task_queues` setting, `AMQP.Queues` creates a single queue named by `task_default_queue` (`celery`), bound to the default exchange (`task_default_exchange`, falling back to the queue name, of type `task_default_exchange_type`, `direct`) with the default routing key (falling back to the queue name). Setting `task_default_queue_type = 'quorum'` declares it with `x-queue-type: quorum`.

Sources: [celery/app/amqp.py:273-306](repo://celery/app/amqp.py#L273-L306), [celery/app/utils.py:114-126](repo://celery/app/utils.py#L114-L126), [celery/app/defaults.py:278-289](repo://celery/app/defaults.py#L278-L289)

### Declaring queues

`task_queues` may be a list of `kombu.Queue` objects or a dict of name to options. Dict entries go through `add_compat`, which accepts the old `binding_key` name and defaults the routing key to the queue name. Every queue added gets the default exchange if it has none and the default routing key if it has none, and `x-max-priority` when `task_queue_max_priority` is set.

Sources: [celery/app/amqp.py:63-85](repo://celery/app/amqp.py#L63-L85), [celery/app/amqp.py:104-146](repo://celery/app/amqp.py#L104-L146)

```python
from kombu import Exchange, Queue

app.conf.task_queues = [
    Queue('default', routing_key='task.#'),
    Queue('feeds', Exchange('feeds', type='topic'), routing_key='feed.#'),
    Queue('hipri', queue_arguments={'x-max-priority': 10}),
]
```

Sources: [celery/app/amqp.py:78-82](repo://celery/app/amqp.py#L78-L82)

A queue can carry an `alias`; `Queues.__getitem__` looks aliases up first, so routes can name a queue by its alias.

Sources: [celery/app/amqp.py:86-97](repo://celery/app/amqp.py#L86-L97)

### Missing queues

Looking up a name that is not declared calls `__missing__`. With `task_create_missing_queues` (the default), `new_missing` creates `Queue(name, Exchange(name), name)`: a queue, a direct exchange and a binding all named after it. `task_create_missing_queue_type='quorum'` declares such queues as quorum queues (any value other than `classic` or `quorum` raises `ValueError`), and `task_create_missing_queue_exchange_type` changes the exchange type. With creation disabled, an unknown queue raises `KeyError`, which the router reports as `QueueNotFound`.

Sources: [celery/app/amqp.py:99-102](repo://celery/app/amqp.py#L99-L102), [celery/app/amqp.py:201-216](repo://celery/app/amqp.py#L201-L216), [celery/app/routes.py:78-96](repo://celery/app/routes.py#L78-L96)

## Routing a message

### The routing order

`Router.route(options, name, args, kwargs, task_type)` combines three sources, with earlier ones winning per key:

Sources: [celery/app/routes.py:66-76](repo://celery/app/routes.py#L66-L76)

1. Options given to `apply_async` or set on the task class (`queue`, `exchange`, `routing_key`, `priority`).
2. The first route returned by a router in `task_routes`, merged under those options with `lpmerge`.
3. `task_default_queue` if no queue was chosen.

Sources: [celery/app/routes.py:66-76](repo://celery/app/routes.py#L66-L76), [celery/app/routes.py:98-111](repo://celery/app/routes.py#L98-L111)

`expand_destination` turns a queue name into the declared `Queue` object, so the publisher gets the queue's exchange and routing key. A route may also be a plain string, meaning `{'queue': name}`, or a dict that names a queue and overrides some of its settings, such as the routing key on a topic exchange.

Sources: [celery/app/routes.py:78-96](repo://celery/app/routes.py#L78-L96)

### task_routes

`prepare` expands `task_routes` into a list of routers. A dict (or list of pairs) becomes a `MapRoute`; a string is a dotted path to a router function or class, imported lazily; anything else is used as a callable.

Sources: [celery/app/routes.py:114-136](repo://celery/app/routes.py#L114-L136)

`MapRoute` checks exact task names first and then patterns in insertion order. Keys containing `*` are glob patterns translated with `fnmatch`; compiled `re.Pattern` keys are regular expressions. The value can be a dict of options or just a queue name.

Sources: [celery/app/routes.py:26-53](repo://celery/app/routes.py#L26-L53)

```python
app.conf.task_routes = {
    'proj.tasks.add': {'queue': 'hipri'},
    'feed.tasks.*': {'queue': 'feeds'},
    re.compile(r'(image|video)\.tasks\..*'): 'media',
}
```

Sources: [celery/app/routes.py:29-53](repo://celery/app/routes.py#L29-L53)

### Router functions

A router function is called as `router(name, args, kwargs, options, task=task_type)` and returns a route or `None` to pass to the next router. Old-style classes with a `route_for_task(task, args, kwargs)` method are still accepted and instantiated. Because the function sees the arguments, it can route by payload, for example sending large jobs to a dedicated queue.

Sources: [celery/app/routes.py:98-119](repo://celery/app/routes.py#L98-L119)

```python
def route_task(name, args, kwargs, options, task=None, **kw):
    if name.startswith('video.'):
        return {'queue': 'video', 'priority': 3}
    return None

app.conf.task_routes = (route_task,)
```

Sources: [celery/app/routes.py:106-111](repo://celery/app/routes.py#L106-L111)

Changing `task_routes` at run time is picked up: the AMQP helper is bound to configuration changes and rebuilds the routing table and router when that key changes.

Sources: [celery/app/amqp.py:257-263](repo://celery/app/amqp.py#L257-L263), [celery/app/amqp.py:659-663](repo://celery/app/amqp.py#L659-L663)

### From route to publish arguments

`send_task_message` turns the chosen queue into exchange and routing key. For a direct exchange where the route did not set both explicitly, it publishes to the anonymous default exchange with the queue name as routing key, which delivers straight to the queue without depending on bindings. Topic and fanout exchanges use the queue's exchange and routing key. The queue is declared on publish unless it is a `Broadcast` queue.

Sources: [celery/app/amqp.py:521-551](repo://celery/app/amqp.py#L521-L551)

## Consuming from queues

### Selecting queues with -Q and -X

By default a worker consumes from every declared queue. `celery worker -Q a,b` calls `queues.select(['a', 'b'])`, which records a `_consume_from` subset (creating missing queues if allowed); the rest of the declarations remain usable for routing. `-X` removes names from the consumed set with `deselect`. Selecting an undefined queue when creation is disabled stops the worker with `ImproperlyConfigured`.

Sources: [celery/app/amqp.py:159-222](repo://celery/app/amqp.py#L159-L222), [celery/worker/worker.py:166-180](repo://celery/worker/worker.py#L166-L180)

The task consumer is created with `TaskConsumer`, which consumes from `queues.consume_from` and accepts the content types in `accept_content`.

Sources: [celery/app/amqp.py:317-324](repo://celery/app/amqp.py#L317-L324)

### Worker direct queues

With `worker_direct = True`, each worker also consumes from a queue named `<hostname>.dq2` bound to the `C.dq2` exchange with its node name as routing key. Routing a task to that queue sends it to one specific worker.

Sources: [celery/worker/worker.py:178-179](repo://celery/worker/worker.py#L178-L179), [celery/utils/nodenames.py:38-52](repo://celery/utils/nodenames.py#L38-L52)

### Adding queues at run time

The `add_consumer` remote control command calls `Consumer.add_task_queue`, which adds the queue (declaring a direct exchange of the same name if it is new) with `select_add`, so it stays active even under `-Q`, and starts consuming from it. `cancel_consumer` does the reverse. See [[Remote Control and Inspection]].

Sources: [celery/worker/consumer/consumer.py:632-658](repo://celery/worker/consumer/consumer.py#L632-L658)

## Priorities

The `priority` option (0–9) is passed to the broker as a message property. RabbitMQ only honours it on queues declared with `x-max-priority`, which `task_queue_max_priority` adds to every queue that lacks it; higher numbers are served first. On Redis, kombu emulates priorities with separate lists and 0 is the highest. A child task inherits its parent's delivery priority when `task_inherit_parent_priority` is on.

Sources: [celery/app/amqp.py:137-146](repo://celery/app/amqp.py#L137-L146), [celery/app/task.py:587-596](repo://celery/app/task.py#L587-L596), [celery/app/base.py:999-1001](repo://celery/app/base.py#L999-L1001)

## Quorum queues and native delayed delivery

### Detecting quorum queues

`detect_quorum_queues(app, driver_type)` returns true when the transport is AMQP (RabbitMQ) and any declared queue has `x-queue-type: quorum`. Two behaviours change when it does.

Sources: [celery/utils/quorum_queues.py:4-20](repo://celery/utils/quorum_queues.py#L4-L20)

Quorum queues do not support global QoS. When `worker_detect_quorum_queues` is on and quorum queues are found, the `Tasks` consumer step switches to per-consumer prefetch, which makes the prefetch count static: it can no longer grow for ETA tasks.

Sources: [celery/worker/consumer/tasks.py:103-124](repo://celery/worker/consumer/tasks.py#L103-L124)

### Delayed delivery

Holding ETA tasks in worker memory does not scale with a static prefetch count, so with quorum queues Celery uses kombu's native delayed delivery: a hierarchy of RabbitMQ exchanges and queues with message TTLs that release a message to its destination after the delay. In `send_task`, a message with a positive countdown or ETA (converted to a countdown) whose exchange is not direct gets a routing key computed by `calculate_routing_key(countdown, routing_key)` and is published to the `celery_delayed_27` topic exchange. Direct exchanges cannot work this way; Celery logs a warning and the ETA is handled by the worker as usual.

Sources: [celery/app/base.py:933-964](repo://celery/app/base.py#L933-L964)

### The DelayedDelivery consumer step

On the worker side, the `DelayedDelivery` bootstep (included only when quorum queues are detected) runs after the `Tasks` step. It validates `broker_url` and `broker_native_delayed_delivery_queue_type` (`quorum` by default, or `classic`), then for each broker URL (semicolon-separated failover URLs are all set up) declares the delay exchanges and queues and binds every non-broadcast application queue to them, so delayed messages come back to the right queue.

Sources: [celery/worker/consumer/delayed_delivery.py:39-110](repo://celery/worker/consumer/delayed_delivery.py#L39-L110), [celery/worker/consumer/delayed_delivery.py:112-199](repo://celery/worker/consumer/delayed_delivery.py#L112-L199)

Connection errors (`ConnectionRefusedError`, `OSError`) are retried up to 3 times, one second apart. Failure for one URL is logged and the next is tried; failure for all logs a critical message, and the worker keeps running without native delayed delivery. Binding failures for individual queues are collected and raised together as an `ExceptionGroup`.

Sources: [celery/worker/consumer/delayed_delivery.py:30-36](repo://celery/worker/consumer/delayed_delivery.py#L30-L36), [celery/worker/consumer/delayed_delivery.py:86-110](repo://celery/worker/consumer/delayed_delivery.py#L86-L110), [celery/worker/consumer/delayed_delivery.py:201-279](repo://celery/worker/consumer/delayed_delivery.py#L201-L279)
