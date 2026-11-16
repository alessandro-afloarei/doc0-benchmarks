---
type: architecture
title: Events and Signals
description: The two observability channels in Celery - in-process signals that run hooks around publishing, task execution, and worker or beat lifecycle, and the broker-level event stream that workers publish for monitors, with its dispatcher, receiver, and cluster-state model.
tags: [celery, events, signals, monitoring, dispatcher, receiver, state, observability]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:42:35.525Z
sources:
  - id: openwiki-source-5a0b6982dd7ddb0fabfabd0c
    resource: repo://celery/app/amqp.py
  - id: openwiki-source-4a982797c89fcb3ea5c5d0ee
    resource: repo://celery/app/trace.py
  - id: openwiki-source-4be6cca2c9164c478933a960
    resource: repo://celery/events/dispatcher.py
  - id: openwiki-source-615baded4198a1e9794a8bb1
    resource: repo://celery/events/receiver.py
  - id: openwiki-source-2f1a7c2fcace441b360b3f19
    resource: repo://celery/events/state.py
  - id: openwiki-source-7ef2718c0e261f897e55c1de
    resource: repo://celery/utils/dispatch/signal.py
  - id: openwiki-source-dd622d1d70314bce53103492
    resource: repo://celery/worker/consumer/events.py
  - id: openwiki-source-5b05690e7e13e9bff2a56054
    resource: repo://celery/worker/strategy.py
generated: { by: "claude-code", at: "2026-11-16T10:42:35.525Z" }
---

# Events and Signals

Celery exposes two separate channels for observing what happens:

- **Signals** are in-process callbacks. They run synchronously inside the process that emits them (a client publishing a task, a worker executing it, a beat process starting). Application code and extensions connect receivers to them.
- **Events** are messages published to a broker exchange by workers (and optionally clients). Monitors such as Flower, `celery events`, and the `celery inspect`/`celery control` tooling consume them, so they see cluster-wide activity from outside the producing process.

The signal machinery lives in `celery/utils/dispatch/signal.py` with the named signals declared in `celery/signals.py`. The event machinery lives under `celery/events/` (dispatcher, receiver, state, snapshot, dumper), with `celery/app/events.py` wiring it into an app.

## Signals

### Dispatch semantics

`Signal` (`celery/utils/dispatch/signal.py`) is a Celery-specific, Django-like dispatcher. `Signal.send(sender, **named)` (around lines 258–290) walks the live receivers for that sender and calls each one with `signal`, `sender`, and the named arguments. The important property is that an exception raised by a receiver is logged and returned in the response list as `(receiver, exc)`; it is not re-raised, and other receivers still run. The source notes that `send` and `send_robust` behave the same in Celery, unlike Django.

`Signal.connect` accepts `sender`, `weak`, and `dispatch_uid`. Receivers are held weakly by default, so a receiver that is a short-lived closure can disappear unless the caller keeps a reference. `dispatch_uid` prevents double registration.

### Named signals

`celery/signals.py` declares the public set. The main groups are:

- **Client publishing**: `before_task_publish` and `after_task_publish` (declared around line 31 and 38), and `task_sent`. These are sent from the message-sending code in `celery/app/amqp.py` (around lines 491–496 and 559), so they fire on every `apply_async`, not only on the worker.
- **Task execution**: `task_received`, `task_prerun`, `task_postrun`, `task_success`, `task_retry`, `task_failure`, `task_internal_error`, `task_revoked`, `task_rejected`, and `task_unknown` (declared around lines 42–90). `task_prerun`, `task_postrun`, and `task_success` are sent from `celery/app/trace.py` (around lines 104–106). `task_retry` and `task_failure` are sent from the tracer and from `celery/worker/request.py` (for example around lines 564, 659, and 713).
- **Worker lifecycle**: `celeryd_init`, `worker_init`, `worker_process_init`, `worker_process_shutdown`, `worker_ready`, `worker_shutting_down`, `worker_shutdown`, and `heartbeat_sent` (around lines 97–115).
- **Beat**: `beat_init` and `beat_embedded_init` (around lines 138–139).
- **Logging and configuration**: `setup_logging`, `after_setup_logger`, `after_setup_task_logger`, and `user_preload_options`.
- **Pool-specific**: the `eventlet_pool_*` signals.

