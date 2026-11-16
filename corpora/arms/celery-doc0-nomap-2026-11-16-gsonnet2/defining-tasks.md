---
title: "Defining Tasks and the Task Class"
---
## Overview

A Celery task is an instance of a `Task` subclass registered under a name. `@app.task` builds that subclass from an ordinary function, so most users never write the class by hand; the class is where options such as `max_retries`, `acks_late` and `time_limit` live, where the running task finds its request context, and where hooks and helpers like `retry` and `replace` are defined. This page follows a function from decorator to bound task, then the pieces a running task uses. Turning a call into a message is on [[Calling Tasks: apply_async and send_task]]; running it on a worker is on [[Task Execution, Tracing and Acknowledgement]]. The decorator's lazy behaviour is explained in [[The Celery Application and Configuration]].

Sources: [celery/app/task.py:206-231](repo://celery/app/task.py#L206-L231), [celery/app/base.py:590-633](repo://celery/app/base.py#L590-L633)

## From function to Task class

`_task_from_fun` first refuses to run if the app is not finalized and auto-finalizing is off. It picks the task name (the explicit `name`, or `gen_task_name(fun.__name__, fun.__module__)`) and the base class (`base`, or the app's `Task`). If the name is not already in the registry it builds a class with `type(...)`: the function becomes `run` (wrapped in `staticmethod` unless `bind=True`), and the class gets `app`, `name`, `_decorated`, the docstring, annotations, a `__header__` built from the function signature and every extra decorator option as a class attribute. It instantiates the class, stores it in `self._tasks`, calls `task.bind(app)` and applies `add_autoretry_behaviour`. If the name is already registered, the existing task is returned instead.

Sources: [celery/app/base.py:590-633](repo://celery/app/base.py#L590-L633), [celery/app/base.py:654-655](repo://celery/app/base.py#L654-L655)

With `pydantic=True`, the function is first wrapped by `pydantic_wrapper`, which accepts the `pydantic_strict`, `pydantic_context` and `pydantic_dump_kwargs` options.

Sources: [celery/app/base.py:127-205](repo://celery/app/base.py#L127-L205), [celery/app/base.py:600-612](repo://celery/app/base.py#L600-L612)

The `__header__` is a function with the same signature as the task. When `typing` is on, `apply_async` calls it with the call's arguments, so a wrong argument list raises `TypeError` at the client instead of failing on a worker. `typing` defaults to the app's `strict_typing` and can be disabled per task with `typing=False`.

Sources: [celery/app/task.py:659-668](repo://celery/app/task.py#L659-L668), [celery/app/task.py:425-426](repo://celery/app/task.py#L425-L426)

## Binding and options

`Task.bind(app)` runs when a task is attached to an app, and again at finalize. It stores the app, clears the cached execution options, and fills every attribute left at `None` from the matching setting using the `from_config` table, for example `serializer` from `task_serializer`, `acks_late` from `task_acks_late`, `time_limit` from `task_time_limit` and `ignore_result` from `task_ignore_result`. `acks_on_failure` and `acks_on_timeout` default to `acks_on_failure_or_timeout` when set, and otherwise to `True`. On the first bind it applies annotations and creates the task's `request_stack`.

Sources: [celery/app/task.py:396-455](repo://celery/app/task.py#L396-L455)

Class-level defaults worth knowing: `max_retries = 3`, `default_retry_delay = 3 * 60`, `trail = True`, `send_events = True`, `resultrepr_maxsize = 1024`, and the dotted class names `Strategy = 'celery.worker.strategy:default'` and `Request = 'celery.worker.request:Request'` that the worker uses (see [[The Consumer: Receiving Tasks]]).

Sources: [celery/app/task.py:218-260](repo://celery/app/task.py#L218-L260), [celery/app/task.py:380-390](repo://celery/app/task.py#L380-L390)

`task_annotations` lets settings override attributes of tasks without editing them. `prepare` turns a dict into a `MapAnnotation` keyed by task name (the key `'*'` applies to every task), a string into a lazily instantiated class, and wraps a single value in a list. `Task.annotate` sets each resolved key as a class attribute; a key starting with `@` wraps the named method with the annotation instead.

Sources: [celery/app/annotations.py:18-52](repo://celery/app/annotations.py#L18-L52), [celery/app/task.py:477-493](repo://celery/app/task.py#L477-L493)

Calling the task directly runs `run` in the current process: `__call__` pushes the task onto the task stack and a request context, calls `self.run`, and pops both. `run` itself raises `NotImplementedError` unless defined.

Sources: [celery/app/task.py:495-518](repo://celery/app/task.py#L495-L518)

## The request context

Inside a running task, `self.request` is a `Context`. `Task.request` returns the top of the task's `request_stack`, or a default empty `Context` if none was pushed. `Context` has attributes for everything the worker knows about the call: `id`, `args`, `kwargs`, `retries`, `eta`, `expires`, `group`, `group_index`, `chain`, `chord`, `callbacks`, `errbacks`, `root_id`, `parent_id`, `delivery_info`, `hostname`, `is_eager`, `called_directly`, `timelimit` and others. Setting `timelimit` also sets `time_limit` and `soft_time_limit`, and headers that are not Celery's own keys are kept as custom `headers`.

Sources: [celery/app/task.py:75-149](repo://celery/app/task.py#L75-L149), [celery/app/task.py:1244-1254](repo://celery/app/task.py#L1244-L1254)

`as_execution_options` converts a context back into the options for sending a new message with the same identity: task id, root and parent ids, group id and index, chord, chain, callbacks as `link`, errbacks as `link_error`, time limits, headers (with RabbitMQ `x-death` headers stripped), retries, origin and any stamps. `signature_from_request` builds on it and copies priority and the original destination (the queue, or exchange and routing key from `delivery_info`). Both are used when a task is retried or replaced.

Sources: [celery/app/task.py:160-195](repo://celery/app/task.py#L160-L195), [celery/app/task.py:731-754](repo://celery/app/task.py#L731-L754)

`add_trail` appends each result created while the task runs to `request.children`, if `trail` is on. `update_state` stores a custom state and metadata for the current task id through the backend.

Sources: [celery/app/task.py:1121-1133](repo://celery/app/task.py#L1121-L1133), [celery/app/task.py:1229-1232](repo://celery/app/task.py#L1229-L1232)

## Retrying

`self.retry(...)` re-publishes the same task. It computes `retries = request.retries + 1`, and if called outside a worker (`request.called_directly`) it just raises the original exception. Otherwise the countdown defaults to `default_retry_delay`, a signature is built with `signature_from_request`, and the limit is checked: when `retries` exceeds `max_retries`, it re-raises `exc` if given, else raises `MaxRetriesExceededError`. Passing `max_retries` overrides the limit for this call only.

Sources: [celery/app/task.py:756-838](repo://celery/app/task.py#L756-L838)

Eager tasks (`request.is_eager`) return or raise a `Retry` carrying the signature, so `apply` re-runs them inline. In a worker, `retry` calls `S.apply_async()`; if sending fails the error becomes `Reject(exc, requeue=False)`. By default `retry` then raises `Retry`, which the tracer treats as the RETRY state, so always write `raise self.retry(...)`. With `throw=False` it returns the `Retry` without raising.

Sources: [celery/app/task.py:838-868](repo://celery/app/task.py#L838-L868)

`add_autoretry_behaviour` wraps `run` so the common pattern needs no explicit `retry` call. It reads `autoretry_for`, `dont_autoretry_for`, `retry_kwargs`, `retry_backoff`, `retry_backoff_max` (default 600) and `retry_jitter` (default `True`) from the decorator options or the class. When the wrapped function raises an exception in `autoretry_for`, it calls `task.retry(exc=exc, **retry_kwargs)`; `Ignore`, `Retry` and anything in `dont_autoretry_for` pass straight through. With `retry_backoff`, the countdown is an exponential backoff interval computed from the current retry count.

Sources: [celery/app/autoretry.py:9-66](repo://celery/app/autoretry.py#L9-L66)

## Replacing a task and growing a chord

`replace(sig)` ends the current task and lets another signature take over its identity. It refuses a signature that already belongs to a chord or an empty chain, uplifts a group into a chord with `celery.accumulate`, copies the current request's callbacks and errbacks onto the new signature, freezes it with the current task id so existing result objects stay valid, carries over chord, group, root id and a bumped `replaced_task_nesting`, and appends any remaining `request.chain` tasks. It finishes in `on_replace`, which applies the signature inline when eager and otherwise sends it and raises `Ignore('Replaced by new task')`. Signatures are described on [[Canvas: Signatures, Chains and Groups]].

Sources: [celery/app/task.py:1029-1095](repo://celery/app/task.py#L1029-L1095), [celery/app/task.py:1211-1227](repo://celery/app/task.py#L1211-L1227)

`add_to_chord(sig)` lets a running chord member add another task to its own chord. It requires `request.chord`, copies the group and chord options onto `sig`, freezes it, registers the result with `backend.add_to_chord` and sends it unless `lazy=True`; its docstring says only the Redis backend supports this. See [[Chords: Header, Body and Completion]].

Sources: [celery/app/task.py:1097-1119](repo://celery/app/task.py#L1097-L1119)

## Lifecycle hooks

Subclasses (or `base=` classes) can override these no-op handlers, all of which run in the worker and whose return values are ignored:

| Hook | Called | Arguments |
| --- | --- | --- |
| `before_start` | Before the task body | `task_id, args, kwargs` |
| `on_success` | After a successful return | `retval, task_id, args, kwargs` |
| `on_retry` | When the task is to be retried | `exc, task_id, args, kwargs, einfo` |
| `on_failure` | When the task raises | `exc, task_id, args, kwargs, einfo` |
| `after_return` | After the task returns in any final state | `status, retval, task_id, args, kwargs, einfo` |
| `on_replace` | When `replace` is called; override must return `super().on_replace(sig)` | `sig` |

Sources: [celery/app/task.py:1135-1227](repo://celery/app/task.py#L1135-L1227)

The tracer only calls `before_start`, `on_success` and `after_return` if the task class overrides them, determined with `task_has_custom`; the order in which they fire is on [[Task Execution, Tracing and Acknowledgement]].

Sources: [celery/app/trace.py:131-135](repo://celery/app/trace.py#L131-L135), [celery/app/trace.py:365-376](repo://celery/app/trace.py#L365-L376)

## Running a task locally

`apply` executes the task in the calling process and returns an `EagerResult`. It builds a request dictionary (`is_eager: True`, ids derived from the current task for parent and root, callbacks, errbacks, headers, time limits and stamps), builds a tracer with `eager=True` and `propagate=throw`, and runs it. `throw` defaults to the `task_eager_propagates` setting. If the outcome is a `Retry` carrying a signature, it applies that signature with `retries + 1`. `apply_async` takes this path instead of sending a message when `task_always_eager` is set.

Sources: [celery/app/task.py:869-951](repo://celery/app/task.py#L869-L951), [celery/app/task.py:683-697](repo://celery/app/task.py#L683-L697)

`shadow_name` is a hook to give a call a different display name in logs and monitoring, for example when one task wraps arbitrary functions; its result is sent as the `shadow` header.

Sources: [celery/app/task.py:710-729](repo://celery/app/task.py#L710-L729)
