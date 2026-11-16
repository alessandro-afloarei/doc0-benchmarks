---
title: "Worker Startup and Bootsteps"
---
## Overview

`celery worker` starts a `WorkController`. The controller does no work itself: it holds a blueprint of bootsteps, and each step starts one service, such as the pool, the timer, the beat embed or the consumer. The order of the steps comes from the `requires` declarations, not from the order of the list. This page follows the start-up from the program class to the first consumed message. The consumer's message loop is in [[Consumer and Message Strategy]] and the pool's worker processes are in [[Concurrency Pools]].

Sources: [celery/worker/worker.py:63-89](repo://celery/worker/worker.py#L63-L89), [celery/bootsteps.py:74-110](repo://celery/bootsteps.py#L74-L110)

## The worker program

The command-line worker is `Worker`, a subclass of `WorkController`. Before the rest of the set-up runs, its `on_before_init` hook stores the quiet flag and calls `setup_worker_optimizations`, which is the point where the tracer is prepared for this process.

Sources: [celery/apps/worker.py:91-96](repo://celery/apps/worker.py#L91-L96), [celery/app/trace.py:804-810](repo://celery/app/trace.py#L804-L810)

`WorkController.__init__` does four things in order. It sets the hostname, asks the loader to initialize the worker, runs `setup_defaults` and then `setup_instance`. The `on_before_init` and `on_after_init` hooks surround the first two of these.

Sources: [celery/worker/worker.py:90-99](repo://celery/worker/worker.py#L90-L99)

## Instance set-up

`setup_instance` sets the queues and the include list first. The queues come from `setup_queues`, which applies `-Q` and `-X` to the app's queue registry; see [[Routing and Queues]].

Sources: [celery/worker/worker.py:101-106](repo://celery/worker/worker.py#L101-L106)

Sources: [celery/worker/worker.py:101-106](repo://celery/worker/worker.py#L101-L106), [celery/worker/worker.py:167-181](repo://celery/worker/worker.py#L167-L181)

When no concurrency was given, the worker uses the CPU count, or 2 when the platform cannot report one. The event-loop choice comes from the runtime environment and the broker transport, unless the caller set it. The `worker_init` signal is sent before any step is built, so a receiver sees the controller with its options set.

Sources: [celery/worker/worker.py:108-127](repo://celery/worker/worker.py#L108-L127)

Sources: [celery/worker/worker.py:108-127](repo://celery/worker/worker.py#L108-L127)

The pool class is resolved by name through the concurrency registry, and the blueprint is built from the app's `worker` steps. The `on_start`, `on_close` and `on_stopped` hooks are passed in, so the controller can run its own code around the steps.

Sources: [celery/worker/worker.py:129-139](repo://celery/worker/worker.py#L129-L139)

```python
self.pool_cls = _concurrency.get_implementation(self.pool_cls)
self.steps = []
self.on_init_blueprint()
self.blueprint = self.Blueprint(
    steps=self.app.steps['worker'],
    on_start=self.on_start,
    on_close=self.on_close,
    on_stopped=self.on_stopped,
)
self.blueprint.apply(self, **kwargs)
```

Sources: [celery/worker/worker.py:129-139](repo://celery/worker/worker.py#L129-L139)

## Default steps

The worker blueprint has seven default steps: `Hub`, `Pool`, `Beat`, `Timer`, `StateDB`, `Consumer` and the autoscaler component. Each is named by its class path, and the app's `steps` mapping can add more, as described in [[Registering Custom Components]].

Sources: [celery/worker/worker.py:76-88](repo://celery/worker/worker.py#L76-L88)

Each step names what it needs in `requires`. `Hub` requires `Timer`, `Pool` requires `Hub`, and the autoscaler component requires `Pool`. The consumer is marked `last`, so it starts after everything it depends on.

Sources: [celery/worker/components.py:56-60](repo://celery/worker/components.py#L56-L60), [celery/worker/components.py:101-116](repo://celery/worker/components.py#L101-L116), [celery/worker/autoscale.py:31-37](repo://celery/worker/autoscale.py#L31-L37), [celery/worker/components.py:221-225](repo://celery/worker/components.py#L221-L225)

`Beat` is a conditional step. It runs only when the beat option asks for an embedded beat process.

Sources: [celery/worker/components.py:181-189](repo://celery/worker/components.py#L181-L189)

`Blueprint.apply` resolves each step's `requires` from its class path, adds the dependencies that were not listed, and then builds a dependency graph. The order it returns is the order the steps start in.

Sources: [celery/bootsteps.py:224-240](repo://celery/bootsteps.py#L224-L240), [celery/bootsteps.py:186-200](repo://celery/bootsteps.py#L186-L200)

## Starting

`WorkController.start` calls `blueprint.start(self)`. `Blueprint.start` sets its state to `RUN`, calls `on_start`, and starts each step in turn, recording how many started so that a failure can stop the ones that did.

Sources: [celery/worker/worker.py:201-212](repo://celery/worker/worker.py#L201-L212), [celery/bootsteps.py:109-118](repo://celery/bootsteps.py#L109-L118)

`on_start` writes the pid file when one was given, taking the lock with `create_pidlock`.

Sources: [celery/worker/worker.py:150-153](repo://celery/worker/worker.py#L150-L153)

An error during start is handled in `start`. A `WorkerTerminate` makes the worker terminate, and any other exception logs a critical message and stops the worker with `EX_FAILURE`.

Sources: [celery/worker/worker.py:201-212](repo://celery/worker/worker.py#L201-L212)

The `worker_init` signal is sent before the blueprint is built. The `on_consumer_ready` hook is called once the consumer is ready, and a subclass can override it.

Sources: [celery/worker/worker.py:125-128](repo://celery/worker/worker.py#L125-L128), [celery/worker/worker.py:154-156](repo://celery/worker/worker.py#L154-L156), [celery/signals.py:108-110](repo://celery/signals.py#L108-L110)

## Stopping

`stop` and `close` run the blueprint in the other direction. `Blueprint.stop` and `Blueprint.restart` call a named method on each step through `send_all`, and `signal_consumer_close` closes the consumer on its own.

Sources: [celery/bootsteps.py:133-160](repo://celery/bootsteps.py#L133-L160), [celery/worker/worker.py:233-237](repo://celery/worker/worker.py#L233-L237)
