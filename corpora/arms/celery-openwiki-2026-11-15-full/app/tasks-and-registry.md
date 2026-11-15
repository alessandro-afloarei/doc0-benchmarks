---
type: concept
title: Tasks, Task Registry and Retries
description: How functions become Task classes via @app.task and @shared_task, how tasks bind to an app and pick up configuration and annotations, the task registry, built-in tasks, and the retry/autoretry/replace semantics of celery.app.task.Task.
tags: [tasks, registry, retry, autoretry, annotations, task-options]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T09:27:53.075Z
sources:
  - id: openwiki-source-6906cd292e916d4dea5699c8
    resource: repo://celery/app/annotations.py
  - id: openwiki-source-f43ee4204a66938ed7ddea4f
    resource: repo://celery/app/autoretry.py
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-868b95b69384872926804a54
    resource: repo://celery/app/builtins.py
  - id: openwiki-source-eee674a48f00d180319d175e
    resource: repo://celery/app/registry.py
  - id: openwiki-source-3795aa577fa7b0f3bd2af81a
    resource: repo://celery/app/task.py
generated: { by: "claude-code", at: "2026-11-15T09:27:53.075Z" }
---

# Tasks, Task Registry and Retries

A Celery task is an **instance of a dynamically created subclass of `celery.app.task.Task`** (`celery/app/task.py`). The same object is used on the client to publish messages (`delay`, `apply_async`, `signature`) and inside the worker to execute the body (`run`) and lifecycle hooks (`on_success`, `on_failure`, `on_retry`, `after_return`, `before_start`).

## Creating tasks

### `@app.task`

`Celery.task()` (`celery/app/base.py`) accepts either a bare callable or options. For each decorated function:

