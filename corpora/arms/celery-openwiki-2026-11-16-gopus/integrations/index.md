# Files

- [Django Integration](django.md) - How Celery integrates with Django without a separate package — the built-in Django fixup activated by DJANGO_SETTINGS_MODULE, settings loading with the CELERY namespace, task autodiscovery from INSTALLED_APPS, database/cache connection hygiene around tasks and forks, and the DjangoTask on-commit helpers.
- [Serialization and Message Signing](security-and-serialization.md) - How Celery encodes task messages, results and events (serializer and accept_content settings), how exceptions are serialized and safely rebuilt from result backends, and how the 'auth' serializer signs and verifies messages with X.509 certificates and RSA keys.
