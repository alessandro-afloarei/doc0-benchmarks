---
type: concept
title: Agent loop and action lifecycle
description: Controller state transitions, CodeAct action generation, pending observations, delegation, control limits and error recovery.
tags: [agents, controller, actions, lifecycle]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:55:05.802Z
sources:
  - id: openwiki-source-f161159e8a959406ae10a085
    resource: repo://openhands/agenthub/codeact_agent/codeact_agent.py
  - id: openwiki-source-2129d0084f64a3f5714baf90
    resource: repo://openhands/controller/agent_controller.py
generated: { by: "codex", at: "2026-11-16T16:55:05.802Z" }
---

# Agent loop and action lifecycle

## Who decides what

`AgentController` owns scheduling, state transitions, pending actions, control limits and delegation. The agent owns the next decision. `CodeActAgent` assembles model messages and tool schemas, calls its LLM service and converts the response into actions. Runtime and memory subscribers perform execution and recall. This keeps model reasoning separate from action sequencing and environment effects.

## From message to observation

A user message creates a pending `RecallAction`: the first message requests workspace context; later messages request knowledge. Memory returns a causally linked recall or null observation before normal work continues. This prevents the model from racing ahead of repository context retrieval.

The controller records visible events in history, handles their state effects, and decides whether they should trigger a step. User messages, substantive observations and condensation events can trigger progress; state-change observations do not recursively step the agent. `_step` requires `RUNNING` state and no pending action, synchronizes spending, checks stuck detection and executes control flags before invoking the agent.

CodeAct drains any already-parsed pending actions before making another model call. Otherwise it asks the condenser for a history view or returns the required condensation action. It formats history, calls the model with tool schemas, converts the response into a queue of actions and returns one action. Multiple tool calls in one response therefore still flow through the controller's sequential pending-action lifecycle.

Runnable actions become pending and enter the event stream. An observation clears the pending action when its `cause` matches the action ID, subject to confirmation state. Tool-call metadata connects model tool requests to result messages. `AgentFinishAction` and `AgentRejectAction` store outputs and change state; an agent message with `wait_for_response` requests user input.

## Limits, confirmation and recovery

Iteration and budget flags enforce conversation limits, including delegated work. The iteration counter advances per controlled step; budget comes from accumulated service spending. Continuing from an error can expand limits through state-tracker policy, so interactive continuation and headless limits need separate tests.

Confirmation mode can mark selected runnable actions as awaiting confirmation before publication. Confirming or rejecting transitions the pending action, clears its old event ID and re-emits it as a new event. The runtime suppresses awaiting-confirmation actions and produces rejection feedback for rejected ones. See [configuration and security](../operations/configuration-and-deployment.md) for risk policy and the CLI-specific path.

Malformed or missing model actions produce error observations the agent can use on a later step. Recognized context-window errors request condensation when history truncation is enabled; otherwise they fail as context-limit errors. Fatal failures record a reason, publish status and change controller state. Reset on stop/error synthesizes missing tool-result feedback when necessary, clears the pending action and resets the agent, avoiding an incomplete tool exchange on continuation.

## Delegation and extension

A delegate shares the event stream, LLM registry, iteration flag, budget flag and global metrics with its parent. The parent forwards events to the active delegate instead of independently stepping. Completion emits `AgentDelegateObservation` with outputs or error information, closes the delegate and allows parent handling to resume. This is controller-managed delegation, not a separate server conversation.

Start with [agent_controller.py](../../openhands/controller/agent_controller.py), [CodeActAgent](../../openhands/agenthub/codeact_agent/codeact_agent.py) and [control_flags.py](../../openhands/controller/state/control_flags.py). Focused tests in `tests/unit/controller/` cover budgets, pending-action reset, context overflow, delegation and stuck detection. New actions also require serialization and runtime/frontend consumers.

Related: [events](../architecture/events-and-storage.md), [runtimes](../architecture/runtimes.md), [memory](memory-and-microagents.md), [models](models.md), [quickstart](../quickstart.md).
