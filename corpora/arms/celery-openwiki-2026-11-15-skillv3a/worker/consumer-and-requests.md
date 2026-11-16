---
type: subsystem
title: Consumer, Strategies and Task Requests
description: How a Celery worker receives task messages and turns them into executions. Covers the Consumer blueprint and its bootsteps (Connection, Mingle, Events, Gossip, Heart, Control, Tasks, DelayedDelivery, Evloop, Agent), prefetch/QoS, connection loss and recovery, the async and sync event loops, the per-task strategy (decoding, revocation, ETA, rate limits), and the Request object's acknowledgement, timeout, and failure semantics.
tags: [worker, consumer, qos, prefetch, request, acks, eta, rate-limit]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:49.645Z
sources:
  - id: openwiki-source-cd5b25b412e425989370ceb9
    resource: repo://celery/worker/components.py
  - id: openwiki-source-94b60a38fd26082deb41f979
    resource: repo://celery/worker/consumer/consumer.py
  - id: openwiki-source-63a383ca50663d5c1b07b920
    resource: repo://celery/worker/consumer/mingle.py
  - id: openwiki-source-337ca17b51d3603b5a2c09ec
    resource: repo://celery/worker/consumer/tasks.py
  - id: openwiki-source-1a5a653f1e0dc794a3d6d553
    resource: repo://celery/worker/loops.py
  - id: openwiki-source-328c66e40eb163230ad26cbc
    resource: repo://celery/worker/request.py
  - id: openwiki-source-5b05690e7e13e9bff2a56054
    resource: repo://celery/worker/strategy.py
generated: { by: "claude-code", at: "2026-11-15T17:08:49.645Z" }
---

# Consumer, Strategies and Task Requests

The **Consumer** (`celery/worker/consumer/consumer.py`) is the worker component that talks to the broker. It is created by the worker's `Consumer` bootstep (see [Worker Architecture](worker-architecture.md)). It owns the broker connection, the task consumer, QoS, the per-task strategies, rate-limit buckets, and the event loop, and it hands accepted requests to `WorkController._process_task` → the [pool](concurrency-pools.md).

## Consumer blueprint

`Consumer.Blueprint.default_steps`, ordered by their `requires` dependencies:

