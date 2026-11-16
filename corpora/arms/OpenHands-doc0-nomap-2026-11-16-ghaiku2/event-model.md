---
title: "Event Model"
---
## Overview

Everything that happens in a conversation is an `Event`. A user's message, an agent's command, the output of that command and a memory recall are all events, and each one is stored in the order it was added. The base class holds the fields every event carries: an ID, a timestamp, a source, and an optional cause that links an observation back to the action that produced it. Two subclasses split the events by direction: `Action` is something to be done, and `Observation` is the result of doing it. The concrete types are on [[Actions and Observations]], and the stream that orders them is on [[Event Stream]].

Sources: [openhands/events/event.py:36-40](repo://openhands/events/event.py#L36-L40), [openhands/events/action/action.py:20-23](repo://openhands/events/action/action.py#L20-L23), [openhands/events/observation/observation.py:1-15](repo://openhands/events/observation/observation.py#L1-L15)

## Base fields

An `Event` is a plain dataclass whose metadata lives in underscore-prefixed attributes, such as `_id`, `_source` and `_cause`. The public properties read those attributes and fall back to a safe value when they are absent: the `id` property returns `-1` (`INVALID_ID`) until the stream assigns a number, and `source` returns `None`. `timeout` is the hard limit for an action, and `set_hard_timeout` sets it.

Sources: [openhands/events/event.py:36-60](repo://openhands/events/event.py#L36-L60), [openhands/events/event.py:66-90](repo://openhands/events/event.py#L66-L90)

`EventSource` says who produced an event: `agent`, `user` or `environment`. The environment source is used for events that the memory or the runtime adds on the stream's behalf, such as recall observations. A cause is an integer ID, and it is set on an observation to the ID of the action it answers.

Sources: [openhands/events/event.py:9-13](repo://openhands/events/event.py#L9-L13), [openhands/events/event.py:72-80](repo://openhands/events/event.py#L72-L80), [openhands/controller/agent_controller.py:519-547](repo://openhands/controller/agent_controller.py#L519-L547)

Three small enums refine the source and the recall. `RecallType` is `workspace_context` or `knowledge`; `FileEditSource` and `FileReadSource` record which editor produced a file action. Each is a string enum, so it serialises as its value.

Sources: [openhands/events/event.py:15-34](repo://openhands/events/event.py#L15-L34)

## Serialization

`event_to_dict` writes an event as a flat dictionary. The keys listed in `TOP_KEYS` are copied to the top level. For an action, every other field goes under `args`, and a timeout is written separately. For an observation, the `content` field is written at the top level. Enum values are written as their values, timestamps as ISO strings, and a metrics object is written in its dictionary form. An ID of `-1` is dropped.

Sources: [openhands/events/serialization/event.py:100-153](repo://openhands/events/serialization/event.py#L100-L153), [openhands/events/serialization/event.py:16-26](repo://openhands/events/serialization/event.py#L16-L26)

`event_from_dict` reverses this. It looks for an `action` key or an `observation` key to choose the class, then passes the rest to `action_from_dict` or `observation_from_dict`. Afterwards it restores the underscore fields: the source is turned back into an `EventSource`, the tool-call metadata into its model, and the metrics dictionary into a `Metrics` object with costs, latencies and token usage.

Sources: [openhands/events/serialization/event.py:52-92](repo://openhands/events/serialization/event.py#L52-L92), [openhands/events/serialization/event.py:27-35](repo://openhands/events/serialization/event.py#L27-L35)

The action parser rejects anything that is not a dictionary with an `action` name it knows, and raises `LLMMalformedActionError`. The controller catches that error during a step and adds an error observation, so the model sees the mistake on its next turn.

Sources: [openhands/events/serialization/action.py:98-115](repo://openhands/events/serialization/action.py#L98-L115)

## Trajectories and truncation

`event_to_trajectory` writes the same event in the form saved to a trajectory file. Large fields such as browser DOM objects are removed from the extras first, and screenshots are included only when asked for.

Sources: [openhands/events/serialization/event.py:155-166](repo://openhands/events/serialization/event.py#L155-L166), [openhands/events/serialization/event.py:167-178](repo://openhands/events/serialization/event.py#L167-L178)

`truncate_content` keeps the first and last halves of an observation that is longer than the limit and puts a notice between them. The model therefore sees both ends of a long command output, and the message tells it that the middle was cut.

Sources: [openhands/events/serialization/event.py:167-178](repo://openhands/events/serialization/event.py#L167-L178)
