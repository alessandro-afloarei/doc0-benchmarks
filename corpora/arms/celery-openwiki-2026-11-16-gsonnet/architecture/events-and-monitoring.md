---
type: architecture
title: Events, Remote Control and Monitoring
description: How workers publish monitoring events (dispatcher, heartbeat), how clients consume and aggregate them (receiver, State, snapshots), how worker-to-worker sync works (mingle, gossip, election), and how the pidbox remote-control channel implements inspect/control commands such as revoke, rate_limit and pool_grow.
tags: [celery, events, monitoring, remote-control, pidbox, heartbeat, gossip, inspect]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:22:47.483Z
sources:
  - id: openwiki-source-41d293d3c7e3c875eed1b7ef
    resource: repo://celery/app/control.py
  - id: openwiki-source-4be6cca2c9164c478933a960
    resource: repo://celery/events/dispatcher.py
  - id: openwiki-source-615baded4198a1e9794a8bb1
    resource: repo://celery/events/receiver.py
  - id: openwiki-source-42ea84090e3e2292a97a3a4d
    resource: repo://celery/events/snapshot.py
  - id: openwiki-source-2f1a7c2fcace441b360b3f19
    resource: repo://celery/events/state.py
  - id: openwiki-source-dd622d1d70314bce53103492
    resource: repo://celery/worker/consumer/events.py
  - id: openwiki-source-6c95d18e974f6856ea8444ee
    resource: repo://celery/worker/consumer/gossip.py
  - id: openwiki-source-494b09efbe8a8857c6c2e0b9
    resource: repo://celery/worker/consumer/heart.py
  - id: openwiki-source-63a383ca50663d5c1b07b920
    resource: repo://celery/worker/consumer/mingle.py
  - id: openwiki-source-a85d69622d5baa166a82e6c1
    resource: repo://celery/worker/control.py
  - id: openwiki-source-e8992bfabcddb8fdcad7cadf
    resource: repo://celery/worker/heartbeat.py
  - id: openwiki-source-4ee29959ac62b2a32bb988a9
    resource: repo://celery/worker/pidbox.py
  - id: openwiki-source-7a844ae59c546297a34da340
    resource: repo://celery/worker/state.py
generated: { by: "claude-code", at: "2026-11-16T09:22:47.483Z" }
---

# Events, Remote Control and Monitoring

Celery has two broker-based side channels, distinct from the task queues:

1. **Events** (`celery/events/`): a one-way stream of monitoring messages (`task-received`, `task-succeeded`, `worker-heartbeat` ...) published by workers to a topic exchange and consumed by monitors such as Flower, `celery events`, or the workers themselves (gossip).
2. **Remote control / pidbox** (`celery/app/control.py`, `celery/worker/control.py`, `celery/worker/pidbox.py`): a broadcast request/reply channel for commands like `inspect active`, `revoke`, `rate_limit`, `pool_grow`.

Both are wired into the worker as consumer bootsteps (see [[/openwiki/architecture/worker.md]]).

## Event production

`EventDispatcher` (`celery/events/dispatcher.py`) is the publisher. `send(type, **fields)` is a no-op when the dispatcher is disabled or when the event's group (the prefix before `-`, e.g. `task`, `worker`) is not in the allowed `groups`. Otherwise each event is stamped with hostname, pid, UTC offset and a **logical clock value** (`clock.forward()`), then either published immediately, or — for groups listed in `buffer_group` — appended to a per-group buffer which is flushed in batches (`<group>.multi` routing key) when `buffer_limit` is reached or when `flush()` is called. Events raised while the connection is down are held in an outbound buffer (`buffer_while_offline`) and re-published after reconnect. Event delivery mode defaults to transient (`delivery_mode=1`), and a few transports (`sql`) are disabled outright.

On the worker, the `Events` bootstep (`celery/worker/consumer/events.py`) creates the dispatcher with `groups=None` (all events) when task events are on, or `['worker']` otherwise; it is enabled if any of task events, gossip or heartbeat need it. Buffering of `task` events is only enabled when the worker has an event loop hub. On each consumer restart the old dispatcher's buffered events are carried over and the reserved requests are re-pointed at the new dispatcher. Task events are controlled by `-E/--task-events` or `worker_send_task_events`, per-task `send_events`, and can be flipped at runtime with the `enable_events` / `disable_events` control commands. Task-side emission happens in `worker/strategy.py` (`task-received`) and `worker/request.py` (`task-started`, `task-succeeded`, `task-failed`, `task-retried`, `task-revoked`, `task-rejected`).

The **heartbeat** is sent by `worker.heartbeat.Heart`, which schedules `worker-heartbeat` events on the worker timer every `heartbeat_interval` (2 seconds by default) and also fires the `heartbeat_sent` signal. It is not the AMQP protocol heartbeat (`broker_heartbeat`). Consumers use these to decide whether a worker is alive.

## Event consumption and state

`EventReceiver` (`celery/events/receiver.py`) is a kombu `ConsumerMixin` that declares an **exclusive/auto-delete queue per receiver** (named `<event_queue_prefix>.<node_id>`) bound to the event exchange with routing key `#`; TTL, expiry, durability and exclusivity are configurable, but exclusive+durable together raises `ImproperlyConfigured`. `capture()` / `itercapture()` consume and dispatch each decoded event to handlers by type (a `*` handler gets all), forwarding or adjusting the local logical clock from the event's clock. `wakeup_workers()` broadcasts a `heartbeat` command so monitors see workers immediately.

