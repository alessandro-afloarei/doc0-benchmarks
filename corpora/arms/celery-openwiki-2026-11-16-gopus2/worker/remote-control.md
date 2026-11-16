---
type: subsystem
title: Remote Control and Inspection
description: Celery's broadcast remote-control system — the client-side app.control (Control, Inspect, broadcast, reply flattening), the kombu pidbox mailbox, the worker-side Pidbox consumer step and Panel command registry, the built-in inspect and control commands (revoke, rate_limit, time_limit, pool resize, autoscale, queues, shutdown, events), and how the CLI exposes them.
tags: [remote-control, inspect, pidbox, broadcast, revoke, mailbox, cli]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:05:29.073Z
sources:
  - id: openwiki-source-41d293d3c7e3c875eed1b7ef
    resource: repo://celery/app/control.py
  - id: openwiki-source-bbacf43535335f110ab87e0d
    resource: repo://celery/bin/control.py
  - id: openwiki-source-a85d69622d5baa166a82e6c1
    resource: repo://celery/worker/control.py
  - id: openwiki-source-4ee29959ac62b2a32bb988a9
    resource: repo://celery/worker/pidbox.py
  - id: openwiki-source-7a844ae59c546297a34da340
    resource: repo://celery/worker/state.py
generated: { by: "claude-code", at: "2026-11-16T17:05:29.073Z" }
---

# Remote Control and Inspection

Remote control lets clients send commands to running workers over the broker and optionally collect replies. It is built on kombu's `pidbox` `Mailbox`: a **fanout** exchange that every worker binds a per-node queue to, plus a reply exchange for responses.

## Client side: `app.control` (`celery/app/control.py`)

`Control` owns the `Mailbox`, configured from settings:

- exchange name `control_exchange` (default `celery`; kombu derives the pidbox exchange names from it), type `fanout`;
- `accept_content` and `task_serializer` for (de)serialisation;
- `control_queue_ttl`, `control_queue_expires`, `control_queue_exclusive`, `control_queue_durable` (exclusive and durable together raise `ImproperlyConfigured`);
- the app's producer pool (dropped after fork).

`broadcast(command, arguments, destination=None, reply=False, timeout=1.0, limit=None, callback=None, pattern=None, matcher=None)` publishes a command to all workers, a list of node names, or nodes matching a pattern, and — if `reply=True` — gathers replies for `timeout` seconds (or until `limit` replies).

Convenience methods wrap `broadcast`: `revoke`, `revoke_by_stamped_headers`, `terminate`, `ping`, `rate_limit`, `time_limit`, `add_consumer`, `cancel_consumer`, `enable_events`, `disable_events`, `pool_grow`, `pool_shrink`, `pool_restart`, `autoscale`, `heartbeat`, `shutdown`, `election`. `purge()` is not a broadcast: it discards all messages from the configured task queues.

`app.control.inspect(destination=None, timeout=1.0, callback=None, limit=None, pattern=None, matcher=None)` returns an `Inspect` object whose methods send inspect commands with `reply=True` and return a dict `{node_name: reply}`: `ping`, `stats`, `active`, `scheduled`, `reserved`, `revoked`, `registered`, `active_queues`, `query_task`, `conf`, `clock`, `report`, `memsample`, `memdump`, `objgraph`, `hello`. `flatten_reply` merges per-node replies and emits `DuplicateNodenameWarning` when two workers answer with the same node name (workers must have unique `-n` names).

## Worker side

### Pidbox consumer

The consumer's `Control` bootstep (see [Worker Consumer](consumer.md)) creates `celery.worker.pidbox.Pidbox` (or `gPidbox`, which runs its own loop in a green thread, for eventlet/gevent pools). It creates a mailbox `Node` named after the worker hostname with handlers `Panel.data` and a state object containing `app`, `hostname` and the `consumer`. Each received message forwards the logical clock and dispatches through `node.handle_message`, which runs the handler and publishes the reply. The step is only included when `worker_enable_remote_control` is true and the transport supports fanout exchanges; on connection loss the pidbox consumer is reset with the rest of the consumer.

### Command registry: `Panel`

`celery/worker/control.py` registers commands in the global `Panel` registry with decorators:

```python
@control_command(args=[('task_name', str), ('rate_limit', str)],
                 signature='<task_name> <rate_limit>')
def rate_limit(state, task_name, rate_limit, **kwargs): ...

@inspect_command(alias='dump_active')
def active(state, safe=False, **kwargs): ...
```

