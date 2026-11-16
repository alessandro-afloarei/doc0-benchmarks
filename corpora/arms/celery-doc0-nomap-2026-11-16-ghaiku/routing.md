---
title: "Routing and Queues"
---
## Overview

Every task message is published to a queue. Two pieces decide which one: the `Router`, which maps a task name to options such as a queue name, and the `Queues` registry, which turns a queue name into the declaration (exchange, routing key and arguments) the broker needs. The worker chooses the other side of the same names when it decides which queues to consume. [[Sending a Task Message]] calls the router during `send_task`; this page follows the choice itself.

Sources: [celery/app/routes.py:56-76](repo://celery/app/routes.py#L56-L76), [celery/app/amqp.py:41-103](repo://celery/app/amqp.py#L41-L103)

## The Queues registry

`Queues` is a dictionary from queue name to `kombu.Queue`. It also keeps an alias table, so a queue can be looked up by its alias as well as its name. Adding a queue given as a string builds the declaration from a routing key and an exchange type; adding a `Queue` object uses the object as it is.

Sources: [celery/app/amqp.py:41-100](repo://celery/app/amqp.py#L41-L100), [celery/app/amqp.py:104-130](repo://celery/app/amqp.py#L104-L130)

A name that is not in the registry raises `KeyError` unless `create_missing` is set. In that case the registry builds a queue for the name, with the exchange type from `create_missing_queue_exchange_type` or an exchange named after the queue, and adds it. A task can therefore name a queue the program never declared.

Sources: [celery/app/amqp.py:99-102](repo://celery/app/amqp.py#L99-L102), [celery/app/amqp.py:201-216](repo://celery/app/amqp.py#L201-L216)

The `AMQP.Queues` factory builds the registry from settings. It reads `task_create_missing_queues`, `task_queue_max_priority` and the default routing key. When `task_default_queue_type` is `quorum`, the default queue is declared with an `x-queue-type` argument of `quorum`.

Sources: [celery/app/amqp.py:273-292](repo://celery/app/amqp.py#L273-L292)

The default queue is whatever `task_default_queue` names in the registry. It is cached on the AMQP object.

Sources: [celery/app/amqp.py:608-611](repo://celery/app/amqp.py#L608-L611)

## Choosing a queue

`Router.route` is called once per send with the caller's options. It expands a `queue` given as a string or a dictionary, then looks up a route for the task name. If a route matches, the route's values are merged under the caller's options, so an explicit `queue=` in the call still wins over the route.

Sources: [celery/app/routes.py:66-72](repo://celery/app/routes.py#L66-L72)

```python
def route(self, options, name, args=(), kwargs=None, task_type=None):
    kwargs = {} if not kwargs else kwargs
    options = self.expand_destination(options)  # expands 'queue'
    if self.routes:
        route = self.lookup_route(name, args, kwargs, options, task_type)
        if route:  # expands 'queue' in route.
            return lpmerge(self.expand_destination(route), options)
    if 'queue' not in options:
        options = lpmerge(self.expand_destination(
            self.app.conf.task_default_queue), options)
    return options
```

Sources: [celery/app/routes.py:66-76](repo://celery/app/routes.py#L66-L76)

When no route matches, the default queue from `task_default_queue` is merged in, but only when the caller's options do not already name a `queue`.
Sources: [celery/app/routes.py:69-76](repo://celery/app/routes.py#L69-L76), [celery/app/base.py:931-932](repo://celery/app/base.py#L931-L932)

`expand_destination` turns a route into a dictionary that always has a `queue` value that is a `Queue` object. A string is looked up in the registry; a name that is not declared raises `QueueNotFound` with a message that names `task_queues`.

Sources: [celery/app/routes.py:78-96](repo://celery/app/routes.py#L78-L96)

## The routes setting

`task_routes` is turned into routers by `prepare`. A dictionary becomes a `MapRoute`, a string is expanded lazily into a router with `expand_router_string`, and any other entry is kept as it is.

Sources: [celery/app/routes.py:114-130](repo://celery/app/routes.py#L114-L130)

`MapRoute` holds two lookups. A key without a wildcard is matched exactly. A key with `*` is compiled to a regular expression with `fnmatch.translate` and kept in an ordered table, so the first pattern that matches wins.

Sources: [celery/app/routes.py:26-40](repo://celery/app/routes.py#L26-L40)

`lookup_route` tries each router in order and returns the first non-empty route. A router may be a plain callable, or an object with a `route_for_task` method from the older API.

Sources: [celery/app/routes.py:98-112](repo://celery/app/routes.py#L98-L112)

## Which queues a worker consumes

A worker starts with the queues in `task_queues` that are not excluded. The `-Q` option of the worker command selects a subset, and `-X` deselects queues. Each name is checked against the registry, so a misspelled name stops the worker with an error at start-up.

Sources: [celery/worker/worker.py:167-181](repo://celery/worker/worker.py#L167-L181)

`select_add` adds a queue to the consume-from map and keeps it there even when a `-Q` subset is selected. When `worker_direct` is set, the worker adds its own direct queue, built by `worker_direct` from the host name, so a message addressed to that host reaches it.

Sources: [celery/app/amqp.py:159-170](repo://celery/app/amqp.py#L159-L170), [celery/worker/worker.py:180-181](repo://celery/worker/worker.py#L180-L181), [celery/utils/nodenames.py:38-50](repo://celery/utils/nodenames.py#L38-L50)

The selection itself is `select` and `deselect` on the registry. `select` replaces the consume-from map with the named queues, and `deselect` removes names from whichever map is active, so the default map is kept when no subset was chosen.

Sources: [celery/app/amqp.py:171-200](repo://celery/app/amqp.py#L171-L200)

## Where the pieces meet

A route can name a queue, an exchange and a routing key, and the publish step turns the chosen queue into an exchange and routing key. For a direct exchange the queue name is the routing key. For other exchanges the queue's own exchange and routing key are used unless the options set them.

Sources: [celery/app/amqp.py:522-549](repo://celery/app/amqp.py#L522-L549)

The delayed-delivery path uses its own exchange for a message with an ETA; see [[Sending a Task Message]] for its conditions. The worker side that receives those messages is in [[Consumer and Message Strategy]].

Sources: [celery/app/base.py:934-958](repo://celery/app/base.py#L934-L958)
