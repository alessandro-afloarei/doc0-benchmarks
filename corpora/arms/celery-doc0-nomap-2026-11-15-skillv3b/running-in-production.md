---
title: "Running Workers in Production"
---
## Overview

In production a host usually runs several workers, each with its own node name, queues, concurrency, pidfile and log file, and each must be started, stopped and restarted without losing tasks. Celery ships `celery multi` for doing this on a plain host, the daemonization support behind `--detach`, and a Helm chart for Kubernetes. This page covers those three. What a single worker does at start-up and on each shutdown signal is on [[Worker Startup and Shutdown]]; process supervisors such as systemd and supervisord can also start `celery worker` directly in the foreground.

Sources: [celery/bin/multi.py:1-99](repo://celery/bin/multi.py#L1-L99), [celery/bin/worker.py:108-133](repo://celery/bin/worker.py#L108-L133), [helm-chart/README.rst:1-40](repo://helm-chart/README.rst#L1-L40)

## Node names

A worker is identified by its node name `name@host`, used for remote control destinations, events, pidfile names and log file names. Without `-n`, it is `celery@<hostname>`. Node names and paths accept placeholders, expanded by `host_format` and `node_format`.

Sources: [celery/utils/nodenames.py:58-114](repo://celery/utils/nodenames.py#L58-L114)

| Placeholder | Expands to |
| --- | --- |
| `%h` | Full host name, or the full node name in `celery multi` |
| `%n` | Name part (before `@`) |
| `%d` | Domain part of the host name |
| `%i` | Pool process index, `0` in the main process |
| `%I` | Pool process index with a leading dash, empty in the main process |

Sources: [celery/utils/nodenames.py:96-114](repo://celery/utils/nodenames.py#L96-L114), [celery/apps/multi.py:42-51](repo://celery/apps/multi.py#L42-L51)

Two workers with the same node name on the same broker confuse control replies and events; `inspect` and `control` warn about duplicate replies ([[Remote Control and Inspection]]). With `%I` in `--logfile`, each prefork child writes its own file, which avoids interleaved writes from many processes.

Sources: [celery/app/control.py:38-63](repo://celery/app/control.py#L38-L63), [celery/concurrency/prefork.py:62-71](repo://celery/concurrency/prefork.py#L62-L71)

## celery multi

### Describing a cluster

`celery multi start` takes either a number of nodes or a list of names, then worker options. A number `N` creates nodes `celery1` to `celeryN` (`--range-prefix` changes the prefix); names may be full node names with `@`. Options apply to every node unless qualified with a node selector after a colon: an index (`-c:1`), a range (`-c:1-3`), a list (`-Q:4,5`) or a name (`-c:image`).

Sources: [celery/apps/multi.py:285-365](repo://celery/apps/multi.py#L285-L365), [celery/apps/multi.py:70-120](repo://celery/apps/multi.py#L70-L120)

```bash
# 10 workers: three on images and video, two on data with DEBUG logging, the rest on default
celery multi start 10 -A proj -l INFO -Q:1-3 images,video -Q:4,5 data -Q default -L:4,5 DEBUG

# show the commands without running them
celery multi show 10 -A proj -l INFO -Q:1-3 images,video -Q:4,5 data -Q default
```

Sources: [celery/bin/multi.py:63-73](repo://celery/bin/multi.py#L63-L73)

### Building each command

Each `Node` turns into a `celery worker --detach` command line. It always sets `-n` to the node name, and defaults `--pidfile` to `/var/run/celery/%n.pid` and `--logfile` to `/var/log/celery/%n%I.log`, creating those directories if needed. Global options that must come before the subcommand (`-A`, `-b`, `--result-backend`, `--loader`, `--config`, `--workdir`, `-C`, `-q`) are moved there, and placeholders are expanded per node.

Sources: [celery/apps/multi.py:122-190](repo://celery/apps/multi.py#L122-L190)

### Commands

| Command | Effect |
| --- | --- |
| `start` | Run each node's command; the worker detaches and the command returns |
| `stop` | Send `SIGTERM` to each node found by pidfile, without waiting |
| `stopwait` | Send `SIGTERM` and wait until every node's process is gone |
| `restart` | Stop each node, waiting, and start it again as soon as it is down |
| `kill` | Send `SIGKILL` to every node |
| `show`, `get NAME`, `names`, `expand TEMPLATE` | Print commands, one node's command, node names, or an expanded template |

Sources: [celery/bin/multi.py:291-345](repo://celery/bin/multi.py#L291-L345), [celery/apps/multi.py:406-497](repo://celery/apps/multi.py#L406-L497)

Stopping finds each node's pid from its pidfile, sends the signal (a `-KILL` or other signal argument overrides `SIGTERM`), and with retries polls with signal 0 until the process is gone. Because pidfile locations are derived from the arguments, `stop` and `restart` need the same `--pidfile` options as `start`; `celery multi` stores nothing itself.

Sources: [celery/apps/multi.py:192-206](repo://celery/apps/multi.py#L192-L206), [celery/apps/multi.py:443-483](repo://celery/apps/multi.py#L443-L483), [celery/bin/multi.py:344-358](repo://celery/bin/multi.py#L344-L358)

```bash
celery multi start w1 w2 -A proj -l INFO --pidfile=/run/celery/%n.pid --logfile=/var/log/celery/%n%I.log
celery multi restart w1 w2 -A proj -l INFO --pidfile=/run/celery/%n.pid --logfile=/var/log/celery/%n%I.log
celery multi stopwait w1 w2 --pidfile=/run/celery/%n.pid
```

Sources: [celery/bin/multi.py:13-25](repo://celery/bin/multi.py#L13-L25)

`SIGTERM` is a warm shutdown, so `stopwait` returns only once running tasks have finished, which can take as long as the longest task. Use it in deployment scripts that must not start new code while old tasks are still running.

Sources: [celery/apps/worker.py:432-442](repo://celery/apps/worker.py#L432-L442), [celery/apps/multi.py:446-447](repo://celery/apps/multi.py#L446-L447)

## Daemonizing without multi

`celery worker --detach` and `celery beat --detach` daemonize a single process through `platforms.detached`: drop privileges to `--uid`/`--gid`, fork twice, change to `--workdir`, set `--umask`, check the log file is writable and the pidfile not held, and redirect standard streams to `/dev/null`. The daemon options also fall back to settings named after the command, such as `worker_pidfile` and `worker_logfile`.

Sources: [celery/platforms.py:376-431](repo://celery/platforms.py#L376-L431), [celery/bin/base.py:197-228](repo://celery/bin/base.py#L197-L228)

Two platform checks matter for services. The worker refuses to run as root when `accept_content` includes `pickle`, unless `C_FORCE_ROOT` is set; and on Linux each pool child is killed automatically if the main process dies, so a crashed parent does not leave orphaned children consuming nothing.

Sources: [celery/platforms.py:788-845](repo://celery/platforms.py#L788-L845), [celery/concurrency/prefork.py:41-52](repo://celery/concurrency/prefork.py#L41-L52)

## Kubernetes with the Helm chart

### What the chart deploys

The `helm-chart/` directory holds a minimal chart: a `Deployment` with `replicaCount` worker pods (4 by default), a `ConfigMap` whose entries become environment variables, an optional `Secret` for credentials, and a `ServiceAccount`. Configuration reaches Celery through environment variables, starting with `CELERY_BROKER_URL`, which the app reads before any configuration file ([[Configuration and Loaders]]). The pod template carries a checksum of the ConfigMap, so changing configuration rolls the pods.

Sources: [helm-chart/values.yaml:1-93](repo://helm-chart/values.yaml#L1-L93), [helm-chart/templates/deployment.yaml:1-70](repo://helm-chart/templates/deployment.yaml#L1-L70), [helm-chart/templates/configmap.yaml:1-8](repo://helm-chart/templates/configmap.yaml#L1-L8), [helm-chart/templates/secret.yaml:1-12](repo://helm-chart/templates/secret.yaml#L1-L12)

```bash
helm install celery helm-chart/ --values helm-chart/values_prod.yaml
```

Sources: [helm-chart/README.rst:25-40](repo://helm-chart/README.rst#L25-L40)

### Adapting it

The chart is a starting point rather than a ready deployment, and several values must be replaced.

Sources: [helm-chart/values.yaml:1-13](repo://helm-chart/values.yaml#L1-L13)

- `image` defaults to `celery/celery:dev`, the development image built from `docker/Dockerfile`, which contains Celery's source and test tooling but not your application. Build an image with your code and set its repository and tag.
- The Deployment sets no `command`, so the container runs the image's default. Add a command such as `celery -A proj worker -l INFO` in your values or template.
- The liveness and readiness probes call `inspect().stats()` through `celery.task.control` with an `<APP>` placeholder. That module no longer exists in Celery 5; replace the probe with `celery -A proj inspect ping -d celery@$HOSTNAME` or `from proj import app; app.control.inspect().stats()`.

Sources: [helm-chart/values.yaml:3-7](repo://helm-chart/values.yaml#L3-L7), [helm-chart/values.yaml:52-67](repo://helm-chart/values.yaml#L52-L67), [helm-chart/templates/deployment.yaml:31-49](repo://helm-chart/templates/deployment.yaml#L31-L49), [docker/Dockerfile:1-10](repo://docker/Dockerfile#L1-L10)

Pods are stopped with `SIGTERM`, which starts a warm shutdown. Set the pod's `terminationGracePeriodSeconds` longer than your longest task, or configure a soft shutdown with `worker_soft_shutdown_timeout` and late acknowledgement so unfinished tasks return to the queue when the pod is killed ([[Worker Startup and Shutdown]]). Since each pod is one worker, set `-c` to match the pod's CPU request instead of letting it default to the node's CPU count.

Sources: [celery/worker/worker.py:105-110](repo://celery/worker/worker.py#L105-L110), [celery/worker/worker.py:412-435](repo://celery/worker/worker.py#L412-L435)

## The development Docker setup

`docker/docker-compose.yml` runs Celery's own test environment: a `celery` service built from `docker/Dockerfile` (Debian with pyenv and every supported Python version), with RabbitMQ, Redis, DynamoDB Local and Azurite as dependencies, and a `docs` service that builds the Sphinx documentation on port 7001. It is meant for working on Celery itself, not for running applications.

Sources: [docker/docker-compose.yml:1-48](repo://docker/docker-compose.yml#L1-L48), [docker/entrypoint:1-7](repo://docker/entrypoint#L1-L7)
