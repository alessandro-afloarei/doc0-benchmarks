# Files

- [Django Integration and Fixups](django.md) - How Celery integrates with Django without a separate package. The built-in DjangoFixup activates on DJANGO_SETTINGS_MODULE, runs django.setup() and system checks before task modules are imported, swaps in DjangoTask, uses Django's timezone, and manages database and cache connections around tasks and forked pool processes.
