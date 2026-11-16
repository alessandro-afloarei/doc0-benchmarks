---
title: "Defining Tasks"
---
## Overview

A task is a subclass of `celery.app.task.Task` with one instance per app, registered under a unique name. The class carries the options that govern how the task is sent and run (retries, time limits, acknowledgement, result storage); the instance's `run` method is the code the worker executes. Most tasks are written as plain functions and turned into classes by the `@app.task` decorator.

Sources: [celery/app/task.py:206-235](repo://celery/app/task.py#L206-L235), [celery/app/base.py:590-633](repo://celery/app/base.py#L590-L633)

This page covers how a task class is built and configured, the request context it sees while running, and the hooks and exceptions it uses to retry, reject or replace itself. Calling a task is on [[Sending Tasks and Routing]]; what the worker does around `run` is on [[Task Execution and Tracing]]; when the decorator defers creation is on [[The Celery Application]].

Sources: [celery/app/task.py:495-522](repo://celery/app/task.py#L495-L522)

## From function to task class

`app._task_from_fun(fun, name=None, base=None, bind=False, **options)` builds the class:

Sources: [celery/app/base.py:590-602](repo://celery/app/base.py#L590-L602)

1. The name defaults to `gen_task_name(app, fun.__name__, fun.__module__)`: the module path and function name, with the module replaced by `app.main` when the function lives in `__main__`.
2. If the registry already has that name, the existing task is returned unchanged.
3. With `pydantic=True`, the function is wrapped by `pydantic_wrapper` first.
4. A new class is created with `type(fun.__name__, (base,), …)`: `run` is the function itself when `bind=True` (so it receives the task as `self`) and a `staticmethod` otherwise. Every other decorator option becomes a class attribute, and `__header__` gets a checker built from the function signature.
5. The class is instantiated, stored in `app._tasks`, bound with `task.bind(app)`, and wrapped with auto-retry behaviour.

Sources: [celery/app/base.py:590-633](repo://celery/app/base.py#L590-L633), [celery/utils/imports.py:122-141](repo://celery/utils/imports.py#L122-L141)

```python
@app.task(bind=True, max_retries=5, acks_late=True, autoretry_for=(IOError,))
def fetch(self, url):
    ...
```

Sources: [celery/app/base.py:515-585](repo://celery/app/base.py#L515-L585)

`base` defaults to `app.Task`, a subclass of `task_cls` created with `subclass_with_self`; passing `task_cls='proj.tasks:MyBase'` to `Celery` sets a project-wide base class. Class-based tasks are added with `app.register_task(MyTask)`, which instantiates the class, generates a name if none is set and binds it the same way.

Sources: [celery/app/base.py:635-652](repo://celery/app/base.py#L635-L652), [celery/app/base.py:1335-1340](repo://celery/app/base.py#L1335-L1340)

## Binding and option defaults

`Task.bind(app)` runs when the app finalizes and again on first use. It stores the app, sets `typing` from `app.strict_typing` when unset, and copies a setting into every attribute listed in `from_config` that is still `None`: `serializer` from `task_serializer`, `rate_limit` from `task_default_rate_limit`, `time_limit`, `soft_time_limit`, `track_started`, `acks_late`, `acks_on_failure`, `acks_on_timeout`, `reject_on_worker_lost`, `ignore_result`, `store_eager_result` and `store_errors_even_if_ignored`. A value set on the class or passed to the decorator therefore always beats the app setting.

Sources: [celery/app/task.py:396-455](repo://celery/app/task.py#L396-L455)

When `acks_on_failure` or `acks_on_timeout` is still unset after this, it takes the deprecated `acks_on_failure_or_timeout` value, or `True`. On the first bind the class is also annotated and given a `LocalStack` for its requests, then `on_bound(app)` runs as an extension hook.

Sources: [celery/app/task.py:432-455](repo://celery/app/task.py#L432-L455)

The options a task class reads:

Sources: [celery/app/task.py:206-214](repo://celery/app/task.py#L206-L214)

| Attribute | Default | Meaning |
| --- | --- | --- |
| `name` | generated | Registry key and message `task` header |
| `max_retries` | `3` | Retries allowed before `MaxRetriesExceededError`; `None` retries forever |
| `default_retry_delay` | `180` | Seconds before a retry when no countdown is given |
| `rate_limit` | `task_default_rate_limit` | `'100/s'`, `'100/m'` or `'100/h'` per worker |
| `ignore_result` | `task_ignore_result` | Do not store state or return value |
| `time_limit`, `soft_time_limit` | settings | Hard kill and `SoftTimeLimitExceeded` limits in seconds |
| `acks_late` | `task_acks_late` | Acknowledge after the task runs instead of before |
| `reject_on_worker_lost` | setting | Requeue instead of acknowledge when the pool process dies |
| `track_started` | `task_track_started` | Store a `STARTED` state when execution begins |
| `throws` | `()` | Expected exceptions, stored as failures but not logged as errors |
| `priority`, `expires` | `None` | Message defaults |
| `typing` | `app.strict_typing` | Check call arguments against the signature on send |
| `Strategy`, `Request` | `celery.worker.strategy:default`, `celery.worker.request:Request` | Worker-side classes for this task |

Sources: [celery/app/task.py:216-262](repo://celery/app/task.py#L216-L262), [celery/app/task.py:300-397](repo://celery/app/task.py#L300-L397)

## The task registry

`app.tasks` is a `TaskRegistry`, a `dict` from name to task instance. A missing key raises `NotRegistered`; the worker's consumer logs a message for an unregistered name as an unknown task. `register` requires a name, instantiates classes and adds auto-retry; `unregister` removes by name or task.

Sources: [celery/app/registry.py:12-47](repo://celery/app/registry.py#L12-L47), [celery/worker/consumer/consumer.py:677-689](repo://celery/worker/consumer/consumer.py#L677-L689)

Tasks pickle as their name and module. Unpickling imports the module, so the task registers itself, and then reads the task from the current app's registry. A task sent inside another object therefore always resolves to the receiving process's own instance.

Sources: [celery/app/task.py:506-514](repo://celery/app/task.py#L506-L514), [celery/app/registry.py:61-68](repo://celery/app/registry.py#L61-L68)

## Annotations

The `task_annotations` setting changes task attributes from configuration, without editing the code. `annotations.prepare` turns each entry into a `MapAnnotation` (a dict of task name, or `'*'` for all tasks, to attributes) or a lazily instantiated object with an `annotate(task)` method. On the first bind, `Task.annotate` applies the first match for the task and the first `'*'` match; a key starting with `@`, such as `'@on_failure'`, wraps the existing method with the given function instead of replacing it.

Sources: [celery/app/annotations.py:18-52](repo://celery/app/annotations.py#L18-L52), [celery/app/task.py:477-493](repo://celery/app/task.py#L477-L493)

## Request context

Inside a running task, `self.request` is a `Context` holding the message's metadata: `id`, `args`, `kwargs`, `retries`, `root_id`, `parent_id`, `group`, `chord`, `callbacks`, `errbacks`, `delivery_info`, `hostname`, `is_eager`, `called_directly`, `timelimit`, and any custom headers. Requests live on a per-task `LocalStack`, so a task called directly from inside itself gets its own context and the outer one returns when it finishes.

Sources: [celery/app/task.py:75-130](repo://celery/app/task.py#L75-L130), [celery/app/task.py:1234-1255](repo://celery/app/task.py#L1234-L1255)

Calling a task object directly (`add(2, 2)`) runs `run` in the current process: `__call__` pushes the task on the global task stack and a new request whose `called_directly` stays `True`, then pops both. `Context.as_execution_options` converts a request back into `apply_async` options; `retry` and `signature_from_request` use it to resend the same task with the same ids, links and limits.

Sources: [celery/app/task.py:495-504](repo://celery/app/task.py#L495-L504), [celery/app/task.py:168-196](repo://celery/app/task.py#L168-L196)

`apply()` runs the task eagerly through the same tracer the worker uses, with a request marked `is_eager`, and returns an `EagerResult`. `task_always_eager` makes `apply_async` call it; exceptions propagate only when `throw` or `task_eager_propagates` is set.

Sources: [celery/app/task.py:869-951](repo://celery/app/task.py#L869-L951)

## Retrying

`self.retry(exc=None, countdown=None, eta=None, max_retries=None, throw=True, **options)` sends a new copy of the current task and stops the current run:

Sources: [celery/app/task.py:756-757](repo://celery/app/task.py#L756-L757)

1. When called outside a worker (`called_directly`), it re-raises `exc`, or a `Retry`.
2. Without an ETA or countdown it uses `default_retry_delay`.
3. It builds a signature from the request with `retries + 1`.
4. Past `max_retries` it raises `exc`, or `MaxRetriesExceededError` when no exception was given.
5. Otherwise it sends the signature with `apply_async`; if sending fails, it raises `Reject(requeue=False)`.
6. It raises `Retry`, which the tracer records as the `RETRY` state instead of a failure. With `throw=False` it returns the `Retry` instead.

Sources: [celery/app/task.py:820-867](repo://celery/app/task.py#L820-L867), [celery/exceptions.py:145-187](repo://celery/exceptions.py#L145-L187)

`autoretry_for` does this automatically. `add_autoretry_behaviour` wraps `run` so that an exception listed in `autoretry_for`, and not in `dont_autoretry_for`, calls `task.retry(exc=exc, **retry_kwargs)`. With `retry_backoff` set, the countdown grows exponentially from that factor up to `retry_backoff_max` (600 seconds), with full jitter unless `retry_jitter=False`. `Ignore` and `Retry` pass through unchanged.

Sources: [celery/app/autoretry.py:8-66](repo://celery/app/autoretry.py#L8-L66)

## Control-flow exceptions

| Exception | Raised by | Effect |
| --- | --- | --- |
| `Retry` | `self.retry()` | State `RETRY`; `on_retry` handler |
| `Ignore` | the task, or `replace()` | No state is stored and no handlers run |
| `Reject(reason, requeue=False)` | the task | The message is rejected, or requeued with `requeue=True` |
| `MaxRetriesExceededError` | `retry()` | Ordinary failure |

Sources: [celery/exceptions.py:141-204](repo://celery/exceptions.py#L141-L204), [celery/exceptions.py:242-249](repo://celery/exceptions.py#L242-L249)

## Handlers

A base class can override hooks that the worker calls around `run`: `before_start(task_id, args, kwargs)`, `on_success(retval, task_id, args, kwargs)`, `on_retry(exc, task_id, args, kwargs, einfo)`, `on_failure(exc, task_id, args, kwargs, einfo)` and `after_return(status, retval, task_id, args, kwargs, einfo)`. The tracer skips `before_start`, `on_success` and `after_return` when the class does not override them. `update_state(state=..., meta=...)` stores a custom state for the current task, for example progress.

Sources: [celery/app/task.py:1121-1209](repo://celery/app/task.py#L1121-L1209), [celery/app/trace.py:393-398](repo://celery/app/trace.py#L393-L398)

## Replacing a task

`return self.replace(sig)` hands the current task's id to a new signature, so callers waiting on the original result get the new one. `replace` refuses a signature that is part of a chord or an empty chain, and turns a group into a chord ending with the built-in `celery.accumulate`. It moves the request's callbacks and errbacks onto the new signature, freezes it with the current task id, copies the chord, group and root ids, increments `replaced_task_nesting`, and appends the remaining tasks of the current chain. `on_replace` then sends the signature and raises `Ignore`; in eager mode it applies the signature and returns its value.

Sources: [celery/app/task.py:1029-1095](repo://celery/app/task.py#L1029-L1095), [celery/app/task.py:1211-1227](repo://celery/app/task.py#L1211-L1227)

`add_to_chord(sig)` adds a task to the chord the current task belongs to, by registering its result with the backend; [[Canvas: Signatures and Workflows]] explains chords.

Sources: [celery/app/task.py:1097-1119](repo://celery/app/task.py#L1097-L1119)

## Pydantic arguments

With `@app.task(pydantic=True)`, `pydantic_wrapper` validates each argument whose type hint is a pydantic `BaseModel` (or `Optional` of one) with `model_validate`, passing `celery_app` and `celery_task_name` in the validation context. A returned model whose class matches the return annotation is converted with `model_dump(mode='json')`, so it can be serialized as JSON. `pydantic_strict`, `pydantic_context` and `pydantic_dump_kwargs` tune the calls.

Sources: [celery/app/base.py:127-205](repo://celery/app/base.py#L127-L205)

## Built-in tasks

`celery/app/builtins.py` registers tasks on every app through `connect_on_app_finalize`: `celery.backend_cleanup` (deletes expired results), `celery.accumulate` (used by `replace`), `celery.chord_unlock` (polls a chord's header for backends without native chord support), and `celery.map`, `celery.starmap`, `celery.chunks`, `celery.group`, `celery.chain` and `celery.chord`, which the canvas primitives send.

Sources: [celery/app/builtins.py:12-40](repo://celery/app/builtins.py#L12-L40), [celery/app/builtins.py:101-186](repo://celery/app/builtins.py#L101-L186)
