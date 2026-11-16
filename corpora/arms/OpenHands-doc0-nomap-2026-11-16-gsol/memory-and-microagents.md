---
title: "Memory and Microagents"
---
## Overview

OpenHands prepares model context through three cooperating mechanisms. `Memory` retrieves repository and keyword knowledge, `ConversationMemory` converts events into model messages, and a `Condenser` controls the history view those messages use. These mechanisms operate on the event-driven task described in [[Agent Control Loop]]. Persisted events remain the underlying record described in [[Events and Persistence]], while the model can receive a smaller or reformatted view.

Sources: [openhands/memory/memory.py:90-131](repo://openhands/memory/memory.py#L90-L131), [openhands/memory/conversation_memory.py:89-164](repo://openhands/memory/conversation_memory.py#L89-L164), [openhands/memory/condenser/condenser.py:44-51](repo://openhands/memory/condenser/condenser.py#L44-L51)

## Recall workspace context and knowledge

Memory subscribes to the stream and handles `RecallAction`. Workspace-context recall is accepted from the user source; knowledge recall is accepted from either user or agent sources. Each successful recall path publishes a recall observation, or a null observation when nothing matched, with its cause set to the recall action's ID. That response releases the controller's pending retrieval. Exceptions set the memory runtime error status instead of producing the normal recall result.

Sources: [openhands/memory/memory.py:64-68](repo://openhands/memory/memory.py#L64-L68), [openhands/memory/memory.py:90-137](repo://openhands/memory/memory.py#L90-L137)

Workspace context combines all active repository microagent contents with repository name, branch and directory, runtime hosts, additional instructions, date, working directory, secret descriptions and conversation instructions when available. It also includes knowledge matching the initial query. Later knowledge recall contains matched microagent name, trigger and content. Matching skips empty queries and asks each knowledge microagent for the first matching trigger.

Sources: [openhands/memory/memory.py:153-252](repo://openhands/memory/memory.py#L153-L252)

## Load and classify microagents

Memory loads global microagents first and user microagents from `~/.openhands/microagents` afterward. Workspace loading assigns supplied microagents by name into the repository or knowledge dictionaries, so later assignments with an existing name replace that dictionary entry. The runtime loads workspace instructions from `.openhands/microagents`, or the selected repository's equivalent directory, and can also load organization or user repository microagents. [[Runtime and Workspace]] explains when this workspace becomes available.

Sources: [openhands/memory/memory.py:79-84](repo://openhands/memory/memory.py#L79-L84), [openhands/memory/memory.py:254-300](repo://openhands/memory/memory.py#L254-L300), [openhands/runtime/base.py:823-850](repo://openhands/runtime/base.py#L823-L850), [openhands/runtime/base.py:882-888](repo://openhands/runtime/base.py#L882-L888)

`BaseMicroagent.load` reads Markdown and front matter, derives names from paths when a microagent directory is supplied and validates metadata. It recognizes legacy `.openhands_instructions` and third-party instruction files including `.cursorrules`, `AGENTS.md` and `AGENT.md` through case-insensitive filename mapping. Type inference selects a task microagent when inputs exist, knowledge when triggers exist and repository knowledge otherwise. Knowledge triggers match case-insensitive substrings.

Sources: [openhands/microagent/microagent.py:26-49](repo://openhands/microagent/microagent.py#L26-L49), [openhands/microagent/microagent.py:62-105](repo://openhands/microagent/microagent.py#L62-L105), [openhands/microagent/microagent.py:129-174](repo://openhands/microagent/microagent.py#L129-L174), [openhands/microagent/microagent.py:181-199](repo://openhands/microagent/microagent.py#L181-L199)

Repository microagents can supply MCP configurations that are always considered by memory's tool-configuration collector. The loader currently requires stdio servers for a microagent MCP declaration and warns about SSE declarations. [[MCP Tools and Integrations]] explains discovery and execution after those configurations have been collected.

Sources: [openhands/memory/memory.py:302-318](repo://openhands/memory/memory.py#L302-L318), [openhands/microagent/microagent.py:107-127](repo://openhands/microagent/microagent.py#L107-L127)

## Construct model messages

`ConversationMemory.process_events` ensures the system message and initial user message exist, converts each action or observation, then filters unmatched tool calls and formats user messages. It tracks pending assistant tool-call messages and corresponding results. An assistant message with several tool calls is added with its results when all those results are available, preserving a coherent tool exchange for the model.

Sources: [openhands/memory/conversation_memory.py:89-164](repo://openhands/memory/conversation_memory.py#L89-L164)

CodeAct passes the condensed events, initial user action, maximum message size and active vision capability into this conversion. When prompt caching is enabled for the model, it then applies message caching markers. The resulting messages go to [[Model Calls and Routing]], which owns provider formatting and transport rather than repository retrieval or event-to-message conversion.

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:282-293](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L282-L293)

## Condensation contract

A condenser receives `state.view` and returns either a `View` or a `Condensation` containing an action. CodeAct immediately returns that action instead of calling the model; a subsequent step rebuilds the view with the condensation event applied. The base class records diagnostic metadata in `state.extra_data`, and its configuration registry rejects duplicate registrations and unknown configuration types.

Sources: [openhands/memory/condenser/condenser.py:44-51](repo://openhands/memory/condenser/condenser.py#L44-L51), [openhands/memory/condenser/condenser.py:70-115](repo://openhands/memory/condenser/condenser.py#L70-L115), [openhands/memory/condenser/condenser.py:129-166](repo://openhands/memory/condenser/condenser.py#L129-L166), [openhands/agenthub/codeact_agent/codeact_agent.py:191-201](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L191-L201)

The conversation-window strategy preserves essential initial context and roughly half of the remaining recent events, adjusting the retained slice around action and observation relationships. Its configuration explicitly says it is not supported through TOML or environment strategies. [[Configuration]] describes the agent's default condenser and history-truncation setting; this strategy supplies the recovery behavior for condensation requests.

Sources: [openhands/memory/condenser/impl/conversation_window_condenser.py:20-27](repo://openhands/memory/condenser/impl/conversation_window_condenser.py#L20-L27), [openhands/memory/condenser/impl/conversation_window_condenser.py:92-133](repo://openhands/memory/condenser/impl/conversation_window_condenser.py#L92-L133), [openhands/core/config/condenser_config.py:170-178](repo://openhands/core/config/condenser_config.py#L170-L178), [openhands/core/config/agent_config.py:48-60](repo://openhands/core/config/agent_config.py#L48-L60)

## Condenser catalogue

| Strategy | Context policy and configurable scope |
| --- | --- |
| `noop` | Returns the history view unchanged |
| `recent` | Keeps an initial prefix plus recent events up to its event count |
| `observation_masking` | Replaces observation content outside an attention window |
| `browser_output_masking` | Masks older browser output while keeping a recent browser window |
| `amortized` | Forgets old events in batches when condensed history grows too large |
| `llm` | Summarizes forgotten events and previous summaries using an LLM |
| `llm_attention` | Uses an LLM attention strategy with size and initial-prefix controls |
| `structured` | Produces structured summaries through function calling |
| `pipeline` | Applies a configured sequence of condensers |
| `conversation_window` | Retains essential initial events and a recent history window |

Sources: [openhands/memory/condenser/impl/no_op_condenser.py:8-19](repo://openhands/memory/condenser/impl/no_op_condenser.py#L8-L19), [openhands/memory/condenser/impl/recent_events_condenser.py:8-24](repo://openhands/memory/condenser/impl/recent_events_condenser.py#L8-L24), [openhands/memory/condenser/impl/observation_masking_condenser.py:8-29](repo://openhands/memory/condenser/impl/observation_masking_condenser.py#L8-L29), [openhands/memory/condenser/impl/browser_output_condenser.py:12-49](repo://openhands/memory/condenser/impl/browser_output_condenser.py#L12-L49), [openhands/memory/condenser/impl/amortized_forgetting_condenser.py:10-50](repo://openhands/memory/condenser/impl/amortized_forgetting_condenser.py#L10-L50), [openhands/memory/condenser/impl/llm_summarizing_condenser.py:17-23](repo://openhands/memory/condenser/impl/llm_summarizing_condenser.py#L17-L23), [openhands/core/config/condenser_config.py:108-128](repo://openhands/core/config/condenser_config.py#L108-L128), [openhands/memory/condenser/impl/structured_summary_condenser.py:162-166](repo://openhands/memory/condenser/impl/structured_summary_condenser.py#L162-L166), [openhands/memory/condenser/impl/pipeline.py:8-42](repo://openhands/memory/condenser/impl/pipeline.py#L8-L42), [openhands/memory/condenser/impl/conversation_window_condenser.py:20-27](repo://openhands/memory/condenser/impl/conversation_window_condenser.py#L20-L27)
