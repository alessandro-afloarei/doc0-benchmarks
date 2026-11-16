---
type: workflow
title: Task Execution Lifecycle
description: End-to-end trace of one task from the producer's apply_async call, through message construction and broker delivery, the worker's strategy handler and Request object, pool dispatch and tracing, result storage, and acknowledgement, with the decision points that determine state and acknowledgement at each step.
tags: [celery, workflow, lifecycle, publish, consume, trace, result, acknowledgement]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:42:35.525Z
sources:
  - id: openwiki-source-5a0b6982dd7ddb0fabfabd0c
    resource: repo://celery/app/amqp.py
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-3795aa577fa7b0f3bd2af81a
    resource: repo://celery/app/task.py
  - id: openwiki-source-4a982797c89fcb3ea5c5d0ee
    resource: repo://celery/app/trace.py
  - id: openwiki-source-98fa58283cefff1b0e071bbe
    resource: repo://celery/backends/base.py
  - id: openwiki-source-328c66e40eb163230ad26cbc
    resource: repo://celery/worker/request.py
  - id: openwiki-source-5b05690e7e13e9bff2a56054
    resource: repo://celery/worker/strategy.py
  - id: openwiki-source-12d3bd623a53e489a785c641
    resource: repo://celery/worker/worker.py
generated: { by: "claude-code", at: "2026-11-16T10:42:35.525Z" }
---

# Task Execution Lifecycle

This page follows one task through the system. It is the workflow view of the component pages: [application](../architecture/application.md) (configuration and routing), [tasks and tracing](../architecture/tasks-and-tracing.md) (the tracer), [worker](../architecture/worker.md) (consumer and requests), [concurrency pools](../architecture/concurrency.md) (where the function runs), and [result backends](../architecture/result-backends.md) (storage). Each step names the code that performs it so the sequence can be checked against the source.

## 1. The producer calls `apply_async`

`Task.apply_async` (`celery/app/task.py`, around line 536) is the entry point for asynchronous execution. Its job is to turn the call into a message and publish it. If the task is always-eager, the call runs locally instead (the `apply` path). Otherwise it calls `app.send_task`, which:

1. resolves the destination through the router (`app.amqp.router`, built from `task_routes`, see [application](../architecture/application.md)); explicit options on the call overwrite route values;
2. creates the task ID if none was supplied, and the `AsyncResult` that the caller gets back;
3. builds the message with `app.amqp.as_task_v2` (or `as_task_v1` for protocol 1), which places arguments, callbacks, error callbacks, chain, chord, group, time limits, ETA or countdown, expiry, and root and parent IDs into the body and headers;
4. calls `self.backend.on_task_call(producer, task_id)` unless `ignore_result` is set, so backends that need a per-task channel (such as RPC) can prepare it before the message is sent;
5. calls `amqp.send_task_message`, which publishes through the producer pool with the configured serializer, delivery mode, compression, and retry policy. `before_task_publish` and `after_task_publish` signals fire around the publish, and `task-sent` is emitted if `task_send_sent_event` is enabled.

The caller receives the `AsyncResult` for the task ID. Nothing is stored yet, except the initial placeholder that `on_task_call` may have created.

## 2. The broker holds the message

The message waits in its queue until a consumer requests it. Celery does not implement delivery guarantees beyond what the broker and the acknowledgement mode provide. Redelivery after a worker crash depends on whether the message has been acknowledged, which is decided in step 4.

## 3. The worker's consumer and strategy receive the message

The `Consumer` (`celery/worker/consumer/consumer.py`) receives the delivery and calls the task message handler built by the strategy in `celery/worker/strategy.py` (`default`, line 99; `task_message_handler`, line 132). The handler:

1. decodes the body and headers into the canonical form, using `hybrid_to_proto2` or `proto1_to_proto2` depending on the protocol version;
2. creates a `Request` (`celery/worker/request.py`, class at line 67) with the acknowledgement and rejection callbacks;
3. logs the reception and checks for expiry and revocation: if the task is expired or revoked, `req.revoked()` handles it and the function returns without executing;
4. sends `task_received` and, if events are enabled for the task, `task-received`;
5. applies rate limits and ETA scheduling. A task with an ETA or countdown is held, and a rate-limited task waits for a token (see [worker](../architecture/worker.md)).

