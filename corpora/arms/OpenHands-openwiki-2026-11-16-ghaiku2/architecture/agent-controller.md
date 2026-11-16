---
type: architecture-component
title: Agent Controller and Step Loop
description: How AgentController drives an agent one step at a time, reacts to events, enforces iteration and budget limits, detects stuck loops, gates actions behind confirmation, and hands work to delegate agents.
tags: [agent-controller, agent-loop, state-machine, delegation, stuck-detection, control-flags]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:30:54.023Z
sources:
  - id: openwiki-source-2129d0084f64a3f5714baf90
    resource: repo://openhands/controller/agent_controller.py
  - id: openwiki-source-7cba31b46476acb75dbf4313
    resource: repo://openhands/controller/state/control_flags.py
  - id: openwiki-source-6facf31398d774ea044a5a65
    resource: repo://openhands/controller/stuck.py
generated: { by: "claude-code", at: "2026-11-16T18:30:54.023Z" }
---

# Agent Controller and Step Loop

<!-- openwiki: broken internal link [/openwiki/architecture/event-stream.md] link "/openwiki/architecture/event-stream.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/architecture/runtime-sandbox.md] link "/openwiki/architecture/runtime-sandbox.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`AgentController` (`openhands/controller/agent_controller.py`) is the orchestration core of a single conversation. It owns the agent, the `State`, and the subscription to the [event stream](/openwiki/architecture/event-stream.md). It does not execute commands itself: it asks the agent for one `Action`, publishes that action to the stream, and relies on the [runtime](/openwiki/architecture/runtime-sandbox.md) to return an `Observation`, which re-triggers the loop.

## Responsibilities

- Holds the active `Agent`, the `State` (history, iteration counter, budget, outputs, last error), and a `StateTracker` that keeps history and control flags.
- Subscribes to the event stream and turns each incoming `Action` or `Observation` into a state transition or a new step.
- Decides when the agent may step, enforces iteration and budget limits, and converts failures into an `ERROR` state.
- Manages delegation: a parent controller can start a child agent for a subtask and forward events to it until it finishes.
- Performs stuck detection and optional confirmation gating before an action reaches the runtime.

## Event-driven loop

The controller does not poll. `on_event` is the callback registered with the event stream.

1. If a delegate is active and still running, `on_event` forwards the event to the delegate and returns (`agent_controller.py` ~L433-L462). The parent is skipped until the delegate finishes, errors, or is rejected. A delegate that hit its iteration or budget limit is still forwarded to so the parent can recover.
2. Otherwise `_on_event` records the event in history, then dispatches:
   - `Action` → `_handle_action`: handles state-change, user-message, delegate-start, finish, and reject actions.
   - `Observation` → `_handle_observation`.
3. `should_step(event)` decides whether to step. It returns `False` while a delegate is active. For actions it returns `True` for user messages, delegate and condensation actions, and non-user messages when the agent is not `AWAITING_USER_INPUT`. For observations it returns `True` except for state-change observations and most null observations.
4. If stepping, `_step_with_exception_handling` calls `_step`.

Because `on_event` runs the coroutine with `run_until_complete` on the event loop, event handling is serialized per controller.

### What `_step` checks, in order

`_step` (`agent_controller.py` ~L821 onward) is the single place an agent produces the next action:

1. Returns if the agent state is not `RUNNING`.
2. Returns if a previously produced action is still pending (`_pending_action`), so only one action is in flight.
3. Synchronizes the budget control flag with accumulated LLM cost (`state_tracker.sync_budget_flag_with_metrics`).
4. Checks `_is_stuck()`; on a hit it raises `AgentStuckInLoopError` through `_react_to_exception` (~L849).
5. Runs control flags via `state_tracker.run_control_flags()`, which steps the iteration counter and the budget flag. A reached limit raises and is reacted to as an error.
6. Either takes the next action from the replay manager (trajectory replay mode) or calls `self.agent.step(self.state)`.
<!-- openwiki: broken internal link [/openwiki/architecture/security-analysis.md] link "/openwiki/architecture/security-analysis.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
7. Stores the action as `_pending_action`. If the action carries `AWAITING_CONFIRMATION` (set by the confirmation gate, which applies only with confirmation mode on; see [Security Analysis and Action Gating](/openwiki/architecture/security-analysis.md)), the state moves to `AWAITING_USER_CONFIRMATION` (~L968) before the action is published.
8. Publishes non-null actions to the event stream with `event_stream.add_event(action, source)`.

Errors from the LLM are caught in the same method and routed through `_react_to_exception`.

## State machine

`AgentState` (`openhands/core/schema/agent.py`) includes `LOADING`, `RUNNING`, `AWAITING_USER_INPUT`, `AWAITING_USER_CONFIRMATION`, `USER_CONFIRMED`, `USER_REJECTED`, `PAUSED`, `STOPPED`, `FINISHED`, `REJECTED`, `ERROR`, and `RATE_LIMITED`.

