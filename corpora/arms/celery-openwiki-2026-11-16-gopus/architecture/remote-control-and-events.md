---
type: architecture
title: Remote Control and Monitoring Events
description: How clients broadcast control/inspect commands to workers over a kombu pidbox mailbox, how workers execute them (revoke, rate limits, pool, queues, shutdown), and how task/worker monitoring events are dispatched, received and folded into cluster State.
tags: [remote-control, pidbox, inspect, revoke, events, monitoring]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:57:55.789Z
sources:
  - id: openwiki-source-41d293d3c7e3c875eed1b7ef
    resource: repo://celery/app/control.py
  - id: openwiki-source-4be6cca2c9164c478933a960
    resource: repo://celery/events/dispatcher.py
  - id: openwiki-source-2f1a7c2fcace441b360b3f19
    resource: repo://celery/events/state.py
  - id: openwiki-source-dd622d1d70314bce53103492
    resource: repo://celery/worker/consumer/events.py
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
generated: { by: "claude-code", at: "2026-11-16T06:57:55.789Z" }
---

# Remote Control and Monitoring Events

Celery has two broker-based side channels besides the task queues:

1. **Remote control** – a request/reply broadcast mailbox (`kombu.pidbox`)
   used by `app.control`, `celery inspect`, `celery control`, and Flower to
   query or command running workers.
2. **Events** – a one-way stream of `task-*` and `worker-*` messages on a
   topic exchange that monitors consume to reconstruct cluster state.

Both run inside the worker's [Consumer blueprint](worker/consumer.md) as the
`Control`, `Events`, `Heart` and `Gossip` bootsteps.

## Remote control: client side

`celery/app/control.py` defines:

- **`Control`** (`app.control`) – wraps a `kombu.pidbox.Mailbox` on the
  `control_exchange` (default `celery`) of type **fanout**, using the app's
  `accept_content` and `task_serializer`, the app producer pool, and the
  `control_queue_*` TTL/expiry/exclusive/durable settings.
  `control_queue_durable` and `control_queue_exclusive` are mutually
  exclusive (raises `ImproperlyConfigured`). The producer pool reference is
  dropped after fork.
- `Control.broadcast(command, arguments, destination, reply, timeout, limit,
  callback, pattern, matcher)` is the primitive every helper uses. With
  `destination=None` all workers receive the command; with `reply=True` it
  collects replies until `timeout` or `limit`.
- Convenience commands: `revoke`, `revoke_by_stamped_headers`, `terminate`,
  `ping`, `rate_limit`, `add_consumer`, `cancel_consumer`, `time_limit`,
  `enable_events`/`disable_events`, `pool_grow`/`pool_shrink`, `autoscale`,
  `pool_restart`, `heartbeat`, `shutdown`, `election`, and `purge` (which
  purges the task queues directly, not via broadcast).
- **`Inspect`** (`app.control.inspect(destination=..., timeout=1.0)`) – read
  only queries: `active`, `scheduled`, `reserved`, `revoked`, `registered`,
  `stats`, `active_queues`, `query_task`, `conf`, `report`, `clock`,
  `ping`, `memsample`, `memdump`, `objgraph`. Replies are flattened to
  `{hostname: reply}`.

## Remote control: worker side

`celery/worker/control.py` holds the **`Panel`** — a global registry of
command handlers. Handlers are registered with `@control_command(...)` (type
`control`) or `@inspect_command(...)` (type `inspect`), with metadata
(alias, signature, argument converters, help) used by the CLI to build
`celery control`/`celery inspect` subcommands. Each handler receives a
`state` object containing `app`, `hostname` and `consumer`, and returns
`ok(...)` / `nok(...)` dicts. **Extension seam:** user code can register
additional commands with the same decorators before the worker starts.

`celery/worker/pidbox.py` wires the panel to the broker:

- `Pidbox` creates `app.control.mailbox.Node(hostname, handlers=Panel.data)`
  and consumes on a fresh channel of the consumer connection.
- `on_message` forwards the Lamport clock, then calls
  `node.handle_message`. Unknown commands are logged; any other handler
  exception is logged and **the mailbox is reset** (consumer cancelled and
  restarted).
- `gPidbox` is the variant for green pools (eventlet/gevent): `start()`
  spawns a mailbox loop on the pool (`pool.spawn_n`), and `reset()` only
  bumps a counter that the loop notices to reconnect the channel.

### Revocation

`revoke` (`celery/worker/control.py`):

1. adds the ids to `worker_state.revoked`, a `LimitedSet` bounded by
   `CELERY_WORKER_REVOKES_MAX` (default 50000) entries that expire after
   `CELERY_WORKER_REVOKE_EXPIRES` (default 10800 s) — see
   `celery/worker/state.py`;
2. calls `backend.mark_as_revoked(task_id, reason='revoked')` for each id,
   only logging a warning if the backend fails;
3. if `terminate=True`, sends the signal (default `TERM`) to the pool process
   running each matching active request.

