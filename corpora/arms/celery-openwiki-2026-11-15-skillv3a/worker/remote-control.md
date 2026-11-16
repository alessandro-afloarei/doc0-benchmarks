---
type: subsystem
title: Remote Control and Inspection
description: How Celery broadcasts commands to workers over a kombu pidbox mailbox. Covers the client API (app.control, Inspect), the worker-side Panel command registry and handlers (revoke, rate_limit, time_limit, pool grow/shrink/restart, autoscale, add/cancel consumer, shutdown, stats and the dump_* inspections), revoke semantics and persistence with --statedb, and configuration and limits.
tags: [remote-control, inspect, revoke, pidbox, broadcast, statedb]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:49.645Z
sources:
  - id: openwiki-source-41d293d3c7e3c875eed1b7ef
    resource: repo://celery/app/control.py
  - id: openwiki-source-cd5b25b412e425989370ceb9
    resource: repo://celery/worker/components.py
  - id: openwiki-source-448ad2fc321c5e1d8e0a93fc
    resource: repo://celery/worker/consumer/control.py
  - id: openwiki-source-a85d69622d5baa166a82e6c1
    resource: repo://celery/worker/control.py
  - id: openwiki-source-4ee29959ac62b2a32bb988a9
    resource: repo://celery/worker/pidbox.py
  - id: openwiki-source-7a844ae59c546297a34da340
    resource: repo://celery/worker/state.py
generated: { by: "claude-code", at: "2026-11-15T17:08:49.645Z" }
---

# Remote Control and Inspection

Workers listen on a broadcast **mailbox** (kombu `pidbox`) so that clients can send commands to every worker or to selected nodes and optionally collect replies. Inspection commands such as `celery inspect active` and `celery inspect stats` use the same channel.

| Side | Code |
|---|---|
| Client | `celery/app/control.py` (`Control` = `app.control`, `Inspect` = `app.control.inspect()`) |
| CLI | `celery/bin/control.py` (`celery control`, `celery inspect`, `celery status`) |
| Worker transport | `celery/worker/consumer/control.py` (bootstep) → `celery/worker/pidbox.py` (`Pidbox`/`gPidbox`) |
| Worker handlers | `celery/worker/control.py` (`Panel` registry) |
| Worker state | `celery/worker/state.py` |

## Transport

- `Control` creates `Mailbox(control_exchange='celery', type='fanout')`, which publishes to the `celery.pidbox` fanout exchange. It uses `accept_content` and `task_serializer`, and reply queues get TTL and expiry from `control_queue_ttl` (300s) and `control_queue_expires` (10s). `control_queue_exclusive` (default True) and `control_queue_durable` cannot both be True (`ImproperlyConfigured`).
- On each worker, the consumer's `Control` bootstep is included only if `worker_enable_remote_control` is set **and** the transport supports fanout exchanges. It creates a `Pidbox` mailbox node named after the worker hostname, with `handlers = Panel.data`. Green pools use `gPidbox`, which consumes in its own greenlet. The node's `state` exposes `app`, `hostname`, and `consumer` to handlers.
- `Pidbox.on_message` forwards the Lamport clock, dispatches to the handler, logs unknown commands, and resets the mailbox channel after a handler error.
- `broadcast(command, arguments, destination=None, reply=False, timeout=1.0, limit=None, callback=None, pattern=None, matcher=None)` sends to all nodes, or to the nodes in `destination`. With `reply=True` it waits up to `timeout` and collects `[{nodename: reply}, ...]`. Because replies are collected only until the timeout, slow or busy workers (for example a solo pool in the middle of a task) may simply not appear.

## Command registry (`Panel`)

Handlers are plain functions registered with `@control_command(...)` or `@inspect_command(...)` and stored in the global `Panel.data`. Metadata such as `alias`, `signature`, `args` (type converters for the CLI), `variadic`, `default_timeout`, and `visible` drives the CLI's argument parsing and help, and the CLI rejects unknown names. Custom commands can be added by decorating functions in a module the worker imports.

**Inspect commands (read-only):**

- `ping` (default timeout 0.2s), `stats` (pool info, counts, rusage, broker, prefetch, autoscaler), `clock`, `report`, `conf`;
- `active`, `reserved` (reserved minus active), `scheduled` (ETA requests in the timer), `revoked`, `registered` (task names plus selected attributes), `query_task <id...>` (active, reserved, or ready state), `active_queues`;
- `memsample`, `memdump`, `objgraph` for debugging, and the hidden `hello`, used by Mingle to exchange revoked IDs and the clock.

