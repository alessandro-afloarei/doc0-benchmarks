---
title: "Agents and Tools"
---
## Overview

An `Agent` implements `step(state) -> Action`: it chooses the next action from the current conversation state. CodeAct is the general software-work agent in this checkout. It combines conversation processing, a configurable tool list, a condenser, and an LLM or router. The scheduling and pending-action rules around `step` belong to [[Controller and Event Stream]]; this page follows the model-facing translation inside the agent.

Sources: [openhands/controller/agent.py:40-51](repo://openhands/controller/agent.py#L40-L51), [openhands/controller/agent.py:104-109](repo://openhands/controller/agent.py#L104-L109), [openhands/agenthub/codeact_agent/codeact_agent.py:78-106](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L78-L106)

## Registration and construction

Agent implementations register under names in the base class registry. Registering a duplicate raises `AgentAlreadyRegisteredError`; looking up a missing name raises `AgentNotRegisteredError`. Importing `openhands.agenthub` imports the built-in agent packages, and the CodeAct package registers `CodeActAgent`. Configuration selects an agent name or supplies a custom classpath, as described in [[Configuration]]. Runtime construction uses the selected agent class's plugin requirements, so the agent choice also affects which sandbox capabilities are initialized.

Sources: [openhands/controller/agent.py:120-161](repo://openhands/controller/agent.py#L120-L161), [openhands/agenthub/__init__.py:6-24](repo://openhands/agenthub/__init__.py#L6-L24), [openhands/agenthub/codeact_agent/__init__.py:1-4](repo://openhands/agenthub/codeact_agent/__init__.py#L1-L4), [openhands/core/config/agent_config.py:18-21](repo://openhands/core/config/agent_config.py#L18-L21), [openhands/core/setup.py:65-82](repo://openhands/core/setup.py#L65-L82)

CodeAct requests AgentSkills before Jupyter. The source states that AgentSkills supplies Python functions Jupyter needs, which explains the ordering. Construction initializes a deque of pending actions, builds tools, creates `ConversationMemory`, constructs the configured condenser, and replaces the initially selected LLM with the registry's router selection. Its prompt manager is lazy and uses the resolved system-prompt filename from agent configuration.

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:70-106](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L70-L106)

## Tool catalogue

| Capability | Construction rule | Parsed action |
| --- | --- | --- |
| Shell | `enable_cmd` | `CmdRunAction` |
| Reasoning log | `enable_think` | `AgentThinkAction` |
| Completion | `enable_finish` | `AgentFinishAction` |
| History condensation | `enable_condensation_request` | `CondensationRequestAction` |
| Browser | `enable_browsing`, except on Windows | `BrowseInteractiveAction` |
| Python | `enable_jupyter` | `IPythonRunCellAction` |
| Task tracking | `enable_plan_mode` | `TaskTrackingAction` |
| File editing | LLM editor when enabled; otherwise standard editor if enabled | `FileEditAction`, or `FileReadAction` for standard-editor `view` |

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:125-152](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L125-L152), [openhands/agenthub/codeact_agent/function_calling.py:105-150](repo://openhands/agenthub/codeact_agent/function_calling.py#L105-L150), [openhands/agenthub/codeact_agent/function_calling.py:155-196](repo://openhands/agenthub/codeact_agent/function_calling.py#L155-L196), [openhands/agenthub/codeact_agent/function_calling.py:222-290](repo://openhands/agenthub/codeact_agent/function_calling.py#L222-L290)

Tool descriptions can use a shorter form based on model-name matching, retained for compatibility with older models. MCP tools are appended through `set_mcp_tools`, which indexes them by function name and skips duplicate MCP names. `get_system_message` captures the current tools and agent class in a `SystemMessageAction`; this is why session initialization discovers external tools before constructing the controller. [[MCP Tools]] describes that discovery path and the runtime transport used for calls.

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:108-123](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L108-L123), [openhands/controller/agent.py:59-93](repo://openhands/controller/agent.py#L59-L93), [openhands/controller/agent.py:163-183](repo://openhands/controller/agent.py#L163-L183), [openhands/server/session/agent_session.py:165-168](repo://openhands/server/session/agent_session.py#L165-L168)

## Build the next completion

CodeAct first drains an already queued action. If there is none and the latest user message is `/exit`, it returns `AgentFinishAction`. Otherwise it asks the condenser for a history result: a `View` supplies events for message construction, while a `Condensation` returns an action immediately so the controller can record it and step again. [[Memory and Microagents]] owns the content and retention rules behind those results.

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:182-201](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L182-L201)