Revoked ids are checked again when a message is received (strategy) and before
execution (`Request`), so a revoke reaches tasks that are still queued or
waiting for their ETA. Because the set lives in worker memory, revocations are
lost on restart unless the worker uses `--statedb` (the `StateDB` bootstep
persists `revoked` in a zlib-compressed shelve file); workers also exchange
revoked sets on startup through **Mingle**, which sends the `hello` inspect
command with its own revoked set and merges the revoked ids in the replies.

`revoke_by_stamped_headers` works the same way but matches on
[stamping](../concepts/canvas.md) headers stored in
`worker_state.revoked_stamps`.

## Events: producing

`EventDispatcher` (`celery/events/dispatcher.py`) publishes events to the
`event_exchange` (default `celeryev`, a topic exchange) using
`event_serializer` (default `json`):

- `send(type, **fields)` drops the event if dispatching is disabled or the
  event's group (the part before the first `-`, e.g. `task` or `worker`)
  is not in `groups`.
- Events in `buffer_group` are buffered and flushed in batches of up to
  `buffer_limit` (24) — the worker uses this for `task` events when it has
  an event loop.
- Each event gets `hostname`, `utcoffset`, `pid` and a Lamport `clock`; the
  routing key is the type with `-` replaced by `.` (`task.succeeded`).
- When publishing fails and `buffer_while_offline` is on (default), events are
  kept in an outbound buffer and re-sent by `flush()` after reconnection.
- Dispatchers are disabled automatically for the `sql` transport.

In the worker, the `Events` consumer step creates the dispatcher
(`celery/worker/consumer/events.py`). Task events are sent only when
`worker_send_task_events` / `-E` is enabled — otherwise the dispatcher is
restricted to the `worker` group, still needed for heartbeats and gossip. On
reconnection it carries over the previous dispatcher's buffer and group
changes made by `enable_events`/`disable_events`.

The `Heart` step (`celery/worker/heartbeat.py`) sends `worker-online` on
start, `worker-heartbeat` every 2 s by default (`heartbeat_interval`) on the
worker timer, and `worker-offline` on stop. Task events
(`task-sent`, `task-received`, `task-started`, `task-succeeded`,
`task-failed`, `task-retried`, `task-revoked`, `task-rejected`) come from
publishing (`task_send_sent_event`), the strategy and the request/trace code.

## Events: consuming

- **`EventReceiver`** (`celery/events/receiver.py`) – a kombu
  `ConsumerMixin` that binds a queue named `<event_queue_prefix>.<node_id>`
  (exclusive by default via `event_queue_exclusive`, auto-deleted unless
  `event_queue_durable`) to the event exchange with a routing key (default `#`),
  converts messages with `event_from_message` (adjusting timestamps for clock
  skew), and dispatches to `handlers[type]` or the `'*'` handler.
  `capture(limit, timeout, wakeup=True)` consumes events; `wakeup_workers()`
  broadcasts a `heartbeat` control command so workers announce themselves.
- **`State`** (`celery/events/state.py`) – an in-memory model of the
  cluster used by Flower, `celery events` and snapshot cameras. It keeps
  `Worker` and `Task` objects in LRU caches (`max_workers_in_memory=5000`,
  `max_tasks_in_memory=10000`) plus a time-ordered task heap. A worker is
  considered alive while the newest heartbeat is within the expected
  frequency plus `HEARTBEAT_EXPIRE_WINDOW` (200 %) of slack.
- **Out-of-order delivery:** `Task.event` uses `celery.states.precedence`;
  when an event's state logically happened *before* the current state (and
  neither is `RETRY`), only the fields listed in `merge_rules` are merged, so
  a late `task-received` cannot overwrite a `SUCCESS`.
- `celery/events/snapshot.py` (`Polaroid`) periodically freezes the State and
  hands it to a "camera" (`celery events --camera=...`); `cursesmon.py` is
  the curses `celery events` UI and `dumper.py` prints raw events.

## Configuration

| Setting | Default | Effect |
|---------|---------|--------|
| `control_exchange` | `celery` | Pidbox exchange name prefix |
| `control_queue_ttl` / `control_queue_expires` | 300 s / 10 s | Message TTL / queue expiry for mailbox and reply queues |
| `control_queue_exclusive` / `control_queue_durable` | `True` / `False` | Mutually exclusive |
| `event_exchange` | `celeryev` | Event exchange |
| `event_queue_prefix`, `event_queue_ttl`, `event_queue_expires` | `celeryev`, 5 s, 60 s | Receiver queue properties |
| `event_serializer` | `json` | Event encoding |
| `worker_send_task_events` | `False` | Enables `task-*` events (`-E`) |
| `task_send_sent_event` | `False` | Emits `task-sent` from the publisher |

## Tests

- `t/unit/app/test_control.py` – client `Control`/`Inspect`.
- `t/unit/worker/test_control.py`, `t/unit/worker/test_revoke.py` – panel
  commands and revocation.
- `t/unit/events/` – dispatcher, receiver, State, snapshot, cursesmon.
- `t/integration/test_inspect.py`, `t/smoke/tests/test_control.py` – against
  real brokers.

See also: [CLI](../operations/cli-and-daemonization.md),
[Consumer](worker/consumer.md).
