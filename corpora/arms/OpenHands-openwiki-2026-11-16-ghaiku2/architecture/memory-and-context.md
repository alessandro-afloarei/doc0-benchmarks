---
type: architecture-component
title: Memory, Condensation, and Microagents
description: How the conversation history is turned into the bounded View the agent sees (condensers, condensation events, and the condenser pipeline), how Memory recalls workspace context and keyword-triggered microagent knowledge into the event stream, and how repository, global, and user microagents are discovered and loaded.
tags: [memory, condenser, condensation, context-window, view, microagents, recall, repo-instructions, triggers]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:30:54.023Z
sources:
  - id: openwiki-source-e0ec246e2fc8f4ba808dfc7f
    resource: repo://openhands/core/config/openhands_config.py
  - id: openwiki-source-a2c4f6dc92cf0cd76a23c3d8
    resource: repo://openhands/core/config/utils.py
  - id: openwiki-source-fce2a7562fd3d4a7cda99a98
    resource: repo://openhands/memory/condenser/condenser.py
  - id: openwiki-source-3e1378257f4d1068deba1d10
    resource: repo://openhands/memory/condenser/impl/observation_masking_condenser.py
  - id: openwiki-source-fb622147f5606bb5e32d8b10
    resource: repo://openhands/memory/condenser/impl/pipeline.py
  - id: openwiki-source-ae571bbab7bb1b3526362fb5
    resource: repo://openhands/memory/memory.py
  - id: openwiki-source-5d8f5c2af56a4fade5c982a8
    resource: repo://openhands/microagent/microagent.py
generated: { by: "claude-code", at: "2026-11-16T18:30:54.023Z" }
---

# Memory, Condensation, and Microagents

An agent cannot receive the whole event history on every step. OpenHands handles this with two cooperating pieces. **Condensers** decide which past events the model sees and can replace a stretch of history with a summary. **Memory** injects extra context into the stream: workspace facts at the start of a conversation and knowledge from microagents when a keyword appears. Microagents are the markdown instruction files that supply most of that knowledge.

## Views and condensation

A **View** (`openhands/memory/view.py`, class at ~L13) is the list of events an agent is allowed to see. It supports `len`, iteration, and slicing, and `View.from_events` builds one from a list. The full history comes from `state.view`.

<!-- openwiki: broken internal link [/openwiki/architecture/agent-controller.md] link "/openwiki/architecture/agent-controller.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
A condenser turns that view into either a smaller view or a **Condensation** (`openhands/memory/condenser/condenser.py`, class at ~L38). A Condensation is an event describing that some events were forgotten and optionally replaced by a summary. It is written into the stream as a `CondensationAction`, which the controller treats as a normal action: it is persisted and the agent steps again on the new view (see [Agent Controller and Step Loop](/openwiki/architecture/agent-controller.md)).

### The Condenser base

`Condenser` (`condenser.py`, class at ~L44) defines the contract:

- `condense(view)` (~L92) is the strategy hook. It returns a `View` or a `Condensation`.
- `condensed_history(state)` (~L104) is what agents call. It records LLM metadata for the condenser's own calls, wraps the work in `metadata_batch` so diagnostics are written once, and then calls `condense(state.view)`.
- `add_metadata` and `write_metadata` (~L58-L84) let a strategy record per-condensation diagnostics.
- `register_config` (~L130) and `from_config` (~L148) map a configuration object to its implementation through `CONDENSER_REGISTRY`. An unknown config type raises `ValueError`.

`RollingCondenser` (~L169) is the common case. It implements `condense` as: if `should_condense(view)` is true, return `get_condensation(view)`; otherwise return the view unchanged (~L185-L192). Subclasses supply only the trigger and the summary or drop logic.

### Built-in strategies

The implementations in `openhands/memory/condenser/impl/` are:

- `NoOpCondenser` returns the view as is.
- `RecentEventsCondenser` keeps a recent window of events (see its config class in `condenser_config.py`).
- `ConversationWindowCondenser` truncates to roughly half the history while keeping the system message, the first user message, and the recall observation, and keeps action and observation pairs together.
- `ObservationMaskingCondenser` replaces the content of observations outside a recent attention window (default 5 events) with a placeholder, keeping the events themselves. `BrowserOutputCondenser` applies similar masking to browser output.
- `AmortizedForgettingCondenser` keeps the first `keep_first` events (default 0) and forgets older events once the history exceeds `max_size` (default 100).
- `LLMSummarizingCondenser` asks an LLM to summarize the forgotten events. Its `max_size` (default 100), `keep_first` (default 1, which must be less than half of `max_size`), and `max_event_length` bound the view and the summary input.
- `StructuredSummaryCondenser` produces a structured `StateSummary` instead of free text.
- `LLMAttentionCondenser` asks an LLM to select the important events.
- `CondenserPipeline` (`impl/pipeline.py`) chains condensers. It applies each in turn and stops at the first one that returns a `Condensation` (~L34-L40).

Each strategy has a config class in `openhands/core/config/condenser_config.py` with a `type` literal (`noop`, `recent`, `llm`, `amortized`, `llm_attention`, `structured`, `pipeline`, `conversation_window`, and so on). `create_condenser_config` (~L270) maps the `type` string to its class.

### Default condenser

`OpenHandsConfig.enable_default_condenser` defaults to `True` (`openhands/core/config/openhands_config.py` ~L111). When the TOML file has no `[condenser]` section, the loader assigns an `LLMSummarizingCondenserConfig` that uses the default LLM to the default agent (`openhands/core/config/utils.py`, `load_from_toml`). An explicit `[condenser]` section replaces that default.

