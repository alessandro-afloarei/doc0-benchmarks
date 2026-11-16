---
type: subsystem
title: Security Analyzers and Confirmation Mode
description: How OpenHands assesses the risk of agent actions — LLM-declared security_risk tool parameters, the pluggable SecurityAnalyzer interface with LLM and Invariant implementations, confirmation mode and its decision rules, the CLI and web confirmation flows, and the security API route.
tags: [security, confirmation-mode, risk-assessment, invariant, human-in-the-loop]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:35:38.671Z
sources:
  - id: openwiki-source-5b25431a1b0516f40efcc1e1
    resource: repo://openhands/agenthub/codeact_agent/prompts/security_risk_assessment.j2
  - id: openwiki-source-25e60068c55acb66b3c4b3ad
    resource: repo://openhands/agenthub/codeact_agent/tools/bash.py
  - id: openwiki-source-01060e6dfbf822c816cd8e07
    resource: repo://openhands/agenthub/codeact_agent/tools/security_utils.py
  - id: openwiki-source-c09980a03acbee243c8816ff
    resource: repo://openhands/core/config/security_config.py
  - id: openwiki-source-2c7a0ad4eabf44e428f77fa8
    resource: repo://openhands/events/action/action.py
  - id: openwiki-source-f38350b0cd074145e71451f8
    resource: repo://openhands/runtime/base.py
  - id: openwiki-source-8aa44ffeca89d68fc256f906
    resource: repo://openhands/runtime/impl/action_execution/action_execution_client.py
  - id: openwiki-source-a2a242ef7d71e849ead8ac57
    resource: repo://openhands/security/invariant/analyzer.py
  - id: openwiki-source-cf718106e636545891370c49
    resource: repo://openhands/security/invariant/policies.py
  - id: openwiki-source-f5d47f95ebeced62d5070711
    resource: repo://openhands/security/llm/analyzer.py
  - id: openwiki-source-9d573bf693875e13ea554451
    resource: repo://openhands/security/options.py
  - id: openwiki-source-558d9b685e014bb818b232a7
    resource: repo://openhands/server/routes/security.py
  - id: openwiki-source-a3e1d91fcd3a9a6f3c96821f
    resource: repo://openhands/server/session/agent_session.py
  - id: openwiki-source-610d0b16c84de208359adc6c
    resource: repo://openhands/server/session/session.py
generated: { by: "claude-code", at: "2026-11-16T07:35:38.671Z" }
---

# Security Analyzers and Confirmation Mode

OpenHands can ask a human before it runs a potentially dangerous action. There are three layers:

1. The **LLM declares a risk level** for each tool call.
2. An optional **security analyzer** confirms or overrides that risk.
3. **Confirmation mode** in the [agent controller](../architecture/agent-controller.md#confirmation-mode-and-security) decides whether to pause for the user.

## Risk levels

`ActionSecurityRisk` (`openhands/events/action/action.py`) is an int enum: `UNKNOWN = -1`, `LOW = 0`, `MEDIUM = 1`, `HIGH = 2`. Command, IPython, browser, and file-edit actions carry a `security_risk` field. It is serialized into the action's `args` ([Event Stream](../architecture/event-stream.md#serialization)).

## LLM-declared risk

The CodeAct tools `execute_bash`, `execute_ipython_cell`, `str_replace_editor`, and `browser` (and the deprecated `edit_file`) include a `security_risk` parameter with values `LOW`, `MEDIUM`, or `HIGH` (`codeact_agent/tools/security_utils.py`). It is a **required** parameter for the first four. The system prompt includes `security_risk_assessment.j2`, which defines the levels. The definitions depend on the mode:

- **CLI mode** (the agent runs directly on the user's machine): LOW means read-only. MEDIUM means project-scoped edits or running project scripts. HIGH means system-level changes, global installs, `sudo`, deleting critical files, running untrusted downloads, or sending data out.
- **Sandbox mode**: LOW means read-only inside the container. MEDIUM means edits and installs inside the container. HIGH means data exfiltration, host filesystem access, privileged operations, or unverified networked binaries.
- In both modes, anything that sends sensitive data out of the environment is HIGH.

`function_calling.set_security_risk` copies a valid value onto the action and logs a warning for an invalid one ([Agents](../agents/agenthub.md#tool-calls-to-actions)).

## Analyzers

`SecurityAnalyzer` (`openhands/security/analyzer.py`) is the interface:

- `async security_risk(action) -> ActionSecurityRisk`
- `async handle_api_request(request)` for analyzer-specific HTTP APIs
- `async close()`

The registry lives in `openhands/security/options.py:SecurityAnalyzers`:

| Name | Class | Behavior |
| --- | --- | --- |
| `llm` | `LLMRiskAnalyzer` (`security/llm/analyzer.py`) | Uses the risk the LLM provided. Missing or unrecognized values become `UNKNOWN`. The API handler just returns `{'status': 'ok'}`. |
| `invariant` | `InvariantAnalyzer` (`security/invariant/`) | Starts or reuses a Docker container running `ghcr.io/invariantlabs-ai/server:openhands`. It converts each action into a trace element (`parser.py`, `nodes.py`) and checks it against an Invariant policy. The default policy (`policies.py`) flags secrets in bash commands and Semgrep findings in Python or bash at `risk=medium`. The result is the highest `risk=` among the policy violations, `LOW` if there are none, or `UNKNOWN` if the policy check fails. It doesn't override `handle_api_request`, so the security API route has nothing extra to call for it. |

To add an analyzer, subclass `SecurityAnalyzer` and add it to `SecurityAnalyzers`.

`Runtime.__init__` creates the analyzer named by `config.security.security_analyzer` and keeps it in `runtime.security_analyzer`. `AgentSession._create_controller` passes it to the controller.

## Confirmation mode

Configured in `[security]` (`SecurityConfig`): `confirmation_mode` (default `false`) and `security_analyzer` (default none). Per-user settings override both in the web app (`Session`), and the CLI turns both on by default ([CLI](../interfaces/cli.md#configuration-in-cli-mode)).

In `AgentController._step`, when confirmation mode is on and the action is a `CmdRunAction`, `IPythonRunCellAction`, `BrowseInteractiveAction`, `FileEditAction`, or `FileReadAction`:

1. `_handle_security_analyzer(action)` asks the analyzer for the risk. If there is no analyzer, or the analyzer throws, the risk becomes `UNKNOWN`.
2. The action is marked `AWAITING_CONFIRMATION` when:
   - in **CLI mode**: always, because the CLI applies its own rules;
   - otherwise: the risk is `HIGH`, or the risk is `UNKNOWN` and no analyzer is configured. That second case makes "confirmation mode with no analyzer" ask about every such action.
3. The controller moves to `AWAITING_USER_CONFIRMATION` and publishes the action. The runtime returns a `NullObservation` for actions that are awaiting confirmation, so nothing runs ([Runtime Architecture](../runtime/runtime-architecture.md#actionexecutionclient)).
4. The user replies with `ChangeAgentStateAction(USER_CONFIRMED | USER_REJECTED)`. The controller sets the action's `confirmation_state` and publishes it again. A confirmed action runs. A rejected one produces a `UserRejectObservation`, and the agent moves to `AWAITING_USER_INPUT`.

### Front ends

- **Web UI:** the conversation view shows confirm and reject controls when the agent state is `awaiting_user_confirmation`. The analyzer is chosen in settings. `frontend/src/api/invariant-service.ts` calls the security API route.
- **CLI:** the prompt shows the risk level and offers *yes*, *no*, *always* (approve everything from now on), or *auto high-risk*, which approves everything except `HIGH` without asking.

## Security API route

`openhands/server/routes/security.py` mounts `/api/conversations/{conversation_id}/security/{path}` for all HTTP methods and forwards the request to the conversation's `security_analyzer.handle_api_request`. It returns 404 when no analyzer is configured.

## Related protections

These sit outside the analyzers:

- Secrets are masked in events ([Event Stream](../architecture/event-stream.md#adding-an-event)).
- The sandbox API requires a session key ([Runtime Architecture](../runtime/runtime-architecture.md#the-action-execution-server-inside-the-sandbox)).
- The CLI asks whether you trust the folder before starting.
- Stuck-loop detection, iteration limits, and budget limits apply ([Agent Controller](../architecture/agent-controller.md)).

## Tests

`tests/unit/security/test_security.py` covers the Invariant parser, policy evaluation, and risk mapping, plus the LLM analyzer. `tests/unit/controller/test_agent_controller.py` covers how confirmation mode makes its decisions.

## Related pages

- [Agent Controller and State](../architecture/agent-controller.md)
- [Configuration System](../configuration/config-system.md)
- [Command-Line Interface](../interfaces/cli.md)
