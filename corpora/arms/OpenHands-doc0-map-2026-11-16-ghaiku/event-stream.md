---
title: "Events and the Event Stream"
---
## Overview

Every message between the parts of OpenHands is an `Event`. An `Action` asks for work (run a command, edit a file, send a message), and an `Observation` reports the result. `EventStream` is the one place where events are added, stored and delivered to subscribers, and it inherits its read path from `EventStore`. Each event is written to the file store as its own JSON file, keyed by its id.

Sources: [openhands/events/event.py:36-37](repo://openhands/events/event.py#L36-L37) [openhands/events/stream.py:43-56](repo://openhands/events/stream.py#L43-L56) [openhands/events/event_store.py:44-50](repo://openhands/events/event_store.py#L44-L50)

## The event model

`EventSource` has three values: `AGENT`, `USER` and `ENVIRONMENT`. The source is set by whoever adds the event, not by the event itself.

Sources: [openhands/events/event.py:9-12](repo://openhands/events/event.py#L9-L12)

`Action` is a dataclass whose `runnable` class flag is false by default. The controller holds an action as pending only when its `runnable` flag is set. `ActionSecurityRisk` has four levels: `UNKNOWN` (-1), `LOW`, `MEDIUM` and `HIGH`.

Sources: [openhands/events/action/action.py:14-22](repo://openhands/events/action/action.py#L14-L22)

`Observation` is the base for results from the environment. Its `cause` field holds the id of the action it answers, which is how the controller matches a result to a pending action.

Sources: [openhands/events/observation/observation.py:7-12](repo://openhands/events/observation/observation.py#L7-L12) [openhands/events/event.py:73-78](repo://openhands/events/event.py#L73-L78)

## Adding an event

`add_event` refuses an event that already has an id. It then sets the timestamp and the source, and takes the stream's lock to assign the next id. The event is serialised and passed through the secret filter, then rebuilt from the filtered data. The rebuilt copy is the one that is stored and queued, so subscribers never see a secret that the filter removed.

Sources: [openhands/events/stream.py:163-185](repo://openhands/events/stream.py#L163-L185)

Each event is written as a JSON file. When the in-memory write page reaches `cache_size` events, the page is also written as one cache file, so later reads can load 25 events with one file read. The page is stored after the events it covers, which means a reader that finds no cache file reads the single events instead.

Sources: [openhands/events/stream.py:186-213](repo://openhands/events/stream.py#L186-L213) [openhands/events/event_store.py:50](repo://openhands/events/event_store.py#L50)

After the write, the event is put on the queue. A background loop takes events off the queue and passes each one to every subscriber in turn.

Sources: [openhands/events/stream.py:203](repo://openhands/events/stream.py#L203) [openhands/events/stream.py:246-276](repo://openhands/events/stream.py#L246-L276)

## Secret filtering

`_replace_secrets` walks the serialised event. Fields that carry system metadata at the top level (`timestamp`, `id`, `source`, `cause`, `action`, `observation`, `message`) are left as they are. Every other string is searched for each registered secret value, and each match is replaced with `<secret_hidden>`. Nested dictionaries are filtered the same way.

Sources: [openhands/events/stream.py:221-245](repo://openhands/events/stream.py#L221-L245)

## Subscribers

Subscribers are grouped by an `EventStreamSubscriber` value (controller, server, runtime, memory and others), and each callback has its own single-worker thread pool. Because each callback has one worker, a callback sees events in the order they were added. A callback that raises has its error logged by a handler built for that callback.

Sources: [openhands/events/stream.py:23-31](repo://openhands/events/stream.py#L23-L31) [openhands/events/stream.py:130-148](repo://openhands/events/stream.py#L130-L148) [openhands/events/stream.py:277-289](repo://openhands/events/stream.py#L277-L289)

## Reading history

`search_events` yields events in id order, or in reverse, from `start_id` to `end_id`. It loads one cache page at a time, falls back to reading a single event file when the page does not hold it, and skips ids whose files are missing. An `EventFilter` and a `limit` can end the scan early.

Sources: [openhands/events/event_store.py:85-137](repo://openhands/events/event_store.py#L85-L137) [openhands/events/event_store.py:138-142](repo://openhands/events/event_store.py#L138-L142) [openhands/events/event_store.py:172-175](repo://openhands/events/event_store.py#L172-L175)

`event_from_dict` decides the class from the top-level key: a dict with an `action` key becomes an action and one with an `observation` key becomes an observation. A dict with neither raises `ValueError`.

Sources: [openhands/events/serialization/event.py:52-60](repo://openhands/events/serialization/event.py#L52-L60)