Signal senders in hot paths are cached as module-level aliases, such as `send_prerun = signals.task_prerun.send` in `trace.py`, which avoids repeated attribute lookups per task.

## Events

### Publishing: the dispatcher

`EventDispatcher` (`celery/events/dispatcher.py`, class at line 19) turns a call such as `send('task-received', ...)` into a published message on the events exchange. Its behaviour:

- `send` (around line 164) builds an `Event` with the hostname, UTC offset, pid, and a logical clock, and either buffers it or calls `publish` immediately. Events in a group listed in `buffer_group` are collected in `_group_buffer` and flushed when the buffer reaches `buffer_limit` or on `flush()`.
- `groups` restricts which event groups are published at all; an event whose group is not enabled is dropped before any work is done.
- `publish` (around line 116) serializes the event with the configured `event_serializer` and sends it through the producer. The `retry` and `retry_policy` arguments control connection recovery.
- `enabled` turns the whole dispatcher into a no-op, which is how the worker avoids event overhead when events are off.

Events are grouped by the prefix of their type name (`task-*`, `worker-*`). `celery/events/event.py` provides `Event` (line 18), `group_from` (line 33), and `get_exchange` (line 46), so the exchange name and group parsing are defined in one place.

### Worker emission

The worker creates its dispatcher in the events bootstep (`celery/worker/consumer/events.py`, around lines 26–46). The dispatcher is attached to the consumer as `event_dispatcher`, and it is torn down on shutdown (around lines 58–67). The request strategy in `celery/worker/strategy.py` checks whether events are enabled and whether the task sends events (`task.send_events`) before calling `send_event('task-received', ...)` (around lines 113–117 and 168–169). Subsequent task events, such as `task-started` and `task-succeeded`, follow the same path from the request object.

Clients also emit `task-sent` when `send_task_message` runs with event sending enabled (`celery/app/amqp.py`, around lines 594–603), and the `Events` class in `celery/app/events.py` builds dispatchers, receivers, and state objects configured for the app.

### Consuming: the receiver and state

`EventReceiver` (`celery/events/receiver.py`, class at line 23) is a kombu `ConsumerMixin` bound to the events exchange. It dispatches each message to handlers by event type, and `capture` and `itercapture` offer a bounded, blocking way to collect events for scripts and CLI tools. `event_from_message` (around line 113) converts a message body into an event dictionary, optionally localizing timestamps.

`State` (`celery/events/state.py`, class at line 398) is the cluster model that monitors build from events. It keeps `Worker` objects (line 149) and `Task` objects (line 243) keyed by hostname and task UUID, tracks parent and child relationships for canvas workflows, and uses `freeze_while` to batch updates. `clear_tasks` removes finished tasks to bound memory, and `Polaroid` in `celery/events/snapshot.py` (line 24) periodically captures the state for persistence.

`celery/events/dumper.py` contains `Dumper` (line 36) and `evdump` (line 79), a simple consumer that prints events. The `celery events --dump` option (`celery/bin/events.py`) runs it.

## How the two channels relate

Signals and events report overlapping facts at different layers. A signal is called in the process that does the work and can change behaviour (for example, a `before_task_publish` receiver can modify headers). An event is a published notification for external observers and cannot affect execution. Because `Signal.send` contains receiver exceptions, a failing signal receiver does not by itself abort the task or the surrounding code path that sent the signal.

## Invariants and failure behaviour

- A failing signal receiver is logged and does not stop other receivers or the task. Code that relies on a receiver's side effects must not assume it ran.
- Disabled dispatchers and disabled groups are skipped before serialization, so turning off events removes their cost.
- Event state is best-effort: messages can be lost, and the `State` object is rebuilt from new events rather than from a durable store unless a snapshot is restored.

## Extension seams

- Connect receivers to any named signal, using `dispatch_uid` to avoid duplicate registration.
- Define new named signals in your own module with `Signal(name=...)`.
- Handlers for `EventReceiver` can be supplied per event type; `State` can be extended with custom callbacks.

## Representative tests

Signal and dispatcher behaviour is covered under `t/unit/utils/` and `t/unit/events/`. Worker event emission is exercised in `t/unit/worker/` and end-to-end by `t/integration/test_inspect.py`.
