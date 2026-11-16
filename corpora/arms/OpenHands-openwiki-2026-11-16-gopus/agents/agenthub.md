---
type: subsystem
title: "Agents: CodeAct and the Agent Hub"
description: How OpenHands agents are defined, registered, and selected, how CodeActAgent turns event history into LLM calls and tool calls into Actions, and what the other bundled agents (browsing, read-only, LocAgent, dummy) do.
tags: [agents, codeact, function-calling, tools, prompts]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:35:38.671Z
sources:
  - id: openwiki-source-a99c4b31854ec23b59684012
    resource: repo://openhands/agenthub/__init__.py
  - id: openwiki-source-c91073c920feafcf0f56f619
    resource: repo://openhands/agenthub/codeact_agent/__init__.py
  - id: openwiki-source-f161159e8a959406ae10a085
    resource: repo://openhands/agenthub/codeact_agent/codeact_agent.py
  - id: openwiki-source-2e7cf1ee6ccb20d38552bf97
    resource: repo://openhands/agenthub/codeact_agent/function_calling.py
  - id: openwiki-source-79010afa59ddf72bcc231020
    resource: repo://openhands/agenthub/readonly_agent/function_calling.py
  - id: openwiki-source-b4b0153623d3fee4bd3c8711
    resource: repo://openhands/agenthub/readonly_agent/readonly_agent.py
  - id: openwiki-source-2129d0084f64a3f5714baf90
    resource: repo://openhands/controller/agent_controller.py
  - id: openwiki-source-44f2545083aa1045beab5794
    resource: repo://openhands/controller/agent.py
  - id: openwiki-source-4ae545fc5168dd6cca0bd13a
    resource: repo://openhands/core/config/agent_config.py
  - id: openwiki-source-61b5d6e6c4155cc8921df93e
    resource: repo://openhands/core/setup.py
generated: { by: "claude-code", at: "2026-11-16T07:35:38.671Z" }
---

# Agents: CodeAct and the Agent Hub

An **agent** in OpenHands is a policy: given the current `State` (event history, iteration counters, etc.), it returns the next `Action`. Agents never execute anything themselves. The [Agent Controller](../architecture/agent-controller.md) calls `agent.step(state)`, publishes the returned action on the [event stream](../architecture/event-stream.md), and the runtime turns it into an observation.

## The `Agent` base class and registry

`openhands/controller/agent.py` defines the abstract `Agent`:

- The constructor gets an `AgentConfig` and an `LLMRegistry`. It asks the registry for the agent's LLM (`get_llm_from_agent_config('agent', config)`), and sets up empty `tools` and `mcp_tools`.
- `step(state) -> Action` is the one abstract method.
- `get_system_message()` renders the system prompt through the agent's `PromptManager`. It returns a `SystemMessageAction` holding the prompt text, the tool definitions, and the agent class name, with source `AGENT`. The controller adds it to the stream as the first event of a conversation.
- `set_mcp_tools()` appends MCP tool schemas to `tools`. It skips names it already has, so registering the same tool twice does nothing.
- `sandbox_plugins` is a class attribute that lists the runtime plugins the agent needs (see [Runtime Architecture](../runtime/runtime-architecture.md)).
- `config_model` lets a subclass use its own `AgentConfig` subclass.

Agents are kept in a class-level `_registry` that maps a name to a class. `Agent.register()` raises `AgentAlreadyRegisteredError` if the name is already taken, and `Agent.get_cls()` raises `AgentNotRegisteredError` if it isn't registered. Each agent package registers itself in its `__init__.py`. `openhands/agenthub/__init__.py` imports every bundled agent package, so code that needs agents imports `openhands.agenthub` for that side effect. `openhands/core/main.py` does this with a `# noqa` import.

`create_agent()` in `openhands/core/setup.py` looks up `config.default_agent` in the registry, gets that agent's config section (`config.get_agent_config(name)`), and creates the agent. To add a new agent: subclass `Agent`, call `Agent.register(...)` in the package `__init__`, add an import to `openhands/agenthub/__init__.py`, then select it with `default_agent` or `-c/--agent-cls`.