`Panel.meta` stores the type (`control` or `inspect`), alias, visibility, default timeout, help text, argument types/signature and variadic argument name — used by the CLI to parse arguments and render help. Handlers return `ok(value)` → `{'ok': ...}` or `nok(value)` → `{'error': ...}`. Custom commands can be added the same way (they are global to the process, so import the module in the worker).

### Built-in commands

| Command | Type | Behaviour |
|---------|------|-----------|
| `revoke(task_id, terminate=False, signal=TERM)` | control | Adds ids to the worker's `revoked` set (`LimitedSet`, max 50 000 entries, 3 h expiry, configurable via `CELERY_WORKER_REVOKES_MAX`/`_REVOKE_EXPIRES`), marks them `REVOKED` in the result backend, and with `terminate=True` signals the processes running matching active requests |
| `revoke_by_stamped_headers(headers, terminate)` | control | Records revoked stamp values and optionally terminates active requests whose stamps match |
| `terminate(signal, task_id)` | control | Revoke with terminate |
| `rate_limit(task_name, rate_limit)` | control | Validate the rate string, set it on the task and rebuild consumer token buckets |
| `time_limit(task_name, soft, hard)` | control | Change a task's time limits for future executions |
| `enable_events` / `disable_events` / `heartbeat` | control | Toggle the `task` event group; send an immediate heartbeat ([Events](../events/monitoring.md)) |
| `pool_grow(n)` / `pool_shrink(n)` | control | Resize the pool and update prefetch; refused (error reply) when autoscaling is enabled |
| `autoscale(max, min)` | control | Update autoscaler bounds (error if autoscaling is off) |
| `pool_restart(modules, reload)` | control | Restart pool processes (requires `worker_pool_restarts`) |
| `add_consumer(queue, ...)` / `cancel_consumer(queue)` | control | Start/stop consuming from a queue at runtime |
| `shutdown` | control | Raise `WorkerShutdown` for a warm shutdown |
| `election(id, topic, action)` | control | Participate in a gossip election |
| `ping` | inspect | Reply `pong` (default timeout 0.2 s) |
| `stats` | inspect | Pool info, prefetch, broker info, rusage, totals, uptime |
| `active`, `reserved`, `scheduled` | inspect | Executing, prefetched, and ETA-waiting requests |
| `revoked`, `registered`, `active_queues`, `query_task`, `conf`, `clock`, `report` | inspect | State and configuration introspection |
| `hello(from_node, revoked)` | inspect (hidden) | Used by Mingle to exchange revoked ids and clocks |
| `memsample`, `memdump`, `objgraph` | inspect | Memory debugging |

Revocation is cooperative: the revoked set is checked when a message is received and again before execution (see [Request Lifecycle](request-lifecycle.md)). Because the set lives in each worker's memory, workers started later learn about revocations via Mingle, and the set can persist across restarts with `--statedb`.

## CLI

`celery inspect <command>`, `celery control <command>` and `celery status` (`celery/bin/control.py`) validate the command name against `Panel.meta` (type must match), convert positional arguments using the declared argument types/variadic name, call `inspect._request(...)` or `control.broadcast(..., reply=True)`, and print replies (or JSON with `--json`). Options: `-t/--timeout`, `-d/--destination` (comma-separated node names). If no node replies in time, `celery status` exits with `EX_UNAVAILABLE` ("No nodes replied within time constraint").

## Security and operations notes

- Anyone with broker access can send control commands; disable with `worker_enable_remote_control=False` or restrict broker permissions.
- Control messages use the task serializer and `accept_content`; with message signing enabled they are signed as well (see [Security](../operations/security.md)).
- Duplicate worker node names break reply routing — use unique `-n` values (`%h` expansion helps).

## Tests

- `t/unit/worker/test_control.py` — every built-in command, `Panel` registration, pidbox handling.
- `t/unit/app/test_control.py` — client `Control`/`Inspect` APIs and `flatten_reply`.
- `t/unit/bin/test_control.py`, `t/integration/test_inspect.py`, `t/smoke/tests/test_control.py`.

## Related

- [Worker Consumer](consumer.md)
- [Events and Monitoring](../events/monitoring.md)
- [Command-Line Interface and Deployment](../operations/cli.md)
