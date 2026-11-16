---
title: "Signals"
---
## Overview

Signals let code react to things that happen inside Celery without subclassing anything: a receiver connected to `task_prerun` runs before every task, one connected to `worker_process_init` runs in every new pool process, one connected to `setup_logging` replaces Celery's logging setup. Celery's signal class is a port of Django's dispatcher, in `celery/utils/dispatch/signal.py`; the signals themselves are module-level objects in `celery/signals.py`, plus four per-app signals created on every `Celery` instance. This page explains how connecting and sending work and lists every signal with where it is sent. The logging signals are explained in context on [[Logging]].

Sources: [celery/signals.py:1-28](repo://celery/signals.py#L1-L28), [celery/utils/dispatch/signal.py:84-108](repo://celery/utils/dispatch/signal.py#L84-L108)

## Connecting receivers

`signal.connect(receiver, sender=None, weak=True, dispatch_uid=None, retry=False)` registers a receiver, and also works as a decorator, with or without arguments:

Sources: [celery/utils/dispatch/signal.py:110-186](repo://celery/utils/dispatch/signal.py#L110-L186)

```python
from celery.signals import task_prerun, after_task_publish

@task_prerun.connect
def on_prerun(sender=None, task_id=None, task=None, args=None, kwargs=None, **extra):
    ...

@after_task_publish.connect(sender='proj.tasks.add')
def on_add_published(sender=None, headers=None, body=None, **kwargs):
    ...
```

Sources: [celery/utils/dispatch/signal.py:110-186](repo://celery/utils/dispatch/signal.py#L110-L186)

The rules a receiver must follow:

Sources: [celery/utils/dispatch/signal.py:188-216](repo://celery/utils/dispatch/signal.py#L188-L216)

- It must be callable and accept `**kwargs`; otherwise `connect` raises `ValueError`. Signals add arguments over time, and every receiver is called with `signal` and `sender` as keywords.
- With a `sender`, it is called only when the signal is sent by that sender. Senders are compared by identity, except strings, which are compared by value, which is why task-name senders work for `after_task_publish`. A `PromiseProxy` sender, such as a task not yet created, is connected once the proxy is evaluated.
- A receiver is registered once per `(receiver, sender)` pair, or per `(dispatch_uid, sender)` when a `dispatch_uid` is given, so importing a module twice does not connect it twice.
- By default only a weak reference is kept (a `WeakMethod` for bound methods), and the receiver disappears when it is garbage collected. A receiver defined inside a function must be connected with `weak=False` or kept alive elsewhere.
- With `retry=True`, the receiver is wrapped to retry with backoff until it stops raising, logging each failure, and is held by a strong reference.

Sources: [celery/utils/dispatch/signal.py:21-66](repo://celery/utils/dispatch/signal.py#L21-L66), [celery/utils/dispatch/signal.py:110-216](repo://celery/utils/dispatch/signal.py#L110-L216)

`disconnect(receiver, sender=None, dispatch_uid=None)` removes a receiver by the same key and returns whether one was removed.

Sources: [celery/utils/dispatch/signal.py:218-256](repo://celery/utils/dispatch/signal.py#L218-L256)

## Sending

`signal.send(sender, **named)` calls every live receiver registered for that sender or for any sender, in registration order, with `signal=signal, sender=sender, **named`. A receiver that raises does not stop the others: the exception is logged and returned in the result list of `(receiver, response)` pairs. `send_robust` is the same method, kept for Django compatibility.

Sources: [celery/utils/dispatch/signal.py:258-301](repo://celery/utils/dispatch/signal.py#L258-L301), [celery/utils/dispatch/signal.py:303-340](repo://celery/utils/dispatch/signal.py#L303-L340)

Celery itself sometimes reads the responses: `import_default_modules` re-raises any exception a receiver of `import_modules` returned, and `setup_logging` skips Celery's own logging configuration when any receiver is connected. Several hot paths check `signal.receivers` first and skip sending entirely when nobody is listening, as the tracer does for `task_prerun`, `task_postrun` and `task_success`.

Sources: [celery/loaders/base.py:97-105](repo://celery/loaders/base.py#L97-L105), [celery/app/log.py:98-110](repo://celery/app/log.py#L98-L110), [celery/app/trace.py:410-412](repo://celery/app/trace.py#L410-L412)

## Task signals

| Signal | Sender | Arguments | Sent |
| --- | --- | --- | --- |
| `before_task_publish` | task name | body, exchange, routing_key, headers, properties, declare, retry_policy | In the client, just before publishing; headers can be changed |
| `after_task_publish` | task name | body, headers, exchange, routing_key | In the client, after publishing |
| `task_received` | consumer | request | In the worker, when a message becomes a request |
| `task_prerun` | task | task_id, task, args, kwargs | In the pool, before the task runs |
| `task_postrun` | task | task_id, task, args, kwargs, retval, state | In the pool, after the task, whatever the outcome |
| `task_success` | task | result | After a successful run |
| `task_retry` | task | request, reason, einfo | When the task raised `Retry` |
| `task_failure` | task | task_id, exception, args, kwargs, traceback, einfo | On failure, including hard time limits and `Reject` without requeue |
| `task_internal_error` | task | task_id, args, kwargs, request, exception, traceback, einfo | When Celery's code around the task fails |
| `task_revoked` | task | request, terminated, signum, expired | When a request is revoked, expired or terminated |
| `task_rejected` | consumer | message, exc | For an unknown message type or an invalid task message |
| `task_unknown` | consumer | message, exc, name, id | For a message naming an unregistered task |

Sources: [celery/signals.py:30-94](repo://celery/signals.py#L30-L94), [celery/app/amqp.py:564-587](repo://celery/app/amqp.py#L564-L587), [celery/worker/strategy.py:165-165](repo://celery/worker/strategy.py#L165-L165), [celery/app/trace.py:566-665](repo://celery/app/trace.py#L566-L665), [celery/app/trace.py:212-282](repo://celery/app/trace.py#L212-L282), [celery/app/trace.py:703-718](repo://celery/app/trace.py#L703-L718), [celery/worker/request.py:457-468](repo://celery/worker/request.py#L457-L468), [celery/worker/consumer/consumer.py:672-714](repo://celery/worker/consumer/consumer.py#L672-L714)

`task_prerun`, `task_postrun`, `task_success`, `task_retry` and `task_failure` normally run in the pool process that executes the task, not in the worker's main process; `task_received`, `task_revoked`, `task_rejected` and `task_unknown` run in the main process. `task_sent` is a deprecated alias of `after_task_publish` that is still sent when it has receivers.

Sources: [celery/app/trace.py:566-665](repo://celery/app/trace.py#L566-L665), [celery/app/amqp.py:588-600](repo://celery/app/amqp.py#L588-L600), [celery/signals.py:88-94](repo://celery/signals.py#L88-L94)

## Worker signals

| Signal | Sender | Sent |
| --- | --- | --- |
| `celeryd_init` | hostname | First thing in `celery worker`, with `instance`, `conf` and `options`; can configure workers by node name |
| `worker_init` | WorkController | After queues and includes are set up, before the bootsteps are built |
| `celeryd_after_setup` | hostname | When the worker starts, after `-Q` has been applied |
| `worker_ready` | consumer | When the consumer starts consuming |
| `worker_before_create_process` | pool | In the parent, before each prefork child is created |
| `worker_process_init` | — | In each new pool process (and once for the solo pool) |
| `worker_process_shutdown` | — | When a prefork child exits, with `pid` and `exitcode` |
| `worker_shutting_down` | hostname | When a shutdown signal is received, with `sig`, `how` and `exitcode` |
| `worker_shutdown` | WorkController | When the worker has stopped |
| `heartbeat_sent` | Heart | Before each worker heartbeat event |
| `import_modules` | app | When the loader imports task modules; `autodiscover_tasks` hooks in here |

Sources: [celery/signals.py:96-115](repo://celery/signals.py#L96-L115), [celery/apps/worker.py:94-182](repo://celery/apps/worker.py#L94-L182), [celery/apps/worker.py:301-316](repo://celery/apps/worker.py#L301-L316), [celery/worker/worker.py:127-127](repo://celery/worker/worker.py#L127-L127), [celery/worker/worker.py:198-199](repo://celery/worker/worker.py#L198-L199), [celery/concurrency/asynpool.py:490-493](repo://celery/concurrency/asynpool.py#L490-L493), [celery/concurrency/prefork.py:82-99](repo://celery/concurrency/prefork.py#L82-L99), [celery/worker/heartbeat.py:35-41](repo://celery/worker/heartbeat.py#L35-L41)

`worker_process_init` receivers run during child start-up, after the app is finalized and the tracers are rebuilt. They should be quick: the pool waits for each child to report it is up and replaces those that take longer than `worker_proc_alive_timeout`.

Sources: [celery/concurrency/prefork.py:40-88](repo://celery/concurrency/prefork.py#L40-L88), [celery/concurrency/asynpool.py:428-460](repo://celery/concurrency/asynpool.py#L428-L460)

## App, beat, logging and other signals

| Signal | Sent |
| --- | --- |
| `app.on_configure` | Before the app loads its configuration |
| `app.on_after_configure` | After configuration is loaded, with `source`; the place for `add_periodic_task` |
| `app.on_after_finalize` | After the app is finalized and every task is bound |
| `app.on_after_fork` | In a forked child, after the app dropped its connection pools |
| `beat_init`, `beat_embedded_init` | When beat starts, and additionally when it runs embedded in a worker |
| `setup_logging` | Before Celery configures logging; any receiver replaces Celery's setup |
| `after_setup_logger`, `after_setup_task_logger` | After the root logger and the task logger are configured |
| `eventlet_pool_started`, `eventlet_pool_preshutdown`, `eventlet_pool_postshutdown`, `eventlet_pool_apply` | Eventlet pool lifecycle and every task applied |
| `user_preload_options` | When the command line has user-defined preload options, with `app` and `options` |

Sources: [celery/app/base.py:418-427](repo://celery/app/base.py#L418-L427), [celery/app/base.py:1247-1288](repo://celery/app/base.py#L1247-L1288), [celery/app/base.py:657-677](repo://celery/app/base.py#L657-L677), [celery/beat.py:633-641](repo://celery/beat.py#L633-L641), [celery/signals.py:117-154](repo://celery/signals.py#L117-L154), [celery/app/log.py:94-180](repo://celery/app/log.py#L94-L180), [celery/concurrency/eventlet.py:110-128](repo://celery/concurrency/eventlet.py#L110-L128), [celery/bin/base.py:150-157](repo://celery/bin/base.py#L150-L157)

The app signals are attributes of each `Celery` instance rather than module globals, so a receiver connected with `@app.on_after_configure.connect` reacts only to that app.

Sources: [celery/app/base.py:418-427](repo://celery/app/base.py#L418-L427)