| Registered name | Class | Purpose |
| --- | --- | --- |
| `CodeActAgent` | `codeact_agent.CodeActAgent` | Default general-purpose coding agent |
| `BrowsingAgent` | `browsing_agent.BrowsingAgent` | BrowserGym-style web agent that uses the accessibility tree; a CodeAct delegation target |
| `VisualBrowsingAgent` | `visualbrowsing_agent.VisualBrowsingAgent` | Browsing agent that uses screenshots and set-of-marks |
| `ReadOnlyAgent` | `readonly_agent.ReadOnlyAgent` | CodeAct subclass limited to non-mutating tools |
| `LocAgent` | `loc_agent.LocAgent` | CodeAct subclass for code localization with graph-search tools |
| `DummyAgent` | `dummy_agent.DummyAgent` | Fixed, scripted action sequence for tests |

## CodeActAgent

`CodeActAgent` (`openhands/agenthub/codeact_agent/codeact_agent.py`, `VERSION = '2.2'`) is based on the CodeAct idea: the model acts by running code (bash, IPython) and calling a small set of structured tools, and it talks to the user in natural language.

### Construction

When the agent is constructed it:

1. Builds its tool list from `AgentConfig` flags (`_get_tools`).
2. Creates a `ConversationMemory`, which turns events into messages.
3. Creates a condenser with `Condenser.from_config(config.condenser, llm_registry)`.
4. Replaces `self.llm` with `llm_registry.get_router(config)`, so [model routing](../architecture/llm-layer.md) can switch between LLMs on each call.

It requires the `AgentSkillsRequirement` and `JupyterRequirement` sandbox plugins, in that order. Agent skills has to come first because Jupyter imports its helper functions.

### Tools

Each tool is a litellm `ChatCompletionToolParam` defined under `codeact_agent/tools/`. Which ones are enabled depends on these flags:

| Flag (`AgentConfig`) | Default | Tool name |
| --- | --- | --- |
| `enable_cmd` | on | `execute_bash` |
| `enable_think` | on | `think` |
| `enable_finish` | on | `finish` |
| `enable_condensation_request` | off | `request_condensation` |
| `enable_browsing` | on (always off on Windows) | `browser` |
| `enable_jupyter` | on | `execute_ipython_cell` |
| `enable_plan_mode` | on | `task_tracker` |
| `enable_llm_editor` / `enable_editor` | off / on | `edit_file` (deprecated LLM editor) or `str_replace_editor` |

The LLM editor and `str_replace_editor` are mutually exclusive. `enable_llm_editor` takes priority. For models whose name contains `gpt-4`, `o1`, `o3`, or `o4`, the bash, editor, and task-tracker tools use short descriptions to stay under OpenAI's old 1k-character limit on function descriptions.

### The step loop

`CodeActAgent.step(state)`:

1. If an earlier LLM response produced several actions, it returns the next one from the `pending_actions` deque. One response can contain several tool calls, and the agent hands them out one per step.
2. If the last user message is `/exit`, it returns `AgentFinishAction`.
3. It runs the condenser over the state. A `View` result supplies the events to send to the LLM. A `Condensation` result means the agent returns the condensation action straight away, and the controller steps again with the condensed view (see [Conversation Memory and Condensers](../architecture/memory-and-condensers.md)).
4. It finds the initial user `MessageAction` in the full history. If there isn't one, it raises `ValueError`.
5. `ConversationMemory.process_events()` turns the view into `Message`s. When prompt caching is active, cache markers are applied.
6. It calls `llm.completion(messages=..., tools=check_tools(...), extra_body={'metadata': state.to_llm_metadata(...)})`.
7. `response_to_actions()` converts the response into actions. The first one is returned and the rest are queued.

### Tool calls to Actions

`openhands/agenthub/codeact_agent/function_calling.py:response_to_actions` maps each tool call in the single response choice to an `Action`:

- `execute_bash` → `CmdRunAction`. Supports `is_input` (send input to the running process) and an optional hard `timeout`.
- `execute_ipython_cell` → `IPythonRunCellAction`.
- `str_replace_editor` → `FileReadAction` for `view`, otherwise `FileEditAction` with `impl_source=OH_ACI`. Unknown arguments raise `FunctionCallValidationError`.
- `edit_file` → LLM-based `FileEditAction`.
- `browser` → `BrowseInteractiveAction`. `think` → `AgentThinkAction`. `finish` → `AgentFinishAction`. `request_condensation` → `CondensationRequestAction`. `task_tracker` → `TaskTrackingAction`, after the task list is normalized.
- `delegate_to_browsing_agent` → `AgentDelegateAction(agent='BrowsingAgent')`.
- Any name in the agent's `mcp_tools` → `MCPAction` (see [MCP Integration](../integrations/mcp.md)).
- Anything else raises `FunctionCallNotExistsError`.

Arguments that aren't valid JSON or are missing a required field raise `FunctionCallValidationError`. The controller reports these errors back to the model as an `ErrorObservation` so it can correct itself, and the conversation does not crash. When the model provides a `security_risk` argument, it is copied onto the action for the [security analyzers](../security/security-analyzers.md).

The model's text output goes on the **first** action only, as its `thought`. Every action gets `ToolCallMetadata`: the tool call id, the function name, the full model response, and the number of calls in the response. `ConversationMemory` uses this to rebuild matching assistant tool-call and tool-result messages. A response with no tool calls becomes a `MessageAction(wait_for_response=True)`, which moves the controller to `AWAITING_USER_INPUT`. Every action gets the response `id` so token usage can be attributed to it.

Models without native function calling still use this code path. The LLM layer converts tool schemas to and from a text prompt format (`openhands/llm/fn_call_converter.py`), described in [LLM Layer](../architecture/llm-layer.md).

### Prompts

`PromptManager` (`openhands/utils/prompt.py`) loads Jinja2 templates from `codeact_agent/prompts/`. The system prompt file comes from `AgentConfig.resolved_system_prompt_filename`: when `enable_plan_mode` is on and the file name is still the default `system_prompt.j2`, it switches to `system_prompt_long_horizon.j2`. Other templates cover the interactive and tech-philosophy variants, the in-context-learning example (used for non-function-calling models), additional repository/runtime info, microagent info, and security-risk assessment guidance.

## Derived and alternative agents

- **ReadOnlyAgent** subclasses CodeAct and replaces `_get_tools` with `think`, `finish`, `grep`, `glob`, and `view` from `readonly_agent/function_calling.py`. It loads its own prompts and ignores MCP tools: `set_mcp_tools` only logs a warning.
- **LocAgent** subclasses CodeAct and swaps in code-localization tools (`search_code_snippets`, `get_entity_contents`, `explore_tree_structure`) that work over a graph of the codebase.
- **BrowsingAgent** and **VisualBrowsingAgent** don't use CodeAct tool calling. They build prompts from previous browser actions, the current URL, and the accessibility tree or screenshots, then parse BrowserGym commands out of the LLM text into `BrowseInteractiveAction`s. In `EVAL_MODE`, the first step is a `noop()` so the browser environment returns its initial observation.
- **DummyAgent** walks through a hard-coded list of actions and expected observations, indexed by `state.iteration_flag.current_value`. Tests use it to exercise the controller and runtime without an LLM.

## Tests

`tests/unit/agenthub/` covers agent construction and tool selection (`test_agents.py`), tool-call-to-action conversion (`test_function_calling.py`), prompt caching (`test_prompt_caching.py`), Windows prompt adjustments, and browsing-agent parsing.

## Related pages

- [Agent Controller and State](../architecture/agent-controller.md): who calls `step` and how actions are handled.
- [LLM Layer](../architecture/llm-layer.md): completion, function-call emulation, and routing.
- [Conversation Memory and Condensers](../architecture/memory-and-condensers.md): building messages and condensing history.
- [Microagents](../concepts/microagents.md): extra prompt context injected into conversations.
