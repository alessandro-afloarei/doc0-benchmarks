---
type: concept
title: Events, state, and recovery
description: Durable event identity, asynchronous subscriber delivery, action-observation causality, controller checkpoints, and delegation boundaries.
tags: [events, state, persistence, recovery]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:50:03.393Z
sources:
  - id: openwiki-source-2129d0084f64a3f5714baf90
    resource: repo://openhands/controller/agent_controller.py
  - id: openwiki-source-f1695abdeda3aad0454e38f6
    resource: repo://openhands/controller/state/state.py
  - id: openwiki-source-2f40e451df496f81af63b0fe
    resource: repo://openhands/events/stream.py
generated: { by: "codex", at: "2026-11-16T06:50:03.393Z" }
---

# Events, state, and recovery

The event store is the durable conversation record. The event stream adds publication to that store. Controller State is a checkpoint and working projection of relevant history; the model's condensed context is another projection. These representations have different owners and should not be treated as interchangeable.

## Identity and publication

Actions express decisions or requests; observations carry execution results or environment feedback. Serialized events retain ID, timestamp, source, cause, tool-call metadata, and LLM metrics. Actions serialize under an action discriminator and observations under an observation discriminator.

`EventStream.add_event` rejects an event that already has an ID, assigns its timestamp and source, and allocates an ID under a lock. It serializes the event, applies configured secret replacement, reconstructs a normalized event, writes individual JSON and any full cache page, and then queues publication. EventStore recovers the next ID from the highest persisted event filename and supports forward/reverse filtered searches. Missing cache pages fall back to individual events; cache pages are an optimization.

Each subscription has its own single-worker thread pool and event loop. The queue submits events to subscribers in sorted subscriber-name order, but does not wait for one subscriber to complete before scheduling another. A subscriber's callbacks are serialized by its worker; callback completion across subscribers is not a global ordering guarantee. Do not use subscription name order as a synchronization protocol.

Secret replacement recursively visits dictionaries and string values, with selected top-level metadata fields protected. It is a targeted mechanism using registered secrets, not an assertion that all possible payload shapes or logs are sanitized.

## Runnable actions and causal feedback

A runnable agent action becomes the controller's pending action. Runtime feedback preserves tool-call metadata and sets `observation.cause` to the action ID. The controller clears its pending action only for a matching cause and does not clear it while awaiting confirmation. This prevents unrelated observations from releasing a blocked execution step.

The controller steps only while RUNNING and without a pending action. Messages, tool results, and condensation events can trigger another step; state-change observations alone do not. Long-pending-action messages after 60 seconds are diagnostics and do not clear the action or impose a timeout. Runtime timeouts are configured and enforced separately.

Confirmation produces another recorded action after approval or rejection: the controller updates confirmation status, clears the action's old ID, and appends it again. See [configuration and security](../operations/configuration.md) for the execution gate.

## State and restoration

State holds agent lifecycle, history bounds, task inputs/outputs, delegate level, errors, and budget/iteration control flags. StateTracker filters hidden, null, and state-control events out of model-facing history, synchronizes accounting, and manages persistence.

Checkpoints use base64-encoded Python pickle. `State.__getstate__` omits history and view caches; controller initialization explicitly reloads history from the event stream. Restore records a resumable previous lifecycle in `resume_state` where applicable and initially sets the agent to LOADING. A checkpoint alone is therefore insufficient for full conversation recovery, and its contents are application-owned Python state rather than a portable trajectory format.

Controller lifecycle transitions emit AgentStateChangedObservation and trigger state saving. Web reconnect separately replays persisted events to the client; it is not the same operation as restoring controller state. See [conversation server](../architecture/conversation-server.md).

## Delegation

A delegate uses the parent's event stream, LLM registry, conversation statistics, and shared iteration/budget flags, with its own State and start position. It is created without a direct stream subscription: the parent forwards events to it while it is active. This avoids competing parent and child callbacks stepping on the same input.

When the delegate finishes, is rejected, or errors, the parent closes it and emits an AgentDelegateObservation containing its outputs or failure description. The parent's reconstructed history suppresses the delegate's internal event range while retaining the delegation action and result. Shared control flags ensure delegation does not reset task-wide limits.

## Change and test boundaries

A new event type affects action/observation construction, schema enums, serialization, runtime dispatch, history filtering, and browser types/guards. Test both round trips and causal behavior. Useful focused suites include `tests/unit/events/test_event_stream.py` (storage, rehydration, filtering, caching, secrets), `tests/unit/controller/test_agent_controller.py`, `test_agent_delegation.py`, and `controller/state/`.

Continue to [execution architecture](../architecture/execution.md) for component assembly and [memory](memory.md) for recall and context views.
