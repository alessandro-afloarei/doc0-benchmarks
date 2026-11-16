---
title: "Monitoring and Remote Control"
---
## Overview

Celery exposes broker-mediated control requests and a separate event stream. Inspection asks workers for current local state; control commands change worker behavior; events describe worker and task activity as it happens. The consumer starts these services alongside task consumption in [[Worker Lifecycle and Concurrency]]. Stored result metadata follows the independent client/backend path in [[Results and State]], so choose the interface that answers the operational question.

Sources: [celery/worker/consumer/consumer.py:171-186](repo://celery/worker/consumer/consumer.py#L171-L186), [celery/app/control.py:107-117](repo://celery/app/control.py#L107-L117), [celery/events/dispatcher.py:164-199](repo://celery/events/dispatcher.py#L164-L199), [celery/result.py:470-473](repo://celery/result.py#L470-L473)

## Send a command and collect replies

`Control.broadcast` accepts a command, arguments, optional destination names, reply policy, timeout, reply limit and callback. It acquires an application connection and delegates to the control mailbox. `Inspect._request` forces `reply=True` and forwards its configured destination and collection parameters. Replies are flattened by node name, with single-destination selection and optional matching applied before returning to the caller.

Sources: [celery/app/control.py:82-117](repo://celery/app/control.py#L82-L117), [celery/app/control.py:755-790](repo://celery/app/control.py#L755-L790)

The inspect CLI declares availability for AMQP and Redis transports. It exposes destination selection, JSON output and a reply timeout defaulting to one second. It validates command names, compiles arguments and calls the same inspection object. If no replies arrive it raises an explicit no-nodes-replied error. Because the timeout bounds reply collection, an absent reply is evidence about that request window rather than proof of a particular task's result or termination.

Sources: [celery/bin/control.py:153-200](repo://celery/bin/control.py#L153-L200), [celery/app/control.py:755-774](repo://celery/app/control.py#L755-L774)

## Read worker-local state

| Inspection | Worker-side source |
| --- | --- |
| `ping` | Returns a pong response from the command handler |
| `stats` | Calls the worker controller's statistics method |
| `scheduled` | Walks the consumer timer's scheduled request entries |
| `reserved` | Reports reserved requests minus active requests |
| `active` | Reports currently executing requests |
| `revoked` | Returns remembered revoked task IDs |
| `registered` | Lists registered tasks, optionally including builtins and selected task properties |

Sources: [celery/worker/control.py:395-454](repo://celery/worker/control.py#L395-L454), [celery/worker/control.py:462-483](repo://celery/worker/control.py#L462-L483)

Scheduled inspection covers worker-held ETA/countdown requests. Beat's periodic schedule is a different state owner described in [[Periodic Scheduling]]; that service publishes due occurrences into the ordinary task flow. Reserved and active collections likewise describe one worker's current requests, so aggregate replies by node when investigating a multiworker application. The API's node-keyed preparation preserves that distinction.

Sources: [celery/worker/control.py:411-448](repo://celery/worker/control.py#L411-L448), [celery/beat.py:326-358](repo://celery/beat.py#L326-L358), [celery/app/control.py:94-117](repo://celery/app/control.py#L94-L117)

## Dispatch and extend remote control

Worker command functions register in the global `Panel` registry through `control_command` or `inspect_command`. Registration records names, aliases, argument metadata, visibility and default timeout. The worker pidbox creates a mailbox node with those handlers and an object carrying application, hostname and consumer. Incoming messages advance the logical clock and dispatch through the node. Unknown commands are logged; other command errors log and reset the pidbox consumer.

Sources: [celery/worker/control.py:39-74](repo://celery/worker/control.py#L39-L74), [celery/worker/pidbox.py:25-65](repo://celery/worker/pidbox.py#L25-L65)

Runtime rate-limit commands update the registered task and reset consumer rate-limit buckets. Runtime time-limit commands modify the task's soft/hard attributes and report unknown task names. Event commands add or remove the task event group and report whether task events are enabled. These are changes to targeted workers' local runtime objects, so keep application configuration and process restarts in view when reasoning about the lasting source of settings.

Sources: [celery/worker/control.py:259-292](repo://celery/worker/control.py#L259-L292), [celery/worker/control.py:299-367](repo://celery/worker/control.py#L299-L367), [celery/app/control.py:755-765](repo://celery/app/control.py#L755-L765)

## Revoke work and retain revocation memory

The client revoke method broadcasts task IDs, an optional termination flag and signal. The worker adds IDs to its revoked set and attempts to mark them revoked in the backend; backend-marking failures are logged without abandoning local revocation. With termination requested, it finds matching requests and calls their termination method through the consumer pool. Without termination, flagging a running task does not itself invoke process termination.

Sources: [celery/app/control.py:488-510](repo://celery/app/control.py#L488-L510), [celery/worker/control.py:214-242](repo://celery/worker/control.py#L214-L242)

Requests check expiry and remembered IDs before execution. Stamped-header revocation also has a dedicated matching path. [[Task Execution and Retries]] explains how revocation, termination and acknowledgement affect results and delivery disposition. For restart persistence, worker `--statedb` uses a shelve-backed state object that stores revoked IDs; synchronization compresses its remembered set and merges it back on startup while purging expired entries.

Sources: [celery/worker/request.py:464-505](repo://celery/worker/request.py#L464-L505), [celery/worker/state.py:192-223](repo://celery/worker/state.py#L192-L223), [celery/worker/state.py:240-265](repo://celery/worker/state.py#L240-L265)

## Publish and receive events

An enabled `EventDispatcher` filters event groups, constructs events with hostname, process ID, UTC offset and a logical clock, then publishes or buffers them. Buffered groups flush at the configured limit or through a send callback; outbound publication errors can be buffered for later flushing. This path serves observation and has its own buffering lifecycle, separate from a task's result storage.

Sources: [celery/events/dispatcher.py:135-162](repo://celery/events/dispatcher.py#L135-L162), [celery/events/dispatcher.py:164-213](repo://celery/events/dispatcher.py#L164-L213)

`EventReceiver` creates a node-specific queue on the configured event exchange, with routing key, TTL, expiration and durability/exclusivity settings. A queue cannot be both exclusive and durable. Its consumer uses `no_ack=True` and routes each event to a type-specific handler or wildcard handler. Capture runs the consuming loop, and waking workers can request heartbeats at startup. Serializer acceptance defaults to the configured event serializer plus JSON.

Sources: [celery/events/receiver.py:36-111](repo://celery/events/receiver.py#L36-L111)

## Reconstruct observed cluster state

`events.State` keeps worker and task caches with default limits of 5,000 and 10,000. Event processing is locked and updates worker/task records and relationships. Task state updates account for precedence and out-of-order events, preserving selected fields where an older event must not overwrite a newer state. This is a bounded in-memory reconstruction of observed activity, so its task history has a different retention boundary from the persisted results described in [[Results and State]].

Sources: [celery/events/state.py:305-333](repo://celery/events/state.py#L305-L333), [celery/events/state.py:407-432](repo://celery/events/state.py#L407-L432), [celery/events/state.py:501-514](repo://celery/events/state.py#L501-L514), [celery/events/state.py:540-603](repo://celery/events/state.py#L540-L603)
