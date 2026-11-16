---
title: "Agents"
---
## Overview

An agent takes the controller's `State` and returns one `Action`. Every agent is a subclass of `Agent`, and each one is registered under a name so that the configuration can select it. `CodeActAgent` is the general-purpose agent. The other agents in `openhands/agenthub` either extend it with a narrower tool set or a different response parser, or are separate classes for browsing and for tests.

Sources: [openhands/controller/agent.py:25-40](repo://openhands/controller/agent.py#L25-L40) [openhands/agenthub/codeact_agent/codeact_agent.py:49-78](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L49-L78)

## The agent contract

`Agent.step(state)` is the one method an agent must implement. It returns an `Action`, and the controller raises `LLMNoActionError` when the agent returns `None`. An agent's name is the name of its class, so a `ReadOnlyAgent` is looked up as `ReadOnlyAgent`.

Sources: [openhands/controller/agent.py:105-108](repo://openhands/controller/agent.py#L105-L108) [openhands/controller/agent.py:116-119](repo://openhands/controller/agent.py#L116-L119) [openhands/controller/agent_controller.py:870-872](repo://openhands/controller/agent_controller.py#L870-L872)

`Agent.register` stores a class under a name and refuses a name that is already taken, so two agents cannot share one name. `get_cls` looks the class up again by that name.

Sources: [openhands/controller/agent.py:121-134](repo://openhands/controller/agent.py#L121-L134) [openhands/controller/agent.py:136-150](repo://openhands/controller/agent.py#L136-L150)

`openhands/agenthub/__init__.py` imports each agent module, so every built-in agent is registered when the package is imported. The package also lists the agent modules in `__all__`.

Sources: [openhands/agenthub/__init__.py:1-24](repo://openhands/agenthub/__init__.py#L1-L24)

## CodeAct construction

`CodeActAgent.__init__` calls the base constructor, creates an empty queue for pending actions, builds the tool list, and creates a `ConversationMemory` that formats the history for the model. It then builds the condenser from the agent configuration and asks the LLM registry for a router in place of a plain LLM.

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:78-96](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L78-L96)

## CodeAct step

`step` returns queued actions first. If the queue is empty, a latest user message of `/exit` returns an `AgentFinishAction` without calling the model.

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:182-190](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L182-L190)

Next it asks the condenser for a view of the history. A `View` supplies the events for the prompt. A `Condensation` is returned as the action itself, and the code comment says the controller then asks the agent to step again with the new view. See [[Condenser Strategies]].

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:196-205](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L196-L205)

For a view, the step finds the initial user message in the full history, builds the messages, checks the tools against the model, and calls the LLM. The response is parsed into actions. All of them are appended to the queue, and the first is returned. The remaining actions come out on later steps.

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:207-224](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L207-L224)

`_get_tools` chooses a shorter tool description when the model name contains one of `gpt-4`, `o3`, `o1` or `o4`. The comment gives the reason: the older OpenAI limit on function description length.

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:108-125](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L108-L125)

## The other agents

| Agent | Base | What it does |
| --- | --- | --- |
| `ReadOnlyAgent` | `CodeActAgent` | Restricts the tools to read-only ones: grep, glob, view, think, finish and web read |
| `LocAgent` | `CodeActAgent` | Has its own constructor and overrides the response parser |
| `BrowsingAgent` | `Agent` | Interacts with the browser |
| `VisualBrowsingAgent` | `Agent` | Browser agent in its visual variant |
| `DummyAgent` | `Agent` | Sends a fixed sequence of actions with no model call, for end-to-end tests |

Sources: [openhands/agenthub/readonly_agent/readonly_agent.py:23-32](repo://openhands/agenthub/readonly_agent/readonly_agent.py#L23-L32) [openhands/agenthub/loc_agent/loc_agent.py:14-36](repo://openhands/agenthub/loc_agent/loc_agent.py#L14-L36) [openhands/agenthub/browsing_agent/browsing_agent.py:94-98](repo://openhands/agenthub/browsing_agent/browsing_agent.py#L94-L98) [openhands/agenthub/visualbrowsing_agent/visualbrowsing_agent.py:121](repo://openhands/agenthub/visualbrowsing_agent/visualbrowsing_agent.py#L121) [openhands/agenthub/dummy_agent/agent.py:38-44](repo://openhands/agenthub/dummy_agent/agent.py#L38-L44)
