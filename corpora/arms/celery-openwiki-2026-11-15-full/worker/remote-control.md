---
type: subsystem
title: Remote Control and Inspection
description: Celery's broadcast remote-control system — the client API (app.control, Inspect, broadcast), the kombu pidbox mailbox, the worker Control bootstep and Pidbox/gPidbox consumers, the Panel command registry with control and inspect commands (revoke, rate_limit, time_limit, pool_grow, autoscale, add_consumer, shutdown, stats, active, ...), and the celery inspect/control/status CLI.
tags: [remote-control, inspect, pidbox, revoke, management]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T09:27:53.075Z
sources:
  - id: openwiki-source-41d293d3c7e3c875eed1b7ef
    resource: repo://celery/app/control.py
  - id: openwiki-source-bbacf43535335f110ab87e0d
    resource: repo://celery/bin/control.py
  - id: openwiki-source-448ad2fc321c5e1d8e0a93fc
    resource: repo://celery/worker/consumer/control.py
  - id: openwiki-source-a85d69622d5baa166a82e6c1
    resource: repo://celery/worker/control.py
  - id: openwiki-source-4ee29959ac62b2a32bb988a9
    resource: repo://celery/worker/pidbox.py
  - id: openwiki-source-328c66e40eb163230ad26cbc
    resource: repo://celery/worker/request.py
generated: { by: "claude-code", at: "2026-11-15T09:27:53.075Z" }
---

# Remote Control and Inspection

Remote control lets clients send commands to running workers and collect replies — revoke tasks, change rate limits, add queues, query active tasks, and so on. It is built on kombu's **pidbox** (`kombu.pidbox.Mailbox`): a **fanout** exchange that every worker listens on, plus a reply exchange that clients consume from.

```text
app.control.broadcast('rate_limit', {...}, destination=[...], reply=True)
   └─ Mailbox(control_exchange).  _broadcast  ──fanout──►  every worker's Pidbox node
                                                            └─ Panel.data[command](state, **args)
   ◄────────── replies on reply exchange (collected for `timeout` s, up to `limit`) ──────
```

## Client API (`celery/app/control.py`)

`app.control` is a `Control` instance:

- The mailbox is created from `control_exchange` (default `celery`) with type `fanout`, `accept_content`, `task_serializer`, the app's producer pool, and queue TTL/expiry/exclusive/durable options from `control_queue_ttl`, `control_queue_expires`, `control_queue_exclusive`, `control_queue_durable` (exclusive + durable together raises `ImproperlyConfigured`). The producer pool reference is dropped after fork.
- `broadcast(command, arguments=None, destination=None, reply=False, timeout=1.0, limit=None, callback=None, pattern=None, matcher=None)` — sends a command to all workers or a list of node names (or those matching `pattern`), optionally waiting `timeout` seconds for replies.
- Convenience methods wrap `broadcast`: `revoke(task_id, terminate=False, signal='TERM')`, `revoke_by_stamped_headers(headers, ...)`, `terminate`, `ping`, `rate_limit`, `time_limit`, `add_consumer`, `cancel_consumer`, `enable_events`, `disable_events`, `pool_grow`, `pool_shrink`, `autoscale`, `pool_restart`, `shutdown`, `heartbeat`, `election`.
- `purge()` deletes all messages from the task queues (not a broadcast — it uses a `TaskConsumer.purge()` on the broker).
- `app.control.inspect(destination=None, timeout=1.0, ...)` returns an `Inspect` with query methods that always request replies: `ping`, `stats`, `active`, `scheduled`, `reserved`, `revoked`, `registered`, `active_queues`, `query_task(*ids)`, `conf`, `clock`, `report`, `memsample`, `memdump`, `objgraph`, `hello`. Replies are flattened to `{node_name: reply}`; for a single string destination only that node's reply is returned.

`AsyncResult.revoke()` / `GroupResult.revoke()` use these APIs ([Result Objects](../results/result-objects.md)).

## Worker side

### Control bootstep and Pidbox (`celery/worker/consumer/control.py`, `celery/worker/pidbox.py`)

The consumer's `Control` step (requires `Tasks`) is included only if `worker_enable_remote_control` is true **and** the transport supports `fanout` exchanges. It uses:

