---
type: subsystem
title: Events and the Event Stream
description: The Action/Observation event model, how EventStream assigns ids, masks secrets, persists events to the FileStore, and fans them out to subscribers on dedicated threads, and how EventStore reads and filters stored history.
tags: [events, event-stream, actions, observations, serialization, persistence]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:35:38.671Z
sources:
  - id: openwiki-source-ac28c5396a0c37ec08deb93e
    resource: repo://openhands/events/event_filter.py
  - id: openwiki-source-701a82f1eabdb8f23acde9a3
    resource: repo://openhands/events/event_store.py
  - id: openwiki-source-4f87eda63a95851184e6f689
    resource: repo://openhands/events/nested_event_store.py
  - id: openwiki-source-0f6f290b44f7287157cae4ae
    resource: repo://openhands/events/serialization/action.py
  - id: openwiki-source-88ac57b6c2795b607ef0d9ac
    resource: repo://openhands/events/serialization/event.py
  - id: openwiki-source-2f40e451df496f81af63b0fe
    resource: repo://openhands/events/stream.py
  - id: openwiki-source-f38350b0cd074145e71451f8
    resource: repo://openhands/runtime/base.py
  - id: openwiki-source-c7fbc0bab8bf4b6a1164a01c
    resource: repo://openhands/storage/locations.py
generated: { by: "claude-code", at: "2026-11-16T07:35:38.671Z" }
---

# Events and the Event Stream

Every interaction in an OpenHands conversation is an **event**: user and agent messages, agent tool calls, command output, state changes, and microagent recalls. Each conversation has one `EventStream` (`openhands/events/stream.py`). It holds the ordered history, it is what gets persisted, and it is the only channel that the [agent controller](agent-controller.md), the [runtime](../runtime/runtime-architecture.md), [memory](memory-and-condensers.md), and the [server](../server/web-server.md) use to talk to each other.

## The event model

`Event` (`openhands/events/event.py`) is a dataclass. Its metadata is kept in underscore attributes and read through properties:

| Property | Meaning |
| --- | --- |
| `id` | Sequence number assigned by the stream. `INVALID_ID = -1` until the event is added. |
| `timestamp` | ISO timestamp set when the event is added. |
| `source` | `EventSource.AGENT`, `USER`, or `ENVIRONMENT`. |
| `cause` | For observations, the id of the action that produced them. |
| `timeout` | Hard timeout for runnable actions (`set_hard_timeout`). |
| `tool_call_metadata` | The LLM tool call this event belongs to (see [Agents](../agents/agenthub.md)). |
| `llm_metrics`, `response_id` | Cost and token snapshot, and the LLM response id. |

There are two branches:

- **Actions** (`openhands/events/action/`) are intents. `Action.runnable` marks the ones the runtime executes: `CmdRunAction`, `IPythonRunCellAction`, `FileReadAction`, `FileWriteAction`, `FileEditAction`, `BrowseURLAction`, `BrowseInteractiveAction`, and `MCPAction`. The rest are control or conversational actions: `MessageAction`, `SystemMessageAction`, `AgentThinkAction`, `AgentFinishAction`, `AgentRejectAction`, `AgentDelegateAction`, `ChangeAgentStateAction`, `RecallAction`, `CondensationAction`, `CondensationRequestAction`, `TaskTrackingAction`, and `NullAction`. Actions can also carry an `ActionSecurityRisk` (`UNKNOWN=-1`, `LOW`, `MEDIUM`, `HIGH`) and an `ActionConfirmationStatus`.
- **Observations** (`openhands/events/observation/`) are results: `CmdOutputObservation`, `IPythonRunCellObservation`, file read/write/edit observations, browser output, `MCPObservation`, `ErrorObservation`, `AgentStateChangedObservation`, `AgentDelegateObservation`, `RecallObservation`, `AgentCondensationObservation`, `UserRejectObservation`, `FileDownloadObservation`, `TaskTrackingObservation`, `SuccessObservation`, and `NullObservation`.

The string type names come from `openhands/core/schema/action.py` and `observation.py`. Examples are `run`, `run_ipython`, `edit`, `call_tool_mcp`, `recall`, `condensation`, and `agent_state_changed`.

## Serialization

`openhands/events/serialization/` converts between events and plain dicts:

- `event_to_dict` puts the top-level keys first (`id`, `timestamp`, `source`, `message`, `cause`, `action`/`observation`, `tool_call_metadata`, `llm_metrics`, and others). For an action, the remaining dataclass fields go under `args`, with `security_risk` as its integer value and `timeout` included when set. For an observation, `content` gets its own key and everything else goes under `extras`. Enums and pydantic models such as command output metadata are flattened.
- `event_from_dict` → `action_from_dict` / `observation_from_dict` looks up the class with `ACTION_TYPE_TO_CLASS` / `OBSERVATION_TYPE_TO_CLASS` and translates deprecated arguments and extras, so older persisted conversations still load.
- `event_to_trajectory` is the trajectory export format. It removes heavy extras such as screenshots and accessibility trees unless asked to keep them.