### Where condensation happens in the step

`CodeActAgent.step` (`openhands/agenthub/codeact_agent/codeact_agent.py` ~L196-L203) calls `condensed_history(state)`. A `View` is used to build the prompt. A `Condensation` is returned immediately as the step's action. The LLM is not called in that step. The controller then steps again and the new view is used. Because the condensation is an event, it is persisted in the stream before the model sees the shortened history.

## Memory and recall

`Memory` (`openhands/memory/memory.py`, class at ~L41) runs on the event stream as a subscriber (`EventStreamSubscriber.MEMORY`). It handles `RecallAction` events and answers each with a `RecallObservation` or `NullObservation`, published with source `ENVIRONMENT` and linked to the action by `cause`. A waiting controller therefore always gets a response.

Two recall types exist (`RecallType`, carried on `RecallAction` in `openhands/events/action/agent.py` ~L89):

- **Workspace context** is requested once, on the first user message. `_on_workspace_context_recall` (~L139) assembles the repository name, runtime information, conversation instructions, and any repository microagents into one observation. `set_repository_info`, `set_runtime_info`, and `set_conversation_instructions` (~L320-L366) fill that context.
- **Knowledge** is requested from a user or agent message. `_on_microagent_recall` (~L207) calls `_find_microagent_knowledge` (~L225-L252), which tests each knowledge microagent's trigger keywords against the message and returns the content of each match.

A failure in either path is caught in `_on_event`. The error is reported with `set_runtime_status(ERROR_MEMORY, ...)` and processing continues.

## Microagents

Microagents are markdown files with optional YAML frontmatter. Three types are defined in `openhands/microagent/types.py` (`MicroagentType`):

- `KNOWLEDGE` (`knowledge`) is optional. It is recalled only when one of its triggers appears in a message.
- `REPO_KNOWLEDGE` (`repo`) is always active. It has no triggers and is part of the workspace context.
- `TASK` (`task`) is a special type that requires user input, declared through `inputs` in the metadata.

The classes are in `openhands/microagent/microagent.py`: `BaseMicroagent` (~L17), `KnowledgeMicroagent` (~L174), `RepoMicroagent` (~L206), and `TaskMicroagent` (~L226). The type is inferred from the metadata in this order: if `inputs` are declared it is a task microagent; otherwise if it has triggers it is a knowledge microagent; otherwise it is a repository microagent that is always active. Third-party instruction files are recognized by name (`.cursorrules` becomes `cursorrules`, `agents.md` and `agent.md` become `agents`) and converted to repository microagents (`_handle_third_party`, ~L38-L45).

### Where microagents come from

`Memory.__init__` loads three sources in order:

1. **Global** microagents from the `microagents/` directory in the OpenHands package itself (`GLOBAL_MICROAGENTS_DIR`), loaded by `_load_global_microagents` (~L270).
2. **User** microagents from `~/.openhands/microagents/` (`USER_MICROAGENTS_DIR`), created if missing and loaded by `_load_user_microagents` (~L280).
3. **Workspace** microagents from the cloned repository, added with `load_user_workspace_microagents` (~L254) once the repository is available.

Repository microagents are read from the workspace through the runtime (`Runtime.get_microagents_from_selected_repo`, `openhands/runtime/base.py` ~L823). The runtime also reads organization-level microagents from a `.openhands` repository (`get_microagents_from_org_or_user`, ~L666). Global microagents are checked into this repository under `microagents/`, and this repository's own `.openhands/microagents/` contains the instructions used by contributors.

<!-- openwiki: broken internal link [/openwiki/architecture/integrations-and-mcp.md] link "/openwiki/architecture/integrations-and-mcp.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Microagents can also carry MCP tool configuration. `Memory.get_microagent_mcp_tools` (~L302) returns those `MCPConfig` objects so the agent session can attach them (see [Git Provider Integrations and MCP](/openwiki/architecture/integrations-and-mcp.md)).

## Invariants and failure behavior

- A `Condensation` is always written as an event before the next view is used, so the summary is part of the persisted history.
- Every `RecallAction` gets a reply, even when nothing matches (a `NullObservation`), so the controller is never left waiting.
- Global microagents are loaded before user microagents, and workspace microagents are added after both.
- Keyword triggers match the query text; an empty query recalls nothing.

## Extension seams

- A new condensation strategy is a `RollingCondenser` or `Condenser` subclass, a config class with a unique `type`, and a registration through `register_config`.
- A new recall source is a new `RecallType` handled in `Memory._on_event`.
- New microagent conventions are added to `PATH_TO_THIRD_PARTY_MICROAGENT_NAME` or the metadata classification in `microagent.py`.

## Representative tests

- `tests/unit/memory/` (6 test files) covers condensation and recall.
- `tests/unit/microagent/` (3 test files) covers parsing and loading, including user microagents and the no-header case.
- `tests/unit/utils/test_prompt_manager.py` covers how microagent information is rendered into prompts.

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/agents-and-prompting.md] link "/openwiki/architecture/agents-and-prompting.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Agents, Prompting, and Delegation](/openwiki/architecture/agents-and-prompting.md)
<!-- openwiki: broken internal link [/openwiki/architecture/llm-layer.md] link "/openwiki/architecture/llm-layer.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [LLM Layer, Routing, Metrics, and Retries](/openwiki/architecture/llm-layer.md)
<!-- openwiki: broken internal link [/openwiki/architecture/agent-controller.md] link "/openwiki/architecture/agent-controller.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Agent Controller and Step Loop](/openwiki/architecture/agent-controller.md)
