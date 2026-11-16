---
type: workflow
title: Memory, Context Condensation, and Conversation Memory
description: How OpenHands keeps a long conversation within the model's context window through condensers that forget or summarize events, how the agent's view of history is built from condensation events, how ConversationMemory turns events into LLM messages, and how the Memory component injects repository, runtime, and microagent knowledge.
tags: [memory, condenser, context-window, summarization, microagents, recall, conversation-memory]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T11:08:31.416Z
sources:
  - id: openwiki-source-2129d0084f64a3f5714baf90
    resource: repo://openhands/controller/agent_controller.py
  - id: openwiki-source-4ae545fc5168dd6cca0bd13a
    resource: repo://openhands/core/config/agent_config.py
  - id: openwiki-source-fce2a7562fd3d4a7cda99a98
    resource: repo://openhands/memory/condenser/condenser.py
  - id: openwiki-source-c78d349ef970e2d9397b965c
    resource: repo://openhands/memory/condenser/impl/conversation_window_condenser.py
  - id: openwiki-source-dfa66cc76a9001b6e96afff0
    resource: repo://openhands/memory/condenser/impl/llm_summarizing_condenser.py
  - id: openwiki-source-80537cfa20ffe0e7dbe872ef
    resource: repo://openhands/memory/conversation_memory.py
  - id: openwiki-source-ae571bbab7bb1b3526362fb5
    resource: repo://openhands/memory/memory.py
  - id: openwiki-source-9b673d479a7f171981712809
    resource: repo://openhands/memory/view.py
generated: { by: "claude-code", at: "2026-11-16T11:08:31.416Z" }
---

# Memory, Context Condensation, and Conversation Memory

A conversation can produce far more events than a model can read at once. OpenHands handles this with
two cooperating mechanisms. **Condensation** decides which past events the model sees, and it can
replace a block of old events with a summary. **Memory** adds background knowledge to the conversation:
the repository and runtime description, and microagent guidance that matches the current request. The
conversion of events into the message list that the model receives is done by `ConversationMemory`.

The pieces live in `openhands/memory/`, with condenser settings in
`openhands/core/config/condenser_config.py`. The LLM call that consumes the result is described in
[LLM Layer](../architecture/llm-layer.md).

## Events are never deleted

Condensation does not remove events from the stream. It appends a `CondensationAction`, which lists
the IDs to forget and optionally a summary and its position. The full history stays on disk for replay,
trajectories, and the UI. Only the **view** that the LLM receives changes.

`View` (`openhands/memory/view.py:13`) is the ordered list of events that will be sent to the model.
`View.from_events` (`view.py:48`) builds it from the full history:

1. it collects the IDs named by every `CondensationAction`, and drops those events together with the
   condensation event itself;
2. it drops the events of each `CondensationRequestAction` that has been handled;
3. it inserts the summary from the most recent `CondensationAction` at its recorded offset.

`View.unhandled_condensation_request` (`view.py:20`) reports whether the agent has asked for a
condensation that has not been done yet. That flag drives one of the condensers below.

## The condenser pipeline

A `Condenser` (`openhands/memory/condenser/condenser.py:44`) is called by the CodeAct agent before every
model call:

1. `condensed_history(state)` (`condenser.py:104`) records the LLM metadata and opens a metadata batch,
   then calls `condense(state.view)`;
2. `condense` returns either a `View`, which is used as is, or a `Condensation` wrapping a
   `CondensationAction` (`condenser.py:38`).

A `Condensation` is not sent to the model. The agent returns it as its action, the controller stores it in
the event stream, and the agent is asked to step again with the new view. This is why condensation takes
one extra step, but it is recorded in the history like any other event.

`RollingCondenser` (`condenser.py:169`) is the common base for strategies that check a size threshold. It
asks `should_condense(view)` and, when it returns true, calls `get_condensation(view)`
(`condenser.py:185-193`).

### Implementations

The modules in `openhands/memory/condenser/impl/` are registered with `register_config`, which maps
the `type` value in configuration to the class:

| Type | Class | Behavior |
| --- | --- | --- |
| `conversation_window` (default) | `ConversationWindowCondenser` | Runs only when the agent has requested condensation. It keeps the essential opening events (system message, first user message, recall observation), about half of the history, and keeps action–observation pairs together (`conversation_window_condenser.py:16-35`, `:176-177`). |
| `recent` | `RecentEventsCondenser` | Keeps the first `keep_first` events and the most recent events up to `max_events` (`recent_events_condenser.py:17-23`). |
| `llm` | `LLMSummarizingCondenser` | When the view is longer than `max_size`, it keeps a head and a tail, replaces the middle with an LLM-written summary, and targets `max_size // 2` (`llm_summarizing_condenser.py:52-70`, `:160-161`). It rejects `keep_first` values of half `max_size` or more (`:32-39`). |
| `llm_attention` | `LLMAttentionCondenser` | Asks the LLM which events matter, and forgets the rest. |
| `structured` | `StructuredSummaryCondenser` | Maintains a structured state summary (`StateSummary`, `structured_summary_condenser.py:25`). |
| `observation_masking` | `ObservationMaskingCondenser` | Replaces observation content outside the last `attention_window` events with a placeholder, keeping the actions. |
| `browser_output_masking` | `BrowserOutputCondenser` | Masks old browser outputs. |
| `amortized` | `AmortizedForgettingCondenser` | Forgets older events in bulk when the view exceeds `max_size` (`amortized_forgetting_condenser.py:16`, `:57`). |
| `noop` | `NoOpCondenser` | Returns the view unchanged (`no_op_condenser.py:11-13`). |
| `pipeline` | `CondenserPipeline` | Runs several condensers in sequence (`pipeline.py:12`). |

