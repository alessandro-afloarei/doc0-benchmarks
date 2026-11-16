---
title: "Defining Tasks, Retries and Task Options"
---
## Overview

A Celery task is an instance of a `Task` subclass registered under a name. The `@app.task` decorator builds that subclass from a plain function, so most code never writes one by hand. This page follows how the class is created and bound, which options it carries and where their defaults come from, how a task retries (by hand and automatically), how it can run locally, and which hooks it exposes. Publishing a call is covered by [[Publishing Tasks: apply_async, Routing and Messages]]; running it on a worker by [[Task Execution, Tracing and Acknowledgement]]; the app that owns the registry by [[The Celery Application and Configuration]].

Sources: [celery/app/task.py:206-216](repo://celery/app/task.py#L206-L216), [celery/app/base.py:515-585](repo://celery/app/base.py#L515-L585)

## Creating a task from a function

`@app.task` can be used bare or with options. A bare call with one callable builds the task at once; with arguments it returns a decorator. A non-callable single argument raises `TypeError`.

Sources: [celery/app/base.py:515-520](repo://celery/app/base.py#L515-L520), [celery/app/base.py:575-584](repo://celery/app/base.py#L575-L584)

The inner decorator has these steps:

Sources: [celery/app/base.py:546-574](repo://celery/app/base.py#L546-L574)

- If `shared` (the default), it registers a constructor with `connect_on_app_finalize`, so every app created later also gets the task. This is how `shared_task` works.
- If `lazy=False` or the app is already finalized, it calls `_task_from_fun` immediately. Otherwise it returns a `PromiseProxy` and appends it to `app._pending`, so the task class is only built when the proxy is first used or the app is finalized.
- An optional `filter` wraps the returned object.

Sources: [celery/app/base.py:546-574](repo://celery/app/base.py#L546-L574)

When the process was started through `execv` (`FORKED_BY_MULTIPROCESSING`), a lazy task is redirected to `shared_task(lazy=False)`, so that the module-level task points at the current app's instance.

Sources: [celery/app/base.py:540-548](repo://celery/app/base.py#L540-L548)

`_task_from_fun` raises `RuntimeError('Contract breach: app not finalized')` if the app is not finalized and `autofinalize` is off. It derives the name from `gen_task_name` (the module name plus function name, rewriting `__main__` to `app.main` when set), then, if the name is not yet registered, builds the class with `type(fun.__name__, (base,), {...})` and instantiates it. The class dictionary carries `app`, `name`, `run` (the function, or the function as a method when `bind=True`), a `__header__` argument checker built from the function signature, and the decorator options. It then stores the instance in the registry, calls `task.bind(self)` and `add_autoretry_behaviour`. A second call with the same name returns the existing instance.

Sources: [celery/app/base.py:590-633](repo://celery/app/base.py#L590-L633), [celery/utils/imports.py:122-141](repo://celery/utils/imports.py#L122-L141)

The registry is a dict subclass that raises `NotRegistered` for a missing name; `register` requires a `name`, instantiates classes and also applies autoretry, and `unregister` removes by name or task. Old-style classes are registered with `app.register_task`.

Sources: [celery/app/registry.py:14-45](repo://celery/app/registry.py#L14-L45), [celery/app/base.py:635-652](repo://celery/app/base.py#L635-L652)

## Binding and option defaults

`Task.bind(app)` is a classmethod that ties the class to an app and fills unset options from configuration. For each pair in `from_config` (for example `('acks_late', 'task_acks_late')` and `('rate_limit', 'task_default_rate_limit')`), an attribute that is still `None` gets the value of the setting. `acks_on_failure` and `acks_on_timeout` fall back to `acks_on_failure_or_timeout` and finally to `True`. Binding also clears the cached execution options, sets `typing` from the app's `strict_typing`, applies annotations from configuration once, and creates the per-class `request_stack`.

Sources: [celery/app/task.py:380-416](repo://celery/app/task.py#L380-L416), [celery/app/task.py:419-456](repo://celery/app/task.py#L419-L456)

The binding is lazy for class access too: reading `Task.app` calls `_get_app`, which falls back to the current app and binds on first use.

Sources: [celery/app/task.py:466-476](repo://celery/app/task.py#L466-L476)

Beyond the config-backed options, the class defines defaults directly: `max_retries = 3`, `default_retry_delay = 3 * 60` seconds, `rate_limit = None`, `trail = True`, `throws = ()`, `resultrepr_maxsize = 1024`, plus `Strategy` and `Request` as importable names used by the worker (see [[The Consumer: From Broker Message to Pool]]).

Sources: [celery/app/task.py:206-262](repo://celery/app/task.py#L206-L262)

`extract_exec_options` collects the publishing-related attributes (`queue`, `routing_key`, `exchange`, `priority`, `expires`, `serializer`, `delivery_mode`, `compression`, `time_limit`, `soft_time_limit`, and others) from the task; `_get_exec_options` caches them until the next bind. `apply_async` merges them under the call's own options.

Sources: [celery/app/task.py:28-36](repo://celery/app/task.py#L28-L36), [celery/app/task.py:1256-1260](repo://celery/app/task.py#L1256-L1260)

## Calling a task

Calling the task object runs it in the current process. `__call__` pushes the task on the task stack and a new request context, runs `run(*args, **kwargs)`, then pops both. `delay` is the star-argument form of `apply_async`. See [[Publishing Tasks: apply_async, Routing and Messages]] for the asynchronous path.

Sources: [celery/app/task.py:495-504](repo://celery/app/task.py#L495-L504), [celery/app/task.py:523-534](repo://celery/app/task.py#L523-L534)

`Task.request` is the top of the request stack, a `Context`; if no task is running, a default empty `Context` is returned. `update_state` stores a custom state through the backend for the current task id.

Sources: [celery/app/task.py:1234-1254](repo://celery/app/task.py#L1234-L1254), [celery/app/task.py:1121-1133](repo://celery/app/task.py#L1121-L1133)

## Retrying

### Manual retries with Task.retry

`Task.retry` publishes a copy of the current request again and signals the worker with a `Retry` exception:

Sources: [celery/app/task.py:756-867](repo://celery/app/task.py#L756-L867)

1. It computes `retries = request.retries + 1`; a non-`None` `max_retries` argument is remembered as `override_max_retries`.
2. If the task was called directly (`request.called_directly`), it simply raises the original exception, or a `Retry`, because there is no worker to resend it.
3. If neither `eta` nor `countdown` was given, `countdown` becomes `default_retry_delay`.
4. It builds the new signature with `signature_from_request`.
5. If `retries` exceeds `max_retries`, it raises `exc` (augmenting the current exception) or `MaxRetriesExceededError`.
6. For eager execution it returns or raises the `Retry` for `apply()` to handle; otherwise it calls `S.apply_async()`, converting any publish error into `Reject(exc, requeue=False)`, and then raises `Retry` unless `throw=False`.

Sources: [celery/app/task.py:756-867](repo://celery/app/task.py#L756-L867)

The tracer catches the `Retry`, stores a `RETRY` state and runs the `on_retry` hook rather than treating it as a failure; see [[Task Execution, Tracing and Acknowledgement]].

Sources: [celery/app/trace.py:212-240](repo://celery/app/trace.py#L212-L240)

### Automatic retries

Passing `autoretry_for` to the decorator wraps `run` in `add_autoretry_behaviour`. It reads `autoretry_for`, `dont_autoretry_for`, `retry_kwargs`, `retry_backoff` (default off), `retry_backoff_max` (default 600) and `retry_jitter` (default `True`) from the options or the task. The wrapper re-raises `Ignore`, `Retry` and anything in `dont_autoretry_for` unchanged; for any other exception in `autoretry_for` it calls `task.retry(exc=exc, **retry_kwargs)`. With `retry_backoff` it first sets `countdown` from `get_exponential_backoff_interval`, using the factor, current retry count, the maximum and jitter.

Sources: [celery/app/autoretry.py:9-66](repo://celery/app/autoretry.py#L9-L66)

```python
except autoretry_for as exc:
    if retry_backoff:
        retry_kwargs['countdown'] = \
            get_exponential_backoff_interval(
                factor=int(max(1.0, retry_backoff)),
                retries=task.request.retries,
                maximum=retry_backoff_max,
                full_jitter=retry_jitter)
    ...
    ret = task.retry(exc=exc, **retry_kwargs)
```

Sources: [celery/app/autoretry.py:9-66](repo://celery/app/autoretry.py#L9-L66)

The wrapper is installed once: the original `run` is kept as `_orig_run` and the check `not hasattr(task, '_orig_run')` stops double wrapping.

Sources: [celery/app/autoretry.py:31-34](repo://celery/app/autoretry.py#L31-L34), [celery/app/autoretry.py:65-66](repo://celery/app/autoretry.py#L65-L66)

## Running a task locally

`Task.apply` executes the task in the current process and returns an `EagerResult`. It builds a request dictionary (`is_eager`, `retries`, `callbacks`, `errbacks`, `timelimit`, `delivery_info`, stamped headers), creates a tracer with `build_tracer(..., eager=True, propagate=throw)` and runs it. `throw` defaults to the `task_eager_propagates` setting. If the result is a `Retry` carrying a signature, it applies that signature with `retries + 1`. `apply_async` calls `apply` when `task_always_eager` is set, after round-tripping the arguments through the serializer so eager runs see serialised values; see [[Publishing Tasks: apply_async, Routing and Messages]].

Sources: [celery/app/task.py:869-951](repo://celery/app/task.py#L869-L951), [celery/app/task.py:683-698](repo://celery/app/task.py#L683-L698)

## Hooks and replacement

A task subclass can override handlers that the worker's tracer calls: `before_start`, `on_success`, `on_retry`, `on_failure`, `after_return` and `on_replace`. Each receives the task id and original arguments; `on_retry` and `on_failure` also get an `ExceptionInfo`. The return values are ignored.

Sources: [celery/app/task.py:1135-1226](repo://celery/app/task.py#L1135-L1226)

`Task.replace(sig)` ends the current task and continues the work as `sig`, which inherits the task id so existing results stay valid. It refuses a replacement that is part of a chord (`ImproperlyConfigured`) or an empty chain; turns a group into a chord with `celery.accumulate`; re-links the original callbacks and errbacks; freezes `sig` with the current id; copies `chord`, `group_id`, `group_index`, `root_id` and an incremented `replaced_task_nesting`; and re-appends the rest of the original chain. `on_replace` then sends the signature and raises `Ignore('Replaced by new task')`, or in an eager context applies it and returns the result.

Sources: [celery/app/task.py:1029-1095](repo://celery/app/task.py#L1029-L1095), [celery/app/task.py:1211-1226](repo://celery/app/task.py#L1211-L1226)

`add_trail` appends a child result to `request.children` when `trail` is enabled, which is how `AsyncResult.children` is populated; see [[Task Results, States and Result Backends]].

Sources: [celery/app/task.py:1229-1232](repo://celery/app/task.py#L1229-L1232)
