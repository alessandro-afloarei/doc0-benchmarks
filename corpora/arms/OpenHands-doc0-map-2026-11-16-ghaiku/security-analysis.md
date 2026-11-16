---
title: "Security Analysis and Confirmation"
---
## Overview

Before a risky action runs, OpenHands can ask a security analyzer how risky it is. The analyzer returns an `ActionSecurityRisk` level, and the controller uses that level to decide whether the user must confirm the action first. Analysis and confirmation only apply in confirmation mode, and only to a fixed set of action types. Without an analyzer, every such action is treated as unknown risk, which still requires confirmation.

Sources: [openhands/security/analyzer.py:8-14](repo://openhands/security/analyzer.py#L8-L14) [openhands/controller/agent_controller.py:919-929](repo://openhands/controller/agent_controller.py#L919-L929)

## Choosing an analyzer

`SecurityAnalyzers` maps two names to classes: `invariant` and `llm`. The `security_analyzer` setting in the `[security]` section selects one of them, and `confirmation_mode` turns confirmation on. The runtime creates the analyzer when it is built, and a name that is not in the map falls back to the base class, which raises on use.

Sources: [openhands/security/options.py:1-8](repo://openhands/security/options.py#L1-L8) [openhands/core/config/security_config.py:4-13](repo://openhands/core/config/security_config.py#L4-L13) [openhands/runtime/base.py:192-202](repo://openhands/runtime/base.py#L192-L202)

## The analyzer contract

`SecurityAnalyzer` is the base class. A subclass implements `security_risk`, which takes an action and returns its risk level, and `handle_api_request`, which takes an API request addressed to the analyzer. The base implementations raise `NotImplementedError`. `close` releases any resources.

Sources: [openhands/security/analyzer.py:8-29](repo://openhands/security/analyzer.py#L8-L29)

## The LLM analyzer

`LLMRiskAnalyzer` does not call a model itself. It reads the `security_risk` value that the model set on the action when it proposed it. A value of LOW, MEDIUM or HIGH is returned unchanged; UNKNOWN, a missing attribute, or an unrecognised value all give UNKNOWN.

Sources: [openhands/security/llm/analyzer.py:12-40](repo://openhands/security/llm/analyzer.py#L12-L40)

## The Invariant analyzer

`InvariantAnalyzer` takes an optional policy and a session id, and keeps a trace of every action it has seen. For each action it converts the action into trace elements, appends them to the trace, and checks them with the Invariant monitor. If the check returns an error, the risk is UNKNOWN. Otherwise the results are passed to `get_risk`.

Sources: [openhands/security/invariant/analyzer.py:15-33](repo://openhands/security/invariant/analyzer.py#L15-L33) [openhands/security/invariant/analyzer.py:110-125](repo://openhands/security/invariant/analyzer.py#L110-L125)

`get_risk` reads each result's `risk=` value and maps `high`, `medium` and `low` to the risk levels. It returns the highest level found. When no result names a level, it returns LOW.

Sources: [openhands/security/invariant/analyzer.py:92-108](repo://openhands/security/invariant/analyzer.py#L92-L108)

## What the controller does with the risk

For each action in a confirmation-mode run, the controller calls `_handle_security_analyzer`. With an analyzer, the analyzer's answer replaces the action's risk, and an exception from the analyzer sets the risk to UNKNOWN. Without an analyzer, the risk is set to UNKNOWN. The comment on that branch says the fallback ensures confirmation is required.

Sources: [openhands/controller/agent_controller.py:204-242](repo://openhands/controller/agent_controller.py#L204-L242)

After analysis the controller asks for confirmation when the risk is HIGH, or when it is UNKNOWN and no analyzer is set, and the run is in confirmation mode. In CLI mode it always marks the action as awaiting confirmation and leaves the decision to the CLI. The agent state then becomes `AWAITING_USER_CONFIRMATION`.

Sources: [openhands/controller/agent_controller.py:940-967](repo://openhands/controller/agent_controller.py#L940-L967) [openhands/controller/agent_controller.py:971-977](repo://openhands/controller/agent_controller.py#L971-L977)

The actions that go through this check are shell commands, IPython cells, interactive browser actions, and file reads and edits.

Sources: [openhands/controller/agent_controller.py:919-929](repo://openhands/controller/agent_controller.py#L919-L929)
