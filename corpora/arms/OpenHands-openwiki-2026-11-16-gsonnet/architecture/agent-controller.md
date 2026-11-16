---
type: architecture
title: AgentController, State and Control Flow
description: How AgentController drives an Agent from event-stream callbacks — when it steps, how pending actions gate stepping, the AgentState machine, iteration/budget limits, stuck detection, delegation to sub-agents, error handling and state persistence.
tags: [controller, agent-state, control-flow, delegation, stuck-detection, limits]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:38:52.407Z
sources:
  - id: openwiki-source-2129d0084f64a3f5714baf90
    resource: repo://openhands/controller/agent_controller.py
  - id: openwiki-source-7cba31b46476acb75dbf4313
    resource: repo://openhands/controller/state/control_flags.py
  - id: openwiki-source-94f95c0e65a5853c8520f3a8
    resource: repo://openhands/controller/state/state_tracker.py
  - id: openwiki-source-f1695abdeda3aad0454e38f6
    resource: repo://openhands/controller/state/state.py
  - id: openwiki-source-6facf31398d774ea044a5a65
    resource: repo://openhands/controller/stuck.py
generated: { by: "claude-code", at: "2026-11-16T09:38:52.407Z" }
---

# AgentController, State and Control Flow

`AgentController` (`openhands/controller/agent_controller.py`) is the loop driver. It owns an [Agent](../agents/codeact-agent.md), subscribes to the [EventStream](event-stream.md), and turns incoming events into agent steps. It never executes actions itself: it publishes the agent's `Action` on the stream and waits for the [Runtime](../runtime/runtime-and-sandbox.md) to publish the matching `Observation`.

## Construction and lifecycle

- Only a **root** controller subscribes to the stream (`EventStreamSubscriber.AGENT_CONTROLLER`, callback `on_event`); delegates are created with `is_delegate=True` and get events forwarded by their parent.
- A `StateTracker` owns the `State` — either restored from a previous session, inherited from a parent, or created fresh with an `IterationControlFlag` and an optional `BudgetControlFlag`.
- `_add_system_message()` adds the agent's `SystemMessageAction` to the stream, unless the stream already contains one (or begins with a user message, a legacy case).
- `close()` sets `AgentState.STOPPED` (unless disabled), has the tracker rebuild `state.history` from the stream (including delegate events, minus filtered types), and unsubscribes.
- Replay: with `replay_events`, `ReplayManager` supplies actions instead of the agent (used by `AgentSession._run_replay`).

## The event → step cycle

`on_event` → `_on_event`:

1. Hidden events are ignored. Others are appended to `state.history` through `StateTracker.add_history`, which filters out `NullAction`, `NullObservation`, `ChangeAgentStateAction`, `AgentStateChangedObservation` and hidden events.
2. Actions are dispatched: `ChangeAgentStateAction` → `set_agent_state_to`; `MessageAction` → `_handle_message_action`; `AgentDelegateAction` → `start_delegate`; `AgentFinishAction`/`AgentRejectAction` → store outputs and move to `FINISHED`/`REJECTED`.
3. Observations clear the pending action (see below).
4. `should_step(event)` decides whether to call `_step`. It is true for user messages, agent messages when not awaiting user input, `AgentDelegateAction`, condensation actions/requests, and for every observation except `AgentStateChangedObservation` and plain `NullObservation` (a `NullObservation` whose `cause > 0` — the answer to a recall — does trigger a step). It is always false while a delegate is active.

### Pending actions gate the loop

`_step` returns immediately unless `state.agent_state == RUNNING` **and** there is no `_pending_action`. When the agent emits a *runnable* action (or the controller emits a `RecallAction` for a user message), it is stored as `_pending_action`; it is cleared in `_handle_observation` when an observation arrives whose `cause` equals the pending action's id. This is the mechanism that serializes the loop: one action in flight at a time. Long-pending actions are only logged (after 60 s), never auto-cleared.

### What `_step` does

1. Syncs the budget flag with accumulated LLM metrics.
2. Runs stuck detection; if stuck raises `AgentStuckInLoopError` through `_react_to_exception`.
3. Runs `state_tracker.run_control_flags()`, which increments the iteration counter and raises `RuntimeError` when the iteration or budget limit is hit.
4. Calls `agent.step(state)` (or `ReplayManager.step()` in replay mode) and marks the action as agent-sourced.
5. Handles agent errors: malformed/no-action/function-call validation errors become an `ErrorObservation` in the stream so the model can retry; context-window errors (detected via exception type *and* string matching because LiteLLM wraps them inconsistently) become a `CondensationRequestAction` if `enable_history_truncation` else `LLMContextWindowExceedError`.
6. For runnable actions in **confirmation mode**, invokes the security analyzer and, if the risk is high (or unknown with no analyzer), marks the action `AWAITING_CONFIRMATION` and moves to `AWAITING_USER_CONFIRMATION`. CLI mode always marks them awaiting and lets the CLI decide. See [Security](../security/security-and-confirmation.md).
7. Publishes the action on the event stream.

