---
title: "Agents"
---
## Overview

An agent is the part of OpenHands that decides what to do next. Given the current `State`, its `step` method returns one `Action`; the [[Agent Controller]] calls it in a loop, publishes the action, and calls it again when the result arrives. Everything an agent needs beyond that, such as executing commands, persisting history or enforcing limits, lives outside it, which is why an agent can be as small as a fixed script or as rich as the default CodeAct agent.

Sources: [openhands/controller/agent.py:25-118](repo://openhands/controller/agent.py#L25-L118), [openhands/agenthub/README.md:8-16](repo://openhands/agenthub/README.md#L8-L16)

Agents live in `openhands/agenthub`. Importing that package imports every built-in agent, and each agent package registers its class by name, so the server, the CLI and the headless runner only need the configured name.

Sources: [openhands/agenthub/__init__.py:1-24](repo://openhands/agenthub/__init__.py#L1-L24), [openhands/agenthub/codeact_agent/__init__.py:1-4](repo://openhands/agenthub/codeact_agent/__init__.py#L1-L4)

## The Agent interface

### Construction

`Agent.__init__(config, llm_registry)` asks the [[LLM Registry and Routing]] for the agent's LLM from its `AgentConfig`, and keeps the registry so delegates can share it. It starts with an empty tool list, an empty map of MCP tools and no prompt manager.

Sources: [openhands/controller/agent.py:40-57](repo://openhands/controller/agent.py#L40-L57)

### Members a subclass provides

| Member | Purpose |
| --- | --- |
| `step(state)` | abstract; returns the next action |
| `reset()` | clears per-task status; the controller calls it on stop or error |
| `sandbox_plugins` | list of `PluginRequirement` the runtime must install, such as Jupyter or agent skills (see [[Runtime Plugins]]) |
| `config_model` | the `AgentConfig` subclass used to validate this agent's `[agent.<Name>]` section |
| `prompt_manager` | renders the system prompt; `get_system_message` wraps it with the tool list in a `SystemMessageAction` |
| `tools` | the tool definitions sent to the LLM |
| `set_mcp_tools(tools)` | adds MCP tool definitions to `tools`, skipping duplicate names |

Sources: [openhands/controller/agent.py:34-118](repo://openhands/controller/agent.py#L34-L118), [openhands/controller/agent.py:163-183](repo://openhands/controller/agent.py#L163-L183)

The controller adds the system message to the stream once, before the first step, so the prompt and tool list an agent ran with are part of the stored conversation.

Sources: [openhands/controller/agent.py:59-93](repo://openhands/controller/agent.py#L59-L93), [openhands/controller/agent_controller.py:239-260](repo://openhands/controller/agent_controller.py#L239-L260)

### Registry

`Agent.register(name, cls)` adds a class to the class-level `_registry` and raises `AgentAlreadyRegisteredError` on a duplicate name; `get_cls(name)` raises `AgentNotRegisteredError` for an unknown one; `list_agents` returns every name. Custom agents join the same registry through the `classpath` key of an agent config section, which [[Configuration]] describes.

Sources: [openhands/controller/agent.py:120-161](repo://openhands/controller/agent.py#L120-L161), [openhands/core/config/utils.py:796-816](repo://openhands/core/config/utils.py#L796-L816)

### Configuration flags

`AgentConfig` holds the switches agents read: which LLM config to use (`llm_config`), which system prompt file, and which tools are on (`enable_browsing`, `enable_editor`, `enable_llm_editor`, `enable_jupyter`, `enable_cmd`, `enable_think`, `enable_finish`, `enable_condensation_request`, `enable_mcp`, `enable_plan_mode`), plus prompt extensions, disabled microagents, history truncation, the condenser and model routing.

Sources: [openhands/core/config/agent_config.py:15-63](repo://openhands/core/config/agent_config.py#L15-L63)

## Built-in agents

### Catalogue

| Name | Built on | Tools / actions | Choose it when |
| --- | --- | --- | --- |
| `CodeActAgent` | `Agent` | bash, IPython, file editor, browser, think, finish, task tracker, MCP | the default for software tasks; see [[CodeAct Agent]] |
| `ReadOnlyAgent` | `CodeActAgent` | think, finish, grep, glob, view | exploring a codebase without changing it |
| `LocAgent` | `CodeActAgent` | finish, repository search, entity search, tree exploration | locating the code relevant to an issue |
| `BrowsingAgent` | `Agent` | BrowserGym actions on the accessibility tree | web tasks such as WebArena and MiniWoB |
| `VisualBrowsingAgent` | `Agent` | BrowserGym actions with screenshots and set-of-marks | visual web tasks such as VisualWebArena |
| `DummyAgent` | `Agent` | a fixed script, no LLM | end-to-end tests |

Sources: [openhands/agenthub/__init__.py:6-13](repo://openhands/agenthub/__init__.py#L6-L13), [openhands/core/config/config_utils.py:7-7](repo://openhands/core/config/config_utils.py#L7-L7)

### CodeActAgent

The default agent (`default_agent = CodeActAgent`) puts every capability behind LLM tool calls and needs the agent-skills and Jupyter plugins in the sandbox. The next page, [[CodeAct Agent]], follows its step in detail.

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:50-77](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L50-L77)

### ReadOnlyAgent

`ReadOnlyAgent` subclasses `CodeActAgent` and changes three things: its tools are only `think`, `finish`, `grep`, `glob` and `view`; it uses its own prompt directory; and it ignores MCP tools with a warning. Its `response_to_actions` maps `grep` and `glob` to shell commands and `view` to a `FileReadAction`, so nothing it can call writes to the workspace.

Sources: [openhands/agenthub/readonly_agent/readonly_agent.py:23-83](repo://openhands/agenthub/readonly_agent/readonly_agent.py#L23-L83), [openhands/agenthub/readonly_agent/function_calling.py:241-248](repo://openhands/agenthub/readonly_agent/function_calling.py#L241-L248), [openhands/agenthub/readonly_agent/function_calling.py:150-200](repo://openhands/agenthub/readonly_agent/function_calling.py#L150-L200)

### LocAgent

`LocAgent` implements code localisation: it represents a codebase as a graph of entities and their dependencies and searches it in several hops. It is a `CodeActAgent` whose tools are replaced by `finish`, a repository search, an entity search and an `explore_tree_structure` tool; its tool calls run as IPython cells in the sandbox.

Sources: [openhands/agenthub/loc_agent/README.md:1-14](repo://openhands/agenthub/loc_agent/README.md#L1-L14), [openhands/agenthub/loc_agent/loc_agent.py:14-40](repo://openhands/agenthub/loc_agent/loc_agent.py#L14-L40), [openhands/agenthub/loc_agent/function_calling.py:70-125](repo://openhands/agenthub/loc_agent/function_calling.py#L70-L125)

### BrowsingAgent

`BrowsingAgent` drives the browser through BrowserGym's high-level action set (`chat`, `bid`, and `nav` unless `USE_NAV` is false), without tool calling. Each step it rebuilds a single prompt from the goal, the current URL, the flattened accessibility tree and the previous browser actions, and parses the reply into a `BrowseInteractiveAction`. It finishes when it sends a message, and gives up after more than five browser errors. Environment variables `USE_NAV` and `USE_CONCISE_ANSWER` switch it to the benchmark mode used for WebArena and MiniWoB.

Sources: [openhands/agenthub/browsing_agent/browsing_agent.py:31-43](repo://openhands/agenthub/browsing_agent/browsing_agent.py#L31-L43), [openhands/agenthub/browsing_agent/browsing_agent.py:110-223](repo://openhands/agenthub/browsing_agent/browsing_agent.py#L110-L223)

### VisualBrowsingAgent

`VisualBrowsingAgent` follows the AgentLab generic agent: it adds tab and infeasibility actions, allows one action per step, and gives the model a set-of-marks screenshot alongside the accessibility tree and its earlier thoughts. The CodeAct agent does not delegate to it; it is used for visual browsing benchmarks.

Sources: [openhands/agenthub/visualbrowsing_agent/visualbrowsing_agent.py:121-175](repo://openhands/agenthub/visualbrowsing_agent/visualbrowsing_agent.py#L121-L175), [openhands/agenthub/visualbrowsing_agent/README.md:1-7](repo://openhands/agenthub/visualbrowsing_agent/README.md#L1-L7)

[[Browser Environment]] describes how both browsing agents' actions are executed.

Sources: [openhands/events/action/browse.py:30-34](repo://openhands/events/action/browse.py#L30-L34)

### DummyAgent

`DummyAgent` makes no LLM calls. It walks through a fixed list of actions (a message, shell commands, file reads and writes, a browse) indexed by the iteration counter, compares the observations it gets with the ones it expects, and finishes when the list runs out. The end-to-end tests run it with `python -m openhands.core.main -c DummyAgent`.

Sources: [openhands/agenthub/dummy_agent/agent.py:38-60](repo://openhands/agenthub/dummy_agent/agent.py#L38-L60), [openhands/agenthub/dummy_agent/agent.py:100-130](repo://openhands/agenthub/dummy_agent/agent.py#L100-L130), [tests/e2e/test_local_runtime.py:25-25](repo://tests/e2e/test_local_runtime.py#L25-L25)

## Delegation between agents

Any agent can return an `AgentDelegateAction` naming another registered agent and its inputs. The controller then runs that agent as a sub-agent on the same event stream and, when it finishes, hands its outputs back as an `AgentDelegateObservation`. Iterations are counted across the whole task while each sub-agent keeps its own local count; the [[Agent Controller]] page covers the mechanics.

Sources: [openhands/agenthub/README.md:95-142](repo://openhands/agenthub/README.md#L95-L142), [openhands/controller/agent_controller.py:673-732](repo://openhands/controller/agent_controller.py#L673-L732)
