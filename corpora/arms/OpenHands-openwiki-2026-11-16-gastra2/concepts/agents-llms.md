---
type: concept
title: Agent control and LLM services
description: CodeAct inference, tool translation, controller transitions, budgets, retries, delegation, and LLM registry ownership.
tags: [agents, llm, controller, tools, budgets]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:43:51.947Z
sources:
  - id: openwiki-source-f161159e8a959406ae10a085
    resource: repo://openhands/agenthub/codeact_agent/codeact_agent.py
  - id: openwiki-source-2129d0084f64a3f5714baf90
    resource: repo://openhands/controller/agent_controller.py
  - id: openwiki-source-846d81305e1163067ac4815f
    resource: repo://openhands/llm/llm_registry.py
  - id: openwiki-source-fb5e2382ea09f5d9eb14b2ad
    resource: repo://openhands/llm/retry_mixin.py
  - id: openwiki-source-20a5ae5721db1ed6dfb11d0d
    resource: repo://openhands/llm/router/rule_based/impl.py
generated: { by: "codex", at: "2026-11-16T17:43:51.947Z" }
---

# Agent control and LLM services

An `Agent` chooses the next action from controller state. It does not own the execution loop or sandbox. The controller enforces lifecycle and progress constraints; runtime implementations perform actions; LLM services handle provider calls and usage metrics.

## CodeAct inference

CodeAct builds enabled tools from `AgentConfig`: commands, thought and finish tools, browser, Jupyter, task tracking, and editor variants. The prompt manager loads its system template, conversation memory translates history, and the configured condenser determines which events reach the model. MCP discovery augments the tool set before normal execution.

One model response can contain multiple actions. `step` drains `pending_actions` before making another LLM request. Otherwise it handles `/exit`, asks the condenser for a history view or a condensation action, builds messages, supplies tools and session metadata, and translates the response into queued actions. Function-call conversion attaches metadata needed to pair subsequent tool results with the original model call. Adding a tool requires both a tool schema and a response-to-action translation, followed by runtime support or MCP dispatch.

## Controller invariants and transitions

The controller steps only while `RUNNING` and without a pending action. It synchronizes budget metrics, checks for repeated behavior, and runs control flags before inference. Matching observations clear pending work by comparing their cause with the action ID, except while awaiting confirmation.

State changes emit `AgentStateChangedObservation` and save controller state. `AgentFinishAction` stores outputs and enters `FINISHED`; rejection enters `REJECTED`. Confirmation marks a pending action confirmed or rejected, clears its old event ID, and re-emits it so runtime dispatch can act on the new decision. CLI confirmation has dedicated behavior in the controller and CLI layers; do not assume all frontends share the same confirmation interaction.

Iteration limits count steps, while budget values come from accumulated model metrics. Limit failures enter controller exception handling. Interactive continuation can expand limits through the state tracker; this is not a hard provider-side spending cap. Delegates share iteration/budget flags and metrics with the parent, receive a deeper state scope, and use the same event stream and LLM registry. A delegate controller is created without a separate direct stream subscription.

## LLM ownership and model routing

`LLMRegistry` keeps service-ID-to-LLM mappings and notifies a subscriber when services are created. This lets agent, condenser, and auxiliary requests participate in conversation statistics. `get_llm` rejects reuse of an existing service ID with a different configuration. The agent-specific accessor currently returns an existing service even if its configuration differs, with an explicit TODO in source; code that needs a distinct model should use a distinct service ID instead of relying on implicit reconfiguration.

CodeAct obtains its model through `get_router`. `noop_router` returns the agent LLM directly. The rule-based multimodal router selects a secondary model for ordinary messages and the primary model for image-bearing input or after the secondary token limit is exceeded. Router configuration and model capability checks should be examined alongside tool and vision settings when diagnosing unexpected model selection.

The synchronous `LLM` wraps LiteLLM completion with provider configuration, feature compatibility handling, retry logic, and post-completion accounting. Async and streaming variants are neighboring implementations; a change to provider behavior may require checking those paths too.

## Failures and recovery

Retry policy applies only to selected exception classes and uses configurable exponential waits, attempt limits, and shutdown cancellation. Retry listeners expose progress to callers. A no-response retry can change a zero or unspecified temperature to 1.0 for the next attempt. Retrying a model request is separate from retrying a command in the sandbox.

Malformed actions, missing actions, and tool validation failures can become `ErrorObservation` feedback. Recognized context-window errors request condensation if history truncation is enabled; otherwise they become a context-window failure. Unrecognized provider errors propagate into controller exception handling. Check the emitted event and `last_error` to distinguish malformed output, exhausted context, provider failure, and a runtime problem.

## Extension and tests

Register agent subclasses through the agent registry and preserve the `step(State) -> Action` contract. Prefer existing action semantics so history, confirmation, runtime dispatch, and UI rendering remain compatible. Test tool conversion in `tests/unit/agenthub/test_function_calling.py`, limits and recovery in `tests/unit/controller/test_agent_controller.py`, delegation in `test_agent_delegation.py`, and service ownership in `tests/unit/test_llm_registry.py`.

See [memory](memory.md), [runtime execution](../architecture/runtime.md), and [validation workflows](../testing/validation.md).