Exceptions escaping `_step` go through `_step_with_exception_handling` → `_react_to_exception`, which records `state.last_error`, maps LLM errors (authentication, service unavailable, internal server error, out-of-credits, content policy) onto `RuntimeStatus` values for the status callback, and moves to `ERROR`. Rate-limit errors go to `RATE_LIMITED` while retries remain, and to `ERROR` once retries are exhausted.

## AgentState machine

`AgentState` (`core/schema/agent.py`): `LOADING`, `RUNNING`, `AWAITING_USER_INPUT`, `PAUSED`, `STOPPED`, `FINISHED`, `REJECTED`, `ERROR`, `AWAITING_USER_CONFIRMATION`, `USER_CONFIRMED`, `USER_REJECTED`, `RATE_LIMITED`.

`set_agent_state_to` is a no-op if the state is unchanged; otherwise it:

- calls `_reset()` on `STOPPED`/`ERROR`;
- when going `ERROR → RUNNING`, lets the tracker extend exhausted limits (`maybe_increase_control_flags_limits`): the iteration flag grows by its initial amount only in non-headless mode, the budget flag always re-bases on current spend;
- on `USER_CONFIRMED`/`USER_REJECTED`, re-publishes the pending action with updated `confirmation_state` (id reset so it gets a fresh event id) — that re-published action is what the runtime executes (or rejects with `UserRejectObservation`);
- emits an `AgentStateChangedObservation` (with the error reason for `ERROR`) and saves state.

User messages also move the agent to `RUNNING`; an agent message with `wait_for_response` moves it to `AWAITING_USER_INPUT`.

## State and persistence

`State` (`controller/state/state.py`) holds the agent state, iteration/budget flags, delegate level, history window (`start_id`/`end_id`), metrics, `last_error`, `extra_data` (condenser metadata lives here) and more. It is **pickled and base64-encoded** into the file store under the conversation's agent-state file (`save_to_session`), excluding `conversation_stats`, which persists itself. `restore_from_session` reads it back (with a fallback to the pre-user-id path for SaaS) and sets `agent_state = LOADING`; if the saved state was one of `RUNNING`, `PAUSED`, `AWAITING_USER_INPUT`, `FINISHED` it is remembered in `resume_state`. The controller saves state on every state change. See [Storage](../server/storage-and-persistence.md).

### Limits

- `IterationControlFlag`: raises `RuntimeError('Agent reached maximum iteration...')` when `current_value >= max_value`.
- `BudgetControlFlag`: updated externally from LLM metrics; raises `RuntimeError('Agent reached maximum budget for conversation...')`.

Both errors surface as `ERROR`; the parent controller also recognizes these messages when deciding whether a delegate is genuinely finished.

## Stuck detection

`StuckDetector.is_stuck(headless_mode)` inspects `state.history`. In interactive mode it considers only events after the last user message; in headless mode all history. Null events and user messages are filtered; fewer than three events means "not stuck". Scenarios: (1) the same action with the same observation repeated, (2) the same action repeatedly erroring, (3) a monologue of repeated agent messages, (4) an action–observation ping-pong over the last six steps, (5) repeated context-window errors (needs ≥10 events). Comparison ignores process ids (`_eq_no_pid`).

## Delegation

An `AgentDelegateAction` (e.g. from CodeAct's browsing delegation) makes the parent call `start_delegate`: it instantiates `Agent.get_cls(action.agent)` with the delegate's config, builds a child `State` that **shares** the parent's iteration flag, budget flag and metrics (so limits are global) with `delegate_level + 1` and `start_id` at the stream head, and creates a child `AgentController(is_delegate=True)`. If the action has a `task` input a `TASK: ...` user message is posted and the delegate set to `RUNNING`. While a delegate exists the parent's `on_event` forwards events to it. When the delegate reaches `FINISHED`, `REJECTED` or `ERROR` (but not merely due to hitting iteration/budget limits) the parent calls `end_delegate`, which copies the shared iteration counter back, closes the delegate, and emits an `AgentDelegateObservation` linked to the originating tool call so the parent agent sees the result.

Related: [Event stream](event-stream.md), [Overview](overview.md), [CodeActAgent](../agents/codeact-agent.md), [Memory and condensation](../agents/memory-and-condensation.md).
