---
type: architecture
title: Events and persistence
description: Event identity, asynchronous subscribers, storage backends and controller snapshots that support conversation history and restoration.
tags: [events, storage, persistence, serialization]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:55:05.802Z
sources:
  - id: openwiki-source-f1695abdeda3aad0454e38f6
    resource: repo://openhands/controller/state/state.py
  - id: openwiki-source-701a82f1eabdb8f23acde9a3
    resource: repo://openhands/events/event_store.py
  - id: openwiki-source-2f40e451df496f81af63b0fe
    resource: repo://openhands/events/stream.py
  - id: openwiki-source-3627b67e8337b522b301f047
    resource: repo://openhands/storage/__init__.py
  - id: openwiki-source-c7fbc0bab8bf4b6a1164a01c
    resource: repo://openhands/storage/locations.py
generated: { by: "codex", at: "2026-11-16T16:55:05.802Z" }
---

# Events and persistence

## History is the shared boundary

Actions describe intent; observations describe results. The controller, runtime, memory and server exchange these through `EventStream`, which extends the persisted `EventStore`. Serialization in `openhands/events/serialization/` is the contract shared by disk, replay and the browser. Adding an event type therefore requires checking serializers and consumers as well as its Python class.

`add_event` rejects an event that already has an ID, preventing accidental reinsertion from a subscriber. It stamps the source and timestamp, allocates an ID under a lock, serializes and masks configured secrets, then recreates the event from that representation. It writes the individual JSON record and cache page before placing the event on the delivery queue. A storage-write failure occurs before normal subscriber delivery; there is no transaction spanning persistence and arbitrary subscriber side effects.

## Delivery and reads

Each subscriber callback has its own single-worker executor and event loop. The queue submits events to callback pools in subscriber-key order, preserving serial work within each callback while permitting different callbacks to progress independently. Submission order does not establish that one subscriber has completed before another starts. Callback failures are logged through a future completion handler.

`EventStore` calculates the next ID from the largest stored event filename. Searches support bounds, direction, limits and filters. Cache pages accelerate reads, but missing pages fall back to individual event files; missing individual records are skipped during search. Treat the cache as an optimization rather than a second source of truth.

## What is persisted where

| State | Owner and representation |
| --- | --- |
| Event history | `EventStore`, individual numbered JSON files and cached pages |
| Controller snapshot | `State`, base64-encoded pickle at `agent_state.pkl` |
| Conversation metadata and initialization | Conversation store and services, separate JSON records |
| Model registry and conversation statistics | Dedicated registry/statistics persistence |
| User settings and secrets | Configurable settings/secrets stores, separate from history |
| Workspace files | Runtime storage and mounts, outside the event log |

`storage/locations.py` uses `sessions/<sid>/` without a user ID and `users/<user_id>/conversations/<sid>/` with one. This path layout is storage organization; authorization belongs to the server's validators and auth dependencies. Controller snapshots contain Python objects and must be treated as trusted application state, not accepted as arbitrary user uploads.

The file-store factory selects local, S3 or Google Cloud storage; other type strings fall back to in-memory storage. Local storage requires a path. An optional webhook wrapper mirrors writes through immediate or batched delivery. `FileStore` defines read, write, list and delete, while higher-level stores own schemas and user scoping. The default file settings store writes settings with secrets exposed for persistence, so event masking should not be interpreted as encryption of all stored data.

## Extending and checking persistence

Start with [stream.py](../../openhands/events/stream.py), [event_store.py](../../openhands/events/event_store.py), [locations.py](../../openhands/storage/locations.py) and the [file-store factory](../../openhands/storage/__init__.py). Check `tests/unit/events/test_event_stream.py`, event serialization tests, `tests/unit/storage/test_storage.py` and backend-specific tests when changing these contracts.

See [conversations](conversations.md) for replay and restoration, [agent loop](../concepts/agent-loop.md) for action-result correlation, and [quickstart](../quickstart.md) for development entrypoints.
