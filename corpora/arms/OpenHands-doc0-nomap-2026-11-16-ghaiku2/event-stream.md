---
title: "Event Stream"
---
## Overview

`EventStream` is the one ordered log of a conversation and the bus that delivers each new event to the parts that react to it. The controller, the runtime, the memory and the server each subscribe under their own subscriber ID. Every event added to the stream gets the next number, is written to the file store, and is then passed to each subscriber on a background thread. The stream is the only channel between those parts, so the order of events on it is the order in which the agent's history is built. The class is described here; the event types it carries are on [[Event Model]].

Sources: [openhands/events/stream.py:43-55](repo://openhands/events/stream.py#L43-L55), [openhands/events/stream.py:23-31](repo://openhands/events/stream.py#L23-L31)

## Adding an event

`add_event` refuses an event that already has an ID, which catches an event that was added once and then re-added from inside a handler. Otherwise it stamps the event with a timestamp and its source, and, under a lock, gives it the next ID from `cur_id` and copies it into the current write page. Secrets are replaced in the copy before anything is stored. Only after that does the event get written to its own file and queued for delivery.

Sources: [openhands/events/stream.py:163-204](repo://openhands/events/stream.py#L163-L204)

The lock covers the ID and the page only. The file write happens outside it, so two threads can write files in parallel, and the event's ID, not its write time, is what orders the history. The write-page cache is stored last, so a reader that finds the page missing simply reads the single-event files instead.

Sources: [openhands/events/stream.py:186-204](repo://openhands/events/stream.py#L186-L204), [openhands/events/event_store.py:138-142](repo://openhands/events/event_store.py#L138-L142)

Each event is written to `<id>.json` in the conversation's events directory. When a write page fills up (25 events by default), the page is also stored as one cache file named by its start and end IDs, so a later read can load 25 events in one file read.

Sources: [openhands/events/event_store.py:44-52](repo://openhands/events/event_store.py#L44-L52), [openhands/events/event_store.py:155-176](repo://openhands/events/event_store.py#L155-L176), [openhands/events/stream.py:205-214](repo://openhands/events/stream.py#L205-L214)

## Delivering events

`subscribe` takes a subscriber ID, a callback and a callback ID. Each callback gets its own pool with one worker thread, so the events a callback receives run in order and never in parallel with each other. A callback ID may be registered once per subscriber; registering it again raises an error. `unsubscribe` removes the callback from the subscriber's table.

Sources: [openhands/events/stream.py:130-162](repo://openhands/events/stream.py#L130-L162), [openhands/events/stream.py:93-129](repo://openhands/events/stream.py#L93-L129)

A background thread runs its own event loop and takes events from the queue. For each one it calls every subscriber in sorted order of subscriber ID, and each callback is submitted to that subscriber's pool. A callback that raises is logged through an error handler and does not stop the others.

Sources: [openhands/events/stream.py:246-276](repo://openhands/events/stream.py#L246-L276), [openhands/events/stream.py:277-291](repo://openhands/events/stream.py#L277-L291)

The subscriber IDs in use are `agent_controller`, `runtime`, `memory`, `server`, `openhands_resolver` and `main`, and the call site registers each one: the controller and the runtime when they start, the memory when it is created, and the server's session for the socket channel.

Sources: [openhands/events/stream.py:23-31](repo://openhands/events/stream.py#L23-L31), [openhands/controller/agent_controller.py:166-172](repo://openhands/controller/agent_controller.py#L166-L172), [openhands/runtime/base.py:147-152](repo://openhands/runtime/base.py#L147-L152), [openhands/server/session/session.py:97-102](repo://openhands/server/session/session.py#L97-L102)

Because delivery is asynchronous, a subscriber does not see an event at the moment it is added. The controller relies on the order of IDs, not on timing, to match an observation to its action.

Sources: [openhands/events/stream.py:254-276](repo://openhands/events/stream.py#L254-L276), [openhands/controller/agent_controller.py:519-547](repo://openhands/controller/agent_controller.py#L519-L547)

## Secrets

Secrets are the values the stream must not store in plain text. `set_secrets` replaces the table, and `update_secrets` merges into it. On every add, each string in the event data is searched for each secret value, and each match is replaced with `<secret_hidden>`.

Sources: [openhands/events/stream.py:215-220](repo://openhands/events/stream.py#L215-L220), [openhands/events/stream.py:221-245](repo://openhands/events/stream.py#L221-L245)

The protected top-level fields are the ID, timestamp, source, cause, the action and observation names, and the message. Those are left alone, so the event's structure stays readable; the content inside an event is still searched.

Sources: [openhands/events/stream.py:221-244](repo://openhands/events/stream.py#L221-L244)

## Reading the stream

`search_events` returns events from a start ID to an end ID, optionally reversed, filtered by an `EventFilter`, and capped by a limit. Events are loaded from the page cache when a page covers them and from their own file otherwise. `get_latest_event_id` and `filtered_events_by_source` are the other readers.

Sources: [openhands/events/event_store.py:85-137](repo://openhands/events/event_store.py#L85-L137), [openhands/events/event_store.py:144-154](repo://openhands/events/event_store.py#L144-L154)

Events are kept in the file store under the conversation's directory, so the file store choice in [[File Stores and Settings]] decides where a conversation's history lives.

Sources: [openhands/storage/locations.py:15-18](repo://openhands/storage/locations.py#L15-L18), [openhands/events/event_store.py:155-160](repo://openhands/events/event_store.py#L155-L160)
