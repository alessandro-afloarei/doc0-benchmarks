---
title: "Agent State and Limits"
---
## Overview

The `State` object holds everything the controller and the agent know about one run: the event history, the run's position in the stream, the agent's lifecycle state, the iteration and budget counters, and the metrics. Two guards sit on top of it. The control flags stop a run that uses too many iterations or too much money, and the stuck detector stops a run that repeats itself. This page covers those pieces; the stepping that calls them is in [[Agent Controller]].

Sources: [openhands/controller/state/state.py:49-120](repo://openhands/controller/state/state.py#L49-L120), [openhands/controller/stuck.py:18-27](repo://openhands/controller/stuck.py#L18-L27)

## What State holds

`State` is a dataclass. Its fields cover the run's identity (`session_id`, `user_id`), the two control flags, `history` (the events this agent has seen), `inputs` and `outputs` for delegated tasks, the `agent_state` enum with an optional `resume_state`, and `last_error`. Delegation uses `delegate_level`, `start_id` and `end_id` to tell which slice of the stream belongs to this run, and `parent_metrics_snapshot` and `parent_iteration` so a child can compute its own share of cost and steps.

Sources: [openhands/controller/state/state.py:81-118](repo://openhands/controller/state/state.py#L81-L118)

A new run creates its iteration flag with the configured `max_iterations`, and creates a budget flag only when `max_budget_per_task` is set. A state restored from an older save gets a 100-step iteration flag instead. A child delegate receives the parent's two flags and its metrics, so its steps count against the parent's total.

Sources: [openhands/controller/state/state_tracker.py:72-95](repo://openhands/controller/state/state_tracker.py#L72-L95), [openhands/controller/state/state.py:238-242](repo://openhands/controller/state/state.py#L238-L242), [openhands/controller/agent_controller.py:703-724](repo://openhands/controller/agent_controller.py#L703-L724)

## Control flags

A `ControlFlag` is a counter with a `max_value`, a `limit_increase_amount`, and a `headless_mode` setting. `IterationControlFlag` counts steps, and `BudgetControlFlag` compares the accumulated cost to a budget. Each has `reached_limit`, which sets an internal `_hit_limit`, and `increase_limit`. The iteration ceiling rises only in an interactive (not headless) run after the limit was hit; the budget ceiling is reset to the current cost plus the increment whenever it was hit.

Sources: [openhands/controller/state/control_flags.py:1-60](repo://openhands/controller/state/control_flags.py#L1-L60), [openhands/controller/state/control_flags.py:61-95](repo://openhands/controller/state/control_flags.py#L61-L95)

`run_control_flags` advances both flags once per step. The iteration flag raises a `RuntimeError` when its limit is reached, and the controller turns that into an error state. Before that, `sync_budget_flag_with_metrics` copies the accumulated cost from the conversation's metrics into the budget flag, so one LLM service's spend counts toward the limit.

Sources: [openhands/controller/state/state_tracker.py:254-258](repo://openhands/controller/state/state_tracker.py#L254-L258), [openhands/controller/state/state_tracker.py:260-268](repo://openhands/controller/state/state_tracker.py#L260-L268)

When the user moves the agent out of `ERROR` back to `RUNNING`, the controller calls `maybe_increase_control_flags_limits`. The flags then decide whether the increase applies, which depends on the headless setting.

Sources: [openhands/controller/state/state_tracker.py:231-236](repo://openhands/controller/state/state_tracker.py#L231-L236), [openhands/controller/agent_controller.py:631-683](repo://openhands/controller/agent_controller.py#L631-L683)

## Stuck detection

`StuckDetector.is_stuck` decides whether the run is looping. In headless mode it reads the whole history. In interactive mode it reads only the events after the last user message, so an agent that was stuck before the user's new instruction is not flagged. User messages and null events are removed first, and no check runs with fewer than three events left.

Sources: [openhands/controller/stuck.py:28-70](repo://openhands/controller/stuck.py#L28-L70)

The detector has five scenarios, checked in order. The first two look at the last four actions and observations: the same action with the same observation, or the same action with errors. The third looks for a monologue, where the agent's messages repeat. The fourth looks for an action and observation pattern over the last six steps. The fifth looks for a loop of context-window errors over the last ten events.

Sources: [openhands/controller/stuck.py:72-111](repo://openhands/controller/stuck.py#L72-L111), [openhands/controller/stuck.py:112-134](repo://openhands/controller/stuck.py#L112-L134), [openhands/controller/stuck.py:258-291](repo://openhands/controller/stuck.py#L258-L291)

`_is_stuck` checks the delegate first and then the parent, so a stuck child stops the parent's step as well. A stuck result is reported as `AgentStuckInLoopError` through the normal error path.

Sources: [openhands/controller/agent_controller.py:1067-1077](repo://openhands/controller/agent_controller.py#L1067-L1077), [openhands/controller/agent_controller.py:846-855](repo://openhands/controller/agent_controller.py#L846-L855)

## Persistence

`save_to_session` pickles the state with its conversation statistics set aside, base64-encodes the bytes, and writes the result to `agent_state.pkl` in the conversation's directory. The code's comment says the statistics handle their own saving. `restore_from_session` reads the same file. A restored state keeps the history and counters, so a session can resume after a restart.

Sources: [openhands/controller/state/state.py:122-149](repo://openhands/controller/state/state.py#L122-L149), [openhands/controller/state/state.py:150-190](repo://openhands/controller/state/state.py#L150-L190), [openhands/storage/locations.py:29-30](repo://openhands/storage/locations.py#L29-L30)

The default step limit comes from `OH_MAX_ITERATIONS`, which is 500, and the configuration field `max_iterations` defaults to that value. The per-task budget defaults to no limit.

Sources: [openhands/core/config/config_utils.py:8-8](repo://openhands/core/config/config_utils.py#L8-L8), [openhands/core/config/openhands_config.py:98-99](repo://openhands/core/config/openhands_config.py#L98-L99)
