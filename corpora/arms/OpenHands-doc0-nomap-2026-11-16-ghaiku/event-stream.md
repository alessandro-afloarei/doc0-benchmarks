---
title: "Events and the Event Stream"
---
## Overview

Every fact in a conversation is an `Event`: what the user said, what the agent decided to do, and what the environment reported back. The `EventStream` gives each event an id, writes it to storage, and passes it to every subscriber. The controller, the memory and the runtime read and write through this one stream, and the server session subscribes to it to forward events to clients.

Sources: [openhands/events/event.py:35-37](repo://openhands/events/event.py#L35-L37), [openhands/events/stream.py:43-56](repo://openhands/events/stream.py#L43-L56), [openhands/events/stream.py:23-30](repo://openhands/events/stream.py#L23-L30)

## The event model

An `Event` has an id, a timestamp, a source and an optional cause. The id is assigned by the stream and is `-1` until then. The source is one of `agent`, `user` or `environment`. The cause is the id of the event this one answers, which is how an observation points back to the action that produced it.

Sources: [openhands/events/event.py:9-13](repo://openhands/events/event.py#L9-L13), [openhands/events/event.py:46-78](repo://openhands/events/event.py#L46-L78)

`Action` and `Observation` are the two main subclasses. An action asks for something to happen, such as a command, a file read or a message. An observation reports a result. Each has its own folder of concrete classes: `commands`, `files`, `browse`, `agent`, `message`, `mcp` and `empty` for actions, and `commands`, `files`, `browse`, `agent`, `error`, `mcp` and the rest for observations.

Sources: [openhands/events/action/action.py:22-23](repo://openhands/events/action/action.py#L22-L23), [openhands/events/observation/observation.py:6-15](repo://openhands/events/observation/observation.py#L6-L15), [openhands/events/action/__init__.py:1-48](repo://openhands/events/action/__init__.py#L1-L48), [openhands/events/observation/__init__.py:1-53](repo://openhands/events/observation/__init__.py#L1-L53)

Agent-side actions that the controller itself reads are kept in the agent folder. These include `ChangeAgentStateAction`, `AgentFinishAction`, `AgentDelegateAction`, `RecallAction` and `CondensationAction`. The controller's handlers look for them by class.

Sources: [openhands/events/action/agent.py:10-23](repo://openhands/events/action/agent.py#L10-L23), [openhands/events/action/agent.py:77-108](repo://openhands/events/action/agent.py#L77-L108), [openhands/controller/agent_controller.py:494-517](repo://openhands/controller/agent_controller.py#L494-L517)

## Adding an event

`EventStream.add_event` rejects an event that already has an id. The message says it was probably added from inside a handler, which would loop. The method then sets the timestamp and source, takes the lock, assigns the next id and appends the event to the current write page.

Sources: [openhands/events/stream.py:163-184](repo://openhands/events/stream.py#L163-L184)

Before storage, the event is serialized and its secret values are replaced. The cache page and the stored file both hold that redacted dictionary. The replacement applies to every string value except the top-level system fields.

Sources: [openhands/events/stream.py:186-190](repo://openhands/events/stream.py#L186-L190), [openhands/events/stream.py:221-244](repo://openhands/events/stream.py#L221-L244)

The event is written to its own file, named by its id. Then the write page is stored as a cache page once it is full. The event goes onto the queue last, so every subscriber sees it only after it is on disk.

Sources: [openhands/events/stream.py:193-204](repo://openhands/events/stream.py#L193-L204), [openhands/events/stream.py:205-214](repo://openhands/events/stream.py#L205-L214), [openhands/events/stream.py:203-204](repo://openhands/events/stream.py#L203-L204)

## Subscribers

`subscribe` takes a subscriber id, a callback and a callback id. The subscriber id groups callbacks, and each callback gets its own single-thread pool, so one slow callback does not block the others. A duplicate callback id under the same subscriber raises `ValueError`.

Sources: [openhands/events/stream.py:130-148](repo://openhands/events/stream.py#L130-L148)

The queue runs on a daemon thread with its own event loop. For each event it visits the subscribers in sorted order and submits the event to each callback's pool. Each submitted call gets a completion handler. A callback that raises is logged with its callback id and subscriber id, and the handler then re-raises the error. The other callbacks are separate submissions, so they still get the event.

Sources: [openhands/events/stream.py:246-276](repo://openhands/events/stream.py#L246-L276), [openhands/events/stream.py:277-291](repo://openhands/events/stream.py#L277-L291)

The known subscriber ids are the agent controller, the resolver, the server, the runtime, the memory, the main entry point and the test subscriber. The server session and the memory are described in [[Client Sessions and Socket.IO]] and [[Memory and Microagent Recall]].

Sources: [openhands/events/stream.py:23-30](repo://openhands/events/stream.py#L23-L30)

## Storage pages

`EventStore` reads events from the file store by id, and `EventStream` is a subclass of it. Each event is a JSON file, and reading many single files is slow, so the store also keeps pages. A page holds 25 events, and its file name gives its start id and the id after its last event. `search_events` reads the cache page that covers an id when one exists, and falls back to the single file when it does not.

Sources: [openhands/events/event_store.py:44-54](repo://openhands/events/event_store.py#L44-L54), [openhands/events/event_store.py:138-146](repo://openhands/events/event_store.py#L138-L146), [openhands/events/event_store.py:155-160](repo://openhands/events/event_store.py#L155-L160), [openhands/events/event_store.py:85-137](repo://openhands/events/event_store.py#L85-L137)

Writing a cache page happens after the single event files, as the code comment says: a reader that cannot find a page falls back to the single files, so an unfinished page is harmless.

Sources: [openhands/events/stream.py:203-214](repo://openhands/events/stream.py#L203-L214)

## Serialization

`event_to_dict` writes the keys listed in `TOP_KEYS`, such as id, timestamp and source, followed by the event's own fields. An id of `-1` is dropped. `event_from_dict` reverses that: a dictionary with an `action` key goes to the action deserializer, and one with an `observation` key goes to the observation deserializer. Anything else is an error. The stored files and the frames the server sends to clients use this same format.

Sources: [openhands/events/serialization/event.py:16-24](repo://openhands/events/serialization/event.py#L16-L24), [openhands/events/serialization/event.py:52-59](repo://openhands/events/serialization/event.py#L52-L59), [openhands/events/serialization/event.py:100-112](repo://openhands/events/serialization/event.py#L100-L112), [openhands/events/serialization/action.py:98-100](repo://openhands/events/serialization/action.py#L98-L100), [openhands/events/serialization/observation.py:99-101](repo://openhands/events/serialization/observation.py#L99-L101), [openhands/events/stream.py:186-196](repo://openhands/events/stream.py#L186-L196), [openhands/server/session/session.py:326-327](repo://openhands/server/session/session.py#L326-L327)

`event_to_trajectory` makes the form saved for replay and analysis. It removes the extras fields that are not wanted in a trajectory, and it removes the screenshot fields too unless the caller asks to keep them.

Sources: [openhands/events/serialization/event.py:155-164](repo://openhands/events/serialization/event.py#L155-L164)

The runtime that produces the observations for these events is described in [[Runtime Interface]].

Sources: [openhands/runtime/base.py:361-399](repo://openhands/runtime/base.py#L361-L399)
