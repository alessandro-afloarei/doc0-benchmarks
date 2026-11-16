---
type: concept
title: Conversation memory and microagents
description: Repository recall, microagent loading, prompt message assembly, and history condensation without deleting persisted events.
tags: [memory, microagents, prompts, condensation]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:43:51.947Z
sources:
  - id: openwiki-source-fce2a7562fd3d4a7cda99a98
    resource: repo://openhands/memory/condenser/condenser.py
  - id: openwiki-source-dfa66cc76a9001b6e96afff0
    resource: repo://openhands/memory/condenser/impl/llm_summarizing_condenser.py
  - id: openwiki-source-80537cfa20ffe0e7dbe872ef
    resource: repo://openhands/memory/conversation_memory.py
  - id: openwiki-source-ae571bbab7bb1b3526362fb5
    resource: repo://openhands/memory/memory.py
  - id: openwiki-source-9b673d479a7f171981712809
    resource: repo://openhands/memory/view.py
  - id: openwiki-source-5d8f5c2af56a4fade5c982a8
    resource: repo://openhands/microagent/microagent.py
generated: { by: "codex", at: "2026-11-16T17:43:51.947Z" }
---

# Conversation memory and microagents

Three components collaborate on context. `Memory` responds to recall requests with repository and runtime knowledge. `ConversationMemory` converts events into model messages. A `Condenser` reduces the history view that CodeAct passes to that conversion. These roles are separate from the durable event store.

## Recall as an event exchange

`Memory` subscribes to the event stream. A user-source workspace-context recall gathers repository details, runtime information, conversation instructions, repository microagents, and relevant knowledge. Knowledge recalls can originate from user or agent messages and match configured microagent triggers.

Every handled recall emits a `RecallObservation` or a `NullObservation` carrying the request's cause ID. Even an empty result matters: it releases the controller's wait for retrieval. Unexpected memory exceptions report `ERROR_MEMORY` through runtime status instead of manufacturing useful context.

## Microagent loading and precedence

Memory first loads bundled microagents, then user microagents from `~/.openhands/microagents/`. Once a runtime workspace is ready, its microagents are added by name to repository or knowledge maps, replacing an existing entry of the same name. The runtime can load organization/user repository knowledge before repository-specific files from `.openhands/microagents`; it also supports legacy `.openhands_instructions` and recognized third-party instruction filenames through the microagent loader.

Microagents are Markdown plus parsed metadata, not independent running controllers. The loader infers task type from inputs, knowledge type from triggers, and repository type when neither is present. A task definition adds a slash-name trigger. The current memory-loading path explicitly inserts knowledge and repository microagents; do not assume every parsed microagent subtype runs through the same activation path.

Repository microagents contribute workspace context without a keyword trigger. Knowledge microagents contribute content when their triggers match the recall query. Microagent MCP metadata must include stdio servers; SSE-only metadata is rejected. Tool configuration is collected separately from text recall and passed into MCP setup.

## Building a valid model conversation

CodeAct's prompt manager renders templates and its `ConversationMemory` converts the selected event sequence into messages. Tool responses are grouped with their originating assistant tool calls. Pending call messages wait until the corresponding result set is available, and a final filter removes unmatched tool calls and responses. This protects the provider message contract when history is truncated or events are incomplete.

A missing observation can therefore affect both controller progress and which tool exchange appears in model context. Investigate the action cause and tool-call metadata rather than simply inspecting rendered chat text.

## Condensation lifecycle

`Condenser.condensed_history` works from `State.view` and returns either a `View` or a `Condensation` containing a `CondensationAction`. CodeAct returns that action to the controller instead of making an LLM call. Once it is recorded, the next view excludes forgotten event IDs and can insert the latest summary at its configured offset. Original events remain available in the event history/store; condensation changes the model-facing view.

The LLM summarizing condenser keeps a prefix and recent tail, summarizes the previous summary plus newly forgotten events, and emits the forgotten range and summary. Its threshold is an event-count limit, not a direct token guarantee. It validates prefix sizing and truncates event text supplied to the summarizer. Its separate `condenser` LLM service disables prompt caching and contributes metrics through the shared registry.

Other strategies live under `memory/condenser/impl`, including recent-event selection, observation masking, browser-output reduction, pipelines, and conversation windows. Configuration type dispatch selects the registered implementation. A new strategy should preserve action/result coherence and return the expected view/action form; registration rejects duplicate configuration types.

## Troubleshooting and verification

For missing instructions, check the runtime workspace root, file-loading outcome, derived microagent name, and whether the file became repository or triggered knowledge. For context errors, inspect the condenser configuration, emitted condensation action, and resulting view. For missing tool messages, check complete call/result pairing before altering prompt templates.

Focused tests are in `tests/unit/memory/test_memory.py`, `test_conversation_memory.py`, `test_view.py`, `tests/unit/memory/condenser/`, and `tests/unit/microagent/`. Continue with [agents and LLMs](agents-llms.md), [events and persistence](../architecture/events-persistence.md), and [MCP integration](../integrations/tools-repositories.md).
