---
title: "Security and Confirmation"
---
## Overview

Each action can carry a `security_risk` level, from `UNKNOWN` through `LOW`, `MEDIUM` and `HIGH`. Two things use it. The security analyzer sets the level, and confirmation mode holds a `HIGH` action until the user accepts or rejects it. The check runs in the controller, after the agent has chosen the action and before the action is written to the stream.

Sources: [openhands/events/action/action.py:8-21](repo://openhands/events/action/action.py#L8-L21), [openhands/controller/agent_controller.py:919-960](repo://openhands/controller/agent_controller.py#L919-L960)

## Risk levels

`ActionSecurityRisk` has four values: `UNKNOWN` is -1, and `LOW`, `MEDIUM` and `HIGH` are 0, 1 and 2. `ActionConfirmationStatus` has three: `AWAITING_CONFIRMATION`, `CONFIRMED` and `REJECTED`. An action's confirmation status is the state the runtime and the event stream use to decide whether the action runs.

Sources: [openhands/events/action/action.py:8-21](repo://openhands/events/action/action.py#L8-L21)

The agent can also rate an action itself. When the model's tool call includes a `security_risk` argument with a known level, that level is set on the action. An unknown level is logged and ignored.

Sources: [openhands/agenthub/codeact_agent/function_calling.py:59-72](repo://openhands/agenthub/codeact_agent/function_calling.py#L59-L72)

## Choosing an analyzer

The runtime builds the analyzer from `security.security_analyzer`. The registry maps `invariant` to `InvariantAnalyzer` and `llm` to `LLMRiskAnalyzer`. With no name configured, no analyzer exists, and the controller treats every action as `UNKNOWN`.

Sources: [openhands/runtime/base.py:195-204](repo://openhands/runtime/base.py#L195-L204), [openhands/security/options.py:1-8](repo://openhands/security/options.py#L1-L8), [openhands/core/config/security_config.py:12-13](repo://openhands/core/config/security_config.py#L12-L13)

The controller calls the analyzer for each action that is checked. An exception from the analyzer sets the level to `UNKNOWN` and logs a warning. With an analyzer set, an `UNKNOWN` level does not by itself require confirmation. With no analyzer configured, the level is `UNKNOWN`, and the comment there calls this a fail-safe that makes confirmation required.

Sources: [openhands/controller/agent_controller.py:204-242](repo://openhands/controller/agent_controller.py#L204-L242)

`LLMRiskAnalyzer` keeps the level the agent set. It returns `LOW`, `MEDIUM` or `HIGH` as given, and `UNKNOWN` for anything else.

Sources: [openhands/security/llm/analyzer.py:12-41](repo://openhands/security/llm/analyzer.py#L12-L41)

`InvariantAnalyzer` checks each new action against an Invariant policy. Its `security_risk` adds the action to its trace and runs the policy check. `get_risk` reads `risk=` values from the policy's results and returns the highest one. A result with no recognised level gives `LOW`.

Sources: [openhands/security/invariant/analyzer.py:15-30](repo://openhands/security/invariant/analyzer.py#L15-L30), [openhands/security/invariant/analyzer.py:92-108](repo://openhands/security/invariant/analyzer.py#L92-L108), [openhands/security/invariant/analyzer.py:110-116](repo://openhands/security/invariant/analyzer.py#L110-L116)

## Confirmation mode

Confirmation mode is off by default. Each session can override the setting. When it is on, only command, IPython, interactive browse, file edit and file read actions go through the analyzer and the check.

Sources: [openhands/core/config/security_config.py:12](repo://openhands/core/config/security_config.py#L12), [openhands/server/session/session.py:143-146](repo://openhands/server/session/session.py#L143-L146), [openhands/controller/agent_controller.py:919-926](repo://openhands/controller/agent_controller.py#L919-L926)

For those actions, the controller marks the action `AWAITING_CONFIRMATION` when its risk is `HIGH`, or when its risk is `UNKNOWN` and no analyzer is set. The state becomes `AWAITING_USER_CONFIRMATION`. The action is still written to the stream, but the runtime does not run it while it is waiting.

Sources: [openhands/controller/agent_controller.py:935-968](repo://openhands/controller/agent_controller.py#L935-L968)

The runtime does not run an action that is still waiting. `run_action` returns a `NullObservation` for it, and a rejected action gets a `UserRejectObservation` that tells the agent to wait for further input.

Sources: [openhands/runtime/base.py:952-972](repo://openhands/runtime/base.py#L952-L972), [openhands/runtime/impl/action_execution/action_execution_client.py:288-304](repo://openhands/runtime/impl/action_execution/action_execution_client.py#L288-L304)

## Answering a confirmation

A client answers by adding a `ChangeAgentStateAction` with source `USER` and state `USER_CONFIRMED` or `USER_REJECTED`. The terminal program does this directly. The controller moves the state, sets the pending action's confirmation to `CONFIRMED` or `REJECTED`, and writes the action to the stream again. The runtime then runs it or refuses it.

Sources: [openhands/controller/agent_controller.py:494-500](repo://openhands/controller/agent_controller.py#L494-L500), [openhands/controller/agent_controller.py:658-669](repo://openhands/controller/agent_controller.py#L658-L669), [openhands/cli/main.py:253-285](repo://openhands/cli/main.py#L253-L285)

After a confirmed action runs, the controller returns to `RUNNING`. After a rejected one, it moves to `AWAITING_USER_INPUT` so the user can say what to do next.

Sources: [openhands/controller/agent_controller.py:519-547](repo://openhands/controller/agent_controller.py#L519-L547)

## The terminal program

The terminal program turns on confirmation mode and the LLM analyzer by default, and marks the agent as running in CLI mode. In that mode the controller sets `AWAITING_CONFIRMATION` on every checked action and does not apply the `HIGH` rule. The terminal then asks the user and sends the answer as the state change above.

Sources: [openhands/cli/main.py:664-680](repo://openhands/cli/main.py#L664-L680), [openhands/controller/agent_controller.py:943-949](repo://openhands/controller/agent_controller.py#L943-L949)

An auto-confirm option in the terminal confirms actions whose risk is not `HIGH`. It reads the pending action's risk and sends `USER_CONFIRMED` without asking.

Sources: [openhands/cli/main.py:256-272](repo://openhands/cli/main.py#L256-L272)

The controller that makes these decisions is described in [[Agent Controller]], and the runtime that refuses waiting actions is described in [[Runtime Interface]].

Sources: [openhands/controller/agent_controller.py:821-870](repo://openhands/controller/agent_controller.py#L821-L870)
