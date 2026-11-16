---
type: subsystem
title: Task Definition and Invocation
description: How tasks are defined and called — the Task class and its configuration-derived attributes, lazy binding to an app, the request Context, argument type checking and Pydantic support, the delay/apply_async/send_task publishing path with option merging, eager execution with apply(), built-in tasks, and the hooks a custom Task base can override.
tags: [task, apply-async, delay, eager, registry, pydantic, task-options]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:05:29.073Z
sources:
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-868b95b69384872926804a54
    resource: repo://celery/app/builtins.py
  - id: openwiki-source-eee674a48f00d180319d175e
    resource: repo://celery/app/registry.py
  - id: openwiki-source-3795aa577fa7b0f3bd2af81a
    resource: repo://celery/app/task.py
generated: { by: "claude-code", at: "2026-11-16T17:05:29.073Z" }
---

# Task Definition and Invocation

A task is a subclass of `celery.app.task.Task` (`celery/app/task.py`) registered by name in the app's `TaskRegistry`. `@app.task` / `@shared_task` generate the subclass from a function (see [Application Object](../architecture/application-object.md)); class-based tasks can be registered with `app.register_task(cls)`.

## Task class anatomy

Each task class is instantiated **once per process** — the registry holds a singleton — so task instances must not hold per-call state. Per-call data lives in `self.request`.

Important class attributes (all overridable via decorator options `@app.task(**opts)`):