| Step | Responsibility |
|---|---|
| `Connection` | Opens the read connection (`connection_for_read` with AMQP heartbeat) and registers it with the hub. |
| `Mingle` | At start or restart, sends `hello` to other workers (1 second timeout), merges their **revoked task IDs** and adjusts the Lamport clock. Only on amqp, redis, and gcpubsub transports. Disable with `--without-mingle`. |
| `Events` | Creates the event dispatcher (see [Events](../operations/events-monitoring.md)). |
| `Gossip` | Consumes other workers' events to track membership (`on_node_join`, `on_node_leave`, `on_node_lost`) and to run **elections** (`Signature.election`). Only on amqp and redis. Disable with `--without-gossip`. |
| `Heart` | Sends `worker-heartbeat` events. Disable with `--without-heartbeat`. |
| `Control` | Pidbox remote-control consumer (see [Remote Control](remote-control.md)). |
| `Tasks` | Sets initial QoS, creates the task consumer from `app.amqp.TaskConsumer` (queues = `consume_from`), and builds the `QoS` object. |
| `DelayedDelivery` | Native delayed delivery setup for quorum queues (see [Messaging](../tasks/messaging-and-routing.md#native-delayed-delivery-rabbitmq-quorum-queues)). |
| `Evloop` | The last step. Runs `consumer.loop(*loop_args())`, which is `asynloop` with a hub and `synloop` otherwise. |
| `Agent` | Optional cell actor agent (`worker_agent`). |

User steps from `app.steps['consumer']` are added to the blueprint.

## Prefetch and QoS

- The initial prefetch count is `concurrency × worker_prefetch_multiplier` (default multiplier 4). With autoscaling it is `max(max_concurrency, 1) × multiplier`. It is applied with `basic_qos`, and adjusted later through `QoS.increment_eventually` and `decrement_eventually` (for ETA tasks, autoscaling, and connection restarts).
- **Global versus per-consumer QoS.** Global QoS is used when RabbitMQ's QoS semantics differ from the spec. It is turned **off** when quorum queues are detected and `worker_detect_quorum_queues` is set, because quorum queues do not support global QoS. In that case the prefetch count is effectively static.
- `worker_eta_task_limit` caps how far the prefetch count can grow while holding ETA tasks (`QoS(max_prefetch=...)`).
- `worker_disable_prefetch` (Redis only) patches the channel's `can_consume` so the worker never reserves more messages than it has free slots (`max_concurrency` or pool size).
- In `asynloop`, QoS updates are applied only when no messages are waiting to be read. This batches the updates and lets control messages take priority.

## Event loops (`worker/loops.py`)

- **`asynloop`** is used with the prefork or solo pool on async-capable transports (AMQP, Redis), and not on Windows. It sets `consumer.on_message` to the task handler, registers the worker components and consumer steps with the kombu `Hub`, starts consuming, checks that the pool started (`did_start_ok`, otherwise `WorkerLostError`), and then iterates the hub. It also polls `state.maybe_shutdown()` and raises AMQP heartbeat errors. On an exception it resets the hub and clears its timers, so stale callbacks from the dead connection don't fire after reconnect.
- **`synloop`** is used with green pools, the threads pool, or a transport without async support. It runs a blocking `drain_events(timeout=2.0)` loop.

## Connection loss and recovery

`Consumer.start()` loops `blueprint.start()`. Recoverable errors are connection errors, plus channel errors when `broker_channel_error_retry` is set.

1. If retrying is disabled (`broker_connection_retry_on_startup` for the first connection, `broker_connection_retry` afterwards), it logs a critical message and raises `WorkerShutdown(1)`. `EMFILE` (too many open files) raises `WorkerTerminate(1)`.
2. After a lost connection it collects the broken connection with a bounded socket timeout, then:
   - if `worker_cancel_long_running_tasks_on_connection_loss` is set, cancels running **late-ack** tasks that haven't been acked yet, since their messages will be redelivered anyway. Otherwise it emits a pending-deprecation warning;
   - if `worker_enable_prefetch_count_reduction` is set, temporarily reduces the prefetch count by `active × multiplier` so the worker doesn't over-fetch while old tasks finish. The count is restored step by step as acks happen. This is skipped under per-consumer QoS, where updates would not reach the running consumer (#9512).
3. `on_close()` drops reserved-but-not-active requests, because their delivery tags belong to the dead channel. It also clears semaphores and bucket queues and flushes the pool. Then the blueprint restarts. Restarts are throttled (`restart_state(maxR=5, maxT=1)`).

## From message to request (`worker/strategy.py`)

`update_strategies()` builds one handler per registered task (`task.start_strategy` → `strategy.default`). `create_task_handler()` looks up the strategy by the `task` header:

- **Unknown task:** logs an error, rejects the message, and stores `NotRegistered` as the task failure.
- **Malformed or disallowed content** (`InvalidTaskError`, `ContentDisallowed`): rejects the message and sends `task_rejected`. Undecodable bodies are **acked** (`on_decode_error`) so they don't loop forever.

`strategy.default`'s `task_message_handler`:

1. converts protocol 1 and hybrid messages to protocol v2 and builds a `Request` subclass specialized for the task and pool (`create_request_cls`);
2. logs "Received task", and **discards revoked or expired** tasks immediately (`req.revoked()` checks the revoked-ID `LimitedSet`, `expires`, and revoked stamped headers);
3. sends the `task_received` signal and the `task-received` event;
4. **ETA/countdown:** converts the ETA to a timestamp. On overflow it rejects the message without requeue. Otherwise it **increments QoS**, so the held message doesn't block prefetch, and schedules `apply_eta_task` (or the rate-limited variant) on the worker timer. The message stays unacked in worker memory until the ETA. This is why long ETAs on brokers with visibility timeouts (Redis, SQS) can cause redelivery;
5. **rate limit:** if the task has a `rate_limit` and limits are enabled, the request goes through a `TokenBucket`. Requests that can't be served now are rescheduled on the timer at `bucket.expected_time`, keeping their order;
6. otherwise `task_reserved(req)` → `on_task_request(req)` → the pool. With prefork and the event loop, this goes through the pool semaphore.

## The `Request` (`worker/request.py`)

A `Request` wraps the message plus decoded metadata. Its pool callbacks drive acknowledgement:

| Callback | Behaviour |
|---|---|
| `execute_using_pool` | Raises `TaskRevokedError` if revoked, and submits `trace_task_ret`/`fast_trace_task` with soft and hard time limits (request header values first, then task attributes). |
| `on_accepted(pid)` | Marks the request active. **Acks now unless `acks_late`.** Sends `task-started`. Applies a pending terminate. |
| `on_success` | For late acks, acks after success. Sends `task-succeeded`. If the trace reports failure, it is handed to `on_failure`. |
| `on_retry` | Acks when late, and sends `task-retried`. |
| `on_timeout(soft)` | Soft: warning only, because the task sees `SoftTimeLimitExceeded`. Hard: marks `TimeLimitExceeded` as the failure, calls `on_failure` and `after_return` hooks, sends `task_failure` and `task-failed`, then with late acks either **acks** (`acks_on_timeout`) or **rejects with requeue**. |
| `on_failure(exc)` | `Terminated` → announce revoked. `Reject` → store failure unless requeueing, then `reject(requeue)`. `Ignore` → ack. `Retry` → `on_retry`. Otherwise, with late acks: requeue if (`reject_on_worker_lost` and `WorkerLostError`) or (timeout and not `acks_on_timeout`); else ack if `acks_on_failure`; else reject without requeue. Stores the failure, for example for `WorkerLostError`, unless it was requeued. |

`acknowledge()` and `reject()` are idempotent, guarded by `acknowledged`. `terminate(pool, signal)` and `cancel()` kill or cancel the pool job. If the job hasn't been accepted yet, termination is deferred until `on_accepted`. Worker-global bookkeeping (`reserved_requests`, `active_requests`, `revoked`, `successful_requests`, counts) lives in `worker/state.py`.

## Tests

- `t/unit/worker/`: `test_consumer.py`, `test_loops.py`, `test_strategy.py`, `test_request.py` (ack and reject matrix, timeouts), `test_revoke.py`, `test_native_delayed_delivery.py`.
- `t/integration/test_connection_recovery.py`.
- `t/smoke/tests/test_consumer.py` (prefetch and connection behaviour).

## See also

- [Worker Architecture and Bootsteps](worker-architecture.md)
- [Task Execution Tracing](../tasks/execution-tracing.md)
- [Task Messages, Protocol and Routing](../tasks/messaging-and-routing.md)
