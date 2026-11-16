---
type: subsystem
title: Worker Consumer
description: The worker's Consumer (celery/worker/consumer/) — its bootstep blueprint (Connection, Mingle, Events, Gossip, Heart, Control, Tasks, DelayedDelivery, Evloop, Agent), message dispatch to task strategies, prefetch/QoS management including quorum queues and disable-prefetch, rate-limit buckets, the asynloop/synloop event loops, and connection-loss recovery.
tags: [worker, consumer, bootsteps, qos, prefetch, event-loop, connection-recovery, mingle, gossip]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:05:29.073Z
sources:
  - id: openwiki-source-cd5b25b412e425989370ceb9
    resource: repo://celery/worker/components.py
  - id: openwiki-source-94b60a38fd26082deb41f979
    resource: repo://celery/worker/consumer/consumer.py
  - id: openwiki-source-448ad2fc321c5e1d8e0a93fc
    resource: repo://celery/worker/consumer/control.py
  - id: openwiki-source-e05a13d8343387f57526f632
    resource: repo://celery/worker/consumer/delayed_delivery.py
  - id: openwiki-source-63a383ca50663d5c1b07b920
    resource: repo://celery/worker/consumer/mingle.py
  - id: openwiki-source-337ca17b51d3603b5a2c09ec
    resource: repo://celery/worker/consumer/tasks.py
  - id: openwiki-source-1a5a653f1e0dc794a3d6d553
    resource: repo://celery/worker/loops.py
generated: { by: "claude-code", at: "2026-11-16T17:05:29.073Z" }
---

# Worker Consumer

The `Consumer` (`celery/worker/consumer/consumer.py`) is the part of the worker that talks to the broker. It is created by the worker's `Consumer` bootstep and runs its own blueprint of steps; when the broker connection is lost the whole consumer blueprint restarts while the pool keeps running. See [Worker Architecture](worker-architecture.md) for the outer worker blueprint.

## Construction

The worker passes `on_task_request` (the worker's `_process_task`, which hands requests to the pool), the pool, timer, hub, hostname and `initial_prefetch_count = concurrency (or autoscale max) × worker_prefetch_multiplier` (default 4).

The consumer chooses its loop: `asynloop` when the worker has a hub (event loop), otherwise `synloop`. AMQP heartbeats (`broker_heartbeat`) are only used with the hub or a green pool. Per-task **token buckets** for `rate_limit` are created for every registered task (`task_buckets`), unless rate limits are disabled. Extra steps from `app.steps['consumer']` are added to the blueprint.

## Blueprint steps

Default steps, ordered by their `requires` dependencies:

| Step | File | Responsibility |
|------|------|----------------|
| `Connection` | `connection.py` | Open the broker connection (`connection_for_read` with AMQP heartbeat), register its transport with the hub; reports broker info (password removed) |
| `Events` | `events.py` | Create the event dispatcher (see [Events](../events/monitoring.md)) |
| `Mingle` | `mingle.py` | On startup, broadcast `hello` to other workers (1 s timeout) and merge their logical clock and **revoked task ids**; only for amqp/redis/gcpubsub; disabled with `--without-mingle` |
| `Gossip` | `gossip.py` | Consume worker events from other nodes to track cluster membership (`on_node_join/leave/lost`), keep the Lamport clock in sync, and run simple leader **elections** (used by `Signature.election`); disabled with `--without-gossip` |
| `Heart` | `heart.py` | Send `worker-heartbeat` events every `heartbeat_interval` (default 2 s); `--without-heartbeat` |
| `Control` | `control.py` | Remote control mailbox (`Pidbox`, or `gPidbox` green thread for green pools); included only if `worker_enable_remote_control` and the transport supports fanout ([Remote Control](remote-control.md)) |
| `Tasks` | `tasks.py` | Set up QoS and start the task consumer on the selected queues |
| `DelayedDelivery` | `delayed_delivery.py` | Only when quorum queues are detected: declare RabbitMQ native delayed-delivery exchanges/queues and bind application queues, retrying connection errors (3 tries, 1 s) |
| `Evloop` | `consumer.py` | Runs last: enters `c.loop(...)` |
| `Agent` | `agent.py` | Optional `cell` actor agent when `worker_agent` is set |

## Receiving task messages

`create_task_handler()` returns `on_task_received(message)`:

1. Reads the task name from `message.headers['task']` (protocol 2). If headers are missing it decodes the body for a protocol 1 message; undecodable messages go to `on_decode_error`, which logs at CRITICAL and **acks** the message so it does not loop forever.
2. Looks up the task's strategy in `c.strategies` (built by `update_strategies()` from each task's `start_strategy`). Unknown task names call `on_unknown_task`: the error is logged, the message is **rejected**, the task is marked `FAILURE` with `NotRegistered(name)` in the result backend, a `task-failed` event is sent, and the `task_unknown` signal fires. Messages in an unknown format are rejected with a `task_rejected` signal.
3. Wraps `message.ack_log_error` / `reject_log_error` in promises executed via `call_soon_ack` — immediately for synloop workers (to avoid ack latency), via the hub otherwise.
4. Calls the strategy (see [Request Lifecycle](request-lifecycle.md)). `InvalidTaskError`/`ContentDisallowed` → `on_invalid_task` (logged, rejected); `DecodeError` → `on_decode_error`.

