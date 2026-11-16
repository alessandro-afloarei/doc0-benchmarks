---
title: "Stuck Detection"
---
## Overview

An LLM agent can fall into a loop: running the same failing command again and again, repeating the same message to itself, or bouncing between two actions. Each turn costs money and moves the task nowhere. `StuckDetector` inspects the agent's history before every step and reports when it recognises one of five loop patterns; the [[Agent Controller]] then stops the agent with an error instead of calling the LLM again.

Sources: [openhands/controller/stuck.py:18-110](repo://openhands/controller/stuck.py#L18-L110)

The check runs inside `_step`, after the budget sync and before the iteration and budget flags. The controller also asks its active delegate, so a looping sub-agent stops the whole task.

Sources: [openhands/controller/agent_controller.py:845-853](repo://openhands/controller/agent_controller.py#L845-L853), [openhands/controller/agent_controller.py:1066-1076](repo://openhands/controller/agent_controller.py#L1066-L1076)

## What history is checked

### Interactive and headless modes

`is_stuck(headless_mode)` takes the same `headless_mode` flag as the controller. In interactive mode it looks only at events after the last user message: once a user has spoken, earlier repetition no longer counts, because the user may have redirected the agent. In headless mode, used by evaluation and the resolver, there is no user to intervene, so it looks at the whole history.

Sources: [openhands/controller/stuck.py:28-53](repo://openhands/controller/stuck.py#L28-L53)

### Filtering

From that slice it removes user messages, `NullAction` and `NullObservation`. With fewer than three events left, the agent cannot be in a loop yet and the check ends. Otherwise it collects, walking backwards from the end, the last four actions and the last four observations, wherever they fall.

Sources: [openhands/controller/stuck.py:55-86](repo://openhands/controller/stuck.py#L55-L86)

### Equality

Events are compared with `_eq_no_pid`, which is dataclass equality with two exceptions. Two command outputs are equal when the command and exit code match, ignoring the process id and output text that change on every run. Two IPython cells that both call `edit_file_by_replace(` are equal when their first three lines match and the code has more than two lines, so edits that differ only in their replacement text still count as repeats.

Sources: [openhands/controller/stuck.py:384-408](repo://openhands/controller/stuck.py#L384-L408)

## The five scenarios

### Scenario table

The scenarios are checked in order and the first match returns true.

Sources: [openhands/controller/stuck.py:88-110](repo://openhands/controller/stuck.py#L88-L110)

| # | Name | Pattern | Minimum history |
| --- | --- | --- | --- |
| 1 | Repeating action and observation | the last four actions are equal and the last four observations are equal | 4 actions, 4 observations |
| 2 | Repeating action with errors | the last three actions are equal and the last three observations are all `ErrorObservation`, or all the same IPython syntax error | 3 actions, 3 observations |
| 3 | Monologue | the agent's last three messages are identical, with no observation between them | 3 agent messages |
| 4 | Alternating pattern | over the last six actions and observations, items 0, 2, 4 are equal and items 1, 3, 5 are equal | 6 events after filtering |
| 5 | Context window loop | among the last ten `AgentCondensationObservation`s, two consecutive ones have nothing between them | 10 condensation observations |

Sources: [openhands/controller/stuck.py:112-133](repo://openhands/controller/stuck.py#L112-L133), [openhands/controller/stuck.py:135-184](repo://openhands/controller/stuck.py#L135-L184), [openhands/controller/stuck.py:258-290](repo://openhands/controller/stuck.py#L258-L290), [openhands/controller/stuck.py:292-334](repo://openhands/controller/stuck.py#L292-L334), [openhands/controller/stuck.py:336-382](repo://openhands/controller/stuck.py#L336-L382)

### Syntax-error loops in IPython

Scenario 2 treats IPython output specially, because a cell that fails to parse does not produce an `ErrorObservation`. Three identical cells count as a loop only when all three outputs show the same syntax error in the same place. For an unterminated string literal, the third-to-last line (the line above OpenHands' own `[Jupyter current working directory:` and `[Jupyter Python interpreter:` trailer lines) must hold the error and be identical across all three. For invalid syntax and incomplete input, each output must have at least six lines, start with the same `Cell In[1], line` header, and end with the error above the trailer.

Sources: [openhands/controller/stuck.py:19-23](repo://openhands/controller/stuck.py#L19-L23), [openhands/controller/stuck.py:151-183](repo://openhands/controller/stuck.py#L151-L183), [openhands/controller/stuck.py:186-256](repo://openhands/controller/stuck.py#L186-L256)

### Monologue and observations

A monologue is a loop only if the agent is talking to itself: if any observation appears between the first and last of the three repeated messages, the agent did something in between and may still recover.

Sources: [openhands/controller/stuck.py:276-289](repo://openhands/controller/stuck.py#L276-L289)

### Condensation loops

Scenario 5 catches a failure of context management: the LLM keeps overflowing its context window, the controller keeps requesting condensation, and condensing does not free enough room, so condensation observations pile up back to back. [[Context Condensers]] explains the condensation that produces these observations.

Sources: [openhands/controller/stuck.py:336-349](repo://openhands/controller/stuck.py#L336-L349), [openhands/controller/agent_controller.py:907-913](repo://openhands/controller/agent_controller.py#L907-L913)

## What happens when the agent is stuck

When `_is_stuck` is true, `_step` passes `AgentStuckInLoopError('Agent got stuck in a loop')` to `_react_to_exception` and returns without calling the agent. The error is stored as `last_error`, a status message goes to the UI, and the agent moves to `ERROR`, which also resets any pending action. In interactive mode the user can send a new message to set the agent running again; since detection then only looks after that message, the old loop no longer counts.

Sources: [openhands/controller/agent_controller.py:847-853](repo://openhands/controller/agent_controller.py#L847-L853), [openhands/controller/agent_controller.py:308-354](repo://openhands/controller/agent_controller.py#L308-L354), [openhands/core/exceptions.py:40-41](repo://openhands/core/exceptions.py#L40-L41)

## Critics

Where stuck detection judges a run while it happens, a critic judges it afterwards. `BaseCritic.evaluate(events, git_patch)` returns a `CriticResult` with a score and a message, and the result counts as a success when the score is at least 0.5.

Sources: [openhands/critic/base.py:8-27](repo://openhands/critic/base.py#L8-L27)

The one built-in critic, `AgentFinishedCritic`, scores 1 when the last action in the history is an `AgentFinishAction` and 0 otherwise, and also scores 0 when a git patch is given but empty. The SWE-bench runner uses it in its iterative mode to decide which instances to retry with another attempt (see [[Evaluation Harness]]).

Sources: [openhands/critic/finish_critic.py:6-26](repo://openhands/critic/finish_critic.py#L6-L26), [evaluation/benchmarks/swe_bench/run_infer.py:878-900](repo://evaluation/benchmarks/swe_bench/run_infer.py#L878-L900)
