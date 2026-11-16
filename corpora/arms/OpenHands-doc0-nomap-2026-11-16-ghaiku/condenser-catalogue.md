---
title: "Condenser Catalogue"
---
## Overview

A condenser decides which part of the event history the model sees. The agent asks for `state.view` through `condensed_history`, and the condenser returns either a shorter `View` to send to the model or a `Condensation` that the agent must hand back to the controller. The condensers below all implement that one interface, so the agent does not know which strategy is in use. The agent's side of this call is described in [[CodeAct Agent]].

Sources: [openhands/memory/condenser/condenser.py:44-52](repo://openhands/memory/condenser/condenser.py#L44-L52), [openhands/memory/condenser/condenser.py:104-115](repo://openhands/memory/condenser/condenser.py#L104-L115), [openhands/agenthub/codeact_agent/codeact_agent.py:192-204](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L192-L204)

## The interface

`Condensation` wraps a `CondensationAction`. The action names a range of forgotten event ids, or a list of ids, and it can carry a summary and the offset where the summary goes. When a condenser returns one, the agent returns that action as its step, and the controller writes it to the stream. The view is then built from the stream, and the forgotten events are left out of it.

Sources: [openhands/memory/condenser/condenser.py:38-42](repo://openhands/memory/condenser/condenser.py#L38-L42), [openhands/events/action/agent.py:108-135](repo://openhands/events/action/agent.py#L108-L135), [openhands/controller/agent_controller.py:960-974](repo://openhands/controller/agent_controller.py#L960-L974), [openhands/controller/state/state.py:299-309](repo://openhands/controller/state/state.py#L299-L309), [openhands/memory/view.py:44-60](repo://openhands/memory/view.py#L44-L60)

`RollingCondenser` is the base for condensers that act on size. Its `condense` asks `should_condense` first. If that is true it returns `get_condensation`, and otherwise it returns the view unchanged. Subclasses supply only those two methods.

Sources: [openhands/memory/condenser/condenser.py:169-193](repo://openhands/memory/condenser/condenser.py#L169-L193)

## Choosing a condenser

The configuration selects a condenser by its `type` value. Each type maps to one class, and the fields of its config model are passed to that class's constructor. The table lists the types and what each one does.

Sources: [openhands/core/config/condenser_config.py:11-19](repo://openhands/core/config/condenser_config.py#L11-L19), [openhands/memory/condenser/impl/recent_events_condenser.py:24-28](repo://openhands/memory/condenser/impl/recent_events_condenser.py#L24-L28)

| Type | Class | Keeps | Model call |
| --- | --- | --- | --- |
| `noop` | `NoOpCondenser` | everything | no |
| `recent` | `RecentEventsCondenser` | the first events and the last `max_events` | no |
| `amortized` | `AmortizedForgettingCondenser` | the first events and the newest half of `max_size` | no |
| `conversation_window` (default) | `ConversationWindowCondenser` | the essential first events and about half the history | no |
| `observation_masking` | `ObservationMaskingCondenser` | every event, with old observations replaced | no |
| `browser_output_masking` | `BrowserOutputCondenser` | every event, with old browser pages replaced | no |
| `llm` | `LLMSummarizingCondenser` | the first events and the newest half, plus a summary | yes |
| `llm_attention` | `LLMAttentionCondenser` | the most important events, chosen by the model | yes |
| `structured` | `StructuredSummaryCondenser` | the first events and the newest half, plus a structured summary | yes |
| `pipeline` | `CondenserPipeline` | the output of several condensers in order | depends |

Sources: [openhands/core/config/condenser_config.py:11-19](repo://openhands/core/config/condenser_config.py#L11-L19), [openhands/core/config/condenser_config.py:43-58](repo://openhands/core/config/condenser_config.py#L43-L58), [openhands/core/config/condenser_config.py:88-106](repo://openhands/core/config/condenser_config.py#L88-L106), [openhands/core/config/condenser_config.py:158-180](repo://openhands/core/config/condenser_config.py#L158-L180)

## Dropping events

`NoOpCondenser` returns the view it is given. It is not the default: the agent config names `ConversationWindowCondenser` as the default, because with no-op the context-length limit would produce a condensation request that is never handled.

Sources: [openhands/memory/condenser/impl/no_op_condenser.py:9-19](repo://openhands/memory/condenser/impl/no_op_condenser.py#L9-L19), [openhands/core/config/agent_config.py:54-60](repo://openhands/core/config/agent_config.py#L54-L60)

`RecentEventsCondenser` keeps the first `keep_first` events and the last `max_events` minus those. It never returns a `Condensation`, so nothing is recorded in the stream.

Sources: [openhands/memory/condenser/impl/recent_events_condenser.py:9-28](repo://openhands/memory/condenser/impl/recent_events_condenser.py#L9-L28)

`AmortizedForgettingCondenser` waits until the view is longer than `max_size`. Then it keeps the first `keep_first` events and enough of the newest events to reach half of `max_size`, and it records the rest as forgotten. Half of the limit gives the model headroom before the next condensation. The constructor refuses a `keep_first` of half `max_size` or more.

Sources: [openhands/memory/condenser/impl/amortized_forgetting_condenser.py:14-36](repo://openhands/memory/condenser/impl/amortized_forgetting_condenser.py#L14-L36), [openhands/memory/condenser/impl/amortized_forgetting_condenser.py:40-58](repo://openhands/memory/condenser/impl/amortized_forgetting_condenser.py#L40-L58)

`ConversationWindowCondenser` runs only when a `CondensationRequestAction` is pending. Its docstring names the events it keeps: the system message, the first user message and the recall observation. It keeps about half of the rest and keeps action and observation pairs together.

Sources: [openhands/memory/condenser/impl/conversation_window_condenser.py:17-30](repo://openhands/memory/condenser/impl/conversation_window_condenser.py#L17-L30), [openhands/memory/condenser/impl/conversation_window_condenser.py:176-177](repo://openhands/memory/condenser/impl/conversation_window_condenser.py#L176-L177)

## Masking content

`ObservationMaskingCondenser` keeps every event but replaces the content of observations older than `attention_window` with a `<MASKED>` placeholder. The default window is five observations.

Sources: [openhands/memory/condenser/impl/observation_masking_condenser.py:12-28](repo://openhands/memory/condenser/impl/observation_masking_condenser.py#L12-L28)

`BrowserOutputCondenser` does the same for browser pages only. It walks the view from the newest event, and it replaces each browser output past `attention_window`, which defaults to one, with the URL and the text "Content omitted".

Sources: [openhands/memory/condenser/impl/browser_output_condenser.py:12-32](repo://openhands/memory/condenser/impl/browser_output_condenser.py#L12-L32), [openhands/memory/condenser/impl/browser_output_condenser.py:17-18](repo://openhands/memory/condenser/impl/browser_output_condenser.py#L17-L18)

## Model-based condensers

`LLMSummarizingCondenser` is a rolling condenser. When the view grows past `max_size`, it sends the middle events to the model and records the reply as a summary. The events it forgets are the ones between the kept head and the kept tail. Long events are truncated to `max_event_length` before the call.

Sources: [openhands/memory/condenser/impl/llm_summarizing_condenser.py:18-23](repo://openhands/memory/condenser/impl/llm_summarizing_condenser.py#L18-L23), [openhands/memory/condenser/impl/llm_summarizing_condenser.py:52-67](repo://openhands/memory/condenser/impl/llm_summarizing_condenser.py#L52-L67), [openhands/memory/condenser/impl/llm_summarizing_condenser.py:142-161](repo://openhands/memory/condenser/impl/llm_summarizing_condenser.py#L142-L161)

`LLMAttentionCondenser` also runs above `max_size`, but the model does not summarize. It is given the identifiers of the events and asked to rank them by importance for the next step. The top-ranked events fill the half that is kept, and the rest are recorded as forgotten.

Sources: [openhands/memory/condenser/impl/llm_attention_condenser.py:18-24](repo://openhands/memory/condenser/impl/llm_attention_condenser.py#L18-L24), [openhands/memory/condenser/impl/llm_attention_condenser.py:56-69](repo://openhands/memory/condenser/impl/llm_attention_condenser.py#L56-L69), [openhands/memory/condenser/impl/llm_attention_condenser.py:118-119](repo://openhands/memory/condenser/impl/llm_attention_condenser.py#L118-L119)

`StructuredSummaryCondenser` works like the summarizing condenser, but its summary is a `StateSummary` with fields for the user's context, the completed tasks and the pending tasks. The model fills those fields through a tool description. The class validates `keep_first` in the same way.

Sources: [openhands/memory/condenser/impl/structured_summary_condenser.py:25-40](repo://openhands/memory/condenser/impl/structured_summary_condenser.py#L25-L40), [openhands/memory/condenser/impl/structured_summary_condenser.py:162-186](repo://openhands/memory/condenser/impl/structured_summary_condenser.py#L162-L186), [openhands/memory/condenser/impl/structured_summary_condenser.py:199-308](repo://openhands/memory/condenser/impl/structured_summary_condenser.py#L199-L308)

## Pipeline

`CondenserPipeline` runs its condensers in order, each on the result of the one before. The first `Condensation` stops the chain, so the rest do not see the view.

Sources: [openhands/memory/condenser/impl/pipeline.py:12-40](repo://openhands/memory/condenser/impl/pipeline.py#L12-L40)

The base class collects each condenser's metadata around the call. The summarizing and attention condensers make their model calls through the same `LLM` wrapper described in [[LLM Client]]. The prompt that the kept events end up in is built by [[CodeAct Agent]].

Sources: [openhands/memory/condenser/condenser.py:104-115](repo://openhands/memory/condenser/condenser.py#L104-L115), [openhands/memory/condenser/impl/llm_summarizing_condenser.py:142-150](repo://openhands/memory/condenser/impl/llm_summarizing_condenser.py#L142-L150), [openhands/llm/llm.py:54-61](repo://openhands/llm/llm.py#L54-L61)
