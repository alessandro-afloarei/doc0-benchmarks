---
type: architecture
title: Events, state, and persistence
description: How conversation events are identified, persisted, delivered, redacted, and used for restoration or replay.
tags: [events, persistence, state, replay]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:43:51.947Z
sources:
  - id: openwiki-source-74d3fef77d7c1ea3b2bc0d11
    resource: repo://openhands/controller/replay.py
  - id: openwiki-source-f1695abdeda3aad0454e38f6
    resource: repo://openhands/controller/state/state.py
  - id: openwiki-source-701a82f1eabdb8f23acde9a3
    resource: repo://openhands/events/event_store.py
  - id: openwiki-source-2f40e451df496f81af63b0fe
    resource: repo://openhands/events/stream.py
  - id: openwiki-source-3627b67e8337b522b301f047
    resource: repo://openhands/storage/__init__.py
generated: { by: "codex", at: "2026-11-16T17:43:51.947Z" }
---

# Events, state, and persistence

The event stream joins the controller, runtime, memory, and browser-facing session. Actions describe intent; observations describe results. The persisted event log, controller snapshot, and sandbox filesystem have separate lifecycles: restoring a conversation does not by itself reconstruct the files on which earlier commands operated.

## Event identity and delivery

`EventStream.add_event` rejects events that already have an ID, stamps their time and source, and allocates the next ID under a lock. It serializes the event, replaces registered secret values, reconstructs the sanitized event, writes its JSON through `FileStore`, and only then queues it for subscribers. A handler must create a new event rather than feed the original event back into the stream.

Each subscriber callback has a single-worker executor and its own asyncio loop. The queue dispatches to these executors without waiting for each handler to finish. This gives serial execution within a callback, but it does not make all subscribers one synchronous transaction. The ID-allocation lock also does not cover the subsequent storage write and queue insertion; do not infer a global completion-order guarantee for concurrent producers.

Runtime observations carry the originating action ID in `cause`. Tool-call metadata travels with the observation so the controller and LLM conversation builder can pair calls with results. When debugging a stalled agent, inspect the outstanding action and its corresponding observation before blaming model inference.

## Storage and reads

`EventStore` discovers the next ID from existing event filenames. Reads deserialize individual JSON events, with pages of 25 events used as an optimization. Missing cache pages fall back to individual event files; a cache is not the sole source of history. Search supports source/type/query filters through `EventFilter`, direction, event ranges, and a result limit.

The file-store factory selects local, S3, or Google Cloud implementations; other names fall back to the in-memory store. Local storage requires a path. An optional webhook wrapper forwards writes, with a batched variant available. Check the actual configured backend before assuming a conversation survives process termination.

## Snapshots and replay

`State.save_to_session` serializes controller state using pickle encoded as base64. Conversation statistics are temporarily excluded because they persist independently. Restoration resets lifecycle state for resumption and includes compatibility handling for older snapshots. Treat these snapshots as trusted application artifacts: pickle restoration is not a safe interchange format for arbitrary uploads.

Trajectory replay is a different operation. `ReplayManager` skips environment events and null observations, advances to replayable actions, and lets the runtime execute them again. Imported replay events have their IDs cleared before reinsertion. Commands can produce different results if the sandbox contents or external services differ; replay is not deterministic restoration of historical observations.

## Secrets and extension boundaries

Secret replacement happens before both persistence and delivery. The implementation recurses through dictionaries and replaces registered values in strings, while preserving top-level system metadata such as ID, cause, timestamp, and action/observation type. It does not constitute a general secret detector, and this routine does not recurse into arbitrary lists. Register secrets before emitting events that can contain them.

When adding an event type, keep its action/observation representation, serialization, runtime handling, and frontend interpretation consistent. When adding a store, preserve the file-store contract and test rehydration as well as fresh writes.

## Verification and related pages

`tests/unit/events/test_event_stream.py` covers storage, rehydration, filtering, caches, subscriber changes, and redaction. Serialization tests live beside it; snapshot tests are in `tests/unit/controller/state/test_state.py`.

Continue with [system architecture](system.md), [server conversations](server-conversations.md), or [memory and condensation](../concepts/memory.md).
