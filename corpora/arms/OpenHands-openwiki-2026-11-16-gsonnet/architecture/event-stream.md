---
type: architecture
title: Event Stream, Actions and Observations
description: The EventStream pub/sub backbone — the Event/Action/Observation model, how events are id'd, redacted, serialized and persisted as per-event JSON files with cache pages, how subscribers receive them in order on dedicated threads, and how stores are read back.
tags: [events, event-stream, actions, observations, serialization, persistence]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:38:52.407Z
sources:
  - id: openwiki-source-2c7a0ad4eabf44e428f77fa8
    resource: repo://openhands/events/action/action.py
  - id: openwiki-source-701a82f1eabdb8f23acde9a3
    resource: repo://openhands/events/event_store.py
  - id: openwiki-source-4f87eda63a95851184e6f689
    resource: repo://openhands/events/nested_event_store.py
  - id: openwiki-source-88ac57b6c2795b607ef0d9ac
    resource: repo://openhands/events/serialization/event.py
  - id: openwiki-source-2f40e451df496f81af63b0fe
    resource: repo://openhands/events/stream.py
  - id: openwiki-source-f38350b0cd074145e71451f8
    resource: repo://openhands/runtime/base.py
  - id: openwiki-source-c7fbc0bab8bf4b6a1164a01c
    resource: repo://openhands/storage/locations.py
generated: { by: "claude-code", at: "2026-11-16T09:38:52.407Z" }
---

# Event Stream, Actions and Observations

Everything that happens in a conversation is an `Event`. The `EventStream` (`openhands/events/stream.py`) is the single hub through which the [AgentController](agent-controller.md), the [Runtime](../runtime/runtime-and-sandbox.md), `Memory`, the server `Session` and any security analyzer communicate. It is both a **durable log** (events are written to the file store) and a **pub/sub bus** (subscribers get callbacks).

## The event model

`Event` (`events/event.py`) is a dataclass whose metadata lives in underscore-prefixed attributes exposed as read-only properties: `id`, `timestamp`, `source` (`EventSource.AGENT | USER | ENVIRONMENT`), `cause` (the id of the event that triggered this one), `timeout`, `llm_metrics` and `tool_call_metadata`. Two subclasses:

- **`Action`** (`events/action/`): a request. `runnable` is a class variable — only runnable actions are executed by the runtime (`CmdRunAction`, `IPythonRunCellAction`, file read/write/edit, browse, `MCPAction`). Others are control/communication actions: `MessageAction`, `SystemMessageAction`, `ChangeAgentStateAction`, `AgentFinishAction`, `AgentRejectAction`, `AgentThinkAction`, `AgentDelegateAction`, `RecallAction`, `CondensationAction`, `CondensationRequestAction`, `TaskTrackingAction`, `NullAction`. Actions can carry `confirmation_state` (`ActionConfirmationStatus`) and `security_risk` (`ActionSecurityRisk`: UNKNOWN=-1, LOW, MEDIUM, HIGH).
- **`Observation`** (`events/observation/`): a result, always with a string `content`. Examples: `CmdOutputObservation`, `IPythonRunCellObservation`, `FileRead/Write/EditObservation`, `BrowserOutputObservation`, `MCPObservation`, `ErrorObservation`, `UserRejectObservation`, `RecallObservation`, `AgentStateChangedObservation`, `AgentDelegateObservation`, `AgentCondensationObservation`, `TaskTrackingObservation`, `NullObservation`.

The causal link is the `cause` field: the runtime sets `observation._cause = action.id` (and copies `tool_call_metadata`) so the controller can match results to its pending action, and `Memory` does the same for recall answers.

## Writing: `add_event`

`EventStream.add_event(event, source)`:

1. Rejects events that already have an id (`ValueError`), because re-adding an event from inside a handler would loop.
2. Under a lock, stamps the timestamp/source and assigns `id = cur_id; cur_id += 1`. Ids are therefore a gapless, monotonically increasing sequence per conversation. `cur_id` is computed lazily from the highest event filename on disk, so a restarted conversation continues numbering.
3. Serializes with `event_to_dict`, **replaces secret values** (`_replace_secrets` swaps every known secret string with `<secret_hidden>` in all string fields except a few top-level system fields such as `id`, `timestamp`, `source`, `cause`, `action`, `observation`, `message`), and re-hydrates the event from the redacted dict. Subscribers therefore only ever see the redacted version. Secrets are registered with `set_secrets`/`update_secrets` (provider tokens and custom secrets, see [Git providers](../integrations/git-providers.md)).
4. Writes the JSON to `<conversation dir>/events/<id>.json` (warning above ~1 MB), and appends the dict to an in-memory write page; whenever a page reaches `cache_size` (25) events, a combined page file `event_cache/<start>-<end>.json` is stored.
5. Puts the event on an internal `queue.Queue` for delivery.

Paths come from `storage/locations.py`: conversations live under `sessions/<sid>/` or, with a user id, `users/<user_id>/conversations/<sid>/`; sibling files include `metadata.json`, `init.json`, `agent_state.pkl`, `conversation_stats.pkl`. See [Storage](../server/storage-and-persistence.md).

## Delivery: subscribers

`subscribe(subscriber_id, callback, callback_id)` registers a callback under an `EventStreamSubscriber` enum value (`agent_controller`, `openhands_resolver`, `server`, `runtime`, `memory`, `main`, `test`) and creates a **dedicated single-worker `ThreadPoolExecutor` with its own asyncio event loop** for that callback. A daemon thread runs `_process_queue`, which takes events from the queue in order and, for each subscriber kind in sorted-name order and each callback, submits the callback to that callback's pool. Consequences:

- Event *delivery order* is the id order for each subscriber, and a slow subscriber never blocks the others (each has its own thread), but it can lag.
- Callbacks are synchronous entry points that run coroutines on their private loop (e.g. `AgentController.on_event` calls `run_until_complete`).
- Exceptions in callbacks are logged and re-raised by a done-callback rather than swallowed.
- Duplicate `callback_id` for the same subscriber raises; `unsubscribe` cancels the loop's tasks, closes the loop and shuts down the pool. `close()` sets a stop flag and joins the queue thread.

## Reading: `EventStore`

`EventStream` extends `EventStore` (`events/event_store.py`), which provides `search_events(start_id, end_id, reverse, filter, limit)`, `get_event`, `get_latest_event(_id)` and `filtered_events_by_source`. Reads first try the cache page covering the index (`index - index % cache_size`), then fall back to the individual event file; missing files are skipped. `EventFilter` supports excluding types and hidden events and is used for agent history (see the state tracker in [AgentController](agent-controller.md)). `session_exists` checks whether a conversation directory exists. `NestedEventStore` implements the same read interface over HTTP for conversations running in a nested/remote server, and an async wrapper exists for server routes.

## Serialization

`events/serialization/event.py` defines the JSON shape. `event_to_dict` emits top-level keys (`id`, `timestamp`, `source`, `message`, `cause`, `action` or `observation`, `tool_call_metadata`, `llm_metrics`) plus `args` (actions) or `content` and `extras` (observations); `event_from_dict` dispatches on the presence of `action` vs `observation` to the per-type registries in `serialization/action.py` and `serialization/observation.py`, then restores underscore metadata. For trajectories, `event_to_trajectory` strips bulky browser fields (`dom_object`, `axtree_object`, and optionally screenshots/set-of-marks).

## Design consequences

- The stream is the source of truth: agent history, resumability, replay (`ReplayManager`), the frontend event feed and trajectory downloads are all derived from it.
- Condensation never deletes events (see [Memory and condensation](../agents/memory-and-condensation.md)).
- Because ids are assigned at `add_event`, code that wants to re-publish an event (as the controller does after confirmation) must reset `_id` first.

Related: [Overview](overview.md), [Server and sessions](../server/server-and-sessions.md).
