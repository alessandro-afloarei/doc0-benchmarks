---
type: architecture
title: Worker Consumer and Event Loop
description: The worker's Consumer — its bootstep blueprint (Connection, Mingle, Events, Gossip, Heart, Control, Tasks, DelayedDelivery, Evloop, Agent), broker connection retry and recovery, prefetch/QoS management and reduction after reconnects, the asynloop/synloop event loops, message dispatch to task strategies, rate-limit buckets and unknown/invalid message handling.
tags: [worker, consumer, event-loop, prefetch, qos, connection-recovery]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T09:27:53.075Z
sources:
  - id: openwiki-source-94b60a38fd26082deb41f979
    resource: repo://celery/worker/consumer/consumer.py
  - id: openwiki-source-6c95d18e974f6856ea8444ee
    resource: repo://celery/worker/consumer/gossip.py
  - id: openwiki-source-63a383ca50663d5c1b07b920
    resource: repo://celery/worker/consumer/mingle.py
  - id: openwiki-source-337ca17b51d3603b5a2c09ec
    resource: repo://celery/worker/consumer/tasks.py
  - id: openwiki-source-1a5a653f1e0dc794a3d6d553
    resource: repo://celery/worker/loops.py
generated: { by: "claude-code", at: "2026-11-15T09:27:53.075Z" }
---

# Worker Consumer and Event Loop

`celery/worker/consumer/consumer.py:Consumer` owns the worker's broker connection and turns incoming messages into requests. It is created by the worker's last bootstep (see [Worker Bootsteps and WorkController](bootsteps-and-workcontroller.md)) with `on_task_request = WorkController.process_task` and an initial prefetch count. Like the worker, it is a `Blueprint` of steps, extendable through `app.steps['consumer']`.

## Consumer blueprint

| Step | Requires | Role |
| --- | --- | --- |
| `Connection` | — | `c.connection = c.connect()`: opens the read connection (with AMQP heartbeat when the hub or a green pool is used), registers the transport with the hub, and retries per `ensure_connected` |
| `Events` | Connection | Creates the `EventDispatcher` (see [Events and Monitoring](../events/monitoring-events.md)) |
| `Mingle` | Events | On (re)start, broadcasts `hello` via remote control (1s timeout) to other workers and merges their **revoked ids** and **logical clock**. Only on `amqp`, `redis`, `gcpubsub`; disabled with `--without-mingle` |
| `Gossip` | Mingle | `ConsumerStep` consuming `worker.#` events from other workers into a small `State`: tracks node join/leave/lost (missed heartbeats, checked every 5s) and implements simple leader **election** (`worker-elect`) used by `Signature.election()`. Only on `amqp`/`redis`; disabled with `--without-gossip` |
| `Heart` | Events | Starts `celery.worker.heartbeat.Heart` (worker-online/heartbeat/offline events); disabled with `--without-heartbeat` |
| `Control` | Tasks | Remote-control mailbox consumer ([Remote Control](remote-control.md)) |
| `Tasks` | Mingle | Starts the task consumer and QoS (below) |
| `DelayedDelivery` | Tasks | RabbitMQ native delayed delivery setup ([Delayed Delivery](delayed-delivery-and-quorum-queues.md)) |
| `Evloop` | `last=True` | Runs `c.loop(*c.loop_args())` — blocks until shutdown |
| `Agent` | Connection | Optional `cell` actor agent (`worker_agent`) |

## Start loop and connection recovery

`Consumer.start()` loops while the blueprint is not stopping:

1. `maybe_shutdown()`; restarts are rate-limited by `restart_state(maxR=5, maxT=1)` ("Frequent restarts detected" → sleep 1s).
2. `blueprint.start(self)` — which ends in the blocking event loop.
3. On a **recoverable error** (connection errors, plus channel errors if `broker_channel_error_retry`):
   - If retry is disabled (`broker_connection_retry_on_startup` for the first connection, `broker_connection_retry` afterwards) → `WorkerShutdown(1)`.
   - `EMFILE` (too many open files) → `WorkerTerminate(1)`.
   - Otherwise log, run `on_connection_error_after_connected` (close the broken connection; with `worker_cancel_long_running_tasks_on_connection_loss` cancel unacknowledged `acks_late` tasks, since their messages will be redelivered — a pending-deprecation warning is emitted when this is off), `on_close()` (clear the semaphore and rate-limit buckets, drop reserved-but-not-active requests, flush the pool) and `blueprint.restart()` — then loop to restart all steps on a fresh connection.

`ensure_connected()` uses kombu's `ensure_connection` with `broker_connection_max_retries`, logging each attempt (and failover to alternate URLs), calling `maybe_shutdown` between attempts so a shutdown signal interrupts reconnecting.

### Prefetch reduction after reconnect

