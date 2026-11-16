---
title: "Registering Custom Components"
---
## Overview

Most of the package's parts are chosen by a name that is resolved at run time: a backend URL scheme, a pool name, a loader class, a worker bootstep, a fix-up. The resolver for each of them is one of two mechanisms. The first is `symbol_by_name` with an alias table, used for backends, pools and the app's component classes. The second is a list of steps or fixups that the app keeps and the blueprint reads when the worker starts. This page lists where each kind of custom component is registered and how it is found, and it leaves the internals of each component to the page that owns it.

Sources: [celery/utils/imports.py:122-143](repo://celery/utils/imports.py#L122-L143), [celery/app/base.py:305-307](repo://celery/app/base.py#L305-L307)

## Name resolution

`symbol_by_name` takes a dotted path such as `package.module:Class`, or a name that an alias table maps to such a path, and returns the object. Every place that accepts a name calls it with the table for that kind, so a custom class can be given by its full path wherever a built-in alias is accepted.

Sources: [celery/utils/imports.py:122-143](repo://celery/utils/imports.py#L122-L143)

Backends use a table of aliases plus two more sources. The loader's `override_backends` setting replaces entries, and the `celery.result_backends` entry-point group adds classes by name. An entry-point class that fails to import is skipped with a warning, so one broken plugin does not stop the others.

Sources: [celery/app/backends.py:15-56](repo://celery/app/backends.py#L15-L56), [celery/utils/imports.py:144-163](repo://celery/utils/imports.py#L144-L163)

Pools are resolved by `get_implementation`. The aliases are `prefork`, `eventlet`, `gevent` and `solo`, plus `threads` when its module imports, and a class named in `CELERY_CUSTOM_WORKER_POOL` is registered as `custom`, so `--pool custom` selects it. Any other value is a path to a class that subclasses `BasePool`.

Sources: [celery/concurrency/__init__.py:11-43](repo://celery/concurrency/__init__.py#L11-L43), [celery/worker/worker.py:129-131](repo://celery/worker/worker.py#L129-L131)

The loader is named by the `loader` keyword of the app. When no keyword is given, `_get_default_loader` picks the `CELERY_LOADER` value first, then the class attribute, then the app loader.

Sources: [celery/app/base.py:436-441](repo://celery/app/base.py#L436-L441), [celery/app/base.py:343-357](repo://celery/app/base.py#L343-L357)

## Bootsteps

`Celery.steps` is a mapping from blueprint name to a set of step classes, and `steps` starts as an empty default dictionary. The worker reads `steps['worker']` and the consumer reads `steps['consumer']`, so a step added under one of those names is included in that blueprint when it is built.

Sources: [celery/app/base.py:305-307](repo://celery/app/base.py#L305-L307), [celery/app/base.py:370](repo://celery/app/base.py#L370), [celery/worker/worker.py:134](repo://celery/worker/worker.py#L134), [celery/worker/consumer/consumer.py:252](repo://celery/worker/consumer/consumer.py#L252)

A step's `requires` names are resolved to classes by `symbol_by_name` when the blueprint is applied, and the blueprint adds any required step that was not listed. So a custom step may name a built-in step as its dependency without registering it.

Sources: [celery/bootsteps.py:224-240](repo://celery/bootsteps.py#L224-L240)

A step can decide at build time whether it applies. The blueprint calls its `include_if` hook with the parent, and a step that returns false is left out. The consumer's delayed-delivery step overrides the hook to check for quorum queues on the broker.

Sources: [celery/bootsteps.py:322-337](repo://celery/bootsteps.py#L322-L337), [celery/worker/consumer/delayed_delivery.py:55-65](repo://celery/worker/consumer/delayed_delivery.py#L55-L65)

## Fix-ups

`Celery.builtin_fixups` names the built-in fix-ups, and the constructor instantiates each name it is given, keeping the instances alive on the app. The Django fix-up is one of these. A custom fix-up is named in the `fixups` argument.

Sources: [celery/app/base.py:309](repo://celery/app/base.py#L309), [celery/app/base.py:410-413](repo://celery/app/base.py#L410-L413)

## Where the other extension points are

Custom task base classes are set with `task_cls`, custom registries with `tasks`, and custom message classes with `amqp`. Each keyword overrides the matching class attribute on the app. [[Signals]] lists the points where a program can run code without replacing a class, and [[Worker Startup and Bootsteps]] describes the blueprint the steps join.

Sources: [celery/app/base.py:311-317](repo://celery/app/base.py#L311-L317), [celery/app/base.py:343-348](repo://celery/app/base.py#L343-L348)
