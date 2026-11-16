---
type: architecture
title: Event Model and Event Stream
description: The Action and Observation event taxonomy, how events are assigned IDs, redacted, persisted in page-based files, delivered to subscriber thread pools, and searched or filtered for replay and UI display.
tags: [events, event-stream, actions, observations, persistence, subscribers, serialization]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T11:08:31.416Z
sources:
  - id: openwiki-source-2129d0084f64a3f5714baf90
    resource: repo://openhands/controller/agent_controller.py
  - id: openwiki-source-ac28c5396a0c37ec08deb93e
    resource: repo://openhands/events/event_filter.py
  - id: openwiki-source-701a82f1eabdb8f23acde9a3
    resource: repo://openhands/events/event_store.py
  - id: openwiki-source-d89a4946f2f4fb87fcd1db95
    resource: repo://openhands/events/event.py
  - id: openwiki-source-2f40e451df496f81af63b0fe
    resource: repo://openhands/events/stream.py
  - id: openwiki-source-f38350b0cd074145e71451f8
    resource: repo://openhands/runtime/base.py
  - id: openwiki-source-6ad084be807b719c27089491
    resource: repo://openhands/server/routes/trajectory.py
generated: { by: "claude-code", at: "2026-11-16T11:08:31.416Z" }
---

# Event Model and Event Stream

Every interaction in an OpenHands conversation is an **event**. Agents emit *actions* (what to
do), the runtime and tools emit *observations* (what happened), and the system emits environment
and state-change events. The `EventStream` is the single append-only log for a conversation, and
components communicate by subscribing to it. This is the backbone that connects the
[Agent Controller](agent-controller.md), the [Runtime](runtime.md), memory, and the server.

## Event taxonomy

`Event` (`openhands/events/event.py:36`) is the base class. Its metadata includes an integer `id`
(`INVALID_ID = -1` until the stream assigns one), `timestamp`, `source`, `cause` (the ID of the
event that triggered this one), an optional hard `timeout`, LLM metrics, tool-call metadata, and a
response ID. `EventSource` has three values: `AGENT`, `USER`, and `ENVIRONMENT`.

**Actions** (`openhands/events/action/`) include:

- messages and control: `MessageAction`, `SystemMessageAction`, `NullAction`,
  `AgentFinishAction`, `AgentRejectAction`, `AgentThinkAction`, `ChangeAgentStateAction`;
- execution: `CmdRunAction`, `IPythonRunCellAction`, `BrowseURLAction`,
  `BrowseInteractiveAction`, `FileReadAction`, `FileWriteAction`, `FileEditAction`, `MCPAction`;
- delegation and memory: `AgentDelegateAction`, `RecallAction`, `CondensationAction`,
  `CondensationRequestAction`, `TaskTrackingAction`.

Only actions with `runnable = True` perform work in the runtime; a non-runnable action is answered
with a `NullObservation` (`openhands/runtime/base.py`, `run_action`). Actions carry a
`ActionSecurityRisk` value and an `ActionConfirmationStatus` used by confirmation mode.

**Observations** (`openhands/events/observation/`) are the results: `CmdOutputObservation`,
`IPythonRunCellObservation`, `BrowserOutputObservation`, `FileReadObservation`,
`FileEditObservation`, `MCPObservation`, `ErrorObservation`, `UserRejectObservation`,
`AgentStateChangedObservation`, `AgentDelegateObservation`, `AgentCondensationObservation`,
`RecallObservation`, `TaskTrackingObservation`, and `NullObservation`. Each observation is tied to
its triggering action by `cause`.

## Assigning IDs and appending

`EventStream.add_event(event, source)` (`openhands/events/stream.py:163-203`) is the only write path:

1. It rejects events that already have an ID. This catches an event being re-added from inside a
   handler, which would otherwise loop forever.
2. Under a lock, it stamps the timestamp and source, assigns the next integer ID, and advances
   `cur_id`.
3. It serializes the event with `event_to_dict`, replaces any known secret values with
   `<secret_hidden>`, and deserializes the result back into an event. Redaction happens before
   anything is written to disk or delivered to subscribers.
4. It appends the record to the in-memory write page, and starts a new page when the page reaches
   `cache_size`.
5. It writes the event JSON to the file store under the conversation's directory, warns above about
   1 MB, and writes a completed cache page for fast range reads.
6. It enqueues the event for delivery.

