---
type: concept
title: Signals and Extension Points
description: How Celery's signal dispatcher works (weak references, sender filtering, retrying receivers, error isolation), the catalog of built-in signals, and the other supported seams for extending Celery — bootsteps, custom Task bases, task annotations, entry-point plugins for backends and CLI commands, custom pools, loaders and fixups.
tags: [signals, extension, bootsteps, annotations, plugins, entry-points]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:05:29.073Z
sources:
  - id: openwiki-source-5a0b6982dd7ddb0fabfabd0c
    resource: repo://celery/app/amqp.py
  - id: openwiki-source-6906cd292e916d4dea5699c8
    resource: repo://celery/app/annotations.py
  - id: openwiki-source-c4ebf7fa0abfe9f2d1eabf61
    resource: repo://celery/app/backends.py
  - id: openwiki-source-0fa67a77205fc742989db5af
    resource: repo://celery/app/log.py
  - id: openwiki-source-3795aa577fa7b0f3bd2af81a
    resource: repo://celery/app/task.py
  - id: openwiki-source-4e8c69ddbd86a82c3201bc63
    resource: repo://celery/bin/celery.py
  - id: openwiki-source-03401290efe2e461d5c3013a
    resource: repo://celery/concurrency/__init__.py
  - id: openwiki-source-7ef2718c0e261f897e55c1de
    resource: repo://celery/utils/dispatch/signal.py
  - id: openwiki-source-94b60a38fd26082deb41f979
    resource: repo://celery/worker/consumer/consumer.py
  - id: openwiki-source-12d3bd623a53e489a785c641
    resource: repo://celery/worker/worker.py
generated: { by: "claude-code", at: "2026-11-16T17:05:29.073Z" }
---

# Signals and Extension Points

Celery is designed to be extended without patching: lifecycle hooks are exposed as signals, worker composition uses bootsteps, and most subsystems are resolved from class paths or entry points.

## The signal dispatcher

`celery/utils/dispatch/signal.py` contains `Signal`, a fork of Django's dispatcher. Every signal in `celery/signals.py` is an instance of it, and the app also owns per-app signals (`app.on_configure`, `on_after_configure`, `on_after_finalize`, `on_after_fork`).

Key behaviours:

