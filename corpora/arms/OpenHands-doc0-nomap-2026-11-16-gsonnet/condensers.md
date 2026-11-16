---
title: "Conversation Memory and Condensers"
---
## Overview

The event stream grows without limit but a model's context window does not. OpenHands keeps the full log on disk and decides, on every agent step, which events the model gets to see. Two pieces do this: a condenser trims or summarises the history into a `View`, and `ConversationMemory` turns that view into the list of chat messages sent to the LLM. The trimming is itself recorded in the stream, as a `CondensationAction`, so the choice is reproducible when a conversation is reloaded.

Sources: [openhands/memory/condenser/condenser.py:44-52](repo://openhands/memory/condenser/condenser.py#L44-L52), [openhands/agenthub/codeact_agent/codeact_agent.py:191-218](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L191-L218)

## Views and condensation events

`State.view` builds a `View` from the history with `View.from_events`, and caches it while the history length is unchanged. `from_events` collects the ids named by every `CondensationAction` (via `forgotten`, which accepts either a list of ids or an inclusive start and end range) plus the ids of the condensation actions and requests themselves, and drops them. If the latest `CondensationAction` carries a `summary` and a `summary_offset`, it inserts an `AgentCondensationObservation` holding the summary at that offset. It also sets `unhandled_condensation_request` when a `CondensationRequestAction` appears after the last `CondensationAction`.

Sources: [openhands/controller/state/state.py:298-311](repo://openhands/controller/state/state.py#L298-L311), [openhands/memory/view.py:47-93](repo://openhands/memory/view.py#L47-L93), [openhands/events/action/agent.py:107-188](repo://openhands/events/action/agent.py#L107-L188)

A `CondensationAction` must name its forgotten events either by id list or by range, never both, and a summary and its offset must be given together; otherwise `__post_init__` raises `ValueError`.

Sources: [openhands/events/action/agent.py:138-162](repo://openhands/events/action/agent.py#L138-L162)

## The condenser interface

`Condenser.condense(view)` returns either a `View` (use these events) or a `Condensation` wrapping a `CondensationAction`. `condensed_history(state)` calls it with `state.view`, passes LLM metadata to it, and writes any metadata the condenser collected into `state.extra_data` under `condenser_meta`. When an agent receives a `Condensation` it returns the action instead of producing its own; the controller publishes it, steps again, and the next `State.view` already excludes the forgotten events.

Sources: [openhands/memory/condenser/condenser.py:16-31](repo://openhands/memory/condenser/condenser.py#L16-L31), [openhands/memory/condenser/condenser.py:91-115](repo://openhands/memory/condenser/condenser.py#L91-L115), [openhands/controller/agent_controller.py:392-417](repo://openhands/controller/agent_controller.py#L392-L417)

`RollingCondenser` adds the common trigger pattern: `should_condense(view)` decides, and `get_condensation(view)` produces the action. Each config class is registered against its condenser class with `register_config`, and `Condenser.from_config` looks the class up in `CONDENSER_REGISTRY` by the type of the config object, raising `ValueError` for an unknown config.

Sources: [openhands/memory/condenser/condenser.py:129-193](repo://openhands/memory/condenser/condenser.py#L129-L193)

## Catalogue of condensers

### Types and triggers

Each condenser has a config model with a `type` string, used in the `[condenser]` section of `config.toml`. The default for an agent is `conversation_window`.

Sources: [openhands/core/config/agent_config.py:54-60](repo://openhands/core/config/agent_config.py#L54-L60)

| Type | Behaviour | Triggers |
| --- | --- | --- |
| `noop` | Returns the view unchanged | Never |
| `observation_masking` | Replaces observations older than `attention_window` (default 100) events with `<MASKED>` | Every step |
| `browser_output_masking` | Keeps the newest `attention_window` (default 1) browser outputs and replaces older ones with the URL and "Content omitted" | Every step |
| `recent` | Keeps the first `keep_first` events and the newest events up to `max_events` (default 100) | Every step |
| `amortized` | Forgets the middle of the history without summarising | `len(view) > max_size` |
| `llm` | Asks an LLM for a summary of the forgotten events and stores it in the action | `len(view) > max_size` |
| `structured` | Like `llm`, but forces a `create_state_summary` tool call with typed fields (user context, tasks, files, tests, branch) | `len(view) > max_size` |
| `llm_attention` | Asks an LLM to rank events by importance and keeps the top ones | `len(view) > max_size` |
| `conversation_window` | Keeps essential first events plus about half of the rest | An unhandled `CondensationRequestAction` |
| `pipeline` | Runs several condensers in order | Per member |

Sources: [openhands/core/config/condenser_config.py:11-105](repo://openhands/core/config/condenser_config.py#L11-L105), [openhands/core/config/condenser_config.py:108-193](repo://openhands/core/config/condenser_config.py#L108-L193), [openhands/memory/condenser/impl/__init__.py:1-41](repo://openhands/memory/condenser/impl/__init__.py#L1-L41), [openhands/memory/condenser/impl/observation_masking_condenser.py:1-39](repo://openhands/memory/condenser/impl/observation_masking_condenser.py#L1-L39), [openhands/memory/condenser/impl/browser_output_condenser.py:1-49](repo://openhands/memory/condenser/impl/browser_output_condenser.py#L1-L49), [openhands/memory/condenser/impl/recent_events_condenser.py:1-31](repo://openhands/memory/condenser/impl/recent_events_condenser.py#L1-L31)

### Rolling condensers that forget

`AmortizedForgettingCondenser`, `LLMSummarizingCondenser`, `StructuredSummaryCondenser` and `LLMAttentionCondenser` share a shape: once the view is longer than `max_size` they aim for half of `max_size`, keep the first `keep_first` events, and keep the newest events that fit. The constructors reject a `keep_first` of at least half of `max_size`. The amortized condenser forgets the middle events outright.

Sources: [openhands/memory/condenser/impl/amortized_forgetting_condenser.py:12-69](repo://openhands/memory/condenser/impl/amortized_forgetting_condenser.py#L12-L69)

The summarising condenser builds a prompt containing the previous summary (the `AgentCondensationObservation` that follows the kept head) and every forgotten event, truncated to `max_event_length`, then asks the LLM for a summary organised as user context, task tracking, completed, pending, current state, and code state. The result becomes a `CondensationAction` with the forgotten id range, the summary text and `summary_offset=keep_first`. Its LLM is registered as service `'condenser'` with prompt caching off, since the prompt changes every time.

Sources: [openhands/memory/condenser/impl/llm_summarizing_condenser.py:25-70](repo://openhands/memory/condenser/impl/llm_summarizing_condenser.py#L25-L70), [openhands/memory/condenser/impl/llm_summarizing_condenser.py:120-158](repo://openhands/memory/condenser/impl/llm_summarizing_condenser.py#L120-L158), [openhands/memory/condenser/impl/llm_summarizing_condenser.py:160-179](repo://openhands/memory/condenser/impl/llm_summarizing_condenser.py#L160-L179)

The structured condenser uses the same window arithmetic but forces a tool call whose arguments are the fields of `StateSummary`, and falls back to an empty `StateSummary` if the reply cannot be parsed. The attention condenser sends every event with its id and asks for a ranked list as a JSON schema, so it raises at construction if the model does not support `response_schema`.

Sources: [openhands/memory/condenser/impl/structured_summary_condenser.py:199-305](repo://openhands/memory/condenser/impl/structured_summary_condenser.py#L199-L305), [openhands/memory/condenser/impl/llm_attention_condenser.py:20-116](repo://openhands/memory/condenser/impl/llm_attention_condenser.py#L20-L116)

### Conversation window condenser

`ConversationWindowCondenser` reacts only to an unhandled condensation request, which the controller emits on a context-window error. It keeps the system message, the first user message and its recall action and observation, plus about half of the remaining events counted from the end. It then drops observations at the start of the kept tail, because they would be orphaned from their actions, and returns a `CondensationAction` naming a range when the forgotten ids are contiguous and a list otherwise. See [[Agent Controller and Agent States]].

Sources: [openhands/memory/condenser/impl/conversation_window_condenser.py:20-100](repo://openhands/memory/condenser/impl/conversation_window_condenser.py#L20-L100), [openhands/memory/condenser/impl/conversation_window_condenser.py:100-188](repo://openhands/memory/condenser/impl/conversation_window_condenser.py#L100-L188), [openhands/controller/agent_controller.py:894-915](repo://openhands/controller/agent_controller.py#L894-L915)

### Pipelines and the web default

`CondenserPipeline` runs its members in order, handing each one's output view to the next, and stops as soon as one returns a `Condensation`. Because the pipeline bypasses the usual single-condenser path, it overrides `metadata_batch` to collect metadata from every member.

Sources: [openhands/memory/condenser/impl/pipeline.py:1-50](repo://openhands/memory/condenser/impl/pipeline.py#L1-L50)

When `enable_default_condenser` is true, `WebSession.initialize_agent` replaces the agent's condenser with a three-step pipeline: `ConversationWindowCondenser`, then `BrowserOutputCondenser(attention_window=2)`, then `LLMSummarizingCondenser(keep_first=4, max_size=condenser_max_size or 120)`. The source comment explains the order: masking browser output first means the summariser only sees the latest browser output, which keeps summarisation cheap. See [[Conversation Lifecycle]].

Sources: [openhands/server/session/session.py:213-248](repo://openhands/server/session/session.py#L213-L248)

## From events to chat messages

`ConversationMemory.process_events` receives the condensed events and the first user message. It makes sure the list starts with a `SystemMessageAction` and then the user's initial `MessageAction`, inserting either if the history lost it. It then walks the events, calling `_process_action` or `_process_observation` for each.

Sources: [openhands/memory/conversation_memory.py:74-125](repo://openhands/memory/conversation_memory.py#L74-L125), [openhands/memory/conversation_memory.py:801-860](repo://openhands/memory/conversation_memory.py#L801-L860)

Tool calls need both halves present. An assistant message that started tool calls is held in `pending_tool_call_action_messages`, keyed by the response id, until every one of its tool call ids has a result message. Only then are the assistant message and its results appended, in that order. After the loop `_filter_unmatched_tool_calls` removes tool messages with no assistant call and trims assistant tool calls that have no result, which is the situation after a condenser forgets one half of a pair. Consecutive user messages are separated by a blank line.

Sources: [openhands/memory/conversation_memory.py:95-182](repo://openhands/memory/conversation_memory.py#L95-L182), [openhands/memory/conversation_memory.py:746-799](repo://openhands/memory/conversation_memory.py#L746-L799)

Two details keep the prompt small. Observation text is cut to the LLM's `max_message_chars`. A `RecallObservation` of knowledge type is filtered so a microagent already shown in an earlier recall is not repeated. `apply_prompt_caching` marks the system message and the last user or tool message as cacheable when the LLM supports it. See [[Microagents and Knowledge Recall]] and [[LLM Layer]].

Sources: [openhands/memory/conversation_memory.py:344-352](repo://openhands/memory/conversation_memory.py#L344-L352), [openhands/memory/conversation_memory.py:698-744](repo://openhands/memory/conversation_memory.py#L698-L744), [openhands/memory/conversation_memory.py:683-696](repo://openhands/memory/conversation_memory.py#L683-L696)
