---
title: "CodeAct Agent and Agent Catalogue"
---
## Overview

An agent is a class with one required method, `step(state) -> Action`. The [[Agent Controller Loop]] calls it each time the agent should act. `CodeActAgent` is the default and the base of two others: on each step it condenses the history, converts it to LLM messages, asks the model for tool calls, and turns those calls into actions that the controller publishes. This page follows that step and then lists the other agents.

Sources: [openhands/controller/agent.py:25-110](repo://openhands/controller/agent.py#L25-L110), [openhands/agenthub/codeact_agent/codeact_agent.py:160-224](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L160-L224)

## The agent base class and registry

`Agent` keeps a class-level `_registry`. `Agent.register(name, cls)` raises `AgentAlreadyRegisteredError` on a duplicate name, `get_cls` raises `AgentNotRegisteredError` for an unknown one, and `list_agents` returns the names. Each agent package registers itself in its `__init__.py`, and `openhands/agenthub/__init__.py` imports all six packages, which is why `import openhands.agenthub` is enough to make them selectable by the `default_agent` setting.

Sources: [openhands/controller/agent.py:121-161](repo://openhands/controller/agent.py#L121-L161), [openhands/agenthub/__init__.py:1-22](repo://openhands/agenthub/__init__.py#L1-L22), [openhands/agenthub/codeact_agent/__init__.py:1-4](repo://openhands/agenthub/codeact_agent/__init__.py#L1-L4)

The base constructor takes the agent's LLM from the registry (see [[LLM Layer]]). `get_system_message` builds a `SystemMessageAction` from the prompt manager's system prompt and the agent's `tools`, with the agent class name attached; on any failure it logs a warning and returns `None`, which is what the controller's `_add_system_message` checks.

Sources: [openhands/controller/agent.py:40-92](repo://openhands/controller/agent.py#L40-L92)

## Building a CodeAct step

`CodeActAgent.__init__` creates its tools, a `ConversationMemory` and a condenser from `config.condenser`, then replaces `self.llm` with the router from the registry. `sandbox_plugins` lists `AgentSkillsRequirement` before `JupyterRequirement`, because the Jupyter plugin uses the Python functions the first one provides.

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:70-96](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L70-L96)

`step` then works as follows.

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:160-224](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L160-L224)

1. If `pending_actions` is not empty, pop and return the next one. A single model response can carry several tool calls, and each goes out as its own step.
2. If the latest user message is `/exit`, return `AgentFinishAction`.
3. Call `condenser.condensed_history(state)`. A `View` gives the events to use; a `Condensation` is returned as the step's action, and the controller steps again at once ([[Condensers]]).
4. Convert the events to messages with `ConversationMemory.process_events`, passing the first user message, the model's `max_message_chars` and whether vision is active, and apply prompt caching if the LLM has it on ([[Conversation Memory and Microagents]]).
5. Call `llm.completion(messages=..., tools=check_tools(self.tools, self.llm.config), extra_body=...)`, where the extra body is the state's LLM metadata.
6. Convert the response with `response_to_actions`, queue all the actions and return the first.

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:182-224](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L182-L224), [openhands/agenthub/codeact_agent/codeact_agent.py:279-293](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L279-L293)

`reset` clears only the pending actions, not the LLM metrics, and is called by the controller on `STOPPED` and `ERROR`.

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:154-158](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L154-L158)

## Tools

`_get_tools` assembles the tool list from `AgentConfig` flags.

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:108-152](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L108-L152)

| Flag | Tool |
| --- | --- |
| `enable_cmd` | bash command runner |
| `enable_think` | `ThinkTool` |
| `enable_finish` | `FinishTool` |
| `enable_condensation_request` | `CondensationRequestTool` |
| `enable_browsing` | `BrowserTool`, skipped with a warning on Windows |
| `enable_jupyter` | `IPythonTool` |
| `enable_plan_mode` | task tracker tool |
| `enable_llm_editor` | `LLMBasedFileEditTool` |
| `enable_editor` | `str_replace_editor`, used when the LLM editor is off |

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:108-152](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L108-L152)

For models whose name contains `gpt-4`, `o3`, `o1` or `o4`, the bash, task tracker and editor tools get short descriptions to stay under the OpenAI tool-description limit. The system prompt comes from `prompts/` and the file named by `config.resolved_system_prompt_filename`.

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:98-124](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L98-L124)

## Tool calls to actions

`function_calling.response_to_actions` accepts exactly one choice. When the message has tool calls, any text content becomes the `thought`, attached to the first action only. Each call's JSON arguments are parsed (invalid JSON raises `FunctionCallValidationError`) and dispatched on the function name.

