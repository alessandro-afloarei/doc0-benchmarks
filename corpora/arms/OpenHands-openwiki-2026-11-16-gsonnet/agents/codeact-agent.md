---
type: component
title: Agent Hub and CodeActAgent
description: The Agent abstraction and registry, how CodeActAgent turns state into an LLM call and then into Actions via function calling, which tools it exposes, and how the other agenthub agents derive from it.
tags: [agent, codeact, function-calling, tools, agenthub]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:38:52.407Z
sources:
  - id: openwiki-source-f161159e8a959406ae10a085
    resource: repo://openhands/agenthub/codeact_agent/codeact_agent.py
  - id: openwiki-source-2e7cf1ee6ccb20d38552bf97
    resource: repo://openhands/agenthub/codeact_agent/function_calling.py
  - id: openwiki-source-9aa92162f9c4192e2327f408
    resource: repo://openhands/agenthub/loc_agent/loc_agent.py
  - id: openwiki-source-b4b0153623d3fee4bd3c8711
    resource: repo://openhands/agenthub/readonly_agent/readonly_agent.py
  - id: openwiki-source-44f2545083aa1045beab5794
    resource: repo://openhands/controller/agent.py
  - id: openwiki-source-4ae545fc5168dd6cca0bd13a
    resource: repo://openhands/core/config/agent_config.py
generated: { by: "claude-code", at: "2026-11-16T09:38:52.407Z" }
---

# Agent Hub and CodeActAgent

`openhands/agenthub/` holds the concrete agent implementations. An agent is a pure "decision" component: given the current `State`, `Agent.step()` returns exactly one `Action`. Everything else (running the action, storing events, enforcing limits) belongs to the [AgentController](../architecture/agent-controller.md), the [event stream](../architecture/event-stream.md) and the [runtime](../runtime/runtime-and-sandbox.md).

## The `Agent` base class

`openhands/controller/agent.py` defines the abstract `Agent`:

- A class-level registry (`Agent._registry`) maps names to classes. `Agent.register(name, cls)` raises `AgentAlreadyRegisteredError` on duplicates, `Agent.get_cls(name)` looks one up, and `Agent.list_agents()` enumerates them. Each agent package registers itself in its `__init__.py` (for example `Agent.register('CodeActAgent', CodeActAgent)`), and `openhands/agenthub/__init__.py` imports all of the packages so registration happens on import.
- The constructor obtains its LLM from the `LLMRegistry` (`get_llm_from_agent_config('agent', config)`), see [LLM layer](../llm/llm-layer.md).
- `sandbox_plugins` is a class attribute listing plugin requirements the runtime must load for this agent.
- `get_system_message()` renders the system prompt through the `PromptManager` and wraps it, together with the tool list, in a `SystemMessageAction` that the controller adds to the event stream as the first event.
- `set_mcp_tools()` appends [MCP](../integrations/mcp.md) tool definitions to `self.tools` and records their names in `self.mcp_tools`, skipping names that already exist.
- Custom agents can be configured by class path; `config_model` lets a subclass declare its own `AgentConfig` subclass.

## Registered agents

| Agent | Base | Purpose |
|---|---|---|
| `CodeActAgent` | `Agent` | Default general-purpose coding agent (version `2.2`). |
| `ReadOnlyAgent` | `CodeActAgent` | Exploration only: grep, glob, view, think, finish, web_read; own prompt manager. |
| `LocAgent` | `CodeActAgent` | Code-localization agent with its own tool set and `response_to_actions`. |
| `BrowsingAgent` / `VisualBrowsingAgent` | `Agent` | Web-browsing agents used as delegates; they parse browser actions from the LLM text/vision output. |
| `DummyAgent` | `Agent` | Scripted agent for tests. |

## CodeActAgent step cycle

`CodeActAgent` implements the CodeAct idea: the action space is code (bash and Python) plus a few structured tools. Its `step(state)`:

