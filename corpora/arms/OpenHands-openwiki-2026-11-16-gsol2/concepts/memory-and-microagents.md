---
type: concept
title: Memory, microagents and context condensation
description: Repository context recall, keyword-triggered microagents, prompt assembly and history views used to control model context.
tags: [memory, microagents, context, condensation]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:55:05.802Z
sources:
  - id: openwiki-source-f161159e8a959406ae10a085
    resource: repo://openhands/agenthub/codeact_agent/codeact_agent.py
  - id: openwiki-source-fce2a7562fd3d4a7cda99a98
    resource: repo://openhands/memory/condenser/condenser.py
  - id: openwiki-source-ae571bbab7bb1b3526362fb5
    resource: repo://openhands/memory/memory.py
  - id: openwiki-source-5d8f5c2af56a4fade5c982a8
    resource: repo://openhands/microagent/microagent.py
generated: { by: "codex", at: "2026-11-16T16:55:05.802Z" }
---

# Memory, microagents and context condensation

## Three different jobs

`Memory` answers recall actions with repository/runtime information and microagent knowledge. `ConversationMemory` converts events into model messages, preserving tool exchanges and formatting constraints. A `Condenser` selects or summarizes the history view supplied to that conversion. Persistent event storage remains a separate concern: reducing a model's context does not require deleting the underlying history.

## Recall and microagent loading

Memory subscribes to recall events. Workspace recall combines repository identity, branch and directory, runtime hosts and date, repository instructions, matching knowledge, secret descriptions and conversation instructions. Knowledge recall searches loaded knowledge microagents. Both paths emit an observation whose `cause` is the recall action ID; an empty result still emits `NullObservation` to release the controller's pending recall. Exceptions report an `ERROR_MEMORY` runtime status.

Microagents load from the bundled global directory, the user's `~/.openhands/microagents/` directory and the selected runtime workspace. Entries are indexed by name, so later assignments can replace earlier entries with the same name. Repository microagents contribute always-active workspace instructions; knowledge/task microagents provide trigger-based content. Trigger matching is case-insensitive substring matching, not an embedding search.

The loader parses Markdown frontmatter and infers the type: inputs imply a task, triggers imply knowledge, and neither implies repository knowledge. Task inputs also add a slash-name trigger. Legacy `.openhands_instructions` and recognized `AGENTS.md`, `agent.md` and `.cursorrules` files are adapted into repository knowledge. Relative paths can determine names when loading from a microagent directory.

Repository microagents can contribute MCP configuration. The loader requires stdio entries when microagent MCP tools are configured and warns about SSE entries. This repository-specific validation is narrower than the overall MCP transport support. Runtime discovery determines which files are supplied to the loader; recognizing a filename does not mean every file anywhere in a repository is automatically loaded.

## Views, condensation and prompts

CodeAct asks its condenser for `View | Condensation` before calling the model. A view is passed onward for message construction. A condensation result is returned as an action, recorded in the event history, and used to produce a new view on the next step. `View.from_events` applies condensation metadata to remembered/forgotten events. Rolling condensers express a threshold and the condensation action to generate when it is crossed.

Condenser configuration types map to implementations through a registry. Implementations include no-op, recent-event, masking, summarizing and pipeline strategies; each has its own retention policy. Condenser metadata is stored in `State.extra_data`, and model-backed condensers use the shared model registry for their service needs. Context-window error recovery can request further condensation through the controller, so changing a condenser also affects recovery from model overflow.

`ConversationMemory.process_events` receives condensed events, the initial user message, character limits and vision capability. CodeAct then applies provider prompt caching when enabled. Tool-call/result integrity and system-message handling are therefore requirements for a new condensation strategy, beyond simply shortening text.

## Investigating context problems

Follow [memory.py](../../openhands/memory/memory.py), [microagent.py](../../openhands/microagent/microagent.py), [view.py](../../openhands/memory/view.py) and [condenser.py](../../openhands/memory/condenser/condenser.py). Focused tests live in `tests/unit/microagent/`, `tests/unit/memory/test_memory.py`, `test_view.py`, `test_conversation_memory.py` and `tests/unit/memory/condenser/`.

Related: [agent loop](agent-loop.md), [models](models.md), [MCP integration](../integrations/tools-and-git.md), [quickstart](../quickstart.md).