`on_task_message` is a set of extra callbacks invoked per message (the autoscaler uses it).

## Prefetch and QoS

The `Tasks` step:

- Sets `basic_qos(prefetch_count=initial_prefetch_count, global=qos_global)` and wraps it in a kombu `QoS` object (`c.qos`) that supports `increment_eventually`/`decrement_eventually`. The loops apply pending changes each iteration (`qos.update()`).
- `qos_global` follows RabbitMQ semantics (`not connection.qos_semantics_matches_spec`), but is forced **off for quorum queues** (`worker_detect_quorum_queues`), which do not support global QoS — making the prefetch count effectively static.
- `worker_eta_task_limit` caps how far QoS may grow (ETA tasks increment the prefetch count while they wait).
- `worker_disable_prefetch` (Redis only) patches the channel's `can_consume` so the worker never reserves more messages than it has free pool slots (autoscaler max or pool size).
- Pool size changes (`pool_grow`, autoscale) call `_update_prefetch_count` to keep `prefetch = processes × multiplier`.

## Rate limiting

When a task has a `rate_limit`, the strategy calls `_limit_task`/`_limit_post_eta`, which queue the request in the task's `TokenBucket` (capacity 1). `_schedule_bucket_request` moves requests to the pool while tokens are available and otherwise schedules itself on the timer for `bucket.expected_time()`. Rate limits are per worker process, not cluster-wide. `rate_limit` remote control updates buckets at runtime.

## Event loops (`celery/worker/loops.py`)

- **`asynloop`** (non-blocking, hub-based): sets the consumer's `on_message`, registers the worker components and consumer steps with the hub, starts consuming, signals readiness, raises `WorkerLostError` if pool processes failed to start, enables AMQP heartbeat checks on the hub timer (`broker_heartbeat_checkrate`), then iterates `hub.create_loop()` while the blueprint is running — checking for shutdown requests and QoS updates every iteration.
- **`synloop`** (blocking fallback for non-async transports and green pools): loops on `connection.drain_events(timeout=2.0)`, runs deferred `_pending_operations` (acks, control replies) between iterations, and checks AMQP heartbeats for green pools.

## Connection loss and recovery

`Consumer.start()` runs the blueprint in a loop:

- Recoverable errors are the transport's connection errors (plus channel errors if `broker_channel_error_retry`). On such an error:
  - If retry is disabled (`broker_connection_retry`, or `broker_connection_retry_on_startup` for the first attempt), the worker shuts down (`WorkerShutdown(1)`).
  - `EMFILE` (too many open files) terminates the worker.
  - Otherwise the broken connection is collected and closed (with a socket timeout so cleanup cannot hang), `on_close()` clears reserved-but-not-active requests (their delivery tags are invalid on the new channel), clears rate-limit buckets and flushes the pool's outbound buffer, and the blueprint is **restarted**. A restart-frequency limiter (5 restarts per second) throttles tight loops.
- With `worker_cancel_long_running_tasks_on_connection_loss`, running `acks_late` tasks that were not yet acked are cancelled, since their messages will be redelivered anyway (a pending-deprecation warning says this will become the default).
- With `worker_enable_prefetch_count_reduction` (default), after reconnecting the prefetch count is temporarily reduced by the number of still-running tasks and restored step by step as tasks ack, avoiding over-fetching. This is skipped when per-consumer QoS (quorum queues) is in effect, because RabbitMQ would not apply later QoS updates to the running consumer.
- `ensure_connected` uses `broker_connection_max_retries` and logs each retry with backoff.

## Other consumer operations

- `add_task_queue` / `cancel_task_queue` — runtime queue changes (`add_consumer`/`cancel_consumer` control commands).
- `apply_eta_task` — called from the timer when an ETA task becomes due; decrements QoS and hands the request on.
- `cancel_active_requests` — used during connection-loss handling.

## Tests

- `t/unit/worker/test_consumer.py` — consumer start/restart, QoS, prefetch reduction/restoration, mingle, gossip, heart, agent, control steps.
- `t/unit/worker/test_loops.py`, `t/unit/test_loops.py` — asynloop/synloop behaviour.
- `t/unit/worker/test_native_delayed_delivery.py` — delayed delivery step.
- `t/integration/test_connection_recovery.py`, `t/smoke/tests/test_consumer.py`, `t/smoke/tests/failover/`.

## Related

- [Worker Architecture and Bootsteps](worker-architecture.md)
- [Task Request Lifecycle in the Worker](request-lifecycle.md)
- [Remote Control and Inspection](remote-control.md)
