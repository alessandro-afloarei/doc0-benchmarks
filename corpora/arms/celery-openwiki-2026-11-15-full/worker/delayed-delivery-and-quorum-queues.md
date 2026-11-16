---
type: subsystem
title: Native Delayed Delivery and Quorum Queues
description: How Celery supports RabbitMQ quorum queues — queue-type configuration, quorum-queue detection, disabling global QoS, the DelayedDelivery consumer bootstep that declares kombu's native delayed-delivery topology and binds application queues, and how send_task routes ETA/countdown tasks through the celery_delayed_27 exchange.
tags: [rabbitmq, quorum-queues, delayed-delivery, eta, qos]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T09:27:53.075Z
sources:
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-ac404435efa758dad4bbfc83
    resource: repo://celery/app/defaults.py
  - id: openwiki-source-f7c134e9626dda7914739959
    resource: repo://celery/utils/quorum_queues.py
  - id: openwiki-source-e05a13d8343387f57526f632
    resource: repo://celery/worker/consumer/delayed_delivery.py
  - id: openwiki-source-337ca17b51d3603b5a2c09ec
    resource: repo://celery/worker/consumer/tasks.py
generated: { by: "claude-code", at: "2026-11-15T09:27:53.075Z" }
---

# Native Delayed Delivery and Quorum Queues

RabbitMQ **quorum queues** are replicated and durable, but they differ from classic queues in ways that affect Celery: they don't support **global QoS** (prefetch shared across consumers on a channel), and holding many unacknowledged ETA tasks in a worker's memory is undesirable. Celery handles this with three cooperating pieces:

1. Quorum-queue **detection** (`celery/utils/quorum_queues.py`).
2. Worker-side **QoS adjustments** in the consumer's `Tasks` step.
3. **Native delayed delivery** — a worker bootstep that sets up broker-side delay exchanges (`celery/worker/consumer/delayed_delivery.py`) and client-side routing of delayed tasks in `Celery.send_task` (`celery/app/base.py`), both built on `kombu.transport.native_delayed_delivery`.

## Declaring quorum queues

- `task_default_queue_type = 'quorum'` (default `classic`) declares the default queue with `x-queue-type: quorum` (see [Message Publishing, Protocol and Routing](../messaging/publishing-and-routing.md#queues-and-exchanges)).
- `task_create_missing_queue_type = 'quorum'` does the same for auto-created queues.
- Explicit `kombu.Queue(..., queue_arguments={'x-queue-type': 'quorum'})` entries in `task_queues`.

## Detection

`detect_quorum_queues(app, driver_type) -> (bool, first_queue_name)` returns true only when the transport `driver_type` is `'amqp'` (RabbitMQ) **and** any queue in `app.amqp.queues` has `queue_arguments['x-queue-type'] == 'quorum'`. Redis and other transports always return `(False, "")`.

## QoS on quorum queues

In the consumer's `Tasks` step (see [Worker Consumer](consumer.md#task-consumer-and-qos-tasks-step)), when `worker_detect_quorum_queues` (default `True`) finds quorum queues, `qos_global` is forced to `False` and the worker logs "Global QoS is disabled. Prefetch count in now static." Consequences:

- Prefetch is applied per consumer, so dynamic prefetch changes (e.g. `qos.increment_eventually()` for ETA tasks) don't reach the broker the way they do with global QoS.
- Prefetch reduction after reconnects is skipped (`qos_global is False`).

This is why ETA tasks on quorum queues should go through native delayed delivery instead of being held in the worker.

## Worker side: the `DelayedDelivery` bootstep

`DelayedDelivery` is a consumer `StartStopStep` that `requires` the `Tasks` step and is **included only when quorum queues are detected** on the write connection's transport.

On `start()`:

1. Validates configuration: `broker_url` must be non-empty (a `;`-separated string or a list of strings), and `broker_native_delayed_delivery_queue_type` (default `quorum`) must be `classic` or `quorum`. Invalid configuration is logged as critical and raises `ValueError`, aborting consumer startup.
2. For **each broker URL** (failover URLs included) runs `_setup_delayed_delivery` under `retry_over_time` (retrying `ConnectionRefusedError`/`OSError`, `MAX_RETRIES = 3`, starting at 1s):
   - `declare_native_delayed_delivery_exchanges_and_queues(connection, queue_type)` — kombu declares its delay exchanges and queues (the top-level exchange is the `celery_delayed_27` topic exchange that `send_task` publishes to). The exact topology lives in kombu, not in this repository.
   - `_bind_queues()` binds every application queue (skipping `Broadcast` queues) to the delivery exchange via `bind_queue_to_native_delayed_delivery_exchange`. Network errors are re-raised for retry; other per-queue errors are collected and raised together as an `ExceptionGroup`.
3. Failures for individual URLs are logged as warnings; if **all** URLs fail, a critical "Native delayed delivery will not be available" message is logged, but the worker keeps running.

## Client side: routing delayed tasks in `send_task`

After routing, when a task has an `eta` or `countdown`, `send_task` checks `detect_quorum_queues()` against the **producer pool's** transport:

- If the target exchange type is **not `direct`** (topic or fanout):
  - `eta` (datetime or ISO string) is converted to a countdown relative to `app.now()`.
  - For a positive countdown, the routing key becomes kombu's `calculate_routing_key(int(countdown), routing_key)` (the delay is encoded into the routing key) and the message is published to the `celery_delayed_27` **topic** exchange, with the `queue` option removed. The broker-side delay topology declared by the worker bootstep then delivers it to the original queue (bound in `_bind_queues`) once the delay has elapsed.
  - The ETA header is still set, so the worker sees an ETA that has already (or almost) passed and executes promptly.
- If the exchange is **`direct`**, a warning is logged ("Direct exchanges are not supported with native delayed delivery ... this task may block the worker process until the ETA arrives") and the message is published normally — the worker will hold it until the ETA.

Because the countdown is converted with `int()`, delays are whole seconds and sub-second fractions are truncated.

## Interactions and caveats

- Only RabbitMQ (`amqp` driver) participates; other brokers ignore all of this.
- All producers must run a Celery version with this logic, and workers must have started `DelayedDelivery` at least once to create the topology and bindings; otherwise delayed messages can be dropped by the broker as unroutable.
- Queues added at runtime (`add_consumer`) are not bound by the bootstep until the consumer restarts.
- Chord unlock routing on quorum queues is covered by smoke tests (`test_chord_unlock_routing.py`), since `celery.chord_unlock` retries use countdowns and are routed to the chord body's queue (`fallback_chord_unlock` in [Result Backends](../results/result-backends.md)).

## Related tests

- `t/unit/worker/test_native_delayed_delivery.py` — bootstep inclusion, validation, retries, binding errors.
- `t/smoke/tests/quorum_queues/` — `test_native_delayed_delivery.py`, `test_native_delayed_delivery_binding.py`, `test_qos.py`, `test_quorum_queues.py`, `test_default_queue_type.py`, `test_chord_unlock_routing.py`, `test_cycle_detection.py`.
