---
type: architecture-component
title: Security Analysis and Action Gating
description: How each agent action is assigned a risk level by a pluggable security analyzer (Invariant policy checks or the LLM's own risk field), how the controller turns that risk and the confirmation mode into an AWAITING_USER_CONFIRMATION pause, how the user's decision resumes or cancels the action, and where the sandbox refuses to run an unconfirmed or rejected action.
tags: [security, risk-analysis, confirmation-mode, invariant, llm-risk, action-gating, approval, sandbox-safety]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:30:54.023Z
sources:
  - id: openwiki-source-2129d0084f64a3f5714baf90
    resource: repo://openhands/controller/agent_controller.py
  - id: openwiki-source-2c7a0ad4eabf44e428f77fa8
    resource: repo://openhands/events/action/action.py
  - id: openwiki-source-f38350b0cd074145e71451f8
    resource: repo://openhands/runtime/base.py
  - id: openwiki-source-8aa44ffeca89d68fc256f906
    resource: repo://openhands/runtime/impl/action_execution/action_execution_client.py
  - id: openwiki-source-657301d13de1a872ca7647eb
    resource: repo://openhands/security/analyzer.py
  - id: openwiki-source-a2a242ef7d71e849ead8ac57
    resource: repo://openhands/security/invariant/analyzer.py
  - id: openwiki-source-f5d47f95ebeced62d5070711
    resource: repo://openhands/security/llm/analyzer.py
  - id: openwiki-source-610d0b16c84de208359adc6c
    resource: repo://openhands/server/session/session.py
generated: { by: "claude-code", at: "2026-11-16T18:30:54.023Z" }
---

# Security Analysis and Action Gating

OpenHands can run commands on a user's machine or in a sandbox, so it needs a gate between "the agent decided to do X" and "X runs". That gate has three parts: a **risk assessment** attached to each action, a **policy decision** in the agent controller that may pause the action for confirmation, and a **refusal** in the runtime for actions that are still pending or were rejected. Gating is opt-in through configuration, with a fail-safe default when no analyzer is configured.

## Risk levels

`ActionSecurityRisk` (`openhands/events/action/action.py` ~L14-L18) is an integer enum with four values: `UNKNOWN` (-1), `LOW` (0), `MEDIUM` (1), and `HIGH` (2). Every `Action` carries a `security_risk` value. The LLM can set it when it creates a tool call (the converter in `openhands/agenthub/codeact_agent/function_calling.py` reads it from the tool arguments, via `set_security_risk`), and an analyzer can overwrite it.

## Analyzer interface

`SecurityAnalyzer` (`openhands/security/analyzer.py`, class at ~L8) is the base class. It defines:

- `security_risk(action) -> ActionSecurityRisk` (~L21). The base implementation raises `NotImplementedError`, so every configured analyzer must override it.
- `handle_api_request(request)` (~L15), which lets an analyzer expose its own HTTP endpoints.
- `close()` (~L27).

`SecurityAnalyzers` in `openhands/security/options.py` maps a configuration name to a class: `invariant` maps to `InvariantAnalyzer` and `llm` maps to `LLMRiskAnalyzer`. An unknown name falls back to the base class, which raises on first use.

### Invariant analyzer

`InvariantAnalyzer` (`openhands/security/invariant/analyzer.py`, class at ~L15) checks each action against an Invariant policy. Its constructor (~L25) takes an optional policy string. When none is given it asks the Invariant service for the default template, and it falls back to an empty policy if that is unavailable. It builds a monitor from the policy text.

`security_risk` (~L110) turns the action into trace elements (`parse_element`), appends them to a growing trace, and checks the trace against the monitor. A check error returns `UNKNOWN`. Otherwise `get_risk` (~L92) reads the `risk=<level>` markers from the violation messages, maps `high`, `medium`, and `low` to the enum, and returns the highest risk found. A check with no matching violations returns `LOW`.

Because the analyzer accumulates the trace across the conversation, a later action can be judged in light of earlier ones.

### LLM risk analyzer

`LLMRiskAnalyzer` (`openhands/security/llm/analyzer.py`, class at ~L12) does not call a model itself. Its `security_risk` returns the `security_risk` value already on the action, which the agent's own tool call set. Unrecognized values become `UNKNOWN`. Its purpose is to let the controller apply confirmation policy to the LLM's self-assessment through the same code path as the other analyzers.

## Where the analyzer runs

The runtime owns the analyzer instance. `Runtime.__init__` (`openhands/runtime/base.py` ~L194-L205) creates one from `config.security.security_analyzer` when it is set, and leaves `security_analyzer` as `None` otherwise. The agent session and `create_controller` pass that attribute to the `AgentController` (`openhands/core/setup.py` ~L241, `openhands/server/session/agent_session.py` ~L443). The analyzer is therefore shared by the controller and the runtime's `security_analyzer` attribute for one session.

## The gating decision

`AgentController._step` (`openhands/controller/agent_controller.py`) decides gating for each new action (the block is around lines 925-975):

1. The gate applies only when `state.confirmation_mode` is on, and only to runnable actions of type `CmdRunAction`, `IPythonRunCellAction`, `BrowseInteractiveAction`, `FileEditAction`, or `FileReadAction` (`agent_controller.py` ~L919-L926). With confirmation mode off, no analysis runs and actions execute directly. Other action types, including MCP calls, are not assessed by this block.
2. `_handle_security_analyzer` (~L204-L242) runs. With an analyzer configured, it replaces `security_risk` with the analyzer's answer, and on an exception it sets `UNKNOWN` and logs a warning. Without an analyzer it sets the risk to `UNKNOWN`.
3. The controller computes two flags:
   - `is_high_security_risk` is true when the risk is `HIGH`.
   - `is_ask_for_every_action` is true when the risk is `UNKNOWN` and no analyzer is configured. This is the fail-safe: without an analyzer, confirmation is requested for every action.
4. In CLI mode (`agent.config.cli_mode`) the action is always marked `AWAITING_CONFIRMATION`, because the CLI does its own risk handling.
5. Otherwise the action is marked `AWAITING_CONFIRMATION` only when either flag is true (the block already requires confirmation mode, per step 1).
6. The action is stored as `_pending_action`. If it is marked `AWAITING_CONFIRMATION`, the agent state becomes `AWAITING_USER_CONFIRMATION` before the action is published (~L965-L969).

Confirmation mode is set from the `[security]` config section (`SecurityConfig.confirmation_mode`, default `False`) and can be overridden per session from user settings (`openhands/server/session/session.py` ~L143-L146).

## The user's decision

The user answers by publishing a `ChangeAgentStateAction` with `USER_CONFIRMED` or `USER_REJECTED`. The CLI does this (`openhands/cli/main.py` ~L250-L280). The controller handles the change in `set_agent_state_to` (~L655-L668): it stamps the pending action with `CONFIRMED` or `REJECTED`, clears its thought, and republishes it to the stream.

- The republished action then reaches the runtime. `send_action_for_execution` runs a `CONFIRMED` action normally and returns a `UserRejectObservation` for a `REJECTED` action (`openhands/runtime/impl/action_execution/action_execution_client.py`, ~L300-L310). An action still `AWAITING_CONFIRMATION` returns a `NullObservation`, so it is never run while it waits.
- When the observation for the pending action arrives, the controller clears `_pending_action` and moves the agent to `RUNNING` (after `USER_CONFIRMED`) or to `AWAITING_USER_INPUT` (after `USER_REJECTED`) (~L536-L550). The agent then replans, and a rejected action is visible to it as a user-rejected result.

The web client's path for sending the confirmation is not traced in this page; the CLI path is the one verified in the code.

## Invariants and failure behavior

- With confirmation mode on, an action of an assessed type whose risk is unknown and that has no analyzer behind it waits for the user rather than running silently.
- An analyzer exception does not block the action. It sets `UNKNOWN`, which, with confirmation mode on, pauses for the user.
- A pending action is not executed until it has a `CONFIRMED` state or no confirmation state at all, because the runtime returns `NullObservation` for the pending state.
- Only one action can be pending, which is what makes a single confirmation decision unambiguous.

## Configuration

- `[security] confirmation_mode` (default `false`) turns on the approval pause.
- `[security] security_analyzer` (default unset) selects `invariant` or `llm`.
- Analyzer-specific settings are given with the analyzer; the Invariant analyzer accepts a policy string.

<!-- openwiki: broken internal link [/openwiki/architecture/configuration.md] link "/openwiki/architecture/configuration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
See [Configuration Model](/openwiki/architecture/configuration.md).

## Extension seams

- A new analyzer is a `SecurityAnalyzer` subclass that implements `security_risk`, registered in `SecurityAnalyzers`.
- The risk policy is in the controller's `_step`, so a different confirmation policy changes only that block.
- An analyzer can add HTTP endpoints through `handle_api_request`. The security routes in `openhands/server/routes/security.py` forward requests to the conversation's analyzer and return 404 when none is configured.

## Representative tests

- `tests/unit/security/` (1 test file) covers the analyzers.
- `tests/unit/controller/test_agent_controller.py` covers confirmation gating and state transitions.

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/agent-controller.md] link "/openwiki/architecture/agent-controller.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Agent Controller and Step Loop](/openwiki/architecture/agent-controller.md)
<!-- openwiki: broken internal link [/openwiki/architecture/runtime-sandbox.md] link "/openwiki/architecture/runtime-sandbox.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Runtime and Sandbox Execution](/openwiki/architecture/runtime-sandbox.md)
<!-- openwiki: broken internal link [/openwiki/architecture/configuration.md] link "/openwiki/architecture/configuration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Configuration Model](/openwiki/architecture/configuration.md)
