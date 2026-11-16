# Files

- [CLI operations, events and remote control](monitoring.md) - Loading a Celery app from the CLI, inspecting workers, sending control commands, consuming events and understanding revocation persistence.
- [Periodic tasks and beat persistence](periodic-tasks.md) - How beat evaluates schedules, publishes due entries, persists last-run metadata, recovers schedule storage and loads custom schedulers.
- [Serialization and message trust](security.md) - Task and result content allowlists, auth serializer signing and certificate checks, broker TLS configuration and the limits of argument redaction.
