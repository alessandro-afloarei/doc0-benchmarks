---
type: subsystem
title: Agent Controller and State
description: How AgentController drives an agent by reacting to event-stream events, manages AgentState transitions, enforces iteration and budget limits, handles pending actions, confirmation, delegation, stuck detection, errors, persistence, and trajectory replay.
tags: [controller, agent-state, control-flags, delegation, stuck-detection, replay]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:35:38.671Z
sources:
  - id: openwiki-source-2129d0084f64a3f5714baf90
    resource: repo://openhands/controller/agent_controller.py
  - id: openwiki-source-74d3fef77d7c1ea3b2bc0d11
    resource: repo://openhands/controller/replay.py
  - id: openwiki-source-7cba31b46476acb75dbf4313
    resource: repo://openhands/controller/state/control_flags.py
  - id: openwiki-source-94f95c0e65a5853c8520f3a8
    resource: repo://openhands/controller/state/state_tracker.py
  - id: openwiki-source-f1695abdeda3aad0454e38f6
    resource: repo://openhands/controller/state/state.py
  - id: openwiki-source-6facf31398d774ea044a5a65
    resource: repo://openhands/controller/stuck.py
generated: { by: "claude-code", at: "2026-11-16T07:35:38.671Z" }
---

# Agent Controller and State

`AgentController` (`openhands/controller/agent_controller.py`) runs one conversation's agent. It doesn't loop on its own. It subscribes to the [event stream](event-stream.md) and, for each event, decides whether the agent should take another step. One step means one call to `agent.step(state)`, which returns one action that goes onto the stream (see [Agents](../agents/agenthub.md)).

## Ownership and wiring

- Only the **root** controller subscribes to the stream, as `EventStreamSubscriber.AGENT_CONTROLLER`. A delegate controller is created with `is_delegate=True` and gets events forwarded from its parent.
- `StateTracker` (`controller/state/state_tracker.py`) owns the `State` object: building history from the stream, saving and restoring, and running the control flags. `controller.state` points at `state_tracker.state`.
- At construction, the controller adds the agent's `SystemMessageAction` to the stream unless the conversation already has one. It also skips this when the first event it finds is a user message, which marks a legacy conversation created before system messages existed.
- `create_controller()` in `openhands/core/setup.py` (CLI/headless) and `AgentSession._create_controller` (server) build the controller. Both try `State.restore_from_session` first, so a conversation picks up where it stopped.
- `run_agent_until_done()` (`openhands/core/loop.py`) is the headless driver. It installs a `status_callback` on the runtime, controller, and memory that moves the agent to `ERROR` on error reports, then polls once a second until the agent reaches an end state.

## Event handling → step

`on_event(event)`:

1. If there is an active delegate, the event goes to the delegate. Once the delegate reaches `FINISHED`, `ERROR`, or `REJECTED`, `end_delegate()` runs instead. One exception: a delegate that errored because it hit its iteration or budget limit keeps receiving events.
2. Otherwise `_on_event` skips `hidden` events, adds the event to history (through the history filter), and dispatches it:
   - **Actions.** `ChangeAgentStateAction` sets the state. A user `MessageAction` creates a `RecallAction`: `WORKSPACE_CONTEXT` for the first user message, `KNOWLEDGE` after that. The recall action becomes the pending action, and the agent moves to `RUNNING`. An agent `MessageAction(wait_for_response=True)` moves the agent to `AWAITING_USER_INPUT`. `AgentDelegateAction` starts a delegate. `AgentFinishAction` and `AgentRejectAction` store `outputs` and move to `FINISHED` or `REJECTED`.
   - **Observations.** If the observation's `cause` matches the pending action, the pending action is cleared, unless the agent is waiting for confirmation. `USER_CONFIRMED` then moves to `RUNNING`, and `USER_REJECTED` moves to `AWAITING_USER_INPUT`.
3. `should_step(event)` decides whether to step. It returns true for user messages, delegate and condensation actions, `NullObservation`s caused by a recall (`cause > 0`), and ordinary observations. It returns false for state-change observations and other null events.

