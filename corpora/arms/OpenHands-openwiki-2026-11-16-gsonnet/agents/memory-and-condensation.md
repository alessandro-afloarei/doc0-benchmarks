---
type: component
title: Conversation Memory and History Condensation
description: How the event history is turned into LLM messages (ConversationMemory), how Views and Condensers shrink long histories, the available condenser strategies, and how the Memory class answers recall requests with workspace context and microagent knowledge.
tags: [memory, condenser, context-window, history, llm-messages]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:38:52.407Z
sources:
  - id: openwiki-source-f161159e8a959406ae10a085
    resource: repo://openhands/agenthub/codeact_agent/codeact_agent.py
  - id: openwiki-source-2129d0084f64a3f5714baf90
    resource: repo://openhands/controller/agent_controller.py
  - id: openwiki-source-4ae545fc5168dd6cca0bd13a
    resource: repo://openhands/core/config/agent_config.py
  - id: openwiki-source-fce2a7562fd3d4a7cda99a98
    resource: repo://openhands/memory/condenser/condenser.py
  - id: openwiki-source-c78d349ef970e2d9397b965c
    resource: repo://openhands/memory/condenser/impl/conversation_window_condenser.py
  - id: openwiki-source-fb622147f5606bb5e32d8b10
    resource: repo://openhands/memory/condenser/impl/pipeline.py
  - id: openwiki-source-80537cfa20ffe0e7dbe872ef
    resource: repo://openhands/memory/conversation_memory.py
  - id: openwiki-source-ae571bbab7bb1b3526362fb5
    resource: repo://openhands/memory/memory.py
  - id: openwiki-source-9b673d479a7f171981712809
    resource: repo://openhands/memory/view.py
generated: { by: "claude-code", at: "2026-11-16T09:38:52.407Z" }
---

# Conversation Memory and History Condensation

Three cooperating pieces live in `openhands/memory/`:

| Piece | File | Job |
|---|---|---|
| `ConversationMemory` | `conversation_memory.py` | Converts a list of events into provider-ready `Message` objects. |
| `View` + `Condenser` | `view.py`, `condenser/` | Decide which events the LLM sees; shrink the history when it grows. |
| `Memory` | `memory.py` | Event-stream subscriber that answers `RecallAction`s with repo/runtime context and [microagent](microagents.md) knowledge. |

## From events to messages (`ConversationMemory`)

`process_events(condensed_history, initial_user_action, max_message_chars, vision_is_active)` is called by `CodeActAgent._get_messages` (see [CodeActAgent](codeact-agent.md)). It:

1. Ensures the event list begins with a `SystemMessageAction` and then the initial user `MessageAction` (`_ensure_system_message`, `_ensure_initial_user_message`).
2. Walks the events, delegating to `_process_action` / `_process_observation`. Observation content is truncated to `max_message_chars`; image URLs are only included when vision is active.
3. Tracks function-calling pairs: an assistant message that carries tool calls is held in `pending_tool_call_action_messages` until every `tool_call_id` has a matching tool-result message, and only then are the assistant message and its results emitted together, so provider ordering rules are respected.
4. Runs `_filter_unmatched_tool_calls`, dropping tool calls without responses (and vice versa) so a truncated or interrupted history never produces an invalid request, then `_apply_user_message_formatting`.

`apply_prompt_caching` marks the system message's last content block and the last user/tool message as cacheable (Anthropic-style caching).

## Views and condensation events

A `View` (`view.py`) is a linear list of events plus an `unhandled_condensation_request` flag. `View.from_events` applies condensation semantics to the raw history:

- Every `CondensationAction` contributes its `forgotten` event ids (and its own id) to a forgotten set; every `CondensationRequestAction` is also hidden.
- The *last* condensation action that carries a `summary` and `summary_offset` determines a summary that is inserted into the kept events as an `AgentCondensationObservation` at that offset.

Condensation is therefore **append-only and non-destructive**: nothing is deleted from the [event stream](../architecture/event-stream.md); a `CondensationAction` event is added, and the view recomputed from the full history each step excludes the forgotten ids.

## Condenser framework

