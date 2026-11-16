---
title: "The Celery App"
---
## Overview

The `Celery` class in `celery/app/base.py` is the object every other part of the package hangs from. It holds the settings, the task registry, the classes for the AMQP helper, events, control and logging, and the signals that mark the app's lifecycle. A program may create several apps; one of them is the current app for the thread.

Sources: [celery/app/base.py:252-287](repo://celery/app/base.py#L252-L287)

Each app is created by calling the class, and a decorator on a function turns it into a task of that app. Most of the attribute work described below happens in the first two calls, and the settings are read later.

Sources: [celery/app/base.py:343-348](repo://celery/app/base.py#L343-L348)

## Construction

`__init__` stores the components it was given, falling back to the class attributes. The loader is taken from `CELERY_LOADER` when that variable is set, and otherwise from the `loader_cls` attribute, which defaults to the app loader.

Sources: [celery/app/base.py:352-357](repo://celery/app/base.py#L352-L357), [celery/app/base.py:436-441](repo://celery/app/base.py#L436-L441)

The `broker`, `backend` and `include` keywords are not written to the settings directly. Each one goes through `__autoset`, which records the value in a pre-configuration dict and adds the key to `_preconf_set_by_auto`. Later, when the configuration is merged, that set is passed as the list of keys to ignore, so these values are not overridden by the loader's values.

Sources: [celery/app/base.py:394-401](repo://celery/app/base.py#L394-L401), [celery/app/base.py:447-450](repo://celery/app/base.py#L447-L450), [celery/app/base.py:1256-1259](repo://celery/app/base.py#L1256-L1259)

The settings object is built from a `PendingConfiguration` wrapper around the pre-configuration dict. Its `data` property calls back into the app, so the first access to any key runs the configuration load.

Sources: [celery/app/base.py:403-408](repo://celery/app/base.py#L403-L408), [celery/app/base.py:208-250](repo://celery/app/base.py#L208-L250), [celery/app/base.py:1230-1238](repo://celery/app/base.py#L1230-L1238)

Fixups are instantiated from their class paths at this point, and the app marks itself current for the thread when `set_as_current` is true. The app then creates its signals and registers itself in the global list of apps.

Sources: [celery/app/base.py:410-416](repo://celery/app/base.py#L410-L416), [celery/app/base.py:418-434](repo://celery/app/base.py#L418-L434)

## Decorated tasks

`app.task` builds the task class at once only when the app is already finalized or the `lazy` option is false. Otherwise it returns a `PromiseProxy` that is appended to the pending list, and `finalize` evaluates it.

Sources: [celery/app/base.py:557-573](repo://celery/app/base.py#L557-L573)

`register_task` is the path used by class-based tasks. It names the task from its module when it has no name, applies the autoretry behaviour from its options, and stores the task in `self.tasks`, which binds it to this app.

Sources: [celery/app/base.py:635-653](repo://celery/app/base.py#L635-L653)

## Finalizing

`finalize` runs once. It sets `finalized`, announces the app to the connect-on-finalize hooks, evaluates each pending decorator in order, binds every registered task to the app, and then sends `on_after_finalize`. Calling it again does nothing, and it runs under a re-entrant lock so that two threads cannot finalize twice.

Sources: [celery/app/base.py:657-677](repo://celery/app/base.py#L657-L677)

```python
def finalize(self, auto=False):
    with self._finalize_mutex:
        if not self.finalized:
            if auto and not self.autofinalize:
                raise RuntimeError('Contract breach: app not finalized')
            self.finalized = True
            _announce_app_finalized(self)
            pending = self._pending
            while pending:
                maybe_evaluate(pending.popleft())
            for task in self._tasks.values():
                task.bind(self)
            self.on_after_finalize.send(sender=self)
```

Sources: [celery/app/base.py:657-677](repo://celery/app/base.py#L657-L677)

An app created with `autofinalize=False` does not finalize itself when a task is used. A call that asks for automatic finalizing on such an app raises `RuntimeError` instead, so the program must call `finalize()` itself before it uses the registry.

Sources: [celery/app/base.py:665-666](repo://celery/app/base.py#L665-L666)

Configuration loads when the settings are first read after construction, through `_load_config`. The `on_configure` signal fires first, then the config source object is read, then the loader's settings are merged with the constructor values, and finally lazy defaults and lazy periodic tasks are applied.

Sources: [celery/app/base.py:1247-1280](repo://celery/app/base.py#L1247-L1280)

The loader's configuration step is what fills in `loader.conf`, and [[Configuration]] explains the order in which those sources are merged.

Sources: [celery/app/base.py:1253-1259](repo://celery/app/base.py#L1253-L1259)

## The current app

Code that does not receive an app uses `current_app`, which `celery/_state.py` resolves per thread. If no app was set for the thread, the fallback is a default app created on first use with `fixups=[]` and `set_as_current=False`.

Sources: [celery/_state.py:86-118](repo://celery/_state.py#L86-L118)

`set_current` writes the app to the thread-local slot, and `set_default` writes the process-wide default. Lookups prefer the thread's slot and then fall back to the default.

Sources: [celery/app/base.py:452-458](repo://celery/app/base.py#L452-L458), [celery/_state.py:100](repo://celery/_state.py#L100)

## Autodiscovery

`autodiscover_tasks` searches the listed packages for a module named `tasks`, or the module name given in `related_name`. Without packages it delegates to the fixups, which is how Django finds the apps in its settings. [[Registering Custom Components]] describes the loader that performs the import.

Sources: [celery/app/base.py:782-790](repo://celery/app/base.py#L782-L790), [celery/loaders/base.py:239-262](repo://celery/loaders/base.py#L239-L262)

## Pickling

An app is pickled as its class and its keyword settings. `__reduce__` returns `_unpickle_app_v2` with the class and the reduced keys, and that function builds a new app from them with `set_as_current` turned off, so unpickling does not change the current app.

Sources: [celery/app/base.py:1391-1394](repo://celery/app/base.py#L1391-L1394), [celery/app/utils.py:321-324](repo://celery/app/utils.py#L321-L324)

`_after_fork_cleanup_app` is the module-level function that multiprocessing calls in each forked child. It calls the app's `_after_fork` method, and it has to be module-level so that it can be registered with the after-fork hook.

Sources: [celery/app/base.py:118-124](repo://celery/app/base.py#L118-L124)