`_step()` returns early unless the state is `RUNNING` and no action is pending. Then it:

1. Syncs the budget flag with total cost across all LLMs (`conversation_stats.get_combined_metrics()`).
2. Runs the [stuck detector](#stuck-detection). If the agent is stuck, it raises `AgentStuckInLoopError` and moves to `ERROR`.
3. Steps the control flags. Going over the iteration or budget limit raises `RuntimeError` and moves to `ERROR`.
4. Gets an action from the replay manager when replaying, and from `agent.step(state)` otherwise.
5. Handles errors:
   - Malformed or invalid tool calls (`LLMMalformedActionError`, `LLMNoActionError`, `LLMResponseError`, `FunctionCallValidationError`, `FunctionCallNotExistsError`) become an `ErrorObservation` on the stream, so the model sees the error and retries.
   - A context-window overflow, detected from the exception type or by matching provider error strings, adds a `CondensationRequestAction` when `enable_history_truncation` is on. When it's off, it raises `LLMContextWindowExceedError`.
6. For runnable actions, applies confirmation and security checks (below) and records the action as the pending action. The controller won't step again until the matching observation arrives.
7. Attaches a minimal `llm_metrics` snapshot (total cost, total token usage, and `max_budget_per_task`) for the UI, then publishes the action.

`step()` schedules `_step_with_exception_handling()` as an asyncio task. Any exception that escapes goes to `_react_to_exception`, which records `state.last_error` and maps litellm error types to `RuntimeStatus` codes: authentication failure, service unavailable, internal server error, out of credits, and content policy violation. It reports through `status_callback` and moves to `ERROR`. Rate limits are different: the agent moves to `RATE_LIMITED` while retries remain, and to `ERROR` with a special message once they run out.

## Agent states

`AgentState` (`openhands/core/schema/agent.py`) values: `LOADING`, `RUNNING`, `AWAITING_USER_INPUT`, `PAUSED`, `STOPPED`, `FINISHED`, `REJECTED`, `ERROR`, `AWAITING_USER_CONFIRMATION`, `USER_CONFIRMED`, `USER_REJECTED`, `RATE_LIMITED`.

`set_agent_state_to(new_state)` does nothing if the state hasn't changed. Otherwise:

- Entering `STOPPED` or `ERROR` calls `_reset()`. If the pending action came from a tool call and has no observation yet, `_reset()` adds a synthetic `ErrorObservation` with the same tool-call metadata, so the LLM history keeps every tool call paired with a result. It then clears the pending action and resets the agent.
- Going from `ERROR` to `RUNNING` (the user tells the agent to continue) calls `maybe_increase_control_flags_limits()`, which may raise the limits.
- `USER_CONFIRMED` or `USER_REJECTED` sets the pending action's `confirmation_state`, clears its id, and publishes it again. A confirmed action then goes to the runtime.
- Every transition publishes an `AgentStateChangedObservation` (source `ENVIRONMENT`, with `last_error` as the reason when entering `ERROR`) and **saves state**.

## State, control flags, and persistence

`State` (`controller/state/state.py`) holds the session and user ids, `history`, `inputs`/`outputs`, `agent_state`, `delegate_level`, the `start_id`/`end_id` event range, `last_error`, `extra_data` (used by evaluations), metrics, and two control flags:

- `IterationControlFlag` adds one per step and raises `RuntimeError("Agent reached maximum iteration...")` at `max_value`. `increase_limit` adds `limit_increase_amount`, but only in non-headless mode.
- `BudgetControlFlag` (present only when `max_budget_per_task` is set) doesn't count up itself. `sync_budget_flag_with_metrics` sets its value from the total cost. When the limit is hit, it raises, and `increase_limit` resets `max_value` to the current cost plus the original amount.

History comes from the event stream (`StateTracker._init_history`). The filter leaves out `NullAction`, `NullObservation`, `ChangeAgentStateAction`, `AgentStateChangedObservation`, and hidden events. It also removes everything between an `AgentDelegateAction` and its `AgentDelegateObservation`, keeping only the pair itself. When the controller closes, history is rebuilt from the full range, delegate events included, for trajectory export and evaluation.

`State.save_to_session` pickles the state, base64-encodes it, and writes it to the conversation's agent-state file in the `FileStore`. `conversation_stats` is left out and saves itself. `restore_from_session` reads the file back and falls back to the old location when no user id applies. It sets the restored state to `LOADING`, and records the prior state in `resume_state` when that state was one of `RUNNING`, `PAUSED`, `AWAITING_USER_INPUT`, or `FINISHED`. If the restored state has a `last_error`, `run_controller` in `core/main.py` starts with a message telling the agent not to resume blindly.

## Confirmation mode and security

In confirmation mode, actions of type `CmdRunAction`, `IPythonRunCellAction`, `BrowseInteractiveAction`, `FileEditAction`, and `FileReadAction` go through `_handle_security_analyzer`. With an analyzer configured, it overwrites `action.security_risk` with the analyzer's result, or `UNKNOWN` if the analyzer fails. With no analyzer, the risk is set to `UNKNOWN`. An action needs confirmation when:

- the agent is in CLI mode: every such action needs confirmation, and the CLI decides itself how to treat the risk; or
- the risk is `HIGH`; or
- the risk is `UNKNOWN` and no analyzer is configured.

An action that needs confirmation is marked `AWAITING_CONFIRMATION`, and the agent moves to `AWAITING_USER_CONFIRMATION`. See [Security Analyzers and Confirmation Mode](../security/security-analyzers.md).

## Delegation

`start_delegate(AgentDelegateAction)` creates the target agent class with that agent's config (or the parent's config if there isn't one), sharing the parent's `LLMRegistry`. It then creates a child `AgentController`:

- `sid = parent_id + '-delegate'`
- `delegate_level + 1`
- the **same** iteration and budget flags and global `metrics` as the parent
- `start_id` set to the next event id
- a snapshot of the parent's metrics, used later to compute the delegate's local spend

If the action has `inputs['task']`, a `MessageAction("TASK: ...")` is published and the delegate moves to `RUNNING`. `end_delegate()` copies the delegate's iteration count back to the parent, closes the delegate, and publishes an `AgentDelegateObservation`. Its content summarizes the delegate's outputs or reports the error, and it carries the delegating tool call's metadata so the parent LLM sees a tool result. The stuck detector also checks the delegate.

## Stuck detection

`StuckDetector.is_stuck(headless_mode)` (`controller/stuck.py`) looks at all history in headless mode. In interactive mode it looks only at history after the last user message. User messages and null events are left out. It needs at least three events and checks these patterns:

1. The same action with the same observation four times in a row. Comparison ignores process ids.
2. The same action three times in a row, where each one ends in an `ErrorObservation` or in the same IPython syntax error.
3. A monologue: the agent sends the same message three times with no observation in between.
4. Two (action, observation) pairs alternating over the last six steps.
5. A context-window error loop: at least 10 `AgentCondensationObservation` events back to back with nothing else in between.

## Trajectory replay

When `config.replay_trajectory_path` is set, `ReplayManager` (`controller/replay.py`) receives events from a saved trajectory. `get_replay_events` drops `ENVIRONMENT`-sourced events and clears their ids. The constructor also drops `NullObservation`s and turns off `wait_for_response` on every message except the last. While replay is active, `_step` returns the next recorded **action** in place of calling the agent, and the runtime produces fresh observations. After the replay ends, the conversation continues normally. Replay only reproduces the original run if the actions are deterministic and the starting environment matches.

## Tests

`tests/unit/controller/` contains `test_agent_controller.py` (state transitions, error mapping, context-window handling, confirmation), `test_agent_delegation.py`, `test_is_stuck.py`, and `state/` tests for flags and persistence. `tests/runtime/test_replay.py` tests replay against a real runtime.

## Related pages

- [Events and the Event Stream](event-stream.md)
- [Agents: CodeAct and the Agent Hub](../agents/agenthub.md)
- [Security Analyzers and Confirmation Mode](../security/security-analyzers.md)
- [Conversation Memory and Condensers](memory-and-condensers.md): recall actions and condensation
- [System Architecture Overview](overview.md)
