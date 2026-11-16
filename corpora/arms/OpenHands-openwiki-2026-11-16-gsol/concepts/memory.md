---
type: concept
title: Memory, microagents, and condensation
description: Event-driven context recall, microagent loading and keyword matching, model history views, and condensation lifecycle.
tags: [memory, microagents, context, condensation]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:50:03.393Z
sources:
  - id: openwiki-source-2129d0084f64a3f5714baf90
    resource: repo://openhands/controller/agent_controller.py
  - id: openwiki-source-dfa66cc76a9001b6e96afff0
    resource: repo://openhands/memory/condenser/impl/llm_summarizing_condenser.py
  - id: openwiki-source-ae571bbab7bb1b3526362fb5
    resource: repo://openhands/memory/memory.py
  - id: openwiki-source-9b673d479a7f171981712809
    resource: repo://openhands/memory/view.py
  - id: openwiki-source-5d8f5c2af56a4fade5c982a8
    resource: repo://openhands/microagent/microagent.py
generated: { by: "codex", at: "2026-11-16T06:50:03.393Z" }
---

# Memory, microagents, and condensation

OpenHands has two complementary context mechanisms. Memory retrieves repository/runtime instructions and microagent knowledge through events. Condensers reduce the history presented to a model. Neither mechanism replaces the persisted event store.

## Recall flow

When the controller handles a user message, it identifies whether this is the first user message for that agent. It issues a pending RecallAction with WORKSPACE_CONTEXT for the first message and KNOWLEDGE for subsequent messages. The Memory subscriber responds with a RecallObservation, or a NullObservation when nothing matches. Both responses carry the recall action's ID as their cause so the controller can release the pending action.

Workspace recall combines repository name/directory/branch, runtime hosts and working directory, repository instructions, conversation instructions, matching microagent content, date, and custom-secret descriptions where available. Secret descriptions provide context about available credentials; they are distinct from credential values.

Knowledge recall checks each registered knowledge microagent for its first matching trigger. Matching is case-insensitive substring matching, not embeddings or semantic search. It returns name, trigger, and content for matching microagents. Recall exceptions report ERROR_MEMORY through the status callback.

## Where microagents come from

Memory first loads packaged global microagents, then user files under `~/.openhands/microagents/`. Runtime/session setup subsequently loads workspace and repository microagents. The in-memory maps are keyed by name, so later sources can replace earlier entries with the same name.

The runtime's main repository loader checks organization/user-level configuration, then the selected repository's `.openhands/microagents/`; without a selected repository it uses the workspace directory. It also checks legacy `.openhands_instructions`. Organization configuration uses `.openhands` repositories for providers that support that name and `openhands-config` for GitLab.

The Markdown loader infers behavior from metadata:

| Metadata | Loaded type | Activation |
| --- | --- | --- |
| `inputs` present | TaskMicroagent | Knowledge microagent with an added slash-name trigger and missing-input guidance |
| `triggers` present | KnowledgeMicroagent | Case-insensitive substring match |
| Neither | RepoMicroagent | Repository context, always available in workspace recall |

The loader also recognizes `agents.md`, `agent.md`, and `.cursorrules` names as repository instructions when those files reach the loader. This recognition does not imply arbitrary nested instruction files are automatically discovered.

Repository microagents can declare MCP configuration. The loader requires stdio servers when `mcp_tools` is supplied; memory collects MCP definitions from repository microagents for startup discovery. Triggered knowledge does not dynamically add tools mid-conversation. See [MCP integration](../integrations/tools-providers.md).

## Condensation and history views

CodeAct calls its condenser before formatting model input. A condenser returns either a View ready for processing or a Condensation containing an action. In the latter case, CodeAct returns the condensation action to the controller and tries again on a later step.

`View.from_events` uses recorded CondensationActions to remove forgotten event IDs from the model view, hides condensation-control events themselves, and inserts the most recent available summary at its recorded offset. Raw events stay in persisted history. The view also tracks an outstanding explicit condensation request.

Condenser configurations select implementations through a registry. Available strategies include noop, recent events, browser output masking, observation masking, conversation windows, LLM summaries, structured summaries, and pipelines. Pipeline order is meaningful: each stage receives the preceding stage's view and processing stops when a stage returns a condensation action.

The LLM summarizer triggers on event count, keeps a configured prefix and recent tail, summarizes forgotten events plus prior summary, and records a forgotten ID range and summary offset. Its factory disables prompt caching for its dedicated condenser LLM service. The web default, when enabled in settings, chains conversation-window handling, browser-output masking, and LLM summarization, keeping four initial events and using the configured size or 120.

## Debugging and extension

A provider context-limit error can cause the controller to emit a CondensationRequestAction when history truncation is enabled. Automatic recovery depends on the configured condenser handling that request. Event-count thresholds and token limits are different measures; large individual observations can exhaust context before an event threshold is reached.

For missing instructions, inspect selected repository/workspace paths, microagent loading errors, inferred metadata type, name collisions, and substring triggers. For context loss, compare raw history, condensation actions, and the resulting view before changing prompts. Add condenser implementations with a configuration model and registry entry, and preserve model tool-call/result consistency.

Focused evidence lives in `tests/unit/memory/test_memory.py`, `test_view.py`, `test_conversation_memory.py`, `tests/unit/memory/condenser/`, and `tests/unit/microagent/`. Continue with [agents and LLMs](agents-llm.md) and [event recovery](events-state.md).
