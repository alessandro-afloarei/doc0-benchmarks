# Files

- [Command-Line Interface and Deployment](cli.md) - The click-based `celery` umbrella command — global options, app discovery, early eventlet/gevent patching, subcommands (worker, beat, events, inspect/control/status, call, purge, result, shell, migrate, multi, etc.), plugin and user options — plus the deployment assets shipped in extra/, docker/ and helm-chart/.
- [Message Signing and Security](security.md) - Celery's security model for task messages — content-type whitelisting with accept_content, and the optional `auth` message-signing serializer in celery/security (RSA keys, X.509 certificate store, PSS signatures over the serialized body) configured through app.setup_security.
