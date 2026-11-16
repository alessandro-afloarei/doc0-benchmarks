---
type: architecture
title: Worker
description: How the Celery worker is assembled from bootstep blueprints, how its consumer receives messages and hands them to the pool through Request objects, how the event loop, heartbeat, autoscaler, and remote-control (pidbox) channels run, and how acknowledgement and shutdown behave.
tags: [celery, worker, consumer, bootstep, request, pidbox, autoscale, heartbeat, control]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:42:35.525Z
sources:
  - id: openwiki-source-3cfd5f9bf00aaf6b49d01291
    resource: repo://celery/apps/worker.py
  - id: openwiki-source-94b60a38fd26082deb41f979
    resource: repo://celery/worker/consumer/consumer.py
  - id: openwiki-source-448ad2fc321c5e1d8e0a93fc
    resource: repo://celery/worker/consumer/control.py
  - id: openwiki-source-1a5a653f1e0dc794a3d6d553
    resource: repo://celery/worker/loops.py
  - id: openwiki-source-4ee29959ac62b2a32bb988a9
    resource: repo://celery/worker/pidbox.py
  - id: openwiki-source-328c66e40eb163230ad26cbc
    resource: repo://celery/worker/request.py
  - id: openwiki-source-7a844ae59c546297a34da340
    resource: repo://celery/worker/state.py
  - id: openwiki-source-12d3bd623a53e489a785c641
    resource: repo://celery/worker/worker.py
generated: { by: "claude-code", at: "2026-11-16T10:42:35.525Z" }
---

# Worker

The worker is the process that consumes task messages, decides whether each one may run, and dispatches it to an execution pool ([concurrency pools](concurrency.md)). Its code is in `celery/worker/`. The outer shell is `WorkController` (`celery/worker/worker.py`), which is itself a *blueprint* of bootsteps. The consumer is a second blueprint nested inside one of those steps. Each bootstep is a small object with `create`, `start`, and `stop` hooks, so features such as heartbeat, gossip, and autoscaling can be added or removed without touching the rest.

## Responsibility and ownership

The worker owns:

- starting the broker connection and the message consumer;
- turning each message into a `Request` and deciding when it is run, acknowledged, or rejected;
- keeping the pool fed up to its concurrency limit, and scaling it when autoscaling is enabled;
- sending heartbeats and worker events, and answering remote-control commands;
- persisting revoked-task state across restarts (`celery/worker/state.py`).

It does not execute task code. That is the pool's job.

## Bootstep blueprints

`WorkController` (`celery/worker/worker.py`, class at line 63) sets its default steps at lines 80–88: `Hub`, `Pool`, `Beat`, `Timer`, `StateDB`, `Consumer`, and the autoscaler component. `setup_instance` (around line 101) builds the blueprint from `app.steps['worker']` and applies it. `start` (around line 201) runs the blueprint's `start`, and `stop` tears it down in reverse.

The `Consumer` step (`celery/worker/components.py`, around line 221) starts the consumer blueprint, whose default steps are, in order, `Connection`, `Mingle`, `Events`, `Gossip`, `Heart`, `Control`, `Tasks`, `DelayedDelivery`, `Evloop`, and `Agent` (`celery/worker/consumer/consumer.py`, lines 175–185). `Mingle` synchronizes with other workers on start. `Gossip` exchanges membership and election messages. `Tasks` sets up the task queues and prefetch.

The pool step (`components.py`, around line 101) creates the concurrency pool with the configured concurrency, time limits, and restart policy (see [concurrency pools](concurrency.md)).

## The consumer and the event loop

`Consumer` (`celery/worker/consumer/consumer.py`, class at line 145) holds the broker connection and receives messages. It takes two kinds of work:

- **Task requests.** Each message is decoded and wrapped in a `Request` through the strategy (`celery/worker/strategy.py`, function `default` at line 99, and `task_message_handler` at line 132). The strategy checks for revocation and rate limits and for ETA or countdown tasks. ETA tasks are held until their time; rate-limited tasks go to a token bucket (`bucket_for_task`, `_limit_task`, around lines 296–361).
- **Pending operations.** Work that must run on the loop thread (for example prefetch updates) is queued with `call_soon` and performed in `perform_pending_operations` (lines 257–295).