The same dict format is used on disk, on the Socket.IO wire to the frontend, and in trajectory and replay files.

## Adding an event

`EventStream.add_event(event, source)`:

1. Rejects an event that already has an id. This catches handlers that re-add an event they received, which would cause a loop. Callers that really mean to re-add an event clear `_id` first; confirmation does this.
2. Stamps `timestamp` and `source`. Under a lock, assigns `id = cur_id` and increments `cur_id`. Ids are dense and strictly increasing within a conversation.
3. Serializes the event and **replaces secret values** with `<secret_hidden>` in every string field, recursing into nested dicts. Top-level system fields such as `id`, `source`, `cause`, `action`, `observation`, and `message` are skipped. The event is rebuilt from the masked dict, so subscribers only ever see masked data.
4. Writes the event as JSON to `…/events/{id}.json` in the `FileStore`. Events over about 1 MB log a warning. Every `cache_size` (25) events, it also writes a page file at `…/event_cache/{start}-{end}.json`.
5. Puts the event on an internal queue for delivery.

Secrets come from `set_secrets` / `update_secrets`. The [git provider integration](../integrations/git-providers.md) and custom-secrets loading call these so provider tokens and user secrets never appear in persisted or broadcast events.

### Storage layout

`openhands/storage/locations.py` decides the paths. A conversation lives at `sessions/{sid}/`, or at `users/{user_id}/conversations/{sid}/` when there is a user id. That directory holds `events/`, `event_cache/`, `metadata.json`, `init.json`, `agent_state.pkl`, `conversation_stats.pkl`, and `llm_registry.json`. See [Storage, Settings, Secrets, and Auth](../server/storage-and-settings.md).

## Subscribers and delivery

Components subscribe with `subscribe(subscriber_id, callback, callback_id)`. `EventStreamSubscriber` names the roles: `AGENT_CONTROLLER`, `RESOLVER`, `SERVER`, `RUNTIME`, `MEMORY`, `MAIN`, and `TEST`. A subscriber id can have several callbacks. Registering a callback id that already exists under the same subscriber raises `ValueError`.

Delivery model:

- A daemon thread runs `_process_queue` and takes events from the queue one at a time.
- For each event, it goes through the subscriber ids in **sorted order** and submits the callback to that callback's own `ThreadPoolExecutor(max_workers=1)`. Each pool thread has its own asyncio event loop.
- Each callback therefore sees events in stream order, and a slow callback doesn't hold up other subscribers. Callbacks still run concurrently with each other, so ordering *across* subscribers isn't guaranteed.
- When a callback raises, the error is logged and re-raised from the future's done-callback.
- `close()` stops the queue thread, cancels the subscribers' loops and pools, and empties the queue.

The usual round trip:

1. The controller publishes a runnable action.
2. The `RUNTIME` subscriber (`Runtime.on_event`) runs it. It sets `observation._cause = action.id`, copies the tool-call metadata, and publishes the observation. `NullObservation`s are not published.
3. The controller sees the observation, clears its pending action, and steps the agent again.
4. The `MEMORY` subscriber answers `RecallAction`s with `RecallObservation`s.
5. The `SERVER` subscriber forwards events to connected clients.

## Reading history: EventStore

`EventStore` (`openhands/events/event_store.py`) is the read side and the base class of `EventStream`:

- `cur_id` is computed lazily from the highest `{id}.json` in the events directory. That is how a reopened conversation continues numbering.
- `search_events(start_id, end_id, reverse, filter, limit)` yields events in either direction. It tries the 25-event cache page first, falls back to individual files, and silently skips missing files. It stops early when the process is shutting down.
- `EventFilter` (`event_filter.py`) filters by included or excluded types, source, date range, hidden flag, and a case-insensitive text query over the serialized event.
- `NestedEventStore` reads events over HTTP from a nested OpenHands server. It calls `{base_url}/events` with paginated search parameters. The docker-nested and SaaS conversation managers use it.
- `AsyncEventStoreWrapper` iterates a store asynchronously, using a thread for each read.

The controller rebuilds `State.history` from `search_events` with its own filter (see [Agent Controller](agent-controller.md#state-control-flags-and-persistence)). The server replays stored events to clients that reconnect, starting at a requested `latest_event_id`.

## Tests

`tests/unit/events/` covers stream behavior, serialization round-trips, secret masking, filters, and the nested event store.

## Related pages

- [Agent Controller and State](agent-controller.md)
- [System Architecture Overview](overview.md)
- [Storage, Settings, Secrets, and Auth](../server/storage-and-settings.md)
- [Runtime Architecture](../runtime/runtime-architecture.md)
