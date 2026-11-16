---
type: architecture
title: Events, Monitoring and Remote Control
description: How workers and clients emit monitoring events (dispatcher, receiver, cluster State), how worker-to-worker sync (heartbeat, mingle, gossip) works, and how the pidbox remote-control channel (app.control, inspect, worker control commands) is implemented.
tags: [celery, events, monitoring, remote-control, pidbox, gossip, heartbeat, inspect]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:56:17.091Z
sources:
  - id: openwiki-source-41d293d3c7e3c875eed1b7ef
    resource: repo://celery/app/control.py
  - id: openwiki-source-ac404435efa758dad4bbfc83
    resource: repo://celery/app/defaults.py
  - id: openwiki-source-4be6cca2c9164c478933a960
    resource: repo://celery/events/dispatcher.py
  - id: openwiki-source-3fcc726af565b7ddfc0ea693
    resource: repo://celery/events/event.py
  - id: openwiki-source-615baded4198a1e9794a8bb1
    resource: repo://celery/events/receiver.py
  - id: openwiki-source-2f1a7c2fcace441b360b3f19
    resource: repo://celery/events/state.py
  - id: openwiki-source-448ad2fc321c5e1d8e0a93fc
    resource: repo://celery/worker/consumer/control.py
  - id: openwiki-source-dd622d1d70314bce53103492
    resource: repo://celery/worker/consumer/events.py
  - id: openwiki-source-6c95d18e974f6856ea8444ee
    resource: repo://celery/worker/consumer/gossip.py
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
generated: { by: "claude-code", at: "2026-11-16T17:56:17.091Z" }
---

# Events, Monitoring and Remote Control

Celery has two broadcast channels that sit next to the task queues. Both are built on kombu exchanges and are independent of the result backend.

| Channel | Direction | Purpose | Main code |
|---|---|---|---|
| **Events** (`celeryev` topic exchange) | worker or client, then any number of monitors | A stream of facts: task state changes, worker online/offline, heartbeats | `celery/events/` |
| **Control / pidbox** (fanout exchange) | clients to workers, with replies | Commands such as `revoke`, `ping`, `stats`, `pool_grow` | `celery/app/control.py`, `celery/worker/control.py`, `celery/worker/pidbox.py` |

Workers also consume the event stream of their peers (gossip) and query peers over the control channel at startup (mingle).

## Events

### Format and exchange

An event is a plain dict with a `type` (`<group>-<subject>`, for example `task-started` or `worker-heartbeat`) and a `timestamp` (`celery/events/event.py`). `group_from(type)` returns the part before the first dash. The routing key is the type with `-` replaced by `.`. `get_exchange` builds the topic exchange named by `event_exchange` (default `celeryev`). For Redis and GCP Pub/Sub transports it uses a **fanout** exchange instead, a workaround for those transports' lack of topic routing.

### Dispatcher (`EventDispatcher`)

`celery/events/dispatcher.py` is the sending side:

- `send(type, **fields)` is a no-op if the dispatcher is disabled, or if `groups` is non-empty and the event's group is not in it. Events carry the hostname and pid, a UTC offset, and a Lamport clock value (unless `blind=True`).
- **Buffering:** events of groups in `buffer_group` are batched in memory and flushed as one `<group>.multi` message once `buffer_limit` (24) is reached. The worker only enables this when it runs an event loop (`buffer_group=['task']`). Separately, if publishing fails and `buffer_while_offline` is true, the event goes to an outbound buffer and is re-sent by `flush()`. The worker's `Events` bootstep carries the old dispatcher's buffer over to a new one when the connection is re-established, and re-points reserved requests at the new dispatcher.
- It disables itself for transports in `DISABLED_TRANSPORTS` (the `sql` transport). `enable()`/`disable()` run registered `on_enabled` and `on_disabled` callbacks, which is how the heartbeat starts and stops with it.
- **Who sends what:** workers send `task-received` (`celery/worker/strategy.py`), `task-started`, `task-succeeded`, `task-failed`, `task-retried`, `task-revoked`, `task-rejected` and `task-cancelled` (`celery/worker/request.py`), and `worker-online`, `worker-heartbeat` and `worker-offline` (`celery/worker/heartbeat.py`). Clients send `task-sent` when `task_send_sent_event` is enabled (`celery/app/amqp.py`).

