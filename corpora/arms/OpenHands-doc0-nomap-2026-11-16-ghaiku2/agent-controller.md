---
title: "Agent Controller"
---
## Overview

`AgentController` is the object that turns a stream of events into agent steps. It subscribes to the conversation's `EventStream`, records each event in the agent's state history, hands actions to the runtime through the stream, and calls the agent again when an observation or a user message means it should act. It does not run commands or call the model itself; those belong to [[Runtime Core]] and [[CodeAct Agent]].

Sources: [openhands/controller/agent_controller.py:100-114](repo://openhands/controller/agent_controller.py#L100-L114), [openhands/controller/agent_controller.py:167-172](repo://openhands/controller/agent_controller.py#L167-L172)

## Receiving events

The stream calls `on_event` for every event. If a delegate agent is active and still running, the event is forwarded to the delegate's `_on_event` and the parent stops there. A delegate that has finished, errored or been rejected is ended with `end_delegate` first. Otherwise the parent processes the event through `_on_event`.

Sources: [openhands/controller/agent_controller.py:433-465](repo://openhands/controller/agent_controller.py#L433-L465)

`_on_event` drops hidden events, appends the event to the state tracker's history, and then routes it: an `Action` goes to `_handle_action`, an `Observation` to `_handle_observation`. After routing it asks `should_step` whether to run the agent.

Sources: [openhands/controller/agent_controller.py:467-492](repo://openhands/controller/agent_controller.py#L467-L492)

`_handle_action` treats a few actions specially. A `ChangeAgentStateAction` sets the state, a `MessageAction` goes to `_handle_message_action`, an `AgentDelegateAction` starts a delegate, and `AgentFinishAction` or `AgentRejectAction` store the outputs and move to `FINISHED` or `REJECTED`. Every other action is left for the runtime to execute.

Sources: [openhands/controller/agent_controller.py:494-517](repo://openhands/controller/agent_controller.py#L494-L517)

A user message does not go straight to the agent. `_handle_message_action` first creates a `RecallAction` as the pending action, so that [[Memory and Recall]] adds context before the step. The agent state moves to `RUNNING` if it was not already.

Sources: [openhands/controller/agent_controller.py:549-580](repo://openhands/controller/agent_controller.py#L549-L580)

## When the agent steps

`should_step` decides which events wake the agent. A user `MessageAction` always does, and so does an agent message when the agent is not waiting for input. A `NullObservation` with a cause does, as does every other observation except `AgentStateChangedObservation` and `NullObservation`. Among the other actions, only delegation and condensation requests wake the agent. While a delegate is active, the parent never steps.

Sources: [openhands/controller/agent_controller.py:392-431](repo://openhands/controller/agent_controller.py#L392-L431)

`_handle_observation` clears the pending action when the observation's cause matches it. If the state is `AWAITING_USER_CONFIRMATION`, the pending action stays until the user answers. A confirmed action returns the state to `RUNNING`, and a rejected one returns it to `AWAITING_USER_INPUT`.

Sources: [openhands/controller/agent_controller.py:519-547](repo://openhands/controller/agent_controller.py#L519-L547)

## One step

`_step` is the unit of work. It returns at once unless the state is `RUNNING` and no action is pending. It then checks for a stuck agent and runs the control flags, which stop the run when the iteration or budget limit is reached. Next it asks the agent for an action, unless a replay is in progress. The action is stamped with the agent as source and added to the stream.

Sources: [openhands/controller/agent_controller.py:821-875](repo://openhands/controller/agent_controller.py#L821-L875), [openhands/controller/agent_controller.py:973-973](repo://openhands/controller/agent_controller.py#L973-L973)

Before the action is added, `_step` checks the confirmation mode. For command, IPython, browse, file edit and file read actions, the security analyser runs, and a high-risk action in non-CLI mode is marked `AWAITING_CONFIRMATION`. The state then moves to `AWAITING_USER_CONFIRMATION` and waits for the user. The details are on [[Security Analyzers]].

Sources: [openhands/controller/agent_controller.py:919-960](repo://openhands/controller/agent_controller.py#L919-L960)

When the model's output is malformed or empty, the error is turned into an `ErrorObservation` and fed back to the agent rather than ending the run. When the model reports a context window overflow and history truncation is enabled, the controller adds a `CondensationRequestAction` instead, so [[Condensers]] shortens the history and the agent steps again.

Sources: [openhands/controller/agent_controller.py:874-917](repo://openhands/controller/agent_controller.py#L874-L917)

## Errors

`_step_with_exception_handling` wraps `_step`. Most exceptions are reported to the user as a generic message that asks them to try again. A short list of provider errors (timeouts, rate limits, authentication, content policy, context window) is passed on unchanged, so the user sees the cause.

Sources: [openhands/controller/agent_controller.py:361-390](repo://openhands/controller/agent_controller.py#L361-L390)

`_react_to_exception` stores the error text as `state.last_error` and sends a runtime status through the status callback. A rate-limit error with retries left sets `RATE_LIMITED`; once retries are exhausted, or for any other error, the state becomes `ERROR`.

Sources: [openhands/controller/agent_controller.py:302-357](repo://openhands/controller/agent_controller.py#L302-L357)

## Agent states

`set_agent_state_to` is the only place the state changes. It writes the new state, resets the agent when the state is `STOPPED` or `ERROR`, and raises the control limits when the user resumes from `ERROR`. If the user confirms or rejects a waiting action, the pending action is added to the stream again, marked `CONFIRMED` or `REJECTED`, so the runtime runs it or the agent sees it refused.

Sources: [openhands/controller/agent_controller.py:631-683](repo://openhands/controller/agent_controller.py#L631-L683)

## Delegates

An `AgentDelegateAction` makes the controller create a child `AgentController` with its own agent. The child's `State` is built on the parent's iteration flag, budget flag and metrics, and starts at the stream's next event ID. The child is created with `is_delegate=True`, so it does not subscribe to the stream itself; the parent forwards events to it. When the child reaches `FINISHED`, `ERROR` or `REJECTED`, `end_delegate` copies the iteration count back and records the delegate's metrics before control returns to the parent.

Sources: [openhands/controller/agent_controller.py:693-752](repo://openhands/controller/agent_controller.py#L693-L752), [openhands/controller/agent_controller.py:754-820](repo://openhands/controller/agent_controller.py#L754-L820)
