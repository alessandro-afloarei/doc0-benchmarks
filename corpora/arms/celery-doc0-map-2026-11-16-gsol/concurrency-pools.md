---
title: "Concurrency Pools"
---
## Overview

The worker submits a task tracer to a pool through `BasePool.apply_async`. Pool implementations determine whether that callable runs in a child process, a thread, the worker's own execution path or a greenlet. [[Worker Lifecycle and Delivery]] describes the request callbacks and acknowledgements around that execution; pool selection changes the execution mechanism behind those callbacks.

Sources: [celery/concurrency/base.py:140-156](repo://celery/concurrency/base.py#L140-L156), [celery/worker/request.py:341-369](repo://celery/worker/request.py#L341-L369)

## Select an implementation

The concurrency factory resolves aliases through `symbol_by_name`. It provides `prefork`, the compatibility alias `processes`, `solo`, `eventlet`, `gevent` and, when `concurrent.futures` imports successfully, `threads`. An external pool can be named with `CELERY_CUSTOM_WORKER_POOL` in `package:class` form and selected with `--pool custom`. A custom implementation is expected to implement the `BasePool` interface.

Sources: [celery/concurrency/__init__.py:11-48](repo://celery/concurrency/__init__.py#L11-L48)

Select green pools with the CLI's `-P` or `--pool` option so `maybe_patch_concurrency` can patch their environment early. The entry point calls that function before importing the main CLI, except for `multi`. Its docstring explains that early selection ensures Eventlet or Gevent monkeypatching happens before dependent imports; the worker pool component warns when green pools are selected only through configuration.

Sources: [celery/__main__.py:10-15](repo://celery/__main__.py#L10-L15), [celery/__init__.py:107-147](repo://celery/__init__.py#L107-L147), [celery/worker/components.py:138-142](repo://celery/worker/components.py#L138-L142)

## Shared pool contract

`BasePool` stores concurrency limit, submission options, application and callback propagation policy. Its lifecycle methods call implementation hooks and update `RUN`, `CLOSE` and `TERMINATE` states. `apply_async` normalizes empty args and kwargs and forwards the target and options into `on_apply`. Its documentation asks callbacks to return quickly because a slow callback can block the thread handling results.

Sources: [celery/concurrency/base.py:47-80](repo://celery/concurrency/base.py#L47-L80), [celery/concurrency/base.py:120-156](repo://celery/concurrency/base.py#L120-L156)

The common `apply_target` helper invokes the acceptance callback with PID and monotonic time, then calls the target and sends its return value to the completion callback. Ordinary exceptions and worker shutdown exceptions propagate. Other base exceptions become a `WorkerLostError` wrapped as exception information for the callback. This helper supplies callback ordering for the thread, solo and green implementations that call it.

Sources: [celery/concurrency/base.py:22-44](repo://celery/concurrency/base.py#L22-L44), [celery/concurrency/thread.py:45-56](repo://celery/concurrency/thread.py#L45-L56), [celery/concurrency/solo.py:16-20](repo://celery/concurrency/solo.py#L16-L20), [celery/concurrency/gevent.py:116-126](repo://celery/concurrency/gevent.py#L116-L126), [celery/concurrency/eventlet.py:123-135](repo://celery/concurrency/eventlet.py#L123-L135)

Capability flags influence the surrounding worker: `signal_safe` says whether shutdown can run in a signal handler, `is_green` identifies green execution, and `task_join_will_block` participates in join policy. The base methods for terminating an individual job and restarting the pool raise `NotImplementedError`. A shared interface therefore does not promise that every pool implements every process-management capability.

Sources: [celery/concurrency/base.py:56-71](repo://celery/concurrency/base.py#L56-L71), [celery/concurrency/base.py:112-118](repo://celery/concurrency/base.py#L112-L118), [celery/worker/worker.py:244-259](repo://celery/worker/worker.py#L244-L259)

## Pool catalogue

| Pool | Implemented execution and lifecycle |
| --- | --- |
| Prefork | Starts a Billiard-backed multiprocessing pool, initializes each child and proxies job termination, growth and shrinking |
| Threads | Submits `apply_target` into `ThreadPoolExecutor` and wraps its future; declares shutdown unsafe inside a signal handler |
| Solo | Runs `apply_target` inline, fixes its limit at one and reports the current process PID |
| Eventlet | Spawns into `GreenPool`, emits pool signals, resizes through `resize` and kills tracked greenlets |
| Gevent | Spawns into `gevent.pool.Pool`, tracks greenlets, implements timeout wrapping and kills individual tracked jobs |

Sources: [celery/concurrency/prefork.py:95-130](repo://celery/concurrency/prefork.py#L95-L130), [celery/concurrency/thread.py:21-64](repo://celery/concurrency/thread.py#L21-L64), [celery/concurrency/solo.py:11-31](repo://celery/concurrency/solo.py#L11-L31), [celery/concurrency/eventlet.py:100-151](repo://celery/concurrency/eventlet.py#L100-L151), [celery/concurrency/gevent.py:97-145](repo://celery/concurrency/gevent.py#L97-L145)

The thread implementation's stop hook calls executor shutdown with pending-future cancellation. Solo does not create child processes and advertises no timeouts in its information mapping. Eventlet and Gevent both declare green execution, non-signal-safe shutdown and a nonblocking task-join flag, but expose different concrete methods for resizing and job cancellation. Choose according to capabilities the implementation actually supplies rather than assuming identical limit or termination semantics.

Sources: [celery/concurrency/thread.py:30-43](repo://celery/concurrency/thread.py#L30-L43), [celery/concurrency/solo.py:16-30](repo://celery/concurrency/solo.py#L16-L30), [celery/concurrency/eventlet.py:88-95](repo://celery/concurrency/eventlet.py#L88-L95), [celery/concurrency/eventlet.py:137-151](repo://celery/concurrency/eventlet.py#L137-L151), [celery/concurrency/gevent.py:85-92](repo://celery/concurrency/gevent.py#L85-L92), [celery/concurrency/gevent.py:128-141](repo://celery/concurrency/gevent.py#L128-L141)

## Initialize prefork children

The prefork initializer establishes the intended application and logging environment inside each child. It configures process signals, initializes loader worker and worker-process hooks, handles per-process log filenames, sets the current/default app and finalizes it where needed. It rebuilds every task tracer, resets worker state and emits `worker_process_init`. The destructor emits `worker_process_shutdown` with PID and exit code. This is the child-process continuation of app setup in [[Applications and Configuration]].

Sources: [celery/concurrency/prefork.py:41-92](repo://celery/concurrency/prefork.py#L41-L92)

The prefork pool enables timeouts and proxies the underlying pool's apply, maintenance, termination and resize operations. During graceful stop it closes the pool and joins it. When an event-loop hub exists, a temporary thread fires timers during draining so heartbeat timers can keep running until the join completes. Those timers keep shutdown from depending solely on an event loop blocked in pool joining.

Sources: [celery/concurrency/prefork.py:104-126](repo://celery/concurrency/prefork.py#L104-L126), [celery/concurrency/prefork.py:142-178](repo://celery/concurrency/prefork.py#L142-L178)

## Apply limits and inspect capacity

The worker's pool component passes concurrency, per-child task and memory limits, hard and soft timeouts, restart policy and scheduling options to the pool constructor. Each implementation decides which options it uses. Gevent explicitly wraps a configured timeout in `gevent.Timeout` and calls the timeout callback with `soft=False` if it expires; the thread implementation accepts extra options but submits only its target and completion callbacks to the executor.

Sources: [celery/worker/components.py:154-170](repo://celery/worker/components.py#L154-L170), [celery/concurrency/gevent.py:28-39](repo://celery/concurrency/gevent.py#L28-L39), [celery/concurrency/gevent.py:116-126](repo://celery/concurrency/gevent.py#L116-L126), [celery/concurrency/thread.py:45-56](repo://celery/concurrency/thread.py#L45-L56)

Pool information is a JSON-friendly mapping containing implementation identity and maximum concurrency. Concrete pools add fields such as process IDs, executor thread count or free/running green threads. These mappings feed the observation surface described in [[Monitoring and Remote Control]], without requiring an operator to interpret every pool as a fixed list of child processes.

Sources: [celery/concurrency/base.py:158-172](repo://celery/concurrency/base.py#L158-L172), [celery/concurrency/thread.py:58-64](repo://celery/concurrency/thread.py#L58-L64), [celery/concurrency/solo.py:22-30](repo://celery/concurrency/solo.py#L22-L30), [celery/concurrency/eventlet.py:153-160](repo://celery/concurrency/eventlet.py#L153-L160)

## Autoscale execution capacity

Autoscale parses maximum and minimum concurrency and constructs an autoscaler around the selected pool. In event-loop mode it runs on task-message callbacks and a repeated timer; otherwise the component can run as a background thread. Its demand is the number of reserved requests. It grows toward demand up to maximum capacity and shrinks toward the greater of demand and minimum capacity, subject to a keepalive delay after growth.

Sources: [celery/worker/components.py:117-128](repo://celery/worker/components.py#L117-L128), [celery/worker/autoscale.py:32-54](repo://celery/worker/autoscale.py#L32-L54), [celery/worker/autoscale.py:83-118](repo://celery/worker/autoscale.py#L83-L118), [celery/worker/autoscale.py:148-154](repo://celery/worker/autoscale.py#L148-L154)

Runtime maximum/minimum updates can immediately grow or shrink the pool and adjust consumer prefetch. Shrinking catches a busy-pool `ValueError` and logs that capacity cannot yet be removed. The implementation calls the pool's own `grow` and `shrink`; autoscaling therefore depends on the pool supporting those operations. Reservation and prefetch behavior remain part of [[Worker Lifecycle and Delivery]].

Sources: [celery/worker/autoscale.py:98-138](repo://celery/worker/autoscale.py#L98-L138)
