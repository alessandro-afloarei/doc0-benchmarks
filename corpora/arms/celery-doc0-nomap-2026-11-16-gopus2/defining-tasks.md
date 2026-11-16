---
title: "Defining Tasks"
---
## Overview

A task is an instance of a `Task` subclass registered under a name in the app's task registry. `@app.task` builds that subclass from a function (see [[The Celery Application]]); a class can also subclass `Task` directly and define `run`. The class attributes decide how the task is published, how the worker acknowledges and limits it, and what is stored as its result. The same instance is used by the client, to send messages, and by the worker, to execute them.

Sources: [celery/app/task.py:206-215](repo://celery/app/task.py#L206-L215), [celery/app/base.py:609-628](repo://celery/app/base.py#L609-L628)

This page covers the class attributes, how they are bound to the app's configuration, the request context, the handlers a task can override, and two extension examples (pydantic validation and abortable tasks). Retrying is on [[Retries and Task Errors]]; sending is on [[Calling Tasks and the Message Protocol]].

Sources: [celery/app/task.py:516-521](repo://celery/app/task.py#L516-L521)

## Task attributes

Any of these can be passed to the decorator (`@app.task(acks_late=True)`), since the decorator copies its options into the generated class.

Sources: [celery/app/base.py:609-619](repo://celery/app/base.py#L609-L619)

| Attribute | Default | Meaning |
| --- | --- | --- |
| `name` | generated | Registry key; module plus function name |
| `typing` | `app.strict_typing` | Check call arguments against the function signature |
| `max_retries` | `3` | Retry limit; `None` retries forever |
| `default_retry_delay` | `180` | Seconds before a retry |
| `rate_limit` | `task_default_rate_limit` | `'100/s'`, `'100/m'`, `'100/h'` per worker |
| `ignore_result` | `task_ignore_result` | Do not store state and return value |
| `trail` | `True` | Record child results in `request.children` |
| `send_events` | `True` | Send task events when the worker has events enabled |
| `store_errors_even_if_ignored` | setting | Store failures even with `ignore_result` |
| `serializer` | `task_serializer` | Kombu serializer name |
| `time_limit`, `soft_time_limit` | settings | Hard and soft limits in seconds |
| `track_started` | `task_track_started` | Report a `STARTED` state |
| `acks_late` | `task_acks_late` | Acknowledge after execution instead of before |
| `acks_on_failure`, `acks_on_timeout` | `True` | With `acks_late`, acknowledge failed or timed-out tasks |
| `reject_on_worker_lost` | setting | Requeue instead of acknowledging when the child process dies |
| `throws` | `()` | Expected exceptions: stored as failures but not logged as errors |
| `expires`, `priority` | `None` | Default expiry and priority for published messages |
| `Strategy`, `Request` | `celery.worker.strategy:default`, `celery.worker.request:Request` | Worker-side classes for this task |

Sources: [celery/app/task.py:221-330](repo://celery/app/task.py#L221-L330), [celery/app/task.py:331-400](repo://celery/app/task.py#L331-L400)

The docstring of `acks_late` states the trade-off: with late acknowledgement the task "may be executed twice if the worker crashes mid execution". The docstring of `reject_on_worker_lost` warns that requeueing on a lost worker "can cause message loops".

Sources: [celery/app/task.py:296-306](repo://celery/app/task.py#L296-L306), [celery/app/task.py:345-356](repo://celery/app/task.py#L345-L356)

## Binding to the app

### Lazy binding

Tasks are bound lazily, so configuration is not read until the task is used. `Task.bind(app)` is a class method: it stores the app, clears the cached execution options, sets `typing` from `app.strict_typing` when unset, and for every pair in `from_config` copies the setting into any attribute still `None` (for example `acks_late` from `task_acks_late`). `acks_on_failure` and `acks_on_timeout` fall back to the deprecated `acks_on_failure_or_timeout`, then to `True`. On the first bind it also applies annotations and creates the per-thread `request_stack`, and it always calls the `on_bound` hook.

Sources: [celery/app/task.py:403-465](repo://celery/app/task.py#L403-L465)

The `app` class property binds on access when the class has not been bound yet, falling back to `current_app` if no app was set. A task pickles as its name plus its module; the receiving process imports the module if needed and looks the name up in its current app's registry.

Sources: [celery/app/task.py:467-476](repo://celery/app/task.py#L467-L476), [celery/app/task.py:506-514](repo://celery/app/task.py#L506-L514), [celery/app/registry.py:61-68](repo://celery/app/registry.py#L61-L68)

### Annotations

The `task_annotations` setting changes task attributes from configuration. `prepare` turns each entry into an annotation object: a dict becomes a `MapAnnotation` keyed by task name (with `'*'` matching every task), and a string is imported lazily as a class with `annotate(task)` and `annotate_any()` methods. During binding, `annotate` applies every matching dict; a key starting with `@` wraps a method instead of replacing an attribute, via `add_around`.

Sources: [celery/app/annotations.py:18-52](repo://celery/app/annotations.py#L18-L52), [celery/app/task.py:477-493](repo://celery/app/task.py#L477-L493)

### Argument checking

When `typing` is on, `apply_async` calls `__header__`, a function with the task's signature and an empty body. `head_from_fun` builds it with `exec` rather than `inspect.Signature`; its comment says the pure-Python signature check is very slow, while the generated function costs the same as a call. For bound tasks the first argument is pre-filled.

Sources: [celery/utils/functional.py:364-394](repo://celery/utils/functional.py#L364-L394), [celery/app/task.py:661-667](repo://celery/app/task.py#L661-L667)

## The request context

`task.request` is the top of the task's `request_stack`, a `Context` with the message metadata of the call being executed: `id`, `args`, `kwargs`, `retries`, `eta`, `expires`, `group`, `group_index`, `chord`, `chain`, `callbacks`, `errbacks`, `root_id`, `parent_id`, `delivery_info`, `hostname`, `reply_to`, `is_eager`, `called_directly`, time limits and stamps. Outside an execution the property returns a shared empty `Context`.

Sources: [celery/app/task.py:75-120](repo://celery/app/task.py#L75-L120), [celery/app/task.py:1234-1255](repo://celery/app/task.py#L1234-L1255)

Headers the producer added that are not Celery's own keys are kept in `request.headers`. Updating a context with `timelimit` also splits it into `time_limit` and `soft_time_limit`. `children` is a fresh list per context, to which `add_trail` appends the results of tasks sent from this one when `trail` is enabled.

Sources: [celery/app/task.py:121-152](repo://celery/app/task.py#L121-L152), [celery/app/task.py:197-203](repo://celery/app/task.py#L197-L203), [celery/app/task.py:1229-1232](repo://celery/app/task.py#L1229-L1232)

`as_execution_options` turns a request back into `apply_async` options: ids, group, chord, chain, links, expiry, time limits, headers (minus RabbitMQ `x-death` headers), retries, reply-to, stamps. `signature_from_request` uses it to rebuild a signature of the current call, keeping the original priority and queue (the routing key when the message came through the default exchange); retry and replace use this.

Sources: [celery/app/task.py:160-195](repo://celery/app/task.py#L160-L195), [celery/app/task.py:731-754](repo://celery/app/task.py#L731-L754)

Calling a task object directly (`add(2, 2)`) does not send a message: `__call__` pushes the task on the current-task stack and a context with `called_directly` still true, runs `run`, and pops both.

Sources: [celery/app/task.py:495-502](repo://celery/app/task.py#L495-L502)

## Handlers

A task class can override these methods; the tracer calls them in the worker (see [[Task Execution and Tracing]]). Their return values are ignored.

Sources: [celery/app/task.py:1135-1147](repo://celery/app/task.py#L1135-L1147)

| Handler | Called |
| --- | --- |
| `before_start(task_id, args, kwargs)` | Before the body runs |
| `on_success(retval, task_id, args, kwargs)` | After a successful run and stored result |
| `on_retry(exc, task_id, args, kwargs, einfo)` | When the task is retried |
| `on_failure(exc, task_id, args, kwargs, einfo)` | When the task fails |
| `after_return(status, retval, task_id, args, kwargs, einfo)` | After any outcome except ignored or rejected states |
| `on_replace(sig)` | When `replace()` swaps the task for a signature |

Sources: [celery/app/task.py:1135-1227](repo://celery/app/task.py#L1135-L1227)

The default `on_replace` runs the new signature inline and returns its value when the request is eager; otherwise it sends it and raises `Ignore('Replaced by new task')`. Overrides must call the base method.

Sources: [celery/app/task.py:1211-1227](repo://celery/app/task.py#L1211-L1227)

`update_state(task_id=None, state=None, meta=None)` stores a custom state and metadata for the current task (or another id) in the result backend, which is how a task reports progress. The task's `backend` property returns a backend set on the task, otherwise the app's.

Sources: [celery/app/task.py:1121-1133](repo://celery/app/task.py#L1121-L1133), [celery/app/task.py:1261-1270](repo://celery/app/task.py#L1261-L1270)

## Pydantic validation

`@app.task(pydantic=True)` wraps the function in `pydantic_wrapper`, which requires the `pydantic` package. On each call it binds the arguments to the function signature and, for every parameter annotated with a `BaseModel` subclass (including `Optional[Model]`), calls `model_validate` with `strict` and a context that adds `celery_app` and `celery_task_name`. If the return annotation is a class and the function returns an instance of it that is a `BaseModel`, the value is returned as `model_dump(mode='json')` plus any `pydantic_dump_kwargs`.

Sources: [celery/app/base.py:127-205](repo://celery/app/base.py#L127-L205)

## Abortable tasks

`celery.contrib.abortable` shows how a `Task` subclass can add behaviour. `AbortableTask.AsyncResult` returns an `AbortableAsyncResult`, whose `abort()` stores the state `ABORTED` in the backend. The task body must poll `self.is_aborted()`, which reads the state from the backend and returns `False` for results that are not abortable. The docstrings warn that aborting is cooperative and that each check queries the backend.

Sources: [celery/contrib/abortable.py:85-165](repo://celery/contrib/abortable.py#L85-L165)