1. **Drain the queue first.** A single LLM response can contain several tool calls; they are turned into actions and held in `self.pending_actions` (a deque). If the queue is non-empty, `step` simply pops the next one without calling the LLM.
2. **Exit shortcut.** If the latest user message is exactly `/exit`, it returns `AgentFinishAction`.
3. **Condense history.** `self.condenser.condensed_history(state)` returns either a `View` (events to show the model) or a `Condensation`. In the latter case the step returns the condensation's `CondensationAction` immediately; the controller then steps again with the shortened history. See [Memory and condensation](memory-and-condensation.md).
4. **Build messages.** `_get_messages` delegates to `ConversationMemory.process_events` (respecting `max_message_chars` and whether vision is active) and applies Anthropic-style prompt caching when the LLM reports it is active.
5. **Call the LLM** with `messages`, the `tools` (after `check_tools` adapts them to the LLM config) and `extra_body.metadata` from `state.to_llm_metadata`.
6. **Convert the response** with `response_to_actions` (in `function_calling.py`), push all resulting actions on the queue and return the first.

The constructor wires everything together: tools via `_get_tools()`, a `ConversationMemory`, a `Condenser` built from `config.condenser`, and finally replaces `self.llm` with `llm_registry.get_router(config)` so a model router can transparently pick between LLMs.

### Tools

`_get_tools()` assembles tools according to `AgentConfig` flags: `enable_cmd` (bash), `enable_think`, `enable_finish`, `enable_condensation_request`, `enable_browsing` (skipped on Windows), `enable_jupyter` (IPython), `enable_plan_mode` (task tracker), and exactly one editor: `enable_llm_editor` (LLM-based edit) takes precedence over `enable_editor` (`str_replace_editor`). For model families whose names contain `gpt-4`, `o1`, `o3` or `o4`, shorter tool descriptions are used. Tool definitions live in `agenthub/codeact_agent/tools/`.

### Function-call parsing

`function_calling.response_to_actions` maps each tool call name to an Action: command tool → `CmdRunAction`, IPython → `IPythonRunCellAction`, finish → `AgentFinishAction`, think → `AgentThinkAction`, condensation request → `CondensationRequestAction`, browser → `BrowseInteractiveAction`, editor → `FileEditAction`/`FileReadAction`, task tracker → `TaskTrackingAction`, `delegate_to_browsing_agent` → `AgentDelegateAction(agent='BrowsingAgent')`, and any name present in `mcp_tool_names` → `MCPAction`. Missing required arguments, unexpected arguments or unknown tool names raise function-calling errors; the controller converts those into an `ErrorObservation` so the model can retry (see [AgentController](../architecture/agent-controller.md)).

### Prompts and plan mode

Prompt templates are Jinja files in `codeact_agent/prompts/` (`system_prompt.j2`, `system_prompt_interactive.j2`, `system_prompt_long_horizon.j2`, `microagent_info.j2`, `security_risk_assessment.j2`, ...). `AgentConfig.resolved_system_prompt_filename` switches the default `system_prompt.j2` to `system_prompt_long_horizon.j2` when `enable_plan_mode` is set, unless a custom filename was configured.

### Sandbox plugins

`CodeActAgent.sandbox_plugins` declares `AgentSkillsRequirement` before `JupyterRequirement`; the order matters because the agent-skills plugin provides Python functions that Jupyter must be initialized with. See [Runtime and sandbox](../runtime/runtime-and-sandbox.md).

## Extending

To add an agent: subclass `Agent` (or `CodeActAgent` to reuse tools/memory), implement `step`, call `Agent.register` in the package `__init__`, and import the package from `agenthub/__init__.py`. Subclasses of `CodeActAgent` typically override `tools`, `prompt_manager` and `response_to_actions`, as `ReadOnlyAgent` and `LocAgent` do.

Related: [LLM layer](../llm/llm-layer.md), [Memory and condensation](memory-and-condensation.md), [Configuration](../configuration/configuration.md).
