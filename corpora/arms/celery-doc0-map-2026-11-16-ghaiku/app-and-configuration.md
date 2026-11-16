---
title: "Application and Configuration"
---
## Overview

The `Celery` class in `celery/app/base.py` is the application: every task, sender and worker reads from one instance. It keeps the task registry, the configuration and the fix-ups that adapt it to other frameworks. This page covers how an instance is built, how its settings are loaded and finalized, and how a task decorator becomes a registered task. Message building is in [[Sending Tasks]] and the task class is in [[Tasks]].

Sources: [celery/app/base.py:252-258](repo://celery/app/base.py#L252-L258)

## Construction

`__init__` keeps the task registry and a set of pending configuration, then stores the `broker` and `backend` arguments and any extra keyword arguments as settings. The settings object itself is created after that, so the keyword values are part of the first configuration layer.

Sources: [celery/app/base.py:343-402](repo://celery/app/base.py#L343-L402)

The registry is an existing `TaskRegistry` if one is passed in, otherwise a new one built from `registry_cls`, which keeps every task defined on the app by name.

Sources: [celery/app/base.py:383-386](repo://celery/app/base.py#L383-L386)

Settings are a `Settings` view over a `PendingConfiguration`. Writes made to `app.conf` before the configuration is first read are stored in the pending data; reading any key finalizes the configuration and replaces the pending object with the real settings.

Sources: [celery/app/base.py:403-407](repo://celery/app/base.py#L403-L407)

```python
self._conf = Settings(
    PendingConfiguration(
        self._preconf, self._finalize_pending_conf),
    prefix=self.namespace,
    keys=(_old_key_to_new, _new_key_to_old),
)
```

Sources: [celery/app/base.py:403-407](repo://celery/app/base.py#L403-L407)

Fix-ups are loaded by name from `builtin_fixups` unless the caller passes its own set. Each fix-up is instantiated with the app and kept in `_fixups` so that the weak references it installs stay alive.

Sources: [celery/app/base.py:411-413](repo://celery/app/base.py#L411-L413)

When `set_as_current` is true the app becomes the process's current app, which is what `current_app` returns to code that has no app argument.

Sources: [celery/app/base.py:415-416](repo://celery/app/base.py#L415-L416)

## Loading configuration

`_load_config` runs once, on the first read of a setting. It sends `on_configure`, reads the `config_source` object through the loader if one was given, detects the namespaced settings and swaps them into the existing `Settings` object, so references taken earlier see the final values.

Sources: [celery/app/base.py:1247-1275](repo://celery/app/base.py#L1247-L1275)

The final settings are a chain: the explicit values (constructor arguments and earlier writes to `app.conf`) come first, then the loaded module, then the built-in defaults. A value passed to the constructor therefore overrides the same key in the module. `detect_settings` also decides whether the names are old-style or new-style from the module and the explicit values, skipping the keys set by the constructor arguments, and raises an error when the two styles are mixed.

Sources: [celery/app/utils.py:232-285](repo://celery/app/utils.py#L232-L285)

The loader's `config_from_object` accepts a module path string or an object. A string is imported from the current working directory and the result becomes the loader's configuration mapping.

Sources: [celery/loaders/base.py:119-130](repo://celery/loaders/base.py#L119-L130)

`config_from_object` and `config_from_envvar` on the app delegate to the same loader. They are the usual ways for a program to point the app at a settings module.

Sources: [celery/app/base.py:703-740](repo://celery/app/base.py#L703-L740)

## Finalization

`finalize` runs once. It sets `finalized`, sends `on_after_finalize`, evaluates every pending task decorator that was queued while the app was not finalized, and binds each task in the registry to the app.

Sources: [celery/app/base.py:657-678](repo://celery/app/base.py#L657-L678)

Finalization can also run implicitly, when code that needs the app calls `finalize(auto=True)`. With `autofinalize` set to `False` that implicit call raises a `RuntimeError` instead, so the app is only finalized by an explicit `finalize` call.

Sources: [celery/app/base.py:657-667](repo://celery/app/base.py#L657-L667)

## Task decorator and registration

`@app.task` with no options returns a task class created by `_task_from_fun`. When the app is not finalized and `lazy` is left on, the decorator returns a `PromiseProxy` and appends it to `_pending`, so the class is built only when the app finalizes.

Sources: [celery/app/base.py:554-572](repo://celery/app/base.py#L554-L572)

`_task_from_fun` derives a task class from the app's base task, names it, and stores it in the registry under its name. A task whose name is already registered is not replaced.

Sources: [celery/app/base.py:607-631](repo://celery/app/base.py#L607-L631)

Tasks decorated with `shared=True` are also connected to app finalization, so each app that loads the module gets its own task class for the same function.

Sources: [celery/app/base.py:555-562](repo://celery/app/base.py#L555-L562)
