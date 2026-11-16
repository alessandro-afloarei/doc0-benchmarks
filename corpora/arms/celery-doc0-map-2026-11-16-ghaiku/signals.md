---
title: "Signals"
---
## Overview

Signals are the hooks Celery sends at fixed points in the lifetime of a task, the worker and beat. Each one is a `Signal` object defined in `celery/signals.py`; code connects a receiver to it, and Celery calls every receiver with the sender and keyword arguments. This page lists the signals by the part that sends them and gives the send site, so that a receiver can be placed knowingly. The flows the signals fire in are described in [[Task Execution]] and [[Worker Startup]].

Sources: [celery/signals.py:1-30](repo://celery/signals.py#L1-L30)

Sources: [celery/utils/dispatch/signal.py:73-90](repo://celery/utils/dispatch/signal.py#L73-L90)

## The signal object

`Signal.connect` registers a receiver, and `disconnect` removes it. `Signal.send` calls each connected receiver with the sender and the keyword arguments. An exception raised by a receiver is not raised to the sender: `send` returns it as that receiver's response, so one receiver cannot stop the task.

Sources: [celery/utils/dispatch/signal.py:110-125](repo://celery/utils/dispatch/signal.py#L110-L125)

Sources: [celery/utils/dispatch/signal.py:218-230](repo://celery/utils/dispatch/signal.py#L218-L230)

Sources: [celery/utils/dispatch/signal.py:258-272](repo://celery/utils/dispatch/signal.py#L258-L272)

## Task signals

The task group covers the publish side and the run side. `before_task_publish` and `after_task_publish` surround the send of a message, and `task_sent` follows it; `task_received`, `task_prerun`, `task_postrun`, `task_success`, `task_retry`, `task_failure`, `task_revoked`, `task_rejected` and `task_unknown` cover the worker.

Sources: [celery/signals.py:30-95](repo://celery/signals.py#L30-L95)

The send sites for the publish signals are in the AMQP sender, which takes the send function of each signal before the publish.

Sources: [celery/app/amqp.py:491-496](repo://celery/app/amqp.py#L491-L496)

`task_received` is sent by the default strategy once a message has been turned into a request, before the request is checked for an ETA or a rate limit.

Sources: [celery/worker/strategy.py:160-166](repo://celery/worker/strategy.py#L160-L166)

`task_prerun`, `task_postrun` and `task_success` are sent from the trace. `task_prerun` runs before the body, `task_success` after it returns, and `task_postrun` in the `finally` block whatever the outcome.

Sources: [celery/app/trace.py:104-106](repo://celery/app/trace.py#L104-L106)

Sources: [celery/app/trace.py:552-570](repo://celery/app/trace.py#L552-L570)

Sources: [celery/app/trace.py:635-640](repo://celery/app/trace.py#L635-L640)

`task_retry` and `task_failure` are sent by the failure handlers in the trace. `Request` sends `task_failure` from its own failure handlers, and `task_revoked` through the `send_revoked` alias.

Sources: [celery/app/trace.py:212-241](repo://celery/app/trace.py#L212-L241)

Sources: [celery/app/trace.py:242-283](repo://celery/app/trace.py#L242-L283)

Sources: [celery/worker/request.py:56-60](repo://celery/worker/request.py#L56-L60)

`task_internal_error` is sent when the trace itself fails rather than the task body.

Sources: [celery/app/trace.py:703-716](repo://celery/app/trace.py#L703-L716)

## Worker signals

The worker group covers start-up, readiness and shutdown. `celeryd_init` is sent from the `Worker` class during its set-up, `celeryd_after_setup` after the queues are set, `worker_init` when the controller is set up, `worker_ready` when the consumer is ready, and `worker_shutdown` at shutdown.

Sources: [celery/worker/worker.py:106-116](repo://celery/worker/worker.py#L106-L116)

Sources: [celery/apps/worker.py:100-102](repo://celery/apps/worker.py#L100-L102)

Sources: [celery/apps/worker.py:131-136](repo://celery/apps/worker.py#L131-L136)

Sources: [celery/worker/worker.py:125-128](repo://celery/worker/worker.py#L125-L128)

Sources: [celery/apps/worker.py:179-183](repo://celery/apps/worker.py#L179-L183)

Sources: [celery/worker/worker.py:197-200](repo://celery/worker/worker.py#L197-L200)

The pool signals are sent from the pools. The prefork child's initializer sends `worker_process_init`, the solo pool sends it when it is constructed, and `worker_before_create_process` is sent before the prefork pool creates a child.

Sources: [celery/concurrency/prefork.py:80-84](repo://celery/concurrency/prefork.py#L80-L84)

Sources: [celery/concurrency/solo.py:17-21](repo://celery/concurrency/solo.py#L17-L21)

Sources: [celery/concurrency/asynpool.py:488-492](repo://celery/concurrency/asynpool.py#L488-L492)

`heartbeat_sent` is sent by the heartbeat step each time a heartbeat goes out.

Sources: [celery/worker/heartbeat.py:33-40](repo://celery/worker/heartbeat.py#L33-L40)

## Logging and beat signals

`setup_logging` is sent when the logging system is configured; if no receiver is connected, the default root logger setup runs. `after_setup_logger` and `after_setup_task_logger` are sent after the two loggers are set up.

Sources: [celery/signals.py:117-136](repo://celery/signals.py#L117-L136)

Sources: [celery/app/log.py:95-103](repo://celery/app/log.py#L95-L103)

Sources: [celery/app/log.py:124-126](repo://celery/app/log.py#L124-L126)

Sources: [celery/app/log.py:176-178](repo://celery/app/log.py#L176-L178)

Beat has two signals. `beat_init` is sent when the beat service starts, and `beat_embedded_init` is for the beat service embedded in a worker.

Sources: [celery/signals.py:137-140](repo://celery/signals.py#L137-L140)

Sources: [celery/beat.py:633-640](repo://celery/beat.py#L633-L640)

## Eventlet and program signals

The eventlet group marks the start, the pre-shutdown and post-shutdown of the eventlet pool, and each `apply` it does. `user_preload_options` is the last group, sent when the command-line preload options are read.

Sources: [celery/signals.py:141-151](repo://celery/signals.py#L141-L151)
