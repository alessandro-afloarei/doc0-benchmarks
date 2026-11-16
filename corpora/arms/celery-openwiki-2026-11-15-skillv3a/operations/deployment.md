---
type: operations
title: Deployment, Daemonization and Packaging
description: How Celery processes are run in production. Covers the platform layer (double-fork daemonization, pidfile locks, privilege dropping, root/pickle safety check), the init and supervision templates in extra/ (systemd, init.d, supervisord, launchd), the docker development environment, the sample Helm chart, and release tooling.
tags: [deployment, daemonization, pidfile, systemd, docker, helm, release]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:49.645Z
sources:
  - id: openwiki-source-3cfd5f9bf00aaf6b49d01291
    resource: repo://celery/apps/worker.py
  - id: openwiki-source-0f8d26932b6272605a1f8531
    resource: repo://celery/platforms.py
  - id: openwiki-source-5be27729131e30130689f927
    resource: repo://docker/docker-compose.yml
  - id: openwiki-source-c7437f530b07d7673c7665f6
    resource: repo://extra/systemd/celery.service
  - id: openwiki-source-37e0b93d937b3f82655b267d
    resource: repo://helm-chart/values.yaml
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
generated: { by: "claude-code", at: "2026-11-15T17:08:49.645Z" }
---

# Deployment, Daemonization and Packaging

Celery ships no service manager of its own. Workers and beat are ordinary long-running processes. The repository provides:

- `celery/platforms.py`, an OS abstraction used by `worker --detach`, `beat --detach`, `events --detach`, and `celery multi`;
- templates under `extra/` for common supervisors;
- a docker-compose **development** environment (`docker/`) and a sample Helm chart (`helm-chart/`).

## Platform layer (`celery/platforms.py`)

### Daemonizing

`detached(logfile, pidfile, uid, gid, umask, workdir, fake)` returns a `DaemonContext`. When it is entered, the context:

1. drops privileges first (`maybe_drop_privileges`) and resets the `SIGCLD` handler;
2. double-forks with `setsid()` in between (`_detach`), so the daemon has no controlling terminal;
3. changes to `workdir` (the current directory by default) and applies `umask`. A string umask is parsed as octal if it starts with `0`, otherwise as decimal;
4. runs a check: it opens the logfile for append, so permission errors show up before stderr disappears, and checks that the pidfile is not held by a live process;
5. closes all inherited file descriptors except stdio and `/dev/urandom` (kept because beat's `shelve` needs it), redirects stdio to `/dev/null`, and runs multiprocessing after-fork hooks.

The pidfile itself is created later by the program (`create_pidlock`), not by `detached`.

### Pidfile locking

`create_pidlock(path)` → `Pidfile`:

- If the file exists, `remove_if_stale()` removes it when its content is broken or empty, when it contains **our own PID** (common for PID 1 in containers), or when `kill(pid, 0)` fails with `ESRCH` or `EPERM`. Otherwise the process exits with `EX_CANTCREAT` and a "pidfile already locked" message.
- `write_pid()` opens the file with exclusive-create flags, writes `pid\n`, fsyncs, and re-reads it to detect races (`LockFailed`).
- An `atexit` handler removes the lock on exit.

### Privileges and the root check

- `maybe_drop_privileges(uid, gid)` does nothing on Windows or when the process is not root. It refuses to continue (`SecurityError`) on a suspicious setup where the effective UID is non-root but the real UID is root. After switching to the user's groups, gid, and uid, it verifies that root cannot be regained.
- `check_privileges(accept_content)` runs at worker start (`apps/worker.py`). If the worker runs as root, or in the `sudo` or `wheel` group, **and** `accept_content` allows `pickle`, it raises `SecurityError` unless `C_FORCE_ROOT` is set. Otherwise it only warns. Running a pickle-accepting worker as root would let anyone who can publish to the broker execute code as root.

### Other helpers

`Signals` is a dict-like wrapper for installing signal handlers by name. `set_process_title` / `set_mp_process_title` use `setproctitle` when it is installed. `set_pdeathsig` asks the OS (via billiard) to send `SIGKILL` to the process when its parent dies, where supported. `close_open_fds` and `ignore_errno` are also defined here.

## Supervisor templates (`extra/`)

| Directory | Contents |
|---|---|
| `extra/systemd/` | `celery.service` (`Type=forking`, runs `celery multi start/stopwait/restart` with `$CELERYD_NODES`, `$CELERYD_PID_FILE`, `$CELERYD_LOG_FILE`, `$CELERYD_OPTS` from `EnvironmentFile=/etc/conf.d/celery`, as user `celery`), `celerybeat.service`, an example `celery.conf`, and `celery.tmpfiles`, which creates `/var/run/celery` and `/var/log/celery` owned by `celery`. |
| `extra/generic-init.d/` | SysV `celeryd` and `celerybeat` scripts configured through `/etc/default/celeryd`. Copy and rename them for multiple applications. |
| `extra/supervisord/` | `celeryd.conf`, `celerybeat.conf`, and a sample `supervisord.conf`. These run workers in the foreground, so no multi or pidfiles are needed. |
| `extra/macOS/` | launchd plists for the worker and beat. |
| `extra/WindowsCMD-AzureWebJob/` | Batch wrappers for Azure WebJobs. |
| `extra/bash-completion/`, `extra/zsh-completion/` | Shell completion. |
| `extra/release/` | `attribution.py`, `gen-cert.sh` (test certificates), and the sphinx2rst configuration. |

The systemd unit's default paths (`/var/run/celery/%n.pid`, `/var/log/celery/%n%I.log`) match the defaults that `celery multi` gives each node (see [CLI](cli.md)). Under systemd, `celery multi` daemonizes each node itself, which is why the unit is `Type=forking`.

**Containers and foreground supervisors** (supervisord, Kubernetes, docker) should run `celery -A proj worker` in the foreground without `--detach` or `multi`, and let the supervisor handle restarts. Send `SIGTERM` for a warm shutdown (see [Worker Architecture](../worker/worker-architecture.md)). The PID 1 case in `remove_if_stale` exists for exactly this setup.

## Docker development environment (`docker/`)

`docker/docker-compose.yml` builds `celery/celery:dev` from `docker/Dockerfile` (Debian bookworm with pyenv-installed Pythons and pypy3) and mounts the repository at `/home/developer/celery`. Supporting services are `rabbit` (RabbitMQ management), `redis`, `dynamodb` (local), `azurite` (Azure blob emulator), and a `docs` builder that serves on port 7001. The environment sets `TEST_BROKER=pyamqp://rabbit:5672` and `TEST_BACKEND=redis://redis` for integration tests.

Makefile targets that wrap it:

- `make docker-build`
- `make docker-lint`
- `make docker-unit-tests` (runs `tox -e 3.12-unit`)
- `make docker-integration-tests` (`3.12-integration-docker`; failures are tolerated)
- `make docker-bash`
- `make docker-docs`

See [Testing](../testing/test-suite.md).

## Helm chart (`helm-chart/`)

This is a minimal chart (`apiVersion: v2`, chart version 0.1.0). It renders a `Deployment` (default `replicaCount: 4`, image `celery/celery:dev`), a `ConfigMap` whose data, such as `CELERY_BROKER_URL`, is injected with `envFrom`, an optional `Secret`, and a `ServiceAccount`. A config checksum annotation restarts pods when the ConfigMap changes.

The default liveness and readiness probes run Python that imports `celery.task.control.inspect` with a `<APP>` placeholder. The `celery.task` package no longer exists in Celery 5, so these probes must be replaced, for example with `celery -A proj inspect ping -d celery@$HOSTNAME`, before the chart is usable. Treat the chart as a template, not a production artifact.

## Release and packaging

- `setup.py` defines the `celery` console script, and `requirements/` holds the pinned dependency sets and extras.
- `Makefile` covers versioning and release: `bump`, `bump-minor`, and `bump-major` (bumpversion), `release` (sdist and wheel upload, signed), `dist` (readme, contrib, and build), `lint` (flake8 plus `apicheck` and `configcheck` Sphinx checks), and `readme`.
- CI lives in `.github/workflows/`: `python-package.yml` (unit), `integration-tests.yml`, `smoke-tests.yml`, `linter.yml`, `docker.yml`, `codeql-analysis.yml`, and `semgrep.yml`.

## See also

- [Command-Line Interface](cli.md)
- [Testing: Unit, Integration and Smoke Suites](../testing/test-suite.md)
- [Message Signing](../security/message-signing.md)
