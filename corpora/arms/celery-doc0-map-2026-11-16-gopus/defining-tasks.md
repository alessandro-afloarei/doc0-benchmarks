---
title: "Defining Tasks"
---
## Overview

A Celery task is an instance of a `Task` subclass registered under a name in the app's task registry. You rarely write the subclass yourself: `@app.task` (or `@shared_task`) generates one per decorated function, with the function as its `run` method and the decorator's keyword arguments as class attributes. The worker later looks the task up by the name carried in the message, so the name is the contract between the code that sends a task and the code that runs it.

Sources: [celery/app/base.py:590-633](repo://celery/app/base.py#L590-L633), [celery/app/registry.py:11-30](repo://celery/app/registry.py#L11-L30)

This page follows a function from the decorator to a bound task object and describes what the task carries: its options, its request context and its handler hooks. Calling the task is covered in [[Sending Tasks]], and retries and failure handling in [[Retries, Failures and Time Limits]].

Sources: [celery/app/task.py:206-220](repo://celery/app/task.py#L206-L220)

## From decorator to task class

### The task decorator

`app.task` accepts either a bare function or keyword options. For each function it registers a constructor with `connect_on_app_finalize` when `shared=True` (the default), so every app finalized later gets its own copy of the task. If the app is already finalized or `lazy=False` it builds the task immediately; otherwise it returns a `PromiseProxy` and queues it in `app._pending`, to be evaluated during finalization ([[The Celery Application]]). A `filter` option is applied to the result before it is returned.

Sources: [celery/app/base.py:515-585](repo://celery/app/base.py#L515-L585)

When the process was started by multiprocessing with `execv` (`FORKED_BY_MULTIPROCESSING` set), the decorator returns `shared_task(..., lazy=False)` instead. The comment explains that a task in the original module would otherwise point at a different app instance than the one the child uses.

Sources: [celery/app/base.py:84-87](repo://celery/app/base.py#L84-L87), [celery/app/base.py:546-554](repo://celery/app/base.py#L546-L554)

`_task_from_fun` does the work:

Sources: [celery/app/base.py:590-600](repo://celery/app/base.py#L590-L600)

1. It refuses to run on an unfinalized app created with `autofinalize=False`.
2. It computes the name, `name` or `gen_task_name(fun.__name__, fun.__module__)`, and takes `base` or `app.Task` as the base class.
3. If the name is already in the registry it returns the existing task, so decorating twice is harmless.
4. With `pydantic=True` it wraps the function in `pydantic_wrapper`.
5. It creates the class with `type()`, setting `app`, `name`, `run` (a `staticmethod` unless `bind=True`, in which case the task instance is passed as `self`), the docstring, module, annotations, `__header__` (the argument checker built by `head_from_fun`) and `__wrapped__`, plus every remaining option as a class attribute. It instantiates the class immediately.
6. It stores the instance in the registry, calls `task.bind(app)` and `add_autoretry_behaviour(task, **options)`.

Sources: [celery/app/base.py:590-633](repo://celery/app/base.py#L590-L633)

`gen_task_name` joins the module and function names. When the module is `__main__` and the app has a `main` name, `main` replaces it, which is why `Celery('tasks')` in a script run directly still registers `tasks.add`.

Sources: [celery/utils/imports.py:122-141](repo://celery/utils/imports.py#L122-L141)

### Shared tasks

`shared_task` is the decorator for reusable libraries that do not know the app. It registers a finalizer that adds the task to every future app, adds it at once to every active app that is already finalized, and returns a `Proxy` that resolves the task by name in the current app's registry on every access.

Sources: [celery/app/__init__.py:24-75](repo://celery/app/__init__.py#L24-L75)

### Class-based tasks and the registry

`TaskRegistry` is a `dict` from name to task instance whose `__missing__` raises `NotRegistered`. `register` instantiates a class if needed, requires a `name`, and applies autoretry; `app.register_task` does the same and also generates a missing name and binds the task. Pickling a task serializes only its name and module: `_unpickle_task_v2` imports the module, then looks the name up in the current app.

Sources: [celery/app/registry.py:11-68](repo://celery/app/registry.py#L11-L68), [celery/app/base.py:635-652](repo://celery/app/base.py#L635-L652), [celery/app/task.py:506-514](repo://celery/app/task.py#L506-L514)

Every app also registers built-in tasks through `connect_on_app_finalize` in `celery.app.builtins`, among them `celery.backend_cleanup` (calls `app.backend.cleanup()`), `celery.accumulate` (used by `Task.replace` with a group), and the tasks behind chord unlocking, map, starmap, chunks, group, chain and chord. They are created with `shared=False, lazy=False`.

Sources: [celery/app/builtins.py:12-34](repo://celery/app/builtins.py#L12-L34), [celery/app/builtins.py:101-170](repo://celery/app/builtins.py#L101-L170)

## Binding and configuration defaults

`Task.bind(app)` is a classmethod run the first time the class meets its app. It clears the cached execution options, sets `typing` from `app.strict_typing` if unset, and copies every attribute listed in `from_config` from the configuration when the class left it `None`: `serializer`, `rate_limit`, `priority`, `time_limit`, `soft_time_limit`, `track_started`, `acks_late`, the `acks_on_*` flags, `reject_on_worker_lost`, `ignore_result`, `store_eager_result` and `store_errors_even_if_ignored`. `acks_on_failure` and `acks_on_timeout` then fall back to `acks_on_failure_or_timeout`, and to `True` when that is unset too.

Sources: [celery/app/task.py:398-456](repo://celery/app/task.py#L398-L456)

On the first bind only, `bind` applies annotations and creates the per-class `request_stack`, then calls the `on_bound(app)` hook. A task used without an explicit app binds itself to `current_app` on first access through the `app` class property.

Sources: [celery/app/task.py:443-476](repo://celery/app/task.py#L443-L476)

## Task options

The most used class attributes, settable on a subclass or as decorator options:

Sources: [celery/app/base.py:603-614](repo://celery/app/base.py#L603-L614)

| Attribute | Default | Meaning |
| --- | --- | --- |
| `name` | generated | Registry key and message `task` header |
| `typing` | `app.strict_typing` | Check call arguments against the function signature in `apply_async` |
| `max_retries` | `3` | Retries before `MaxRetriesExceededError`; `None` retries forever |
| `default_retry_delay` | `180` | Seconds before a retry |
| `rate_limit` | `task_default_rate_limit` | `'100/s'`, `'100/m'`, `'100/h'` or `None` |
| `ignore_result` | `task_ignore_result` | Do not store state and return value |
| `trail` | `True` | Record subtasks in `request.children` for `result.children` |
| `send_events` | `True` | Send task events when the worker has events enabled |
| `serializer` | `task_serializer` | Kombu serializer name |
| `time_limit`, `soft_time_limit` | settings | Hard and soft limits in seconds |
| `track_started` | `task_track_started` | Report the `STARTED` state |
| `acks_late` | `task_acks_late` | Acknowledge after execution instead of before |
| `reject_on_worker_lost` | setting | Requeue when the worker process dies, even with `acks_late` |
| `throws` | `()` | Expected exceptions: stored as errors but not logged as errors |
| `expires`, `priority` | `None` | Default message expiry and priority |
| `Strategy`, `Request` | `celery.worker.strategy:default`, `celery.worker.request:Request` | Worker-side classes for this task |

Sources: [celery/app/task.py:206-300](repo://celery/app/task.py#L206-L300), [celery/app/task.py:300-396](repo://celery/app/task.py#L300-L396)

`autoretry_for`, `dont_autoretry_for`, `retry_kwargs`, `retry_backoff`, `retry_backoff_max` and `retry_jitter` are read by `add_autoretry_behaviour`, which wraps `run` so listed exceptions call `task.retry`; [[Retries, Failures and Time Limits]] describes the retry itself.

Sources: [celery/app/autoretry.py:8-66](repo://celery/app/autoretry.py#L8-L66)

## The request context

Inside a task, `self.request` (with `bind=True`) is a `Context` holding the message's metadata: `id`, `args`, `kwargs`, `retries`, `eta`, `expires`, `group`, `group_index`, `chord`, `chain`, `callbacks`, `errbacks`, `root_id`, `parent_id`, `delivery_info`, `hostname`, `reply_to`, `is_eager`, `called_directly`, time limits and stamps. Message headers that are not Celery's own become `request.headers`. Setting `timelimit` also sets `time_limit` and `soft_time_limit`.

Sources: [celery/app/task.py:75-158](repo://celery/app/task.py#L75-L158)

`request` reads the top of the task's thread-local `request_stack`, or a shared empty `Context` when the task is not executing. Calling the task object directly (`add(2, 2)`) runs `__call__`, which pushes the task on the global task stack and a new request with the call's arguments, runs `run`, and pops both; the request inherits fields from the current request. `called_directly` stays `True` in that case, which is how `current_worker_task` tells inline calls from worker executions.

Sources: [celery/app/task.py:495-504](repo://celery/app/task.py#L495-L504), [celery/app/task.py:1229-1255](repo://celery/app/task.py#L1229-L1255)

`as_execution_options()` turns a request back into `apply_async` options (ids, group, chain, links, expiry, limits, headers without RabbitMQ `x-death` entries, retries, stamps), which `retry` and `replace` use to resend the same task.

Sources: [celery/app/task.py:160-196](repo://celery/app/task.py#L160-L196)

## Handler hooks

A subclass can override these methods; the default implementations do nothing except `on_replace`.

Sources: [celery/app/task.py:1135-1227](repo://celery/app/task.py#L1135-L1227)

| Hook | Called |
| --- | --- |
| `before_start(task_id, args, kwargs)` | Before `run`, inside the tracer |
| `on_success(retval, task_id, args, kwargs)` | After a successful run and result storage |
| `on_retry(exc, task_id, args, kwargs, einfo)` | When the task is to be retried |
| `on_failure(exc, task_id, args, kwargs, einfo)` | When the task fails |
| `after_return(status, retval, task_id, args, kwargs, einfo)` | After the task returns, whatever the state |
| `on_replace(sig)` | From `replace`; applies the new signature eagerly or sends it and raises `Ignore` |

Sources: [celery/app/task.py:1135-1227](repo://celery/app/task.py#L1135-L1227)

The tracer only calls `before_start`, `on_success` and `after_return` when the task class overrides them, which it checks once with `task_has_custom` when it builds the trace function ([[Task Execution Pipeline]]).

Sources: [celery/app/trace.py:389-398](repo://celery/app/trace.py#L389-L398)

## Annotations

The `task_annotations` setting changes task attributes from configuration. `prepare` turns each entry into an annotation object: a dict becomes a `MapAnnotation` from task name (or `'*'` for all tasks) to attributes, and a string is instantiated lazily as a class with `annotate(task)` and optionally `annotate_any()`. `Task.annotate` applies every match; a key starting with `@` wraps the named method with the given function through `add_around` instead of replacing it.

Sources: [celery/app/annotations.py:1-52](repo://celery/app/annotations.py#L1-L52), [celery/app/task.py:477-493](repo://celery/app/task.py#L477-L493)

## Pydantic arguments

With `@app.task(pydantic=True)`, `pydantic_wrapper` binds the call's arguments to the function signature and, for each parameter annotated with a Pydantic `BaseModel` (or `Optional` of one), validates the incoming value with `model_validate`, passing `strict` and a context that includes `celery_app` and `celery_task_name`. If the return annotation is a model class and the function returns an instance of it, the result is converted with `model_dump(mode='json')` so it can be serialized. A missing `pydantic` package raises `ImproperlyConfigured`.

Sources: [celery/app/base.py:127-205](repo://celery/app/base.py#L127-L205)