- **Connecting.** `signal.connect(fun, sender=None, weak=True, dispatch_uid=None, retry=False)` works directly or as a decorator (`@task_prerun.connect` or `@task_prerun.connect(sender=...)`). Receivers must accept `**kwargs`; otherwise `ValueError` is raised.
- **Weak references.** By default receivers are held weakly (`WeakMethod` for bound methods) and are dropped when garbage-collected. Locally defined closures therefore need `weak=False` or they may silently disappear.
- **De-duplication.** A receiver is keyed by `(dispatch_uid or id(receiver), id(sender))`, so connecting the same function twice for the same sender is a no-op.
- **Sender filtering.** A receiver connected with `sender=X` only fires when `send(sender=X)` is called with the same object identity; `sender=None` receives everything. If the sender is a lazy `PromiseProxy` (e.g. an unevaluated task), connection is deferred until the proxy evaluates.
- **Retrying receivers.** With `retry=True` the receiver is wrapped in `retry_over_time` so transient exceptions are retried with backoff (forcing a strong reference).
- **Error isolation.** `send()` catches any exception raised by a receiver, logs it, and returns it in the `(receiver, response)` list rather than propagating. `send_robust` is an alias. Callers that need to fail on handler errors (such as the loader's `import_modules` handling) inspect the responses themselves.
- **Caching.** Optional `use_caching` stores per-sender receiver lists in a `WeakKeyDictionary`, cleared on connect/disconnect.

## Signal catalog

| Group | Signals | Typical sender |
|-------|---------|----------------|
| Publishing | `before_task_publish`, `after_task_publish` | task **name** (string) |
| Task execution | `task_received`, `task_prerun`, `task_postrun`, `task_success`, `task_retry`, `task_failure`, `task_internal_error`, `task_revoked`, `task_rejected`, `task_unknown` | task object, or request/consumer |
| Deprecated | `task_sent` | — |
| Worker lifecycle | `celeryd_init`, `celeryd_after_setup`, `worker_init`, `worker_before_create_process`, `worker_process_init`, `worker_process_shutdown`, `worker_ready`, `worker_shutting_down`, `worker_shutdown`, `heartbeat_sent` | worker/consumer; `worker_process_init` uses `sender=None` |
| Module loading | `import_modules` | app |
| Logging | `setup_logging`, `after_setup_logger`, `after_setup_task_logger` | — |
| Beat | `beat_init`, `beat_embedded_init` | beat service |
| Eventlet pool | `eventlet_pool_started`, `eventlet_pool_preshutdown`, `eventlet_pool_postshutdown`, `eventlet_pool_apply` | pool |
| CLI | `user_preload_options` | the click command |

Because senders differ, filtering by `sender=` must match the right object (for example `before_task_publish.connect(sender='proj.tasks.add')` but `task_prerun.connect(sender=add_task)`).

Where signals fire:

- `before/after_task_publish` — `celery/app/amqp.py` inside `send_task_message`.
- Task execution signals — `celery/app/trace.py` (the tracer only looks up receivers once per tracer for speed) and `celery/worker/request.py` for revoked/rejected/unknown.
- `worker_init` — `WorkController.__init__`; `celeryd_init`/`worker_ready` — `celery/apps/worker.py`; `worker_process_init` — pool child initialisation in `celery/concurrency/prefork.py` (and the solo pool).
- `setup_logging` — `celery/app/log.py`; if any receiver is connected, Celery skips configuring logging itself.

## Other extension seams

### Bootsteps (worker and consumer components)

Custom components are added with `app.steps['worker'].add(MyStep)` or `app.steps['consumer'].add(MyStep)`; the worker and consumer blueprints are constructed with these extra steps (`celery/worker/worker.py`, `celery/worker/consumer/consumer.py`). Base classes in `celery/bootsteps.py`:

- `Step` — `create()` at build time; `requires` lists dependencies by class path; `include_if()`/`enabled`/`conditional` control inclusion.
- `StartStopStep` — adds `start/stop/terminate/close` and is registered with the parent so it is started in dependency order.
- `ConsumerStep` — implement `get_consumers(channel)` to attach extra kombu consumers to the worker's broker connection (requires the `Connection` step).

See [Worker Architecture and Bootsteps](../worker/worker-architecture.md).

### Custom Task base classes

Pass `base=MyTask` to `@app.task`, set `Celery(task_cls=...)`, or subclass `celery.Task` and override hooks such as `before_start`, `on_success`, `on_failure`, `on_retry`, `after_return`, or class attributes (`autoretry_for`, `acks_late`, `Request` class, `Strategy`). See [Task Definition and Invocation](../tasks/task-definition-and-invocation.md).

### Task annotations

The `task_annotations` setting monkey-patches task classes from configuration (`celery/app/annotations.py`). It accepts a dict (`{'tasks.add': {'rate_limit': '10/s'}}`, with `'*'` matching all tasks), an object with `annotate(task)`/`annotate_any()`, a class path string, or a list of those. During `Task.bind`, `Task.annotate()` applies every match: keys starting with `@` wrap the named method via `add_around` (e.g. `'@on_failure'`), other keys are set as class attributes.

### Entry-point plugins

`celery.utils.imports.load_extension_class_names(namespace)` reads Python entry points:

- `celery.result_backends` — extra backend aliases merged into `BACKEND_ALIASES` by `celery.app.backends.by_name` (along with the loader's `override_backends`).
- `celery.commands` — extra click commands added to the `celery` CLI (`celery/bin/celery.py`).

### Command-line options

`app.user_options['worker' | 'beat' | 'events' | 'preload']` lists click options appended to the respective commands; preload options are delivered to the `user_preload_options` signal.

### Pools, loaders, fixups, backends and schedulers

- Pools: `--pool custom` with `CELERY_CUSTOM_WORKER_POOL=package:Class` (`celery/concurrency/__init__.py`), or any `module:Class` path.
- Loaders: `Celery(loader=...)` or `CELERY_LOADER`.
- Fixups: `Celery(fixups=[...])`, each a callable `fixup(app)`.
- Result backends: `result_backend='package.module:BackendClass'` or a URL scheme alias.
- Beat schedulers: `beat_scheduler` (e.g. django-celery-beat's database scheduler).
- Routers: callables or class paths in `task_routes` (see [Message Protocol, Queues and Routing](../tasks/messaging-and-routing.md)).
- Subsystem classes on the app: `amqp`, `events`, `log`, `control` keyword arguments to `Celery(...)`.

## Tests

- `t/unit/utils/test_dispatcher.py` — weak references, sender filtering, `dispatch_uid`, retry receivers.
- `t/unit/app/test_annotations.py`, `t/unit/worker/test_bootsteps.py`.
- `t/smoke/tests/test_signals.py` — signals in a real worker.

## Related

- [Worker Architecture and Bootsteps](../worker/worker-architecture.md)
- [Task Execution, Tracing and Retries](../tasks/execution-tracing-and-retries.md)
