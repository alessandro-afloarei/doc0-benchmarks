---
title: "Conversation Memory and Condensers"
---
## Overview

Before each LLM call an agent has to turn the conversation's event history into a list of chat messages, and keep that list short enough to fit the model. Two components share the job. A condenser decides which events the model sees: it returns a `View` of the history, or a `Condensation` that drops part of it. `ConversationMemory` then turns the events in that view into `Message` objects: system prompt, user and assistant turns, tool calls paired with their results. CodeAct uses both on every step, as [[Agents and CodeAct]] describes.

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:89-93](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L89-L93), [openhands/agenthub/codeact_agent/codeact_agent.py:191-208](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L191-L208)

The design keeps the stored history complete. Nothing is deleted from the [[Event Stream]]; condensation is itself an event that records which ids to forget and an optional summary, and every later view is recomputed from the full history with those events applied.

Sources: [openhands/memory/view.py:47-93](repo://openhands/memory/view.py#L47-L93), [openhands/events/action/agent.py:107-136](repo://openhands/events/action/agent.py#L107-L136)

## Views of the history

`State.view` builds a `View` from `state.history` with `View.from_events` and caches it until the history length changes. `from_events` collects the ids named by every `CondensationAction` (an explicit `forgotten_event_ids` list or a start and end range) and drops those events, the condensation actions themselves, and any `CondensationRequestAction`. If the most recent condensation carries a `summary` and `summary_offset`, the summary is inserted at that position as an `AgentCondensationObservation`.

Sources: [openhands/controller/state/state.py:299-311](repo://openhands/controller/state/state.py#L299-L311), [openhands/memory/view.py:47-78](repo://openhands/memory/view.py#L47-L78)

`from_events` also sets `unhandled_condensation_request` when a `CondensationRequestAction` appears after the last condensation. That flag is how a request reaches the condenser: the agent can ask for one with the `request_condensation` tool, and the controller adds one when the model reports a context-window error and `enable_history_truncation` is on, as [[Agent Controller]] explains.

Sources: [openhands/memory/view.py:80-93](repo://openhands/memory/view.py#L80-L93), [openhands/controller/agent_controller.py:888-917](repo://openhands/controller/agent_controller.py#L888-L917)

## Condensers

`Condenser` has one abstract method, `condense(view)`, returning either a `View` (use these events now) or a `Condensation` wrapping a `CondensationAction`. `condensed_history(state)` calls it on `state.view` inside a metadata batch, so anything recorded with `add_metadata` during the call is appended to `state.extra_data['condenser_meta']`. When the agent gets a `Condensation`, it returns the action instead of calling the LLM; the controller publishes it, steps again, and the next view already reflects it.

Sources: [openhands/memory/condenser/condenser.py:16-115](repo://openhands/memory/condenser/condenser.py#L16-L115)

`RollingCondenser` is the base for condensers that act only past a threshold: `condense` calls `should_condense(view)` and either returns the view unchanged or `get_condensation(view)`. Condensers that only rewrite the view (masking, truncating) extend `Condenser` directly and return a new `View` every time, without recording anything in the stream.

Sources: [openhands/memory/condenser/condenser.py:169-193](repo://openhands/memory/condenser/condenser.py#L169-L193), [openhands/memory/condenser/impl/observation_masking_condenser.py:11-39](repo://openhands/memory/condenser/impl/observation_masking_condenser.py#L11-L39)

Each implementation registers its config class with `register_config`, and `Condenser.from_config` looks the class up by the config's type, so the `type` field of a `[condenser]` section selects the implementation.

Sources: [openhands/memory/condenser/condenser.py:129-166](repo://openhands/memory/condenser/condenser.py#L129-L166), [openhands/core/config/condenser_config.py:11-107](repo://openhands/core/config/condenser_config.py#L11-L107), [openhands/core/config/condenser_config.py:108-176](repo://openhands/core/config/condenser_config.py#L108-L176)

## Condenser catalogue

| `type` | Class | What it does |
| --- | --- | --- |
| `noop` | `NoOpCondenser` | Returns the view unchanged |
| `observation_masking` | `ObservationMaskingCondenser` | Replaces observations older than `attention_window` (default 5) with `<MASKED>` |
| `browser_output_masking` | `BrowserOutputCondenser` | Masks all but the last `attention_window` browser outputs |
| `recent` | `RecentEventsCondenser` | Keeps the first `keep_first` and the last `max_events` events |
| `conversation_window` | `ConversationWindowCondenser` | On a condensation request, forgets about half the history, keeping the start of the conversation |
| `amortized` | `AmortizedForgettingCondenser` | Past `max_size`, forgets the middle of the history |
| `llm` | `LLMSummarizingCondenser` | Past `max_size`, replaces the middle with an LLM-written summary |
| `structured` | `StructuredSummaryCondenser` | Like `llm`, with a structured `StateSummary` |
| `llm_attention` | `LLMAttentionCondenser` | Past `max_size`, asks an LLM which events to keep |
| `pipeline` | `CondenserPipeline` | Runs several condensers in order |

Sources: [openhands/core/config/condenser_config.py:11-107](repo://openhands/core/config/condenser_config.py#L11-L107), [openhands/core/config/condenser_config.py:108-176](repo://openhands/core/config/condenser_config.py#L108-L176), [openhands/memory/condenser/impl/recent_events_condenser.py:8-31](repo://openhands/memory/condenser/impl/recent_events_condenser.py#L8-L31), [openhands/memory/condenser/impl/browser_output_condenser.py:11-20](repo://openhands/memory/condenser/impl/browser_output_condenser.py#L11-L20), [openhands/memory/condenser/impl/amortized_forgetting_condenser.py:13-69](repo://openhands/memory/condenser/impl/amortized_forgetting_condenser.py#L13-L69), [openhands/memory/condenser/impl/llm_attention_condenser.py:17-24](repo://openhands/memory/condenser/impl/llm_attention_condenser.py#L17-L24), [openhands/memory/condenser/impl/structured_summary_condenser.py:25-26](repo://openhands/memory/condenser/impl/structured_summary_condenser.py#L25-L26), [openhands/memory/condenser/impl/structured_summary_condenser.py:162-166](repo://openhands/memory/condenser/impl/structured_summary_condenser.py#L162-L166)

The browser-output masker exists, its docstring says, because screenshots and accessibility trees are large and cost many tokens without improving performance, so only the latest one is worth keeping in context.

Sources: [openhands/memory/condenser/impl/browser_output_condenser.py:11-15](repo://openhands/memory/condenser/impl/browser_output_condenser.py#L11-L15)

`ConversationWindowCondenser` is the only condenser whose trigger is the `unhandled_condensation_request` flag; the size-based ones trigger on `len(view) > max_size`. It keeps the system message, the first user message and its recall observation, keeps roughly the newer half of the history while keeping action and observation pairs together, and forgets the rest. It is the `AgentConfig` default, and the code says why: with `noop`, a context-window error would produce a condensation request that nothing ever handles.

Sources: [openhands/memory/condenser/impl/conversation_window_condenser.py:16-40](repo://openhands/memory/condenser/impl/conversation_window_condenser.py#L16-L40), [openhands/memory/condenser/impl/conversation_window_condenser.py:176-188](repo://openhands/memory/condenser/impl/conversation_window_condenser.py#L176-L188), [openhands/core/config/agent_config.py:54-60](repo://openhands/core/config/agent_config.py#L54-L60)

When the config file has no `[condenser]` section and `enable_default_condenser` is on, the default agent gets an `LLMSummarizingCondenser` using the default LLM instead, as [[Configuration]] notes.

Sources: [openhands/core/config/utils.py:320-338](repo://openhands/core/config/utils.py#L320-L338)

`CondenserPipeline` passes each condenser's output view to the next and stops at the first `Condensation`; it collects metadata from every stage itself, since the stages are not called through `condensed_history`.

Sources: [openhands/memory/condenser/impl/pipeline.py:12-50](repo://openhands/memory/condenser/impl/pipeline.py#L12-L50)

## Summarizing condensation

`LLMSummarizingCondenser` takes `max_size` (default 100), `keep_first` (default 1, which the config notes is most likely the user's task) and `max_event_length` (default 10,000 characters), and refuses a `keep_first` of half `max_size` or more. When the view grows past `max_size` it aims to halve it: it keeps the first `keep_first` events and enough of the newest events to reach `max_size // 2` including one summary, and forgets everything between them.

Sources: [openhands/memory/condenser/impl/llm_summarizing_condenser.py:17-69](repo://openhands/memory/condenser/impl/llm_summarizing_condenser.py#L17-L69), [openhands/core/config/condenser_config.py:61-85](repo://openhands/core/config/condenser_config.py#L61-L85)

The prompt asks the model to maintain a state summary with sections such as `USER_CONTEXT`, `TASK_TRACKING` (preserving task ids and statuses), `COMPLETED`, `PENDING`, `CURRENT_STATE`, and for code tasks `CODE_STATE`, `TESTS`, `CHANGES`, `DEPS` and `VERSION_CONTROL_STATUS`. It includes the previous summary and every forgotten event, each truncated to `max_event_length`, so each summary builds on the last. The result is a `CondensationAction` with the forgotten id range, the summary, and `summary_offset = keep_first`; the response and LLM metrics are recorded as condenser metadata.

Sources: [openhands/memory/condenser/impl/llm_summarizing_condenser.py:71-158](repo://openhands/memory/condenser/impl/llm_summarizing_condenser.py#L71-L158)

The condenser gets its own LLM from the registry under service id `condenser`, with prompt caching turned off: the code notes it would pay for cache writes without ever getting a cache read. Its cost is tracked separately, as [[LLM Layer]] describes.

Sources: [openhands/memory/condenser/impl/llm_summarizing_condenser.py:163-182](repo://openhands/memory/condenser/impl/llm_summarizing_condenser.py#L163-L182)

## From events to messages

`ConversationMemory.process_events` first makes sure the events start correctly: if no `SystemMessageAction` is present (older conversations), it renders one from the prompt manager and inserts it; if the second event is not the first user message, it inserts the original first user message, because condensation may have dropped it.

Sources: [openhands/memory/conversation_memory.py:74-96](repo://openhands/memory/conversation_memory.py#L74-L96), [openhands/memory/conversation_memory.py:801-860](repo://openhands/memory/conversation_memory.py#L801-L860)

Actions become messages by kind. A `MessageAction` becomes a user or assistant message, with image content when it has image URLs; a user-run `CmdRunAction` becomes "User executed the command"; an `AgentFinishAction` becomes an assistant message with its thought; the `SystemMessageAction` becomes the system message. Tool actions (commands, IPython, file edits and reads, browsing, MCP, delegation, think, task tracking) are not emitted directly: the assistant message that issued them is rebuilt from the `ModelResponse` in their `tool_call_metadata` and held as pending under the response id.

Sources: [openhands/memory/conversation_memory.py:221-270](repo://openhands/memory/conversation_memory.py#L221-L270), [openhands/memory/conversation_memory.py:271-342](repo://openhands/memory/conversation_memory.py#L271-L342)

Observations become user messages whose text depends on the type: command output with its exit code, IPython output with images, file edit diffs, browser output with a screenshot or set-of-marks image when vision is on, and so on, each truncated to `max_message_chars`. Invalid or empty image URLs are dropped with a note telling the agent to use other means. When the observation carries tool call metadata, it is stored as a `tool` role message keyed by the tool call id instead of being emitted.

Sources: [openhands/memory/conversation_memory.py:387-446](repo://openhands/memory/conversation_memory.py#L387-L446), [openhands/memory/conversation_memory.py:447-526](repo://openhands/memory/conversation_memory.py#L447-L526), [openhands/memory/conversation_memory.py:669-681](repo://openhands/memory/conversation_memory.py#L669-L681)

After each event, any pending assistant message whose tool calls all have results is emitted, followed by those results in call order. So even when one LLM response produced several calls answered by several observations, each assistant message with tool calls is directly followed by its tool results. A final pass, `_filter_unmatched_tool_calls`, removes tool results without a matching call and trims calls without a result, which can happen after condensation.

Sources: [openhands/memory/conversation_memory.py:129-164](repo://openhands/memory/conversation_memory.py#L129-L164), [openhands/memory/conversation_memory.py:746-799](repo://openhands/memory/conversation_memory.py#L746-L799)

## Workspace context and knowledge

`RecallObservation`s are rendered only when `enable_prompt_extensions` is on. A workspace-context recall becomes a user message built from the prompt manager's `additional_info.j2` (repository, runtime hosts, date, custom secrets, conversation instructions) plus any knowledge microagents triggered by the first message. A knowledge recall becomes the `microagent_info.j2` rendering of the triggered microagents, skipping any microagent already shown in an earlier recall and any listed in `disabled_microagents`. Where these recalls come from is the subject of [[Microagents]].

Sources: [openhands/memory/conversation_memory.py:527-625](repo://openhands/memory/conversation_memory.py#L527-L625), [openhands/memory/conversation_memory.py:626-662](repo://openhands/memory/conversation_memory.py#L626-L662), [openhands/memory/conversation_memory.py:698-744](repo://openhands/memory/conversation_memory.py#L698-L744)

## Prompt caching

When the LLM supports explicit cache breakpoints, `apply_prompt_caching` marks the last content item of the system message and of the last user or tool message as cacheable. Everything before the final turn can then be served from the provider's cache on the next call.

Sources: [openhands/memory/conversation_memory.py:683-696](repo://openhands/memory/conversation_memory.py#L683-L696), [openhands/agenthub/codeact_agent/codeact_agent.py:290-291](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L290-L291)
