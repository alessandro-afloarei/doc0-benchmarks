---
type: architecture
title: Celery App, Configuration, Loaders and Task Registry
description: How the Celery application object lazily finalizes, reads and normalizes configuration, registers tasks (including deferred decorators and shared_task), autodiscovers task modules through loaders and fixups, and how the Django fixup hooks in.
tags: [celery, app, configuration, loaders, task-registry, django, signals]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:22:47.483Z
sources:
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-eee674a48f00d180319d175e
    resource: repo://celery/app/registry.py
  - id: openwiki-source-ceca684addb7674df2c5c60b
    resource: repo://celery/app/utils.py
  - id: openwiki-source-bdd128d49c4b8a546ae88464
    resource: repo://celery/fixups/django.py
  - id: openwiki-source-461899b2d0d382360e23a4f2
    resource: repo://celery/loaders/base.py
generated: { by: "claude-code", at: "2026-11-16T09:22:47.483Z" }
---

# Celery App, Configuration, Loaders and Task Registry

The `Celery` class in `celery/app/base.py` is the root object of every deployment. Producers, workers, beat and the CLI all hold a reference to one app and reach everything else (AMQP/broker connections, result backend, loader, logging, task registry) through lazily evaluated properties on it. This page explains how an app comes to life; see [[/openwiki/architecture/overview.md]] for the whole system and [[/openwiki/architecture/tasks.md]] for what happens once a task exists.

## Responsibilities

- **Owns configuration** (`app.conf`) and the choice of loader, broker and backend classes.
- **Owns the task registry** (`app.tasks`, a `TaskRegistry` dict in `celery/app/registry.py`), and the pending queue of task decorators that have not been materialized yet.
- **Hosts lifecycle signals** (`on_configure`, `on_after_configure`, `on_after_finalize`, `on_after_fork`) that extensions use to hook in.
- **Installs fixups** — currently only the Django fixup — at construction time.

## Lazy construction and finalization

Creating `Celery(...)` is cheap and does not read config. Two independent lazy stages exist:

1. **Configuration** is evaluated on first access to `app.conf`. `_load_config` (`celery/app/base.py#L1247-L1280`) sends `on_configure`, applies the config source registered by `config_from_object`, flags the app as `configured`, calls `detect_settings`, drains pending lazy default initializers and pending periodic tasks (`add_periodic_task` calls made before configuration), then sends `on_after_configure`. If `app.conf` was referenced earlier, the existing `Settings` object is swapped in place so earlier references stay valid.
2. **Finalization** (`finalize`, `#L657-L675`) runs under a mutex, once. It announces the app to global finalizers registered with `connect_on_app_finalize` (the mechanism behind `shared_task` and built-in tasks), evaluates every pending task proxy, rebinds all registered tasks to the app and sends `on_after_finalize`. With `autofinalize=False`, accessing tasks before an explicit `finalize()` raises `RuntimeError('Contract breach: app not finalized')`.

## Task registration

`@app.task` (`#L515-L588`) returns either a real task or a deferred proxy:

- If the app is already finalized (or `lazy=False`), the task is created immediately via `_task_from_fun`.
- Otherwise a `PromiseProxy` is returned and appended to `app._pending`; the task class is created on first use or at `finalize()`. Callers must not touch attributes of the proxy before the app is set up.
- With the default `shared=True` the decorator also registers a constructor via `connect_on_app_finalize`, so every other app instance gets a copy of that task when it finalizes. This is how `@shared_task` libraries work with whichever app is current.
- When `FORKED_BY_MULTIPROCESSING` is set (`USING_EXECV`), the decorator delegates to `shared_task(lazy=False)` so a re-exec'd child resolves the task against the current app.

`_task_from_fun` (`#L590-L640`) builds a new `Task` subclass dynamically via `type(...)`, with `run` set to the function (as a staticmethod unless `bind=True`), a typed `__header__` used for argument checking, and any decorator options as class attributes. It de-duplicates by name: an existing registry entry with the same name is returned instead of redefining. The task is bound to the app (`task.bind(self)`) and gets autoretry behaviour installed (`celery/app/autoretry.py`). Names default to `gen_task_name(module, function)`. Optional `pydantic=True` wraps the function for model validation.

`TaskRegistry.register` (`celery/app/registry.py`) instantiates class-based tasks, requires `.name`, applies autoretry and stores the instance; looking up an unknown name raises `NotRegistered` via `__missing__`. This is the same lookup the worker uses to resolve incoming task names.

## Configuration sources and normalization

