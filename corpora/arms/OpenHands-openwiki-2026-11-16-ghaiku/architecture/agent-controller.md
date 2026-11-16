---
type: architecture
title: Agent Controller and Step Loop
description: How AgentController turns events into agent steps, gates each step on agent state, limits and stuck detection, and handles finish, error, and delegate paths.
tags: [agent-controller, agent-loop, state-machine, delegation, stuck-detection]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T11:08:31.416Z
sources:
  - id: openwiki-source-2129d0084f64a3f5714baf90
    resource: repo://openhands/controller/agent_controller.py
  - id: openwiki-source-6facf31398d774ea044a5a65
    resource: repo://openhands/controller/stuck.py
generated: { by: "claude-code", at: "2026-11-16T11:08:31.416Z" }
---

# Agent Controller and Step Loop

`AgentController` (`openhands/controller/agent_controller.py`) is the component that drives an
agent. It subscribes to the conversation's event stream, decides when the agent may take a step,
forwards the agent's actions to the runtime through the event stream, and moves the conversation
through its `AgentState` lifecycle. It does not execute actions itself; execution is performed by
the runtime that consumes the action events (see [Runtime](runtime.md)).

## Responsibilities

- Owns the agent instance, the `State` object (`openhands/controller/state/state.py`), and a
  `StateTracker` that persists history and checks control limits.
- Decides when to call `agent.step(state)` by inspecting incoming events.
- Converts agent outputs into events and reacts to events produced by the runtime.
- Sets the conversation's `AgentState` and emits an `AgentStateChangedObservation` for every
  change, then persists the state.
- Creates and supervises **delegate** controllers for sub-tasks.

## Entry and scheduling

A controller is created per conversation and wired to an `EventStream`. Incoming events reach it
through `on_event`, which either forwards the event to an active delegate or calls `_on_event`
(`agent_controller.py:433`). `_on_event` records the event in history, dispatches actions to
`_handle_action` or observations to `_handle_observation`, and then consults `should_step`
(`agent_controller.py:392`).

`should_step` is deliberately narrow. The agent steps after:

- a `MessageAction` from the user;
- a non-state-change `Observation` (for example, command output after a runnable action);
- an `AgentDelegateAction`, `CondensationAction`, or `CondensationRequestAction`;
- a `NullObservation` whose `cause` is positive (a recall result).

It does **not** step after `AgentStateChangedObservation`, plain `NullObservation`, or while a
delegate is active (`should_step` returns `False` whenever `self.delegate` is set).

`step()` only schedules work: it creates an `asyncio` task running
`_step_with_exception_handling` (`agent_controller.py:358-361`). That wrapper runs `_step` and maps
exceptions to a user-visible error, re-raising known LLM/provider error types and converting
anything else to a generic `RuntimeError` before calling `_react_to_exception`.

## The `_step` gate sequence

`_step` (`agent_controller.py:821`) applies these checks in order. If any fails, the call returns
without producing an action:

1. **State gate.** If the agent state is not `RUNNING`, the step is blocked
   (`agent_controller.py:822-830`).
2. **Pending-action gate.** If an action is already waiting for confirmation or execution in
   `_pending_action`, the step is blocked. This is what keeps the agent from issuing a second action
   before the first resolves (`agent_controller.py:832-840`).
3. **Stuck gate.** `_is_stuck()` checks the delegate chain and then the `StuckDetector`
   (`agent_controller.py:1067`). A stuck agent is moved to `ERROR` with `AgentStuckInLoopError`.
4. **Control-flag gate.** `run_control_flags()` advances the iteration counter and the budget flag.
   Hitting `max_iterations` or `max_budget_per_task` raises through `_react_to_exception`
   (`agent_controller.py:855-860`).

Only after these gates does the controller call `self.agent.step(self.state)`, or substitutes a
replayed action when a `ReplayManager` is active (`agent_controller.py:864-870`).

## Handling agent failures

Errors from `agent.step` are split by type:

- **Recoverable model-output errors** (`LLMMalformedActionError`, `LLMNoActionError`,
  `LLMResponseError`, `FunctionCallValidationError`, `FunctionCallNotExistsError`) are not fatal.
  The controller records an `ErrorObservation` (`agent_controller.py:882`) so the model can see the
  problem on its next step.
- **Context-window overflow** from `ContextWindowExceededError`, `BadRequestError`, or `OpenAIError`
  is detected by inspecting the error text as well as the type (provider wrappers do not
  consistently use one class). If history truncation is enabled, the controller emits a
  `CondensationRequestAction` and returns (`agent_controller.py:911`). Otherwise it raises
  `LLMContextWindowExceedError` (`agent_controller.py:915`). See
  [Memory and Condensation](../workflows/memory-and-condensation.md).
- Anything else is re-raised to `_step_with_exception_handling`.

`_react_to_exception` stores a short reason in `state.last_error`, maps the error to a
`RuntimeStatus` when a status callback is set (for example authentication, service unavailable,
out of credits), and moves the agent to `ERROR`.