`State` (`celery/events/state.py`) builds an in-memory model of the cluster from events: `Worker` objects (heartbeat history, `alive` = last heartbeat not yet expired, `freq` and an expiry window) and `Task` objects (state derived via `TASK_EVENT_TO_STATE`, with parent/root/children links from the event fields). Both are held in LRU caches bounded by `max_workers_in_memory` (5000) and `max_tasks_in_memory` (10000); a time-ordered task heap supports `tasks_by_time`, and `tasks_by_type` / `tasks_by_worker` index weak sets. Out-of-order events are handled by the per-task `event()` merge, which compares state precedence: an event describing a state that logically happened *before* the current one only fills in missing fields (per `merge_rules`) instead of regressing the state. `freeze_while` lets a reader take a consistent view.

`Polaroid` (`celery/events/snapshot.py`) is the "camera": it periodically (`freq`) calls `capture`, triggers `shutter_signal` with the frozen state, and cleans up on a slower timer — used by `celery events --camera`. `celery/events/cursesmon.py` implements the curses monitor and `dumper.py` the plain event dump. See [[/openwiki/architecture/cli.md]].

## Worker-to-worker coordination

- **Mingle** (`consumer/mingle.py`): at start and after each consumer restart, a worker sends an `inspect.hello` broadcast with its own revoked set. Neighbors reply with their logical clock and revoked ids; the new worker adjusts its clock and merges the revoked set, so a freshly started worker does not execute tasks that other workers already know are revoked. Enabled only on transports in `{'amqp','redis','gcpubsub'}` and can be disabled with `--without-mingle`.
- **Gossip** (`consumer/gossip.py`): enabled for `{'amqp','redis'}` unless `--without-gossip`; it consumes all events from other workers into its own small `State`, keeping the logical clock current and tracking `node_join`, `node_leave` and `node_lost`. It also implements a simple **election** protocol: `worker-elect` events carry an election id, topic and action; each live worker acks, and once every alive worker has replied the one chosen by sorting by clock and hostname performs the action (currently `task`, which publishes a task signature exactly once cluster-wide). It is exposed through the `election` control command.

## Remote control (pidbox)

**Client side** — `app.control` (`Control`, `celery/app/control.py#L426`) owns a kombu `Mailbox` on a fanout control exchange (`control_exchange`), with queue TTL/expiry/durability from `control_queue_*` settings (durable and exclusive together is rejected). It exposes typed helpers (`revoke`, `revoke_by_stamped_headers`, `terminate`, `ping`, `rate_limit`, `time_limit`, `add_consumer`, `cancel_consumer`, `enable_events`, `pool_grow`, `pool_shrink`, `autoscale`, `pool_restart`, `shutdown`, `heartbeat`, `purge`, `election`) over the generic `broadcast(command, arguments, destination, reply, timeout, limit, callback)`. `app.control.inspect(...)` returns an `Inspect` object with read-only queries (`active`, `scheduled`, `reserved`, `revoked`, `registered`, `stats`, `ping`, `active_queues`, `query_task`, `conf`, `report`, `hello`, memory helpers). Replies are collected until `timeout` (default 1s) or `limit` replies, so an empty result can mean "no worker answered in time".

**Worker side** — `Panel` (`celery/worker/control.py`) is a global registry populated by the `@control_command` and `@inspect_command` decorators; it records name, alias, type, default timeout, signature and variadic args so the CLI can parse commands generically. The `Pidbox` consumer bootstep (`worker/pidbox.py`) builds a mailbox `Node` for the worker's hostname with `Panel.data` as handlers and a shared `state` (app, hostname, consumer), listens on the control exchange, and for each message forwards the logical clock then calls `node.handle_message`. An unknown command is logged; any other handler exception is logged and the pidbox **resets** (stops and restarts its consumer). `gPidbox` is the greenlet-pool variant that runs a loop in a spawned greenlet and resets by flag.

Notable commands:

- `revoke` (`#L138-L153`, `_revoke` `#L214-L247`): adds task ids to the in-memory `worker_state.revoked` set, marks each as revoked in the result backend (failures to do so only log a warning), and with `terminate=True` terminates the matching active requests with the given signal. Revocations are *not persisted* unless the worker was started with `--statedb`; mingle re-propagates them to new workers.
- `revoke_by_stamped_headers`: revokes by stamp header values (see stamping in [[/openwiki/architecture/canvas-workflows.md]]), storing them in `revoked_stamps` and optionally terminating active tasks whose `Request.stamps` match.
- `rate_limit`, `time_limit`: change a task type's limits live; `pool_grow`/`pool_shrink`/`autoscale`/`pool_restart`: adjust the pool ([[/openwiki/architecture/concurrency-pools.md]]); `add_consumer`/`cancel_consumer`: change consumed queues; `shutdown`, `ping`, `stats`, `active`, `reserved`, `scheduled`, `registered`, `report`, `conf`, `memsample`/`memdump`/`objgraph` diagnostics.

## Operational notes

- Events and control messages are fire-and-forget and use short-lived or exclusive queues; on RabbitMQ unconsumed event queues are bounded by `event_queue_ttl`/`event_queue_expires`. Running a monitor with no consumers draining it can otherwise grow queues.
- Control commands need a transport that supports fanout (AMQP and Redis do); mingle and gossip are gated by `compatible_transports` for that reason.
- Because the logical clock is advanced on every event and control message, ordering between workers is approximate but monotonic.