`config_from_object`, `config_from_envvar` and `config_from_cmdline` record or apply a source. `config_from_object` only stores the source when the app is not yet configured; otherwise it drops `_conf` and re-reads through the loader (`#L703-L725`). Loader-side `BaseLoader.config_from_object` (`celery/loaders/base.py#L119-L130`) imports module-name strings relative to the working directory and converts the result into a mapping.

`detect_settings` (`celery/app/utils.py#L232-L286`) reconciles the user's keys with Celery's two naming schemes (modern lowercase `task_serializer` vs. legacy `CELERY_TASK_SERIALIZER`):

- It decides which scheme the user is predominantly using, and raises `ImproperlyConfigured` with rename suggestions when new and old names are mixed (unless both spellings of the same key were provided).
- When a `namespace` prefix is used, the new naming scheme is forced.
- It then builds a `Settings` object layered as preconf (constructor `changes`), the user's config, and deep-copied defaults from `celery/app/defaults.py`.

`celery/app/defaults.py` is the canonical catalogue of settings: nested `Namespace`/`Option` definitions with types, defaults and deprecation metadata, flattened into lookup tables for both naming schemes. `HIDDEN_SETTINGS` in `celery/app/utils.py` is a regex used to mask sensitive values (API, TOKEN, KEY, SECRET, PASS, DATABASE...) when `bugreport`/`celery report` output is generated.

Task-level overrides can be injected without editing task code through `task_annotations` (`celery/app/annotations.py`): a `MapAnnotation` maps task name (or `'*'`) to attributes that are applied to task classes when they are bound.

## Loaders

A loader (`celery/loaders/`) bridges the app to its environment. `app.loader` is instantiated from `loader_cls`, defaulting to `celery.loaders.app:AppLoader`; aliases `app` and `default` are in `celery/loaders/__init__.py`. `BaseLoader` provides:

- lifecycle hooks the worker calls: `on_task_init`, `on_process_cleanup`, `on_worker_init`, `on_worker_shutdown`, `on_worker_process_init`;
- module import helpers (`import_from_cwd`) and `import_default_modules`, which first sends `signals.import_modules` and re-raises any exception returned by receivers (so autodiscovery errors are not silently swallowed before logging is configured), then imports the configured `imports` / `include` modules;
- `autodiscover_tasks`, which imports `<package>.<related_name>` for each package.

## Autodiscovery

`app.autodiscover_tasks(packages, related_name='tasks', force=False)` (`#L782-L840`) is lazy by default: it connects a deferred call to the `import_modules` signal, so imports happen only when the worker (or `import_default_modules`) fires it. `packages` may be a callable for late evaluation. With no packages, discovery is delegated to fixups that expose `autodiscover_tasks()` — for Django, every app config in `INSTALLED_APPS`.

## Django fixup

`BUILTIN_FIXUPS` (`#L82-L84`) contains `celery.fixups.django:fixup`; the constructor imports each fixup callable and keeps instances in `app._fixups` so weak references stay alive (`#L413`). `fixup()` in `celery/fixups/django.py#L52-L63` activates only if `DJANGO_SETTINGS_MODULE` is set and the loader is not already Django-based; it warns if Django is not installed and verifies the Django version.

`DjangoFixup.install` prepends the working directory to `sys.path`, replaces `loader.now` with a Django-aware clock, switches `task_cls` to `celery.contrib.django.task:DjangoTask` unless a custom task class was requested, and connects `import_modules` (to call `django.setup()` and run system checks before task modules import; checks can be skipped with `CELERY_SKIP_CHECKS`) and `worker_init`. `DjangoWorkerFixup.install` then connects `task_prerun`/`task_postrun` and `worker_process_init` handlers and closes database/cache connections around tasks. In prefork children, inherited DB connections are closed without network I/O so the parent's connections are not broken (`#L165-L186`).

## Signals

`celery/signals.py` defines the public extension points as `Signal` instances: task-side (`before_task_publish`, `after_task_publish`, `task_received`, `task_prerun`, `task_postrun`, `task_success`, `task_retry`, `task_failure`, `task_revoked`, `task_rejected`, `task_unknown`, `task_internal_error`), worker-side (`celeryd_init`, `worker_init`, `worker_process_init`, `worker_ready`, `worker_shutdown`, ...), logging (`setup_logging`, `after_setup_logger`), beat (`beat_init`, `beat_embedded_init`) and `import_modules`. Fork safety: `_after_fork` resets the connection pool and AMQP producer pool before sending `on_after_fork`.

## Related pages

- [[/openwiki/architecture/tasks.md]] — what a bound task can do (publishing, retry).
- [[/openwiki/architecture/worker.md]] — how the worker drives loader hooks and the registry.
- [[/openwiki/architecture/cli.md]] — how `-A/--app`, `--config` and `--loader` reach the app.
