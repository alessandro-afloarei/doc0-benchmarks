---
title: "Security Analyzers"
---
## Overview

Security analysis decides how risky an action is before it runs. Each action that can change the environment carries a `security_risk` value (`UNKNOWN`, `LOW`, `MEDIUM` or `HIGH`). A `SecurityAnalyzer` assigns that value, and the controller uses it to decide whether to ask the user before the action is executed. The analyser is chosen by the `security_analyzer` setting, and the confirmation rule is turned on by `confirmation_mode`. This page covers both halves; the stepping code that calls them is on [[Agent Controller]].

Sources: [openhands/security/analyzer.py:8-29](repo://openhands/security/analyzer.py#L8-L29), [openhands/core/config/security_config.py:4-16](repo://openhands/core/config/security_config.py#L4-L16)

## Configuration

The `[security]` section holds two values. `confirmation_mode` is off by default and, when on, makes the controller wait for approval of risky actions. `security_analyzer` names the analyser; it is empty by default, which means no analyser runs.

Sources: [openhands/core/config/security_config.py:12-16](repo://openhands/core/config/security_config.py#L12-L16), [openhands/core/config/openhands_config.py:69-69](repo://openhands/core/config/openhands_config.py#L69-L69)

The analyser's name is looked up in a table with two entries, `invariant` and `llm`. Each runtime creates its analyser when it is built, so each conversation has one analyser that lives as long as its runtime. An unknown name falls back to the base class, whose `security_risk` raises, so the controller records `UNKNOWN` for each action.

Sources: [openhands/security/options.py:1-8](repo://openhands/security/options.py#L1-L8), [openhands/runtime/base.py:195-206](repo://openhands/runtime/base.py#L195-L206)

## The base class

`SecurityAnalyzer` defines four methods. `security_risk(action)` returns the risk for one action, and `handle_api_request` answers the analyser's own HTTP route. Both raise `NotImplementedError` in the base class, so a subclass must provide them. `close` releases resources and does nothing by default.

Sources: [openhands/security/analyzer.py:8-29](repo://openhands/security/analyzer.py#L8-L29)

## What the controller does with the risk

The controller calls the analyser only for shell commands, IPython cells, interactive browsing, and file reads and edits. When an analyser is configured, its answer replaces the action's `security_risk`. If the analyser raises, the risk becomes `UNKNOWN`, and the run continues.

Sources: [openhands/controller/agent_controller.py:204-243](repo://openhands/controller/agent_controller.py#L204-L243), [openhands/controller/agent_controller.py:919-932](repo://openhands/controller/agent_controller.py#L919-L932)

With no analyser configured, every such action is treated as `UNKNOWN`. The comment in the code calls this a fail-safe: confirmation is then asked for every action, which is why the confirmation path is safe to enable without an analyser.

Sources: [openhands/controller/agent_controller.py:236-243](repo://openhands/controller/agent_controller.py#L236-L243)

The confirmation rule is applied after the analyser runs. In a non-CLI run, an action is held for approval when its risk is `HIGH`, or when the risk is `UNKNOWN` and no analyser is configured, and confirmation mode is on. The CLI does its own risk handling, so it always marks such actions as awaiting confirmation.

Sources: [openhands/controller/agent_controller.py:933-960](repo://openhands/controller/agent_controller.py#L933-L960)

## The LLM analyser

`LLMRiskAnalyzer` trusts the risk the model reported. The model sets `security_risk` on the tool call, and the analyser returns it when it is a known level. An action with no `security_risk` attribute gets `UNKNOWN` without a log line; a value that is not a known level, including none, is logged as a warning and also becomes `UNKNOWN`.

Sources: [openhands/security/llm/analyzer.py:12-42](repo://openhands/security/llm/analyzer.py#L12-L42)

The model sets that value through the `security_risk` argument of the tool call. `set_security_risk` copies a known level onto the action, and that one value then feeds both the confirmation rule and this analyser.

Sources: [openhands/agenthub/codeact_agent/function_calling.py:59-72](repo://openhands/agenthub/codeact_agent/function_calling.py#L59-L72)

## The Invariant analyser

`InvariantAnalyzer` sends the actions to a policy checker that runs in its own Docker container, `openhands-invariant-server`, started from an image. It creates or reuses the container at construction, and it needs a Docker client, so it fails without Docker.

Sources: [openhands/security/invariant/analyzer.py:15-62](repo://openhands/security/invariant/analyzer.py#L15-L62)

For each action, `security_risk` converts the action into trace elements, appends them to the trace, and checks them against the policy. A policy error logs a warning and returns `UNKNOWN`. Otherwise the risk comes from the policy results: the highest level named in a matched result wins, and an action that matches nothing is `LOW`.

Sources: [openhands/security/invariant/analyzer.py:92-125](repo://openhands/security/invariant/analyzer.py#L92-L125)

`close` stops the checker's container.

Sources: [openhands/security/invariant/analyzer.py:89-91](repo://openhands/security/invariant/analyzer.py#L89-L91)
