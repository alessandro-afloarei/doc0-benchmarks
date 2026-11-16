---
title: "Condensers"
---
## Overview

A long task produces more events than a model's context window can hold. A `Condenser` takes the agent's view of the history and either returns a smaller `View`, or returns a `Condensation` that wraps a `CondensationAction`. `CodeActAgent` calls its condenser at the start of every step and returns a `Condensation`'s action instead of an LLM action; the [[Agent Controller Loop]] steps the agent again straight away, and this time the stored condensation event shapes the view. The messages built from that view are covered in [[Conversation Memory and Microagents]].

Sources: [openhands/memory/condenser/condenser.py:44-52](repo://openhands/memory/condenser/condenser.py#L44-L52), [openhands/agenthub/codeact_agent/codeact_agent.py:191-201](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L191-L201)

## View and condensation events

`View.from_events` is how a condensation takes effect. It collects the ids named by every `CondensationAction` (and the ids of the condensation actions and requests themselves) as forgotten, and keeps the remaining events. If the most recent `CondensationAction` carries a `summary` and a `summary_offset`, it inserts an `AgentCondensationObservation` holding that summary at the offset. It also sets `unhandled_condensation_request` when a `CondensationRequestAction` appears after the last `CondensationAction`.

Sources: [openhands/memory/view.py:13-93](repo://openhands/memory/view.py#L13-L93)

A `CondensationAction` names its forgotten events either as a list (`forgotten_event_ids`) or as a contiguous range (`forgotten_events_start_id` to `forgotten_events_end_id`), plus an optional `summary`. `State.view` builds the `View` from `state.history`, and reuses the cached one while the history length is unchanged.

Sources: [openhands/events/action/agent.py:108-137](repo://openhands/events/action/agent.py#L108-L137), [openhands/controller/state/state.py:298-311](repo://openhands/controller/state/state.py#L298-L311)

## The Condenser interface

`Condenser.condensed_history(state)` records LLM metadata from the state and calls `condense(state.view)` inside a `metadata_batch`, which writes any diagnostic metadata that the implementation added (`add_metadata`) into `state.extra_data` under `condenser_meta`. Implementations override `condense`.

Sources: [openhands/memory/condenser/condenser.py:16-31](repo://openhands/memory/condenser/condenser.py#L16-L31), [openhands/memory/condenser/condenser.py:54-115](repo://openhands/memory/condenser/condenser.py#L54-L115)

Each implementation pairs with a config class through `register_config`, which fills `CONDENSER_REGISTRY` (a duplicate raises `ValueError`). `Condenser.from_config(config, llm_registry)` looks up the class by the type of the config and delegates to its own `from_config`; an unregistered type raises `ValueError`. `AgentConfig.condenser` is that config.

Sources: [openhands/memory/condenser/condenser.py:129-166](repo://openhands/memory/condenser/condenser.py#L129-L166), [openhands/core/config/condenser_config.py:168-190](repo://openhands/core/config/condenser_config.py#L168-L190)

`RollingCondenser` is the base for the condensers that act only when a threshold is hit: its `condense` returns the view unchanged unless `should_condense(view)` is true, and then returns `get_condensation(view)`.

Sources: [openhands/memory/condenser/condenser.py:169-193](repo://openhands/memory/condenser/condenser.py#L169-L193)

> [!NOTE]
> The default is `ConversationWindowCondenser`. The comment in `AgentConfig` explains why: with a no-op condenser, a context-window overflow makes the agent emit a condensation request that nothing ever handles.

Sources: [openhands/core/config/agent_config.py:54-61](repo://openhands/core/config/agent_config.py#L54-L61)

## Catalogue

### Config names and defaults

The config names (the `type` field) and the defaults below come from the config classes.

Sources: [openhands/core/config/condenser_config.py:11-30](repo://openhands/core/config/condenser_config.py#L11-L30)

| Condenser (`type`) | What it does | Rolling | Key settings |
| --- | --- | --- | --- |
| `ConversationWindowCondenser` (`conversation_window`) | Condenses on demand, when a condensation request is pending | yes | none |
| `NoOpCondenser` (`noop`) | Returns the view unchanged | no | none |
| `ObservationMaskingCondenser` (`observation_masking`) | Replaces observations older than a window with `<MASKED>` | no | `attention_window` 100 |
| `BrowserOutputCondenser` (`browser_output_masking`) | Replaces old browser observations with `Visited URL ...` and `Content omitted` | no | `attention_window` 1 |
| `RecentEventsCondenser` (`recent`) | Keeps the first events and the most recent ones | no | `keep_first` 1, `max_events` 100 |
| `AmortizedForgettingCondenser` (`amortized`) | Forgets the middle of the history once it grows past a size | yes | `max_size` 100, `keep_first` 1 |
| `LLMSummarizingCondenser` (`llm`) | Forgets the middle and records an LLM summary | yes | `llm_config`, `max_size` 100, `keep_first` 1, `max_event_length` 10,000 |
| `LLMAttentionCondenser` (`llm_attention`) | Asks an LLM which events matter most and forgets the rest | yes | `llm_config`, `max_size` 100, `keep_first` 1 |
| `StructuredSummaryCondenser` (`structured`) | Like the summarizing one, with a structured state summary | yes | `llm_config`, `keep_first` 1, `max_size` 100, `max_event_length` 10,000 |
| `CondenserPipeline` (`pipeline`) | Runs several condensers in sequence | no | `condensers` |

Sources: [openhands/core/config/condenser_config.py:11-130](repo://openhands/core/config/condenser_config.py#L11-L130), [openhands/memory/condenser/impl/__init__.py:1-41](repo://openhands/memory/condenser/impl/__init__.py#L1-L41)

### Window and size-based strategies

`ConversationWindowCondenser.should_condense` is true only when the view has an unhandled condensation request. It then always keeps the system message, the first user message and its `RecallAction` with its observation, plus roughly the newest half of the remaining events. It drops leading observations from that tail so that no observation is left without its action, and describes what was forgotten as a range when the ids are contiguous, otherwise as a list.

Sources: [openhands/memory/condenser/impl/conversation_window_condenser.py:16-90](repo://openhands/memory/condenser/impl/conversation_window_condenser.py#L16-L90), [openhands/memory/condenser/impl/conversation_window_condenser.py:116-180](repo://openhands/memory/condenser/impl/conversation_window_condenser.py#L116-L180)

`AmortizedForgettingCondenser` condenses once the view is longer than `max_size`, keeping `keep_first` events at the head and enough from the tail to reach `max_size // 2`, and forgets everything between by id range. The constructor requires `keep_first` to be below half of `max_size`; the LLM-based condensers check the same.

Sources: [openhands/memory/condenser/impl/amortized_forgetting_condenser.py:15-69](repo://openhands/memory/condenser/impl/amortized_forgetting_condenser.py#L15-L69)

`RecentEventsCondenser` is not rolling and writes no condensation event: each call returns the `keep_first` head plus the tail so the total is `max_events`.

Sources: [openhands/memory/condenser/impl/recent_events_condenser.py:12-31](repo://openhands/memory/condenser/impl/recent_events_condenser.py#L12-L31)

### Masking strategies

`ObservationMaskingCondenser` keeps every action but replaces the observation content with `<MASKED>` unless it is among the last `attention_window` events. `BrowserOutputCondenser` targets only `BrowserOutputObservation`: its docstring says screenshots and accessibility trees are very large and add tokens with no performance benefit, so it leaves only the most recent one(s) in context.

Sources: [openhands/memory/condenser/impl/observation_masking_condenser.py:12-39](repo://openhands/memory/condenser/impl/observation_masking_condenser.py#L12-L39), [openhands/memory/condenser/impl/browser_output_condenser.py:13-49](repo://openhands/memory/condenser/impl/browser_output_condenser.py#L13-L49)

### LLM-based strategies

`LLMSummarizingCondenser` keeps `keep_first` events, and a single `AgentCondensationObservation` right after them that carries the running summary. When the view exceeds `max_size` it sends the previous summary and the events to be forgotten (each truncated to `max_event_length`) to its LLM with a prompt that tracks user context, tasks, completed and pending work, and code state. It returns a `CondensationAction` with the forgotten range, the new summary and `summary_offset` set to `keep_first`. Its `from_config` turns off `caching_prompt` for the condenser's LLM, because this condenser cannot benefit from prompt caching.

Sources: [openhands/memory/condenser/impl/llm_summarizing_condenser.py:17-60](repo://openhands/memory/condenser/impl/llm_summarizing_condenser.py#L17-L60), [openhands/memory/condenser/impl/llm_summarizing_condenser.py:108-182](repo://openhands/memory/condenser/impl/llm_summarizing_condenser.py#L108-L182)

`StructuredSummaryCondenser` has the same thresholds but asks for a `StateSummary` with fields such as `user_context`, `completed_tasks`, `pending_tasks` and `current_state`.

Sources: [openhands/memory/condenser/impl/structured_summary_condenser.py:25-40](repo://openhands/memory/condenser/impl/structured_summary_condenser.py#L25-L40), [openhands/memory/condenser/impl/structured_summary_condenser.py:169-215](repo://openhands/memory/condenser/impl/structured_summary_condenser.py#L169-L215)

`LLMAttentionCondenser` sends every event's id and message to its LLM with a JSON schema (`ImportantEventSelection`) and asks it to sort the ids by importance. It keeps the head and the top-ranked ids up to the target size and forgets the rest. It refuses to start if the model does not support `response_schema`.

Sources: [openhands/memory/condenser/impl/llm_attention_condenser.py:19-100](repo://openhands/memory/condenser/impl/llm_attention_condenser.py#L19-L100)

### Pipeline

`CondenserPipeline` passes the view through its condensers in order and stops at the first one that returns a `Condensation`; since the pipeline holds no state, its `metadata_batch` collects the batches from each member instead. Its config nests other condenser configs in `condensers`.

Sources: [openhands/memory/condenser/impl/pipeline.py:12-50](repo://openhands/memory/condenser/impl/pipeline.py#L12-L50), [openhands/core/config/condenser_config.py:158-166](repo://openhands/core/config/condenser_config.py#L158-L166)
