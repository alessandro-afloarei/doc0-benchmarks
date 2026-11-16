---
type: subsystem
title: Conversation Memory and Condensers
description: How OpenHands turns event history into LLM messages, how condensers shrink long histories via CondensationActions and Views, the available condenser strategies and defaults, and how the Memory component answers RecallActions with workspace context and microagent knowledge.
tags: [memory, condenser, context-window, conversation-memory, recall, prompts]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:35:38.671Z
sources:
  - id: openwiki-source-f1695abdeda3aad0454e38f6
    resource: repo://openhands/controller/state/state.py
  - id: openwiki-source-4ae545fc5168dd6cca0bd13a
    resource: repo://openhands/core/config/agent_config.py
  - id: openwiki-source-fce2a7562fd3d4a7cda99a98
    resource: repo://openhands/memory/condenser/condenser.py
  - id: openwiki-source-c78d349ef970e2d9397b965c
    resource: repo://openhands/memory/condenser/impl/conversation_window_condenser.py
  - id: openwiki-source-dfa66cc76a9001b6e96afff0
    resource: repo://openhands/memory/condenser/impl/llm_summarizing_condenser.py
  - id: openwiki-source-fb622147f5606bb5e32d8b10
    resource: repo://openhands/memory/condenser/impl/pipeline.py
  - id: openwiki-source-80537cfa20ffe0e7dbe872ef
    resource: repo://openhands/memory/conversation_memory.py
  - id: openwiki-source-ae571bbab7bb1b3526362fb5
    resource: repo://openhands/memory/memory.py
  - id: openwiki-source-9b673d479a7f171981712809
    resource: repo://openhands/memory/view.py
  - id: openwiki-source-610d0b16c84de208359adc6c
    resource: repo://openhands/server/session/session.py
generated: { by: "claude-code", at: "2026-11-16T07:35:38.671Z" }
---

# Conversation Memory and Condensers

Three cooperating pieces decide what the LLM sees on each step:

1. **Condensers** (`openhands/memory/condenser/`) decide *which events* remain visible.
2. **`ConversationMemory`** (`openhands/memory/conversation_memory.py`) converts the visible events into provider-ready `Message`s.
3. **`Memory`** (`openhands/memory/memory.py`) is an event-stream subscriber that injects *extra context* (repository info, runtime info, microagent knowledge) in response to `RecallAction`s.

## Views and condensation events

History is never deleted from the [event stream](event-stream.md). Instead, condensation is recorded as events:

