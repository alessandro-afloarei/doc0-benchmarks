---
title: "Concurrency Pools"
---
## Overview

A pool is where the worker runs a task body in parallel with the consumer. Every pool implements the same small contract, `BasePool`, and the worker picks one by name when it starts. The default `prefork` pool runs tasks in child processes, `solo` runs them one at a time in the worker's own process, `threads` uses a thread pool, and `eventlet` and `gevent` use green threads. The pool does not decide what a task is or how its result is stored: it receives a callable from the request and reports back through callbacks. The request side is covered in [[Task Requests in the Worker]].

Sources: [celery/concurrency/base.py:47-61](repo://celery/concurrency/base.py#L47-L61), [celery/concurrency/__init__.py:11-24](repo://celery/concurrency/__init__.py#L11-L24)

## The pool contract

`BasePool` defines three states: `RUN`, `CLOSE` and `TERMINATE`. Its class attributes say whether the pool can be shut down from a signal handler (`signal_safe`) and whether it uses greenlets (`is_green`). Subclasses override the lifecycle methods, `on_start`, `on_stop`, `on_terminate`, `on_close` and `on_apply`.

Sources: [celery/concurrency/base.py:47-64](repo://celery/concurrency/base.py#L47-L64), [celery/concurrency/base.py:82-100](repo://celery/concurrency/base.py#L82-L100)

`apply_async` is the entry point the request uses. It logs the target and its arguments at debug level, truncating them, and then calls `on_apply`, passing `waitforslot` from `putlocks` and the callback propagation flag. The result handling is entirely in the callbacks the request supplied.

Sources: [celery/concurrency/base.py:140-156](repo://celery/concurrency/base.py#L140-L156)

## Choosing a pool by name

`ALIASES` maps the short names to class paths: `prefork`, `eventlet`, `gevent` and `solo`. The `threads` name is added when `concurrent.futures` imports. A custom class is registered under `custom` when the environment variable `CELERY_CUSTOM_WORKER_POOL` is set, and any other value is treated as a class path.

Sources: [celery/concurrency/__init__.py:11-24](repo://celery/concurrency/__init__.py#L11-L24), [celery/concurrency/__init__.py:27-38](repo://celery/concurrency/__init__.py#L27-L38)

`get_implementation` resolves the name with `symbol_by_name` and the alias table. The worker calls it once, when it sets up the pool class, so a wrong name fails at start-up.

Sources: [celery/worker/worker.py:129-131](repo://celery/worker/worker.py#L129-L131), [celery/concurrency/__init__.py:41-48](repo://celery/concurrency/__init__.py#L41-L48)

## The prefork pool

The prefork `TaskPool` uses `AsynPool` as its pool class, unless the `threads` option is set, in which case it uses `BlockingPool`. Its `on_start` creates the pool with the process limit, the process initializer and destructor, and timeouts enabled.

Sources: [celery/concurrency/prefork.py:95-118](repo://celery/concurrency/prefork.py#L95-L118)

After creating the pool, `on_start` binds the pool's `apply_async`, `maintain_pool`, `terminate_job`, `grow` and `shrink` methods onto the `TaskPool` object as proxy methods.

Sources: [celery/concurrency/prefork.py:120-126](repo://celery/concurrency/prefork.py#L120-L126)

`AsynPool` runs the pool from an event loop. Its timeout handling is set up by `_create_timelimit_handlers`, and the soft and hard timeout callbacks run when a job passes its limit. [[Retries, Failures and Time Limits]] describes what the request does with each of them.

Sources: [celery/concurrency/asynpool.py:414-430](repo://celery/concurrency/asynpool.py#L414-L430), [celery/concurrency/asynpool.py:549-577](repo://celery/concurrency/asynpool.py#L549-L577), [celery/concurrency/asynpool.py:578-606](repo://celery/concurrency/asynpool.py#L578-L606)

The default concurrency, when none is given, is the CPU count, or 2 when the count cannot be read. That is the number the prefork pool uses as its process limit.

Sources: [celery/worker/worker.py:108-113](repo://celery/worker/worker.py#L108-L113)

## The other pools

`solo` is a `BasePool` subclass that runs each job in the worker's own process, with no separate workers.

Sources: [celery/concurrency/solo.py:11-15](repo://celery/concurrency/solo.py#L11-L15)

`thread` defines a `TaskPool` on top of a thread pool, and `ApplyResult` is the small object that holds the result of one job. `eventlet` and `gevent` each define a `TaskPool` and a `Timer` for green threads, and they are chosen by name like the others.

Sources: [celery/concurrency/thread.py:21-30](repo://celery/concurrency/thread.py#L21-L30), [celery/concurrency/eventlet.py:36-40](repo://celery/concurrency/eventlet.py#L36-L40), [celery/concurrency/gevent.py:42-46](repo://celery/concurrency/gevent.py#L42-L46), [celery/concurrency/gevent.py:85-90](repo://celery/concurrency/gevent.py#L85-L90)

## Autoscaling

The autoscale component is a bootstep that requires the pool. Its `create` step builds an `Autoscaler` from the pool and the max and min concurrency, and it returns no step when the event loop is in use. The `--autoscale` option is read as `max,min`.

Sources: [celery/worker/autoscale.py:31-48](repo://celery/worker/autoscale.py#L31-L48), [celery/worker/components.py:118-128](repo://celery/worker/components.py#L118-L128)

`maybe_scale` compares the number of running processes with the number of tasks waiting, with both bounded by the maximum and minimum concurrency. If there are fewer processes than the bounded count, it scales up; if there are more than the lower bound, it scales down.

Sources: [celery/worker/autoscale.py:83-96](repo://celery/worker/autoscale.py#L83-L96)

`scale_up` and `scale_down` call the pool's `grow` and `shrink`, and they also update the consumer's prefetch count. The consumer side of that adjustment is in [[Consumer and Message Strategy]].

Sources: [celery/worker/autoscale.py:111-135](repo://celery/worker/autoscale.py#L111-L135)
