---
title: "Celery Overview"
---
## Overview

Celery is a distributed task queue. A client process turns a Python function call into a message and publishes it to a broker; one or more worker processes consume those messages, run the function, and write the outcome to a result backend that the client can read. The package declares itself as a "Distributed Task Queue" and exports the pieces a user touches directly: the `Celery` app, `Task`, `shared_task`, the canvas primitives (`chain`, `group`, `chord`, `signature`, `chunks`, `xmap`, `xstarmap`) and `current_app`/`current_task`.

Sources: [celery/__init__.py:1-41](repo://celery/__init__.py#L1-L41)

Everything hangs off one object, the `Celery` application. It owns the configuration, the task registry and lazily-built helpers for messaging (`amqp`), results (`backend`), remote control (`control`), events (`events`) and logging (`log`). The same app instance is used by the client that publishes tasks and by the worker that runs them.

Sources: [celery/app/base.py:252-345](repo://celery/app/base.py#L252-L345), [celery/app/base.py:1535-1600](repo://celery/app/base.py#L1535-L1600)

## The parts

| Area | What it does | Page |
| --- | --- | --- |
| App and configuration | The `Celery` object, lazy task registry, settings, loaders, Django fixup | [[The Celery Application and Configuration]] |
| Tasks | Turns functions into `Task` classes, retries, hooks | [[Defining Tasks and the Task Class]] |
| Publishing | `apply_async`, `send_task`, the message format | [[Calling Tasks: apply_async and send_task]] |
| Routing | Chooses queue, exchange and routing key | [[Routing and Queues]] |
| Worker core | `WorkController`, bootsteps, startup and shutdown | [[Worker Architecture and Bootsteps]] |
| Consumer | Receives messages, builds requests, rate limits and ETA | [[The Consumer: Receiving Tasks]] |
| Execution | Runs the task body, tracks state, acknowledges | [[Task Execution, Tracing and Acknowledgement]] |
| Pools | prefork, solo, threads, gevent, eventlet | [[Execution Pools]] |
| Results | Backend base class, `AsyncResult`, group results | [[Results, AsyncResult and the Result Backend]] |
| Backends | One page for every built-in store | [[Result Backend Catalogue]] |
| Canvas | Signatures, chains, groups | [[Canvas: Signatures, Chains and Groups]] |
| Chords | Header/body workflows and their completion | [[Chords: Header, Body and Completion]] |
| Beat | Periodic task scheduler | [[Periodic Tasks with Beat]] |
| Events | Real-time worker and task events | [[Events and Monitoring]] |
| Remote control | Commands broadcast to workers | [[Remote Control: Inspect and Control]] |
| CLI | The `celery` command and its subcommands | [[The celery Command Line]] |
| Signals | Hooks fired around publishing, execution and startup | [[Signals]] |

To try it first, see [[Quickstart]].

Sources: [celery/app/base.py:252-345](repo://celery/app/base.py#L252-L345), [celery/worker/worker.py:63-100](repo://celery/worker/worker.py#L63-L100), [celery/bin/celery.py:175-191](repo://celery/bin/celery.py#L175-L191)

## Main flow

```mermaid
flowchart TD
  defTask["@app.task builds a Task"] --> call["delay / apply_async"]
  call --> send["App.send_task builds the message"]
  send --> broker[("Broker queue")]
  broker --> consumer["Consumer receives message"]
  consumer --> strategy["Task strategy creates a Request"]
  strategy --> pool["Pool runs trace_task"]
  pool --> backend[("Result backend")]
  backend --> asyncResult["AsyncResult.get"]
```

Sources: [celery/app/base.py:515-585](repo://celery/app/base.py#L515-L585), [celery/app/task.py:536-710](repo://celery/app/task.py#L536-L710), [celery/app/base.py:846-1042](repo://celery/app/base.py#L846-L1042)

1. `@app.task` wraps a function in a `Task` subclass and registers it, see [[Defining Tasks and the Task Class]].
2. `delay`/`apply_async` merge options and either run the task eagerly or hand off to `send_task`, see [[Calling Tasks: apply_async and send_task]].
3. `send_task` routes the message with the `Router` and publishes it through a producer, see [[Routing and Queues]].
4. The worker's `Consumer` reads it from the broker and dispatches by task name, see [[The Consumer: Receiving Tasks]].
5. The per-task strategy builds a `Request`, which sends `trace_task_ret` to the pool, see [[Task Execution, Tracing and Acknowledgement]] and [[Execution Pools]].
6. `trace_task` stores the state and return value through the backend, see [[Results, AsyncResult and the Result Backend]].
7. The caller's `AsyncResult.get` reads it back; workflows built from [[Canvas: Signatures, Chains and Groups]] and [[Chords: Header, Body and Completion]] reuse the same path.

Sources: [celery/worker/consumer/consumer.py:723-786](repo://celery/worker/consumer/consumer.py#L723-L786), [celery/worker/strategy.py:131-209](repo://celery/worker/strategy.py#L131-L209), [celery/worker/request.py:341-372](repo://celery/worker/request.py#L341-L372), [celery/result.py:191-270](repo://celery/result.py#L191-L270)

## Design decisions that cut across the parts

**Tasks and the app are lazy.** For a non-finalized app, the `task` decorator returns a `PromiseProxy` that builds the real task on first use and queues itself in `_pending`; `finalize()` evaluates everything pending, binds every task and fires `on_after_finalize`. Creating tasks at import time therefore does not force configuration to load.

Sources: [celery/app/base.py:547-585](repo://celery/app/base.py#L547-L585), [celery/app/base.py:657-677](repo://celery/app/base.py#L657-L677)

**One blueprint of bootsteps builds both the worker and the consumer.** `WorkController.Blueprint` lists steps such as `Hub`, `Pool`, `Timer` and `Consumer`; the `Consumer` has its own blueprint with `Connection`, `Tasks`, `Heart` and others. Steps declare what they require, so features are added by listing another step rather than editing a start-up function. See [[Worker Architecture and Bootsteps]].

Sources: [celery/worker/worker.py:76-88](repo://celery/worker/worker.py#L76-L88), [celery/worker/consumer/consumer.py:176-189](repo://celery/worker/consumer/consumer.py#L176-L189), [celery/bootsteps.py:77-111](repo://celery/bootsteps.py#L77-L111)

**The message carries everything the worker needs.** Protocol 2 puts routing metadata (`task`, `id`, `eta`, `expires`, `retries`, `timelimit`, `root_id`, `parent_id`, stamps) in message headers and the arguments plus callbacks, errbacks, `chain` and `chord` in the body. The worker can pick the strategy from the headers without decoding the body, which is deferred to the pool process.

Sources: [celery/app/amqp.py:326-418](repo://celery/app/amqp.py#L326-L418), [celery/worker/consumer/consumer.py:731-748](repo://celery/worker/consumer/consumer.py#L731-L748)

**Pools and backends are chosen by alias.** `ALIASES` maps `prefork`, `eventlet`, `gevent`, `solo` and `threads` to pool classes, and `BACKEND_ALIASES` maps URL schemes such as `redis` or `db` to backend classes; both fall back to dotted-path lookup, and a `custom` pool can be injected through the `CELERY_CUSTOM_WORKER_POOL` environment variable. See [[Execution Pools]] and [[Result Backend Catalogue]].

Sources: [celery/concurrency/__init__.py:12-48](repo://celery/concurrency/__init__.py#L12-L48), [celery/app/backends.py:12-56](repo://celery/app/backends.py#L12-L56)

**Extension points are signals.** Publishing, execution and start-up each send signals, so user code can observe or alter behaviour without subclassing; see [[Signals]].

Sources: [celery/signals.py:29-150](repo://celery/signals.py#L29-L150)
