---
title: "Agents and the Agent Registry"
---
## Overview

An agent is the component that decides what the controller does next. Each agent is a subclass of `Agent`, which fixes the small contract the controller relies on: a constructor that receives an LLM, a `step` method that returns one action from the current `State`, and a `reset`. Agents are looked up by name in a class-level registry, so the configuration can choose one without the controller importing it. The agents themselves live in `openhands/agenthub`; the loop that drives them is described in [[Agent Controller]].

Sources: [openhands/controller/agent.py:25-52](repo://openhands/controller/agent.py#L25-L52), [openhands/agenthub/README.md:1-12](repo://openhands/agenthub/README.md#L1-L12)

## The Agent contract

`Agent.__init__` takes an `AgentConfig` and an `LLMRegistry`. It asks the registry for the LLM that the agent's config names, and keeps the registry so delegates can share it. It also creates empty slots for MCP tools and the tool list, and a prompt manager that is set later by the subclass.

Sources: [openhands/controller/agent.py:40-52](repo://openhands/controller/agent.py#L40-L52)

Only `step` is abstract. The controller calls it once per step with the current `State` and executes the returned `Action`. `complete` reports whether the agent has finished its instruction, and `reset` clears that flag but not the LLM metrics, so a run's cost keeps accumulating across resets. `name` is the class name, and that is the name the logs and the status messages use.

Sources: [openhands/controller/agent.py:96-118](repo://openhands/controller/agent.py#L96-L118)

Two class attributes change what an agent needs from the runtime. `sandbox_plugins` lists the runtime plugins the agent requires, such as the Jupyter or agent-skills plugins, and `config_model` names the configuration class the agent reads.

Sources: [openhands/controller/agent.py:28-33](repo://openhands/controller/agent.py#L28-L33), [openhands/agenthub/codeact_agent/codeact_agent.py:70-74](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L70-L74), [openhands/agenthub/browsing_agent/browsing_agent.py:100-100](repo://openhands/agenthub/browsing_agent/browsing_agent.py#L100-L100)

## The registry

`Agent.register(name, cls)` adds a class to a dictionary shared by all subclasses, and raises `AgentAlreadyRegisteredError` if the name is taken. `Agent.get_cls(name)` returns the class or raises `AgentNotRegisteredError`, and `list_agents` returns every name. Each built-in package registers itself when `openhands.agenthub` is imported, which is why the entry points import that package before they create an agent.

Sources: [openhands/controller/agent.py:121-161](repo://openhands/controller/agent.py#L121-L161), [openhands/agenthub/__init__.py:1-24](repo://openhands/agenthub/__init__.py#L1-L24)

The default is `CodeActAgent`, and `create_agent` looks up the configured `default_agent` by name. A config entry with a `classpath` makes `register_custom_agents` import that class and register it under the entry's name, so a configuration can add an agent without changing the package.

Sources: [openhands/core/config/config_utils.py:7-7](repo://openhands/core/config/config_utils.py#L7-L7), [openhands/core/setup.py:202-207](repo://openhands/core/setup.py#L202-L207), [openhands/core/config/utils.py:796-817](repo://openhands/core/config/utils.py#L796-L817)

## Built-in agents

| Name | Class | What it is for |
| --- | --- | --- |
| `CodeActAgent` | `CodeActAgent` | The default: a general agent that acts through tools (shell, Python, files, browsing) |
| `ReadOnlyAgent` | `ReadOnlyAgent` | CodeAct limited to read-only tools, for exploring a codebase without changes |
| `LocAgent` | `LocAgent` | Code localisation over a graph of the codebase, built on CodeAct |
| `BrowsingAgent` | `BrowsingAgent` | The BrowserGym demo agent, for web browsing tasks |
| `VisualBrowsingAgent` | `VisualBrowsingAgent` | A browsing agent that uses screenshots with set-of-marks annotations |
| `DummyAgent` | `DummyAgent` | Sends a fixed sequence of actions with no LLM call, for end-to-end tests |

Sources: [openhands/agenthub/codeact_agent/__init__.py:1-4](repo://openhands/agenthub/codeact_agent/__init__.py#L1-L4), [openhands/agenthub/readonly_agent/readonly_agent.py:23-35](repo://openhands/agenthub/readonly_agent/readonly_agent.py#L23-L35), [openhands/agenthub/loc_agent/loc_agent.py:14-16](repo://openhands/agenthub/loc_agent/loc_agent.py#L14-L16), [openhands/agenthub/browsing_agent/browsing_agent.py:94-100](repo://openhands/agenthub/browsing_agent/browsing_agent.py#L94-L100), [openhands/agenthub/visualbrowsing_agent/visualbrowsing_agent.py:121-127](repo://openhands/agenthub/visualbrowsing_agent/visualbrowsing_agent.py#L121-L127), [openhands/agenthub/dummy_agent/agent.py:38-43](repo://openhands/agenthub/dummy_agent/agent.py#L38-L43)

Registrations: `Agent.register('CodeActAgent', CodeActAgent)` and the matching call in each package's `__init__.py` put the names in the registry.

Sources: [openhands/agenthub/codeact_agent/__init__.py:4-4](repo://openhands/agenthub/codeact_agent/__init__.py#L4-L4), [openhands/agenthub/browsing_agent/__init__.py:4-4](repo://openhands/agenthub/browsing_agent/__init__.py#L4-L4), [openhands/agenthub/readonly_agent/__init__.py:4-4](repo://openhands/agenthub/readonly_agent/__init__.py#L4-L4), [openhands/agenthub/loc_agent/__init__.py:4-4](repo://openhands/agenthub/loc_agent/__init__.py#L4-L4), [openhands/agenthub/dummy_agent/__init__.py:4-4](repo://openhands/agenthub/dummy_agent/__init__.py#L4-L4), [openhands/agenthub/visualbrowsing_agent/__init__.py:6-6](repo://openhands/agenthub/visualbrowsing_agent/__init__.py#L6-L6)

`ReadOnlyAgent` and `LocAgent` subclass `CodeActAgent`, so they reuse its step logic described in [[CodeAct Agent]]. The browsing and visual agents subclass `Agent` directly and bring their own step code. The benchmark harness runs any registered name, see [[Evaluation Harness]].

Sources: [openhands/agenthub/readonly_agent/readonly_agent.py:23-29](repo://openhands/agenthub/readonly_agent/readonly_agent.py#L23-L29), [openhands/agenthub/loc_agent/loc_agent.py:14-16](repo://openhands/agenthub/loc_agent/loc_agent.py#L14-L16), [openhands/agenthub/browsing_agent/browsing_agent.py:94-100](repo://openhands/agenthub/browsing_agent/browsing_agent.py#L94-L100), [openhands/agenthub/visualbrowsing_agent/visualbrowsing_agent.py:121-127](repo://openhands/agenthub/visualbrowsing_agent/visualbrowsing_agent.py#L121-L127)
