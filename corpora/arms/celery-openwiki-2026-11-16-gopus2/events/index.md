# Files

- [Events and Monitoring](monitoring.md) - Celery's monitoring event stream — how workers and clients publish task/worker events through EventDispatcher to the celeryev exchange, how EventReceiver consumes them with Lamport clock adjustment, how events.State rebuilds cluster state, and the bundled consumers (snapshot cameras, curses monitor, dumper).