- `AgentFinishAction` → `FINISHED`, copying `action.outputs` into `state.outputs`.
- `AgentRejectAction` → `REJECTED`, with outputs.
- `ChangeAgentStateAction` is applied directly by `set_agent_state_to`.
- `_react_to_exception` stores a `last_error` string and maps known LLM failures to specific runtime statuses (authentication, service unavailable, internal server error, out of credits from `ExceededBudget`, content policy violation). A `RateLimitError` moves the agent to `RATE_LIMITED` until retries are exhausted, then to `ERROR`. Any other exception moves the agent to `ERROR`.

## Limits and control flags

Two control flags run on every step (`openhands/controller/state/control_flags.py`):

- `IterationControlFlag` counts steps. When `current_value` reaches `max_value` it raises `RuntimeError: Agent reached maximum iteration.` (~L59).
- `BudgetControlFlag` compares accumulated cost (from the combined LLM metrics) to a maximum. When it is exceeded it raises `RuntimeError: Agent reached maximum budget for conversation.` (~L92).

In headless mode, `headless_mode` can raise the limit (`increase_limit`) rather than stop immediately. The iteration count for a delegate is copied back into the parent when the delegate ends (`end_delegate`, ~L754-L780).

## Stuck detection

`StuckDetector` (`openhands/controller/stuck.py`) inspects the recent history for repeating patterns. It is consulted by `_is_stuck()` (~L1067-L1077), which first checks the delegate and then the parent.

- `is_stuck(headless_mode)` looks at the whole history in headless mode. In interactive mode it only looks at events after the last user message.
- Patterns include repeated action/observation pairs (`_is_stuck_repeating_action_observation`, ~L112), repeated monologue-style agent messages (`_is_stuck_monologue`, ~L258), alternating action-observation cycles (`_is_stuck_action_observation_pattern`), and context-window errors that recur (`_is_stuck_context_window_error`, ~L336). Invalid-syntax and line-error patterns are also tracked.

A stuck detection is not retried automatically. It is reported as `AgentStuckInLoopError`, which sets the agent to `ERROR`.

## Delegation

A parent starts a child when it emits an `AgentDelegateAction`.

- `start_delegate` (~L693) constructs the delegate agent class from the agent registry, takes a metrics snapshot, and creates a child `State` that shares iteration and budget accounting.
- The task string from the action is published as a `MessageAction` with source `USER`, and the delegate is set to `RUNNING`.
- While the delegate is active, the parent's `should_step` returns `False`, so only the delegate steps. When the delegate finishes or errors, `end_delegate` (~L754) merges the child's iteration and metrics back into the parent and resumes it.

<!-- openwiki: broken internal link [/openwiki/architecture/agents-and-prompting.md] link "/openwiki/architecture/agents-and-prompting.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
This is the mechanism behind the `delegate` pattern in the agent hub. See [Agents, Prompting, and Delegation](/openwiki/architecture/agents-and-prompting.md).

## Failure behavior and invariants

- A single `_pending_action` is in flight at a time. The controller will not step again until it is cleared by an observation or confirmation.
- Hidden events (`event.hidden`) are dropped before they reach history or the agent.
- Recovery from `ERROR` is allowed: `set_agent_state_to` permits the `ERROR` → `RUNNING` transition (~L655). Stop and error both call `_reset`, which synthesizes an `ErrorObservation` for any pending tool call so the history stays well-formed, then clears `_pending_action`.
- Control-flag and stuck errors surface through the same error path as LLM failures, so the frontend sees one error model.
- `save_state` (~L1203) persists the `State`, and `close` handles teardown.

## Extension seams

- New agents plug in through `Agent` and the agent registry (`openhands/controller/agent.py`), not by editing the controller.
<!-- openwiki: broken internal link [/openwiki/architecture/security-analysis.md] link "/openwiki/architecture/security-analysis.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- Confirmation policy is pluggable through the `security_analyzer` argument and `confirmation_mode`. See [Security Analysis and Action Gating](/openwiki/architecture/security-analysis.md).
- Trajectory replay is controlled by `ReplayManager` (`openhands/controller/replay.py`) and changes only where the next action comes from.

## Representative tests

- `tests/unit/controller/test_agent_controller.py` covers the step loop and state transitions.
- `tests/unit/controller/test_agent_delegation.py` covers delegate start and end.
- `tests/unit/controller/test_is_stuck.py` covers the stuck-detection patterns.
- `tests/unit/controller/state/test_control_flags.py` covers iteration and budget limits.

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/event-stream.md] link "/openwiki/architecture/event-stream.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Event Stream, Actions, and Observations](/openwiki/architecture/event-stream.md)
<!-- openwiki: broken internal link [/openwiki/architecture/agents-and-prompting.md] link "/openwiki/architecture/agents-and-prompting.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Agents, Prompting, and Delegation](/openwiki/architecture/agents-and-prompting.md)
<!-- openwiki: broken internal link [/openwiki/architecture/runtime-sandbox.md] link "/openwiki/architecture/runtime-sandbox.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Runtime and Sandbox Execution](/openwiki/architecture/runtime-sandbox.md)
<!-- openwiki: broken internal link [/openwiki/architecture/security-analysis.md] link "/openwiki/architecture/security-analysis.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Security Analysis and Action Gating](/openwiki/architecture/security-analysis.md)
