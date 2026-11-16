---
title: "Worker Signals and Shutdown"
---
## Overview

A worker stops in one of three ways. A **warm shutdown** stops consuming and waits for running tasks to finish. A **cold shutdown** cancels running tasks and stops quickly. A **soft shutdown** is an optional grace period at the start of a cold shutdown, during which tasks may still finish. The signal handlers that choose between them only set flags in `celery.worker.state`; the event loop notices the flags and raises `WorkerShutdown` or `WorkerTerminate`, which `WorkController.start` turns into `stop()` or `terminate()`.

Sources: [celery/worker/state.py:73-93](repo://celery/worker/state.py#L73-L93), [celery/worker/worker.py:201-212](repo://celery/worker/worker.py#L201-L212)

The handlers are installed by the worker program in `on_start` (see [[Worker Startup and Bootsteps]]) through `platforms.signals`, described on [[Daemonization and Platform Helpers]].

Sources: [celery/apps/worker.py:254-274](repo://celery/apps/worker.py#L254-L274)

## Signal handlers

| Signal | Handler | Effect |
| --- | --- | --- |
| `SIGTERM` | `install_worker_term_handler` | Warm shutdown (cold if billiard's `REMAP_SIGTERM` is `SIGQUIT`) |
| `SIGQUIT` | `install_worker_term_hard_handler` | Cold shutdown via `on_cold_shutdown` |
| `SIGINT` | `install_worker_int_handler` | Warm shutdown; the next `SIGINT` becomes cold |
| `SIGHUP` | `install_worker_restart_handler` | Warm shutdown, then re-exec the same command (only when not attached to a terminal) |
| `SIGUSR1` | `install_cry_handler` | Print the stack of every thread |
| `SIGUSR2` | `install_rdb_handler` | Open a remote debugger, only if `CELERY_RDBSIG` is set |

Sources: [celery/apps/worker.py:254-274](repo://celery/apps/worker.py#L254-L274), [celery/apps/worker.py:434-523](repo://celery/apps/worker.py#L434-L523)

All shutdown handlers are made by `_shutdown_handler(worker, sig, how, callback, exitcode)`. In the main process the generated handler runs the callback, prints `worker: Warm shutdown (MainProcess)` (or `Cold`), and sends the `worker_shutting_down` signal. In every process it then sets `state.should_stop` (warm) or `state.should_terminate` (cold) to the exit code. Messages are written with `safe_say`, which uses the `os.write` saved before eventlet or gevent patching, because the patched version raises when called inside the hub's loop.

Sources: [celery/apps/worker.py:288-316](repo://celery/apps/worker.py#L288-L316), [celery/apps/worker.py:80-88](repo://celery/apps/worker.py#L80-L88), [celery/__init__.py:18-23](repo://celery/__init__.py#L18-L23)

The `SIGHUP` restart handler is only installed when stdout is not a terminal, so closing a terminal window does not restart a foreground worker into the background; on macOS it is replaced by a handler that only warns, because a process with threads cannot exec there. When it fires, it registers an `atexit` hook that closes stdio and `execv`s the same command line, then requests a warm shutdown.

Sources: [celery/apps/worker.py:259-269](repo://celery/apps/worker.py#L259-L269), [celery/apps/worker.py:469-487](repo://celery/apps/worker.py#L469-L487), [celery/apps/worker.py:517-523](repo://celery/apps/worker.py#L517-L523)

## From flag to shutdown

`state.maybe_shutdown()` raises `WorkerTerminate(should_terminate)` if that flag is set, else `WorkerShutdown(should_stop)` if that one is. The consumer's event loop calls it on every iteration, and `Consumer.start` calls it before each (re)connect attempt. Both exceptions derive from `SystemExit`, so the loop's error handling (which catches `Exception`) does not swallow them.

Sources: [celery/worker/state.py:88-93](repo://celery/worker/state.py#L88-L93), [celery/worker/loops.py:83-87](repo://celery/worker/loops.py#L83-L87), [celery/worker/loops.py:111-112](repo://celery/worker/loops.py#L111-L112), [celery/worker/consumer/consumer.py:366-369](repo://celery/worker/consumer/consumer.py#L366-L369)

`WorkController.start` catches `WorkerTerminate` and calls `terminate()`; `SystemExit` (which includes `WorkerShutdown`) calls `stop(exitcode=...)`. `stop` closes the consumer and, unless called from a signal handler with a pool that is not signal-safe, stops the blueprint warm; then it sends `worker_shutdown`. `terminate` does the same with `terminate=True`. `_shutdown` stops the blueprint under a 5-second default socket timeout (Issue 975) and joins it.

Sources: [celery/worker/worker.py:201-267](repo://celery/worker/worker.py#L201-L267)

```mermaid
sequenceDiagram
    participant OS
    participant Handler as "signal handler"
    participant State as "worker.state"
    participant Loop as "asynloop"
    participant WC as "WorkController"
    OS->>Handler: "SIGTERM"
    Handler->>State: "should_stop = EX_OK"
    Loop->>State: "maybe_shutdown()"
    State-->>Loop: "raise WorkerShutdown"
    Loop-->>WC: "SystemExit propagates from blueprint.start"
    WC->>WC: "stop(): close consumer, blueprint.stop(warm)"
    WC->>WC: "worker_shutdown signal"
```

Sources: [celery/apps/worker.py:301-314](repo://celery/apps/worker.py#L301-L314), [celery/worker/state.py:88-93](repo://celery/worker/state.py#L88-L93), [celery/worker/worker.py:201-252](repo://celery/worker/worker.py#L201-L252)

## Cold shutdown

### The cold shutdown handler

`on_cold_shutdown` is the callback for `SIGQUIT`, and for `SIGINT` after the first one. It:

Sources: [celery/apps/worker.py:369-372](repo://celery/apps/worker.py#L369-L372)

1. Prints that pressing Ctrl+C again will terminate all running tasks, and re-installs `SIGINT` and `SIGQUIT` (and `SIGTERM` when remapped) with `during_soft_shutdown` as callback.
2. Calls `worker.wait_for_soft_shutdown()`.
3. Cancels the task consumer, so requeued messages are not immediately redelivered to this worker.
4. Calls `consumer.cancel_active_requests()`.
5. Sets `state.should_terminate = True` and stops the pool so that tasks that already succeeded still run their `on_success` path.

Sources: [celery/apps/worker.py:369-431](repo://celery/apps/worker.py#L369-L431)

### Soft shutdown

`wait_for_soft_shutdown` sleeps for `worker_soft_shutdown_timeout` seconds if the timeout is positive and there are active requests (or always, with `worker_enable_soft_shutdown_on_idle`). The docstring gives the intent: let short tasks finish and requeue long ones for another worker before the cold shutdown. The timeout defaults to `0.0`, which disables the grace period.

Sources: [celery/worker/worker.py:412-435](repo://celery/worker/worker.py#L412-L435), [celery/app/defaults.py:332-333](repo://celery/app/defaults.py#L332-L333)

### Escalation

A further `SIGINT` or `SIGQUIT` during the grace period runs `during_soft_shutdown`: it cancels the unacknowledged requests right away, installs `on_hard_shutdown` for the next signal, and lets the grace period finish. `on_hard_shutdown` raises `WorkerTerminate(EX_FAILURE)`; its docstring calls it the worst case, for a worker stuck in shutdown.

Sources: [celery/apps/worker.py:319-366](repo://celery/apps/worker.py#L319-L366)

### Which requests are cancelled

`cancel_active_requests` cancels every active request of a task without `acks_late`, and every `acks_late` request not yet acknowledged unless it already succeeded. Acknowledged `acks_late` requests are left to finish. Requests without `acks_late` get a `RETRY` state and the `task_retry` signal; `acks_late` requests do not, since the broker will redeliver them.

Sources: [celery/worker/consumer/consumer.py:823-855](repo://celery/worker/consumer/consumer.py#L823-L855)

`Request.cancel` sends the termination signal to the child process running the task, marks the request ready, sends a `task-cancelled` event and, when `emit_retry` is true, stores `Retry('cancelled by Celery')` and calls `on_retry`.

Sources: [celery/worker/request.py:428-456](repo://celery/worker/request.py#L428-L456)

During a cold shutdown, `Request.on_failure` treats failures as expected: with `state.should_terminate` set, it does not send the `task-failed` event or log the handler error.

Sources: [celery/worker/request.py:698-702](repo://celery/worker/request.py#L698-L702)

## Connection loss

Losing the broker connection is not a shutdown, but it affects running tasks the same way. `Consumer.start` loops while the blueprint is not stopping and restarts it after recoverable connection errors. If retrying is disabled (`broker_connection_retry_on_startup` on the first attempt, `broker_connection_retry` afterwards), it raises `WorkerShutdown(1)`; an `EMFILE` ("too many open files") raises `WorkerTerminate(1)`.

Sources: [celery/worker/consumer/consumer.py:366-407](repo://celery/worker/consumer/consumer.py#L366-L407)

After a connection loss, `on_connection_error_after_connected` collects and closes the broken connection. With `worker_cancel_long_running_tasks_on_connection_loss`, it cancels every active `acks_late` request that was not acknowledged, because its message will be redelivered on the new connection; without it, it emits a pending-deprecation warning that this will become the default. It may also temporarily reduce the prefetch count, as described on [[The Consumer and Message Loop]].

Sources: [celery/worker/consumer/consumer.py:419-491](repo://celery/worker/consumer/consumer.py#L419-L491)

## Remote shutdown

The `shutdown` remote control command raises `WorkerShutdown` inside the worker, which follows the warm path above. See [[Remote Control and Inspection]].

Sources: [celery/worker/control.py:593-596](repo://celery/worker/control.py#L593-L596), [celery/exceptions.py:278-279](repo://celery/exceptions.py#L278-L279)
