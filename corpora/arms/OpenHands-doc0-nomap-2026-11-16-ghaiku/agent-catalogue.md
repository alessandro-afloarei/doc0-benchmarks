---
title: "Agent Catalogue"
---
## Overview

Six agents ship in `openhands/agenthub`. Each one is a subclass of the `Agent` base class and registers itself under a name when its package is imported. A configuration chooses an agent by that name, and the controller then builds it with the same constructor. The default is `CodeActAgent`, which has its own page: [[CodeAct Agent]]. This page lists the others, what each one is for, and how it is chosen.

Sources: [openhands/agenthub/__init__.py:1-24](repo://openhands/agenthub/__init__.py#L1-L24), [openhands/controller/agent.py:25-36](repo://openhands/controller/agent.py#L25-L36), [openhands/core/config/config_utils.py:7](repo://openhands/core/config/config_utils.py#L7)

## Registration and selection

`Agent.register` stores the class in a shared dictionary under its name. A second registration under the same name is an error. Each agent package calls `Agent.register` in its `__init__.py`, so importing `openhands.agenthub` registers all of them.

Sources: [openhands/controller/agent.py:121-134](repo://openhands/controller/agent.py#L121-L134), [openhands/agenthub/codeact_agent/__init__.py:4](repo://openhands/agenthub/codeact_agent/__init__.py#L4), [openhands/agenthub/readonly_agent/__init__.py:4](repo://openhands/agenthub/readonly_agent/__init__.py#L4), [openhands/agenthub/dummy_agent/__init__.py:4](repo://openhands/agenthub/dummy_agent/__init__.py#L4), [openhands/agenthub/loc_agent/__init__.py:4](repo://openhands/agenthub/loc_agent/__init__.py#L4), [openhands/agenthub/browsing_agent/__init__.py:4](repo://openhands/agenthub/browsing_agent/__init__.py#L4), [openhands/agenthub/visualbrowsing_agent/__init__.py:6](repo://openhands/agenthub/visualbrowsing_agent/__init__.py#L6)

`Agent.get_cls` looks a name up and raises `AgentNotRegisteredError` when it is missing. `create_agent` uses the name in `default_agent`, and a conversation can name its own agent in its settings. Either way the class is built with the agent config for that name.

Sources: [openhands/controller/agent.py:136-150](repo://openhands/controller/agent.py#L136-L150), [openhands/core/setup.py:202-208](repo://openhands/core/setup.py#L202-L208), [openhands/server/session/session.py:142-143](repo://openhands/server/session/session.py#L142-L143)

## ReadOnlyAgent

`ReadOnlyAgent` is a `CodeActAgent` whose tool list is replaced with the read-only tools. Its docstring says it is for exploring a codebase without changes, and that a regular `CodeActAgent` is needed to make changes. Its `_get_tools` returns the read-only function-calling tools only.

Sources: [openhands/agenthub/readonly_agent/readonly_agent.py:23-37](repo://openhands/agenthub/readonly_agent/readonly_agent.py#L23-L37), [openhands/agenthub/readonly_agent/readonly_agent.py:65-68](repo://openhands/agenthub/readonly_agent/readonly_agent.py#L65-L68)

## LocAgent

`LocAgent` is also a `CodeActAgent`. It replaces the tools with the location tools: a finish tool, a repository search and an entity search. The entity search reads named functions and classes such as `src/my_file.py:MyClass.func_name`.

Sources: [openhands/agenthub/loc_agent/loc_agent.py:14-31](repo://openhands/agenthub/loc_agent/loc_agent.py#L14-L31), [openhands/agenthub/loc_agent/function_calling.py:120-123](repo://openhands/agenthub/loc_agent/function_calling.py#L120-L123), [openhands/agenthub/loc_agent/tools/search_content.py:12](repo://openhands/agenthub/loc_agent/tools/search_content.py#L12)

## BrowsingAgent

`BrowsingAgent` is a direct subclass of `Agent` for browser work. It imports `BrowsingResponseParser` for the model's answers, and it returns `BrowseInteractiveAction`, `MessageAction` or `AgentFinishAction` values. A `CodeActAgent` does not run it directly. Its `delegate_to_browsing_agent` tool call becomes an `AgentDelegateAction` for `BrowsingAgent`, and the controller starts that agent as a child.

Sources: [openhands/agenthub/browsing_agent/browsing_agent.py:94-98](repo://openhands/agenthub/browsing_agent/browsing_agent.py#L94-L98), [openhands/agenthub/browsing_agent/browsing_agent.py:1-20](repo://openhands/agenthub/browsing_agent/browsing_agent.py#L1-L20), [openhands/agenthub/codeact_agent/function_calling.py:136-144](repo://openhands/agenthub/codeact_agent/function_calling.py#L136-L144)

## VisualBrowsingAgent

`VisualBrowsingAgent` is also a browsing agent, and its docstring says it uses webpage screenshots while it browses. Its prompt builds the goal and the error prefix from the previous browser action. It is registered under `VisualBrowsingAgent`.

Sources: [openhands/agenthub/visualbrowsing_agent/visualbrowsing_agent.py:121-127](repo://openhands/agenthub/visualbrowsing_agent/visualbrowsing_agent.py#L121-L127), [openhands/agenthub/visualbrowsing_agent/visualbrowsing_agent.py:25-33](repo://openhands/agenthub/visualbrowsing_agent/visualbrowsing_agent.py#L25-L33)

## DummyAgent

`DummyAgent` makes no LLM calls. Its docstring says it exists for end-to-end testing. It holds a fixed list of steps, each with an action and the observations it expects, and it returns the next action by the iteration counter. When the steps run out it returns an `AgentFinishAction`.

Sources: [openhands/agenthub/dummy_agent/agent.py:38-44](repo://openhands/agenthub/dummy_agent/agent.py#L38-L44), [openhands/agenthub/dummy_agent/agent.py:50-60](repo://openhands/agenthub/dummy_agent/agent.py#L50-L60), [openhands/agenthub/dummy_agent/agent.py:100-104](repo://openhands/agenthub/dummy_agent/agent.py#L100-L104)

## Choosing one

Set `default_agent` in the configuration to make an agent the default for every conversation. A conversation's own `agent` setting overrides it. The agent names are the ones in the registration lines above, so `CodeActAgent` is the default and `ReadOnlyAgent` is the name for the read-only variant.

Sources: [openhands/core/config/openhands_config.py:67](repo://openhands/core/config/openhands_config.py#L67), [openhands/server/session/session.py:142](repo://openhands/server/session/session.py#L142)

The shared step loop that calls any of these agents is described in [[Agent Controller]].

Sources: [openhands/controller/agent_controller.py:821-870](repo://openhands/controller/agent_controller.py#L821-L870)
