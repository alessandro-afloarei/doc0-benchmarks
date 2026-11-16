---
type: operations
title: Worker operations, events, and remote control
description: Use Celery's CLI, inspect/control mailbox, events, and worker state to diagnose queues and manage running workers.
tags: [operations, monitoring, events, control, revocation]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:50:32.264Z
sources:
  - id: openwiki-source-41d293d3c7e3c875eed1b7ef
    resource: repo://celery/app/control.py
  - id: openwiki-source-4e8c69ddbd86a82c3201bc63
    resource: repo://celery/bin/celery.py
  - id: openwiki-source-4be6cca2c9164c478933a960
    resource: repo://celery/events/dispatcher.py
  - id: openwiki-source-2f1a7c2fcace441b360b3f19
    resource: repo://celery/events/state.py
  - id: openwiki-source-448ad2fc321c5e1d8e0a93fc
    resource: repo://celery/worker/consumer/control.py
  - id: openwiki-source-a85d69622d5baa166a82e6c1
    resource: repo://celery/worker/control.py
  - id: openwiki-source-7a844ae59c546297a34da340
    resource: repo://celery/worker/state.py
generated: { by: "codex", at: "2026-11-16T16:50:32.264Z" }
---

# Worker operations, events, and remote control

Celery offers three different views of work: broker queues, worker-local requests, and backend results. Events add an observational history. None is a substitute for all the others: an empty worker reservation list does not mean an empty broker, and missing backend metadata does not prove a task never ran.

## Select the intended application

The console script and `python -m celery` enter the umbrella Click CLI. Put application selection before the subcommand, for example `celery -A tasks:app worker -l INFO`. The CLI resolves the application import, prepares configuration environment overrides, and then supplies the application context to subcommands. `--workdir` changes the import working directory early; import failures and exceptions inside the module receive distinct diagnostics.

Start with read-only queries, adjusting `tasks:app` to the project:

```bash
celery -A tasks:app report
celery -A tasks:app inspect ping --timeout=5
celery -A tasks:app inspect registered
celery -A tasks:app inspect active_queues
celery -A tasks:app inspect active
celery -A tasks:app inspect reserved
celery -A tasks:app inspect scheduled
celery -A tasks:app inspect stats
```

`active` reports executing requests. `reserved` excludes active requests. `scheduled` reports ETA requests in the worker timer. `registered` answers whether a task name is known, and `active_queues` answers what this worker consumes. Use unique worker names (`worker -n ...`): duplicate names produce ambiguous replies and a `DuplicateNodenameWarning` during reply flattening.

## Inspect and control share a mailbox

`Inspect` sends control broadcasts requesting replies and folds them into a node-name mapping. `Control.broadcast()` uses a Kombu fanout mailbox, with optional destinations, timeout, and reply limit. The worker control bootstep is included only when remote control is enabled and the transport supports fanout exchange behavior.

Consequently, a missing reply can mean the wrong broker/application, unsupported or disabled remote control, an unreachable worker, or insufficient response time. A timeout is not a complete cluster membership census. Destination selection narrows a query to the requested node names; the mailbox does not infer which workers ought to exist.

Control commands can change rate/time limits, pool size, queue consumption, event emission, and revocation. Worker-side command registration lives in `celery/worker/control.py`, while client proxies live in `celery/app/control.py`. These commands are broker messages, so broker access and accepted serializers are part of the [security boundary](../security/serialization.md).

## Revocation and persistent state

Revoking a task adds its ID to the worker's bounded revoked set. This checkout also attempts to mark each ID revoked in the result backend, logging backend errors without abandoning the revoke. The receive/execute path checks revoked state before running work. Revocation alone does not stop an already executing task; the optional terminate path looks up IDs in the worker's known request mapping and invokes each request's pool termination path. Revocation by stamped headers uses a separate in-memory mapping, so do not assume its persistence matches ID revocation.

`--statedb` enables the worker's shelve-based persistent state. It merges/saves revoked task IDs and logical clock data. It is not a checkpoint of active task frames, all reservations, or task results. Give workers their own state paths and preserve the file when revoked IDs must survive their restart. Revoke retention is bounded by `CELERY_WORKER_REVOKES_MAX` and `CELERY_WORKER_REVOKE_EXPIRES`.

## Event observation

Worker task events can be enabled at startup with `-E` or through remote control. `task_send_sent_event` controls producer-side sent observations separately. Event dispatch uses its own exchange and serializer; its default delivery mode is transient, and offline buffering is local to the dispatcher. `celery -A tasks:app events --dump` is a direct event-stream diagnostic.

`celery.events.state.State` aggregates worker and task events into bounded LRU caches. Task merging accounts for out-of-order events using state precedence; worker liveness derives from recent heartbeats. This state is an observer's reconstruction and can omit events it never received. It is not the authoritative result backend or a durable audit log.

## Practical triage

For a message that appears stuck, compare producer routing with `active_queues`, check `registered` for its exact name, then distinguish broker backlog, worker reservations, ETA scheduling, and active execution. For tasks that ran but have no result, inspect `ignore_result`, backend configuration, retention, and backend errors. For duplicates, correlate task IDs, retry count, redelivery, and connection-loss logs with [acknowledgement policy](../workflows/task-execution.md).

Read [remote commands](../../celery/worker/control.py), [mailbox client](../../celery/app/control.py), [persistent state](../../celery/worker/state.py), and [event aggregation](../../celery/events/state.py). Focused coverage lives in [control tests](../../t/unit/worker/test_control.py), [state tests](../../t/unit/worker/test_state.py), and [event-state tests](../../t/unit/events/test_state.py). See [worker lifecycle](../architecture/workers.md) for shutdown and reconnects, or [Beat](periodic-tasks.md) for periodic publication.
