---
title: "Signals"
---
## Overview

Signals let application code run at fixed points in Celery's life cycle without subclassing anything: before a task message is published, before and after a task runs, when a worker process starts, when logging is configured, when beat starts. `celery.signals` defines them all as instances of `celery.utils.dispatch.Signal`, a thread-safe dispatcher derived from Django's. Senders call `signal.send(sender, **fields)`, and every connected receiver is called with those fields. Unlike [[Events and Monitoring]], signals stay in the process that sends them: a receiver runs in the worker, child, client or beat process where the event happens.

Sources: [celery/signals.py:14-28](repo://celery/signals.py#L14-L28), [celery/utils/dispatch/signal.py:73-102](repo://celery/utils/dispatch/signal.py#L73-L102)

## Connecting receivers

`signal.connect(receiver, sender=None, weak=True, dispatch_uid=None, retry=False)` registers a receiver, and also works as a decorator with or without arguments. Receivers must accept `**kwargs`; a receiver that does not is refused with `ValueError`, so that new fields can be added to a signal later without breaking it.

Sources: [celery/utils/dispatch/signal.py:110-216](repo://celery/utils/dispatch/signal.py#L110-L216)

```python
from celery.signals import task_prerun, worker_process_init

@task_prerun.connect
def log_start(sender=None, task_id=None, task=None, args=None, kwargs=None, **extra):
    print(f'starting {task.name}[{task_id}]')

@worker_process_init.connect(weak=False)
def open_db(**kwargs):
    connect_database()
```

Sources: [celery/signals.py:46-49](repo://celery/signals.py#L46-L49), [celery/signals.py:107-111](repo://celery/signals.py#L107-L111)

| Option | Effect |
| --- | --- |
| `sender` | Only call the receiver for that sender; `None` means any sender. For task signals the sender is the task object, so `sender=add` filters by task |
| `weak` | Keep only a weak reference (the default). A receiver defined inside a function is collected when it goes out of scope, so use `weak=False` there |
| `dispatch_uid` | Identifier that prevents the same receiver from being connected twice, for code that may be imported more than once |
| `retry` | Retry the receiver with backoff until it stops raising; implies a strong reference |

Sources: [celery/utils/dispatch/signal.py:110-186](repo://celery/utils/dispatch/signal.py#L110-L186), [celery/utils/dispatch/signal.py:303-340](repo://celery/utils/dispatch/signal.py#L303-L340)

A sender given as a `PromiseProxy`, such as a task decorated before the app is finalized, is resolved later: the connection is made when the proxy is first evaluated. Weak references to bound methods are created in a way that keeps working while the object lives, and dead receivers are removed automatically. `disconnect(receiver, sender, dispatch_uid)` removes a receiver and returns whether one was found.

Sources: [celery/utils/dispatch/signal.py:188-253](repo://celery/utils/dispatch/signal.py#L188-L253), [celery/utils/dispatch/signal.py:32-52](repo://celery/utils/dispatch/signal.py#L32-L52)

## Sending and errors

`send(sender, **named)` calls each live receiver registered for that sender or for any sender, passing `signal`, `sender` and the named fields, and returns a list of `(receiver, response)` pairs. A receiver that raises does not stop the others: the exception is logged as `Signal handler ... raised` and returned as that receiver's response. `send_robust` is an alias kept for Django compatibility.

Sources: [celery/utils/dispatch/signal.py:258-290](repo://celery/utils/dispatch/signal.py#L258-L290)

Callers rely on that return value in a few places. The loader re-raises the first exception returned by `import_modules` receivers, so a failing autodiscovery is not silent, and the logging setup checks whether `setup_logging` had any receivers. Hot paths avoid the call when nobody listens: the tracer reads `task_prerun.receivers`, `task_postrun.receivers` and `task_success.receivers` once and skips sending when the lists are empty.

Sources: [celery/loaders/base.py:97-105](repo://celery/loaders/base.py#L97-L105), [celery/app/log.py:98-128](repo://celery/app/log.py#L98-L128), [celery/app/trace.py:410-412](repo://celery/app/trace.py#L410-L412)

## Task signals

| Signal | Sent by / where | Sender | Fields |
| --- | --- | --- | --- |
| `before_task_publish` | Client, just before publishing | Task name | `body`, `exchange`, `routing_key`, `headers`, `properties`, `declare`, `retry_policy` |
| `after_task_publish` | Client, after publishing | Task name | `body`, `exchange`, `routing_key`, `headers` |
| `task_received` | Worker main process, when a message becomes a request | Consumer | `request` |
| `task_prerun` | Executing process, before the task body | Task | `task_id`, `task`, `args`, `kwargs` |
| `task_postrun` | Executing process, after the task, whatever its outcome | Task | `task_id`, `task`, `args`, `kwargs`, `retval`, `state` |
| `task_success` | Executing process, after success and result storage | Task | `result` |
| `task_retry` | Executing process, when the task raises `Retry` | Task | `request`, `reason`, `einfo` |
| `task_failure` | Executing process (or main process for hard time limits and lost workers) | Task | `task_id`, `exception`, `args`, `kwargs`, `traceback`, `einfo` |
| `task_internal_error` | Executing process, for errors outside the task body | Task | `task_id`, `args`, `kwargs`, `request`, `exception`, `traceback`, `einfo` |
| `task_revoked` | Worker main process | Task | `request`, `terminated`, `signum`, `expired` |
| `task_rejected` | Worker main process, for unknown or invalid messages | Consumer | `message`, `exc` |
| `task_unknown` | Worker main process, for unregistered task names | Consumer | `message`, `exc`, `name`, `id` |

Sources: [celery/signals.py:30-94](repo://celery/signals.py#L30-L94), [celery/app/amqp.py:552-580](repo://celery/app/amqp.py#L552-L580), [celery/app/trace.py:560-575](repo://celery/app/trace.py#L560-L575), [celery/app/trace.py:635-662](repo://celery/app/trace.py#L635-L662)

With the prefork pool, the "executing process" is a child process, so receivers of `task_prerun`, `task_postrun`, `task_success`, `task_retry` and most `task_failure` calls must be connected in code that the child imports, such as the task modules or a `worker_process_init` handler. `before_task_publish` is a good place to add custom headers, because it receives the headers dict before the message is sent. `task_sent` is deprecated in favour of `after_task_publish`. [[Task Execution and Tracing]] shows the exact order in which the tracer sends the task signals.

Sources: [celery/app/amqp.py:552-580](repo://celery/app/amqp.py#L552-L580), [celery/worker/request.py:529-594](repo://celery/worker/request.py#L529-L594), [celery/signals.py:88-94](repo://celery/signals.py#L88-L94)

## Worker signals

| Signal | When | Sender |
| --- | --- | --- |
| `celeryd_init` | First thing in `celery worker`, before configuration is finalized; can change per-node configuration | Node name (`instance`, `conf`, `options`) |
| `worker_init` | `WorkController` has set up queues and options, before bootsteps | Worker |
| `import_modules` | Loader is about to import task modules (runs lazy autodiscovery) | App |
| `celeryd_after_setup` | Worker started, queues selected, before the banner | Node name (`instance`, `conf`) |
| `worker_before_create_process` | Prefork, before each child process is forked | Pool |
| `worker_process_init` | In each new child process (and in solo pool), after setup | `None` |
| `worker_ready` | Consumer is ready and consuming | Consumer |
| `heartbeat_sent` | Each time the worker sends a heartbeat event | Heart |
| `worker_shutting_down` | A shutdown signal was received in the main process | Node name (`sig`, `how`, `exitcode`) |
| `worker_process_shutdown` | In the parent, when a child process exits | `None` (`pid`, `exitcode`) |
| `worker_shutdown` | Worker is stopping | Worker |

Sources: [celery/signals.py:96-115](repo://celery/signals.py#L96-L115), [celery/apps/worker.py:94-104](repo://celery/apps/worker.py#L94-L104), [celery/apps/worker.py:128-136](repo://celery/apps/worker.py#L128-L136), [celery/apps/worker.py:180-182](repo://celery/apps/worker.py#L180-L182), [celery/worker/worker.py:127-127](repo://celery/worker/worker.py#L127-L127), [celery/worker/worker.py:198-199](repo://celery/worker/worker.py#L198-L199)

`worker_process_init` is the place to open per-process resources such as database connections, since anything opened in the parent before forking would be shared by all children. Receivers of `worker_process_init` and `worker_process_shutdown` should finish quickly: a child that does not report itself as started within `worker_proc_alive_timeout` seconds is terminated.

Sources: [celery/concurrency/prefork.py:41-92](repo://celery/concurrency/prefork.py#L41-L92), [celery/concurrency/asynpool.py:428-453](repo://celery/concurrency/asynpool.py#L428-L453)

## Logging, beat, eventlet and CLI signals

| Signal | When | Fields |
| --- | --- | --- |
| `setup_logging` | Before Celery configures logging. If any receiver is connected, Celery does not configure logging at all | `loglevel`, `logfile`, `format`, `colorize` |
| `after_setup_logger` | After the root logger is configured | `logger`, `loglevel`, `logfile`, `format`, `colorize` |
| `after_setup_task_logger` | After the task logger is configured | same |
| `beat_init` | Beat service starts | sender: the service |
| `beat_embedded_init` | Beat starts embedded in a worker (`-B`) | sender: the service |
| `eventlet_pool_started`, `eventlet_pool_preshutdown`, `eventlet_pool_postshutdown` | Eventlet pool life cycle | sender: the pool |
| `eventlet_pool_apply` | Eventlet pool runs a task | `target`, `args`, `kwargs` |
| `user_preload_options` | A command parsed custom preload options added with `app.user_options['preload']` | `app`, `options` |

Sources: [celery/signals.py:117-154](repo://celery/signals.py#L117-L154), [celery/app/log.py:98-128](repo://celery/app/log.py#L98-L128), [celery/app/log.py:170-180](repo://celery/app/log.py#L170-L180), [celery/beat.py:633-641](repo://celery/beat.py#L633-L641), [celery/concurrency/eventlet.py:110-126](repo://celery/concurrency/eventlet.py#L110-L126), [celery/bin/base.py:150-158](repo://celery/bin/base.py#L150-L158)

Connecting anything to `setup_logging` takes over logging configuration entirely, which is how applications install their own `dictConfig`. Otherwise Celery configures the root logger, clearing existing handlers when `worker_hijack_root_logger` is true (the default), and then sends `after_setup_logger` so handlers can be added on top.

Sources: [celery/app/log.py:98-128](repo://celery/app/log.py#L98-L128)

## App signals

Each app also has four signals of its own, created in its constructor: `app.on_configure` (before configuration is read), `app.on_after_configure` (with the settings as `source`), `app.on_after_finalize` (once the task registry is complete) and `app.on_after_fork`. [[The Celery Application]] and [[Configuration and Loaders]] describe when they fire; `on_after_configure` is the usual place to call `add_periodic_task` ([[Periodic Tasks with Beat]]).

Sources: [celery/app/base.py:322-341](repo://celery/app/base.py#L322-L341), [celery/app/base.py:418-428](repo://celery/app/base.py#L418-L428)
