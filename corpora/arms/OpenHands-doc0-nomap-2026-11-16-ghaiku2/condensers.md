---
title: "Condensers"
---
## Overview

A condenser decides which events the model sees when the history has grown too long. It does not remove events from the stored history. It produces a `View`, the list of events that will be sent, and when a strategy needs to shorten the view durably it records a `CondensationAction` in the stream. The agent asks the condenser for its view on every step, so the same strategy runs again on each step. The condensers live in `openhands/memory/condenser`, and the agent consumes their output as described in [[CodeAct Agent]].

Sources: [openhands/memory/condenser/condenser.py:44-53](repo://openhands/memory/condenser/condenser.py#L44-L53), [openhands/memory/condenser/condenser.py:92-117](repo://openhands/memory/condenser/condenser.py#L92-L117), [openhands/memory/condenser/condenser.py:38-43](repo://openhands/memory/condenser/condenser.py#L38-L43)

## The condenser interface

Every condenser implements `condense(view)`, which returns either a `View` or a `Condensation`. `condensed_history(state)` is the entry point the agent calls. It records the LLM metadata for the condenser's own calls, runs `condense` on the state's current view, and writes any per-condensation metadata when it finishes.

Sources: [openhands/memory/condenser/condenser.py:104-117](repo://openhands/memory/condenser/condenser.py#L104-L117), [openhands/memory/condenser/condenser.py:58-90](repo://openhands/memory/condenser/condenser.py#L58-L90)

A `Condensation` wraps one `CondensationAction`. When the agent receives it, it returns that action at once. The controller then sees the action in the stream, and `should_step` lets the agent step again, now against the shortened history.

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:196-205](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L196-L205), [openhands/controller/agent_controller.py:413-416](repo://openhands/controller/agent_controller.py#L413-L416)

`RollingCondenser` is the base for strategies that act only when the history crosses a threshold. It asks `should_condense(view)` and, when that is true, calls `get_condensation(view)`. Otherwise it returns the view unchanged. Most of the strategies below are rolling condensers.

Sources: [openhands/memory/condenser/condenser.py:169-193](repo://openhands/memory/condenser/condenser.py#L169-L193)

## The strategies

| Strategy | Config type | What it keeps |
| --- | --- | --- |
| No-op | `noop` | Every event; used when condensation is off |
| Recent events | `recent` | The first events and the most recent ones, up to a maximum |
| Observation masking | `observation_masking` | All events, with observations outside a recent window replaced by a placeholder |
| Browser output masking | `browser_output_masking` | All events, with older browser outputs masked |
| Amortized forgetting | `amortized` | Drops the oldest events once the history passes a maximum size |
| Conversation window | `conversation_window` | Roughly half the history, keeping the system message and first user message, and action-observation pairs |
| LLM summarising | `llm` | Replaces forgotten events with a summary written by an LLM |
| LLM attention | `llm_attention` | Asks an LLM which events matter and keeps those |
| Structured summary | `structured` | Summarises forgotten events into a structured state summary |
| Pipeline | `pipeline` | Runs several condensers in order, stopping at the first that condenses |

Sources: [openhands/memory/condenser/impl/no_op_condenser.py:8-20](repo://openhands/memory/condenser/impl/no_op_condenser.py#L8-L20), [openhands/memory/condenser/impl/recent_events_condenser.py:8-31](repo://openhands/memory/condenser/impl/recent_events_condenser.py#L8-L31), [openhands/memory/condenser/impl/observation_masking_condenser.py:11-39](repo://openhands/memory/condenser/impl/observation_masking_condenser.py#L11-L39), [openhands/memory/condenser/impl/browser_output_condenser.py:11-49](repo://openhands/memory/condenser/impl/browser_output_condenser.py#L11-L49), [openhands/memory/condenser/impl/amortized_forgetting_condenser.py:13-69](repo://openhands/memory/condenser/impl/amortized_forgetting_condenser.py#L13-L69), [openhands/memory/condenser/impl/conversation_window_condenser.py:16-40](repo://openhands/memory/condenser/impl/conversation_window_condenser.py#L16-L40), [openhands/memory/condenser/impl/llm_summarizing_condenser.py:17-40](repo://openhands/memory/condenser/impl/llm_summarizing_condenser.py#L17-L40), [openhands/memory/condenser/impl/llm_attention_condenser.py:17-40](repo://openhands/memory/condenser/impl/llm_attention_condenser.py#L17-L40), [openhands/memory/condenser/impl/structured_summary_condenser.py:162-185](repo://openhands/memory/condenser/impl/structured_summary_condenser.py#L162-L185), [openhands/memory/condenser/impl/pipeline.py:12-50](repo://openhands/memory/condenser/impl/pipeline.py#L12-L50)

The conversation window condenser also acts on an explicit request. Its `should_condense` returns true only when the view holds an unhandled condensation request, which is how the controller asks for truncation after a context-window error. Its `keep_first` must stay under half of `max_size`, or the constructor raises.

Sources: [openhands/memory/condenser/impl/conversation_window_condenser.py:176-178](repo://openhands/memory/condenser/impl/conversation_window_condenser.py#L176-L178), [openhands/memory/condenser/impl/amortized_forgetting_condenser.py:26-30](repo://openhands/memory/condenser/impl/amortized_forgetting_condenser.py#L26-L30), [openhands/controller/agent_controller.py:880-917](repo://openhands/controller/agent_controller.py#L880-L917)

The LLM summarising condenser triggers when the view is longer than `max_size`. It asks for a copy of its LLM with prompt caching turned off, because it sends long one-off prompts that would only pay for cache writes.

Sources: [openhands/memory/condenser/impl/llm_summarizing_condenser.py:160-172](repo://openhands/memory/condenser/impl/llm_summarizing_condenser.py#L160-L172)

## Defaults

The agent's default condenser is `ConversationWindowCondenserConfig`. The comment in the config says why: with a no-op condenser, a conversation that hits the model's context limit would produce a condensation request that nothing handles.

Sources: [openhands/core/config/agent_config.py:54-60](repo://openhands/core/config/agent_config.py#L54-L60)

When the configuration file has no `[condenser]` section and `enable_default_condenser` is on, the loader instead installs an LLM summarising condenser that uses the agent's LLM settings. The two defaults differ, so a deployment that wants truncation rather than summaries must set `[condenser]` explicitly.

Sources: [openhands/core/config/utils.py:320-335](repo://openhands/core/config/utils.py#L320-L335), [openhands/core/config/openhands_config.py:111-111](repo://openhands/core/config/openhands_config.py#L111-L111)

Each condenser config is selected by its `type` field, and each type has its own config class with its own defaults. A type that is not in the table of known condensers is rejected with `Unknown condenser type`.

Sources: [openhands/core/config/condenser_config.py:14-16](repo://openhands/core/config/condenser_config.py#L14-L16), [openhands/core/config/condenser_config.py:270-304](repo://openhands/core/config/condenser_config.py#L270-L304)
