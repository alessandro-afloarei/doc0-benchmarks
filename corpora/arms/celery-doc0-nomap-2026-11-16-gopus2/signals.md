---
title: "Signals"
---
## Overview

Signals are Celery's in-process hooks: named points in the client, the worker, beat and the logging setup where application code can run a function. The module docstring describes them as the Observer pattern — functions connected to a signal are called whenever it is sent. Unlike events (see [[Events and Monitoring]]), signals never leave the process; they are how code runs *inside* a worker or a pool child at a given moment, for example to open a database connection when a child process starts.

Sources: [celery/signals.py:1-11](repo://celery/signals.py#L1-L11), [celery/utils/dispatch/signal.py:73-102](repo://celery/utils/dispatch/signal.py#L73-L102)

All signals are instances of `celery.utils.dispatch.Signal`, a variant of Django's dispatcher. The app also has its own signals — `on_configure`, `on_after_configure`, `on_after_finalize` and `on_after_fork` — described on [[The Celery Application]].

Sources: [celery/app/base.py:418-428](repo://celery/app/base.py#L418-L428)

## Connecting receivers

### connect

`signal.connect(receiver, sender=None, weak=True, dispatch_uid=None, retry=False)` registers a receiver; it can also be used as a decorator, with or without arguments. A receiver must be callable and accept `**kwargs` — connecting one that does not raises `ValueError` — because every call passes `signal`, `sender` and the signal's named arguments as keywords.

Sources: [celery/utils/dispatch/signal.py:110-186](repo://celery/utils/dispatch/signal.py#L110-L186), [celery/utils/dispatch/signal.py:188-192](repo://celery/utils/dispatch/signal.py#L188-L192)

```python
from celery.signals import task_success, worker_process_init

@worker_process_init.connect
def init_db(**kwargs):
    ...

@task_success.connect(sender='tasks.add')
def on_add_done(sender=None, result=None, **kwargs):
    ...
```

Sources: [celery/utils/dispatch/signal.py:180-186](repo://celery/utils/dispatch/signal.py#L180-L186)

| Option | Effect |
| --- | --- |
| `sender` | Only receive signals from this sender; `None` receives from all |
| `weak=True` | Hold a weak reference, so a receiver that is garbage-collected disconnects itself (bound methods use `WeakMethod`) |
| `dispatch_uid` | Identify the receiver; connecting again with the same uid and sender does nothing |
| `retry=True` | Wrap the receiver so a raised exception is retried over time with logged delays; forces a strong reference |

Sources: [celery/utils/dispatch/signal.py:144-186](repo://celery/utils/dispatch/signal.py#L144-L186), [celery/utils/dispatch/signal.py:32-51](repo://celery/utils/dispatch/signal.py#L32-L51)

Receivers are identified by `(receiver id or dispatch_uid, sender id)`, so the same function can be connected for different senders. A sender given as a string — such as a task name — is compared by value (Issue #2475). If the sender is a `PromiseProxy`, such as a task not yet created by the lazy decorator, the connection is deferred until the proxy is evaluated.

Sources: [celery/utils/dispatch/signal.py:21-69](repo://celery/utils/dispatch/signal.py#L21-L69), [celery/utils/dispatch/signal.py:194-216](repo://celery/utils/dispatch/signal.py#L194-L216)

`disconnect(receiver=None, sender=None, dispatch_uid=None)` removes a receiver and returns whether one was found. Dead weak references are cleaned up lazily under the signal's lock rather than from the garbage collector's callback, because the comment notes the callback can run while the lock is already held.

Sources: [celery/utils/dispatch/signal.py:218-253](repo://celery/utils/dispatch/signal.py#L218-L253), [celery/utils/dispatch/signal.py:292-350](repo://celery/utils/dispatch/signal.py#L292-L350)

### send

`signal.send(sender, **named)` calls every live receiver connected for that sender or for any sender, and returns a list of `(receiver, response)` pairs. An exception in a receiver is logged and returned as that receiver's response instead of being raised, so one failing receiver cannot break the code that sent the signal; the docstring notes that `send` and `send_robust` are therefore the same. Hot paths in Celery check `signal.receivers` first and skip sending when no one listens.

Sources: [celery/utils/dispatch/signal.py:258-290](repo://celery/utils/dispatch/signal.py#L258-L290), [celery/app/amqp.py:494-500](repo://celery/app/amqp.py#L494-L500), [celery/app/trace.py:399-401](repo://celery/app/trace.py#L399-L401)

The loader is an exception to the "never raise" behaviour: `import_default_modules` inspects the responses of `import_modules` and re-raises any exception, because logging is not set up yet at that point and the error would otherwise be invisible.

Sources: [celery/loaders/base.py:97-105](repo://celery/loaders/base.py#L97-L105)

## Task signals

| Signal | Sent | Sender | Arguments |
| --- | --- | --- | --- |
| `before_task_publish` | Client, before publishing | task name | `body`, `exchange`, `routing_key`, `headers`, `properties`, `declare`, `retry_policy` |
| `after_task_publish` | Client, after publishing | task name | `body`, `exchange`, `routing_key`, `headers` |
| `task_received` | Worker, request created | consumer | `request` |
| `task_prerun` | Pool, before the body | task | `task_id`, `task`, `args`, `kwargs` |
| `task_postrun` | Pool, after the body (always) | task | `task_id`, `task`, `args`, `kwargs`, `retval`, `state` |
| `task_success` | Pool, after success | task | `result` |
| `task_retry` | Pool or worker | task | `request`, `reason`, `einfo` |
| `task_failure` | Pool or worker | task | `task_id`, `exception`, `args`, `kwargs`, `traceback`, `einfo` |
| `task_internal_error` | Pool, error outside the body | task | `task_id`, `args`, `kwargs`, `request`, `exception`, `traceback`, `einfo` |
| `task_revoked` | Worker | task | `request`, `terminated`, `signum`, `expired` |
| `task_rejected` | Worker, unknown or invalid message | consumer | `message`, `exc` |
| `task_unknown` | Worker, unregistered task | consumer | `message`, `exc`, `name`, `id` |
| `task_sent` | Deprecated: use `after_task_publish` | task name | — |

Sources: [celery/signals.py:30-94](repo://celery/signals.py#L30-L94), [celery/app/amqp.py:549-582](repo://celery/app/amqp.py#L549-L582), [celery/app/trace.py:569-659](repo://celery/app/trace.py#L569-L659), [celery/worker/consumer/consumer.py:672-714](repo://celery/worker/consumer/consumer.py#L672-L714)

The publish signals run in the process that sends the task; the `task_prerun`, `task_postrun`, `task_success` and most `task_failure`/`task_retry` signals run in the pool process that executes it, so receivers must be connected in a module the worker imports. `task_failure` is also sent from the parent process for hard time limits, lost workers and rejected messages. See [[Task Execution and Tracing]] and [[Task Requests and Strategies]].

Sources: [celery/app/trace.py:212-282](repo://celery/app/trace.py#L212-L282), [celery/worker/request.py:564-575](repo://celery/worker/request.py#L564-L575)

## Worker signals

| Signal | Sent when |
| --- | --- |
| `celeryd_init` | The worker program starts, before setup (sender is the node name) — useful to configure workers by name |
| `celeryd_after_setup` | Queues are set up, before the worker starts consuming |
| `import_modules` | The loader is about to import task modules |
| `worker_init` | The `WorkController` is being set up |
| `worker_before_create_process` | Before the prefork pool forks a child |
| `worker_process_init` | In each new pool child (and once for the solo pool) |
| `worker_process_shutdown` | A pool child exited (`pid`, `exitcode`) |
| `worker_ready` | The consumer is ready |
| `heartbeat_sent` | A worker heartbeat event was sent |
| `worker_shutting_down` | A shutdown signal was received (`sig`, `how`, `exitcode`) |
| `worker_shutdown` | The worker is stopping |

Sources: [celery/signals.py:96-115](repo://celery/signals.py#L96-L115), [celery/apps/worker.py:94-183](repo://celery/apps/worker.py#L94-L183), [celery/worker/worker.py:129](repo://celery/worker/worker.py#L129), [celery/worker/worker.py:198-199](repo://celery/worker/worker.py#L198-L199), [celery/concurrency/prefork.py:82-92](repo://celery/concurrency/prefork.py#L82-L92), [celery/concurrency/asynpool.py:490-493](repo://celery/concurrency/asynpool.py#L490-L493), [celery/apps/worker.py:301-314](repo://celery/apps/worker.py#L301-L314)

## Logging, beat, eventlet and CLI signals

| Signal | Sent |
| --- | --- |
| `setup_logging` | Before Celery configures logging; if any receiver is connected, Celery leaves logging configuration to it |
| `after_setup_logger`, `after_setup_task_logger` | After the root and task loggers are configured (`logger`, `loglevel`, `logfile`, `format`, `colorize`) |
| `beat_init`, `beat_embedded_init` | Beat starts, standalone or embedded in a worker |
| `eventlet_pool_started`, `eventlet_pool_preshutdown`, `eventlet_pool_postshutdown`, `eventlet_pool_apply` | Eventlet pool lifecycle and each task applied |
| `user_preload_options` | A command parsed custom preload options (`app`, `options`) |

Sources: [celery/signals.py:117-154](repo://celery/signals.py#L117-L154), [celery/app/log.py:98-127](repo://celery/app/log.py#L98-L127), [celery/beat.py:637-639](repo://celery/beat.py#L637-L639), [celery/concurrency/eventlet.py:110-126](repo://celery/concurrency/eventlet.py#L110-L126), [celery/bin/base.py:143-160](repo://celery/bin/base.py#L143-L160)

How the logging signals are used is described on [[Logging]].

Sources: [celery/app/log.py:176-180](repo://celery/app/log.py#L176-L180)
