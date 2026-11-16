---
title: "Defining Tasks"
---
## Overview

A task is an instance of a `Task` subclass registered under a name. Most tasks are written as functions and turned into classes by `@app.task` or `@shared_task`; the class carries the options that decide how the task's messages are sent and how the worker runs it, and the instance's `run` method is the function body. This page covers the class, its options and the request context a running task sees. How a call becomes a message is in [[Sending Tasks and Routing]]; how failures and retries work is in [[Retries and Error Handling]]; how the decorator registers the class is in [[The Celery Application]].

Sources: [celery/app/task.py:206-222](repo://celery/app/task.py#L206-L222), [celery/app/base.py:590-633](repo://celery/app/base.py#L590-L633)

## From function to task class

`@app.task(**opts)` calls `_task_from_fun`, which builds `type(fun.__name__, (base,), {...})` with `run` set to the function, `name` set to the given name or a generated one, and every other decorator option set as a class attribute. Because options become attributes, anything `Task` declares (`max_retries`, `rate_limit`, `acks_late` …) can be passed to the decorator, and `base=` picks a custom base class instead of `app.Task`.

Sources: [celery/app/base.py:590-633](repo://celery/app/base.py#L590-L633)

Generated names are `<module>.<function>`. When the module is `__main__`, the app's `main` name replaces it, so a script run directly still registers `myapp.add` rather than `__main__.add`.

Sources: [celery/utils/imports.py:122-141](repo://celery/utils/imports.py#L122-L141)

With `bind=True`, `run` is stored as a plain function, so it receives the task instance as `self`; otherwise it is wrapped in `staticmethod`. Bound tasks are how a task reaches `self.request`, `self.retry` and `self.update_state`.

Sources: [celery/app/base.py:609-622](repo://celery/app/base.py#L609-L622)

```python
@app.task(bind=True, max_retries=5, rate_limit='10/m', acks_late=True)
def fetch(self, url):
    return self.request.id, url
```

Sources: [celery/app/base.py:515-544](repo://celery/app/base.py#L515-L544)

## Task options

### Class attributes

The attributes below are read by the publisher and the worker. Those left at `None` are filled from configuration when the class is bound.

Sources: [celery/app/task.py:396-411](repo://celery/app/task.py#L396-L411)

| Attribute | Default | Meaning |
| --- | --- | --- |
| `name` | generated | Registry key and message `task` header |
| `typing` | `app.strict_typing` | Check call arguments against the function signature |
| `max_retries` | `3` | Retries before `MaxRetriesExceededError`; `None` retries forever |
| `default_retry_delay` | `180` | Seconds before a retry |
| `rate_limit` | `task_default_rate_limit` | `'100/s'`, `'100/m'`, `'100/h'` per worker |
| `ignore_result` | `task_ignore_result` | Do not store state and return value |
| `trail` | `True` | Track subtasks in `request.children` |
| `send_events` | `True` | Send task events when the worker has events on |
| `store_errors_even_if_ignored` | setting | Store failures for ignored-result tasks |
| `serializer` | `task_serializer` | Kombu serializer name |
| `time_limit`, `soft_time_limit` | settings | Hard and soft limits in seconds |
| `track_started` | `task_track_started` | Report `STARTED` when execution begins |
| `acks_late` | `task_acks_late` | Acknowledge after execution instead of before |
| `acks_on_failure`, `acks_on_timeout` | `True` | With `acks_late`, acknowledge failed or timed-out tasks |
| `reject_on_worker_lost` | setting | Requeue when the child process dies |
| `throws` | `()` | Expected exceptions, logged without a traceback |
| `expires`, `priority` | `None` | Default message expiry and priority |

Sources: [celery/app/task.py:237-311](repo://celery/app/task.py#L237-L311), [celery/app/task.py:312-380](repo://celery/app/task.py#L312-L380)

### Filled from configuration

`from_config` pairs each attribute with its setting. `Task.bind(app)`, called when the app finalizes or the task is first used, copies the setting into every attribute still `None`, defaults `typing` to `app.strict_typing`, and resolves `acks_on_failure` and `acks_on_timeout` from the deprecated `acks_on_failure_or_timeout` or `True`. On the first bind it also applies annotations and creates the per-class `request_stack`, then calls the `on_bound` hook.

Sources: [celery/app/task.py:396-465](repo://celery/app/task.py#L396-L465)

Binding is lazy: the `app` class property calls `_get_app`, which uses the current app when the task class has none and binds on first use, so configuration read in `bind` is the app's final configuration.

Sources: [celery/app/task.py:466-475](repo://celery/app/task.py#L466-L475)

### Annotations

The `task_annotations` setting changes task attributes from configuration. `prepare` turns each entry into a `MapAnnotation` (a dict from task name, or `'*'` for all tasks, to attributes) or lazily instantiates a class path. `Task.annotate` applies the matching dicts: keys starting with `@` wrap a method with `add_around`, any other key is set as an attribute.

Sources: [celery/app/annotations.py:18-52](repo://celery/app/annotations.py#L18-L52), [celery/app/task.py:477-493](repo://celery/app/task.py#L477-L493)

## Argument checking and Pydantic

When `typing` is on, `apply_async` calls the task's `__header__` with the call arguments before sending, so a wrong number of arguments raises `TypeError` in the caller instead of in the worker. `__header__` comes from `head_from_fun`, which uses `exec` to build an empty function with the same signature; the comment says this is faster than `inspect.Signature` checks. For bound tasks the first argument is pre-filled.

Sources: [celery/app/task.py:657-668](repo://celery/app/task.py#L657-L668), [celery/utils/functional.py:364-394](repo://celery/utils/functional.py#L364-L394)

`@app.task(pydantic=True)` wraps the function in `pydantic_wrapper`. Before the body runs, every argument annotated with a `BaseModel` subclass (or `Optional` of one) is validated with `model_validate`, passing `pydantic_strict` and a context holding `celery_app` and `celery_task_name`. A return value that is an instance of the annotated return model is converted with `model_dump(mode='json')` unless `pydantic_dump_kwargs` says otherwise. Pydantic must be installed or the decorator raises `ImproperlyConfigured`.

Sources: [celery/app/base.py:127-205](repo://celery/app/base.py#L127-L205), [celery/app/base.py:606-607](repo://celery/app/base.py#L606-L607)

## The request context

`task.request` is the top of the class's `request_stack`, or a default empty `Context` when the task is not running. A `Context` is a plain attribute bag: `id`, `args`, `kwargs`, `retries`, `eta`, `expires`, `group`, `group_index`, `chord`, `chain`, `callbacks`, `errbacks`, `root_id`, `parent_id`, `hostname`, `delivery_info`, `reply_to`, `is_eager`, `called_directly` and the stamping fields. Updating `timelimit` also sets `time_limit` and `soft_time_limit`, and headers that are not Celery's own are kept as `request.headers`.

Sources: [celery/app/task.py:75-149](repo://celery/app/task.py#L75-L149), [celery/app/task.py:1234-1254](repo://celery/app/task.py#L1234-L1254)

`as_execution_options()` turns a request back into `apply_async` options (ids, group, chord, chain, links, expiry, limits, headers, retries), dropping RabbitMQ `x-death` headers so a resent message is not taken for a dead-letter cycle. `retry` and `signature_from_request` use it to re-send the same task. `request.children` is a per-request list that `add_trail` fills with the results of subtasks.

Sources: [celery/app/task.py:160-202](repo://celery/app/task.py#L160-L202), [celery/app/task.py:1229-1232](repo://celery/app/task.py#L1229-L1232)

## Calling a task directly

`task(*args)` runs `run` in the current process. `__call__` pushes the task on the global task stack and a new request on its own stack (copying the current request and overriding `args` and `kwargs`), then pops both after `run` returns. No message is sent, no state is stored and the request's `called_directly` stays `True`.

Sources: [celery/app/task.py:495-504](repo://celery/app/task.py#L495-L504)

`task.apply(args, kwargs)` runs the task eagerly through the same tracer the worker uses, with a request marked `is_eager`, and returns an `EagerResult`. It inherits `parent_id` and `root_id` from the task currently on the stack, re-raises exceptions when `throw` (default `task_eager_propagates`) is true, and follows a `Retry` that carries a signature by applying it again with one more retry.

Sources: [celery/app/task.py:869-951](repo://celery/app/task.py#L869-L951)

## Handlers

Subclasses can override hooks the worker's tracer calls: `before_start(task_id, args, kwargs)`, `on_success(retval, task_id, args, kwargs)`, `on_retry(exc, task_id, args, kwargs, einfo)`, `on_failure(exc, task_id, args, kwargs, einfo)` and `after_return(status, retval, task_id, args, kwargs, einfo)`. Their return values are ignored. When they run is described in [[Task Execution Pipeline]].

Sources: [celery/app/task.py:1135-1209](repo://celery/app/task.py#L1135-L1209)

## State and events from inside a task

`update_state(task_id=None, state=None, meta=None)` stores a custom state and metadata for the current task (or another id) through the backend, which is how progress is reported. `send_event(type_, **fields)` publishes a custom event with the task's `uuid` attached, using the request's hostname ([[Events and Monitoring]]).

Sources: [celery/app/task.py:1121-1133](repo://celery/app/task.py#L1121-L1133), [celery/app/task.py:1003-1027](repo://celery/app/task.py#L1003-L1027)

## Replacing a task

`replace(sig)` ends the current task and continues with `sig` under the same task id. It refuses a signature that is part of a chord or an empty chain, turns a group into a chord with the built-in `celery.accumulate` task so callbacks can attach, copies the request's callbacks and errbacks onto `sig`, freezes it with the current id, and carries over the chord, group, root id and an incremented `replaced_task_nesting`. The rest of the current chain is appended to `sig`.

Sources: [celery/app/task.py:1029-1095](repo://celery/app/task.py#L1029-L1095)

`on_replace` then applies `sig` and returns its value when the task runs eagerly, or sends it and raises `Ignore('Replaced by new task')` in a worker, so no code after `return self.replace(...)` runs. `add_to_chord(sig)` instead adds a signature to the chord the task belongs to; its docstring says only the Redis backend supports it ([[Groups and Chords]]).

Sources: [celery/app/task.py:1211-1227](repo://celery/app/task.py#L1211-L1227), [celery/app/task.py:1097-1119](repo://celery/app/task.py#L1097-L1119)

## Signatures from a task

`task.s(*args, **kwargs)` and `task.signature(args, kwargs, **options)` return a `Signature` for the task, `si` an immutable one, and `map`, `starmap` and `chunks` the corresponding canvas primitives. They are covered in [[Signatures and Chains]] and [[Groups and Chords]].

Sources: [celery/app/task.py:962-1001](repo://celery/app/task.py#L962-L1001)

## Pickling and backend

A task pickles as its name and module. On unpickling, `_unpickle_task_v2` imports the module if given and returns the task from the current app's registry, so the receiving process uses its own registered instance. `task.backend` is the task's own backend if one was set, otherwise the app's.

Sources: [celery/app/task.py:506-514](repo://celery/app/task.py#L506-L514), [celery/app/registry.py:63-66](repo://celery/app/registry.py#L63-L66), [celery/app/task.py:1261-1270](repo://celery/app/task.py#L1261-L1270)