With `worker_enable_prefetch_count_reduction` (default on), after a connection loss the initial prefetch is temporarily reduced to `max(prefetch_multiplier, max_prefetch - active_tasks × prefetch_multiplier)` so the worker doesn't over-fetch while old tasks are still running. Each subsequent ack/reject raises it by `prefetch_multiplier` until `max_prefetch_count = pool.num_processes × prefetch_multiplier` is restored. This is skipped when per-consumer QoS (`qos_global=False`, e.g. quorum queues) is in effect, since broker-side updates wouldn't reach the running consumer.

## Task consumer and QoS (`Tasks` step)

`Tasks.start()`:

1. `update_strategies()` — builds `strategies[name] = task.start_strategy(app, consumer)` and a tracer for **every registered task**.
2. Determines `qos_global`: `not connection.qos_semantics_matches_spec` (global for RabbitMQ), but forced `False` when `worker_detect_quorum_queues` finds quorum queues (RabbitMQ doesn't support global QoS on them).
3. `basic_qos(0, initial_prefetch_count, qos_global)` and creates `app.amqp.TaskConsumer` over the selected queues (`accept_content`, `on_decode_error`).
4. Wraps prefetch in a kombu `QoS` object with `max_prefetch = worker_eta_task_limit`; ETA tasks call `qos.increment_eventually()` so the worker can keep receiving while holding them, and `decrement_eventually()` when they're moved to the pool. Pending changes are applied by the loop (`qos.update()` when `qos.prev != qos.value`).
5. `worker_disable_prefetch` (Redis only; ignored with a warning elsewhere) patches the channel's `can_consume` so no new message is fetched while reserved requests ≥ concurrency.

## Event loops (`celery/worker/loops.py`)

- **`asynloop`** (transport supports async I/O, kombu `Hub`): installs `on_task_received` as the consumer callback, registers the worker/pool/consumer steps with the hub, starts consuming, calls `on_ready()` (the worker's ready callback — `app.Worker.on_consumer_ready` sends `worker_ready`), raises `WorkerLostError` if pool processes failed to start, and then iterates the hub loop — checking `maybe_shutdown()`, AMQP heartbeat errors and QoS updates each turn. On error it resets the hub and clears its timer before re-raising (so recovery starts clean).
- **`synloop`** (other transports, and green pools): `drain_events(timeout=2.0)` in a loop, running deferred operations (`perform_pending_operations`) between iterations. AMQP heartbeats are checked by a timer only for green pools.
- AMQP heartbeats (`broker_heartbeat`, check rate `broker_heartbeat_checkrate`) are enabled only when negotiated and supported by the connection.

`call_soon()` schedules callbacks on the hub (or the pending-operations list in synloop). `call_soon_ack()` executes ack/reject immediately in synloop to avoid adding latency between tasks with `acks_late` and low prefetch.

## Message dispatch

`create_task_handler()` returns `on_task_received(message)`:

- Gets the task name from the `task` header (protocol v2) or decodes the body (v1). Messages without either → `on_unknown_message`: logged, **rejected**, `task_rejected` signal.
- Looks up `strategies[name]`:
  - Unknown name → `on_unknown_task`: logs an error, rejects the message, stores `NotRegistered` as a failure in the result backend, sends a `task-failed` event and the `task_unknown` signal.
  - `InvalidTaskError` / `ContentDisallowed` → `on_invalid_task`: logged, rejected, `task_rejected` signal.
  - Decode errors → `on_decode_error`: logged critically and **acked** (to avoid redelivery loops).
- Calls the strategy with ack/reject **promises** routed through `call_soon_ack` (and, during prefetch restoration, chained to `_restore_prefetch_count_after_connection_restart`). The strategy creates the `Request` — see [Task Execution](task-execution.md).

### Rate limits and ETA

- `task_buckets[name]` holds a `TokenBucket(rate_limit, capacity=1)` per task with a `rate_limit` (unless `worker_disable_rate_limits`); `reset_rate_limits()` rebuilds them (also via the `rate_limit` control command).
- `_limit_task` / `_schedule_bucket_request` enqueue requests in the bucket and use the timer to move them to the pool when tokens are available.
- ETA/countdown requests are held on the timer and later passed to `apply_eta_task` (reserve + `on_task_request` + `qos.decrement_eventually()`).

### Queues at runtime

`add_task_queue()` / `cancel_task_queue()` back the `add_consumer` / `cancel_consumer` control commands, adding the queue to `app.amqp.queues` (`select_add`) and consuming from / cancelling it on the live task consumer.

### Shutdown helpers

`cancel_active_requests()` (used on cold shutdown and connection loss) cancels active requests that are not `acks_late`, or `acks_late` ones not yet acknowledged and not already successful; for non-`acks_late` tasks the cancellation is announced as a retry (`backend.mark_as_retry` + `task.on_retry`), while unacknowledged `acks_late` tasks are cancelled silently because their messages will be redelivered.

## Related tests

`t/unit/worker/test_consumer.py`, `t/unit/worker/test_loops.py`, `t/unit/test_loops.py`, `t/integration/test_connection_recovery.py`, `t/smoke/tests/test_consumer.py`, `t/smoke/tests/failover/test_broker_failover.py`.
