---
title: "Tasks"
---
## Overview

A task is a class derived from `celery.app.task.Task` that an app registers under a name. The decorator `@app.task` creates that class from a function; the class holds the options that control execution (retries, acknowledgement, time limits) and the methods that send the task or run it in the calling process. This page covers the class and how a call reaches it. Sending is in [[Sending Tasks]], the worker's run of the task is in [[Task Execution]], and the decorator and registry are in [[Application and Configuration]].

Sources: [celery/app/task.py:206-216](repo://celery/app/task.py#L206-L216)

Sources: [celery/app/base.py:515-533](repo://celery/app/base.py#L515-L533)

## Options on the class

The class attributes are the defaults for every call. `max_retries` is 3 and `default_retry_delay` is `3 * 60` seconds, so a `retry()` without arguments waits 180 seconds and fails once more than three retries have been made.

Sources: [celery/app/task.py:241-245](repo://celery/app/task.py#L241-L245)

Sources: [celery/app/task.py:831-844](repo://celery/app/task.py#L831-L844)

`time_limit` and `soft_time_limit` are read when the worker sends the message to the pool, and `acks_late` when the request executes. Their class defaults are `None`, which leaves the decision to the settings the worker reads; a value set on the class is used for that task.

Sources: [celery/app/task.py:280-284](repo://celery/app/task.py#L280-L284)

Sources: [celery/worker/request.py:341-373](repo://celery/worker/request.py#L341-L373)

Sources: [celery/app/task.py:311-312](repo://celery/app/task.py#L311-L312)

Sources: [celery/worker/request.py:381-388](repo://celery/worker/request.py#L381-L388)

`reject_on_worker_lost` is `None` on the class. With `acks_late` set, a failure caused by a lost worker process is rejected and requeued when this option is true.

Sources: [celery/app/task.py:359-360](repo://celery/app/task.py#L359-L360)

Sources: [celery/worker/request.py:676-689](repo://celery/worker/request.py#L676-L689)

`Strategy` and `Request` name the classes the worker uses for this task: `celery.worker.strategy:default` and `celery.worker.request:Request`. A subclass can point either at its own class to change how messages for it are received.

Sources: [celery/app/task.py:216-225](repo://celery/app/task.py#L216-L225)

## Calling a task

Calling the task object runs `self.run` in the calling process and returns its value. It does not send a message or store a result; it is an ordinary function call that also goes through the task class.

Sources: [celery/app/task.py:495-500](repo://celery/app/task.py#L495-L500)

The `run` method is the body. A subclass must define it, or the base raises `NotImplementedError` on the call.

Sources: [celery/app/task.py:516-517](repo://celery/app/task.py#L516-L517)

`delay(*args, **kwargs)` is the short form of `apply_async(args, kwargs)`: it takes positional and keyword arguments and none of the execution options. The options of `apply_async` are the reason to use it directly.

Sources: [celery/app/task.py:523-534](repo://celery/app/task.py#L523-L534)

## Running synchronously with apply

`apply` runs the task in the calling process and blocks until it returns. It builds a request dictionary with a new task id, takes the parent's request id from the task stack when the call happens inside another task, and runs the body through `build_tracer`, so the result, the failure and the retry rules match the worker's. A failure is re-raised when `throw` is set; by default that is the `task_eager_propagates` setting.

Sources: [celery/app/task.py:869-906](repo://celery/app/task.py#L869-L906)

Sources: [celery/app/task.py:936-946](repo://celery/app/task.py#L936-L946)

## Where the class comes from

`app.task` and `shared_task` both create the class. A task defined with `lazy=True` before the app is finalized is queued and built at finalization; see [[Application and Configuration]] for how the registry binds it.

Sources: [celery/app/base.py:554-572](repo://celery/app/base.py#L554-L572)

Sources: [celery/app/__init__.py:24-40](repo://celery/app/__init__.py#L24-L40)

## Options at call time

`_get_exec_options` extracts the execution options from the class once and caches them. `apply_async` then merges that cached dictionary with the keyword arguments it was given, so a keyword passed to the call overrides the class default for that message only.

Sources: [celery/app/task.py:1256-1259](repo://celery/app/task.py#L1256-L1259)

Sources: [celery/app/task.py:674-676](repo://celery/app/task.py#L674-L676)