The loop itself is in `celery/worker/loops.py`. `asynloop` (line 50) drives an event-loop hub for the asynchronous pool, and `synloop` (line 133) is the blocking variant used by pools that do not need the hub. On connection loss, the loop resets the hub so timers can be re-registered when the consumer reconnects.

## Requests

A `Request` (`celery/worker/request.py`, class at line 67) represents one delivered message from receipt to completion. Its key methods are:

- `execute_using_pool` (line 341) sends the request to the pool and handles a revoked task by not executing it;
- `on_accepted` (line 515), `on_timeout` (line 529), `on_success` (line 596), `on_retry` (line 613), and `on_failure` (line 622) are the completion callbacks the pool and tracer invoke;
- `acknowledge` (line 730) acknowledges the message once, and `reject` (line 736) rejects or requeues it and sends a `task-rejected` event.

Whether acknowledgement happens before or after execution is controlled by the task's `acks_late` and related options (see [tasks and tracing](tasks-and-tracing.md)). The `Request` ensures acknowledgement or rejection happens at most once, using the `acknowledged` flag.

## Heartbeat

`Heart` (`celery/worker/heartbeat.py`, class at line 14) sends periodic `worker-heartbeat` events through the event dispatcher at a configured interval (`start` at line 49). The consumer-side step `Heart` (`celery/worker/consumer/heart.py`, line 10) wires it into the consumer lifecycle. Monitors use these heartbeats to decide whether a worker is alive.

## Autoscaling

`WorkerComponent` (`celery/worker/autoscale.py`, line 31) adds the autoscaler to the worker. `Autoscaler` (line 61) is a background thread that calls `maybe_scale`. `scale_up` and `scale_down` (lines 111–118) grow or shrink the pool through the pool's `grow` and `shrink` methods, within the configured min and max, and `_update_consumer_prefetch_count` (line 133) keeps the prefetch count in step with the new concurrency.

## Remote control: pidbox and control commands

The control channel is a broadcast mailbox, implemented by `Pidbox` (`celery/worker/pidbox.py`, class at line 20). `on_message` (line 39) passes each control message to the node's `handle_message`. An unknown command is logged, and an unexpected error is logged and causes the mailbox to reset. `gPidbox` (line 83) is the variant for the green pools.

The command handlers are in `celery/worker/control.py`. Commands are registered with the `inspect_command` and `control_command` decorators (there are 32 registrations in that module). Inspect commands report state (for example stats, registered tasks, active and reserved requests), and control commands change it (revoke, rate limit, shutdown, pool grow or shrink, and similar). These are the commands behind `celery inspect` and `celery control` (see [command-line interface](../operations/cli.md)).

## Revocation state

`celery/worker/state.py` holds the in-memory worker state (reserved and active requests, revoked task IDs, and the total count). `Persistent` (line 192) saves revoked IDs and the logical clock to a shelve file so a restarted worker still refuses revoked tasks. The state file name comes from the worker configuration.

## Shutdown

Stopping the worker runs through `WorkController.stop` (line 244), which closes the consumer so no new requests are fetched, then lets the pool drain. The signal mapping is in `celery/apps/worker.py`: `_shutdown_handler` (around line 288) installs warm and cold handlers, with SIGTERM producing a warm shutdown that waits for running requests. SIGINT and SIGQUIT start a cold shutdown (`on_cold_shutdown`) and, on a second signal, a hard shutdown (`on_hard_shutdown`) that installs the hard handler and stops without waiting for in-flight work.

## Invariants and failure behaviour

- A message is acknowledged or rejected exactly once, guarded by `Request.acknowledged`.
- Revoked tasks are checked before execution, so a revocation received before the task starts prevents it from running, and the revocation survives a restart through `Persistent`.
- A connection loss resets the event loop and re-registers timers during the blueprint restart; in-flight work continues on the pool.
- A bad control message is logged and the mailbox is reset; it does not stop the worker.

## Extension seams

- Add a bootstep to `app.steps['worker']` or the consumer blueprint to add a long-lived component with its own start and stop hooks.
- Register new remote commands with `inspect_command` or `control_command` in `celery/worker/control.py` (or a module it imports).
- Custom request strategies replace the default message handler for specific task types.

## Representative tests

`t/unit/worker/` contains tests for the worker, consumer, requests, control, state, heartbeat, and autoscaler. `t/integration/test_worker.py`, `t/integration/test_inspect.py`, and `t/integration/test_connection_recovery.py` run the worker against a real broker.