| Attribute | Default | Purpose |
|-----------|---------|---------|
| `name` | `module.function` | Registry key and message `task` header |
| `typing` | `app.strict_typing` (True) | Check call arguments against the function signature at publish time |
| `max_retries`, `default_retry_delay` | 3, 180 s | Retry policy ([Retries](execution-tracing-and-retries.md#retrying)) |
| `autoretry_for`, `dont_autoretry_for`, `retry_kwargs`, `retry_backoff`, `retry_backoff_max`, `retry_jitter` | — | Automatic retries |
| `rate_limit` | `task_default_rate_limit` | Worker-side token bucket, e.g. `'10/m'` |
| `ignore_result`, `store_errors_even_if_ignored` | config | Result storage |
| `time_limit`, `soft_time_limit` | config | Hard/soft limits enforced by the pool |
| `acks_late`, `acks_on_failure`, `acks_on_timeout`, `reject_on_worker_lost` | config | Acknowledgement semantics ([Request Lifecycle](../worker/request-lifecycle.md)) |
| `track_started` | config | Store `STARTED` state |
| `serializer`, `priority`, `expires`, `queue`, `routing_key`, `exchange`, `compression`, `delivery_mode` | — | Publish options |
| `throws` | `()` | Expected exceptions, logged without traceback |
| `trail` | True | Record child results in `request.children` |
| `send_events` | True | Emit task events for this task |
| `Request`, `Strategy` | `celery.worker.request:Request`, `celery.worker.strategy:default` | Worker-side customisation |

### Lazy binding

`Task.bind(app)` runs when the task is first associated with an app (on registration and finalize). For every pair in `from_config` (`serializer`↔`task_serializer`, `rate_limit`↔`task_default_rate_limit`, `time_limit`, `soft_time_limit`, `track_started`, `acks_late`, `acks_on_*`, `reject_on_worker_lost`, `ignore_result`, `store_eager_result`, `store_errors_even_if_ignored`, `priority`) it copies the configuration value **only if the class attribute is `None`**, so explicit task options win over global settings. It also resolves `acks_on_failure`/`acks_on_timeout` from the deprecated combined flag, applies [task annotations](../architecture/signals-and-extension-points.md#task-annotations) on first bind, and creates the thread-local `request_stack`.

### The request `Context`

`task.request` is the top of `request_stack` (or an empty default `Context` outside execution). It exposes `id`, `args`, `kwargs`, `retries`, `is_eager`, `called_directly`, `delivery_info`, `hostname`, `reply_to`, `correlation_id`, `root_id`, `parent_id`, `group`, `group_index`, `chord`, `chain`, `callbacks`, `errbacks`, `timelimit`, `eta`, `expires`, `origin`, `stamps`, custom headers, and more. `as_execution_options()` turns it back into `apply_async` options, which is how `retry()` and `replace()` preserve workflow context.

### Pickling

Tasks pickle as their name (plus module, so the receiver can import it): `_unpickle_task_v2(name, module)` looks the task up in the current app's registry.

## Calling a task

```text
task(*a)            → Task.__call__ → run() in-process (pushes request; no message)
task.delay(*a)      → apply_async(a, kw)
task.apply_async()  → (eager?) apply() : app.send_task()
task.apply()        → build_tracer(eager=True) → EagerResult
app.send_task(name) → publish by name without needing the task code
```

### `apply_async(args, kwargs, task_id, producer, link, link_error, shadow, **options)`

1. Validates `soft_time_limit <= time_limit` (else `ValueError`).
2. If `typing` is enabled, calls the generated `__header__` checker with the arguments, raising `TypeError` on mismatch **before** anything is sent (`head_from_fun` compiles a stub with the same signature for speed).
3. Computes `shadow` via `shadow_name()` if overridden.
4. Merges options: task-level publish attributes (`_get_exec_options`: queue, routing_key, exchange, priority, expires, serializer, delivery_mode, compression, time_limit, soft_time_limit) are the base, overridden by call options; `ignore_result` and `priority` defaults come from the task.
5. **Eager mode** (`task_always_eager`): arguments are serialised and deserialised with the configured serializer (to catch unserialisable arguments like in production), then `apply()` runs inside `denied_join_result()`.
6. Otherwise calls `app.send_task(self.name, args, kwargs, task_type=self, result_cls=self.AsyncResult, ...)`.

`app.send_task` (`celery/app/base.py`) then: warns that `task_always_eager` has no effect on it, extracts `ignore_result`, routes the call ([Routing](messaging-and-routing.md#routing)), handles quorum-queue delayed delivery and expiry, fills `parent_id`/`root_id` from the currently executing worker task (and its priority with `task_inherit_parent_priority`), builds and publishes the message, and returns an `AsyncResult` (marked `ignored` if results are ignored) that is also added to the parent task's trail. Unknown keyword options are passed through to kombu's `Producer.publish`.

Common call options: `countdown`, `eta`, `expires`, `queue`, `routing_key`, `exchange`, `priority`, `serializer`, `compression`, `headers`, `link`, `link_error`, `task_id`, `retry`/`retry_policy`, `time_limit`, `soft_time_limit`, `ignore_result`, `shadow`, `add_to_parent`.

### `apply()` — eager execution

Builds a request dict (`is_eager=True`, parent/root ids from the current task stack, callbacks/errbacks from `link`/`link_error`, time limits, delivery info), runs the tracer with `eager=True`, and returns an `EagerResult`. `throw` defaults to `task_eager_propagates`. A `Retry` raised eagerly re-runs `apply()` with `retries + 1`. Results are only stored with `task_store_eager_result`.

## Signatures from tasks

`task.s(...)`, `task.si(...)` (immutable), `task.signature(args, kwargs, **options)`, `task.map(it)`, `task.starmap(it)`, `task.chunks(it, n)` create canvas objects (see [Canvas](../canvas/workflows.md)).

## Other task-side APIs

- `self.update_state(state=..., meta=...)` — store a custom state (defaults to the current task id).
- `self.send_event('task-custom', **fields)` — emit a monitoring event.
- `self.retry(...)`, `self.replace(sig)`, `self.add_to_chord(sig)`.
- Hooks for custom bases: `before_start`, `on_success`, `on_retry`, `on_failure`, `after_return`, `on_replace`, plus `on_bound(app)` (class-level, called at bind time).
- `task.backend` — per-task backend override; defaults to `app.backend`.

## Pydantic support

`@app.task(pydantic=True)` wraps the function (`pydantic_wrapper` in `celery/app/base.py`): arguments annotated with a `pydantic.BaseModel` subclass (including `Optional[...]`) are validated from their serialised dict form with `model_validate` (`pydantic_strict`, `pydantic_context` options; the context includes `celery_app` and `celery_task_name`), and a returned model matching the return annotation is converted with `model_dump(mode='json', **pydantic_dump_kwargs)`. Pydantic must be installed (`celery[pydantic]`), otherwise `ImproperlyConfigured` is raised.

## Registry and built-in tasks

`TaskRegistry` is a dict whose missing keys raise `NotRegistered`; `register()` requires a name and adds autoretry behaviour. Built-in tasks registered on every app via `connect_on_app_finalize` (`celery/app/builtins.py`):

| Name | Role |
|------|------|
| `celery.backend_cleanup` | Expire old results (scheduled by beat) |
| `celery.chord_unlock` | Poll a chord header and call the body |
| `celery.group`, `celery.chain`, `celery.chord` | Canvas primitives when run as tasks |
| `celery.map`, `celery.starmap`, `celery.chunks` | Iterable helpers |
| `celery.accumulate` | Return arguments (test/utility) |

Worker-side, messages for names that are not registered are rejected and logged as unknown tasks (`task_unknown` signal) — see [Request Lifecycle](../worker/request-lifecycle.md).

## Tests

- `t/unit/tasks/test_tasks.py` — options, `apply_async`/`apply`, eager mode, type checking, retries, `update_state`, `replace`.
- `t/unit/tasks/test_context.py` — `Context` behaviour.
- `t/unit/app/test_app.py`, `test_registry.py`, `test_builtins.py`.
- `t/unit/app/test_app.py` and `t/integration/test_tasks.py` include Pydantic task cases.

## Related

- [Message Protocol, Queues and Routing](messaging-and-routing.md)
- [Task Execution, Tracing and Retries](execution-tracing-and-retries.md)
- [Canvas](../canvas/workflows.md)
