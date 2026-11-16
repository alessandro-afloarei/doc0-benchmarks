---
type: operations
title: Deployment and Daemonization
description: The deployment assets shipped in the repository — systemd units, generic init.d scripts, supervisord, macOS launchd and Windows examples, the Docker-based development environment, and the Helm chart — and how they drive celery multi, worker and beat.
tags: [deployment, systemd, init.d, supervisord, docker, helm]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T09:27:53.075Z
sources:
  - id: openwiki-source-5be27729131e30130689f927
    resource: repo://docker/docker-compose.yml
  - id: openwiki-source-4cf7706f1886bb69a83e7283
    resource: repo://extra/generic-init.d/celeryd
  - id: openwiki-source-c981164ccf0816a0f88ff723
    resource: repo://extra/supervisord/celeryd.conf
  - id: openwiki-source-fbf1073a5130c92ea837d91d
    resource: repo://extra/systemd/celery.conf
  - id: openwiki-source-c7437f530b07d7673c7665f6
    resource: repo://extra/systemd/celery.service
  - id: openwiki-source-2da55869d24e043a7e2e1f3f
    resource: repo://extra/systemd/celery.tmpfiles
  - id: openwiki-source-a199175bcacf61b0740de39c
    resource: repo://extra/systemd/celerybeat.service
  - id: openwiki-source-0fd80697fb66492ed821ebe5
    resource: repo://helm-chart/templates/deployment.yaml
  - id: openwiki-source-37e0b93d937b3f82655b267d
    resource: repo://helm-chart/values.yaml
generated: { by: "claude-code", at: "2026-11-15T09:27:53.075Z" }
---

# Deployment and Daemonization

The repository ships example process-manager configurations under `extra/`, a contributor development environment under `docker/`, and a minimal Kubernetes Helm chart under `helm-chart/`. None of these are installed by `pip`; they are templates to copy and adapt. They all build on the CLI described in [Command-Line Interface](../cli/command-line.md).

Two operational rules apply everywhere:

- Run **exactly one beat** per schedule (see [Beat and Periodic Scheduling](../beat/periodic-tasks.md)).
- Give workers time to finish: on `SIGTERM` the worker performs a warm shutdown, waiting for running tasks (see [Signals, Logging and Platform Support](signals-logging-and-platforms.md)). Process managers should not kill them too early.

## systemd (`extra/systemd/`)

| File | Purpose |
| --- | --- |
| `celery.service` | Workers via `celery multi` (`Type=forking`) |
| `celerybeat.service` | Standalone beat (`Type=simple`) |
| `celery.conf` | `EnvironmentFile` (install as `/etc/conf.d/celery`) |
| `celery.tmpfiles` | Creates `/var/run/celery` and `/var/log/celery` owned by `celery` |

`celery.service` runs as user/group `celery` in `/opt/celery` and uses:

- `ExecStart`: `${CELERY_BIN} -A $CELERY_APP multi start $CELERYD_NODES --pidfile=... --logfile=... --loglevel=... $CELERYD_OPTS`
- `ExecStop`: `celery multi stopwait $CELERYD_NODES --pidfile=...` (waits for warm shutdown)
- `ExecReload`: `celery multi restart ...`
- `Restart=always`

Because `celery multi` locates nodes by pidfile, the **same** `CELERYD_PID_FILE` pattern (default `/var/run/celery/%n.pid`) must be used for start, stop and reload. The default log file pattern is `/var/log/celery/%n%I.log` (`%I` expands to the pool process index, giving one file per child).

`celerybeat.service` runs `celery -A ${CELERY_APP} beat --pidfile=${CELERYBEAT_PID_FILE} --logfile=${CELERYBEAT_LOG_FILE}` directly in the foreground.

## Generic init.d scripts (`extra/generic-init.d/`)

- `celeryd` wraps `celery multi` (default nodes `celery`, user `celery`, pidfile `/var/run/celery/%n.pid`, log `/var/log/celery/%n%I.log`, level `INFO`). It reads `/etc/default/celeryd` (or a file named after the script), switches to `CELERYD_USER` via `su`, optionally creates run/log directories (`CELERY_CREATE_DIRS`), supports `CELERYD_CHDIR`, `CELERYD_ULIMIT`, and uses `celery multi expand` to compute pidfile paths for status checks. The script refuses to run for unprivileged users and points them to `celery multi`.
- `celerybeat` starts beat with defaults `/var/run/celery/beat.pid` and `/var/log/celery/beat.log`.

## supervisord (`extra/supervisord/`)

`celeryd.conf` runs `celery -A proj worker --loglevel=INFO` in the foreground with `stopwaitsecs = 600` (time allowed for warm shutdown — should exceed the longest task) and `stopasgroup=true` so pool children receive the signal. `celerybeat.conf` runs `celery -A myapp beat --schedule /var/lib/celery/beat.db`. `supervisord.conf` and `celery.sh` are a sample supervisor setup.

## Other platforms

- `extra/macOS/`: launchd plists for worker and beat.
- `extra/WindowsCMD-AzureWebJob/`: Azure WebJob `run.cmd` examples for worker and beat.
- `extra/bash-completion/`, `extra/zsh-completion/`: shell completion for the `celery` command.

## Docker development environment (`docker/`)

`docker/docker-compose.yml` is a **contributor test environment**, not a production image:

- `celery` service built from `docker/Dockerfile` (Debian bookworm, multiple Python versions via pyenv plus PyPy, many system libraries for optional backends), mounting the repository at `/home/developer/celery`. Environment points the integration tests at `TEST_BROKER=pyamqp://rabbit:5672` and `TEST_BACKEND=redis://redis`.
- Supporting services: `rabbit` (RabbitMQ management image), `redis`, `dynamodb` (DynamoDB Local), `azurite` (Azure Blob emulator).
- `docs` service builds and serves the Sphinx docs on port 7001.
- `docker/entrypoint` cleans `.pyc` files and initialises pyenv before running the command.

See [Testing: Suites and Tooling](../testing/test-suite.md) for running tests inside it.

## Helm chart (`helm-chart/`)

A minimal chart (`Chart.yaml` version `0.1.0`) that deploys workers as a `Deployment`:

- `replicaCount: 4`, image `celery/celery:dev` by default — replace with an image containing your project.
- A `ConfigMap` (default data `CELERY_BROKER_URL: ""`) and an optional `Secret` are injected with `envFrom`, so configuration flows through the `CELERY_*` environment variables that `Settings` and the CLI honour.
- A `ServiceAccount` and a `checksum/config` annotation (pods roll when the ConfigMap changes).
- Liveness/readiness probes run a Python one-liner checking that the pod's `HOSTNAME` appears in `inspect().stats()` replies; the `<APP>` placeholder must be replaced. The sample imports `celery.task.control`, a module that does not exist in this codebase (`celery/task/` is absent), so the probe must be rewritten (e.g. using `celery_app.control.inspect()`) before use.

## Related

- Process-level behaviour (detach, pidfiles, privilege dropping, signals): [Signals, Logging and Platform Support](signals-logging-and-platforms.md).
- `celery multi` options and node naming: [Command-Line Interface](../cli/command-line.md#celery-multi).
