---
title: "Memory and Recall"
---
## Overview

The `Memory` object adds context to a conversation that the event history alone does not contain: the repository the workspace was cloned from, the runtime's hosts and date, the repository's instructions, and any microagent whose trigger words appear in a message. It answers `RecallAction` events by adding a `RecallObservation` to the stream. `ConversationMemory` is the other half: it turns the events the agent sees into the message list sent to the model. This page covers both; the file formats of the microagents are on [[Microagents]], and history compaction is on [[Condensers]].

Sources: [openhands/memory/memory.py:41-52](repo://openhands/memory/memory.py#L41-L52), [openhands/memory/conversation_memory.py:55-62](repo://openhands/memory/conversation_memory.py#L55-L62)

## Setting up Memory

`Memory.__init__` subscribes to the event stream under the memory subscriber ID, creates empty stores for repository and knowledge microagents, and loads two directories: the microagents shipped with OpenHands, and the user's `~/.openhands/microagents`, which is created if it does not exist. The repository and runtime details are set later by the session, through `set_repository_info`, `set_runtime_info` and `set_conversation_instructions`.

Sources: [openhands/memory/memory.py:53-84](repo://openhands/memory/memory.py#L53-L84), [openhands/memory/memory.py:33-38](repo://openhands/memory/memory.py#L33-L38), [openhands/memory/memory.py:270-300](repo://openhands/memory/memory.py#L270-L300)

The server's `AgentSession` calls all three setters once the runtime is up. The command-line setup calls the runtime and conversation-instruction setters. Until a setter is called, the workspace context has nothing to fill that field with.

Sources: [openhands/server/session/agent_session.py:465-480](repo://openhands/server/session/agent_session.py#L465-L480), [openhands/core/setup.py:184-188](repo://openhands/core/setup.py#L184-L188)

## Answering recalls

`Memory` only acts on `RecallAction` events. A recall of type `WORKSPACE_CONTEXT` from the user answers with a single observation that holds the repository name, directory and branch, the concatenated instructions of all repository microagents, the runtime's hosts, its date, the custom secret descriptions, the conversation instructions and the working directory. A recall of type `KNOWLEDGE` from a user or an agent message answers only with the knowledge microagents whose triggers match the query.

Sources: [openhands/memory/memory.py:90-137](repo://openhands/memory/memory.py#L90-L137), [openhands/memory/memory.py:139-206](repo://openhands/memory/memory.py#L139-L206)

When nothing matches, the memory still answers, with a `NullObservation` whose cause is the recall's ID. The controller keeps the recall as its pending action until an observation with that cause arrives, so this answer is what lets the next step run.

Sources: [openhands/memory/memory.py:100-119](repo://openhands/memory/memory.py#L100-L119), [openhands/controller/agent_controller.py:519-547](repo://openhands/controller/agent_controller.py#L519-L547)

The matching itself is a loop over the knowledge microagents. Each one returns the first of its triggers that appears in the lower-cased query, and a microagent with a match is added with that trigger.

Sources: [openhands/memory/memory.py:225-252](repo://openhands/memory/memory.py#L225-L252), [openhands/microagent/microagent.py:189-198](repo://openhands/microagent/microagent.py#L189-L198)

An exception while answering is logged and reported as a memory error through the runtime status. No observation is added in that case.

Sources: [openhands/memory/memory.py:90-137](repo://openhands/memory/memory.py#L90-L137)

## From events to messages

`ConversationMemory.process_events` converts the condensed history into `Message` objects. It first makes sure the list starts with the system message and then the initial user message, adding them if they are missing. After that it walks the events: actions become assistant messages (tool calls in function-calling mode), observations become user or tool messages, and `RecallObservation` events are turned into the workspace or microagent text the model reads.

Sources: [openhands/memory/conversation_memory.py:74-115](repo://openhands/memory/conversation_memory.py#L74-L115), [openhands/memory/conversation_memory.py:183-200](repo://openhands/memory/conversation_memory.py#L183-L200), [openhands/memory/conversation_memory.py:344-360](repo://openhands/memory/conversation_memory.py#L344-L360)

Observations are truncated to `max_message_chars` before they reach the model, and an image is included only when the model has vision active and the URL is valid. Microagent recalls that name an agent already seen in an earlier recall are filtered out, so the same knowledge is not sent twice.

Sources: [openhands/memory/conversation_memory.py:63-73](repo://openhands/memory/conversation_memory.py#L63-L73), [openhands/memory/conversation_memory.py:698-746](repo://openhands/memory/conversation_memory.py#L698-L746)

Tool calls that have no matching result are filtered out by `_filter_unmatched_tool_calls`, so the provider does not reject the request for an unpaired call.

Sources: [openhands/memory/conversation_memory.py:747-800](repo://openhands/memory/conversation_memory.py#L747-L800)

For Anthropic-style caching, `apply_prompt_caching` marks the system message and the most recent user or tool message as cacheable. Only those two breakpoints are set, which keeps the cache useful across steps.

Sources: [openhands/memory/conversation_memory.py:683-697](repo://openhands/memory/conversation_memory.py#L683-L697)

## The view

The history an agent receives is a `View`: a read-only sequence of events that the condensers produce, which behaves like a list and supports slices. The controller and the condensers keep the full history in the state, and only the view changes when history is shortened.

Sources: [openhands/memory/view.py:13-40](repo://openhands/memory/view.py#L13-L40), [openhands/memory/view.py:41-93](repo://openhands/memory/view.py#L41-L93)
