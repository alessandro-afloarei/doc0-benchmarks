---
title: "Agent Controller and Step Loop"
---
## Overview

`AgentController` owns one agent, one event stream and one `State`, and decides when the agent takes its next step. It does not run commands or call the model itself: it receives events, updates the state, and asks the agent for an action only when the event means the agent should act. Its loop is event-driven, so a step starts from a callback rather than from a timer.

Sources: [openhands/controller/agent_controller.py:100-115](repo://openhands/controller/agent_controller.py#L100-L115)

The caller of the loop waits outside the controller. `run_agent_until_done` polls the agent state once a second until it reaches one of the end states it was given.

Sources: [openhands/core/loop.py:11-14](repo://openhands/core/loop.py#L11-L14) [openhands/core/loop.py:44-45](repo://openhands/core/loop.py#L44-L45)

## Receiving events

The event stream calls `on_event`. If a delegate controller is active, the event goes to the delegate and the parent stops. A delegate that has finished, errored, or been rejected is ended instead, and the event is not passed on. Otherwise `_on_event` runs: hidden events are dropped, the event is added to the state history, actions and observations are handled, and then `should_step` decides whether to step.

Sources: [openhands/controller/agent_controller.py:433-465](repo://openhands/controller/agent_controller.py#L433-L465) [openhands/controller/agent_controller.py:467-492](repo://openhands/controller/agent_controller.py#L467-L492)

`should_step` is the rule that matters. A user message always steps the agent. An agent message steps it only when the agent is not waiting for the user. Delegate actions and condensation actions step it too. An observation steps it unless it is a state-change or a null observation. Routine null observations and state changes do not step.

Sources: [openhands/controller/agent_controller.py:392-431](repo://openhands/controller/agent_controller.py#L392-L431)

## One step

`_step` returns early unless the agent state is `RUNNING` and no action is pending. It then checks the stuck detector and the control flags, which hold the iteration and budget limits. A violated limit or a stuck agent is reported as an exception rather than as an action.

Sources: [openhands/controller/agent_controller.py:821-857](repo://openhands/controller/agent_controller.py#L821-L857)

When the limits pass, the step asks the agent for one action, or replays one when a trajectory is being replayed. Some model failures do not stop the run: malformed actions, missing actions and validation failures become an `ErrorObservation` on the stream, and the step ends. Context-window errors are different: when history truncation is enabled, the step publishes a `CondensationRequestAction`, otherwise it raises.

Sources: [openhands/controller/agent_controller.py:864-917](repo://openhands/controller/agent_controller.py#L864-L917)

A runnable action is held as the pending action. In confirmation mode, shell commands, IPython cells, browser actions and file reads and edits are sent to the security analyzer first. A high-risk or unrated action moves the agent to `AWAITING_USER_CONFIRMATION`. In CLI mode the controller marks the action as awaiting confirmation and lets the CLI decide. The action is then published to the stream.

Sources: [openhands/controller/agent_controller.py:919-974](repo://openhands/controller/agent_controller.py#L919-L974)

## Pending actions and observations

The controller holds at most one pending action. A step does not start while one is pending, so the agent cannot run two actions at once. An observation clears the pending action when its `cause` matches the action's id. If the user has confirmed, the agent returns to `RUNNING`; if the user has rejected, it returns to `AWAITING_USER_INPUT`.

Sources: [openhands/controller/agent_controller.py:519-547](repo://openhands/controller/agent_controller.py#L519-L547)

## Errors and state changes

Any exception that escapes a step reaches `_step_with_exception_handling`, which logs it and passes a reported error to `_react_to_exception`. Known provider errors, such as authentication, rate limit and service unavailable, keep their own type and map to a runtime status. Any other exception is reported as a generic message. `_react_to_exception` stores the reason in `state.last_error` and sets the agent to `ERROR`.

Sources: [openhands/controller/agent_controller.py:358-390](repo://openhands/controller/agent_controller.py#L358-L390) [openhands/controller/agent_controller.py:302-330](repo://openhands/controller/agent_controller.py#L302-L330)

`set_agent_state_to` is the only place the state changes. It ignores a repeated state, records the old state for the limit checks, sets the new one, and then runs the side effects of the transition.

Sources: [openhands/controller/agent_controller.py:631-650](repo://openhands/controller/agent_controller.py#L631-L650)

## Stuck detection

`_is_stuck` returns true when a delegate is stuck, or when the stuck detector reports a loop. The detector's `is_stuck` takes a headless flag, which the controller passes from its own setting.

Sources: [openhands/controller/agent_controller.py:1067-1077](repo://openhands/controller/agent_controller.py#L1067-L1077) [openhands/controller/stuck.py:18-28](repo://openhands/controller/stuck.py#L18-L28)

## Delegation

An `AgentDelegateAction` starts a child controller, which the parent stores in its `delegate` field. Until the child ends, the parent forwards every event to it. `end_delegate` clears that field when the child is finished or errored, and the parent handles events again.

Sources: [openhands/controller/agent_controller.py:693-740](repo://openhands/controller/agent_controller.py#L693-L740) [openhands/controller/agent_controller.py:754-770](repo://openhands/controller/agent_controller.py#L754-L770)