1. Unless `shared=False`, a constructor is registered with `connect_on_app_finalize`, so **every** app that finalizes later gets its own copy of the task.
2. If the app is already finalized or `lazy=False`, the task is created now; otherwise a `PromiseProxy` is returned and queued in `app._pending` until [finalization](application-and-configuration.md#finalization-and-the-task-registry).
3. When the process was started by billiard using `execv` (`FORKED_BY_MULTIPROCESSING`), the decorator delegates to `shared_task(lazy=False)` so module-level task references resolve to the current app's instance.

`_task_from_fun()` builds the class with `type(fun.__name__, (base,), {...})`, setting `app`, `name` (default from `gen_task_name(module, name)`), `run` (as `staticmethod` unless `bind=True`), `__header__` (a signature checker generated from the function), `__wrapped__` and any extra options as class attributes. It then instantiates it, stores it in the registry, calls `task.bind(app)` and `add_autoretry_behaviour(task, **options)`. If a task with that name already exists it is returned unchanged — re-decorating does not overwrite.

With `pydantic=True`, the function is first wrapped by `pydantic_wrapper`: arguments annotated with a `BaseModel` subclass are validated with `model_validate(strict=..., context=...)`, and a returned `BaseModel` instance matching the return annotation is converted with `model_dump(mode='json')`. Missing pydantic raises `ImproperlyConfigured`.

### `@shared_task`

`celery.shared_task` (`celery/app/__init__.py`) registers the function with every future app via `connect_on_app_finalize`, immediately adds it to already-finalized active apps, and returns a `Proxy` that resolves to `current_app.tasks[name]`. It is the recommended form for reusable libraries and Django apps.

### Class-based tasks

`app.register_task(TaskSubclass)` (and `TaskRegistry.register`) instantiate a class, generate a name if missing, add autoretry behaviour and bind it to the app.

## Binding: configuration and annotations

`Task.bind(app)` is a classmethod run on registration, on finalize, and lazily on first `task.app` access:

- For every `(attribute, setting)` pair in `Task.from_config` (e.g. `serializer`→`task_serializer`, `acks_late`→`task_acks_late`, `time_limit`, `soft_time_limit`, `rate_limit`, `track_started`, `ignore_result`, `reject_on_worker_lost`, ...) the class attribute is filled from configuration **only if it is `None`**. Decorator options therefore win over app settings.
- `acks_on_failure` and `acks_on_timeout` default to `acks_on_failure_or_timeout` when that is set, otherwise `True`.
- `typing` defaults to the app's `strict_typing`.
- On the first bind only, annotations are applied and a per-class `request_stack` (`LocalStack`) is created.
- `on_bound(app)` is called as an extension hook.

**Annotations** (`task_annotations` setting, `celery/app/annotations.py`) are configuration-driven monkey-patches. A dict maps task names (or `'*'`) to attribute overrides; a string is lazily instantiated as an object with `annotate(task)`/`annotate_any()`. Keys prefixed with `@` wrap a method instead of replacing an attribute (`add_around`).

## The registry

`TaskRegistry` (`celery/app/registry.py`) is a `dict` subclass whose `__missing__` raises `NotRegistered`. Tasks pickle as `(name, module)` via `_unpickle_task_v2`, which imports the module and looks the task up in the *current app's* registry.

### Built-in tasks

`celery/app/builtins.py` registers internal tasks with `connect_on_app_finalize`, so every app has them:

| Task name | Purpose |
| --- | --- |
| `celery.backend_cleanup` | Delete expired results (scheduled by beat when `result_expires` is set). |
| `celery.accumulate` | Collect arguments (used when replacing a task with a group). |
| `celery.chord_unlock` | Poll group results and fire the chord body for backends without native chord support. |
| `celery.map`, `celery.starmap`, `celery.chunks` | Execute `xmap`/`xstarmap`/`chunks` canvas primitives. |
| `celery.group`, `celery.chain`, `celery.chord` | Legacy/compat task forms of canvas primitives. |

See [Canvas: Signatures and Workflows](../canvas/signatures-and-workflows.md).

## Calling a task

- `task(*args)` (`__call__`) runs the body **in the current process**: it pushes the task onto the global task stack and a request context (`called_directly=True`) and calls `run`.
- `task.apply()` executes eagerly through the full tracer (`build_tracer(eager=True)`), returning an `EagerResult`; exceptions propagate when `task_eager_propagates` is set. An eager `Retry` re-applies the retry signature recursively.
- `task.delay(*a, **kw)` is `apply_async(a, kw)`.
- `task.apply_async()`:
  - raises `ValueError` if `soft_time_limit > time_limit`;
  - when `typing` is enabled, checks arguments against `__header__` (raising `TypeError` on mismatch);
  - merges cached exec options (queue, routing key, exchange, priority, etc. from the task class);
  - with `task_always_eager`, round-trips args through the serializer (to surface serialization errors) and calls `apply()` inside `denied_join_result()`;
  - otherwise delegates to `app.send_task(...)` — see [Message Publishing, Protocol and Routing](../messaging/publishing-and-routing.md).

## The request context

`Task.request` returns the top of the per-task `request_stack`, a `Context` populated from message headers by the worker (`id`, `root_id`, `parent_id`, `group`, `group_index`, `chord`, `chain`, `callbacks`, `errbacks`, `retries`, `eta`, `expires`, `delivery_info`, `hostname`, `timelimit`, `stamps`, `replaced_task_nesting`, ...). `called_directly` defaults to `True` and is `False` for worker executions. `Context.as_execution_options()` is used to rebuild publish options for retries.

## Retries

`Task.retry()`:

1. Increments `request.retries`; a `max_retries` argument overrides `self.max_retries` for this call only.
2. If the task was called directly (not via a worker), re-raises `exc` or a `Retry`.
3. Uses `default_retry_delay` (180s) when neither `eta` nor `countdown` is given.
4. Builds a new signature from the current request (`signature_from_request`), preserving ids, links, chord and group membership.
5. If `retries > max_retries` it re-raises `exc` (if provided) or raises `MaxRetriesExceededError`. `max_retries=None` on the class means retry forever.
6. Otherwise publishes the retry signature; if publishing fails the original message is rejected (`Reject(requeue=False)`).
7. Raises a `Retry` exception (unless `throw=False`). The worker's tracer recognises `Retry` and marks the task `RETRY` rather than `FAILURE`.

`Retry`, `Ignore` and `Reject` (in `celery/exceptions.py`) are *task predicates*: control-flow exceptions interpreted by the tracer. `Ignore` skips state updates; `Reject(requeue=...)` asks the worker to reject the message (see [Task Execution](../worker/task-execution.md)).

### Autoretry

`add_autoretry_behaviour` (`celery/app/autoretry.py`) wraps `run` when `autoretry_for` is set:

- `Ignore`, `Retry` and anything in `dont_autoretry_for` are re-raised untouched.
- Exceptions in `autoretry_for` trigger `task.retry(exc=exc, **retry_kwargs)`.
- With `retry_backoff`, the countdown is `get_exponential_backoff_interval(factor, retries, maximum=retry_backoff_max (600), full_jitter=retry_jitter (True))`.
- The wrapper is applied only once (guarded by `_orig_run`).

## Replacing and extending

- `Task.replace(sig)` hands the remainder of the work to another signature that **inherits the current task id**: callbacks/errbacks are re-linked, groups are upgraded to a chord with `celery.accumulate`, the remaining `request.chain` is appended, chord/group membership is copied, and `replaced_task_nesting` is incremented. Replacing with a signature that has a `chord` option or an empty chain raises `ImproperlyConfigured`. In a worker it ends by raising `Ignore`.
- `Task.add_to_chord(sig)` adds a task to the currently running chord (requires backend support; Redis implements it).
- `Task.update_state()` writes custom states/meta to the backend, e.g. progress reporting.

## Related tests

- `t/unit/tasks/test_tasks.py` — retry, replace, apply_async options, typing.
- `t/unit/app/test_registry.py`, `t/unit/app/test_annotations.py`, `t/unit/app/test_builtins.py`.
- `t/integration/test_tasks.py` — end-to-end retries and autoretry against a live broker.
