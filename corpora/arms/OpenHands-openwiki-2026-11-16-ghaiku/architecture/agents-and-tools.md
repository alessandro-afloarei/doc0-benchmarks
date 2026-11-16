---
type: architecture
title: Agents, Tools, and Microagents
description: How agents are registered and selected by name, how the CodeAct agent turns model output into actions through its tool set and pending queue, and how microagent prompts are loaded and classified.
tags: [agents, codeact, tools, function-calling, microagents, prompts]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T11:08:31.416Z
sources:
  - id: openwiki-source-c91073c920feafcf0f56f619
    resource: repo://openhands/agenthub/codeact_agent/__init__.py
  - id: openwiki-source-f161159e8a959406ae10a085
    resource: repo://openhands/agenthub/codeact_agent/codeact_agent.py
  - id: openwiki-source-2e7cf1ee6ccb20d38552bf97
    resource: repo://openhands/agenthub/codeact_agent/function_calling.py
  - id: openwiki-source-44f2545083aa1045beab5794
    resource: repo://openhands/controller/agent.py
  - id: openwiki-source-2f6d01b1cfbe089e047df04a
    resource: repo://openhands/critic/finish_critic.py
  - id: openwiki-source-5d8f5c2af56a4fade5c982a8
    resource: repo://openhands/microagent/microagent.py
generated: { by: "claude-code", at: "2026-11-16T11:08:31.416Z" }
---

# Agents, Tools, and Microagents

An **agent** in OpenHands is a policy that maps the current `State` to one `Action`. The
controller calls `agent.step(state)` and then routes the result through the event stream (see
[Agent Controller and Step Loop](agent-controller.md)). Agents do not run commands themselves; the
runtime does (see [Runtime](runtime.md)). Agent implementations live in `openhands/agenthub/`, and
the shared interface lives in `openhands/controller/agent.py`.

## Registry and selection

`Agent` keeps a class-level registry, `Agent._registry` (`openhands/controller/agent.py:34`).
Each built-in agent registers itself when its package is imported, for example
`Agent.register('CodeActAgent', CodeActAgent)` in `openhands/agenthub/codeact_agent/__init__.py`.
`openhands/agenthub/__init__.py` imports all built-in agent packages so the registry is populated.

`Agent.get_cls(name)` looks up a class by name and `Agent.list_agents()` lists the registered names
(`agent.py:136-161`). Custom agents register through the same mechanism; `openhands/core/config/utils.py`
calls `Agent.register` for agent names it loads from configuration (around line 809).

Built-in agents, as found in `openhands/agenthub/`:

| Name | Base | Purpose |
| --- | --- | --- |
| `CodeActAgent` | `Agent` | Default general-purpose coding agent with a tool set (commands, editor, browser, IPython, finish, think, condensation request, task tracker). |
| `ReadOnlyAgent` | `CodeActAgent` | CodeAct restricted to inspection tools (`glob`, `grep`, `view`). |
| `LocAgent` | `CodeActAgent` | CodeAct variant with repository exploration tools (`explore_structure`, `search_content`). |
| `BrowsingAgent` | `Agent` | Browser-driven agent that parses structured browser responses. |
| `VisualBrowsingAgent` | `Agent` | Browser agent that reasons over page screenshots and set-of-marks overlays. |
| `DummyAgent` | `Agent` | Scripted agent (`openhands/agenthub/dummy_agent/agent.py`).

## The `Agent` interface

Every agent is constructed with an `AgentConfig` and an `LLMRegistry`. The base constructor asks the
registry for the agent's LLM (`agent.py:40-46`). Subclasses implement:

- `step(state) -> Action`: the decision function, called by the controller;
- `reset()`: clears per-task completion state. The base implementation only resets `_complete`, not
  LLM metrics (`agent.py:111-115`);
- `set_mcp_tools(...)`: receives MCP tool definitions discovered from the runtime
  (`agent.py:163`).

Agents report completion through an `AgentFinishAction` or by being marked complete. The controller
treats `AgentFinishAction` as the normal end of a task (see the controller page).

## CodeAct: from model output to actions

`CodeActAgent.__init__` (`openhands/agenthub/codeact_agent/codeact_agent.py:78`) builds four things:

- a `deque` of pending actions;
- the tool list from `_get_tools()` (`codeact_agent.py:108`), gated by `AgentConfig` flags such as
  `enable_cmd`, `enable_think`, `enable_finish`, `enable_browsing`, `enable_jupyter`,
  `enable_plan_mode`, `enable_llm_editor`, `enable_editor`, and `enable_condensation_request`
  (`openhands/core/config/agent_config.py`);
- a `ConversationMemory` that renders events into LLM messages;
- a `Condenser` built from `config.condenser`, and an LLM that may be replaced by a router
  (`llm_registry.get_router`) when model routing is configured.

Shorter tool descriptions are used for GPT-4, o-series, and related model names, to stay within
per-function description limits (`codeact_agent.py:111-124`).

`step` (`codeact_agent.py:160`) works in this order:

1. If the pending queue is non-empty, pop and return the next action. One model response can
   therefore yield several actions, which the controller consumes one step at a time.
2. A last user message of `/exit` returns `AgentFinishAction`.
3. The condenser inspects the state. It either returns a `View` of events to send, or a
   `Condensation` action that the controller must process before the agent is asked again
   (`codeact_agent.py:195-201`). See [Memory, Context Condensation, and Conversation Memory](../workflows/memory-and-condensation.md).
4. The initial user message is located (a missing one raises `ValueError`), and messages are built
   from the condensed history (`codeact_agent.py:207-208`).
5. The model is called with the tool list after `check_tools` adjusts it for the model. Metadata
   is attached through `state.to_llm_metadata`.
6. `response_to_actions` converts the model response, including function calls, into `Action`
   objects. For MCP tools it is given the MCP tool names so it can map calls to `MCPAction`
   (`codeact_agent.py:295-298`). The results are queued and the first is returned.

Non-native function-calling models are handled by `openhands/llm/fn_call_converter.py`
(see [LLM Layer](llm-layer.md)).

## Tools

Tool definitions live in `openhands/agenthub/codeact_agent/tools/` as OpenAI-style schemas: `bash.py`
(command execution), `str_replace_editor.py` (ACI-style editing), `llm_based_edit.py` (deprecated
LLM-based editing), `browser.py`, `ipython.py`, `think.py`, `finish.py`, `condensation_request.py`,
`task_tracker.py`, and `prompt.py`. `security_utils.py` is imported by several tool schema modules (bash, browser, IPython,
editor, LLM-based edit), and `function_calling.py` sets the security risk on each action via
`set_security_risk`. The tool names are the contract between the model and
`function_calling.py`, which maps each call to an event class in `openhands/events/action`.

## Microagents

Microagents are markdown files that inject expert guidance or task workflows into the prompt.
`openhands/microagent/microagent.py` defines three pydantic classes:

- `KnowledgeMicroagent`: has `triggers`; its content is added when a message matches a trigger;
- `RepoMicroagent`: has no triggers, so it is always active for the repository;
- `TaskMicroagent`: has `inputs` and asks the user for variables before running.

`BaseMicroagent.load` infers the kind when no explicit `type` is given: `inputs` means task,
`triggers` means knowledge, and otherwise repository (`microagent.py:120-170`). Directory loading
goes through `load_microagents_from_dir`, which also reads repository-root instruction files such
as `.cursorrules` and `AGENTS.md` (`microagent.py:277-305`).

The shared microagents in `microagents/` in this repository are general-purpose skills such as
`github.md`, `docker.md`, `code-review.md`, `update_test.md`, and `address_pr_comments.md`. See
`microagents/README.md` for the two sources (shared and per-repository).

## Critic

`openhands/critic/` contains `BaseCritic` and `AgentFinishedCritic`, a rule-based evaluator that
checks whether the last event is an `AgentFinishAction`. A search of the source found no caller
outside the `critic` package, so it is available for evaluation harnesses but is not wired into the
controller loop.

## Extension seams

- **New agent:** subclass `Agent` (or `CodeActAgent` to reuse prompt and tool plumbing), implement
  `step`, and call `Agent.register`. Select it with the agent name in configuration.
- **New tool:** add a schema under `tools/`, add an enable flag in `AgentConfig`, include it in
  `_get_tools`, and map its calls in `function_calling.py`.
- **New microagent:** add a markdown file with front matter to `microagents/` or to a repository's
  `.openhands/microagents/`.

## Tests

`tests/unit/agenthub/test_agents.py` covers agent behavior, `test_function_calling.py` covers
function-call conversion, and `test_prompt_caching.py` covers prompt caching. Microagent parsing is
covered under `tests/unit/microagent/`.