- `Pidbox` — a mailbox `Node` named after the worker hostname, with `handlers = Panel.data` and a `state` object (`app`, `hostname`, `consumer`). It consumes on its own channel of the consumer connection. Every incoming message forwards the Lamport clock; unknown commands log "No such control command"; any other handler exception is logged and the pidbox consumer is **reset** (channel reopened).
- `gPidbox` — for green pools: runs the mailbox loop in a greenlet with its own connection (`drain_events(timeout=1.0)`), resetting on errors.

Commands run in the worker's main thread (the consumer loop), so long-running handlers block task consumption.

### Command registry (`celery/worker/control.py`)

`Panel` is a global registry populated by the `@control_command(...)` and `@inspect_command(...)` decorators, which record metadata (`type`, `alias`, `visible`, `default_timeout`, `help`, `signature`, `args`, `variadic`) used by the CLI to parse arguments. Handlers return `{'ok': ...}` or `{'error': ...}` (`ok()`/`nok()`). Custom commands can be added by decorating functions with these decorators in a module imported by the worker.

**Control commands**

| Command | Effect |
| --- | --- |
| `revoke(task_id, terminate=False, signal=None)` | Adds ids to `state.revoked`, marks them `REVOKED` in the result backend, and with `terminate` signals the pool process running them |
| `revoke_by_stamped_headers(headers, terminate, signal)` | Records revoked stamp values in `state.revoked_stamps`; with `terminate`, signals active requests whose stamps match |
| `terminate(signal, task_id)` | `revoke(..., terminate=True)` |
| `rate_limit(task_name, rate_limit)` | Validates the rate string, sets `task.rate_limit` and rebuilds the consumer's token buckets (empty value disables) |
| `time_limit(task_name, soft, hard)` | Sets the task class's soft/hard time limits for future executions |
| `enable_events` / `disable_events` | Adds/removes the `task` group from the event dispatcher |
| `heartbeat` | Sends an immediate `worker-heartbeat` event |
| `election(id, topic, action)` | Starts a Gossip election |
| `pool_grow(n)` / `pool_shrink(n)` | Resize the pool and adjust prefetch — refused when autoscaling is active |
| `autoscale(max, min)` | Update the autoscaler range (error if not enabled) |
| `pool_restart(modules, reload, reloader)` | Re-import modules and restart pool processes — requires `worker_pool_restarts` |
| `add_consumer(queue, exchange, exchange_type, routing_key)` / `cancel_consumer(queue)` | Start/stop consuming a queue at runtime (scheduled via `consumer.call_soon`) |
| `shutdown(msg)` | Raises `WorkerShutdown(0)` → warm shutdown |

**Inspect commands**: `ping` (0.2s default timeout), `stats` (worker `stats()` incl. pool, rusage, broker, prefetch), `active` (requests executing), `reserved` (prefetched, not started), `scheduled` (ETA requests on the timer), `revoked`, `registered` (task names with optional attributes), `active_queues`, `query_task(ids)` (state of specific requests), `conf` (non-sensitive config), `clock`, `report`, `memsample`/`memdump`/`objgraph`, and hidden `hello` (used by Mingle to exchange clocks and revoked ids).

### How revocation takes effect

- Requests already received are checked against `state.revoked` (and stamped revocations) when the strategy admits them and again just before execution (`Request.revoked()`), so revoked tasks are acknowledged and marked revoked instead of executed.
- `state.revoked` is a bounded, expiring `LimitedSet` that is shared with newly started workers via Mingle and persisted across restarts with `--statedb` (see [Worker Bootsteps](bootsteps-and-workcontroller.md#worker-global-state-celeryworkerstatepy)).
- Revoking without `terminate` doesn't stop a task already running; `terminate=True` sends a signal to the pool process (prefork) or kills the greenlet (green pools) — risky because the process may have moved on to another task.

See [Task Execution](task-execution.md) for the request side.

## CLI (`celery/bin/control.py`)

- `celery inspect <command> [args] [--timeout] [--destination a,b] [--json]`
- `celery control <command> [args] [--timeout] [--destination] [--json]`
- `celery status` — pings all workers and prints which are online.

Arguments are converted using the `Panel.meta` signature/args (`_compile_arguments`), so the CLI automatically supports custom registered commands. Errors from remote commands are reported via `handle_remote_command_error`.

## Related tests

`t/unit/app/test_control.py`, `t/unit/worker/test_control.py`, `t/unit/worker/test_revoke.py`, `t/unit/bin/test_control.py`, `t/integration/test_inspect.py`, `t/smoke/tests/test_control.py`.
