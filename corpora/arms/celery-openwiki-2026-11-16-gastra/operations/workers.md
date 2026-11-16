---
type: operations
title: Running, observing and recovering workers
description: Worker CLI configuration, pool selection, inspection, monitoring events, shutdown, and broker reconnection behavior.
tags: [operations, worker, monitoring, shutdown, recovery]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:55:28.912Z
sources:
  - id: openwiki-source-41d293d3c7e3c875eed1b7ef
    resource: repo://celery/app/control.py
  - id: openwiki-source-3cfd5f9bf00aaf6b49d01291
    resource: repo://celery/apps/worker.py
  - id: openwiki-source-6de531038635a55bb6fb085b
    resource: repo://celery/bin/worker.py
  - id: openwiki-source-2f1a7c2fcace441b360b3f19
    resource: repo://celery/events/state.py
  - id: openwiki-source-94b60a38fd26082deb41f979
    resource: repo://celery/worker/consumer/consumer.py
  - id: openwiki-source-448ad2fc321c5e1d8e0a93fc
    resource: repo://celery/worker/consumer/control.py
  - id: openwiki-source-7a844ae59c546297a34da340
    resource: repo://celery/worker/state.py
  - id: openwiki-source-12d3bd623a53e489a785c641
    resource: repo://celery/worker/worker.py
generated: { by: "codex", at: "2026-11-16T07:55:28.912Z" }
---

# Running, observing and recovering workers

Start a worker with the application used by publishers and the task modules it must execute. The console script enters `celery.__main__`, applies early concurrency patching where needed, and delegates to the Click command group. The worker command resolves pool and operational options before constructing the worker application.

## Start and size a worker

```bash
celery -A tasks:app worker --loglevel=INFO --concurrency=4 --queues=celery --hostname='worker1@%h'
```

Use distinct worker names for reliable targeting. `--queues` selects queues to consume; it does not change producers' routing rules. Configure routes and selected queues together. `--pool` selects prefork, threads, solo, or an installed alternative such as gevent/eventlet. Prefork is the CLI default; concurrency defaults to configured capacity or CPU count in the worker controller.

<!-- openwiki: broken internal link [../../celery/concurrency] file "../../celery/concurrency" does not exist. Fix the href or restore the target, then delete this comment. -->
Pool selection affects isolation and features. Review the corresponding [pool implementations](../../celery/concurrency) before depending on process time limits or child recycling in another pool. Capacity and broker prefetch are different: the worker's prefetch calculation uses pool size and `worker_prefetch_multiplier`. ETA reservations and Redis-only disabled-prefetch behavior are described in [worker execution](../architecture/worker.md).

## Inspect and observe

```bash
celery -A tasks:app inspect ping
celery -A tasks:app inspect registered
celery -A tasks:app inspect active
celery -A tasks:app inspect reserved
celery -A tasks:app inspect scheduled
celery -A tasks:app inspect active_queues
```

Active tasks are executing; reserved tasks exclude active and scheduled tasks; scheduled inspection describes tasks held for ETA execution. These are worker views, not a complete broker backlog.

Inspect and control use the application's mailbox broadcast with optional destinations, replies, and a timeout. The worker control bootstep is conditional on `worker_enable_remote_control` and transport fanout support. A missing reply can reflect control transport or timeout problems as well as an unavailable worker.

Enable task events with `-E` when needed and use the event tooling to observe task/worker activity. `celery.events.state.State` maintains in-memory event-derived task and worker state, with worker heartbeat expiration and bounded task caches. Event history is distinct from durable backend results.

Revocation broadcasts task IDs for workers to skip; terminating already executing work is a separate option. The worker's revoked-ID collection is bounded and expiring. `--statedb` enables persistence of revoked task IDs, not persistence of all active tasks or monitoring history.

## Shutdown and reconnection

On supported signal platforms, SIGTERM normally begins warm shutdown, allowing running tasks to finish. SIGQUIT begins cold shutdown; `REMAP_SIGTERM=SIGQUIT` changes TERM behavior. Repeated interrupt signals can escalate shutdown. Configure the surrounding service manager's grace period to match intended task completion behavior.

Before cold shutdown, `worker_soft_shutdown_timeout` can add a bounded wait when active work exists. `worker_enable_soft_shutdown_on_idle` enables that wait even without active tasks, which matters when the worker holds scheduled work. The cold path then stops task consumption and cancels unacknowledged requests. Requeue outcomes still depend on task acknowledgement policy and broker behavior.

Startup connection retries use `broker_connection_retry_on_startup` when set; otherwise they fall back to `broker_connection_retry`. Later retries use `broker_connection_retry`, bounded by `broker_connection_max_retries`.

After connection loss, the consumer collects/closes the broken connection before rebuilding services. With `worker_cancel_long_running_tasks_on_connection_loss`, it cancels active late-acknowledged requests that cannot acknowledge the old delivery. If enabled, prefetch reduction accounts for work still active during reconnect; this checkout skips reduction when effective QoS is per-consumer and restores the maximum initial count.

## Troubleshooting route

Check application import and registered task names first, then publisher routing versus active queues, then active/reserved/scheduled views, and finally backend state. A PENDING result alone cannot identify where work stopped. Correlate logs by task ID and distinguish publish errors, user-code failures, broker disconnects, and backend failures.

[Consumer tests](../../t/unit/worker/test_consumer.py), [worker tests](../../t/unit/worker/test_worker.py), and [connection recovery integration tests](../../t/integration/test_connection_recovery.py) ground recovery behavior. See [security](security.md) for broker/control trust boundaries and [periodic tasks](periodic-tasks.md) for scheduler deployment.
