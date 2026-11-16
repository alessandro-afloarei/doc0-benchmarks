---
type: architecture-component
title: Agents, Prompting, and Delegation
description: The Agent base contract and registry, the CodeAct and browsing agents that ship in the agent hub, how their tool sets are gated by configuration, how tool calls become actions, and how prompts are assembled.
tags: [agents, agent-hub, codeact, browsing-agent, prompting, function-calling, delegation, tools]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:30:54.023Z
sources:
  - id: openwiki-source-f161159e8a959406ae10a085
    resource: repo://openhands/agenthub/codeact_agent/codeact_agent.py
  - id: openwiki-source-2e7cf1ee6ccb20d38552bf97
    resource: repo://openhands/agenthub/codeact_agent/function_calling.py
  - id: openwiki-source-b4b0153623d3fee4bd3c8711
    resource: repo://openhands/agenthub/readonly_agent/readonly_agent.py
  - id: openwiki-source-44f2545083aa1045beab5794
    resource: repo://openhands/controller/agent.py
generated: { by: "claude-code", at: "2026-11-16T18:30:54.023Z" }
---

# Agents, Prompting, and Delegation

<!-- openwiki: broken internal link [/openwiki/architecture/agent-controller.md] link "/openwiki/architecture/agent-controller.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
An agent is the decision-maker inside a conversation. It receives a `State` from the [agent controller](/openwiki/architecture/agent-controller.md) and returns exactly one `Action`. Everything else, including execution, persistence, and limits, lives outside the agent. The agent hub (`openhands/agenthub/`) holds the concrete implementations.

## The Agent contract

`Agent` (`openhands/controller/agent.py`) is an abstract base class with a small surface:

- `__init__(config, llm_registry)` resolves its LLM via `llm_registry.get_llm_from_agent_config('agent', config)` (~L45), so every agent gets its LLM from the shared registry and its configuration, not from a constructor argument.
- `step(state) -> Action` (~L105) is the only required decision method.
- `reset()` (~L111) clears transient state; subclasses such as CodeAct extend it to clear pending actions.
- `get_system_message()` (~L59) wraps the prompt manager's rendered system prompt in a `SystemMessageAction` that carries the tool list. The event stream records it as the first message.
- `sandbox_plugins` (~L35) declares plugin requirements that the server merges into the runtime when a session starts (`openhands/server/session/agent_session.py`).

### Registry

Agents are named and looked up through a class-level registry on `Agent` (`_registry`, ~L34):

- `Agent.register(name, cls)` (~L121) adds an entry. Each agent package calls it from its `__init__.py`. Built-in names include `CodeActAgent`, `BrowsingAgent`, `ReadOnlyAgent`, `LocAgent`, `VisualBrowsingAgent`, and `DummyAgent`.
- `Agent.get_cls(name)` (~L136) resolves a name to a class and raises if it is unknown.
- Custom agents come from configuration: `register_custom_agents` (`openhands/core/config/utils.py`, ~L795-L815) imports each configured `classpath` and registers it under the configured name.

This is the seam for adding an agent. Subclass `Agent`, implement `step`, and register it.

## Agent hub implementations

- **CodeActAgent** (`openhands/agenthub/codeact_agent/codeact_agent.py`) is the primary agent. It works through the LLM's function-calling interface and exposes a set of tools. It is the base class for `ReadOnlyAgent` (which overrides `_get_tools` to offer only read-only tools) and `LocAgent` (which replaces `self.tools` with its own function-calling tool module).
- **BrowsingAgent** (`openhands/agenthub/browsing_agent/browsing_agent.py`) is a separate `Agent` subclass. It builds a prompt from the current URL, an accessibility tree, and the previous browser action, and parses a textual response (`response_parser.py`) instead of function calls.
- Other agents in the hub are `VisualBrowsingAgent`, `ReadOnlyAgent`, `LocAgent`, and `DummyAgent`. `DummyAgent` (`openhands/agenthub/dummy_agent/agent.py`) is a scripted agent that emits a fixed sequence of actions.

See `openhands/agenthub/README.md` for the hub's own description of the state object.

## CodeAct step

`CodeActAgent.step` (`codeact_agent.py` ~L160) proceeds in fixed order:

1. If `pending_actions` is non-empty, it pops and returns the next queued action. One LLM response can yield several tool calls, and they are drained one per step.
2. A last user message of `/exit` returns `AgentFinishAction`.
<!-- openwiki: broken internal link [/openwiki/architecture/memory-and-context.md] link "/openwiki/architecture/memory-and-context.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
3. The condenser (`Condenser.from_config`, ~L92) produces a `View` of the history. If it instead returns a `Condensation`, that condensation action is returned directly and the controller steps again with the new view. See [Memory, Condensation, and Microagents](/openwiki/architecture/memory-and-context.md).
4. The message list is built from the condensed view, the initial user message, and the system message. Prompt caching is applied when the LLM reports it is active (~L290).
5. Tools are filtered for the model with `check_tools` and passed with the request. `metadata` from `state.to_llm_metadata` is attached for telemetry.
6. `self.llm.completion(...)` is called (~L218). The response goes through `response_to_actions` (~L295), which delegates to `function_calling.response_to_actions` (`openhands/agenthub/codeact_agent/function_calling.py`, ~L73).
7. The produced actions are appended to `pending_actions` and the first one is returned.