## State machine

`AgentState` (`openhands/core/schema/agent.py`) includes `LOADING`, `RUNNING`,
`AWAITING_USER_INPUT`, `PAUSED`, `STOPPED`, `FINISHED`, `REJECTED`, `ERROR`,
`AWAITING_USER_CONFIRMATION`, `USER_CONFIRMED`, `USER_REJECTED`, and `RATE_LIMITED`, which
the controller uses when a provider rate-limits a call (`agent_controller.py:348-356`).

`set_agent_state_to` (`agent_controller.py:631`) is the only mutation point:

- it returns early if the state is unchanged;
- on `STOPPED` or `ERROR` it calls `_reset()` (which clears pending state);
- when leaving `ERROR` for `RUNNING` it relaxes control-flag limits through
  `maybe_increase_control_flags_limits`, so a user who resumes after hitting a limit is not
  immediately stopped again (`agent_controller.py:649`);
- when confirming or rejecting a pending high-risk action, it stamps the confirmation status on the
  pending action and writes it to the event stream;
- it emits an `AgentStateChangedObservation` (`agent_controller.py:677`) and then calls
  `save_state()` (`agent_controller.py:683`).

Terminal actions are handled in `_handle_action` (`agent_controller.py:494`). An
`AgentFinishAction` stores its outputs and sets `FINISHED` (`agent_controller.py:512-514`); an
`AgentRejectAction` sets `REJECTED`. A `ChangeAgentStateAction` lets the agent or a tool request a
state change directly.

## Stuck detection

`StuckDetector` (`openhands/controller/stuck.py`) inspects the recent history rather than a
counter. It needs at least three non-user, non-null events (`stuck.py:70`) before it reports a
loop. It examines the last few actions and observations and recognizes repeated action/observation
pairs, repeated erroring actions, a monologue pattern, an action-observation cycle, and repeated
context-window errors (`stuck.py:112-336`).

The `headless_mode` flag changes the scope. In headless mode the whole history counts. In
interactive mode only events after the last user message are considered, so a user who redirects
the agent starts with a clean slate.

## Delegation

An `AgentDelegateAction` makes the controller call `start_delegate` (`agent_controller.py:693`).
The delegate is a new `AgentController` with `is_delegate=True`, a `State` that inherits the
parent's iteration and budget flags and shared metrics, and the same `EventStream`
(`agent_controller.py:737`). While it is active:

- `on_event` forwards events to the delegate instead of the parent (`agent_controller.py:433-465`);
- the parent's `should_step` returns `False`;
- when the delegate finishes, errors, or is rejected, `end_delegate` clears `self.delegate` and
  returns an observation to the parent (`agent_controller.py:819`).

Delegation is depth-tracked through `state.delegate_level`. Stuck detection recurses into the
delegate chain (`_is_stuck`, `agent_controller.py:1067`); iteration and budget flags are shared with
the delegate through the inherited `State`.

## Lifecycle, persistence, and failure semantics

- `run_controller` in `openhands/core/main.py` creates the controller and drives it with
  `run_agent_until_done` (`openhands/core/loop.py`), which polls state until a terminal state in
  `end_states` is reached.
- `close()` (`agent_controller.py:270`) stops the controller; the parent passes
  `set_stop_state=False` on normal completion so `FINISHED` is not overwritten.
- Because `save_state()` runs on every state change, a crash leaves the last state change on disk
  and conversations can resume from it.
- Confirmation mode is enforced here, not by the runtime. When `confirmation_mode` is on, for
  `CmdRunAction`, `IPythonRunCellAction`, `BrowseInteractiveAction`, `FileEditAction`, and
  `FileReadAction`, the controller calls the security analyzer (`_handle_security_analyzer`,
  `agent_controller.py:204`) and marks the action `AWAITING_CONFIRMATION` when the risk is `HIGH`,
  or when risk is unknown and no analyzer is configured (`agent_controller.py:920-958`). CLI mode
  always marks the action for confirmation. See [Security Model](../operations/security.md).

## Extension seams

- New agents implement `Agent.step` (see [Agents and Tools](agents-and-tools.md)); the controller
  is agent-agnostic.
- New stuck patterns are added as methods on `StuckDetector` and wired into `is_stuck`.
- New error classes that should surface to the user must be added to the isinstance list in
  `_step_with_exception_handling`; otherwise they are reported as a generic runtime error.

## Related tests

`tests/unit/controller/test_agent_controller.py` covers the controller loop,
`test_agent_delegation.py` covers delegate start and end, and `test_is_stuck.py` covers stuck
detection. Start there when changing the loop.

## Related pages

- [Event Model and Event Stream](event-stream.md)
- [Agents, Tools, and Microagents](agents-and-tools.md)
- [Runtime Abstraction and Execution Backends](runtime.md)
- [Conversation Lifecycle End to End](../workflows/conversation-lifecycle.md)
