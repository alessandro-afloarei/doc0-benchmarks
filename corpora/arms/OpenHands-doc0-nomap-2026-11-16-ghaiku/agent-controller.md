---
title: "Agent Controller"
---
## Overview

`AgentController` runs the loop for one agent. It subscribes to the event stream, and each event either updates the controller's history or triggers a step of the agent. A step asks the agent for one action, checks the guards, and writes the action to the stream. The action runs in the runtime, and its observation comes back through the same stream. The loop stops when the agent finishes, the user stops it, an error is raised, or a limit is reached.

Sources: [openhands/controller/agent_controller.py:100-115](repo://openhands/controller/agent_controller.py#L100-L115), [openhands/controller/agent_controller.py:467-492](repo://openhands/controller/agent_controller.py#L467-L492)

The controller holds the agent, the event stream, the `State` and a `StuckDetector`. It takes its iteration and per-task budget limits when it is built, and it keeps those initial values on the instance.

Sources: [openhands/controller/agent_controller.py:177-190](repo://openhands/controller/agent_controller.py#L177-L190)

## Deciding when to step

`should_step` decides whether an event causes a step. A step runs after a user message, after an observation, after a delegate action and after a condensation event. A step does not run after an agent message while the state is `AWAITING_USER_INPUT`, and it does not run after a state-change observation. A `NullObservation` triggers a step only when it answers a recall action.

Sources: [openhands/controller/agent_controller.py:392-431](repo://openhands/controller/agent_controller.py#L392-L431)

`on_event` is the callback the stream calls. While a delegate is running, it forwards the event to the delegate and stops there. A finished or errored delegate is ended first. With no delegate, it calls `_on_event` in the event loop.

Sources: [openhands/controller/agent_controller.py:433-465](repo://openhands/controller/agent_controller.py#L433-L465)

`_on_event` first adds the event to the state's history, then dispatches it. An action goes to `_handle_action` and an observation to `_handle_observation`. The step runs last, if `should_step` says so. Events marked `hidden` are dropped before any of this.

Sources: [openhands/controller/agent_controller.py:467-492](repo://openhands/controller/agent_controller.py#L467-L492)

`_handle_action` changes state for the actions that do: a `ChangeAgentStateAction` sets the state, and `AgentFinishAction` and `AgentRejectAction` set `FINISHED` and `REJECTED` and save their outputs. An `AgentDelegateAction` starts a delegate and posts the task as a user message.

Sources: [openhands/controller/agent_controller.py:494-517](repo://openhands/controller/agent_controller.py#L494-L517)

`_handle_observation` clears the pending action when the observation's cause matches it. If the action was waiting for confirmation, the observation is ignored. If the user confirmed, the state goes back to `RUNNING`. If the user rejected, it goes to `AWAITING_USER_INPUT`.

Sources: [openhands/controller/agent_controller.py:519-547](repo://openhands/controller/agent_controller.py#L519-L547)

## Guards before a step

`_step` runs only in the `RUNNING` state. It returns early when a pending action is still open, so the agent never has two actions in flight.

Sources: [openhands/controller/agent_controller.py:821-840](repo://openhands/controller/agent_controller.py#L821-L840)

It then checks for a stuck agent. If the stuck detector fires, the controller raises `AgentStuckInLoopError` through the error path. Next the control flags run: the iteration counter always steps, and the budget flag steps when there is one. The budget flag first syncs with the accumulated cost from all LLM services.

Sources: [openhands/controller/agent_controller.py:849-860](repo://openhands/controller/agent_controller.py#L849-L860), [openhands/controller/state/state_tracker.py:254-268](repo://openhands/controller/state/state_tracker.py#L254-L268)

A replay of a saved trajectory replaces the agent call. Otherwise `agent.step(state)` runs. A `None` result is an error.

Sources: [openhands/controller/agent_controller.py:864-880](repo://openhands/controller/agent_controller.py#L864-L880)

Malformed model output, a missing action, or an invalid function call becomes an `ErrorObservation` for the agent, and the loop continues. A context-window error becomes a `CondensationRequestAction` when history truncation is enabled, and otherwise raises `LLMContextWindowExceedError`. Any other error is re-raised to the exception handler.

Sources: [openhands/controller/agent_controller.py:880-918](repo://openhands/controller/agent_controller.py#L880-L918)

## Confirmation and emitting actions

For a runnable action, the controller checks confirmation mode. In that mode, only command, IPython, interactive browse, file edit and file read actions are checked. Each one passes through the security analyzer. A `HIGH` risk, or an `UNKNOWN` risk with no analyzer, sets `AWAITING_CONFIRMATION` on the action. The CLI sets that state on every such action, because the CLI decides itself. The details are on [[Security and Confirmation]].

Sources: [openhands/controller/agent_controller.py:919-960](repo://openhands/controller/agent_controller.py#L919-L960)

The action becomes the pending action. If it awaits confirmation, the state moves to `AWAITING_USER_CONFIRMATION`. Then the action is written to the stream with its source, and its metrics are prepared for the frontend.

Sources: [openhands/controller/agent_controller.py:960-974](repo://openhands/controller/agent_controller.py#L960-L974)

## Stuck detection and limits

`_is_stuck` returns true when the delegate is stuck or when `StuckDetector.is_stuck` says so. The detector looks at the whole history in headless mode, and only at the events after the last user message in interactive mode. It ignores user messages and null events. It recognises a repeated action-observation pair, a repeated error, a repeated syntax error, a monologue, a repeated action-observation pattern and a context-window error.

Sources: [openhands/controller/agent_controller.py:1067-1077](repo://openhands/controller/agent_controller.py#L1067-L1077), [openhands/controller/stuck.py:28-60](repo://openhands/controller/stuck.py#L28-L60), [openhands/controller/stuck.py:112-120](repo://openhands/controller/stuck.py#L112-L120), [openhands/controller/stuck.py:135-137](repo://openhands/controller/stuck.py#L135-L137), [openhands/controller/stuck.py:186-188](repo://openhands/controller/stuck.py#L186-L188), [openhands/controller/stuck.py:258-260](repo://openhands/controller/stuck.py#L258-L260), [openhands/controller/stuck.py:292-294](repo://openhands/controller/stuck.py#L292-L294), [openhands/controller/stuck.py:336-338](repo://openhands/controller/stuck.py#L336-L338)

## Errors

`_react_to_exception` stores the error as `last_error`. When there is a status callback, it maps the exception to a runtime status: authentication, service unavailable, internal error, budget exhausted, content policy and rate limit each get their own status. A rate-limit error stays in `RATE_LIMITED` while retries remain, and goes to `ERROR` once they are used up. Any other exception moves the state to `ERROR`.

Sources: [openhands/controller/agent_controller.py:302-357](repo://openhands/controller/agent_controller.py#L302-L357)

## State transitions

`set_agent_state_to` ignores a state that is already current. It resets the controller on `STOPPED` and `ERROR`, and it raises the control limits when the user moves the agent from `ERROR` back to `RUNNING`. When the user confirms or rejects a pending action, the action is written to the stream again with its new confirmation state.

Sources: [openhands/controller/agent_controller.py:631-669](repo://openhands/controller/agent_controller.py#L631-L669), [openhands/controller/state/state_tracker.py:231-236](repo://openhands/controller/state/state_tracker.py#L231-L236)

## Delegation

An `AgentDelegateAction` starts a child controller with the agent class the action names. The child shares the parent's metrics, so the cost counts toward the whole task. While the child runs, the parent forwards every event to it and does not step itself. `end_delegate` closes the child and lets the parent resume.

Sources: [openhands/controller/agent_controller.py:693-712](repo://openhands/controller/agent_controller.py#L693-L712), [openhands/controller/agent_controller.py:754-760](repo://openhands/controller/agent_controller.py#L754-L760), [openhands/controller/agent_controller.py:392-398](repo://openhands/controller/agent_controller.py#L392-L398)

The agent's own choice of action is described in [[CodeAct Agent]], and the stream the controller reads from is described in [[Events and the Event Stream]].

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:160-172](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L160-L172)
