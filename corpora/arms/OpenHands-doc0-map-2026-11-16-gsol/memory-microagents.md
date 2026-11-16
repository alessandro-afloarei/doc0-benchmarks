---
title: "Memory and Microagents"
---
## Overview

OpenHands prepares model context in three places. `Memory` answers recall actions with workspace and microagent information. `ConversationMemory` turns the selected event history into model messages. A `Condenser` selects or summarizes the history visible to the next decision. [[Agent Decisions and Control]] explains when recall and condensation occur; this page explains the information they produce before [[Language Model Requests]] sends a completion.

Sources: [openhands/memory/memory.py:41-68](repo://openhands/memory/memory.py#L41-L68), [openhands/memory/conversation_memory.py:74-96](repo://openhands/memory/conversation_memory.py#L74-L96), [openhands/memory/condenser/condenser.py:44-52](repo://openhands/memory/condenser/condenser.py#L44-L52)

## Recall through the event stream

Memory subscribes under the memory subscriber ID and loads global and user microagents during construction. A user workspace-context recall gathers repository and runtime information, repository instructions, matching knowledge, conversation instructions, secret descriptions and the working directory. It concatenates all loaded repository microagent contents with blank lines. It returns no workspace observation only when none of its contextual inputs is available.

Sources: [openhands/memory/memory.py:53-84](repo://openhands/memory/memory.py#L53-L84), [openhands/memory/memory.py:139-205](repo://openhands/memory/memory.py#L139-L205)

Knowledge recall can originate from user or agent events. Memory looks for matching triggers in the query and returns the name, trigger and content of each matching knowledge microagent. Empty queries produce no matches. Both recall paths publish an observation with the recall action's ID as its cause; if nothing was found, they still publish a null observation so the controller can release pending retrieval. Exceptions instead report an error-memory runtime status.

Sources: [openhands/memory/memory.py:90-137](repo://openhands/memory/memory.py#L90-L137), [openhands/memory/memory.py:207-252](repo://openhands/memory/memory.py#L207-L252)

```mermaid
flowchart LR
  message["User message"] --> recall["Controller emits RecallAction"]
  recall --> memory["Memory gathers workspace or knowledge"]
  memory --> result["RecallObservation or NullObservation"]
  result --> release["Controller matches cause and clears pending recall"]
  release --> prompt["ConversationMemory builds messages"]
```

Sources: [openhands/controller/agent_controller.py:566-583](repo://openhands/controller/agent_controller.py#L566-L583), [openhands/memory/memory.py:90-132](repo://openhands/memory/memory.py#L90-L132), [openhands/controller/agent_controller.py:536-546](repo://openhands/controller/agent_controller.py#L536-L546), [openhands/agenthub/codeact_agent/codeact_agent.py:282-288](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L282-L288)

## Microagent loading and matching

`BaseMicroagent.load` reads Markdown content and front matter, validates metadata and derives the microagent's name from its relative path when a microagent directory is supplied. It recognizes legacy `.openhands_instructions` and third-party instruction filenames such as `.cursorrules`, `agents.md` and `agent.md` as repository knowledge. Type inference uses inputs first for task microagents, triggers next for knowledge microagents, and repository knowledge otherwise. Task metadata receives a slash-name trigger when needed.

Sources: [openhands/microagent/microagent.py:26-47](repo://openhands/microagent/microagent.py#L26-L47), [openhands/microagent/microagent.py:62-105](repo://openhands/microagent/microagent.py#L62-L105), [openhands/microagent/microagent.py:129-170](repo://openhands/microagent/microagent.py#L129-L170)

Knowledge triggers use case-insensitive substring matching and return the first matching trigger for each microagent. This is a literal trigger mechanism rather than semantic search. Memory stores repository and knowledge entries in separate dictionaries keyed by name. Global entries load first, user-home entries next, and workspace loading assigns into those same dictionaries, so later entries with the same name replace earlier ones.

Sources: [openhands/microagent/microagent.py:189-203](repo://openhands/microagent/microagent.py#L189-L203), [openhands/memory/memory.py:79-84](repo://openhands/memory/memory.py#L79-L84), [openhands/memory/memory.py:254-299](repo://openhands/memory/memory.py#L254-L299)

Repository microagents can also supply MCP configuration. Memory gathers tool configuration from always-active repository entries; microagent loading requires stdio servers when MCP tools are declared and warns about SSE entries. That handoff extends the tool set rather than executing tools during knowledge retrieval. [[MCP Tools]] follows the configuration into discovery and runtime invocation.

Sources: [openhands/memory/memory.py:302-318](repo://openhands/memory/memory.py#L302-L318), [openhands/microagent/microagent.py:107-127](repo://openhands/microagent/microagent.py#L107-L127)

## Building coherent model messages

`ConversationMemory.process_events` ensures the selected history starts with a system action and the initial user action, then processes each action or observation. Observation conversion receives the maximum content length and vision settings. It tracks pending assistant tool calls by response ID and tool results by call ID. Only after every tool call in a pending assistant message has a result does it append that message and its results, in tool-call order.

Sources: [openhands/memory/conversation_memory.py:74-155](repo://openhands/memory/conversation_memory.py#L74-L155)

After conversion, it filters unmatched tool calls and responses and formats consecutive user messages with separating newlines. CodeAct invokes prompt-caching placement only when the selected LLM reports caching active. These transformations operate on the messages built for a completion; the persisted actions and observations remain governed by [[Events and Storage]]. This distinction matters when the model's context contains fewer events than the stored conversation.

Sources: [openhands/memory/conversation_memory.py:157-182](repo://openhands/memory/conversation_memory.py#L157-L182), [openhands/agenthub/codeact_agent/codeact_agent.py:282-293](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L282-L293), [openhands/events/event_store.py:85-142](repo://openhands/events/event_store.py#L85-L142)

## Condenser interface and history views

`Condenser.condensed_history` calls `condense(state.view)` while collecting diagnostic metadata into `state.extra_data`. A result is either a `View` to use immediately or `Condensation`, which wraps an action that records forgotten event IDs or ranges and an optional summary. CodeAct returns that action instead of calling its model, then uses the updated view on the next step. `RollingCondenser` implements the common threshold check around a strategy's `should_condense` and `get_condensation` methods.

Sources: [openhands/memory/condenser/condenser.py:38-52](repo://openhands/memory/condenser/condenser.py#L38-L52), [openhands/memory/condenser/condenser.py:70-115](repo://openhands/memory/condenser/condenser.py#L70-L115), [openhands/memory/condenser/condenser.py:169-193](repo://openhands/memory/condenser/condenser.py#L169-L193), [openhands/agenthub/codeact_agent/codeact_agent.py:191-201](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L191-L201)

## Condenser strategies

| Strategy | Context behavior |
| --- | --- |
| `NoOpCondenser` | Returns the incoming view unchanged |
| `RecentEventsCondenser` | Keeps an initial prefix and a recent tail |
| `AmortizedForgettingCondenser` | Above its size threshold, forgets the middle to retain roughly half the configured size |
| `ObservationMaskingCondenser` | Replaces observations outside a recent event window with placeholders |
| `BrowserOutputCondenser` | Masks older browser outputs while retaining recent browser observations |

Sources: [openhands/memory/condenser/impl/no_op_condenser.py:8-14](repo://openhands/memory/condenser/impl/no_op_condenser.py#L8-L14), [openhands/memory/condenser/impl/recent_events_condenser.py:17-22](repo://openhands/memory/condenser/impl/recent_events_condenser.py#L17-L22), [openhands/memory/condenser/impl/amortized_forgetting_condenser.py:40-58](repo://openhands/memory/condenser/impl/amortized_forgetting_condenser.py#L40-L58), [openhands/memory/condenser/impl/observation_masking_condenser.py:19-28](repo://openhands/memory/condenser/impl/observation_masking_condenser.py#L19-L28), [openhands/memory/condenser/impl/browser_output_condenser.py:21-40](repo://openhands/memory/condenser/impl/browser_output_condenser.py#L21-L40)

| Strategy | Context behavior |
| --- | --- |
| `ConversationWindowCondenser` | Preserves essential initial context and action/observation pairing while truncating conversation history |
| `LLMAttentionCondenser` | Asks a model to rank important event IDs and forgets unselected events |
| `LLMSummarizingCondenser` | Summarizes the forgotten middle and retains a prefix and recent tail |
| `StructuredSummaryCondenser` | Uses structured function-call generation for a state summary |
| `CondenserPipeline` | Applies strategies sequentially and stops as soon as one returns a condensation action |

Sources: [openhands/memory/condenser/impl/conversation_window_condenser.py:20-28](repo://openhands/memory/condenser/impl/conversation_window_condenser.py#L20-L28), [openhands/memory/condenser/impl/llm_attention_condenser.py:56-116](repo://openhands/memory/condenser/impl/llm_attention_condenser.py#L56-L116), [openhands/memory/condenser/impl/llm_summarizing_condenser.py:52-69](repo://openhands/memory/condenser/impl/llm_summarizing_condenser.py#L52-L69), [openhands/memory/condenser/impl/llm_summarizing_condenser.py:132-161](repo://openhands/memory/condenser/impl/llm_summarizing_condenser.py#L132-L161), [openhands/memory/condenser/impl/structured_summary_condenser.py:162-166](repo://openhands/memory/condenser/impl/structured_summary_condenser.py#L162-L166), [openhands/memory/condenser/impl/pipeline.py:34-47](repo://openhands/memory/condenser/impl/pipeline.py#L34-L47)

For extension, register a configuration type against a condenser class and implement the condensation interface. Duplicate registrations and unknown configuration types raise `ValueError`. Strategies using models can include their metrics and raw response in the metadata batch, which is written even when the context manager exits through an exception. Configuration selection belongs in [[Configuration]]; model retries and logging belong in [[Language Model Requests]].

Sources: [openhands/memory/condenser/condenser.py:83-102](repo://openhands/memory/condenser/condenser.py#L83-L102), [openhands/memory/condenser/condenser.py:129-166](repo://openhands/memory/condenser/condenser.py#L129-L166), [openhands/memory/condenser/impl/llm_summarizing_condenser.py:142-149](repo://openhands/memory/condenser/impl/llm_summarizing_condenser.py#L142-L149)
