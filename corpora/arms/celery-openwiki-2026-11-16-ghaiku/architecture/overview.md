---
type: architecture
title: System Overview
description: Map of Celery's major subsystems - the application object, AMQP messaging, the worker and its bootstep blueprint, the beat scheduler, result backends, events and signals, and the command-line entrypoints - and how a task moves between them.
tags: [celery, overview, architecture, worker, beat, broker, backend, cli]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:42:35.525Z
sources:
  - id: openwiki-source-965d19cff645fcce36529be3
    resource: repo://celery/__main__.py
  - id: openwiki-source-94b60a38fd26082deb41f979
    resource: repo://celery/worker/consumer/consumer.py
  - id: openwiki-source-12d3bd623a53e489a785c641
    resource: repo://celery/worker/worker.py
  - id: openwiki-source-9fe3a610596da7b7f2c71115
    resource: repo://setup.py
generated: { by: "claude-code", at: "2026-11-16T10:42:35.525Z" }
---

# System Overview

Celery is a distributed task queue. A *producer* process turns a function call into a message, a *broker* transports it, a *worker* consumes and executes it, and a *result backend* optionally stores the outcome. *Beat* is a separate process that publishes tasks on a schedule. *Events* and *signals* expose what is happening. Everything is tied together by an **application object** (`Celery`), which holds configuration and the components above.

This page is the map. Each subsystem has its own page, linked below.

## Subsystems

| Subsystem | Main code | Responsibility | Detail page |
|---|---|---|---|
| Application | `celery/app/base.py`, `celery/app/defaults.py`, `celery/loaders/` | Configuration, task registry, loader selection, finalization | [application](application.md) |
| Tasks and tracing | `celery/app/task.py`, `celery/app/trace.py` | `Task` base class, retry, and the tracer that wraps every execution | [tasks and tracing](tasks-and-tracing.md) |
| Messaging | `celery/app/amqp.py`, `celery/app/routes.py` | Queues, routing, message construction, producer pool | [application](application.md) |
| Canvas | `celery/canvas.py` | Signatures and workflow primitives: chain, group, chord, map | [canvas](canvas.md) |
| Worker | `celery/worker/` | Blueprint of bootsteps, consumer, request handling, remote control | [worker](worker.md) |
| Concurrency | `celery/concurrency/` | Pluggable execution pools: prefork, solo, thread, eventlet, gevent | [concurrency pools](concurrency.md) |
| Beat | `celery/beat.py`, `celery/schedules.py`, `celery/apps/beat.py` | Periodic task scheduling | [beat](beat.md) |
| Result backends | `celery/backends/`, `celery/result.py` | Storing and retrieving task state and return values | [result backends](result-backends.md) |
| Events and signals | `celery/events/`, `celery/signals.py`, `celery/utils/dispatch/` | Monitoring events on the broker and in-process hooks | [events and signals](events-and-signals.md) |
| CLI | `celery/__main__.py`, `celery/bin/`, `celery/apps/` | The `celery` command and its subcommands | [command-line interface](../operations/cli.md) |

## The path of one task

1. **Publish.** A producer calls `task.apply_async(...)` or `signature.apply_async()`. The app's routing picks a queue, the AMQP component builds the message (with headers, stamps, and the serialized body), and the producer publishes it to the broker. Signals `before_task_publish` and `after_task_publish` fire around this step.
2. **Broker.** The message sits in the queue until a worker consumes it. The broker is any kombu-supported transport; Celery does not implement the broker itself.
3. **Consume.** The worker's consumer receives the message and creates a `Request`. The request strategy (`celery/worker/strategy.py`) decides how to handle it and may send a `task-received` event.
4. **Execute.** The request is handed to the concurrency pool. The pool calls the tracer, which runs the task function, sends the `task_prerun`/`task_postrun` and success or failure signals, and records the outcome.
5. **Store and acknowledge.** The result backend stores the state and return value. The message is acknowledged according to the task's acknowledgement settings, and canvas follow-ups are published: success links after success, error links after failure, and chord bodies once their header completes.

The full sequence with the code involved is in [task execution lifecycle](../workflows/task-execution-lifecycle.md).

## The worker as a blueprint

`WorkController` (`celery/worker/worker.py`, line 63) is built from a blueprint of bootsteps. Its default steps are `Hub`, `Pool`, `Beat`, `Timer`, `StateDB`, `Consumer`, and the autoscaler component (lines 80–88). The `Consumer` step in turn starts its own blueprint: `Connection`, `Mingle`, `Events`, `Gossip`, `Heart`, `Control`, `Tasks`, `DelayedDelivery`, `Evloop`, and `Agent` (`celery/worker/consumer/consumer.py`, lines 175–185). Steps can be added, removed, or replaced through `app.steps` and the `user_options` mechanism. See [worker](worker.md) for detail.

## Process boundaries

- A **client** process needs the app and a broker connection. It does not need a worker.
- A **worker** process runs the `WorkController` and forks or threads the execution pool. With the default prefork pool, each task runs in a child process.
- **Beat** runs in its own process, or embedded in a worker with the `--beat` option. It publishes tasks through the same messaging path as a client.
- The **result backend** and **broker** are external services; their connection parameters come from configuration.

## Configuration and entrypoints

The `celery` console script is `celery.__main__:main` (`setup.py`). It applies eventlet or gevent patching first (`maybe_patch_concurrency`, unless the command is `multi`), then delegates to `celery.bin.celery.main`. Subcommands are registered as Click commands, and third-party commands can be added through the `celery.commands` entry-point group. Configuration is documented in [configuration and security](../operations/configuration-and-security.md).

## Invariants that span subsystems

- Task identity (the task ID) is created at publication and carried through the broker, the worker, the tracer, and the backend, so a result can always be found by the ID the producer received.
- The application object is the single source of configuration. Components read settings through it, which is why configuration is lazy and why finalization matters ([application](application.md)).
- Observability is layered: signals run in-process; events are published to the broker for external monitors.

## Where to go next

- For a new reader: [quickstart](../quickstart.md) is the routing map.
- For a change to publishing or routing: [application](application.md), then [task execution lifecycle](../workflows/task-execution-lifecycle.md).
- For worker behaviour: [worker](worker.md) and [concurrency pools](concurrency.md).