**Control commands (mutating):**

| Command | Effect |
|---|---|
| `revoke <id...> [terminate signal]` | Adds IDs to `worker_state.revoked` and marks each as `REVOKED` in the result backend. With `terminate`, signals the pool process running a matching active request (default `SIGTERM`). |
| `revoke_by_stamped_headers k=v ...` | Records stamp values in `revoked_stamps`. Requests carrying a matching stamp are discarded, and running ones are terminated when `terminate` is set. |
| `terminate <signal> <id>` | Revoke with terminate. |
| `rate_limit <task> <rate>` / `time_limit <task> soft hard` | Changes the task attribute in the worker at run time. `rate_limit` validates the rate string and rebuilds the token buckets; an empty rate disables limiting. |
| `enable_events` / `disable_events` | Toggles the `task` event group. |
| `heartbeat` | Sends an immediate `worker-heartbeat` (used by event receivers' wakeup). |
| `pool_grow n` / `pool_shrink n` | Resizes the pool and adjusts prefetch. Refused when the autoscaler is active. |
| `autoscale max min` | Updates the autoscaler bounds. |
| `pool_restart [modules reload]` | Restarts pool processes, optionally reloading modules. Requires `worker_pool_restarts=True`. |
| `add_consumer <queue> [exchange ...]` / `cancel_consumer <queue>` | Starts or stops consuming from a queue at run time (`Queues.select_add` / `deselect`). |
| `shutdown` | Raises `WorkerShutdown` in the worker, which triggers a warm shutdown. |
| `election id topic action` | Gossip-based leader election. |

The client exposes typed wrappers for these: `app.control.revoke`, `revoke_by_stamped_headers`, `terminate`, `rate_limit`, `time_limit`, `add_consumer`, `cancel_consumer`, `pool_grow`, `pool_shrink`, `autoscale`, `shutdown`, `pool_restart`, `heartbeat`, `ping`, `enable_events` and `disable_events`, and `purge`. `purge` is not a broadcast. It deletes messages from the task queues directly. `Inspect(destination, timeout, callback, limit, pattern, matcher)` wraps the inspection commands and flattens replies.

## Revocation semantics

- Revocation is **advisory and in-memory per worker**. `revoked` is a `LimitedSet` holding at most `CELERY_WORKER_REVOKES_MAX` (50,000) IDs, each expiring after `CELERY_WORKER_REVOKE_EXPIRES` (10,800s) once the limit is exceeded.
- A revoked task that hasn't started is discarded when its message arrives or when it leaves the ETA timer or rate-limit bucket (`Request.revoked()` → state `REVOKED`, `task_revoked` signal, `task-revoked` event). A running task keeps running unless `terminate=True`, which signals the **whole pool child process**. Use termination as a last resort: with prefork the signal may hit the next task if the process has already moved on.
- Workers that start later learn existing revocations through **Mingle** (`hello`), and through `--statedb`.
- `AsyncResult.revoke()` and `GroupResult.revoke()` call `app.control.revoke(...)`.

### Persistence (`--statedb`)

The worker `StateDB` bootstep creates `state.Persistent(state, filename, clock)`, a `shelve` file that stores the **revoked set**, zlib-compressed and pickled (`__proto__` 3), plus the logical clock. It is merged at start-up (older formats are migrated) and saved at exit through `atexit`, so revocations survive restarts. Paths support `%n`/`%h` node formatting (see [CLI](../operations/cli.md)).

## Worker state (`celery/worker/state.py`)

This module holds process-global bookkeeping that control commands and `stats` read:

- `requests` (ID → Request), `reserved_requests` and `active_requests` (`WeakSet`s);
- `successful_requests` (a `LimitedSet` of 1,000 IDs, used by dedup and cancellation logic);
- `total_count` per task name, `all_total_count`;
- `revoked` and `revoked_stamps`;
- the `should_stop` / `should_terminate` flags used by `maybe_shutdown()`.

`task_reserved`, `task_accepted`, and `task_ready` maintain these structures.

## Tests

`t/unit/worker/test_control.py` (all handlers), `t/unit/app/test_control.py` (client), `t/unit/worker/test_state.py` (persistence and LimitedSet), `t/unit/worker/test_revoke.py`, `t/integration/test_inspect.py`, and `t/smoke/tests/test_control.py`.

## See also

- [Worker Architecture and Bootsteps](worker-architecture.md)
- [Command-Line Interface](../operations/cli.md)
- [Events and Monitoring](../operations/events-monitoring.md)
