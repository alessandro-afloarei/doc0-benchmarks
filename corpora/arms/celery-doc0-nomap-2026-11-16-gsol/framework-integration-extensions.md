---
title: "Framework Integration and Extensions"
---
## Overview

Integrations join the application lifecycle through fixups, task classes, signals, and bootsteps. Django provides a concrete example: its fixup prepares the framework before task imports, discovers installed apps, supplies a task base, and cleans up resources around execution. [[Application and Configuration]] explains the underlying setup lifecycle; [[Worker Lifecycle and Execution]] shows where worker components and task hooks run.

Sources: [celery/fixups/django.py:52-123](repo://celery/fixups/django.py#L52-L123), [celery/fixups/django.py:146-163](repo://celery/fixups/django.py#L146-L163), [celery/worker/worker.py:127-139](repo://celery/worker/worker.py#L127-L139)

## Connect a Django application

The example sets `DJANGO_SETTINGS_MODULE`, constructs an app, loads `django.conf:settings` under the `CELERY` namespace, and calls autodiscovery. Its comment explains why configuration is passed as a string: the worker need not serialize the configuration object to child processes. Namespaced framework settings use a `CELERY_` prefix; the core settings view and precedence are documented in [[Application and Configuration]].

Sources: [examples/django/proj/celery.py:1-17](repo://examples/django/proj/celery.py#L1-L17)

```python
app = Celery('proj')

# Using a string here means the worker doesn't have to serialize
# the configuration object to child processes.
# - namespace='CELERY' means all celery-related configuration keys
#   should have a `CELERY_` prefix.
app.config_from_object('django.conf:settings', namespace='CELERY')

# Load task modules from all registered Django apps.
app.autodiscover_tasks()
```

Sources: [examples/django/proj/celery.py:8-17](repo://examples/django/proj/celery.py#L8-L17)

The Django fixup activates when the settings environment variable is present and the selected loader is not already Django-specific. It imports Django, verifies its supported-version condition, and installs `DjangoFixup`; a missing Django import produces a fixup warning. Installation prepends the project working directory to the import path, overrides the loader's clock, selects `DjangoTask` unless a custom task class was supplied, and connects import and worker-init signals.

Sources: [celery/fixups/django.py:47-89](repo://celery/fixups/django.py#L47-L89)

Before task modules import, the fixup runs `django.setup` and model checks unless `CELERY_SKIP_CHECKS` is set. Its autodiscovery provider returns installed Django application names, which the core autodiscovery mechanism searches for task modules. Worker initialization retains the actual controller reference and installs the worker resource hooks.

Sources: [celery/fixups/django.py:101-123](repo://celery/fixups/django.py#L101-L123), [celery/fixups/django.py:146-163](repo://celery/fixups/django.py#L146-L163), [celery/app/base.py:828-844](repo://celery/app/base.py#L828-L844)

## Publish after a transaction commits

`DjangoTask.delay_on_commit` registers a partial call to `delay` with `transaction.on_commit`; `apply_async_on_commit` does the same for the richer submission interface in [[Task Publishing and Routing]]. Both methods return `None`: they register deferred publication, rather than returning a task handle immediately. This ties the send operation to the Django transaction's commit callback.

Sources: [celery/contrib/django/task.py:8-21](repo://celery/contrib/django/task.py#L8-L21)

The fixup only chooses this task base when the app has not explicitly supplied its own. A custom task class therefore needs to provide any desired transaction-aware interface itself or inherit the supplied Django class. The base behavior stays small: the two methods delegate execution semantics to ordinary `delay` and `apply_async` once Django calls them.

Sources: [celery/fixups/django.py:84-85](repo://celery/fixups/django.py#L84-L85), [celery/contrib/django/task.py:15-21](repo://celery/contrib/django/task.py#L15-L21)

## Clean up framework resources

`DjangoWorkerFixup.install` connects embedded Beat initialization, task prerun/postrun, and child-process initialization. It initially closes database and cache resources. Before and after non-eager tasks, it closes database connections, and afterward also closes caches; eager tasks skip these per-task cleanup hooks. [[Development and Testing]] explains why this distinction matters when comparing eager tests with a worker test.

Sources: [celery/fixups/django.py:156-163](repo://celery/fixups/django.py#L156-L163), [celery/fixups/django.py:194-203](repo://celery/fixups/django.py#L194-L203)

Child initialization closes inherited database descriptors before closing framework connections, avoiding network I/O that could break a connection still used by the parent. A spawned/exec-style child validates models again. The cleanup path can account for `CELERY_DB_REUSE_MAX`; for prefork workers and configured Django connection pools, it also closes the pool when the connection supports `close_pool`.

Sources: [celery/fixups/django.py:165-190](repo://celery/fixups/django.py#L165-L190), [celery/fixups/django.py:205-240](repo://celery/fixups/django.py#L205-L240)

## Share tasks across applications

`shared_task` supports library code that should work with different applications. It connects a task-construction callback for future finalizations and registers the function on active applications that are already finalized. The returned proxy resolves the task from the current application's registry each time it is accessed. This extends the registration mechanism in [[Application and Configuration]] without fixing the library task to one application instance.

Sources: [celery/app/__init__.py:24-32](repo://celery/app/__init__.py#L24-L32), [celery/app/__init__.py:48-71](repo://celery/app/__init__.py#L48-L71)

## Attach signal receivers

Signal receivers must accept keyword arguments. `connect` supports sender filtering, weak references, and a dispatch identifier for deduplication. Weak references are the default, so a receiver must remain alive elsewhere or use a strong-reference connection. With `retry=True`, the signal retains a strong reference and retries its receiver until success. These are in-process lifecycle callbacks, separate from the broker event stream in [[Monitoring and Worker Control]].

Sources: [celery/utils/dispatch/signal.py:110-161](repo://celery/utils/dispatch/signal.py#L110-L161), [celery/events/dispatcher.py:116-140](repo://celery/events/dispatcher.py#L116-L140)

Signals include publication, receipt, prerun/postrun, success, retry, failure, revocation, rejection, and unknown-task notifications. `send` catches receiver exceptions, logs them, and returns them as receiver responses. The loader explicitly checks import-signal responses and reraises exceptions before worker logging is ready. An extension must therefore understand how its particular signal caller handles responses rather than assuming all receiver errors stop execution.

Sources: [celery/signals.py:30-86](repo://celery/signals.py#L30-L86), [celery/utils/dispatch/signal.py:258-289](repo://celery/utils/dispatch/signal.py#L258-L289), [celery/loaders/base.py:97-105](repo://celery/loaders/base.py#L97-L105)

## Add services with bootsteps

Worker-specific extensions join `app.steps['worker']`, which the controller includes in its blueprint. A step declares dependencies with `requires`, limited to the same blueprint. The blueprint resolves a dependency graph and topologically sorts it, instantiates steps in that order, and calls their inclusion logic. Use `include_if` for conditional creation and `create` to supply the service object.

Sources: [celery/worker/worker.py:129-139](repo://celery/worker/worker.py#L129-L139), [celery/bootsteps.py:199-212](repo://celery/bootsteps.py#L199-L212), [celery/bootsteps.py:235-249](repo://celery/bootsteps.py#L235-L249), [celery/bootsteps.py:303-342](repo://celery/bootsteps.py#L303-L342)

`StartStopStep` adds included steps to the parent's lifecycle list and delegates start/stop to the created object. Startup visits that list in order; normal stop and termination visit it in reverse. `ConsumerStep` requires a connection, obtains a channel, and starts the consumers returned by `get_consumers`. This lets an extension acquire services after its dependencies and release them before those dependencies disappear.

Sources: [celery/bootsteps.py:109-117](repo://celery/bootsteps.py#L109-L117), [celery/bootsteps.py:137-170](repo://celery/bootsteps.py#L137-L170), [celery/bootsteps.py:355-405](repo://celery/bootsteps.py#L355-L405)

## Extend argument and serialization boundaries

Tasks declared with `pydantic=True` use the application's Pydantic wrapper. It binds arguments to the function signature, validates model-annotated values, provides app/task-name context, and dumps model returns when they match the return annotation. Missing Pydantic raises `ImproperlyConfigured`. This conversion happens around the function invocation; transport serialization remains the publication concern described in [[Task Publishing and Routing]].

Sources: [celery/app/base.py:127-147](repo://celery/app/base.py#L127-L147), [celery/app/base.py:161-203](repo://celery/app/base.py#L161-L203), [celery/app/base.py:607-609](repo://celery/app/base.py#L607-L609)

The authentication serializer is another optional boundary extension. `setup_security` requires `task_serializer='auth'`, `accept_content=['auth']`, and key/certificate/store configuration before registering it. The serializer signs serialized bytes and verifies those bytes before decoding them; the code gives avoiding flaws in the decoding step as the reason for this order. Configuration validation raises immediately when the signing setup is incomplete.

Sources: [celery/security/__init__.py:44-70](repo://celery/security/__init__.py#L44-L70), [celery/security/serialization.py:31-58](repo://celery/security/serialization.py#L31-L58)
