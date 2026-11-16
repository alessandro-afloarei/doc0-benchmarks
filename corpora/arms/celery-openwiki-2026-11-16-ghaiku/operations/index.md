# Files

- [Command-Line Interface and Process Entrypoints](cli.md) - How the celery umbrella command is assembled from Click groups and subcommands, how it resolves the application and loads user options, which subcommands run worker, beat, events, remote control, and broker tooling, and how the worker, beat, and multi entrypoints start their processes.
- [Configuration and Security](configuration-and-security.md) - How Celery's settings are declared and defaulted in one namespace table, the content-type acceptance policy that limits which serializers workers will decode, and the optional message-signing ("auth") serializer with its key, certificate, and certificate-store settings, including what each guarantees and what it does not.
