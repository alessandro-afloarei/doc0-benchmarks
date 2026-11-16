---
title: "Worker Lifecycle and Concurrency"
---
## Overview

A worker turns broker deliveries from [[Task Publishing and Routing]] into requests submitted to an execution pool. `WorkController` owns a worker blueprint; its consumer owns a second blueprint for broker connection, events, control and task consumption. Task registration and module loading belong to [[Applications and Configuration]]. This page follows startup, dispatch, connection recovery and shutdown; task outcomes and acknowledgement policy belong to [[Task Execution and Retries]].

Sources: [celery/worker/worker.py:76-99](repo://celery/worker/worker.py#L76-L99), [celery/worker/consumer/consumer.py:171-189](repo://celery/worker/consumer/consumer.py#L171-L189), [celery/worker/worker.py:223-231](repo://celery/worker/worker.py#L223-L231)

## Build and start the worker

The controller initializes the application loader, runs initialization hooks and resolves worker defaults. Instance setup selects consumed and excluded queues, imports includes and chooses concurrency from the CPU count when it was not supplied, falling back to two if the platform cannot report it. It obtains a read-connection description without establishing that connection, then chooses event-loop behavior and sends `worker_init`.

Sources: [celery/worker/worker.py:90-127](repo://celery/worker/worker.py#L90-L127)

The pool name resolves to an implementation before the worker blueprint is applied. Default components include the hub, pool, timer, consumer, optional beat, state database and autoscaler. Application-provided worker steps participate through `app.steps['worker']`. A blueprint resolves dependency order and starts the resulting steps; the controller's `start` handles termination, keyboard interruption and unrecoverable startup errors around that lifecycle.

Sources: [celery/worker/worker.py:76-88](repo://celery/worker/worker.py#L76-L88), [celery/worker/worker.py:129-139](repo://celery/worker/worker.py#L129-L139), [celery/bootsteps.py:110-128](repo://celery/bootsteps.py#L110-L128), [celery/bootsteps.py:183-216](repo://celery/bootsteps.py#L183-L216), [celery/worker/worker.py:201-212](repo://celery/worker/worker.py#L201-L212)

## Consume and dispatch deliveries

The consumer blueprint includes connection, mingle, events, gossip, heartbeat, remote control, tasks and the event loop. Its task bootstep updates per-task strategies before creating the task consumer. It sets initial broker QoS, records whether QoS is global and installs a `QoS` object with the optional ETA task limit. This connects broker flow control to worker-side reservation rather than simply limiting the number of Python task calls.

Sources: [celery/worker/consumer/consumer.py:171-186](repo://celery/worker/consumer/consumer.py#L171-L186), [celery/worker/consumer/tasks.py:29-57](repo://celery/worker/consumer/tasks.py#L29-L57)

Protocol v2 dispatch looks up the task name in headers and can defer body deserialization to the pool; the compatibility path decodes protocol v1 in the consumer. A missing strategy routes to unknown-task handling. Otherwise the consumer supplies acknowledgement and rejection promises to the strategy. Invalid tasks and disallowed content use the invalid-task path, while decode errors are logged and acknowledged to prevent a repeated decode-failure loop.

Sources: [celery/worker/consumer/consumer.py:731-786](repo://celery/worker/consumer/consumer.py#L731-L786), [celery/worker/consumer/consumer.py:516-530](repo://celery/worker/consumer/consumer.py#L516-L530)

The default strategy creates a request, checks revocation and expiry, emits receipt signals/events, and handles ETA and task-specific rate-limit buckets. Immediate eligible work is reserved and passed to the controller. The controller calls `execute_using_pool`, which supplies trace execution and acceptance, timeout, success and failure callbacks to the selected pool. [[Task Execution and Retries]] follows those callbacks after submission.

Sources: [celery/worker/strategy.py:145-208](repo://celery/worker/strategy.py#L145-L208), [celery/worker/worker.py:223-231](repo://celery/worker/worker.py#L223-L231), [celery/worker/request.py:341-372](repo://celery/worker/request.py#L341-L372)

## Choose an execution pool

| Pool | Implemented execution model | Distinguishing behavior |
| --- | --- | --- |
| `prefork`, `processes` | Multiprocessing pool | Creates child processes with an initializer and enables timeouts; exposes grow, shrink and termination methods |
| `threads` | `ThreadPoolExecutor` | Submits through `apply_target`; shutdown cancels pending futures and waits for the executor |
| `solo` | Inline single-thread execution | Uses `apply_target` directly and fixes the pool limit at one |
| `gevent` | Gevent greenlet pool | Declares green execution, starts a bounded pool and joins it during stop |
| `eventlet` | Eventlet `GreenPool` | Declares green execution, emits pool lifecycle signals and waits for greenlets during stop |

Sources: [celery/concurrency/__init__.py:11-24](repo://celery/concurrency/__init__.py#L11-L24), [celery/concurrency/prefork.py:95-125](repo://celery/concurrency/prefork.py#L95-L125), [celery/concurrency/thread.py:30-56](repo://celery/concurrency/thread.py#L30-L56), [celery/concurrency/solo.py:11-30](repo://celery/concurrency/solo.py#L11-L30), [celery/concurrency/gevent.py:85-114](repo://celery/concurrency/gevent.py#L85-L114), [celery/concurrency/eventlet.py:88-120](repo://celery/concurrency/eventlet.py#L88-L120)

The pool factory also supports an external implementation through `CELERY_CUSTOM_WORKER_POOL` and `--pool custom`; its documented contract is `BasePool`. Pool implementations expose different timeout, signal and execution behavior, so inspect the selected implementation when relying on those features. The CLI's examples include `--concurrency`, queue selection through `-Q`, eventlet selection with `-P` and autoscaling bounds.

Sources: [celery/concurrency/__init__.py:26-43](repo://celery/concurrency/__init__.py#L26-L43), [celery/bin/worker.py:315-321](repo://celery/bin/worker.py#L315-L321), [celery/concurrency/thread.py:34-35](repo://celery/concurrency/thread.py#L34-L35), [celery/concurrency/gevent.py:116-123](repo://celery/concurrency/gevent.py#L116-L123)

## Recover broker connections and prefetch

The consumer restart loop distinguishes startup connection failures from later loss and selects `broker_connection_retry_on_startup` or `broker_connection_retry` accordingly. When retry is disabled, it raises `WorkerShutdown`; when recovery is allowed, it closes consumer state and restarts the blueprint. Cleanup of a broken connection uses a bounded collection socket timeout so cleanup I/O cannot block reconnection indefinitely, then explicitly closes the old connection before restart.

Sources: [celery/worker/consumer/consumer.py:366-438](repo://celery/worker/consumer/consumer.py#L366-L438)

With `worker_cancel_long_running_tasks_on_connection_loss`, recovery cancels active late-acknowledged tasks whose deliveries have not been acknowledged. Prefetch reduction and restoration also track reconnection state. Separately, `worker_disable_prefetch` is implemented only for Redis brokers: other transports log a warning and ignore it. The Redis hook stops consumption when reserved requests reach the autoscaler's maximum concurrency or pool size.

Sources: [celery/worker/consumer/consumer.py:440-480](repo://celery/worker/consumer/consumer.py#L440-L480), [celery/worker/consumer/consumer.py:788-799](repo://celery/worker/consumer/consumer.py#L788-L799), [celery/worker/consumer/tasks.py:59-83](repo://celery/worker/consumer/tasks.py#L59-L83)

## Stop and extend the lifecycle

Warm shutdown closes consumption and stops the blueprint gracefully. Cold shutdown requests termination instead. Both use the blueprint stop/join boundary when initialized, with signal-safety checks around pool interaction. The optional soft-shutdown wait is enabled by a positive `worker_soft_shutdown_timeout` and active work; `worker_enable_soft_shutdown_on_idle` also permits the wait without active requests. These mechanisms govern the worker lifecycle, while delivery disposition remains subject to [[Task Execution and Retries]].

Sources: [celery/worker/worker.py:244-267](repo://celery/worker/worker.py#L244-L267), [celery/worker/worker.py:412-435](repo://celery/worker/worker.py#L412-L435)

Custom worker components enter through blueprint steps and their declared dependencies. Operational changes can also arrive through the consumer's control component; [[Monitoring and Remote Control]] covers that broker-mediated interface. An embedded scheduler is another worker component, but its scheduling state and publication loop are explained separately in [[Periodic Scheduling]].

Sources: [celery/bootsteps.py:183-216](repo://celery/bootsteps.py#L183-L216), [celery/worker/worker.py:80-87](repo://celery/worker/worker.py#L80-L87), [celery/worker/consumer/consumer.py:175-186](repo://celery/worker/consumer/consumer.py#L175-L186)