Task events are off by default on the worker (`worker_send_task_events` is `False`) unless `-E` is given. `enable_events` and `disable_events` control commands add or remove the `task` group at runtime. The `Events` bootstep remembers that change across a reconnect.

### Heartbeats

`celery/worker/heartbeat.py::Heart` publishes `worker-online`, then `worker-heartbeat` every 2 seconds (configurable), including `freq`, the number of active requests, the processed count, load average and software info. It publishes `worker-offline` on stop. These event-level heartbeats are unrelated to AMQP protocol heartbeats. The `Heart` bootstep (`celery/worker/consumer/heart.py`) starts it.

### Receiver (`EventReceiver`)

`celery/events/receiver.py` is a kombu `ConsumerMixin` that binds a private queue named `<event_queue_prefix>.<node_id>` to the event exchange. The queue's TTL, expiry, exclusivity and durability come from the `event_queue_*` settings, and exclusive plus durable is rejected as `ImproperlyConfigured`. It dispatches each event to `handlers[type]` or the `"*"` catch-all. For every incoming event it adjusts the local Lamport clock, localizes the timestamp using the sender's UTC offset, and records `local_received`. Client `task-sent` events have no usable clock, so they are stamped with a skewed local value. On startup, `capture()` calls `wakeup_workers`, which broadcasts a `heartbeat` command so monitors learn about workers immediately.

### Cluster `State`

`celery/events/state.py::State` rebuilds a picture of the cluster from the event stream:

- `Worker` objects track heartbeats. `alive` is true while the last heartbeat has not expired, with an expiry window based on the advertised `freq`. Clock drift above 16 seconds triggers a warning.
- `Task` objects hold per-task fields. **Out-of-order events** are handled by `merge_rules`: fields like `name`, `args` and `kwargs` are always taken from the `RECEIVED` event, so a late or early event cannot overwrite them.
- Memory is bounded. Workers and tasks live in LRU caches (defaults 5,000 workers and 10,000 tasks), and a time-ordered heap of events is capped by a multiple of the task limit.
- Indexes by task type and by worker, parent/child and root links (children are resolved lazily if a child event arrives before the parent), and `on_node_join` and `on_node_leave` callbacks.

Tools built on this: `celery events` (curses monitor `cursesmon`, `Dumper` that prints events, and `Polaroid` snapshots in `snapshot.py`, which store the state at intervals through a camera class). Third-party tools such as Flower use the same API.

## Worker-to-worker coordination

These are consumer bootsteps (see [Worker and consumer](worker-and-consumer.md)). They are enabled only for transports that support them (`mingle`: amqp, redis, gcpubsub; `gossip`: amqp, redis).

- **Mingle** (`celery/worker/consumer/mingle.py`): at startup or consumer restart it sends the `hello` inspect command to all peers with a 1-second timeout. Each reply carries the peer's revoked set and clock. The new worker merges the revoked ids and adjusts its clock. Hence a task revoked while a worker was down is not run by the replacement. It can be disabled with `--without-mingle`.
- **Gossip** (`celery/worker/consumer/gossip.py`): consumes `worker.#` events from other workers into its own `State` (with `max_tasks_in_memory=1`), and runs a periodic check, every 5 seconds, that removes workers whose heartbeat has expired and fires `node_lost`. It exposes `on.node_join`, `node_leave` and `node_lost` hook sets.
- **Elections:** `app.control.election(id, topic, action)` makes every gossiping worker publish `worker-elect`, then acknowledge. Once all alive workers have acknowledged, the winner is the node with the smallest `(clock, hostname.pid)` (using `clock.sort_heap`). It runs the handler for the topic (only `task` is built in, which applies a signature). This yields "exactly one worker runs this" behaviour without a coordinator.