The agent finds the initial user message in the full state history even when the working history is condensed. Missing that initial message raises `ValueError`. It passes the condensed events and initial message to `ConversationMemory.process_events`, including maximum message characters and vision capability. Prompt caching is applied when the LLM enables it. The completion request then carries messages, checked tools, and metadata derived from state, model name, and agent name; [[Language Models]] follows the provider boundary.

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:207-244](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L207-L244), [openhands/agenthub/codeact_agent/codeact_agent.py:279-293](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L279-L293)

## Decode actions and preserve tool identity

`response_to_actions` expects exactly one model choice. It collects assistant text as a thought and parses each function call's arguments as JSON. Invalid JSON or missing required fields raises `FunctionCallValidationError`. Shell calls require `command`, Python and browser calls require `code`, and shell timeout conversion validates a numeric value. Security-risk values are assigned only when recognized and when the action supports that field.

Sources: [openhands/agenthub/codeact_agent/function_calling.py:59-133](repo://openhands/agenthub/codeact_agent/function_calling.py#L59-L133), [openhands/agenthub/codeact_agent/function_calling.py:245-251](repo://openhands/agenthub/codeact_agent/function_calling.py#L245-L251)

The standard editor maps `view` to a file-read action with the ACI implementation source. Other editor commands become ACI file-edit actions after filtering allowed arguments; unexpected arguments fail validation. Task tracking requires a command, requires `task_list` for `plan`, and normalizes task dictionaries. A name registered in the agent's MCP tool list becomes `MCPAction`; unknown tools raise `FunctionCallNotExistsError` rather than being executed as arbitrary function names.

Sources: [openhands/agenthub/codeact_agent/function_calling.py:173-229](repo://openhands/agenthub/codeact_agent/function_calling.py#L173-L229), [openhands/agenthub/codeact_agent/function_calling.py:256-309](repo://openhands/agenthub/codeact_agent/function_calling.py#L256-L309)

Only the first action receives the assistant thought. Every tool action records call ID, function name, original model response, and total calls in that response. All actions also receive the response ID for usage correlation. A response without tools becomes a `MessageAction` that waits for user input. CodeAct enqueues the decoded actions and returns them individually, preserving response ordering across controller steps; resetting clears this queue without clearing accumulated LLM metrics.

Sources: [openhands/agenthub/codeact_agent/function_calling.py:311-338](repo://openhands/agenthub/codeact_agent/function_calling.py#L311-L338), [openhands/agenthub/codeact_agent/codeact_agent.py:154-158](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L154-L158), [openhands/agenthub/codeact_agent/codeact_agent.py:218-224](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L218-L224)

## Specialized agents

`ReadOnlyAgent` derives from CodeAct but installs its own read-only tools and parser; it explicitly ignores MCP tools. Its documented purpose is code exploration and research without modifications. `LocAgent` also derives from CodeAct and substitutes its localization tool set and response parser. `DummyAgent` emits deterministic actions without model calls for end-to-end testing. Browsing and visual-browsing implementations build browser-oriented prompts; the visual implementation includes screenshot context when available.

Sources: [openhands/agenthub/readonly_agent/readonly_agent.py:23-83](repo://openhands/agenthub/readonly_agent/readonly_agent.py#L23-L83), [openhands/agenthub/loc_agent/loc_agent.py:14-40](repo://openhands/agenthub/loc_agent/loc_agent.py#L14-L40), [openhands/agenthub/dummy_agent/agent.py:38-64](repo://openhands/agenthub/dummy_agent/agent.py#L38-L64), [openhands/agenthub/browsing_agent/browsing_agent.py:43-55](repo://openhands/agenthub/browsing_agent/browsing_agent.py#L43-L55), [openhands/agenthub/visualbrowsing_agent/visualbrowsing_agent.py:51-71](repo://openhands/agenthub/visualbrowsing_agent/visualbrowsing_agent.py#L51-L71)