Once the request is ready, the worker hands it to the pool with `_process_task`, which calls `Request.execute_using_pool` (line 341). A revoked request raises `TaskRevokedError` here, and the worker releases the slot without running the task.

## 4. Acknowledgement is decided before the task runs

`Request.execute` (`celery/worker/request.py`, line 374) chooses when to acknowledge:

- With `acks_late = False` (the default), the message is acknowledged before the tracer runs (lines ~385–386). If the worker dies during the run, the task is not redelivered.
- With `acks_late = True`, the message stays unacknowledged until the task finishes, so a crash causes redelivery. `on_success` (line 596) acknowledges on success.

After `trace_task` returns, `execute` calls `reject(requeue=False)` if the tracer returned an information object, which the tracer sets for non-success outcomes such as failure, retry, reject, and ignore. Otherwise it calls `acknowledge()`. Both methods act at most once because of the `acknowledged` flag, so a message acknowledged early is not acknowledged again. Failure handling in `on_failure` (line 622) also rejects without requeue unless the exception asks for a requeue.

## 5. The pool runs the tracer

`execute_using_pool` passes the request's target, which is the tracer built by `build_tracer` (see [tasks and tracing](../architecture/tasks-and-tracing.md)), to `pool.apply_async`. The pool runs it in a child process, a thread, or a greenlet (see [concurrency pools](../architecture/concurrency.md)). `on_accepted` is called when the pool takes the job, so the worker can record that the task is running.

Inside the tracer, the order of operations is:

1. store `STARTED` if `track_started` is enabled;
2. send `task_prerun` and call the task function;
3. classify the outcome:
   - success: dispatch success callbacks and chained tasks, then `mark_as_done` stores the result and `task_success` fires;
   - `Reject`, `Ignore`, or `Retry`: the matching handler runs (`handle_reject`, `handle_ignore`, `handle_retry`);
   - any other exception: `on_error` runs `handle_failure`, which calls `mark_as_failure`; that call also fires the error callbacks;
4. send `task_postrun` and log the outcome.

Callbacks run before the success result is stored, so `result.children` is populated when the caller reads it.

## 6. The result backend stores the outcome

`Backend.mark_as_done` (`celery/backends/base.py`, line 180) and `mark_as_failure` (line 188) store the state through `store_result`. Key-value backends write only if the stored state is not already `SUCCESS` (see [result backends](../architecture/result-backends.md)). For chord members, `on_chord_part_return` updates the chord counter, and for chained steps `mark_as_failure` walks `request.chain` so that downstream steps are marked failed rather than left pending (see [canvas](../architecture/canvas.md)).

If the backend write itself fails, the error is raised as `BackendStoreError`, and the tracer's error path handles it.

## 7. The caller reads the result

The caller holds the `AsyncResult` from step 1. `get`, `state`, and `ready` read the stored metadata, and `get` may wait on the asynchronous consumer for backends that deliver results as messages. Result retention and cleanup are backend-specific.

## Decision points that change the outcome

| Decision | Where | Effect |
|---|---|---|
| Route selection | `app.amqp.router` | Chooses the queue; explicit call options win |
| Revoked or expired before start | strategy `task_message_handler` | Task is skipped and not executed |
| `acks_late` | `Request.execute` | Acknowledgement before or after execution |
| `Reject` / `Ignore` / `Retry` | tracer | Final state and whether the message is rejected |
| `store_errors_even_if_ignored`, `ignore_result` | tracer and backend | Whether the state is written |
| `SUCCESS` already stored | key-value backend `_store_result` | Later updates are ignored |
| Chord membership | `mark_as_done` / `mark_as_failure` | Advances the chord and triggers the body |

## Failure behaviour

- A worker crash before acknowledgement with `acks_late = True` causes redelivery; with the default setting, the task is lost from the broker's point of view but its failure may still be visible in the backend if it reached the tracer.
- A failure in the task function produces a `FAILURE` state, runs error callbacks, and marks chained downstream steps as failed.
- A retry publishes a new message through `Task.retry` and records `RETRY`; the original message is then rejected without requeue, so the newly published message is the only live copy.
- A publication error during retry raises `Reject(requeue=False)`, so the message is not requeued indefinitely.

## Related pages

- [Canvas](../architecture/canvas.md) for how chains, groups, and chords use the same path.
- [Events and signals](../architecture/events-and-signals.md) for the observers at each step.
- [Quickstart](../quickstart.md) for where to go next by task.
