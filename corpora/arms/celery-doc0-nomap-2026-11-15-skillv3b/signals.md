---
title: "Signals"
---
## Overview

Signals are in-process hooks: Celery calls your function at a defined point (before a task is published, when a task fails, when a worker process starts) with keyword arguments describing what happened. They let you add behaviour such as metrics, logging, connection setup or per-node configuration without subclassing anything. Unlike events ([[Events and Monitoring]]), signals run synchronously in the process that sends them and never cross the network, so a receiver for a worker signal must be imported by the worker. All signals are instances of `celery.utils.dispatch.Signal`, defined in `celery/signals.py`.

Sources: [celery/signals.py:1-28](repo://celery/signals.py#L1-L28), [celery/utils/dispatch/signal.py:73-102](repo://celery/utils/dispatch/signal.py#L73-L102)

## Connecting receivers

### connect

`signal.connect(receiver, sender=None, weak=True, dispatch_uid=None, retry=False)` registers a receiver, and also works as a decorator with or without arguments. The receiver must accept `**kwargs`, because signals may gain arguments over time; a receiver without it is refused with `ValueError`. Every call passes `signal` and `sender` plus the signal's own arguments.

Sources: [celery/utils/dispatch/signal.py:110-216](repo://celery/utils/dispatch/signal.py#L110-L216)

```python
from celery.signals import task_failure, worker_process_init


@task_failure.connect
def report_failure(sender=None, task_id=None, exception=None, **kwargs):
    metrics.increment('task.failure', tags=[sender.name])


@worker_process_init.connect
def init_db(**kwargs):
    db.connect()
```

Sources: [celery/utils/dispatch/signal.py:110-186](repo://celery/utils/dispatch/signal.py#L110-L186)

### Sender filtering

With `sender=x`, the receiver only runs when the signal is sent by `x`. Senders are compared by identity, so for task signals pass the task object (`@task_success.connect(sender=add)`); for signals whose sender is a string, such as `celeryd_init` (the node name) or `before_task_publish` (the task name), pass the string. A task decorated lazily is still a `PromiseProxy` at import time: connecting to it is deferred until the proxy is evaluated, so filtering by task works even before the app is finalized.

Sources: [celery/utils/dispatch/signal.py:188-216](repo://celery/utils/dispatch/signal.py#L188-L216), [celery/utils/dispatch/signal.py:303-340](repo://celery/utils/dispatch/signal.py#L303-L340)

### Weak references and uniqueness

Receivers are held by weak reference by default (using `WeakMethod` for bound methods), so a receiver defined inside a function disappears when the function's locals do; pass `weak=False` for closures and lambdas. A receiver is registered once per `(receiver, sender)` key, or per `(dispatch_uid, sender)` when `dispatch_uid` is given, which prevents duplicate registration when a module is imported twice. `disconnect` takes the same arguments.

Sources: [celery/utils/dispatch/signal.py:21-56](repo://celery/utils/dispatch/signal.py#L21-L56), [celery/utils/dispatch/signal.py:218-253](repo://celery/utils/dispatch/signal.py#L218-L253)

### Retrying receivers

`retry=True` wraps the receiver in `retry_over_time`: if it raises, the error is logged with the next delay and the receiver is called again until it succeeds. The receiver is then held strongly. This suits set-up receivers that must eventually connect to a service.

Sources: [celery/utils/dispatch/signal.py:147-184](repo://celery/utils/dispatch/signal.py#L147-L184)

## Sending

`send(sender, **named)` calls each live receiver that matches the sender and returns a list of `(receiver, response)` pairs. An exception in a receiver is logged as `Signal handler ... raised` and returned in place of the response; it never propagates to the code that sent the signal, so a broken metrics receiver cannot fail a task. `send_robust` is the same method, kept for Django compatibility. Hot paths in Celery check `signal.receivers` first and skip sending when nobody listens.

Sources: [celery/utils/dispatch/signal.py:258-290](repo://celery/utils/dispatch/signal.py#L258-L290), [celery/app/amqp.py:491-497](repo://celery/app/amqp.py#L491-L497), [celery/app/trace.py:394-397](repo://celery/app/trace.py#L394-L397)

The loader is the exception: `import_modules` responses that are exceptions are re-raised, because logging is not set up when it is sent and an error would otherwise disappear ([[Configuration and Loaders]]).

Sources: [celery/loaders/base.py:97-105](repo://celery/loaders/base.py#L97-L105)

## Task signals

| Signal | Sender | Arguments | Sent |
| --- | --- | --- | --- |
| `before_task_publish` | Task name | body, exchange, routing_key, headers, properties, declare, retry_policy | In the client, before publishing; headers and properties can still be changed |
| `after_task_publish` | Task name | body, exchange, routing_key, headers | In the client, after publishing |
| `task_received` | Consumer | request | In the worker, when a message becomes a request |
| `task_prerun` | Task | task_id, task, args, kwargs | In the pool, before the task runs |
| `task_success` | Task | result | After a successful run |
| `task_retry` | Task | request, reason, einfo | When the task raised `Retry`, or was cancelled during shutdown |
| `task_failure` | Task | task_id, exception, args, kwargs, traceback, einfo | When the task failed or hit a hard time limit |
| `task_internal_error` | Task | task_id, args, kwargs, request, exception, traceback, einfo | When Celery itself failed outside the task body |
| `task_postrun` | Task | task_id, task, args, kwargs, retval, state | In the pool, after every run |
| `task_revoked` | Task | request, terminated, signum, expired | When a request is revoked, expires or is terminated |
| `task_rejected` | Consumer | message, exc | When a message is not a valid task |
| `task_unknown` | Consumer | message, exc, name, id | When the task name is not registered |

Sources: [celery/signals.py:30-94](repo://celery/signals.py#L30-L94)

The publish signals run in the caller ([[Calling Tasks and the Message Protocol]]); `task_received`, `task_rejected`, `task_unknown` and `task_revoked` in the worker's main process ([[Task Requests and Strategies]]); `task_prerun`, `task_success`, `task_retry`, `task_failure`, `task_internal_error` and `task_postrun` in the pool process or thread that runs the task ([[Task Tracing and Execution]]), except that `task_failure` for a hard time limit or a lost worker comes from the main process, since the child is gone. `task_sent` is deprecated in favour of `after_task_publish`.

Sources: [celery/app/amqp.py:549-583](repo://celery/app/amqp.py#L549-L583), [celery/worker/strategy.py:165-165](repo://celery/worker/strategy.py#L165-L165), [celery/app/trace.py:568-662](repo://celery/app/trace.py#L568-L662), [celery/worker/request.py:557-575](repo://celery/worker/request.py#L557-L575)

```python
from celery.signals import before_task_publish


@before_task_publish.connect
def add_tenant(sender=None, headers=None, **kwargs):
    headers['tenant'] = current_tenant()
```

Sources: [celery/app/amqp.py:549-566](repo://celery/app/amqp.py#L549-L566)

## Worker signals

| Signal | Sender | Sent |
| --- | --- | --- |
| `celeryd_init` | Node name | First thing in `celery worker`; arguments `instance`, `conf`, `options`; the place to configure per node |
| `worker_init` | `WorkController` | Before bootsteps are applied |
| `celeryd_after_setup` | Node name | After the blueprint started and queues are set; `instance`, `conf` |
| `worker_ready` | Consumer | When the worker is consuming |
| `worker_before_create_process` | Pool | In the parent, before forking each prefork child |
| `worker_process_init` | `None` | In each pool child after start-up (and once for solo); open connections here |
| `worker_process_shutdown` | `None` | When a prefork child exits; `pid`, `exitcode` |
| `heartbeat_sent` | `Heart` | Each time a worker heartbeat event is sent |
| `worker_shutting_down` | Node name | In the main process when a shutdown signal is handled; `sig`, `how`, `exitcode` |
| `worker_shutdown` | `WorkController` | At the end of shutdown |
| `import_modules` | App | Before the worker imports task modules |

Sources: [celery/signals.py:96-115](repo://celery/signals.py#L96-L115), [celery/apps/worker.py:94-182](repo://celery/apps/worker.py#L94-L182), [celery/concurrency/prefork.py:41-92](repo://celery/concurrency/prefork.py#L41-L92), [celery/worker/worker.py:127-127](repo://celery/worker/worker.py#L127-L127), [celery/worker/worker.py:198-199](repo://celery/worker/worker.py#L198-L199)

`celeryd_init` is the only signal sent early enough to change the worker's configuration, for example to give one node different queues.

Sources: [celery/apps/worker.py:94-104](repo://celery/apps/worker.py#L94-L104)

```python
from celery.signals import celeryd_init


@celeryd_init.connect(sender='worker12@example.com')
def configure_worker12(conf=None, **kwargs):
    conf.task_default_rate_limit = '10/m'
```

Sources: [celery/apps/worker.py:94-104](repo://celery/apps/worker.py#L94-L104)

## Beat, logging and pool signals

| Signal | Sent |
| --- | --- |
| `beat_init` | When the beat service starts |
| `beat_embedded_init` | Additionally, when beat starts inside a worker (`-B`) |
| `setup_logging` | Before Celery configures logging; if any receiver is connected, Celery leaves logging entirely to it |
| `after_setup_logger` | After the root logger is configured; `logger`, `loglevel`, `logfile`, `format`, `colorize` |
| `after_setup_task_logger` | After the task logger is configured, with the same arguments |
| `eventlet_pool_started`, `eventlet_pool_preshutdown`, `eventlet_pool_postshutdown`, `eventlet_pool_apply` | Around the eventlet pool's life cycle and each task it runs |
| `user_preload_options` | When the `celery` command has parsed custom preload options; `app`, `options` |

Sources: [celery/signals.py:117-154](repo://celery/signals.py#L117-L154), [celery/beat.py:636-641](repo://celery/beat.py#L636-L641), [celery/app/log.py:87-130](repo://celery/app/log.py#L87-L130), [celery/concurrency/eventlet.py:110-121](repo://celery/concurrency/eventlet.py#L110-L121), [celery/bin/base.py:150-158](repo://celery/bin/base.py#L150-L158)

Connecting to `setup_logging` disables Celery's logging configuration, including hijacking the root logger, so the application's own `logging.config` stays in force. To extend Celery's set-up instead, connect to `after_setup_logger` and `after_setup_task_logger`.

Sources: [celery/app/log.py:98-130](repo://celery/app/log.py#L98-L130)

## App signals

The app object has four signals of its own, created per instance: `on_configure`, `on_after_configure` (with the loaded settings as `source`), `on_after_finalize` and `on_after_fork`. They are described on [[The Celery Application]]; `on_after_configure` is the usual place to call `add_periodic_task` ([[Periodic Tasks with Beat]]).

Sources: [celery/app/base.py:418-427](repo://celery/app/base.py#L418-L427)
