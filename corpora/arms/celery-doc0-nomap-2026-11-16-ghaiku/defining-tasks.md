---
title: "Defining Tasks"
---
## Overview

A task is a class that derives from `Task` and is registered under a name on one app. Users rarely write that class by hand: the `@app.task` decorator wraps a function in a generated subclass, and `register_task` accepts a class directly. This page covers how a definition becomes a registered, bound task. The message that calls it is covered in [[Sending a Task Message]], and the retry options that the decorator passes on are covered in [[Retries, Failures and Time Limits]].

Sources: [celery/app/task.py:206-216](repo://celery/app/task.py#L206-L216), [celery/app/base.py:515-530](repo://celery/app/base.py#L515-L530)

## The decorator path

`app.task` returns the inner decorator. When the decorator runs before finalize and `lazy` is on, it stores a proxy in the pending list. Otherwise it calls `_task_from_fun` at once.

Sources: [celery/app/base.py:557-573](repo://celery/app/base.py#L557-L573)

`_task_from_fun` builds the class with Python's `type()` call. The class takes the app, the name, the function as `run`, the module, the annotations and a type checker for the function's signature. Extra keyword options go into the same class dictionary, and the instance is stored in the app's registry.

Sources: [celery/app/base.py:604-630](repo://celery/app/base.py#L604-L630)

```python
task = type(fun.__name__, (base,), dict({
    'app': self,
    'name': name,
    'run': run,
    '_decorated': True,
    '__doc__': fun.__doc__,
    '__module__': fun.__module__,
    '__annotations__': _get_annotations(fun),
    '__header__': self.type_checker(fun, bound=bind),
    '__wrapped__': run}, **options))()
self._tasks[task.name] = task
task.bind(self)
add_autoretry_behaviour(task, **options)
```

Sources: [celery/app/base.py:611-630](repo://celery/app/base.py#L611-L630)

A function marked with `bind=True` receives the task instance as its first argument. Without it, `run` is wrapped in `staticmethod`, so the function is called without the task. The `base` argument, when given, replaces the app's default `Task` class for this one task.

Sources: [celery/app/base.py:604-611](repo://celery/app/base.py#L604-L611)

`shared_task` is the same decorator for library code. It is called without an app and returns a function that applies `app.task` to whichever app is current when the decorator is evaluated.

Sources: [celery/app/__init__.py:24-40](repo://celery/app/__init__.py#L24-L40)

## The Task class

The base class declares the defaults a task inherits. `max_retries` is 3, `default_retry_delay` is three minutes, and `rate_limit` is unset. The `Strategy` and `Request` attributes name the worker classes by path, so a task can change how the worker handles it without touching the worker.

Sources: [celery/app/task.py:215-250](repo://celery/app/task.py#L215-L250)

`from_config` maps several task attributes to configuration keys. When `bind` runs, each attribute that is still `None` on the class takes the value of its key, so a class-level value always wins over a setting, and a setting wins over the base class.

Sources: [celery/app/task.py:396-406](repo://celery/app/task.py#L396-L406), [celery/app/task.py:428-430](repo://celery/app/task.py#L428-L430)

The `acks_on_failure` and `acks_on_timeout` attributes are resolved in the same way. Each one falls back to `acks_on_failure_or_timeout`, and that falls back to `True`.

Sources: [celery/app/task.py:432-443](repo://celery/app/task.py#L432-L443)

## Binding

`Task.bind` attaches a class to an app. It sets `_app`, clears the cached execution options, fills in `typing` from the app's `strict_typing`, applies the `from_config` values, and then applies the annotations from `task_annotations` that match this task.

Sources: [celery/app/task.py:419-445](repo://celery/app/task.py#L419-L445), [celery/app/task.py:477-484](repo://celery/app/task.py#L477-L484)

The `app` attribute is a class property. If a task is used before any app has bound it, the property binds it to the current app at that moment.

Sources: [celery/app/task.py:466-475](repo://celery/app/task.py#L466-L475)

Annotations are matched by the task's name and by a catch-all entry. `prepare_annotations` turns each entry of `task_annotations` into a `MapAnnotation` or a lazy callable, and `resolve_all` yields the matching entries for a task.

Sources: [celery/app/annotations.py:34-52](repo://celery/app/annotations.py#L34-L52), [celery/app/base.py:1463-1464](repo://celery/app/base.py#L1463-L1464)

## Naming

The name is the task's key in the registry and in the message. `gen_task_name` builds it from the function name and the module name. When the module is `__main__` and the app has a `main` attribute, the name uses `main` instead, so a script's tasks are named the same way whether they run as `__main__` or as an imported module.

Sources: [celery/utils/imports.py:122-141](repo://celery/utils/imports.py#L122-L141), [celery/app/base.py:654-655](repo://celery/app/base.py#L654-L655)

`register_task` generates a name only when the class has none, then stores the task under its name in `self.tasks`. Registering a second task under the same name replaces the first entry.

Sources: [celery/app/base.py:635-653](repo://celery/app/base.py#L635-L653)

## The registry

`TaskRegistry` is a dictionary keyed by task name. Looking up a name that is not in it raises `NotRegistered`. Its `register` method refuses a class that has no `name`, instantiates a class that was given, applies the autoretry behaviour, and stores the task by name.

Sources: [celery/app/registry.py:12-32](repo://celery/app/registry.py#L12-L32)

`add_autoretry_behaviour` wraps the task's `run` method. The wrapper catches the exception types named in `autoretry_for` and passes the exception to `task.retry`, so the task body needs no try block of its own. The retry options are read from the task class or from the decorator keywords. When `retry_backoff` is set, the wrapper sets the countdown from `get_exponential_backoff_interval`, and it uses `max_retries` from the task unless an override was given.

Sources: [celery/app/autoretry.py:8-31](repo://celery/app/autoretry.py#L8-L31), [celery/app/autoretry.py:33-60](repo://celery/app/autoretry.py#L33-L60)

## The request context

Inside a running task, `self.request` is a `Context` object that holds the message fields of the call: the id, the arguments, the retry count, the delivery information and the callbacks. The defaults are declared as class attributes, so a task that is not running reads `None` for each field.

Sources: [celery/app/task.py:75-92](repo://celery/app/task.py#L75-L92)