Sources: [openhands/agenthub/codeact_agent/function_calling.py:73-100](repo://openhands/agenthub/codeact_agent/function_calling.py#L73-L100)

| Tool | Action produced |
| --- | --- |
| bash | `CmdRunAction`, with `is_input` and an optional hard timeout |
| IPython | `IPythonRunCellAction` |
| LLM-based edit | `FileEditAction` with `start`, `end` and `impl_source` |
| `str_replace_editor` | `FileReadAction` for `view`, otherwise `FileEditAction` with `OH_ACI` as the source |
| think | `AgentThinkAction` |
| finish | `AgentFinishAction` |
| condensation request | `CondensationRequestAction` |
| browser | `BrowseInteractiveAction` |
| task tracker | `TaskTrackingAction` |
| `delegate_to_browsing_agent` | `AgentDelegateAction` |
| any name in the MCP tool list | `MCPAction` |

Sources: [openhands/agenthub/codeact_agent/function_calling.py:73-135](repo://openhands/agenthub/codeact_agent/function_calling.py#L73-L135), [openhands/agenthub/codeact_agent/function_calling.py:138-255](repo://openhands/agenthub/codeact_agent/function_calling.py#L138-L255), [openhands/agenthub/codeact_agent/function_calling.py:301-306](repo://openhands/agenthub/codeact_agent/function_calling.py#L301-L306)

Missing required arguments raise `FunctionCallValidationError`, and an unexpected argument to the editor does too; an unknown tool name raises `FunctionCallNotExistsError`. The controller turns these into an `ErrorObservation` for the model. Commands and edits also copy the model's `security_risk` argument onto the action when it is one of `RISK_LEVELS`, which is what the [[MCP Tools and Security Analyzers]] flow reads.

Sources: [openhands/agenthub/codeact_agent/function_calling.py:59-70](repo://openhands/agenthub/codeact_agent/function_calling.py#L59-L70), [openhands/agenthub/codeact_agent/function_calling.py:172-231](repo://openhands/agenthub/codeact_agent/function_calling.py#L172-L231), [openhands/agenthub/codeact_agent/function_calling.py:301-310](repo://openhands/agenthub/codeact_agent/function_calling.py#L301-L310)

Every action gets `ToolCallMetadata` (call id, function name, the whole model response, number of calls in the response) so that observations can be matched back to the call when messages are rebuilt, and the response id. A response with no tool calls becomes a `MessageAction` with `wait_for_response=True`, which parks the agent in `AWAITING_USER_INPUT`.

Sources: [openhands/agenthub/codeact_agent/function_calling.py:311-338](repo://openhands/agenthub/codeact_agent/function_calling.py#L311-L338)

## The other agents

All are registered by name and chosen with the `default_agent` setting or, for delegation, by an `AgentDelegateAction`.

Sources: [openhands/core/setup.py:202-207](repo://openhands/core/setup.py#L202-L207), [openhands/controller/agent_controller.py:709-714](repo://openhands/controller/agent_controller.py#L709-L714)

| Agent | Based on | Use it for |
| --- | --- | --- |
| `CodeActAgent` | `Agent` | General software work: bash, IPython, file editing, browsing, MCP, delegation. The default |
| `ReadOnlyAgent` | `CodeActAgent` | Exploring a codebase without changing it: tools are only think, finish, grep, glob and view, with its own prompts |
| `LocAgent` | `CodeActAgent` | Code localisation: tools are finish plus repo search, entity search and tree exploration |
| `BrowsingAgent` | `Agent` | Web interaction with its own prompt and response parser, no sandbox plugins |
| `VisualBrowsingAgent` | `Agent` | Browsing with webpage screenshots; its README says it was evaluated on VisualWebArena |
| `DummyAgent` | `Agent` | End-to-end tests: sends a fixed sequence of actions with no LLM calls |

Sources: [openhands/agenthub/readonly_agent/readonly_agent.py:23-70](repo://openhands/agenthub/readonly_agent/readonly_agent.py#L23-L70), [openhands/agenthub/readonly_agent/function_calling.py:241-248](repo://openhands/agenthub/readonly_agent/function_calling.py#L241-L248), [openhands/agenthub/loc_agent/loc_agent.py:14-40](repo://openhands/agenthub/loc_agent/loc_agent.py#L14-L40), [openhands/agenthub/loc_agent/function_calling.py:120-125](repo://openhands/agenthub/loc_agent/function_calling.py#L120-L125), [openhands/agenthub/browsing_agent/browsing_agent.py:94-112](repo://openhands/agenthub/browsing_agent/browsing_agent.py#L94-L112), [openhands/agenthub/visualbrowsing_agent/visualbrowsing_agent.py:121-128](repo://openhands/agenthub/visualbrowsing_agent/visualbrowsing_agent.py#L121-L128), [openhands/agenthub/visualbrowsing_agent/README.md:1-6](repo://openhands/agenthub/visualbrowsing_agent/README.md#L1-L6), [openhands/agenthub/dummy_agent/agent.py:38-43](repo://openhands/agenthub/dummy_agent/agent.py#L38-L43)

`ReadOnlyAgent` and `LocAgent` inherit the whole `step` of CodeAct and only swap the tool list and the response parser, so the controller sees them exactly like the default agent. The `ReadOnlyAgent` docstring advises switching back to `CodeActAgent` when you are ready to make changes.

Sources: [openhands/agenthub/readonly_agent/readonly_agent.py:23-70](repo://openhands/agenthub/readonly_agent/readonly_agent.py#L23-L70), [openhands/agenthub/loc_agent/loc_agent.py:14-40](repo://openhands/agenthub/loc_agent/loc_agent.py#L14-L40)
