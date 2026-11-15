# Files

- [The Celery Application Object](application.md) - How the Celery app class (celery/app/base.py) holds configuration, lazily loads settings through loaders, registers tasks through decorators and a finalization step, and exposes thread-local "current app" state.
- [Architecture Overview](overview.md) - System-level map of Celery's runtime pieces (app/producer, broker via kombu, worker, result backend, beat, events, remote control) and how one task travels from apply_async to a stored result.
