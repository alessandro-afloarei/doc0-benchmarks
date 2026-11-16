# Files

- [Celery App, Configuration and Loaders](app-and-configuration.md) - How the Celery application object is constructed, lazily configured and finalized; how current_app, shared tasks, the task registry, loaders, configuration namespaces and fixups fit together.
- [Beat Periodic Scheduler](beat-scheduler.md) - How celery beat schedules periodic tasks — the Service loop, Scheduler heap and tick algorithm, the shelve-backed PersistentScheduler, ScheduleEntry, and the schedule/crontab/solar schedule types.
- [Architecture Overview](overview.md) - System map of Celery — the app object, kombu broker transport, worker, execution pools, result backends, beat, events and remote control — and the end-to-end lifecycle of one task message.
- [Remote Control and Monitoring Events](remote-control-and-events.md) - How clients broadcast control/inspect commands to workers over a kombu pidbox mailbox, how workers execute them (revoke, rate limits, pool, queues, shutdown), and how task/worker monitoring events are dispatched, received and folded into cluster State.
- [Result Backends and AsyncResult](result-backends.md) - How Celery stores and retrieves task state and return values — backend selection by URL, the Backend and key/value base classes, retry policy, chord counting, the Redis and RPC asynchronous consumers, the database backend, and the AsyncResult/ResultSet/GroupResult client API.

# Directories

- [worker](worker/)
