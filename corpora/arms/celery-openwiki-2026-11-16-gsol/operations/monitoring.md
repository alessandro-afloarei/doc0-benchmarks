---
type: operations
title: CLI operations, events and remote control
description: Loading a Celery app from the CLI, inspecting workers, sending control commands, consuming events and understanding revocation persistence.
tags: [operations, cli, events, monitoring, control]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:34:04.042Z
sources:
  - id: openwiki-source-965d19cff645fcce36529be3
    resource: repo://celery/__main__.py
  - id: openwiki-source-4cb84b39f767dc2ac3bc1fc1
    resource: repo://celery/app/base.py
  - id: openwiki-source-41d293d3c7e3c875eed1b7ef
    resource: repo://celery/app/control.py
  - id: openwiki-source-4e8c69ddbd86a82c3201bc63
    resource: repo://celery/bin/celery.py
  - id: openwiki-source-4be6cca2c9164c478933a960
    resource: repo://celery/events/dispatcher.py
  - id: openwiki-source-615baded4198a1e9794a8bb1
    resource: repo://celery/events/receiver.py
  - id: openwiki-source-2f1a7c2fcace441b360b3f19
    resource: repo://celery/events/state.py
  - id: openwiki-source-448ad2fc321c5e1d8e0a93fc
    resource: repo://celery/worker/consumer/control.py
  - id: openwiki-source-a85d69622d5baa166a82e6c1
    resource: repo://celery/worker/control.py
  - id: openwiki-source-7a844ae59c546297a34da340
    resource: repo://celery/worker/state.py
  - id: openwiki-source-5b05690e7e13e9bff2a56054
    resource: repo://celery/worker/strategy.py
generated: { by: "codex", at: "2026-11-16T06:34:04.042Z" }
---

# CLI operations, events and remote control

The console script enters `celery.__main__:main`, applies early concurrency patching, then loads the Click CLI. Global options such as `-A`, `--broker` and `--result-backend` belong before the subcommand. `-A` resolves an importable application; app import errors are reported before command execution. Commands can be extended through the `celery.commands` entry-point group and application user-option registries.

## Inspect the stage where work stopped

For an application exposed as `proj`, start with:

```bash
celery -A proj report
celery -A proj inspect ping
celery -A proj inspect registered
celery -A proj inspect active_queues
celery -A proj inspect reserved
celery -A proj inspect scheduled
celery -A proj inspect active
celery -A proj inspect stats
```

| Observation | Meaning and next check |
| --- | --- |
| Task missing from `registered` | Check task imports and app finalization on that worker |
| Wrong `active_queues` | Compare worker queue selection with producer routing |
| `reserved` | Accepted into worker memory but not currently active; inspect pool capacity and prefetch |
| `scheduled` | ETA/countdown requests held by the worker timer; this is not beat's periodic schedule |
| `active` | Execution tracked in the worker's active-request set |
| Result still `PENDING` | Check execution, backend configuration and retention independently of inspection |

Inspection is a remote request/reply protocol with destination, reply limit and timeout controls. Missing replies can reflect timeout, connection, unsupported transport or disabled remote control. They do not by themselves prove that a task never ran. Give each worker a unique node name: duplicate names cause reply-flattening warnings and ambiguous identity.

## Inspection and control share a transport

The client in `celery/app/control.py` uses a Kombu mailbox. Worker command handlers are registered in `celery/worker/control.py`; decorators distinguish inspection commands from state-changing control commands. The control consumer is included only when `worker_enable_remote_control` is enabled and the transport supports fanout exchanges.

Control operations include revocation, queue changes, rate limits and pool changes. `revoke` adds task IDs to the worker revoked set; termination is a separate option that can signal an active task's pool process. A revocation does not undo effects that already occurred. Header-based revocation maintains a separate stamp mapping and can optionally terminate matching active requests.

`worker --statedb PATH` persists revoked task IDs and clock data across restarts. The persistence implementation does not serialize the active work queue or the revoked-stamp mapping. Use a state filename appropriate to each worker instance.

## Events are a separate observation stream

Use `celery -A proj worker -E -l INFO` to enable worker task events and `celery -A proj events --dump` to observe them. Producer-side `task-sent` events are controlled separately by `task_send_sent_event`. Event dispatchers can filter groups and buffer while disconnected; a reconnect requires flushing the buffer.

`EventReceiver` creates a receiver-specific queue, normalizes logical clocks and routes events to type handlers or a wildcard handler. Queue TTL, expiry, exclusivity and durability are configurable; exclusive and durable cannot both be true. `events.State` maintains bounded in-memory worker and task indexes and uses state precedence to merge out-of-order task observations. It is an operational view, separate from the [result backend](../integrations/result-backends.md).

## Change and test the owning layer

CLI tests live in `t/unit/bin/`; client control tests in `t/unit/app/test_control.py`; server handlers in `t/unit/worker/test_control.py`; persistence in `test_state.py`; event merging and receivers in `t/unit/events/`. Validate transport support and timeout behavior with real services when changing request/reply flow. Follow [worker lifecycle](../architecture/worker.md), [execution](../workflows/execution.md) or [beat](periodic-tasks.md) for the stage implicated by inspection.