### From tool call to action

`function_calling.response_to_actions` maps each tool call name to an `Action` subclass. Examples include bash execution to `CmdRunAction`, IPython cells to `IPythonRunCellAction`, file edits to file actions, browser calls to `BrowseInteractiveAction`, and `finish` to `AgentFinishAction`. Tool names that match an MCP tool are wrapped as `MCPAction` (the MCP name list is passed in from `CodeActAgent`). The assistant's text content, when present, is kept as the action's thought. A security-risk field from the arguments is carried onto the action, which the controller later uses for confirmation gating.

The only delegation tool name recognized by the converter is `delegate_to_browsing_agent` (`function_calling.py` ~L138), which yields an `AgentDelegateAction`. No tool schema with that name is defined under `codeact_agent/tools/` in this repository, so delegation is reached only when a configuration or agent exposes that tool.

## Tool gating

`CodeActAgent._get_tools` (~L108-L152) builds the tool list from `AgentConfig` flags:

| Flag | Tool added |
| --- | --- |
| `enable_cmd` | bash execution (`create_cmd_run_tool`) |
| `enable_think` | think tool |
| `enable_finish` | finish tool |
| `enable_condensation_request` | condensation request |
| `enable_browsing` | browser tool (skipped on Windows, with a warning) |
| `enable_jupyter` | IPython tool |
| `enable_plan_mode` | task tracker tool |
| `enable_llm_editor` | LLM-based file editor |
| `enable_editor` | string-replace editor (only if `enable_llm_editor` is false) |

Tool descriptions are shortened for models whose name matches a short-description list (`gpt-4`, `o1`, `o3`, `o4`), which keeps schemas under provider limits.

## Prompting

`PromptManager` (`openhands/utils/prompt.py`, class at ~L43) loads Jinja templates from the agent's `prompts/` directory and renders the system prompt. CodeAct chooses the template file from its configuration (`resolved_system_prompt_filename`) and passes `cli_mode`. The rendered text is post-processed by `refine_prompt` (`codeact_agent/tools/prompt.py`). The manager also contributes:

<!-- openwiki: broken internal link [/openwiki/architecture/memory-and-context.md] link "/openwiki/architecture/memory-and-context.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- the workspace and microagent context (`build_workspace_context`, `build_microagent_info`), used by the microagents described in [Memory, Condensation, and Microagents](/openwiki/architecture/memory-and-context.md);
- turns-left reminders (`add_turns_left_reminder`) in the message list.

Messages are assembled by `ConversationMemory` (`openhands/memory/conversation_memory.py`), which converts the condensed events into LLM messages. Tool-call conversion for models without native function calling is handled by `openhands/llm/fn_call_converter.py`, which turns tool schemas into text and parses the response back into tool calls.

## Invariants and failure behavior

- An agent returns one action per `step` call. Extra actions from one LLM response wait in `pending_actions`. `reset()` clears this queue but not LLM metrics.
- If the LLM call raises, the exception propagates to the controller, which handles it as an error state. The agent does not catch LLM errors itself.
- `check_tools` removes or adapts tools the configured model cannot take. Tool availability therefore depends on both the agent flags and the model.

## Extension seams

- New agent: subclass `Agent` (or `CodeActAgent` for a tool-set variant), implement `step`, and call `Agent.register`.
- New tool: add a builder under `codeact_agent/tools/`, wire it into `_get_tools` behind a flag, and map its tool-call name in `function_calling.py`.
- Prompt changes: edit the templates under `codeact_agent/prompts/` rather than the Python code.

## Representative tests

- `tests/unit/agenthub/test_agents.py` covers default tool construction, `reset`, pending-action draining, and the bash tool.
- `tests/unit/agenthub/test_function_calling.py` covers tool-call to action mapping.
- `tests/unit/agenthub/test_prompt_caching.py` covers prompt-caching message shaping.
- `tests/unit/agenthub/browsing_agent/test_browsing_agent_parser.py` covers the browsing response parser.
- `tests/unit/utils/test_prompt_manager.py` covers prompt rendering.

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/agent-controller.md] link "/openwiki/architecture/agent-controller.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Agent Controller and Step Loop](/openwiki/architecture/agent-controller.md)
<!-- openwiki: broken internal link [/openwiki/architecture/llm-layer.md] link "/openwiki/architecture/llm-layer.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [LLM Layer, Routing, Metrics, and Retries](/openwiki/architecture/llm-layer.md)
<!-- openwiki: broken internal link [/openwiki/architecture/memory-and-context.md] link "/openwiki/architecture/memory-and-context.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Memory, Condensation, and Microagents](/openwiki/architecture/memory-and-context.md)
