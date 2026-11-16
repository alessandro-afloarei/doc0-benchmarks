# Files

- [Application, configuration, and task registration](application.md) - How a Celery application owns configuration, task registration, loaders, and runtime services, and when lazy setup becomes concrete.
- [Task publication, routing, and transport](messaging.md) - Follow task options through routing, protocol construction, Kombu publication, and broker-specific delayed delivery.
- [Results, persistence, and backend contracts](results.md) - How result handles retrieve task state, how backends store and expire metadata, and why backend choice changes workflow behavior.
- [Worker lifecycle and concurrency](workers.md) - Worker and consumer bootsteps, execution pools, prefetch and ETA scheduling, reconnect behavior, and shutdown ownership.
