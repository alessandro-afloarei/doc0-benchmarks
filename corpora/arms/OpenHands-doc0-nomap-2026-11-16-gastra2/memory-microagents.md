---
title: "Memory and Microagents"
---
## Overview

OpenHands prepares model context through three cooperating mechanisms. `Memory` answers recall actions with workspace information and microagent knowledge. A condenser selects or transforms the history view. `ConversationMemory` converts that view into model messages with paired tool calls and results. The controller's recall scheduling is documented in [[Agent Execution]], and the final provider request belongs to [[Configuration and Language Models]].

Sources: [openhands/memory/memory.py:90-131](repo://openhands/memory/memory.py#L90-L131), [openhands/memory/condenser/condenser.py:104-115](repo://openhands/memory/condenser/condenser.py#L104-L115), [openhands/memory/conversation_memory.py:74-164](repo://openhands/memory/conversation_memory.py#L74-L164)

## Loading instruction sources

Memory subscribes to the conversation stream, initializes repository and knowledge microagent mappings, and loads global microagents before user-home microagents. Workspace microagents are loaded afterward through `load_user_workspace_microagents`. Each mapping is keyed by name and later assignments replace the earlier value under that name. The two categories remain separate: always-available repository content and trigger-based knowledge.

Sources: [openhands/memory/memory.py:53-84](repo://openhands/memory/memory.py#L53-L84), [openhands/memory/memory.py:254-300](repo://openhands/memory/memory.py#L254-L300)

The runtime searches `.openhands/microagents` within the workspace or selected repository. For a selected repository it first loads organization or user-level microagents, then repository-specific ones. It also supports the legacy `.openhands_instructions` file, checking the workspace and then repository root. [[Sandbox Runtimes]] explains how the repository arrives in that workspace before this loading occurs.

Sources: [openhands/runtime/base.py:823-888](repo://openhands/runtime/base.py#L823-L888)

`BaseMicroagent.load` parses Markdown front matter, validates metadata, and derives a name from the path when a microagent directory is supplied. It recognizes `.cursorrules`, `agents.md`, and `agent.md` case-insensitively as repository instructions. The legacy instruction filename has its own direct conversion path. Numeric version metadata is converted to a string before validation.

Sources: [openhands/microagent/microagent.py:26-105](repo://openhands/microagent/microagent.py#L26-L105)

## Microagent kinds and matching

| Kind | How loading selects it | How it contributes |
| --- | --- | --- |
| Repository | No inputs or triggers | Content is concatenated into workspace instructions |
| Knowledge | Triggers present and no inputs | Matching query text returns its knowledge |
| Task | Inputs present | Extends knowledge behavior and adds a slash-name trigger |

Sources: [openhands/microagent/microagent.py:129-171](repo://openhands/microagent/microagent.py#L129-L171), [openhands/microagent/microagent.py:189-203](repo://openhands/microagent/microagent.py#L189-L203), [openhands/microagent/microagent.py:226-241](repo://openhands/microagent/microagent.py#L226-L241), [openhands/memory/memory.py:153-163](repo://openhands/memory/memory.py#L153-L163)

Knowledge matching is a case-insensitive substring search. `match_trigger` returns the first matching trigger for one microagent; Memory checks all knowledge microagents and includes each matching agent's name, trigger, and content. An empty query produces no matches. This is deterministic text matching, not an embedding search or a model choosing relevant documents.

Sources: [openhands/microagent/microagent.py:189-203](repo://openhands/microagent/microagent.py#L189-L203), [openhands/memory/memory.py:225-252](repo://openhands/memory/memory.py#L225-L252)

Metadata can also include MCP configuration. The loader warns about SSE entries and rejects a microagent MCP configuration with no stdio servers. Memory collects MCP configurations only from repository microagents, which are always active. [[MCP Tools]] covers how these configurations become callable tools; a keyword match alone does not install another server through this collection method.

Sources: [openhands/microagent/microagent.py:104-127](repo://openhands/microagent/microagent.py#L104-L127), [openhands/memory/memory.py:302-318](repo://openhands/memory/memory.py#L302-L318)

## Recall observations

Workspace recall concatenates every repository microagent's content and adds repository identity, directory and branch, runtime hosts, additional instructions, date, secret descriptions, conversation instructions, and working directory where available. It can include query-matched knowledge in the same observation. If none of the relevant context exists, the helper returns no observation content.

Sources: [openhands/memory/memory.py:139-205](repo://openhands/memory/memory.py#L139-L205)

The event handler turns that empty result into `NullObservation`, assigns the recall action's ID as the cause, and publishes the result as an environment event. Knowledge recall follows the same correlation pattern. This response is necessary even when no knowledge matches because it releases the controller's pending recall. Exceptions report `ERROR_MEMORY` through runtime-status handling instead of producing normal recalled context.

Sources: [openhands/memory/memory.py:90-136](repo://openhands/memory/memory.py#L90-L136)

## History views and condensation

`Condenser.condensed_history` operates on `state.view` and records per-condensation metadata in `state.extra_data`. A condenser returns either a `View` for immediate model use or a `Condensation` wrapping an action. With the second result, CodeAct returns that action instead of requesting another completion; subsequent steps can build the new view from the updated history. This keeps context changes visible as events while [[Events and Persistence]] retains the underlying stored history.

Sources: [openhands/memory/condenser/condenser.py:38-51](repo://openhands/memory/condenser/condenser.py#L38-L51), [openhands/memory/condenser/condenser.py:70-115](repo://openhands/memory/condenser/condenser.py#L70-L115), [openhands/agenthub/codeact_agent/codeact_agent.py:191-201](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L191-L201), [openhands/controller/state/state.py:191-199](repo://openhands/controller/state/state.py#L191-L199)

The configuration family exposes several strategies. The table names their intended behavior and principal controls; an extension registers its configuration class and implements `condense`, while duplicate registration and unknown configuration types raise errors.

Sources: [openhands/core/config/condenser_config.py:181-193](repo://openhands/core/config/condenser_config.py#L181-L193), [openhands/memory/condenser/condenser.py:91-102](repo://openhands/memory/condenser/condenser.py#L91-L102), [openhands/memory/condenser/condenser.py:129-166](repo://openhands/memory/condenser/condenser.py#L129-L166)

| Strategy | Purpose or controls |
| --- | --- |
| `noop` | Returns the view unchanged |
| `recent` | Keeps an initial prefix and recent tail |
| `observation_masking` | Masks observations outside an attention window |
| `browser_output_masking` | Masks older browser observations, whose screenshots and trees can be large |
| `amortized` | Forgets old events when the rolling view grows too large |
| `llm` | Replaces forgotten events with a model-generated summary |
| `structured` | Generates structured summaries through function calling |
| `pipeline` | Chains condensers until the end or a condensation action |
| `conversation_window` | Preserves essential initial events and action/result pairs while truncating history |

Sources: [openhands/memory/condenser/impl/no_op_condenser.py:8-19](repo://openhands/memory/condenser/impl/no_op_condenser.py#L8-L19), [openhands/memory/condenser/impl/recent_events_condenser.py:8-22](repo://openhands/memory/condenser/impl/recent_events_condenser.py#L8-L22), [openhands/memory/condenser/impl/observation_masking_condenser.py:11-26](repo://openhands/memory/condenser/impl/observation_masking_condenser.py#L11-L26), [openhands/memory/condenser/impl/browser_output_condenser.py:11-27](repo://openhands/memory/condenser/impl/browser_output_condenser.py#L11-L27), [openhands/memory/condenser/impl/amortized_forgetting_condenser.py:13-28](repo://openhands/memory/condenser/impl/amortized_forgetting_condenser.py#L13-L28), [openhands/memory/condenser/impl/llm_summarizing_condenser.py:17-30](repo://openhands/memory/condenser/impl/llm_summarizing_condenser.py#L17-L30), [openhands/memory/condenser/impl/structured_summary_condenser.py:162-177](repo://openhands/memory/condenser/impl/structured_summary_condenser.py#L162-L177), [openhands/memory/condenser/impl/pipeline.py:12-20](repo://openhands/memory/condenser/impl/pipeline.py#L12-L20), [openhands/memory/condenser/impl/conversation_window_condenser.py:16-28](repo://openhands/memory/condenser/impl/conversation_window_condenser.py#L16-L28)

## Message construction and repeated knowledge

`ConversationMemory.process_events` ensures a system event and initial user event, then processes actions and observations into messages. It buffers tool-call messages until all associated results are available, emits the initiating message before those results, and finally filters unmatched tool calls and responses. This avoids sending a partially paired tool conversation after history selection has removed events.

Sources: [openhands/memory/conversation_memory.py:92-164](repo://openhands/memory/conversation_memory.py#L92-L164)

Knowledge observations are filtered against earlier recall observations in the supplied event list. A microagent already present in an earlier workspace or knowledge recall is excluded from later knowledge content. The check is based on agent name within the current view, so condensation changes which earlier appearances are available to this filtering pass. Workspace-context observations themselves retain their knowledge list in this helper.

Sources: [openhands/memory/conversation_memory.py:698-744](repo://openhands/memory/conversation_memory.py#L698-L744)
