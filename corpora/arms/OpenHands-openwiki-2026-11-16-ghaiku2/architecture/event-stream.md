---
type: architecture-component
title: Event Stream, Actions, and Observations
description: The EventStream publish-subscribe hub that connects the agent controller, runtime, and server; the Action and Observation event model; how events are persisted, redacted of secrets, dispatched to subscribers, and read back.
tags: [event-stream, events, actions, observations, pubsub, persistence, secrets, serialization]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:30:54.023Z
sources:
  - id: openwiki-source-701a82f1eabdb8f23acde9a3
    resource: repo://openhands/events/event_store.py
  - id: openwiki-source-d89a4946f2f4fb87fcd1db95
    resource: repo://openhands/events/event.py
  - id: openwiki-source-88ac57b6c2795b607ef0d9ac
    resource: repo://openhands/events/serialization/event.py
  - id: openwiki-source-2f40e451df496f81af63b0fe
    resource: repo://openhands/events/stream.py
generated: { by: "claude-code", at: "2026-11-16T18:30:54.023Z" }
---

# Event Stream, Actions, and Observations

Every component in OpenHands communicates through one ordered log of events. The agent controller publishes actions, the runtime publishes observations, the server publishes user messages, and each of them subscribes to the events it needs. `EventStream` (`openhands/events/stream.py`) is the hub. It is a per-conversation object, keyed by session ID and optional user ID, and it persists every event as it is added.

## Event model

`Event` (`openhands/events/event.py`) is the base type. It carries an integer `id` (assigned by the stream, with `INVALID_ID = -1` before assignment), a `timestamp`, a `source`, an optional `cause` (the ID of the event this one responds to), optional `llm_metrics`, `tool_call_metadata`, and a `hidden` flag.

`EventSource` has three values: `AGENT`, `USER`, and `ENVIRONMENT`. The source records who produced the event, not what it does.

Two families derive from `Event`:

- **`Action`** (`openhands/events/action/`) requests something, such as `CmdRunAction`, `IPythonRunCellAction`, file read and edit actions, `BrowseInteractiveAction`, `MCPAction`, `MessageAction`, `AgentDelegateAction`, `AgentFinishAction`, `CondensationAction`, and `ChangeAgentStateAction`. Actions carry a confirmation state and a security-risk value (`ActionConfirmationStatus`, `ActionSecurityRisk`), which the controller uses for gating.
- **`Observation`** (`openhands/events/observation/`) reports what happened, such as `CmdOutputObservation`, `IPythonRunCellObservation`, file observations, `ErrorObservation`, `AgentStateChangedObservation`, `AgentCondensationObservation`, and `NullObservation`.

There are about 38 concrete action and observation classes in total. The `cause` field links an observation back to the action it answers, which is how the controller matches results to pending actions.

## Publishing: `add_event`

`EventStream.add_event(event, source)` (`stream.py` ~L163-L204) runs under one lock and in this order:

1. It rejects an event that already has an ID (`ValueError`). This prevents an event being re-added from inside a handler and creating a loop.
2. It stamps the timestamp and source and assigns the next integer ID from `cur_id`.
3. It serializes the event with `event_to_dict`, applies secret redaction (`_replace_secrets`), and rebuilds the in-memory event with `event_from_dict`. The redacted copy is what subscribers receive.
4. It appends the record to the current write page and starts a new page when the page reaches `cache_size` (25, from `EventStore`).
5. Outside the lock it writes the event JSON to the file store under its ID-based filename, warns when the JSON exceeds about 1 MB, and then writes the full cache page if one was completed.
6. Only then does it place the event on the in-process queue (`self._queue.put(event)`).

Because persistence happens before delivery, an event a subscriber sees is always already stored, so the file-backed log is the record that a later read or replay works from.

## Secret redaction

`_replace_secrets` (~L221-L243) replaces every registered secret value in string fields with `<secret_hidden>`. It recurses into nested dictionaries. Top-level system fields (`timestamp`, `id`, `source`, `cause`, `action`, `observation`, `message`) are skipped so that the event type and identity survive. Secrets are set with `set_secrets` (full replacement) or `update_secrets` (merge). The provider integration (`openhands/integrations/provider.py`, ~L354) and the user-secrets store (`openhands/storage/data_models/user_secrets.py`, ~L148) call `set_secrets` with the values they hold.

