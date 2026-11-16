---
title: "Conversation Memory and Prompts"
---
## Overview

Two components decide what the model sees. `ConversationMemory` turns the condensed event history into the `Message` list for one call. `PromptManager` renders the Jinja templates for the system prompt and the first user message. `Memory` sits beside them on the event stream and adds workspace context and microagent knowledge as recall observations, which the first two then render into the history.

Sources: [openhands/memory/conversation_memory.py:55-62](repo://openhands/memory/conversation_memory.py#L55-L62) [openhands/utils/prompt.py:43-52](repo://openhands/utils/prompt.py#L43-L52) [openhands/memory/memory.py:41-52](repo://openhands/memory/memory.py#L41-L52)

## Templates

`PromptManager` takes a prompt directory and loads four Jinja templates from it: the system prompt (`system_prompt.j2` by default), the user prompt, the additional-info template and the microagent-info template. A missing file raises `FileNotFoundError` with the full path.

Sources: [openhands/utils/prompt.py:52-70](repo://openhands/utils/prompt.py#L52-L70) [openhands/utils/prompt.py:71-87](repo://openhands/utils/prompt.py#L71-L87)

`get_system_message` renders the system template with the given context and runs the result through `refine_prompt` from the CodeAct tools package before it is returned.

Sources: [openhands/utils/prompt.py:89-93](repo://openhands/utils/prompt.py#L89-L93)

## Event history to messages

`process_events` takes the condensed history and the initial user message. It first makes sure the list starts with a system message, adding one for older histories that lack it, and then makes sure the second event is the initial user message.

Sources: [openhands/memory/conversation_memory.py:74-100](repo://openhands/memory/conversation_memory.py#L74-L100) [openhands/memory/conversation_memory.py:801-824](repo://openhands/memory/conversation_memory.py#L801-L824) [openhands/memory/conversation_memory.py:825-840](repo://openhands/memory/conversation_memory.py#L825-L840)

Each remaining event becomes one or more messages. `_process_action` converts an action, and `_process_observation` converts an observation, truncating content longer than the model's character limit. Observations that answer a tool call are attached to the message for that call.

Sources: [openhands/memory/conversation_memory.py:183-200](repo://openhands/memory/conversation_memory.py#L183-L200) [openhands/memory/conversation_memory.py:344-362](repo://openhands/memory/conversation_memory.py#L344-L362)

Before the call, `_filter_unmatched_tool_calls` removes tool calls that have no matching result. `apply_prompt_caching` marks the messages for prompt caching.

Sources: [openhands/memory/conversation_memory.py:683-697](repo://openhands/memory/conversation_memory.py#L683-L697) [openhands/memory/conversation_memory.py:747-800](repo://openhands/memory/conversation_memory.py#L747-L800)

## Recall on the event stream

`Memory` subscribes to the stream and handles `RecallAction` events. A workspace-context recall, sent for the first user message, produces a recall observation with the repository, runtime and instruction information. A knowledge recall matches the query against each knowledge microagent's triggers and returns the matches as one observation. When nothing matches, it returns no observation.

Sources: [openhands/memory/memory.py:86-100](repo://openhands/memory/memory.py#L86-L100) [openhands/memory/memory.py:207-223](repo://openhands/memory/memory.py#L207-L223) [openhands/memory/memory.py:225-252](repo://openhands/memory/memory.py#L225-L252)

`Memory` loads global microagents and the user's microagents through `_load_global_microagents` and `_load_user_microagents`. What a microagent is, and how its trigger is written, is covered in [[Microagents]].

Sources: [openhands/memory/memory.py:254-300](repo://openhands/memory/memory.py#L254-L300)
