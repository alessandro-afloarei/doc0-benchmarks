---
title: "Task Execution"
---
## Overview

When a message reaches the worker, the default strategy wraps it in a `Request`, decides when it may run (ETA, rate limit, revocation), and hands it to the pool. The pool calls `trace_task`, which runs the task body and then records the outcome: success, retry, reject, ignore or failure. This page follows one message through those steps. The worker's startup is in [[Worker Startup]], the pool types are in [[Concurrency Pools]], and the stored state is in [[Result Backends]].

Sources: [celery/worker/strategy.py:99-132](repo://celery/worker/strategy.py#L99-L132)

Sources: [celery/worker/request.py:374-397](repo://celery/worker/request.py#L374-L397)

## Strategy: from message to handler

The task's `Strategy` class is `celery.worker.strategy:default`. The default strategy makes one `Request` class for the task and returns a `task_message_handler` that builds a request from each message, decoding the payload from either the protocol 2 or protocol 1 layout.

Sources: [celery/worker/strategy.py:117-146](repo://celery/worker/strategy.py#L117-L146)

Sources: [celery/worker/strategy.py:146-166](repo://celery/worker/strategy.py#L146-L166)

Before the request is handed on, the handler drops it if it has expired or was revoked, sends `task_received`, and sends the `task-received` event when the task sends events. A request with a future ETA is held on the timer; a request with a rate limit waits for its bucket.

Sources: [celery/worker/strategy.py:167-196](repo://celery/worker/strategy.py#L167-L196)

Only a request that is neither delayed nor rate-limited is marked reserved and handed to the consumer's `on_task_request`.

Sources: [celery/worker/strategy.py:197-209](repo://celery/worker/strategy.py#L197-L209)

## Request and pool dispatch

`Request.execute_using_pool` sends the trace function to the pool with its arguments and the callbacks the request needs: `on_accepted` when a process takes the job, `on_success` when it returns, `on_failure` when it raises, and `on_timeout` for the time limits. The soft and hard limits are the request's own or the task class's.

Sources: [celery/worker/request.py:341-373](repo://celery/worker/request.py#L341-L373)

`Request.execute` runs the task in the current process. It skips a revoked request, acknowledges the message early unless the task sets `acks_late`, adds the log level and log file to the request dictionary, and calls `trace_task`. If the trace reports a rejection the message is rejected without requeue; otherwise it is acknowledged.

Sources: [celery/worker/request.py:374-397](repo://celery/worker/request.py#L374-L397)

## Build the tracer

`build_tracer` returns a closure over the task and the app settings it needs: the callbacks and signals to fire, whether results are stored, and whether successful tasks are deduplicated on redelivery. Each optional hook (`before_start`, `on_success`, `after_return`) is looked up once, so a task that does not define one pays no cost.

Sources: [celery/app/trace.py:344-380](repo://celery/app/trace.py#L344-L380)

The deduplication check runs only when `acks_late` is set, the app's `worker_deduplicate_successful_tasks` is on and the result backend is persistent. A redelivered message whose stored state is already successful is not run again; its chain and callbacks are sent if the first run did not send them.

Sources: [celery/app/trace.py:380-383](repo://celery/app/trace.py#L380-L383)

Sources: [celery/app/trace.py:510-549](repo://celery/app/trace.py#L510-L549)

## Running the body

`trace_task` pushes the task and the request on their stacks and sends `task_prerun`. If the task tracks started states it stores `STARTED` with the process id and host. The body is then called with `fun(*args, **kwargs)`, which is `run`, or the task's own `__call__` when it defines one.

Sources: [celery/app/trace.py:552-586](repo://celery/app/trace.py#L552-L586)

Each exception type has its own branch. `Reject` rejects the message, `Ignore` leaves the state alone, `Retry` marks the task for retry without calling error callbacks, and any other exception is handled as a failure.

Sources: [celery/app/trace.py:587-609](repo://celery/app/trace.py#L587-L609)

Sources: [celery/app/trace.py:206-216](repo://celery/app/trace.py#L206-L216)

On success, the trace first dispatches the link callbacks and the next chain step, and only then calls `mark_as_done`. The order matters: `result.children` must be filled before the result is stored, so callbacks are sent first.

Sources: [celery/app/trace.py:610-630](repo://celery/app/trace.py#L610-L630)

Sources: [celery/app/trace.py:426-473](repo://celery/app/trace.py#L426-L473)

After `mark_as_done`, the trace records the runtime, calls the task's `on_success` and the `task_success` signal, and logs the return value. `after_return` runs for every state that is not in the ignored set, and `task_postrun` runs in the `finally` block, which also pops the stacks and runs the backend's process cleanup.

Sources: [celery/app/trace.py:631-676](repo://celery/app/trace.py#L631-L676)

## Outcomes

`Info.handle_error_state` picks the outcome for an exception. A `Retry` is recorded with `mark_as_retry` and the `task_retry` signal. The request's `on_retry` acknowledges the message when `acks_late` is set.

Sources: [celery/app/trace.py:212-241](repo://celery/app/trace.py#L212-L241)

Sources: [celery/worker/request.py:613-621](repo://celery/worker/request.py#L613-L621)

A failure is recorded with `mark_as_failure`, which stores the exception and calls the error callbacks unless `call_errbacks` is false, and then fires `task_failure`. With `acks_late`, a failure caused by a lost worker is rejected and requeued when `reject_on_worker_lost` is set, and a time-limit failure is rejected unless its acknowledgement flag is on; the options are described in [[Tasks]].

Sources: [celery/app/trace.py:242-283](repo://celery/app/trace.py#L242-L283)

Sources: [celery/worker/request.py:622-690](repo://celery/worker/request.py#L622-L690)

With `acks_late`, a success acknowledges the message after the result is stored. Without it, the acknowledgement already happened in `execute`, before the body ran.

Sources: [celery/worker/request.py:596-611](repo://celery/worker/request.py#L596-L611)

Sources: [celery/worker/request.py:730-735](repo://celery/worker/request.py#L730-L735)

## Error callbacks

`on_error` builds an `Info` for the exception and asks it to handle the error state, which is the failure path above. `handle_failure` is where the error callbacks are called, unless `call_errbacks` is false.

Sources: [celery/app/trace.py:417-424](repo://celery/app/trace.py#L417-L424)

Sources: [celery/app/trace.py:242-258](repo://celery/app/trace.py#L242-L258)