Redaction is applied to what is stored and what is published. It is not a guarantee that a secret never reaches the model: the agent's own prompts are built from events, so the stream only prevents secrets from being persisted or echoed to other subscribers in plain text.

## Subscribing and dispatch

`subscribe(subscriber_id, callback, callback_id)` (~L130-L148) registers a callback. Each callback gets its own single-worker `ThreadPoolExecutor`, so one subscriber's callback runs in order and cannot block another. `subscriber_id` is one of `EventStreamSubscriber` (`stream.py` ~L23-L31): `agent_controller`, `openhands_resolver`, `server`, `runtime`, `memory`, `main`, and `test`. Duplicate `(subscriber_id, callback_id)` pairs raise `ValueError`.

A background thread runs `_process_queue` (~L246-L275). It takes each event off the queue and submits it to every callback, iterating subscribers in sorted key order. Callback exceptions are logged and re-raised in the completion handler (`_make_error_handler`, ~L277-L291), so failures are not silently dropped.

Delivery is asynchronous with respect to `add_event`. Subscribers see events in ID order per callback, but there is no guarantee that two different subscribers have processed the same event at the same moment.

## Reading back: `EventStore` and filters

`EventStore` (`openhands/events/event_store.py`) reads events by ID. It uses cache pages of 25 events when they exist, falls back to individual files when they do not, and keeps a cursor `cur_id` recalculated from the stored files at startup (`_calculate_cur_id`). `search_events(start_id, end_id, reverse, filter, limit)` (~L85-L137) walks an ID range, applies an `EventFilter` (`event_filter.py`, which can include or exclude by type and source), and skips events that cannot be read. `EventStore` also exposes `get_latest_event` and `filtered_events_by_source`.

Serialization is in `openhands/events/serialization/`. `event_from_dict` (`serialization/event.py` ~L52-L59) decides the concrete class from the presence of an `action` or `observation` key and then delegates to `action_from_dict` or `observation_from_dict`. Those functions also normalize deprecated argument and extras names (`handle_action_deprecated_args`, `handle_observation_deprecated_extras`).

## Invariants

- IDs are unique and monotonically assigned within a stream, under a lock.
- An event is persisted before it is published.
- An event object is added at most once; re-adding an identified event is an error.
- Subscribers receive the redacted copy built in `add_event`, not the original object.

## Failure behavior

- A failure to write an event propagates from `add_event` to the caller before the event is queued, so no subscriber sees an event that was not stored.
- A subscriber callback that raises is logged; the stream keeps delivering to other subscribers.
- A very large event (over about 1 MB of JSON) is still stored, with a warning.

## Extension seams

- A new action or observation is a subclass of `Action` or `Observation` with a serialization branch in the matching `serialization/*.py` module.
- A new consumer registers a callback with `subscribe` under an existing or new `EventStreamSubscriber` value.
- A new `EventFilter` can narrow `search_events` without changing the store.

## Representative tests

- `tests/unit/events/` covers the event classes, serialization, and filtering. Start with the files that exercise `event_store` and `stream`.
- `tests/unit/controller/test_agent_controller.py` exercises the controller's use of the stream end to end.

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/agent-controller.md] link "/openwiki/architecture/agent-controller.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Agent Controller and Step Loop](/openwiki/architecture/agent-controller.md)
<!-- openwiki: broken internal link [/openwiki/architecture/runtime-sandbox.md] link "/openwiki/architecture/runtime-sandbox.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Runtime and Sandbox Execution](/openwiki/architecture/runtime-sandbox.md)
<!-- openwiki: broken internal link [/openwiki/architecture/storage-persistence.md] link "/openwiki/architecture/storage-persistence.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Storage, Persistence, and Secrets](/openwiki/architecture/storage-persistence.md)
<!-- openwiki: broken internal link [/openwiki/architecture/server-sessions.md] link "/openwiki/architecture/server-sessions.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Server, Sockets, and Conversation Sessions](/openwiki/architecture/server-sessions.md)
