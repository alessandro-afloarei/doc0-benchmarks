---
title: "Signals"
---
## Overview

Signals are Celery's hook mechanism. Code that publishes tasks, runs them, starts workers or sets up logging calls `signal.send(sender=..., **fields)`, and any receiver connected to that signal runs in the same process with those fields as keyword arguments. They are used both by applications to observe or modify behaviour without subclassing, and by Celery itself: the Django fix-up connects to several (see [[The Celery Application and Configuration]]). All signals are defined in `celery/signals.py` as instances of `Signal`; this page groups them by where they fire and names the code that sends each.

Sources: [celery/signals.py:29-150](repo://celery/signals.py#L29-L150), [celery/fixups/django.py:83-90](repo://celery/fixups/django.py#L83-L90)

## The Signal class

`Signal(providing_args, use_caching, name)` keeps a list of weakly referenced receivers and a lock. `providing_args` is documentation of what `send` passes; it is not enforced. The class is adapted from Django's dispatcher.

Sources: [celery/utils/dispatch/signal.py:73-102](repo://celery/utils/dispatch/signal.py#L73-L102)

`connect(receiver, sender=None, weak=True, dispatch_uid=None, retry=False)` registers a callable, and works as a decorator when called without a receiver. A receiver must accept keyword arguments. With `sender` set, it only responds to that sender; `None` means any sender. With a `dispatch_uid`, a second receiver with the same identity is not added. With `retry=True`, a receiver that raises (for example `ConnectionError`) is retried until it succeeds, and a strong reference is kept.

Sources: [celery/utils/dispatch/signal.py:110-187](repo://celery/utils/dispatch/signal.py#L110-L187)

`send(sender, **named)` calls every live receiver for the sender with `signal=self, sender=sender` plus the named fields, and returns a list of `(receiver, response)` pairs. Unlike Django, a receiver that raises does not stop the others: the exception is logged and returned as that receiver's response (`send_robust` is an alias for `send`). Callers that need to react to failures must inspect the list; `import_default_modules`, for example, re-raises any exception returned for `import_modules`. A `send` with no receivers returns an empty list at once, which is why hot paths check `signal.receivers` first.

Sources: [celery/utils/dispatch/signal.py:258-290](repo://celery/utils/dispatch/signal.py#L258-L290), [celery/loaders/base.py:97-105](repo://celery/loaders/base.py#L97-L105), [celery/app/trace.py:361-376](repo://celery/app/trace.py#L361-L376)

## Publishing signals

These fire in the client (or in any process that sends a task, including a worker sending a callback), from `send_task_message`; see [[Calling Tasks: apply_async and send_task]].

| Signal | Sender | Arguments | Fires |
| --- | --- | --- | --- |
| `before_task_publish` | Task name | `body`, `exchange`, `routing_key`, `headers`, `properties`, `declare`, `retry_policy` | Just before the message is published; receivers can mutate `headers` and `properties` |
| `after_task_publish` | Task name | `body`, `exchange`, `routing_key` | After the message was published |
| `task_sent` | Task name | `task_id`, `task`, `args`, `kwargs`, `eta`, `taskset` | Deprecated; use `after_task_publish` |

Sources: [celery/signals.py:30-41](repo://celery/signals.py#L30-L41), [celery/signals.py:88-94](repo://celery/signals.py#L88-L94), [celery/app/amqp.py:558-604](repo://celery/app/amqp.py#L558-L604)

## Task lifecycle signals

These fire in the worker. `task_received` is sent by the consumer's strategy; the rest come from the tracer and the request.

| Signal | Sender | Arguments | Sent from |
| --- | --- | --- | --- |
| `task_received` | The consumer | `request` | The default strategy, after expiry and revoke checks |
| `task_prerun` | The task | `task_id`, `task`, `args`, `kwargs` | The tracer, before the task body |
| `task_postrun` | The task | `task_id`, `task`, `args`, `kwargs`, `retval`, `state` | The tracer's `finally`, always |
| `task_success` | The task | `result` | After a successful return and result storage |
| `task_retry` | The task | `request`, `reason`, `einfo` | `TraceInfo.handle_retry` |
| `task_failure` | The task | `task_id`, `exception`, `args`, `kwargs`, `traceback`, `einfo` | `handle_failure`, and `Request` for rejects, hard time limits and lost workers |
| `task_internal_error` | The task | `task_id`, `args`, `kwargs`, `request`, `exception`, `traceback`, `einfo` | Errors in the tracer itself, outside the task body |
| `task_revoked` | The task | `request`, `terminated`, `signum`, `expired` | `Request._announce_revoked` |
| `task_rejected` | The consumer | `message`, `exc` | Unknown or invalid messages |
| `task_unknown` | The consumer | `message`, `exc`, `name`, `id` | A message whose task is not registered |

Sources: [celery/signals.py:42-87](repo://celery/signals.py#L42-L87), [celery/worker/strategy.py:166-172](repo://celery/worker/strategy.py#L166-L172), [celery/app/trace.py:570-572](repo://celery/app/trace.py#L570-L572), [celery/app/trace.py:655-664](repo://celery/app/trace.py#L655-L664), [celery/app/trace.py:703-721](repo://celery/app/trace.py#L703-L721), [celery/worker/request.py:457-468](repo://celery/worker/request.py#L457-L468), [celery/worker/consumer/consumer.py:672-714](repo://celery/worker/consumer/consumer.py#L672-L714)

The ordering inside the tracer is `task_prerun`, the body, `task_success` (success only), then `task_postrun`; see [[Task Execution, Tracing and Acknowledgement]]. `task_success` and `task_prerun` are only sent if they have receivers, as the tracer caches the receiver lists when it is built.

Sources: [celery/app/trace.py:392-394](repo://celery/app/trace.py#L392-L394), [celery/app/trace.py:563-575](repo://celery/app/trace.py#L563-L575), [celery/app/trace.py:628-648](repo://celery/app/trace.py#L628-L648)

## Worker and program lifecycle

| Signal | Arguments | Fires |
| --- | --- | --- |
| `celeryd_init` | `instance`, `conf`, `options` | In `Worker.on_before_init`, with the worker hostname as sender, so it can set per-worker configuration |
| `celeryd_after_setup` | `instance`, `conf` | In `Worker.on_start`, after `-Q` has been applied, for example to change queues |
| `import_modules` | none | When the loader imports default modules; autodiscovery and the Django fix-up connect here |
| `worker_init` | none | In `WorkController.setup_instance`, before the blueprint is applied |
| `worker_before_create_process` | none | Before the prefork pool creates a child process |
| `worker_process_init` | none | In each pool child after it is initialized; also from the solo pool |
| `worker_process_shutdown` | none | When a child exits (`pid` and `exitcode` are passed) |
| `worker_ready` | none | When the consumer is ready to receive tasks |
| `worker_shutting_down` | `sig`, `how`, `exitcode` | When a shutdown signal arrives in the main process |
| `worker_shutdown` | none | At the end of `WorkController.stop` |
| `heartbeat_sent` | none | Each time the worker sends an event heartbeat, if there are receivers |
| `user_preload_options` | `app`, `options` | From `handle_preload_options` when an app defined preload options |

Sources: [celery/signals.py:96-115](repo://celery/signals.py#L96-L115), [celery/signals.py:150-154](repo://celery/signals.py#L150-L154), [celery/apps/worker.py:91-100](repo://celery/apps/worker.py#L91-L100), [celery/apps/worker.py:128-137](repo://celery/apps/worker.py#L128-L137), [celery/worker/worker.py:127-128](repo://celery/worker/worker.py#L127-L128), [celery/concurrency/asynpool.py:489-492](repo://celery/concurrency/asynpool.py#L489-L492), [celery/concurrency/prefork.py:41-92](repo://celery/concurrency/prefork.py#L41-L92), [celery/apps/worker.py:180-182](repo://celery/apps/worker.py#L180-L182), [celery/apps/worker.py:301-315](repo://celery/apps/worker.py#L301-L315), [celery/worker/worker.py:244-253](repo://celery/worker/worker.py#L244-L253), [celery/worker/heartbeat.py:35-41](repo://celery/worker/heartbeat.py#L35-L41), [celery/bin/base.py:143-160](repo://celery/bin/base.py#L143-L160)

For the worker's startup order see [[Worker Architecture and Bootsteps]]. The `worker_process_init` signal is where per-process resources such as database connections should be created, since each pool child runs it after forking (see [[Execution Pools]]).

Sources: [celery/concurrency/prefork.py:41-92](repo://celery/concurrency/prefork.py#L41-L92), [celery/concurrency/solo.py:17-23](repo://celery/concurrency/solo.py#L17-L23)

## Logging, beat and pool signals

`setup_logging` is sent first during logging setup. If any receiver is connected, Celery does not configure logging itself, leaving it to the receiver; otherwise it configures the root and multiprocessing loggers and sends `after_setup_logger` (and `after_setup_task_logger` when the task logger is set up), both with the logger, level, logfile, format and colour flag.

Sources: [celery/signals.py:117-135](repo://celery/signals.py#L117-L135), [celery/app/log.py:92-130](repo://celery/app/log.py#L92-L130)

Beat sends `beat_init` when its service starts, and `beat_embedded_init` additionally when it runs embedded inside a worker (the Django fix-up closes database connections on the latter); see [[Periodic Tasks with Beat]]. The eventlet pool sends `eventlet_pool_started`, `eventlet_pool_apply` (with `target`, `args`, `kwargs`), `eventlet_pool_preshutdown` and `eventlet_pool_postshutdown` around its lifecycle.

Sources: [celery/signals.py:137-148](repo://celery/signals.py#L137-L148), [celery/beat.py:633-640](repo://celery/beat.py#L633-L640), [celery/concurrency/eventlet.py:110-121](repo://celery/concurrency/eventlet.py#L110-L121)
