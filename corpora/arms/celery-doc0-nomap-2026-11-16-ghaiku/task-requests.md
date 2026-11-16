---
title: "Task Requests in the Worker"
---
## Overview

A `Request` is the worker's record of one received message. It lives in the parent process from the moment the strategy creates it until its outcome is known: it decides whether the task still has to run, hands the job to the pool, receives the acceptance, success and failure callbacks, and acknowledges or rejects the broker message. The code that runs the task body is in the child, as described in [[Task Execution Tracing]]. This page covers the parent side of that exchange.

Sources: [celery/worker/request.py:67-96](repo://celery/worker/request.py#L67-L96), [celery/worker/request.py:818-831](repo://celery/worker/request.py#L818-L831)

## Creating the request

`Request.__init__` keeps the message, the decoded body and headers, the ack and reject callbacks, the worker's host name and the event dispatcher. Properties such as `name`, `args`, `kwargs`, `eta` and `expires` read from the decoded message.

Sources: [celery/worker/request.py:90-120](repo://celery/worker/request.py#L90-L120), [celery/worker/request.py:182-200](repo://celery/worker/request.py#L182-L200)

`create_request_cls` builds a `Request` subclass for each task. It binds the task's `acks_late` value, the pool and the event flags into the class, so the per-message methods read them from closure variables rather than from the task on every call.

Sources: [celery/worker/request.py:818-831](repo://celery/worker/request.py#L818-L831), [celery/worker/request.py:824-826](repo://celery/worker/request.py#L824-L826)

## Revocation and expiry

`revoked` decides whether the message should be skipped. It first checks `expires` through `maybe_expire`, which adds the id to the revoked set when the deadline has passed. It then checks the id against the revoked set, and then the stamped headers against the revoked stamps.

Sources: [celery/worker/request.py:408-416](repo://celery/worker/request.py#L408-L416), [celery/worker/request.py:470-492](repo://celery/worker/request.py#L470-L492)

`execute_using_pool` checks `revoked` before it submits anything, and raises `TaskRevokedError` when the task is revoked. The worker's process loop catches that error and releases its slot.

Sources: [celery/worker/request.py:341-356](repo://celery/worker/request.py#L341-L356), [celery/worker/worker.py:223-231](repo://celery/worker/worker.py#L223-L231)

## Handing the job to the pool

The base `execute_using_pool` submits the tracer with its arguments and the callbacks. The tracer is `fast_trace_task` when the optimization is on, and `trace_task_ret` otherwise.

Sources: [celery/worker/request.py:351-372](repo://celery/worker/request.py#L351-L372)

The per-task version in `create_request_cls` is the one the prefork pool uses. It passes the same tracer arguments, with the accept, timeout, success and failure callbacks, the soft and hard limits from the request's time limits or the task's defaults, and the task id as the correlation id. It keeps a weak reference to the returned result, so the request does not hold the job's result object alive.

Sources: [celery/worker/request.py:832-853](repo://celery/worker/request.py#L832-L853)

## Acceptance

`on_accepted` runs when a pool process takes the job. It records the pid and the start time, which it computes from the monotonic time the pool reports, and sends `task_accepted`. For a task that does not use late acknowledgement, the message is acknowledged here. A `task-started` event is then sent, and any termination requested before the job started is carried out.

Sources: [celery/worker/request.py:515-528](repo://celery/worker/request.py#L515-L528)

## Success

`on_success` receives the tuple the tracer returned, which says whether the run failed, the return value and the runtime. A failed tuple is passed on to `on_failure` with `return_ok`. Otherwise the request marks the task ready, acknowledges the message when `acks_late` is set, and sends `task-succeeded`.

Sources: [celery/worker/request.py:596-612](repo://celery/worker/request.py#L596-L612)

## Failure and acknowledgement

`on_failure` decides the message's fate from the exception, but only for a task that uses late acknowledgement. In that case a worker-lost error rejects the message when `reject_on_worker_lost` is set, and a timeout rejects it when `acks_on_timeout` is false. Other failures are not rejected in this branch.

Sources: [celery/worker/request.py:676-690](repo://celery/worker/request.py#L676-L690)

`acknowledge` and `reject` call the broker callbacks given at construction and record on the request that the message was acknowledged. `reject` also sends `task-rejected` with the requeue flag.

Sources: [celery/worker/request.py:730-741](repo://celery/worker/request.py#L730-L741)

## Termination

`terminate` sends the signal to the job's process when there is one. Otherwise it stores the pool and the signal in `_terminate_on_ack`, and `on_accepted` carries out the termination when the job starts. The protocol for revoke commands is in [[Remote Control and Revocation]].

Sources: [celery/worker/request.py:416-428](repo://celery/worker/request.py#L416-L428)

For the retry and time-limit behaviour that decides which of these outcomes applies, see [[Retries, Failures and Time Limits]], and for the consumer that creates the request, see [[Consumer and Message Strategy]].

Sources: [celery/worker/request.py:529-560](repo://celery/worker/request.py#L529-L560)
