---
type: architecture
title: Events and durable conversation state
description: Event IDs, serialization, dispatch, storage layout, secret filtering, and the separate controller checkpoint used to restore conversations.
tags: [events, storage, persistence, sessions]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T08:14:39.912Z
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
generated: { by: "codex", at: "2026-11-16T08:14:39.912Z" }
---

# Events and durable conversation state

The event log is the shared record of actions and observations. `EventStore` reads that record; `EventStream` adds publication and subscribers. Controller checkpoints, conversation metadata, initialization data, and model statistics are separate artifacts. Restoring a conversation involves more than reopening a socket.

## Publication and execution ordering

`EventStream.add_event` rejects events that already carry an ID, preventing accidental republication loops. It stamps the event's time and source, assigns an incrementing ID under a lock, serializes it, applies configured secret replacement, and reconstructs the event from that filtered data. The filtered representation is both stored and delivered.

Each event is written to its own JSON file before it enters the dispatch queue. Cache pages are written after individual events. The store derives its next ID from the highest stored event filename when necessary. This is an ordered event history, but not a transactional database: ID assignment, persistence, cache writes, and queue dispatch are separate operations.

The dispatch queue submits callbacks in sorted subscriber order. Each callback has its own executor/event-loop resources, so submission order does not mean every subscriber finishes processing before another starts. Closing the stream stops its queue thread, cleans up subscribers, and drains the queue.

Actions and observations share metadata such as ID, source, timestamp, tool-call metadata, and model metrics. An observation's `cause` associates it with the action being answered. The [controller](agent-control.md) uses that relation to release its pending-action barrier.

## Persistence layout

The location helpers use these relative paths beneath the configured file store:

| Artifact | Without a user ID | With a user ID |
| --- | --- | --- |
| Conversation directory | `sessions/<sid>/` | `users/<user_id>/conversations/<sid>/` |
| Events | `events/<id>.json` inside the directory | Same suffix |
| Metadata and initialization | `metadata.json`, `init.json` | Same suffixes |
| Controller checkpoint | `agent_state.pkl` | Same suffix |
| Model registry and statistics | `llm_registry.json`, `conversation_stats.pkl` | Same suffixes |

`get_file_store` selects local, S3, or Google Cloud implementations. Other type values fall back to the in-memory implementation; a misspelled store type can therefore have durability consequences. Local storage requires a path. Optional webhook wrappers forward writes, with a batched variant available.

The application-level conversation, settings, and secret stores are separately selected by server configuration. A file-store choice alone does not describe enterprise database storage.

## Checkpoint restoration

`State.save_to_session` serializes state with pickle and base64. It temporarily excludes the conversation-statistics object, and `__getstate__` removes history and derived view caches. History is reconstructed from events rather than copied into the checkpoint.

Restore decodes and unpickles the checkpoint. For user-scoped sessions it can fall back to the older unscoped location. A previously resumable agent state is saved as `resume_state`; the restored state itself starts at `LOADING`. Session/controller initialization then reconnects runtime and history. These checkpoints are application-controlled serialized Python objects and should not be treated as arbitrary user-importable documents.

A client replay is a different operation: the server streams events after the client's latest event ID. See [sessions and APIs](sessions-api.md) for replay filtering and reconnect behavior.

## Secret filtering and limitations

Secret replacement is driven by explicitly registered secret values. It recursively visits dictionary values and replaces matching substrings in strings with `<secret_hidden>`. Top-level system fields such as ID, source, action/observation kind, and message are protected from replacement. The current helper does not recursively traverse arbitrary lists. Consequently, this filter is useful protection for known values, not a general-purpose guarantee that all possible sensitive content is removed.

Provider/custom-secret registration belongs to session startup and runtime integration. Check registration and payload shape when investigating an unexpected disclosure or an unexpectedly modified event.

## Extension and verification

A new event type needs compatible action/observation deserialization and frontend handling, not just a Python dataclass. Use `tests/unit/events/test_event_serialization.py`, action/observation serialization tests, and `test_event_stream.py` to check round trips, storage, subscription behavior, and filtering. State compatibility is covered under `tests/unit/controller/state/`.

For missing history, inspect the selected store, user-scoped path, stored IDs, and restore logs before inspecting the UI. For environment and deployment choices, continue to [configuration](../operations/configuration.md).
