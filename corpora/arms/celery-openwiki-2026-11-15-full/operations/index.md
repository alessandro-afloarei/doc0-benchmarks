# Files

- [Deployment and Daemonization](deployment.md) - The deployment assets shipped in the repository — systemd units, generic init.d scripts, supervisord, macOS launchd and Windows examples, the Docker-based development environment, and the Helm chart — and how they drive celery multi, worker and beat.
- [Signals, Logging and Platform Support](signals-logging-and-platforms.md) - Celery's signal dispatcher and the catalog of task, worker, beat, logging and import signals; how worker logging is configured (setup_logging override, root logger hijacking, task logger format); and platform utilities for pidfiles, daemonization, privilege dropping, root checks and OS signal handling.
