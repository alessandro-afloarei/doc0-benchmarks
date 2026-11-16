---
type: architecture
title: Agent control and CodeAct
description: How AgentController schedules CodeAct steps, correlates runtime observations, enforces limits, and handles confirmation, delegation, and recovery.
tags: [agents, controller, codeact, lifecycle]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T08:14:39.912Z
sources:
  - id: openwiki-source-f161159e8a959406ae10a085
    resource: repo://openhands/agenthub/codeact_agent/codeact_agent.py
  - id: openwiki-source-2129d0084f64a3f5714baf90
    resource: repo://openhands/controller/agent_controller.py
  - id: openwiki-source-5b8090ec7ff0b1fd244a0d7c
    resource: repo://tests/unit/controller/test_agent_controller.py
generated: { by: "codex", at: "2026-11-16T08:14:39.912Z" }
---

# Agent control and CodeAct

An agent chooses an action; `AgentController` decides when it may choose the next one. The controller owns the task's `State`, subscribes to the event stream, updates history through its state tracker, and emits actions and state-change observations. Execution belongs to the [runtime](runtime.md), while [events and storage](events-storage.md) provide the communication and persistence boundary.

## One step through the controller

1. A visible event reaches `_on_event`, enters state history, and is handled as an action or observation.
2. `should_step` selects triggers such as a user message, a substantive observation, or condensation. State-change observations do not themselves trigger another step, and an active delegate suppresses parent stepping.
3. `_step` requires `RUNNING` and no pending action. It synchronizes model spending into the budget flag, checks for loops, and runs the iteration/budget control flags.
4. Replay supplies the next recorded action when enabled; otherwise `agent.step(state)` chooses it.
5. Runnable actions become pending. Non-null actions are published with metrics. The runtime later attaches the action ID as the observation's `cause`.
6. A matching observation clears the pending action, except while the controller still awaits user confirmation.

The pending-action barrier prevents the controller from issuing another runnable step before the expected result. A stall can therefore arise from an unmatched cause ID, a disconnected runtime, or a confirmation state as well as from a model request. Inspect the pending action and latest events before treating it as an LLM problem.

## CodeAct's model boundary

`CodeActAgent` maintains a deque of actions parsed from a model response. It drains that deque before making another completion. A last user message of `/exit` produces an `AgentFinishAction`.

For a new completion, the condenser returns either a history `View` or a condensation action. CodeAct returns a condensation action immediately so the controller can process it before another model call. With a view, CodeAct constructs messages, supplies its enabled tool definitions, calls the LLM, and queues parsed actions. Thus one completion can yield several sequential controller steps.

Tool configuration determines whether command, thinking, finish, browser, Jupyter, planning, and editor tools are exposed. MCP tool enrichment happens during session startup. See [LLMs and memory](../concepts/llm-memory.md) for context assembly and condensation.

## State changes and confirmation

Finish and reject actions copy their outputs into state and move to `FINISHED` or `REJECTED`. `set_agent_state_to` updates state, performs transition side effects, emits `AgentStateChangedObservation`, and saves state. Entering `STOPPED` or `ERROR` resets agent execution state.

Confirmation applies to a specific set of runnable action types: command, IPython, interactive browser, file edit, and file read. In confirmation mode, the controller runs risk analysis where available. High-risk actions, or unknown-risk actions with no analyzer, can require approval; CLI mode has a separate confirmation path. Do not assume confirmation mode intercepts every possible action type.

On user confirmation or rejection, the pending action's confirmation status changes and its event ID is cleared before republishing it. The resulting observation completes that exchange. Rejection returns the controller to awaiting input.

## Limits, failures, and delegates

Control-limit failures enter the controller's error handling. Returning from `ERROR` to `RUNNING` can increase limits for an interactive session; headless runs do not receive the same automatic extension. The focused controller tests exercise both behaviors and budget exhaustion.

Malformed/no-action responses and tool validation errors become `ErrorObservation` feedback. Recognized context-window failures produce `CondensationRequestAction` when history truncation is enabled; otherwise they raise the context-limit error. Other model and runtime failures have their own error handling rather than sharing one universal retry loop.

Delegation creates another agent/controller using the shared LLM registry, iteration flag, budget flag, and task metrics. The parent forwards events to the active delegate and resumes through delegate completion handling. Delegation therefore does not give a child an independent task budget.

## Where to change and verify behavior

- Scheduling, transitions, pending-action handling: `openhands/controller/agent_controller.py`.
- Tool selection and completion-to-action conversion: `openhands/agenthub/codeact_agent/codeact_agent.py` and neighboring tools/response conversion code.
- Budget and iteration accounting: `openhands/controller/state/`.
- Focused checks: `tests/unit/controller/test_agent_controller.py`, `test_agent_delegation.py`, `test_is_stuck.py`, and `tests/unit/controller/state/`.

When adding an action, trace serialization, runtime dispatch, observation causality, confirmation behavior, and frontend handling together.
