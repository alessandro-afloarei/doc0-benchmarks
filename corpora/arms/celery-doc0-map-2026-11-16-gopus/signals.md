---
title: "Signals"
---
## Overview

Signals let application code run at fixed points in Celery's life cycle without subclassing anything: before a task message is published, when a worker process starts, after each task, when logging is configured, and so on. `celery.signals` defines the signals as module-level objects; Celery calls `signal.send(sender=..., **fields)` at those points, and every function connected to the signal is called with the same keyword arguments. The module docstring describes this as the Observer pattern, used "by both workers and clients".

Sources: [celery/signals.py:1-28](repo://celery/signals.py#L1-L28)

The dispatcher is `celery.utils.dispatch.Signal`, adapted from Django's. The app also creates its own instance signals (`on_configure`, `on_after_configure`, `on_after_finalize`, `on_after_fork`) described in [[The Celery Application]].

Sources: [celery/utils/dispatch/signal.py:73-102](repo://celery/utils/dispatch/signal.py#L73-L102), [celery/app/base.py:420-430](repo://celery/app/base.py#L420-L430)

## Connecting receivers

`signal.connect(receiver, sender=None, weak=True, dispatch_uid=None, retry=False)` works directly or as a decorator, with or without arguments:

Sources: [celery/utils/dispatch/signal.py:182-186](repo://celery/utils/dispatch/signal.py#L182-L186)

```python
from celery.signals import task_success, worker_process_init

@task_success.connect
def on_success(sender=None, result=None, **kwargs):
    ...

@worker_process_init.connect(weak=False)
def init_db(**kwargs):
    ...
```

Sources: [celery/utils/dispatch/signal.py:110-186](repo://celery/utils/dispatch/signal.py#L110-L186)

The options control matching and lifetime:

Sources: [celery/utils/dispatch/signal.py:144-151](repo://celery/utils/dispatch/signal.py#L144-L151)

| Option | Effect |
| --- | --- |
| `sender` | Only call the receiver when the signal is sent with this sender (compared by identity); `None` receives from every sender |
| `weak` | Keep only a weak reference (a `WeakMethod` for bound methods); the receiver disappears when it is garbage collected |
| `dispatch_uid` | A key that identifies the receiver, so connecting twice with the same key registers it once |
| `retry` | Retry the receiver over time on any exception, logging each failure; forces a strong reference |

Sources: [celery/utils/dispatch/signal.py:21-70](repo://celery/utils/dispatch/signal.py#L21-L70), [celery/utils/dispatch/signal.py:110-186](repo://celery/utils/dispatch/signal.py#L110-L186)

Receivers must be callable and accept `**kwargs`; a receiver without it raises `ValueError` at connect time. Without `dispatch_uid`, the lookup key is the receiver's id plus the sender's id, so the same function can be connected for different senders. When the sender is a lazy `PromiseProxy` (a task from `@app.task` before finalization), the connection is deferred until the proxy is evaluated, so `task_success.connect(sender=my_task)` works at import time.

Sources: [celery/utils/dispatch/signal.py:188-216](repo://celery/utils/dispatch/signal.py#L188-L216)

`disconnect(receiver=None, sender=None, dispatch_uid=None)` removes a receiver by the same key, and `has_listeners(sender=None)` tells whether anyone is connected.

Sources: [celery/utils/dispatch/signal.py:218-252](repo://celery/utils/dispatch/signal.py#L218-L252)

## Sending

`send(sender, **named)` calls each live receiver for the sender as `receiver(signal=self, sender=sender, **named)` and returns a list of `(receiver, response)` pairs. Exceptions raised by receivers are logged as `Signal handler ... raised` and returned as the response instead of propagating, so a faulty receiver cannot break a worker; `send_robust` is the same method, for compatibility with Django. Dead weak references are cleaned up under a lock, and with `use_caching` the receivers per sender are cached.

Sources: [celery/utils/dispatch/signal.py:254-336](repo://celery/utils/dispatch/signal.py#L254-L336)

A few call sites look at the responses. `import_modules` is sent before the worker imports task modules, and the loader re-raises any exception a receiver returned, because logging is not yet set up and the error would otherwise vanish ([[Configuration and Loaders]]). `setup_logging` disables Celery's own logging configuration when it has any receiver.

Sources: [celery/loaders/base.py:94-104](repo://celery/loaders/base.py#L94-L104), [celery/app/log.py:98-131](repo://celery/app/log.py#L98-L131)

Hot paths read `signal.receivers` once and skip sending when there are none: the task sender checks `before_task_publish` and `after_task_publish`, the tracer checks `task_prerun`, `task_postrun` and `task_success`, and the heartbeat checks `heartbeat_sent` ([[Sending Tasks]], [[Task Execution Pipeline]]).

Sources: [celery/app/amqp.py:491-497](repo://celery/app/amqp.py#L491-L497), [celery/app/trace.py:408-410](repo://celery/app/trace.py#L408-L410), [celery/worker/heartbeat.py:33-35](repo://celery/worker/heartbeat.py#L33-L35)

## Task signals

| Signal | Sender | Arguments | Sent |
| --- | --- | --- | --- |
| `before_task_publish` | task name | `body`, `exchange`, `routing_key`, `headers`, `properties`, `declare`, `retry_policy` | In the client, before a task message is published; headers may be modified |
| `after_task_publish` | task name | `body`, `headers`, `exchange`, `routing_key` | In the client, after publishing |
| `task_received` | consumer | `request` | On the worker, when a message has become a `Request` |
| `task_prerun` | task | `task_id`, `task`, `args`, `kwargs` | Before the task runs |
| `task_postrun` | task | `task_id`, `task`, `args`, `kwargs`, `retval`, `state` | After the task returns, in all outcomes |
| `task_success` | task | `result` | After a successful run is stored |
| `task_retry` | task | `request`, `reason`, `einfo` | When the task is retried |
| `task_failure` | task | `task_id`, `exception`, `args`, `kwargs`, `traceback`, `einfo` | When the task fails, times out or loses its worker |
| `task_internal_error` | task | `task_id`, `args`, `kwargs`, `request`, `exception`, `traceback`, `einfo` | When Celery's own code fails outside the task body |
| `task_revoked` | task | `request`, `terminated`, `signum`, `expired` | When a task is revoked, expired or terminated |
| `task_rejected` | consumer | `message`, `exc` | When a message of unknown format or an invalid task is rejected |
| `task_unknown` | consumer | `message`, `exc`, `name`, `id` | When a message names an unregistered task |
| `task_sent` | task name | | Deprecated; use `after_task_publish` |

Sources: [celery/signals.py:30-94](repo://celery/signals.py#L30-L94), [celery/app/amqp.py:547-582](repo://celery/app/amqp.py#L547-L582), [celery/worker/strategy.py:165-165](repo://celery/worker/strategy.py#L165-L165), [celery/app/trace.py:589-668](repo://celery/app/trace.py#L589-L668), [celery/app/trace.py:703-733](repo://celery/app/trace.py#L703-L733), [celery/worker/consumer/consumer.py:672-714](repo://celery/worker/consumer/consumer.py#L672-L714)

`task_prerun`, `task_postrun`, `task_success`, `task_retry` and `task_failure` run in the process executing the task (a pool child with prefork), while `task_received`, `task_rejected`, `task_unknown`, and the failure and revoke paths handled by `Request` run in the worker's main process ([[Retries, Failures and Time Limits]]).

Sources: [celery/app/trace.py:232-268](repo://celery/app/trace.py#L232-L268), [celery/worker/request.py:457-468](repo://celery/worker/request.py#L457-L468), [celery/worker/request.py:700-718](repo://celery/worker/request.py#L700-L718)

## Worker signals

| Signal | Sent |
| --- | --- |
| `celeryd_init` | First thing in the command-line worker, with `instance`, `conf` and `options`; the sender is the node name, so receivers can configure specific nodes |
| `worker_init` | When `WorkController` has set itself up, before bootsteps are created |
| `celeryd_after_setup` | After the worker has started its steps and queues are set, with `instance` and `conf` |
| `import_modules` | Before task modules are imported (also used by `autodiscover_tasks`) |
| `worker_ready` | When the consumer is ready to receive messages |
| `heartbeat_sent` | Each time a worker heartbeat event is sent |
| `worker_before_create_process` | In the parent, before the prefork pool creates a child |
| `worker_process_init` | In each pool child after initialization (and once for the solo pool) |
| `worker_process_shutdown` | When a pool child exits, with `pid` and `exitcode` |
| `worker_shutting_down` | When a shutdown signal is handled, with `sig`, `how` (`Warm` or `Cold`) and `exitcode` |
| `worker_shutdown` | When the worker is stopping |

Sources: [celery/signals.py:96-115](repo://celery/signals.py#L96-L115), [celery/apps/worker.py:94-104](repo://celery/apps/worker.py#L94-L104), [celery/apps/worker.py:128-140](repo://celery/apps/worker.py#L128-L140), [celery/apps/worker.py:180-182](repo://celery/apps/worker.py#L180-L182), [celery/apps/worker.py:301-316](repo://celery/apps/worker.py#L301-L316), [celery/worker/worker.py:120-120](repo://celery/worker/worker.py#L120-L120), [celery/worker/worker.py:198-199](repo://celery/worker/worker.py#L198-L199), [celery/concurrency/prefork.py:82-92](repo://celery/concurrency/prefork.py#L82-L92), [celery/concurrency/asynpool.py:490-493](repo://celery/concurrency/asynpool.py#L490-L493)

With prefork, `worker_process_init` is sent from `process_initializer`, which runs in each child after it is forked, once the app is finalized and the tracers are rebuilt ([[Concurrency Pools]]).

Sources: [celery/concurrency/prefork.py:41-82](repo://celery/concurrency/prefork.py#L41-L82)

## Logging, beat and other signals

| Signal | Arguments | Sent |
| --- | --- | --- |
| `setup_logging` | `loglevel`, `logfile`, `format`, `colorize` | When Celery would configure logging; any receiver replaces Celery's configuration |
| `after_setup_logger` | `logger`, `loglevel`, `logfile`, `format`, `colorize` | After the root logger is configured |
| `after_setup_task_logger` | same | After the task logger is configured |
| `beat_init` | | When the beat service starts |
| `beat_embedded_init` | | Additionally, when beat runs embedded in a worker |
| `eventlet_pool_started`, `eventlet_pool_preshutdown`, `eventlet_pool_postshutdown`, `eventlet_pool_apply` | | Eventlet pool life cycle ([[Concurrency Pools]]) |
| `user_preload_options` | `app`, `options` | When a command with preload options runs ([[Command Line Interface]]) |

Sources: [celery/signals.py:117-154](repo://celery/signals.py#L117-L154), [celery/app/log.py:98-131](repo://celery/app/log.py#L98-L131), [celery/beat.py:634-641](repo://celery/beat.py#L634-L641), [celery/bin/base.py:143-160](repo://celery/bin/base.py#L143-L160)

When no `setup_logging` receiver exists, Celery configures the root logger, clearing its handlers first if `worker_hijack_root_logger` is on, and configures the multiprocessing logger, before sending `after_setup_logger`.

Sources: [celery/app/log.py:98-131](repo://celery/app/log.py#L98-L131)
