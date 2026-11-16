---
title: "Condenser Strategies"
---
## Overview

A condenser decides which events the model sees before each call. Its input is the agent's `View`, the list of events the history currently contains, and its output is either a shorter `View` or a `Condensation` event that records what was forgotten. The agent asks the condenser on every step, so the strategy sets the cost of each call and how much of the history survives. The strategies share one contract, and each one is a class named in its own configuration section.

Sources: [openhands/memory/condenser/condenser.py:38-43](repo://openhands/memory/condenser/condenser.py#L38-L43) [openhands/memory/condenser/condenser.py:44-54](repo://openhands/memory/condenser/condenser.py#L44-L54)

## The contract

`Condenser.condense` takes a `View` and returns a `View` or a `Condensation`. A new strategy overrides this one method, and may call `add_metadata` to record diagnostics for the condensation. `condensed_history` wraps the call: it sets the LLM metadata for the state and runs `condense` inside a metadata batch.

Sources: [openhands/memory/condenser/condenser.py:92-103](repo://openhands/memory/condenser/condenser.py#L92-L103) [openhands/memory/condenser/condenser.py:104-116](repo://openhands/memory/condenser/condenser.py#L104-L116)

`RollingCondenser` is the base for strategies that decide when to condense. It asks `should_condense` on the view. If that answers yes, it returns `get_condensation`; otherwise it returns the view unchanged. The strategies that keep a summary or a set of forgotten events use this base.

Sources: [openhands/memory/condenser/condenser.py:169-192](repo://openhands/memory/condenser/condenser.py#L169-L192)

When the agent receives a `Condensation` from `condensed_history`, it returns that condensation as its action, and the controller steps the agent again with the reduced view. See [[Agents]] for that step.

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:196-205](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L196-L205)

## The strategies

| Strategy | Base | What it keeps or forgets | Config class |
| --- | --- | --- | --- |
| `NoOpCondenser` | `Condenser` | Returns the events unchanged | `NoOpCondenserConfig` (line 11) |
| `RecentEventsCondenser` | `Condenser` | Keeps the first `keep_first` events and the latest `max_events` | `RecentEventsCondenserConfig` (line 43) |
| `ObservationMaskingCondenser` | `Condenser` | Replaces observation content outside the recent `attention_window` with a placeholder | `ObservationMaskingCondenserConfig` (line 19) |
| `BrowserOutputCondenser` | `Condenser` | Masks browser outputs outside a recent window and leaves other events alone | `BrowserOutputCondenserConfig` (line 32) |
| `ConversationWindowCondenser` | `RollingCondenser` | Keeps the essential opening events and about half of the history, keeping action and observation pairs together | `ConversationWindowCondenserConfig` (line 170) |
| `AmortizedForgettingCondenser` | `RollingCondenser` | Forgets old events once the history passes `max_size`, keeping the first `keep_first` | `AmortizedForgettingCondenserConfig` (line 88) |
| `LLMSummarizingCondenser` | `RollingCondenser` | Replaces forgotten events with one summary event that summarises earlier summaries too | `LLMSummarizingCondenserConfig` (line 61) |
| `LLMAttentionCondenser` | `RollingCondenser` | Asks the LLM which events to keep, by id | `LLMAttentionCondenserConfig` (line 108) |
| `StructuredSummaryCondenser` | `RollingCondenser` | Summarises into a fixed set of fields such as user context, completed tasks and pending tasks | `StructuredSummaryCondenserConfig` (line 131) |
| `CondenserPipeline` | `Condenser` | Runs several condensers in sequence, passing each output view to the next | `CondenserPipelineConfig` (line 158) |

Sources: [openhands/memory/condenser/impl/no_op_condenser.py:8-13](repo://openhands/memory/condenser/impl/no_op_condenser.py#L8-L13) [openhands/memory/condenser/impl/recent_events_condenser.py:8-18](repo://openhands/memory/condenser/impl/recent_events_condenser.py#L8-L18) [openhands/memory/condenser/impl/observation_masking_condenser.py:11-22](repo://openhands/memory/condenser/impl/observation_masking_condenser.py#L11-L22) [openhands/memory/condenser/impl/browser_output_condenser.py:11-22](repo://openhands/memory/condenser/impl/browser_output_condenser.py#L11-L22) [openhands/memory/condenser/impl/conversation_window_condenser.py:16-28](repo://openhands/memory/condenser/impl/conversation_window_condenser.py#L16-L28) [openhands/memory/condenser/impl/amortized_forgetting_condenser.py:13-17](repo://openhands/memory/condenser/impl/amortized_forgetting_condenser.py#L13-L17) [openhands/memory/condenser/impl/llm_summarizing_condenser.py:17-23](repo://openhands/memory/condenser/impl/llm_summarizing_condenser.py#L17-L23) [openhands/memory/condenser/impl/llm_attention_condenser.py:17-24](repo://openhands/memory/condenser/impl/llm_attention_condenser.py#L17-L24) [openhands/memory/condenser/impl/structured_summary_condenser.py:25-27](repo://openhands/memory/condenser/impl/structured_summary_condenser.py#L25-L27) [openhands/memory/condenser/impl/structured_summary_condenser.py:162-165](repo://openhands/memory/condenser/impl/structured_summary_condenser.py#L162-L165) [openhands/memory/condenser/impl/pipeline.py:12-16](repo://openhands/memory/condenser/impl/pipeline.py#L12-L16) [openhands/core/config/condenser_config.py:11-18](repo://openhands/core/config/condenser_config.py#L11-L18) [openhands/core/config/condenser_config.py:19-31](repo://openhands/core/config/condenser_config.py#L19-L31) [openhands/core/config/condenser_config.py:32-42](repo://openhands/core/config/condenser_config.py#L32-L42) [openhands/core/config/condenser_config.py:43-60](repo://openhands/core/config/condenser_config.py#L43-L60) [openhands/core/config/condenser_config.py:61-87](repo://openhands/core/config/condenser_config.py#L61-L87) [openhands/core/config/condenser_config.py:88-107](repo://openhands/core/config/condenser_config.py#L88-L107) [openhands/core/config/condenser_config.py:108-130](repo://openhands/core/config/condenser_config.py#L108-L130) [openhands/core/config/condenser_config.py:131-157](repo://openhands/core/config/condenser_config.py#L131-L157) [openhands/core/config/condenser_config.py:158-169](repo://openhands/core/config/condenser_config.py#L158-L169) [openhands/core/config/condenser_config.py:170-195](repo://openhands/core/config/condenser_config.py#L170-L195)

Rolling strategies differ mainly in their trigger. Each one answers `should_condense` on the view and builds its `Condensation` in `get_condensation`. Three of them call the model from their own code (`LLMAttentionCondenser`, `LLMSummarizingCondenser` and `StructuredSummaryCondenser`), so a condensation made by one of them costs at least one extra completion.

Sources: [openhands/memory/condenser/impl/llm_attention_condenser.py:67-67](repo://openhands/memory/condenser/impl/llm_attention_condenser.py#L67-L67) [openhands/memory/condenser/impl/llm_summarizing_condenser.py:142-142](repo://openhands/memory/condenser/impl/llm_summarizing_condenser.py#L142-L142) [openhands/memory/condenser/impl/structured_summary_condenser.py:255-255](repo://openhands/memory/condenser/impl/structured_summary_condenser.py#L255-L255) [openhands/memory/condenser/impl/conversation_window_condenser.py:20-27](repo://openhands/memory/condenser/impl/conversation_window_condenser.py#L20-L27) [openhands/memory/condenser/impl/conversation_window_condenser.py:176-178](repo://openhands/memory/condenser/impl/conversation_window_condenser.py#L176-L178) [openhands/memory/condenser/impl/llm_summarizing_condenser.py:52-56](repo://openhands/memory/condenser/impl/llm_summarizing_condenser.py#L52-L56) [openhands/memory/condenser/impl/llm_attention_condenser.py:56-60](repo://openhands/memory/condenser/impl/llm_attention_condenser.py#L56-L60) [openhands/memory/condenser/impl/amortized_forgetting_condenser.py:40-44](repo://openhands/memory/condenser/impl/amortized_forgetting_condenser.py#L40-L44) [openhands/memory/condenser/impl/structured_summary_condenser.py:199-203](repo://openhands/memory/condenser/impl/structured_summary_condenser.py#L199-L203)

## Pipelines and configuration

`CondenserPipeline` holds several condensers and runs them in order. Each one receives the view produced by the one before it, and a `Condensation` returned by any stage ends the chain for that step. The pipeline's metadata batch is forwarded to its members.

Sources: [openhands/memory/condenser/impl/pipeline.py:12-45](repo://openhands/memory/condenser/impl/pipeline.py#L12-L45)

`condenser_config_from_toml_section` builds each strategy's config from a TOML section, and `create_condenser_config` picks the config class from the type name. `Condenser.from_config` then looks up the strategy registered for that config class.

Sources: [openhands/core/config/condenser_config.py:196-205](repo://openhands/core/config/condenser_config.py#L196-L205) [openhands/core/config/condenser_config.py:270-275](repo://openhands/core/config/condenser_config.py#L270-L275) [openhands/memory/condenser/condenser.py:148-167](repo://openhands/memory/condenser/condenser.py#L148-L167)
