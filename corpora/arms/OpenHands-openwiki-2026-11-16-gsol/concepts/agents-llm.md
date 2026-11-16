---
type: concept
title: Agents and language models
description: CodeAct decision flow, tool schemas, agent registration, conversation-scoped LLM services, retry behavior, and usage accounting.
tags: [agent, llm, tools, metrics]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:50:03.393Z
sources:
  - id: openwiki-source-f161159e8a959406ae10a085
    resource: repo://openhands/agenthub/codeact_agent/codeact_agent.py
  - id: openwiki-source-846d81305e1163067ac4815f
    resource: repo://openhands/llm/llm_registry.py
  - id: openwiki-source-30e374a20e6e9e785cf0d1b1
    resource: repo://openhands/llm/llm.py
  - id: openwiki-source-fb5e2382ea09f5d9eb14b2ad
    resource: repo://openhands/llm/retry_mixin.py
generated: { by: "codex", at: "2026-11-16T06:50:03.393Z" }
---

# Agents and language models

An agent produces an OpenHands action from controller State. Execution belongs to the runtime, state transitions and limits belong to the controller, and model transport belongs to the LLM layer. Keeping those responsibilities separate makes it possible to change agent prompting without changing sandbox execution.

## CodeAct decision flow

`CodeActAgent` is registered through its package initializer; importing `openhands.agenthub` loads the built-in agent packages and their registrations. The base Agent registry rejects duplicate names and raises for unregistered selections. An extension implements `step(state)`, declares any sandbox plugins, and registers a class under the configured agent name.

CodeAct constructs configured command, think, finish, browser, notebook, task-tracker, editor, and condensation tools. The selected editor switches between the LLM editor and the string-replacement editor. Browsing is omitted on Windows. Sandbox plugin ordering is explicit: agent skills initialize before Jupyter because Jupyter uses their Python functions.

A step proceeds as follows:

1. Return a previously queued action if the last model response contained several actions.
2. Interpret a latest user `/exit` message as finish.
3. Ask the configured condenser for a history view or a condensation action. A condensation action returns immediately to the controller.
4. Find the original user message in full history, then use ConversationMemory to format the condensed events, image handling, tool responses, and provider caching.
5. Call the selected LLM with messages, checked tool schemas, and conversation metadata.
6. Convert the response into typed actions, queue them, and return the first.

One provider completion can therefore drive several controller steps. CodeAct's queue and the controller's pending runnable action serve different purposes: the queue holds already-decoded model decisions; the controller waits for execution feedback.

## Tool conversion and context

`agenthub/codeact_agent/function_calling.py` parses tool argument JSON and validates required fields before constructing actions. For example, command tools require a command and can set a hard timeout; notebook tools require code. Invalid JSON or required arguments raise function-call validation errors, which the controller turns into feedback observations.

The base agent can record its system prompt, class, and tools in a SystemMessageAction. MCP discovery appends external tools before the controller records this message. Changes to tool names must agree across schema creation, response conversion, action serialization, runtime dispatch, and tests. See [MCP and providers](../integrations/tools-providers.md) and [events and state](events-state.md).

## LLM service ownership

Each conversation has an `LLMRegistry` with a copied configuration and services keyed by purpose, such as the main agent or a summarizer. `get_llm` reuses an existing service only with the same configuration; requesting that service ID with another configuration raises an error. `get_llm_from_agent_config` has a separate reuse path whose differing-config branch is currently a TODO, so callers should not assume it replaces an existing model.

CodeAct asks the registry for a router. The noop router returns the main agent LLM directly; other routing configurations construct a RouterLLM. The underlying synchronous LLM wraps LiteLLM completion with configured credentials, URL, provider, timeout, parameter adaptation, capability detection, and response conversion. Native function calling, vision, and prompt caching depend on both model capabilities and configuration.

## Retries, metrics, and debugging

Configured retry handling covers connection, rate-limit, service-unavailable, timeout, internal-server, and empty-response errors. Tenacity applies exponential waits, stops at the attempt limit or shutdown, and reraises the failure. A retry listener can notify the UI. On an empty response at zero temperature, retry handling changes the next attempt's temperature to 1.0.

The wrapper records response latency, cost, token usage, cache reads/writes, and context-window information when available. ConversationStats subscribes to registry creation events, attaches/restores per-service metrics, and supplies combined metrics to controller budget tracking and UI reporting. A missing cost estimate should be investigated in the LLM accounting layer rather than inferred from displayed token counts.

Completion logging requires an output folder and records model inputs and outputs. Use [configuration guidance](../operations/configuration.md) when enabling diagnostics. Relevant tests include `tests/unit/agenthub/test_function_calling.py`, `test_prompt_caching.py`, `tests/unit/llm/test_llm.py`, `test_api_connection_error_retry.py`, and `tests/unit/test_llm_registry.py`. For context-size problems continue to [memory and condensation](memory.md).
