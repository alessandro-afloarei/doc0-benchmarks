---
title: "Concurrency Pools"
---
## Overview

A pool is the object that runs a worker's tasks: it receives the trace function and the message arguments from a `Request` and calls the function somewhere else, in a child process, a thread, a green thread or the worker's own process. Every pool derives from `BasePool`, which defines the calls the worker makes on it; the pool names map to implementation classes in `celery/concurrency`. The per-message path that feeds the pool is in [[Task Execution]], and the startup that creates it is in [[Worker Startup]].

Sources: [celery/concurrency/base.py:47-56](repo://celery/concurrency/base.py#L47-L56)

Sources: [celery/concurrency/__init__.py:11-17](repo://celery/concurrency/__init__.py#L11-L17)

## Choosing a pool

The pool name given to the worker is looked up in `ALIASES`, and the class is loaded by `symbol_by_name`. The names are `prefork`, `eventlet`, `gevent` and `solo`, plus `processes` as an older alias for `prefork`. `threads` is added only when `concurrent.futures` can be imported.

Sources: [celery/concurrency/__init__.py:11-25](repo://celery/concurrency/__init__.py#L11-L25)

Sources: [celery/concurrency/__init__.py:41-48](repo://celery/concurrency/__init__.py#L41-L48)

Setting `CELERY_CUSTOM_WORKER_POOL` adds a `custom` name that points at any class with the same interface, given as `package:class`.

Sources: [celery/concurrency/__init__.py:26-38](repo://celery/concurrency/__init__.py#L26-L38)

## Shared interface

`BasePool.__init__` keeps the pool limit, the `putlocks` flag that makes `apply_async` wait for a free slot, the callbacks that propagate, and the app. `apply_async` logs the call at debug level and forwards to `on_apply` with `waitforslot` set from `putlocks`; each subclass implements `on_apply`.

Sources: [celery/concurrency/base.py:73-82](repo://celery/concurrency/base.py#L73-L82)

Sources: [celery/concurrency/base.py:140-156](repo://celery/concurrency/base.py#L140-L156)

The lifecycle hooks are `on_start`, `on_stop`, `on_terminate` and `on_close`, and the timeout hooks are `on_soft_timeout` and `on_hard_timeout`. A pool overrides the ones it needs.

Sources: [celery/concurrency/base.py:82-137](repo://celery/concurrency/base.py#L82-L137)

The class flags `signal_safe` and `body_can_be_buffer` describe each pool. The base class sets `signal_safe` to true and `body_can_be_buffer` to false, and the pools below override them.

Sources: [celery/concurrency/base.py:58-71](repo://celery/concurrency/base.py#L58-L71)

## prefork

`prefork` is the default pool. Its `TaskPool.on_start` picks `BlockingPool` when the `threads` option is true, which is its default, and `AsynPool` otherwise. It starts the pool with the process initializer, the per-process destructor, timeouts enabled and the `worker_proc_alive_timeout` setting, and its `on_apply` becomes that pool's `apply_async`.

Sources: [celery/concurrency/prefork.py:95-104](repo://celery/concurrency/prefork.py#L95-L104)

Sources: [celery/concurrency/prefork.py:104-127](repo://celery/concurrency/prefork.py#L104-L127)

`on_start` also copies the pool's `maintain_pool`, `terminate_job`, `grow` and `shrink` methods onto the `TaskPool`, so the worker calls them through the pool class.

Sources: [celery/concurrency/prefork.py:124-127](repo://celery/concurrency/prefork.py#L124-L127)

## threads

`thread` runs each task on a `ThreadPoolExecutor` with `limit` workers. Its `on_apply` submits the call to the executor and wraps the future in an `ApplyResult`, and `on_stop` shuts the executor down and cancels the futures not yet started.

Sources: [celery/concurrency/thread.py:30-56](repo://celery/concurrency/thread.py#L30-L56)

Sources: [celery/concurrency/thread.py:58-64](repo://celery/concurrency/thread.py#L58-L64)

## solo

`solo` runs each task inline in the worker's own process: its `on_apply` is the `apply_target` function, the limit is fixed at 1, and the pool reports a concurrency of one. Its constructor sends the `worker_process_init` signal.

Sources: [celery/concurrency/solo.py:11-22](repo://celery/concurrency/solo.py#L11-L22)

Sources: [celery/concurrency/solo.py:23-31](repo://celery/concurrency/solo.py#L23-L31)

## eventlet and gevent

`eventlet` and `gevent` are green-thread pools: both set `is_green` and `task_join_will_block` to false, and both are not signal-safe. `eventlet`'s `on_apply` wraps the target so that it can be killed, sends the apply signal, and spawns the target on its pool. `gevent` spawns the call on a gevent pool.

Sources: [celery/concurrency/eventlet.py:88-98](repo://celery/concurrency/eventlet.py#L88-L98)

Sources: [celery/concurrency/eventlet.py:123-131](repo://celery/concurrency/eventlet.py#L123-L131)

Sources: [celery/concurrency/gevent.py:85-110](repo://celery/concurrency/gevent.py#L85-L110)

Sources: [celery/concurrency/gevent.py:116-120](repo://celery/concurrency/gevent.py#L116-L120)

The pool modules are imported by `get_implementation` only when their name is chosen, so a worker that runs `prefork` does not import the eventlet or gevent modules.

Sources: [celery/concurrency/__init__.py:41-43](repo://celery/concurrency/__init__.py#L41-L43)
