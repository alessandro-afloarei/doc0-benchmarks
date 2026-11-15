---
title: "Signals"
---
## Overview

Signals are in-process hooks: Celery calls every connected function when something happens, such as a task about to run, a worker child process starting, or logging being configured. They let applications add behaviour (metrics, tracing, database connection handling, custom logging) without subclassing Celery classes. Unlike monitoring events ([[Events and Monitoring]]), which travel over the broker to other processes, signals run synchronously in the process where they are sent.

Sources: [celery/signals.py:1-28](repo://celery/signals.py#L1-L28)

The signal objects live in `celery.signals`; the dispatcher implementation, adapted from Django's, is in `celery.utils.dispatch.signal`.

Sources: [celery/utils/dispatch/signal.py:73-102](repo://celery/utils/dispatch/signal.py#L73-L102)

## Connecting receivers

### connect

`signal.connect(receiver, sender=None, weak=True, dispatch_uid=None, retry=False)` registers a callable, and works as a decorator with or without arguments. A receiver must accept keyword arguments (`**kwargs`), since every send passes `signal` and `sender` plus the signal's own arguments; connecting a function that does not raises `ValueError`.

Sources: [celery/utils/dispatch/signal.py:110-186](repo://celery/utils/dispatch/signal.py#L110-L186), [celery/utils/dispatch/signal.py:188-192](repo://celery/utils/dispatch/signal.py#L188-L192)

```python
from celery.signals import task_prerun, task_postrun

@task_prerun.connect
def start_timer(sender=None, task_id=None, task=None, **kwargs):
    ...

@task_postrun.connect(sender=add)          # only for the add task
def stop_timer(sender=None, task_id=None, retval=None, state=None, **kwargs):
    ...
```

Sources: [celery/signals.py:46-53](repo://celery/signals.py#L46-L53), [celery/app/trace.py:568-572](repo://celery/app/trace.py#L568-L572)

| Option | Effect |
| --- | --- |
| `sender` | Only call the receiver when sent by this object (for task signals, the task; for worker signals, the hostname or worker) |
| `weak=True` | Hold a weak reference; the receiver disappears when it is garbage-collected. Use `weak=False` for closures and lambdas |
| `dispatch_uid` | Identifies the receiver, so connecting twice (for example from a module imported twice) registers it once |
| `retry=True` | Wrap the receiver so it is retried with backoff until it succeeds; implies a strong reference |

Sources: [celery/utils/dispatch/signal.py:144-186](repo://celery/utils/dispatch/signal.py#L144-L186), [celery/utils/dispatch/signal.py:54-62](repo://celery/utils/dispatch/signal.py#L54-L62)

If the sender is a lazy task proxy that has not been evaluated yet, the connection is deferred until the proxy evaluates, so `@task_success.connect(sender=my_task)` works at import time.

Sources: [celery/utils/dispatch/signal.py:194-198](repo://celery/utils/dispatch/signal.py#L194-L198)

### disconnect

`signal.disconnect(receiver=None, sender=None, dispatch_uid=None)` removes a receiver by the same key it was registered with and returns whether one was found. Weak receivers need no explicit disconnect: when their object is collected, a finalizer marks the list for cleanup on the next connect, disconnect or send.

Sources: [celery/utils/dispatch/signal.py:200-253](repo://celery/utils/dispatch/signal.py#L200-L253), [celery/utils/dispatch/signal.py:292-350](repo://celery/utils/dispatch/signal.py#L292-L350)

## Sending

`signal.send(sender, **named)` calls every live receiver whose registered sender is `None` or matches `sender`, and returns a list of `(receiver, response)` pairs. An exception in a receiver is logged and returned as that receiver's response rather than raised, so one faulty handler does not break task execution; `send_robust` is the same method. Callers that must react to errors inspect the responses, as the loader does for `import_modules`.

Sources: [celery/utils/dispatch/signal.py:258-290](repo://celery/utils/dispatch/signal.py#L258-L290), [celery/loaders/base.py:97-105](repo://celery/loaders/base.py#L97-L105)

Hot paths check `signal.receivers` before sending, so unused signals cost almost nothing: the tracer looks up prerun, postrun and success receivers once per task type, and publishing checks before- and after-publish receivers once per app.

Sources: [celery/app/trace.py:410-412](repo://celery/app/trace.py#L410-L412), [celery/app/amqp.py:491-497](repo://celery/app/amqp.py#L491-L497)

## Task signals

| Signal | Sent from | Sender | Arguments |
| --- | --- | --- | --- |
| `before_task_publish` | Client, before publishing | Task name | body, exchange, routing_key, headers, properties, declare, retry_policy |
| `after_task_publish` | Client, after publishing | Task name | body, exchange, routing_key, headers |
| `task_received` | Worker, message accepted by strategy | Consumer | request |
| `task_prerun` | Child, before the task runs | Task | task_id, task, args, kwargs |
| `task_success` | Child, task returned | Task | result |
| `task_retry` | Child, task raised `Retry` | Task | request, reason, einfo |
| `task_failure` | Child or main, task failed | Task | task_id, exception, args, kwargs, traceback, einfo |
| `task_internal_error` | Child, error outside the task body | Task | task_id, args, kwargs, request, exception, traceback, einfo |
| `task_postrun` | Child, after every outcome | Task | task_id, task, args, kwargs, retval, state |
| `task_revoked` | Worker, task revoked or expired | Task | request, terminated, signum, expired |
| `task_rejected` | Worker, unknown message type or invalid task | Consumer | message, exc |
| `task_unknown` | Worker, task name not registered | Consumer | message, exc, name, id |

Sources: [celery/signals.py:30-94](repo://celery/signals.py#L30-L94), [celery/app/amqp.py:558-579](repo://celery/app/amqp.py#L558-L579), [celery/worker/strategy.py:165](repo://celery/worker/strategy.py#L165), [celery/app/trace.py:568-660](repo://celery/app/trace.py#L568-L660), [celery/app/trace.py:226-227](repo://celery/app/trace.py#L226-L227), [celery/app/trace.py:267-271](repo://celery/app/trace.py#L267-L271)

`before_task_publish` may modify `headers` in place, which is how tracing libraries propagate context into task messages. `task_prerun` and `task_postrun` run in the same process and thread as the task, which suits per-task setup and teardown such as database sessions. `task_failure` is also sent by the main process for failures the child could not report, such as a lost worker process or a hard time limit ([[Task Execution and Tracing]]). `task_sent` is a deprecated alias for `after_task_publish`.

Sources: [celery/app/amqp.py:558-576](repo://celery/app/amqp.py#L558-L576), [celery/worker/request.py:564-572](repo://celery/worker/request.py#L564-L572), [celery/worker/request.py:713-717](repo://celery/worker/request.py#L713-L717), [celery/signals.py:88-94](repo://celery/signals.py#L88-L94)

## Worker signals

| Signal | When | Sender |
| --- | --- | --- |
| `celeryd_init` | First thing in `celery worker`, before setup; use to configure per node | Node name |
| `worker_init` | `WorkController` set up, before bootsteps | Worker |
| `import_modules` | Loader about to import task modules (runs autodiscovery) | App |
| `celeryd_after_setup` | Queues selected, before start | Node name |
| `worker_ready` | Consumer connected and consuming | Consumer |
| `worker_before_create_process` | Prefork parent, before forking each child | Pool |
| `worker_process_init` | In each child after initialization (solo: once in the main process) | None |
| `worker_process_shutdown` | A prefork child exited | None (pid, exitcode) |
| `heartbeat_sent` | A worker heartbeat event was sent | Heart |
| `worker_shutting_down` | Shutdown signal received | Node name (sig, how, exitcode) |
| `worker_shutdown` | Worker stopping | Worker |

Sources: [celery/signals.py:96-115](repo://celery/signals.py#L96-L115), [celery/apps/worker.py:94-182](repo://celery/apps/worker.py#L94-L182), [celery/worker/worker.py:127](repo://celery/worker/worker.py#L127), [celery/worker/worker.py:198-199](repo://celery/worker/worker.py#L198-L199), [celery/concurrency/prefork.py:80-92](repo://celery/concurrency/prefork.py#L80-L92), [celery/concurrency/asynpool.py:490-493](repo://celery/concurrency/asynpool.py#L490-L493), [celery/worker/heartbeat.py:35-41](repo://celery/worker/heartbeat.py#L35-L41), [celery/apps/worker.py:301-314](repo://celery/apps/worker.py#L301-L314)

`worker_process_init` is the place to open per-process resources (database connections, clients) that must not be shared across a fork; receivers must finish quickly, because the pool considers a child that does not report readiness within `worker_proc_alive_timeout` as failed. The eventlet pool additionally sends `eventlet_pool_started`, `eventlet_pool_apply`, `eventlet_pool_preshutdown` and `eventlet_pool_postshutdown`.

Sources: [celery/concurrency/prefork.py:40-82](repo://celery/concurrency/prefork.py#L40-L82), [celery/signals.py:141-148](repo://celery/signals.py#L141-L148), [celery/concurrency/eventlet.py:110-121](repo://celery/concurrency/eventlet.py#L110-L121)

## Other signals

| Signal | When |
| --- | --- |
| `setup_logging` | Before Celery configures logging; if any receiver is connected, Celery skips its own configuration |
| `after_setup_logger` | After the global logger is configured (logger, loglevel, logfile, format, colorize) |
| `after_setup_task_logger` | After the task logger is configured |
| `beat_init` | `celery beat` service starting |
| `beat_embedded_init` | Beat starting embedded in a worker process |
| `user_preload_options` | After the CLI parsed preload options added by the app (app, options) |

Sources: [celery/signals.py:117-154](repo://celery/signals.py#L117-L154), [celery/app/log.py:98-128](repo://celery/app/log.py#L98-L128), [celery/beat.py:638-641](repo://celery/beat.py#L638-L641), [celery/bin/base.py:150-157](repo://celery/bin/base.py#L150-L157)

[[Logging]] shows how the logging signals interact with Celery's own configuration. The app object has four signals of its own, `on_configure`, `on_after_configure`, `on_after_finalize` and `on_after_fork`, described in [[The Celery Application]].

Sources: [celery/app/base.py:419-428](repo://celery/app/base.py#L419-L428)