Secrets are stored with `set_secrets` and `update_secrets`. Replacement applies to nested string
fields but skips protected top-level metadata fields such as `id`, `source`, `timestamp`, and
`message` (`stream.py:221-244`).

## Persistence layout

`EventStore` (`openhands/events/event_store.py`) reads what the stream writes. Each event is one
file named by its ID. Completed runs of `cache_size` events (default 25, `event_store.py:50`) are
also written as a single JSON page under `event_cache/<start>-<end>.json`, so replay and search do
not open thousands of small files. A page that is not yet written is simply bypassed. `cur_id` is
recalculated from the files on disk when a conversation is reopened (`_calculate_cur_id`), so IDs
continue after a restart.

Serialization is in `openhands/events/serialization/`. `event_to_dict` (`serialization/event.py:100`)
emits top-level keys and an `action` or `observation` discriminator, and `event_from_dict`
(`serialization/event.py:52`) dispatches back to `action_from_dict` or `observation_from_dict`.
`event_to_trajectory` produces the shape used for saved trajectories, with optional screenshots.
Deprecated argument names are translated in the per-type serializers (`handle_action_deprecated_args`,
`handle_observation_deprecated_extras`).

## Delivery to subscribers

`EventStream.subscribe(subscriber_id, callback, callback_id)` (`stream.py:130`) registers a
callback under a subscriber key. Keys come from `EventStreamSubscriber` (`stream.py:23-33`):
`agent_controller`, `openhands_resolver`, `server`, `runtime`, `memory`, `main`, and `test`.

Delivery runs on a background thread (`_run_queue_loop` and `_process_queue`,
`stream.py:246-276`). The loop pulls from a `queue.Queue`, then for each subscriber key in sorted
order submits the event to that callback's own single-worker `ThreadPoolExecutor`. Each callback
therefore sees events in order, while different callbacks run concurrently. Callback exceptions
are handled by an error handler attached to each future rather than stopping the loop.

Current subscribers, as found by search:

- the `AGENT_CONTROLLER` subscriber, registered by each `AgentController` (`agent_controller.py:168`);
- the `RUNTIME` subscriber (`openhands/runtime/base.py:149`), which turns each `Action` into an
  observation through `Runtime.on_event` (`runtime/base.py:321-323`);
- the `MEMORY` subscriber (`openhands/memory/memory.py:64`);
- the `SERVER` subscriber for each session (`openhands/server/session/session.py:99`);
- the `MAIN` subscriber used by headless and CLI runs (`openhands/core/main.py:205`,
  `openhands/cli/main.py:312`) and the resolver (`openhands/resolver/issue_resolver.py:423`).

Because delivery is asynchronous, a component that needs to observe its own writes should subscribe
rather than read the file store immediately.

## Searching and filtering

`EventStore.search_events(start_id, end_id, reverse, filter, limit)` (`event_store.py:85`) is the
read API used for replay, for the REST event search endpoint (`openhands/server/routes/conversation.py`),
and for trajectory export. Results are filtered by `EventFilter`
(`openhands/events/event_filter.py:9-98`), which can exclude hidden events, match text, include or
exclude event types, filter by source, and bound by date. Trajectory export uses
`EventFilter(exclude_hidden=True)` (`openhands/server/routes/trajectory.py:34`).

`NestedEventStore` (`openhands/events/nested_event_store.py`) is a windowed read view over a list
of events. It supports the same `search_events` interface with start and end bounds. `AsyncEventStoreWrapper` (`async_event_store_wrapper.py`) exposes
the synchronous store to async callers.

## Failure and ordering semantics

- IDs are monotonically assigned under a lock, so the on-disk order matches the delivery order.
- A write failure in the file store raises out of `add_event` and the event is not delivered;
  callers do not receive a silent partial record.
- Secrets are redacted before persistence, so a secret set after an event was written is not
  retroactively removed from the earlier file.
- Each subscriber has its own worker, so a slow subscriber delays only its own queue, not others.

## Extension seams

- New event types: add a dataclass under `events/action` or `events/observation`, register it in
  the matching serializer, and make it `runnable` only if the runtime should execute it.
- New subscriber: add a key to `EventStreamSubscriber` and call `subscribe` with a unique callback ID.

## Tests

`tests/unit/events/` covers serialization round trips (`test_event_serialization.py`,
`test_action_serialization.py`, `test_observation_serialization.py`), stream behavior
(`test_event_stream.py`), and nested stores (`test_nested_event_store.py`).
