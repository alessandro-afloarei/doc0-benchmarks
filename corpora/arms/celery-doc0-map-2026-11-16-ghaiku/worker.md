---
title: "Worker Startup"
---
## Overview

A worker is a `WorkController` whose parts are bootsteps: small objects that start in dependency order. The `celery worker` command builds the `Worker` application class, which adds signal handling and output to the controller, and the controller starts a blueprint of steps. Two blueprints do the work: the worker's own steps (event loop, pool, timer, consumer) and, inside the consumer, the steps that connect to the broker and handle messages. The message path after startup is in [[Task Execution]], and the pool types are in [[Concurrency Pools]].

Sources: [celery/worker/worker.py:63-74](repo://celery/worker/worker.py#L63-L74)

Sources: [celery/apps/worker.py:91-96](repo://celery/apps/worker.py#L91-L96)

Sources: [celery/bootsteps.py:355-366](repo://celery/bootsteps.py#L355-L366)

## Entry point

The `worker` command is a click command. After it drops privileges when a uid or gid was given, it builds the app's `Worker` with the hostname, pool class, log level, pidfile and state file, and calls its `start`. `Worker` is the class in `apps/worker.py`, a `WorkController` subclass that adds the process signal handling and output.

Sources: [celery/bin/worker.py:307-313](repo://celery/bin/worker.py#L307-L313)

Sources: [celery/bin/worker.py:355-367](repo://celery/bin/worker.py#L355-L367)

Sources: [celery/apps/worker.py:91-96](repo://celery/apps/worker.py#L91-L96)

`WorkController.start` runs the blueprint's `start` with the controller as the parent object.

Sources: [celery/worker/worker.py:201-204](repo://celery/worker/worker.py#L201-L204)

## The worker blueprint

The controller's blueprint has seven default steps: `Hub`, `Pool`, `Beat`, `Timer`, `StateDB`, `Consumer` and the autoscaler. Each step names the steps it requires, so the blueprint starts `Timer` before `Hub` and `Hub` before `Pool`; the consumer starts last.

Sources: [celery/worker/worker.py:76-88](repo://celery/worker/worker.py#L76-L88)

`Hub` requires the timer and holds the event loop. `Pool` requires the hub and creates the task pool that runs the tasks. The pool class is resolved from the pool setting when the controller is set up, and `concurrency` is the number of workers the pool starts.

Sources: [celery/worker/components.py:56-70](repo://celery/worker/components.py#L56-L70)

Sources: [celery/worker/components.py:101-120](repo://celery/worker/components.py#L101-L120)

Sources: [celery/worker/worker.py:109-131](repo://celery/worker/worker.py#L109-L131)

`Beat` is a step that does nothing unless the `beat` argument is set; when it is, the worker embeds a beat service.

Sources: [celery/worker/components.py:181-196](repo://celery/worker/components.py#L181-L196)

`Consumer` is marked `last`. Its `create` method builds the consumer with the process-task function, the prefetch count, the pool and the timer. The prefetch count is the concurrency (or the autoscale maximum) times the prefetch multiplier.

Sources: [celery/worker/components.py:221-244](repo://celery/worker/components.py#L221-L244)

## Start and the on_start hook

`Blueprint.start` sets the state to running, calls the controller's `on_start` callback, and then starts each step in the order the graph gives.

Sources: [celery/bootsteps.py:109-118](repo://celery/bootsteps.py#L109-L118)

`WorkController.on_start` creates the pidlock when a pidfile was given. The `Worker` subclass extends it: after the base call it sends `celeryd_after_setup`, which lets a program change the queues after `-Q` is applied, and it purges messages when `--purge` is set.

Sources: [celery/worker/worker.py:150-153](repo://celery/worker/worker.py#L150-L153)

Sources: [celery/apps/worker.py:128-141](repo://celery/apps/worker.py#L128-L141)

## The consumer blueprint

The consumer has its own blueprint of steps: `Connection`, `Mingle`, `Events`, `Gossip`, `Heart`, `Control`, `Tasks`, `DelayedDelivery`, `Evloop` and `Agent`. `Connection` is the first step listed, and `Evloop` is always started last, as its docstring says, because it runs the loop that drives the others.

Sources: [celery/worker/consumer/consumer.py:171-186](repo://celery/worker/consumer/consumer.py#L171-L186)

Sources: [celery/worker/consumer/consumer.py:857-862](repo://celery/worker/consumer/consumer.py#L857-L862)

`Consumer.start` is the outer loop. It repeats while the blueprint is not in a stop state, checks for a pending shutdown, counts restarts, and applies `broker_channel_error_retry` to decide which connection errors may be recovered from.

Sources: [celery/worker/consumer/consumer.py:366-380](repo://celery/worker/consumer/consumer.py#L366-L380)

`Evloop.start` patches the event loop and then calls the consumer's `loop` with the loop arguments. The loop itself is `asynloop`, a non-blocking loop that reads from the broker and the pool until the consumer stops.

Sources: [celery/worker/consumer/consumer.py:857-869](repo://celery/worker/consumer/consumer.py#L857-L869)

Sources: [celery/worker/loops.py:50-54](repo://celery/worker/loops.py#L50-L54)

## Restarts and shutdown

A restart is counted by the same loop. Restarts are limited by a frequency check: when the limit is exceeded the worker logs a critical message and sleeps one second before it tries again.

Sources: [celery/worker/consumer/consumer.py:366-378](repo://celery/worker/consumer/consumer.py#L366-L378)

Shutdown signals are installed by `apps/worker.py` through `_shutdown_handler`, which takes the signal, the kind of shutdown and an optional callback. The `SIGINT` handler passes `on_SIGINT` as that callback: after the first Ctrl+C it installs the hard handler for the next one.

Sources: [celery/apps/worker.py:288-300](repo://celery/apps/worker.py#L288-L300)

Sources: [celery/apps/worker.py:453-459](repo://celery/apps/worker.py#L453-L459)