- `CondensationAction` lists `forgotten` event ids (explicitly or as a range) and optionally a `summary` with a `summary_offset`.
- `CondensationRequestAction` asks for condensation (emitted by the agent's `request_condensation` tool or by the controller on context-window overflow — see [Agent Controller](agent-controller.md#event-handling--step)).

`View.from_events(history)` (`openhands/memory/view.py`) replays these semantics: it drops all forgotten ids plus the condensation/request events themselves, inserts the **most recent** summary as an `AgentCondensationObservation` at its offset, and sets `unhandled_condensation_request` when a request is newer than the latest condensation. `State.view` caches the view and rebuilds it only when history length changes.

## Condenser contract

`Condenser.condense(view) -> View | Condensation`:

- Returning a `View` means "send these events to the LLM".
- Returning a `Condensation` (wrapping a `CondensationAction`) means "record this instead". `CodeActAgent.step` returns that action directly; the controller publishes it and, because `should_step` is true for condensation actions, immediately steps again with the new view.

`RollingCondenser` implements `condense` as `get_condensation(view) if should_condense(view) else view`. Condensers are created from config via a registry keyed by config class (`Condenser.register_config` / `Condenser.from_config`); `condensed_history(state)` also batches condenser metadata into `state.extra_data`.

### Strategies

| Config `type` | Class | Behavior |
| --- | --- | --- |
| `noop` | `NoOpCondenser` | Pass-through |
| `observation_masking` | `ObservationMaskingCondenser` | Masks observation content outside a recent attention window |
| `browser_output_masking` | `BrowserOutputCondenser` | Masks browser observations except the most recent N |
| `recent` | `RecentEventsCondenser` | Keeps first `keep_first` and the most recent events |
| `conversation_window` | `ConversationWindowCondenser` | Rolling; condenses only when there is an unhandled condensation request, keeping essential initial events (system message, first user message, its recall observation) and roughly the later half of history while preserving action/observation pairs |
| `llm` | `LLMSummarizingCondenser` | Rolling; when the view exceeds `max_size`, keeps `keep_first` head events and enough tail events to reach `max_size // 2`, and asks an LLM to produce a structured running summary (user context, task tracking, progress, etc.) of the forgotten middle |
| `amortized` | `AmortizedForgettingCondenser` | Forgets the middle once `max_size` is exceeded, without summaries |
| `llm_attention` | `LLMAttentionCondenser` | Asks an LLM to pick which events to keep |
| `structured` | `StructuredSummaryCondenser` | Summarization using a function-calling, structured `StateSummary` |
| `pipeline` | `CondenserPipeline` | Runs condensers in sequence, stopping at the first `Condensation` |

Configs live in `openhands/core/config/condenser_config.py`; `LLMSummarizingCondenser` validates `keep_first < max_size // 2`.

### Defaults

- `AgentConfig.condenser` defaults to `ConversationWindowCondenserConfig`, deliberately not `noop`: with `noop`, a context-window overflow would emit a condensation request that nothing ever handles.
- In the server, when user settings have `enable_default_condenser`, `Session` replaces the agent's condenser with a pipeline: `conversation_window` → `browser_output_masking(attention_window=2)` → `llm(keep_first=4, max_size=settings.condenser_max_size or 120)` using the agent's LLM config. Browser masking runs before summarization so the summarizer sees only recent browser output.
- The CLI configures condensers similarly from its settings (`openhands/cli/settings.py`, `openhands/cli/main.py`).

## ConversationMemory: events → messages

`ConversationMemory.process_events(condensed_history, initial_user_action, max_message_chars, vision_is_active)`:

1. Ensures the list starts with a `SystemMessageAction` and the initial user `MessageAction` (inserting them if a condenser dropped them).
2. Converts each action and observation into messages. In function-calling mode, agent actions with `tool_call_metadata` produce a pending assistant message containing `tool_calls`; observations produce `tool` role messages keyed by `tool_call_id`. An assistant message is emitted only once **all** its tool calls have results, then followed by those results.
3. Truncates long observation content to `max_message_chars` (middle truncation), and includes images only when vision is active.
4. Formats `RecallObservation`s (only if `enable_prompt_extensions`):
   - `WORKSPACE_CONTEXT` → repository info, runtime info (hosts, date, working dir, custom secret descriptions), repository instructions, conversation instructions, and triggered microagent knowledge, rendered via `PromptManager` templates.
   - `KNOWLEDGE` → microagent info, deduplicating microagents already shown in earlier recall observations and skipping `disabled_microagents`.
5. Filters unmatched tool calls/results so every `tool_call_id` has a counterpart (providers reject mismatches), and separates consecutive user messages with blank lines.

`apply_prompt_caching` marks the system message and the last user/tool message as cacheable (Anthropic-style breakpoints), used when [prompt caching](llm-layer.md#model-features) is active.

## Memory: recall and microagents

`Memory` subscribes to the stream as `EventStreamSubscriber.MEMORY`. It is created by `create_memory()` (`openhands/core/setup.py`) or `AgentSession._create_memory`, which load microagents and set repository/runtime info and conversation instructions.

On a `RecallAction`:

- `WORKSPACE_CONTEXT` (source USER, issued for the first user message) → `RecallObservation` concatenating all repo microagent contents, matched knowledge microagents, repository and runtime info, and conversation instructions.
- `KNOWLEDGE` (from user or agent messages) → `RecallObservation` with knowledge microagents whose triggers appear in the query.
- If nothing applies, a `NullObservation` is published instead. Either way its `cause` is the recall action id, which releases the controller's pending action so the agent can step.

Errors set runtime status `ERROR_MEMORY` via the status callback rather than raising. Microagent sources, formats, and MCP tools contributed by microagents are covered in [Microagents](../concepts/microagents.md).

## Tests

`tests/unit/memory/` covers `test_view.py` (condensation semantics), `test_conversation_memory.py` (message construction, tool-call pairing, recall formatting), `test_memory.py` (recall handling), and `condenser/` tests for each strategy.

## Related pages

- [Agents: CodeAct and the Agent Hub](../agents/agenthub.md)
- [Events and the Event Stream](event-stream.md)
- [Microagents](../concepts/microagents.md)
- [LLM Layer](llm-layer.md)