`Condenser` (`condenser/condenser.py`) is an ABC with `condense(view) -> View | Condensation`. A `Condensation` wraps a `CondensationAction`. The contract: if a condenser returns a `Condensation`, the agent returns that action instead of calling the LLM; the controller adds it to the stream and steps again, and the next `condensed_history(state)` yields the shortened `View`. `condensed_history` is the entry point agents use: it records LLM metadata and runs `condense(state.view)` inside a `metadata_batch` context that writes per-condensation diagnostics into `state.extra_data`.

Config-driven construction: each condenser class calls `register_config(ConfigType)` and `Condenser.from_config(config, llm_registry)` looks the class up in `CONDENSER_REGISTRY`. Config models are in `core/config/condenser_config.py` and are discriminated by a `type` literal.

`RollingCondenser` adds `should_condense(view)` / `get_condensation(view)` for strategies that only act once the history exceeds a threshold.

| `type` | Class | Behavior |
|---|---|---|
| `noop` | `NoOpCondenser` | Returns the view unchanged. |
| `observation_masking` | `ObservationMaskingCondenser` | Replaces observations older than an attention window (default 5) with `<MASKED>`. |
| `browser_output_masking` | `BrowserOutputCondenser` | Masks only old browser observations (window default 1) because screenshots/accessibility trees are huge. |
| `recent` | `RecentEventsCondenser` | Keeps the first `keep_first` events plus the most recent up to `max_events`. |
| `amortized` | `AmortizedForgettingCondenser` | When view length exceeds `max_size`, forgets the middle down to `max_size // 2`, keeping `keep_first` head events. |
| `llm` | `LLMSummarizingCondenser` | Same trigger/shape, but an LLM summarizes forgotten events into a summary kept after the head. |
| `llm_attention` | `LLMAttentionCondenser` | An LLM selects the most important event ids to keep. |
| `structured` | `StructuredSummaryCondenser` | Function-calling to produce a structured `StateSummary`. |
| `pipeline` | `CondenserPipeline` | Runs condensers in order, passing each resulting view on; stops early at the first `Condensation`. |
| `conversation_window` | `ConversationWindowCondenser` | Only condenses when the view carries an unhandled condensation request; keeps essential initial events (system message, first user message, recall observation) and roughly half of the history, preserving action–observation pairs. |

### The default and why

`AgentConfig.condenser` defaults to `ConversationWindowCondenserConfig`. The comment in `agent_config.py` explains the reasoning: with `NoOp`, a context-window overflow would make the agent emit a condensation request that nothing handles. The overflow path is in [`AgentController._step`](../architecture/agent-controller.md): on a context-window error, if `enable_history_truncation` is set the controller adds a `CondensationRequestAction` (otherwise it raises `LLMContextWindowExceedError`). `AgentController.should_step` treats both `CondensationAction` and `CondensationRequestAction` as events that trigger another step, which is how the request gets turned into a condensation.

The agent can also ask for condensation itself via the condensation-request tool (`enable_condensation_request`).

## Recall: the `Memory` class

`Memory` subscribes to the event stream (as `EventStreamSubscriber.MEMORY`) and reacts only to `RecallAction`:

- The controller issues a `RecallAction` for each user message (`AgentController._handle_message_action`): `WORKSPACE_CONTEXT` for the first user message, `KNOWLEDGE` for later ones. The controller sets this as its pending action, so the agent does not step until the answer arrives.
- `WORKSPACE_CONTEXT` recall (user-sourced) builds a `RecallObservation` containing repository info, runtime info (hosts, date, working dir, custom-secret descriptions), concatenated repo-microagent instructions, matching knowledge microagents, and conversation instructions. If there is nothing to report a `NullObservation` is emitted instead.
- `KNOWLEDGE` recall (from user or agent messages) matches the query against knowledge microagent triggers.
- In both cases the observation's `_cause` is set to the recall action's id, which is what releases the controller's wait (see `should_step`'s special case for `NullObservation` with `cause > 0`).
- Any exception is logged and surfaced via `set_runtime_status(RuntimeStatus.ERROR_MEMORY, ...)`.

At construction, `Memory` loads global microagents (the repo's public `microagents/`) and user microagents from `~/.openhands/microagents/`; workspace microagents are loaded from the runtime later. See [Microagents](microagents.md).

Related: [AgentController](../architecture/agent-controller.md), [Event stream](../architecture/event-stream.md), [Configuration](../configuration/configuration.md).
