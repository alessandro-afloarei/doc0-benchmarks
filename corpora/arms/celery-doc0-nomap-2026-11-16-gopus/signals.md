---
title: "Signals"
---
## Overview

Signals let code react to things Celery does without subclassing anything: a function connected to `task_failure` runs whenever any task fails, one connected to `worker_process_init` runs in every new pool process. Celery carries its own signal implementation in `celery/utils/dispatch/signal.py`, adapted from Django's, and declares the signals it sends in `celery/signals.py`. This page explains how connecting and sending work and lists every signal with where in the code it is sent. The app also has per-instance signals (`on_configure`, `on_after_configure`, `on_after_finalize`, `on_after_fork`) built on the same class ([[The Celery Application]]).

Sources: [celery/signals.py:1-28](repo://celery/signals.py#L1-L28), [celery/utils/dispatch/signal.py:73-102](repo://celery/utils/dispatch/signal.py#L73-L102), [celery/app/base.py:420-430](repo://celery/app/base.py#L420-L430)

## Connecting receivers

`signal.connect(receiver, sender=None, weak=True, dispatch_uid=None, retry=False)` can be called directly or used as a decorator, with or without arguments.

Sources: [celery/utils/dispatch/signal.py:110-186](repo://celery/utils/dispatch/signal.py#L110-L186)

```python
from celery.signals import task_failure

@task_failure.connect(sender='proj.tasks.add')
def on_add_failed(sender=None, task_id=None, exception=None, **kwargs):
    ...
```

Sources: [celery/utils/dispatch/signal.py:110-186](repo://celery/utils/dispatch/signal.py#L110-L186)

The rules enforced by `_connect_signal`:

Sources: [celery/utils/dispatch/signal.py:188-216](repo://celery/utils/dispatch/signal.py#L188-L216)

- A receiver must be callable and accept `**kwargs`, otherwise `ValueError` is raised; senders may add arguments in later versions.
- With `weak=True` (the default) only a weak reference is kept, using `WeakMethod` for bound methods, and the receiver disappears when it is garbage-collected. A receiver defined inside a function therefore needs `weak=False`.
- A receiver is stored under a key built from `dispatch_uid` (or the receiver's id) and the sender's id, and connecting the same key twice has no effect, so `dispatch_uid` prevents duplicate registration when a module is imported twice.
- When `sender` is a `PromiseProxy`, such as a task returned by `@app.task` before finalization, connection is deferred until the proxy is evaluated.
- With `retry=True` the receiver is wrapped to retry with `retry_over_time` on any exception, logging each attempt; it is held strongly.

Sources: [celery/utils/dispatch/signal.py:21-62](repo://celery/utils/dispatch/signal.py#L21-L62), [celery/utils/dispatch/signal.py:144-186](repo://celery/utils/dispatch/signal.py#L144-L186)

`disconnect(receiver, sender, dispatch_uid)` removes the matching key and returns whether something was removed; passing `weak` only triggers a deprecation warning.

Sources: [celery/utils/dispatch/signal.py:218-253](repo://celery/utils/dispatch/signal.py#L218-L253)

## Sending

`send(sender, **named)` calls every live receiver whose sender key is `None` or the sender, with `signal=self` and `sender=sender` added. An exception in a receiver is logged ("Signal handler ... raised") and returned in the result list instead of propagating; `send_robust` is the same method, kept for Django compatibility. The return value is a list of `(receiver, response)` pairs.

Sources: [celery/utils/dispatch/signal.py:258-290](repo://celery/utils/dispatch/signal.py#L258-L290), [celery/utils/dispatch/signal.py:303-340](repo://celery/utils/dispatch/signal.py#L303-L340)

Because errors do not propagate, a caller that cares must inspect the responses. `import_default_modules` does exactly that for `import_modules`, re-raising any exception a receiver returned, since the comment notes logging is not yet set up and the error would be silenced.

Sources: [celery/loaders/base.py:97-105](repo://celery/loaders/base.py#L97-L105)

Dead weak references are not removed during garbage collection, which could happen while the lock is held; `_remove_receiver` only sets a flag and the next `connect`, `disconnect` or send clears them. With `use_caching`, receivers are cached per sender and a sender with none is marked `NO_RECEIVERS`. Many hot paths in Celery check `signal.receivers` first and skip `send` entirely when nobody is connected.

Sources: [celery/utils/dispatch/signal.py:292-350](repo://celery/utils/dispatch/signal.py#L292-L350), [celery/app/trace.py:400-405](repo://celery/app/trace.py#L400-L405), [celery/app/amqp.py:491-499](repo://celery/app/amqp.py#L491-L499)

## Task signals

| Signal | Sender | Arguments | Sent from |
| --- | --- | --- | --- |
| `before_task_publish` | task name | `body`, `exchange`, `routing_key`, `headers`, `properties`, `declare`, `retry_policy` | client, before publishing |
| `after_task_publish` | task name | `body`, `headers`, `exchange`, `routing_key` | client, after publishing |
| `task_sent` (deprecated) | task name | `task_id`, `task`, `args`, `kwargs`, `eta`, `taskset` | client, after publishing |
| `task_received` | consumer | `request` | worker strategy, on receipt |
| `task_prerun` | task | `task_id`, `task`, `args`, `kwargs` | tracer, before the body |
| `task_success` | task | `result` | tracer, after storing success |
| `task_retry` | task | `request`, `reason`, `einfo` | tracer on `Retry`; request on cancel |
| `task_failure` | task | `task_id`, `exception`, `args`, `kwargs`, `traceback`, `einfo` | tracer; request on hard timeout, `Reject`, lost worker |
| `task_postrun` | task | `task_id`, `task`, `args`, `kwargs`, `retval`, `state` | tracer, always at the end |
| `task_internal_error` | task | `task_id`, `args`, `kwargs`, `request`, `exception`, `traceback`, `einfo` | tracer, on an error in Celery itself |
| `task_revoked` | task | `request`, `terminated`, `signum`, `expired` | request, on revoke or expiry |
| `task_rejected` | consumer | `message`, `exc` | consumer, unknown or invalid message |
| `task_unknown` | consumer | `message`, `exc`, `name`, `id` | consumer, unregistered task name |

Sources: [celery/signals.py:30-94](repo://celery/signals.py#L30-L94), [celery/app/amqp.py:557-590](repo://celery/app/amqp.py#L557-L590), [celery/worker/strategy.py:165-165](repo://celery/worker/strategy.py#L165-L165), [celery/app/trace.py:568-664](repo://celery/app/trace.py#L568-L664), [celery/app/trace.py:212-282](repo://celery/app/trace.py#L212-L282), [celery/worker/request.py:439-470](repo://celery/worker/request.py#L439-L470), [celery/worker/consumer/consumer.py:672-714](repo://celery/worker/consumer/consumer.py#L672-L714)

Task signals sent in the worker run in the process executing the task (a pool child for prefork), while `before_task_publish` and `after_task_publish` run in whatever process sends the task. The `task_*` sender is the task instance, so `connect(sender=...)` can filter by task.

Sources: [celery/app/trace.py:568-574](repo://celery/app/trace.py#L568-L574), [celery/app/amqp.py:557-574](repo://celery/app/amqp.py#L557-L574)

## Worker signals

| Signal | Sender | When |
| --- | --- | --- |
| `celeryd_init` | hostname | `celery worker` starting, before the worker is built; receives `instance`, `conf`, `options` |
| `celeryd_after_setup` | hostname | after queues are set up, before the consumer starts; receives `instance`, `conf` |
| `import_modules` | app | the loader is about to import task modules |
| `worker_init` | WorkController | before the bootsteps are created |
| `worker_before_create_process` | pool | prefork, before each child process is created |
| `worker_process_init` | `None` | in each new pool process (and in solo) |
| `worker_process_shutdown` | `None` | when a pool process exits; receives `pid`, `exitcode` |
| `worker_ready` | consumer | the consumer is ready to receive tasks |
| `heartbeat_sent` | Heart | each `worker-heartbeat` event |
| `worker_shutting_down` | hostname | a shutdown signal arrived; receives `sig`, `how`, `exitcode` |
| `worker_shutdown` | WorkController | the worker is stopping |

Sources: [celery/signals.py:96-115](repo://celery/signals.py#L96-L115), [celery/apps/worker.py:94-104](repo://celery/apps/worker.py#L94-L104), [celery/apps/worker.py:128-136](repo://celery/apps/worker.py#L128-L136), [celery/apps/worker.py:180-182](repo://celery/apps/worker.py#L180-L182), [celery/apps/worker.py:301-313](repo://celery/apps/worker.py#L301-L313), [celery/worker/worker.py:127-127](repo://celery/worker/worker.py#L127-L127), [celery/worker/worker.py:198-199](repo://celery/worker/worker.py#L198-L199), [celery/concurrency/prefork.py:82-92](repo://celery/concurrency/prefork.py#L82-L92), [celery/concurrency/asynpool.py:490-493](repo://celery/concurrency/asynpool.py#L490-L493), [celery/worker/heartbeat.py:33-46](repo://celery/worker/heartbeat.py#L33-L46)

`celeryd_init` is the place for per-node configuration: its sender is the node name, so `connect(sender='worker1@host')` configures one worker. `worker_process_init` is where per-process resources such as database connections should be opened, since a prefork child must not reuse its parent's sockets.

Sources: [celery/apps/worker.py:96-103](repo://celery/apps/worker.py#L96-L103), [celery/concurrency/prefork.py:40-82](repo://celery/concurrency/prefork.py#L40-L82)

## Beat, logging, eventlet and CLI signals

| Signal | When |
| --- | --- |
| `beat_init` | the beat service starts |
| `beat_embedded_init` | beat starts embedded in a worker process |
| `setup_logging` | before Celery configures logging; if any receiver is connected, Celery leaves logging alone |
| `after_setup_logger` | after the root logger is configured; receives `logger`, `loglevel`, `logfile`, `format`, `colorize` |
| `after_setup_task_logger` | after the task logger is configured |
| `eventlet_pool_started`, `eventlet_pool_preshutdown`, `eventlet_pool_postshutdown` | eventlet pool lifecycle |
| `eventlet_pool_apply` | eventlet pool spawning a task; receives `target`, `args`, `kwargs` |
| `user_preload_options` | after the CLI parsed custom preload options; receives `app`, `options` |

Sources: [celery/signals.py:117-154](repo://celery/signals.py#L117-L154), [celery/beat.py:633-641](repo://celery/beat.py#L633-L641), [celery/app/log.py:95-130](repo://celery/app/log.py#L95-L130), [celery/app/log.py:170-180](repo://celery/app/log.py#L170-L180), [celery/concurrency/eventlet.py:110-122](repo://celery/concurrency/eventlet.py#L110-L122), [celery/bin/base.py:150-158](repo://celery/bin/base.py#L150-L158)

How the logging signals interact with Celery's own setup is described in [[Logging]].

Sources: [celery/app/log.py:95-130](repo://celery/app/log.py#L95-L130)
