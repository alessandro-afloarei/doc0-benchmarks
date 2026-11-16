---
title: "Worker Startup and Bootsteps"
---
## Overview

A worker is not one long function but a graph of small components called bootsteps. `WorkController` owns a `Blueprint` whose steps (timer, event loop hub, pool, embedded beat, state database, consumer) are ordered by the dependencies each declares. The last step, the consumer, has a blueprint of its own that connects to the broker and subscribes to queues. Splitting the worker this way lets features be switched on by a predicate such as `include_if` instead of by conditionals scattered through the startup code.

Sources: [celery/worker/worker.py:62-87](repo://celery/worker/worker.py#L62-L87), [celery/worker/consumer/consumer.py:172-186](repo://celery/worker/consumer/consumer.py#L172-L186)

This page covers how the blueprint is built, started and stopped. The handling of one message after the consumer has started is in [[Receiving and Executing Tasks]], and the `celery worker` command that creates the controller is in [[Command Line Interface]].

Sources: [celery/worker/worker.py:90-130](repo://celery/worker/worker.py#L90-L130)

## Steps and blueprints

A `Step` is created with the parent object as its argument, which lets it set attributes on the parent (for example `w.hub = None`) at construction time. `include_if(parent)` returns `self.enabled` by default, and `include` calls `create(parent)` only when the predicate passes. `requires` lists steps that must start before it, and a blueprint may have at most one `last` step, which is always started after all others.

Sources: [celery/bootsteps.py:288-343](repo://celery/bootsteps.py#L288-L343)

`StartStopStep` adds the lifecycle. Its `include` stores whatever `create` returned in `self.obj` and appends the step to `parent.steps`; `start`, `stop` and `terminate` forward to that object, and `terminate` falls back to `stop` when the object has no `terminate`. Steps that create nothing (such as `Timer`) never join `parent.steps`, so they take no part in start and stop.

Sources: [celery/bootsteps.py:355-383](repo://celery/bootsteps.py#L355-L383)

`ConsumerStep` is the base for steps that own broker consumers. It requires `celery.worker.consumer:Connection`, opens a channel in `start`, asks `get_consumers(channel)` for consumers and calls `consume()` on each. `stop` cancels them and closes their channels, while `shutdown` closes the channels without cancelling.

Sources: [celery/bootsteps.py:386-415](repo://celery/bootsteps.py#L386-L415)

## Building the dependency order

`Blueprint.apply(parent)` loads every step class (default steps plus any added through `app.steps`), builds a dependency graph, instantiates each class in topological order and calls `include` on each instance. `_firstpass` resolves the dotted names in each `requires` and pulls in steps that were not listed. `_finalize_steps` then adds an edge from the `last` step to every other step so it sorts last, and an unknown step name raises `KeyError('unknown bootstep: ...')`.

Sources: [celery/bootsteps.py:186-212](repo://celery/bootsteps.py#L186-L212), [celery/bootsteps.py:224-256](repo://celery/bootsteps.py#L224-L256)

`WorkController.Blueprint` lists seven default steps, and user steps registered in `app.steps['worker']` are added to them:

Sources: [celery/worker/worker.py:76-87](repo://celery/worker/worker.py#L76-L87), [celery/bootsteps.py:99-107](repo://celery/bootsteps.py#L99-L107)

```python
default_steps = {
    'celery.worker.components:Hub',
    'celery.worker.components:Pool',
    'celery.worker.components:Beat',
    'celery.worker.components:Timer',
    'celery.worker.components:StateDB',
    'celery.worker.components:Consumer',
    'celery.worker.autoscale:WorkerComponent',
}
```

Sources: [celery/worker/worker.py:76-87](repo://celery/worker/worker.py#L76-L87)

| Step | Requires | Included when | What it creates |
| --- | --- | --- | --- |
| `Timer` | none | always | A kombu `Timer` for the event loop, otherwise the pool's own timer class |
| `Hub` | `Timer` | `use_eventloop` | The kombu event loop, with thread primitives replaced by dummy locks |
| `Pool` | `Hub` | always | The pool instance, semaphore and process limits |
| `Beat` | none | `-B` given | An embedded beat service |
| `StateDB` | none | a `statedb` path is set | The persistent revoked-task file, saved at exit |
| `Consumer` | none, `last` | always | The consumer and its prefetch count |
| `WorkerComponent` (autoscale) | `Pool` | `autoscale` is set | The autoscaler thread |

Sources: [celery/worker/components.py:32-60](repo://celery/worker/components.py#L32-L60), [celery/worker/components.py:101-103](repo://celery/worker/components.py#L101-L103), [celery/worker/components.py:181-195](repo://celery/worker/components.py#L181-L195), [celery/worker/components.py:208-226](repo://celery/worker/components.py#L208-L226), [celery/worker/autoscale.py:31-60](repo://celery/worker/autoscale.py#L31-L60)

The `Pool` step reads `autoscale` as `max,min`, sets `min_concurrency` from `concurrency`, picks a thread-based or event-loop based pool, and creates a semaphore with `LaxBoundedSemaphore(procs)` only when the event loop is in use. `Beat` refuses to start with eventlet or gevent pools and raises `ImproperlyConfigured`. The `Consumer` step computes the initial prefetch count as `concurrency * prefetch_multiplier`, using `max_concurrency` when autoscaling.

Sources: [celery/worker/components.py:101-179](repo://celery/worker/components.py#L101-L179), [celery/worker/components.py:181-206](repo://celery/worker/components.py#L181-L206), [celery/worker/components.py:221-246](repo://celery/worker/components.py#L221-L246)

## Constructing and starting the worker

`WorkController.__init__` sets the hostname and start time, calls the loader's `init_worker`, runs `on_before_init`, `setup_defaults` and `on_after_init`, then `setup_instance`. `setup_defaults` resolves each worker option from the explicit argument, falling back to a `worker_*` setting through `app.either`.

Sources: [celery/worker/worker.py:90-100](repo://celery/worker/worker.py#L90-L100), [celery/worker/worker.py:351-411](repo://celery/worker/worker.py#L351-L411)

`setup_instance` applies the `-Q` selection to the app's queues (raising `ImproperlyConfigured` for unknown names, and adding a per-worker queue when `worker_direct` is on), records the task modules to include, defaults `concurrency` to the CPU count, and decides whether to use the event loop: the default environment, a transport that implements asynchronous I/O, and not Windows. It sends `worker_init`, resolves the pool class, creates the blueprint with `on_start`, `on_close` and `on_stopped` callbacks, and calls `blueprint.apply(self, **kwargs)`.

Sources: [celery/worker/worker.py:101-140](repo://celery/worker/worker.py#L101-L140), [celery/worker/worker.py:167-194](repo://celery/worker/worker.py#L167-L194), [celery/worker/worker.py:239-243](repo://celery/worker/worker.py#L239-L243)

`Blueprint.start` sets the state to `RUN`, calls the `on_start` callback and then calls `start` on each step in order. The base `on_start` creates the pidfile lock; the `celery.apps.worker.Worker` subclass sends `celeryd_after_setup`, optionally purges the queues, prints the banner and installs platform tweaks.

Sources: [celery/bootsteps.py:109-117](repo://celery/bootsteps.py#L109-L117), [celery/worker/worker.py:150-153](repo://celery/worker/worker.py#L150-L153), [celery/apps/worker.py:128-146](repo://celery/apps/worker.py#L128-L146)

`WorkController.start` turns the failures of the blueprint into exit codes: `WorkerTerminate` calls `terminate`, any other exception is logged as critical and calls `stop` with `EX_FAILURE`, and `SystemExit` and `KeyboardInterrupt` call `stop` with the exit code or failure.

Sources: [celery/worker/worker.py:201-213](repo://celery/worker/worker.py#L201-L213)

## The consumer blueprint

The consumer step creates a `Consumer`, which has its own blueprint with ten default steps. Their `requires` declarations define the order, and `Evloop` is `last`:

Sources: [celery/worker/consumer/consumer.py:172-186](repo://celery/worker/consumer/consumer.py#L172-L186)

| Step | Requires | Role |
| --- | --- | --- |
| `Connection` | none | Opens the broker connection with `c.connect()` |
| `Mingle` | `Events` | Asks other workers for their clock and revoked ids |
| `Events` | `Connection` | Creates the event dispatcher |
| `Gossip` | `Mingle` | Consumes worker events for liveness and elections |
| `Heart` | `Events` | Sends `worker-heartbeat` events |
| `Control` | `Tasks` | Listens for remote control commands |
| `Tasks` | `Mingle` | Sets prefetch and starts the task consumer |
| `DelayedDelivery` | `Tasks` | Declares native delayed delivery exchanges |
| `Evloop` | none, `last` | Runs the message loop |
| `Agent` | `Connection` | Optional: starts the class named by `worker_agent` when set |

Sources: [celery/worker/consumer/consumer.py:172-186](repo://celery/worker/consumer/consumer.py#L172-L186), [celery/worker/consumer/connection.py:13-45](repo://celery/worker/consumer/connection.py#L13-L45), [celery/worker/consumer/events.py:15-71](repo://celery/worker/consumer/events.py#L15-L71), [celery/worker/consumer/heart.py:8-36](repo://celery/worker/consumer/heart.py#L8-L36), [celery/worker/consumer/control.py:11-33](repo://celery/worker/consumer/control.py#L11-L33), [celery/worker/consumer/delayed_delivery.py:55-64](repo://celery/worker/consumer/delayed_delivery.py#L55-L64), [celery/worker/consumer/agent.py:1-21](repo://celery/worker/consumer/agent.py#L1-L21)

`Tasks.start` calls `c.update_strategies()` to build a handler per registered task, then sets the initial QoS with `basic_qos`. The QoS is global unless the broker's QoS semantics match the specification, or quorum queues are detected, in which case global QoS is turned off. It creates the task consumer from `app.amqp.TaskConsumer` and a `QoS` object that can later change the prefetch count, bounded by `worker_eta_task_limit`. With `worker_disable_prefetch` on a Redis broker, it wraps `can_consume` so no more messages are fetched once the number of reserved requests reaches the concurrency.

Sources: [celery/worker/consumer/tasks.py:20-124](repo://celery/worker/consumer/tasks.py#L20-L124)

`Control` is included only when `worker_enable_remote_control` is on and the broker supports fanout exchanges; see [[Remote Control and Revoking]]. `Mingle`, `Gossip` and `Heart` are described in [[Events and Monitoring]]. `DelayedDelivery` is included only when quorum queues are detected on the write connection.

Sources: [celery/worker/consumer/control.py:11-33](repo://celery/worker/consumer/control.py#L11-L33), [celery/worker/consumer/delayed_delivery.py:55-64](repo://celery/worker/consumer/delayed_delivery.py#L55-L64)

`Evloop.start` replaces the QoS mutex with a dummy lock and calls `c.loop(*c.loop_args())`, which passes the connection, task consumer, blueprint, hub, QoS, heartbeat settings and clock to either `asynloop` or `synloop`.

Sources: [celery/worker/consumer/consumer.py:857-872](repo://celery/worker/consumer/consumer.py#L857-L872), [celery/worker/consumer/consumer.py:511-514](repo://celery/worker/consumer/consumer.py#L511-L514)

## Reconnecting after a connection loss

`Consumer.start` loops while the blueprint has not been stopped. Each iteration counts a restart, and `restart_state(maxR=5, maxT=1)` logs a critical error and sleeps for a second when restarts come too fast. It then runs `blueprint.start(self)` inside a `try`, treating connection errors, and channel errors when `broker_channel_error_retry` is on, as recoverable.

Sources: [celery/worker/consumer/consumer.py:366-392](repo://celery/worker/consumer/consumer.py#L366-L392)

When a recoverable error occurs, the setting that governs retrying depends on timing: `broker_connection_retry_on_startup` for a failure before the first successful start (if it is not `None`), otherwise `broker_connection_retry`. If the chosen setting is off, the worker logs that it is shutting down and raises `WorkerShutdown(1)`. A too-many-open-files error raises `WorkerTerminate(1)`. Otherwise the consumer calls `on_close` and `blueprint.restart(self)`.

Sources: [celery/worker/consumer/consumer.py:392-418](repo://celery/worker/consumer/consumer.py#L392-L418), [celery/worker/consumer/consumer.py:532-547](repo://celery/worker/consumer/consumer.py#L532-L547)

After a loss on an established connection, `on_connection_error_after_connected` closes the broken connection, and when `worker_cancel_long_running_tasks_on_connection_loss` is on it cancels active requests that use late acknowledgement and are not yet acknowledged, because their acks can no longer be delivered. With `worker_enable_prefetch_count_reduction` and global QoS, it lowers the initial prefetch count by the number of active tasks so the reconnected worker does not over-fetch, and restores it gradually as tasks complete.

Sources: [celery/worker/consumer/consumer.py:419-491](repo://celery/worker/consumer/consumer.py#L419-L491)

## Shutdown

`WorkController.stop` is the warm shutdown: if the blueprint is running it closes the consumer and calls `_shutdown(warm=True)`, then sends `worker_shutdown`. `terminate` is the cold shutdown, calling `_shutdown(warm=False)`. Both run `blueprint.stop(self, terminate=...)` followed by `blueprint.join()` under a short default socket timeout.

Sources: [celery/worker/worker.py:244-268](repo://celery/worker/worker.py#L244-L268)

`Blueprint.stop` returns at once if the blueprint is already closing, and if it was never fully started it just marks itself terminated. Otherwise it calls `close` on the steps, then `stop` or `terminate` on them in reverse order with errors logged instead of raised, then runs `on_stopped` and sets `shutdown_complete`. The worker's `on_stopped` stops the timer, shuts down the consumer and releases the pidfile.

Sources: [celery/bootsteps.py:128-185](repo://celery/bootsteps.py#L128-L185), [celery/worker/worker.py:160-166](repo://celery/worker/worker.py#L160-L166)
