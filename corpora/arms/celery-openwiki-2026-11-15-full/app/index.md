# Files

- [Application Object and Configuration](application-and-configuration.md) - How the Celery application object (celery.app.base.Celery) lazily loads configuration, finalizes its task registry, tracks the current/default app, delegates to loaders, and is pickled across processes.
- [Tasks, Task Registry and Retries](tasks-and-registry.md) - How functions become Task classes via @app.task and @shared_task, how tasks bind to an app and pick up configuration and annotations, the task registry, built-in tasks, and the retry/autoretry/replace semantics of celery.app.task.Task.