## Remote control

### Client side (`celery/app/control.py`)

`Control` owns a kombu `Mailbox` (`control_exchange`, fanout, using the app's `accept_content` and `task_serializer`). It rejects durable plus exclusive control queues. Methods map to commands: `revoke`, `revoke_by_stamped_headers`, `terminate`, `ping`, `rate_limit`, `time_limit`, `add_consumer`, `cancel_consumer`, `enable_events`, `disable_events`, `pool_grow`, `pool_shrink`, `autoscale`, `pool_restart`, `heartbeat`, `shutdown`, `election`, `purge`. They are built on `broadcast(command, arguments, destination, reply, timeout, limit, callback, pattern, matcher)`. A broadcast goes to all workers, to named nodes, or to nodes matching a pattern. With `reply=True` it collects replies until `timeout` or `limit`.

`Inspect` (`app.control.inspect(...)`) wraps read-only commands (`active`, `scheduled`, `reserved`, `revoked`, `registered`, `stats`, `ping`, `active_queues`, `query_task`, `conf`, `report`, `clock`, and diagnostics such as `memsample`). Replies are flattened to a `{nodename: reply}` dict. A single string destination returns just that node's reply. The default timeout is 1 second, so slow workers can be missing from the results. `ping` uses 0.2 seconds on the worker side.

### Worker side

`celery/worker/control.py` has a global registry, `Panel`, populated by decorators: `@control_command` (state-changing) and `@inspect_command` (read-only). Each registers the function with metadata (alias, visibility, default timeout, help, signature). Handlers get a `state` object (app, hostname, consumer) and return a JSON-friendly reply, normally `{'ok': ...}` or `{'error': ...}`.

The `Control` consumer bootstep (`celery/worker/consumer/control.py`) creates a `Pidbox` (`celery/worker/pidbox.py`), or the greenlet-based `gPidbox` for eventlet and gevent pools. It is only included when `worker_enable_remote_control` is true and the broker supports fanout exchanges. `Pidbox.on_message` advances the Lamport clock and calls `Node.handle_message`. An unknown command logs "No such control command". Any other exception is logged, and the box resets its channel and consumer.

Notable command semantics:

- **`revoke`** adds ids to the worker's in-memory `revoked` set (a `LimitedSet` capped at 50,000 ids with a 3-hour expiry by default, overridable with `CELERY_WORKER_REVOKES_MAX` and `CELERY_WORKER_REVOKE_EXPIRES`; it can also persist to the state DB, `--statedb`), and tries to mark each id revoked in the result backend. With `terminate=True` it also signals the process running the task using the pool (`terminate_job`). `Request.execute_using_pool` checks `revoked()` before dispatch, so revocation also stops tasks that have been received but not started.
- **`revoke_by_stamped_headers`** revokes by stamp values instead of ids (see [Canvas](canvas-workflows.md#stamping)).
- **`rate_limit`** and **`time_limit`** change per-task-type limits at runtime for that worker only.
- **`pool_grow`, `pool_shrink`, `autoscale`, `pool_restart`** act on the pool (see [Concurrency pools](concurrency-pools.md)).
- **`add_consumer` / `cancel_consumer`** change which queues the worker consumes from at runtime.
- **`shutdown`** raises `WorkerShutdown` in the worker.

Because the control channel executes commands, it inherits the broker's trust boundary: anyone who can publish to the control exchange can drive the worker. See [Message security](../operations/message-security.md).

## Tests

`t/unit/events/` (dispatcher, receiver, state, snapshot, dumper, cursesmon), `t/unit/app/test_control.py`, `t/unit/worker/test_control.py`, `t/unit/worker/test_consumer.py`, and `t/integration/test_inspect.py` for live inspect calls. See [Testing, CI and development workflow](../testing/test-strategy.md).
