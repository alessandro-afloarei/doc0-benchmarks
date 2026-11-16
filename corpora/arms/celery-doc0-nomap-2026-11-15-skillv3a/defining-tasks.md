---
title: "Defining Tasks"
---
## Overview

A task is an instance of a subclass of `celery.app.task.Task`, registered in an app under a unique name. Workers look tasks up by that name when a message arrives, and callers use the same object to send messages. Most tasks are written as plain functions and turned into a class by the `@app.task` decorator; the class carries the options (retry policy, time limits, acknowledgement mode, serializer) and the handlers that run around the function.

Sources: [celery/app/task.py:205-226](repo://celery/app/task.py#L205-L226), [celery/app/base.py:590-633](repo://celery/app/base.py#L590-L633)

This page covers how a task class is built, registered and configured, what `self.request` contains, and how to run a task in-process. Sending a task is described in [[Publishing Task Messages]], failure and retry in [[Retries, Errors and Task States]], and the deferred evaluation of decorators in [[The Celery Application]].

Sources: [celery/app/task.py:495-535](repo://celery/app/task.py#L495-L535)

## From function to task class

`@app.task` accepts either a bare function or keyword options (`@app.task(bind=True, max_retries=5)`). When the app is finalized, or immediately with `lazy=False`, `_task_from_fun` creates the class:

Sources: [celery/app/base.py:515-585](repo://celery/app/base.py#L515-L585)

1. The name is the `name` option or `gen_task_name(app, fun.__name__, fun.__module__)`: `module.function`, with `__main__` replaced by `app.main` when the task lives in the script being run.
2. The base class is the `base` option or `app.Task`, the app's default task class (configurable with the `task_cls` constructor argument).
3. With `pydantic=True` the function is wrapped by `pydantic_wrapper` first.
4. `type(fun.__name__, (base,), {...})` creates the class with `run` set to the function (a `staticmethod` unless `bind=True`), `__header__` set to a signature checker, and every other option as a class attribute; the class is instantiated once.
5. The instance is stored in the registry, bound to the app, and `add_autoretry_behaviour` wraps `run` if `autoretry_for` was given.

Sources: [celery/app/base.py:590-633](repo://celery/app/base.py#L590-L633), [celery/utils/imports.py:122-141](repo://celery/utils/imports.py#L122-L141)

If a task with that name is already registered, the existing instance is returned and the options are ignored, so importing a task module twice is harmless.

Sources: [celery/app/base.py:604-633](repo://celery/app/base.py#L604-L633)

```python
@app.task(bind=True, name='proj.refresh', max_retries=5, rate_limit='10/m')
def refresh(self, url):
    self.update_state(state='PROGRESS', meta={'url': url})
    return fetch(url)
```

Sources: [celery/app/base.py:515-553](repo://celery/app/base.py#L515-L553), [celery/app/task.py:1121-1133](repo://celery/app/task.py#L1121-L1133)

A task can also be written as a class: subclass `app.Task`, set `name` and define `run`, then pass an instance to `app.register_task`. That path also applies `add_autoretry_behaviour` and binds the task.

Sources: [celery/app/base.py:635-652](repo://celery/app/base.py#L635-L652)

## Binding and option defaults

### Where option values come from

`Task.bind(app)` is a classmethod run when the task is registered and again for every task at finalization. It fills every option still set to `None` from the matching setting in `from_config` (for example `acks_late` from `task_acks_late`, `serializer` from `task_serializer`, `ignore_result` from `task_ignore_result`), derives `acks_on_failure` and `acks_on_timeout` from `acks_on_failure_or_timeout` (default `True`), applies annotations the first time, creates the per-class `request_stack`, and calls the `on_bound` hook. A class attribute set on the task therefore always wins over the app setting.

Sources: [celery/app/task.py:396-475](repo://celery/app/task.py#L396-L475)

| Option | Default | Effect |
| --- | --- | --- |
| `name` | generated | Registry key and message `task` header |
| `typing` | `app.strict_typing` | Check call arguments against the function signature |
| `max_retries` | `3` | Retry limit (`None` = unlimited) |
| `default_retry_delay` | `180` | Seconds before a retry |
| `rate_limit` | `task_default_rate_limit` | e.g. `'100/m'`, enforced per worker |
| `ignore_result` | `task_ignore_result` | Do not store state or return value |
| `serializer` | `task_serializer` | Message serializer |
| `time_limit`, `soft_time_limit` | `task_time_limit`, `task_soft_time_limit` | Hard kill and soft exception limits |
| `track_started` | `task_track_started` | Store a `STARTED` state |
| `acks_late` | `task_acks_late` | Acknowledge after execution instead of before |
| `reject_on_worker_lost` | `task_reject_on_worker_lost` | Requeue when the child process dies |
| `throws` | `()` | Expected exceptions, logged without traceback |
| `expires`, `priority` | `None` | Default publish options |
| `trail` | `True` | Record children in `request.children` |
| `send_events` | `True` | Allow task events for this task |

Sources: [celery/app/task.py:230-311](repo://celery/app/task.py#L230-L311), [celery/app/task.py:359-411](repo://celery/app/task.py#L359-L411)

Publishing options that are attributes of the task (`queue`, `routing_key`, `exchange`, `priority`, `expires`, `serializer`, `delivery_mode`, `compression`, `time_limit`, `soft_time_limit`) are collected once by `extract_exec_options` and cached in `_exec_options`, which `apply_async` merges under the caller's own options.

Sources: [celery/app/task.py:31-36](repo://celery/app/task.py#L31-L36), [celery/app/task.py:1256-1259](repo://celery/app/task.py#L1256-L1259)

### Argument checking

`__header__` is produced by `head_from_fun`, which `exec`s an empty function with the same signature as the task. `apply_async` calls it with the given `args` and `kwargs` when `typing` is true, so a wrong number of arguments raises `TypeError` in the caller instead of failing later in a worker. Generating a real function is faster than `inspect.Signature.bind`.

Sources: [celery/utils/functional.py:364-394](repo://celery/utils/functional.py#L364-L394), [celery/app/task.py:662-668](repo://celery/app/task.py#L662-L668)

### Annotations

The `task_annotations` setting changes task attributes from configuration without touching code. Each entry is a dict mapping a task name (or `'*'` for all tasks) to attributes, or an object with `annotate(task)`/`annotate_any()` methods, or the dotted name of such a class. A key starting with `@` wraps the named method instead of replacing it: `{'@on_failure': wrapper}` calls `wrapper(original)` and installs the result.

Sources: [celery/app/annotations.py:1-52](repo://celery/app/annotations.py#L1-L52), [celery/app/task.py:477-493](repo://celery/app/task.py#L477-L493)

### Pydantic arguments

With `@app.task(pydantic=True)`, arguments annotated with a pydantic `BaseModel` (or `Optional` of one) are validated from the plain dict in the message with `model_validate`, using `pydantic_strict` and a context that includes the app and task name. If the return annotation is a model class and the function returns an instance of it, the value is converted with `model_dump(mode='json', ...)` so it can be serialized as JSON. Pydantic must be installed or `ImproperlyConfigured` is raised.

Sources: [celery/app/base.py:127-205](repo://celery/app/base.py#L127-L205)

## The task registry

`app.tasks` is a `TaskRegistry`, a dict from name to task instance. Looking up a missing name raises `NotRegistered`, which the worker reports as an unknown task. `register` requires a `name` and instantiates classes; `unregister` accepts a name or a task.

Sources: [celery/app/registry.py:12-58](repo://celery/app/registry.py#L12-L58)

Tasks pickle to their name and module only. `_unpickle_task_v2` imports the module if needed and fetches the task from the current app's registry, so a task object passed to a child process resolves to that process's own instance.

Sources: [celery/app/task.py:506-514](repo://celery/app/task.py#L506-L514), [celery/app/registry.py:61-68](repo://celery/app/registry.py#L61-L68)

Every app also registers built-in tasks through `connect_on_app_finalize`: `celery.backend_cleanup`, `celery.accumulate`, `celery.chord_unlock`, `celery.map`, `celery.starmap`, `celery.chunks`, `celery.group`, `celery.chain` and `celery.chord`. They support result expiry and the canvas primitives described in [[Groups and Chords]].

Sources: [celery/app/builtins.py:12-34](repo://celery/app/builtins.py#L12-L34)

## The request context

Inside a running task, `self.request` is a `Context` holding the message's metadata: `id`, `args`, `kwargs`, `retries`, `eta`, `expires`, `group`, `group_index`, `chord`, `chain`, `callbacks`, `errbacks`, `root_id`, `parent_id`, `delivery_info` (exchange, routing key, priority, redelivered), `hostname`, `reply_to`, `is_eager`, the time limits, stamps and any custom headers. A bound task (`bind=True`) receives the task instance as `self`; an unbound task can reach the same data through `current_task.request`.

Sources: [celery/app/task.py:75-129](repo://celery/app/task.py#L75-L129)

Requests are kept on a thread-local `request_stack` per task class. `__call__` pushes a new `Context` built from the current one plus the call's arguments, runs `run`, and pops it, so calling a task as a function from inside another task never corrupts the outer request. When no request is active, `request` returns an empty default `Context`.

Sources: [celery/app/task.py:495-502](repo://celery/app/task.py#L495-L502), [celery/app/task.py:1234-1254](repo://celery/app/task.py#L1234-L1254)

`Context.as_execution_options()` turns a request back into `apply_async` options (same id, group, chord, chain, callbacks, headers minus RabbitMQ's `x-death` headers). Retries and `Task.replace` use it to re-send a task with its identity intact.

Sources: [celery/app/task.py:160-195](repo://celery/app/task.py#L160-L195)

## Handlers

A `Task` subclass can override handlers that the worker's tracer calls around `run`. The tracer only calls `before_start`, `on_success` and `after_return` if the class actually overrides them, which keeps the default path cheap. Their return values are ignored.

Sources: [celery/app/trace.py:390-398](repo://celery/app/trace.py#L390-L398)

| Handler | Called when | Arguments |
| --- | --- | --- |
| `before_start` | Before `run`, after the prerun signal | `task_id, args, kwargs` |
| `on_success` | `run` returned and the result was stored | `retval, task_id, args, kwargs` |
| `on_retry` | The task raised `Retry` | `exc, task_id, args, kwargs, einfo` |
| `on_failure` | The task raised any other exception | `exc, task_id, args, kwargs, einfo` |
| `after_return` | After every outcome except ignored/rejected | `status, retval, task_id, args, kwargs, einfo` |
| `on_replace` | `self.replace(sig)` was called | `sig` |

Sources: [celery/app/task.py:1135-1227](repo://celery/app/task.py#L1135-L1227), [celery/app/trace.py:580-655](repo://celery/app/trace.py#L580-L655), [celery/app/trace.py:212-270](repo://celery/app/trace.py#L212-L270)

`update_state(task_id=None, state=None, meta=None)` stores an arbitrary state and metadata for the current task (or another id) through the backend, which is how a task reports progress to callers polling `AsyncResult.state` and `.info`.

Sources: [celery/app/task.py:1121-1133](repo://celery/app/task.py#L1121-L1133)

## Running a task locally

There are three ways to run a task without a worker.

Sources: [celery/app/task.py:495-502](repo://celery/app/task.py#L495-L502), [celery/app/task.py:869-951](repo://celery/app/task.py#L869-L951)

| Call | What runs | Result |
| --- | --- | --- |
| `add(2, 2)` | `run` directly, with a pushed request (`called_directly=True`) | The return value; exceptions propagate |
| `add.apply((2, 2))` | The full tracer in eager mode: signals, handlers, callbacks, chain | `EagerResult` |
| `add.delay(2, 2)` with `task_always_eager=True` | Arguments are serialized and deserialized, then `apply` | `EagerResult` |

Sources: [celery/app/task.py:683-701](repo://celery/app/task.py#L683-L701), [celery/app/task.py:869-951](repo://celery/app/task.py#L869-L951)

`apply` builds a request dict with `is_eager=True`, takes `parent_id` and `root_id` from the task on top of the stack, and runs `build_tracer(..., eager=True, propagate=throw)`. `throw` defaults to `task_eager_propagates`; when false, a failure is captured in the `EagerResult` with its traceback. If the task raised `Retry` with a signature, `apply` runs that signature again with `retries + 1`, so eager retries actually repeat. Eager results are not stored in the backend unless `store_eager_result` is set. [[Testing Utilities]] discusses when eager mode is a good substitute for a worker.

Sources: [celery/app/task.py:884-951](repo://celery/app/task.py#L884-L951), [celery/app/trace.py:490-496](repo://celery/app/trace.py#L490-L496)

## Shared tasks

`@shared_task` defines a task without referring to an app, which library code and reusable Django apps need. It registers a finalizer so every app gets the task, adds it to apps already finalized, and returns a proxy that resolves the task from the current app's registry on each access.

Sources: [celery/app/__init__.py:24-76](repo://celery/app/__init__.py#L24-L76)