`CondenserConfig` (`condenser_config.py`) is a discriminated union on `type`, so each condenser has its own
typed options. `Condenser.from_config` (`condenser.py:148`) builds the instance, and `register_config`
(`condenser.py:130`) adds a new type.

### Which condenser runs

The agent's default condenser is `ConversationWindowCondenserConfig` (`agent_config.py:54-60`). The source
comments give the reason: `NoOp` would let the context overflow with no way to recover, because the
condensation request the agent sends would never be handled.

Two settings connect the agent to the condenser:

- `enable_history_truncation` (default `true`, `agent_config.py:48`). When the model reports a context
  overflow, the controller sends a `CondensationRequestAction` instead of failing
  (`agent_controller.py:904-916`; see [Agent Controller and Step Loop](../architecture/agent-controller.md)).
- `enable_condensation_request`. When on, the CodeAct agent offers a `condensation_request` tool, so the
  model can ask for condensation itself (`codeact_agent.py:132-133`). It is off by default.

The controller treats both `CondensationAction` and `CondensationRequestAction` as events that should
trigger a step (`agent_controller.py:406-416`), so the agent continues with the new view.

## Turning events into messages

`ConversationMemory` (`openhands/memory/conversation_memory.py:55`) converts the view into the message
list the model receives.

- `process_events` (`conversation_memory.py:74`) takes the condensed history, the initial user message,
  the character limit for each message, and whether vision is active. It returns the messages.
- `_process_action` (`:183`) and `_process_observation` (`:344`) map each event type to a message, and
  in function-calling mode they pair each tool call with its result.
- `_ensure_system_message` (`:801`) and `_ensure_initial_user_message` (`:825`) make sure the messages
  always begin with the system prompt and the task. This is needed when the view has lost them.
- `_filter_unmatched_tool_calls` (`:747`) removes tool calls that have no matching result in the view.
- `apply_prompt_caching` (`:683`) marks cacheable prefixes for providers that support prompt caching.

## Memory: repository and microagent knowledge

`Memory` (`openhands/memory/memory.py:41`) subscribes to the event stream with the `MEMORY` key
(`memory.py:64`; see [Event Model and Event Stream](../architecture/event-stream.md)). Its handler
`_on_event` (`memory.py:90`) reacts to `RecallAction` events:

- **Workspace context.** On the first user message, `_on_workspace_context_recall` (`memory.py:139`) adds a
  `RecallObservation` with the repository details, the runtime information, the conversation
  instructions, and the content of any repository microagents. The information is set by
  `set_repository_info`, `set_runtime_info`, and `set_conversation_instructions` (`memory.py:320-357`).
- **Triggered knowledge.** When a later message matches a microagent trigger,
  `_on_microagent_recall` (`memory.py:207`) calls `_find_microagent_knowledge` (`memory.py:225`), which
  matches the message against the triggers of each knowledge microagent, and adds the matching content.

Microagents come from three sources: the shared set in `microagents/` in this repository, the user's
own microagents loaded through `load_user_workspace_microagents` (`memory.py:254`), and the repository's
`.openhands/microagents` directory (`_load_global_microagents`, `memory.py:270`, and
`_load_user_microagents`, `memory.py:280`). See [Agents, Tools, and Microagents](../architecture/agents-and-tools.md)
for the microagent types. A microagent can also declare MCP servers, which `get_microagent_mcp_tools`
(`memory.py:302`) returns.

Recall is a mechanism for adding context to the stream, not a permanent prompt. Each recall becomes an
observation, so it is part of the history and can be condensed like anything else.

## Failure and cost behavior

- A summarizing condenser makes an extra LLM call each time it condenses. It is an ordinary model call, so
  it counts toward the conversation's cost (see [LLM Layer](../architecture/llm-layer.md)).
- Condensation is a lossy operation. Once a summary replaces events, the agent works from the summary, so
  an important detail can be lost if the summary omits it. The structured summary and the initial events
  kept by the conversation window condenser are the protections against this.
- If a condenser raises an error, the controller reports it as an agent error, and the conversation does
  not silently continue with an unbounded context.

## Operational consequences

- The default condenser is cheap (it needs no LLM call), but it forgets more than a summarizer. For long
  coding sessions, the summarizing or structured condensers keep more state.
- `keep_first` and `max_size` trade context length against cost. Raise them for models with large
  windows.
- Large observations are masked by the observation-masking condenser before they are dropped, which keeps
  the agent's actions visible.

## Extension seams

- New strategy: subclass `RollingCondenser` (for threshold-based condensers) or `Condenser`, implement
  `get_condensation` or `condense`, add a config model, and call `register_config`.
- New recall source: add an `on_*_recall` handler to `Memory._on_event` that emits a `RecallObservation`.
- New microagent type: extend `BaseMicroagent` and the classification in `microagent.py`.

## Tests

The condenser and memory code is tested under `tests/unit/memory/` and in the condenser tests in
`tests/unit/`, which cover view construction, the conversation window rules, and microagent recall.

## Related pages

- [Agent Controller and Step Loop](../architecture/agent-controller.md)
- [Agents, Tools, and Microagents](../architecture/agents-and-tools.md)
- [LLM Layer](../architecture/llm-layer.md)
- [Conversation Lifecycle End to End](conversation-lifecycle.md)
