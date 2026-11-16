---
type: concept
title: Security Analysis and Confirmation Mode
description: How OpenHands gates risky actions — ActionSecurityRisk levels, LLM-provided risk ratings, the Invariant and LLM security analyzers, how AgentController applies confirmation mode, client-side confirmation flows, secret handling, and the isolation consequences of each runtime.
tags: [security, confirmation-mode, security-analyzer, secrets, risk, sandbox]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:38:52.407Z
sources:
  - id: openwiki-source-2e7cf1ee6ccb20d38552bf97
    resource: repo://openhands/agenthub/codeact_agent/function_calling.py
  - id: openwiki-source-5b25431a1b0516f40efcc1e1
    resource: repo://openhands/agenthub/codeact_agent/prompts/security_risk_assessment.j2
  - id: openwiki-source-01060e6dfbf822c816cd8e07
    resource: repo://openhands/agenthub/codeact_agent/tools/security_utils.py
  - id: openwiki-source-2560404802cbc340c233d2ec
    resource: repo://openhands/cli/main.py
  - id: openwiki-source-2129d0084f64a3f5714baf90
    resource: repo://openhands/controller/agent_controller.py
  - id: openwiki-source-c09980a03acbee243c8816ff
    resource: repo://openhands/core/config/security_config.py
  - id: openwiki-source-f38350b0cd074145e71451f8
    resource: repo://openhands/runtime/base.py
  - id: openwiki-source-a2a242ef7d71e849ead8ac57
    resource: repo://openhands/security/invariant/analyzer.py
  - id: openwiki-source-f5d47f95ebeced62d5070711
    resource: repo://openhands/security/llm/analyzer.py
  - id: openwiki-source-9d573bf693875e13ea554451
    resource: repo://openhands/security/options.py
  - id: openwiki-source-558d9b685e014bb818b232a7
    resource: repo://openhands/server/routes/security.py
  - id: openwiki-source-098665abffae2aa96cc5f110
    resource: repo://openhands/storage/data_models/user_secrets.py
generated: { by: "claude-code", at: "2026-11-16T09:38:52.407Z" }
---

# Security Analysis and Confirmation Mode

OpenHands' safety model has three layers: (1) **sandbox isolation** of the [runtime](../runtime/runtime-and-sandbox.md), (2) **action gating** — an optional *confirmation mode* in which risky actions wait for the user, informed by a *security analyzer* and by the LLM's own risk rating — and (3) **secret hygiene** (redaction and scoped exposure of tokens). This page covers (2) and (3) and the consequences for (1).

## Risk model

`ActionSecurityRisk` (`events/action/action.py`) is an int enum: `UNKNOWN = -1`, `LOW = 0`, `MEDIUM = 1`, `HIGH = 2`. Actions may carry a `security_risk` field and a `confirmation_state` (`CONFIRMED`, `REJECTED`, `AWAITING_CONFIRMATION`).

**The LLM rates its own actions.** The CodeAct tools declare a `security_risk` parameter with enum values `LOW`/`MEDIUM`/`HIGH` (`codeact_agent/tools/security_utils.py`: `RISK_LEVELS`, `SECURITY_RISK_DESC`), and the `security_risk_assessment.j2` prompt section defines the levels. There are two variants: in CLI mode LOW is read-only/safe, MEDIUM is project-scoped edits/execution, HIGH is system-level or untrusted operations (global installs, `sudo`, deleting critical files, running untrusted downloads, sending local secrets out); in sandbox mode LOW is read-only inside the container, MEDIUM is container-scoped edits and installs, HIGH is data exfiltration or privilege breaks (sending secrets out, touching the host filesystem, privileged container operations). A global rule escalates to HIGH whenever sensitive data would leave the environment. The function-calling parser copies the value onto the resulting action.

## Configuration

`SecurityConfig` (`[security]` in `config.toml`): `confirmation_mode: bool = False` and `security_analyzer: str | None = None` ([Configuration](../configuration/configuration.md)). The CLI forces `confirmation_mode = True` and `security_analyzer = 'llm'` by default ([CLI](../clients/cli.md)). The server's public options route lists valid analyzer names from `SecurityAnalyzers`, which the UI shows in a dropdown.

## Analyzers (`openhands/security/`)

`SecurityAnalyzer` (`analyzer.py`) is the base class: `async security_risk(action) -> ActionSecurityRisk`, `handle_api_request(request)` (analyzer-specific HTTP surface), and `close()`. `security/options.py` registers two implementations:

- **`llm` → `LLMRiskAnalyzer`**: trusts the risk the LLM attached to the action. It returns that value if it is LOW/MEDIUM/HIGH, and `UNKNOWN` otherwise (including unrecognized values, which are logged).
- **`invariant` → `InvariantAnalyzer`**: runs the **Invariant** policy engine in a Docker container (`ghcr.io/invariantlabs-ai/server:openhands`, container `openhands-invariant-server`, started or reused on a free port; `Docker` must be available). Each action is parsed into trace elements (`parser.py`), checked incrementally against a policy (default template fetched from the server, or a custom string), and the highest `risk=` annotation in the violations wins (`HIGH > MEDIUM > LOW`; no violations → `LOW`; a policy-check error → `UNKNOWN`). `close()` stops the container.

The runtime instantiates the analyzer: `Runtime.__init__` looks up `config.security.security_analyzer` in `SecurityAnalyzers`, **falling back to the abstract `SecurityAnalyzer` for unknown names**, in which case `security_risk` raises `NotImplementedError` and the controller treats it as a failed analysis (`UNKNOWN`). The controller reads it through `runtime.security_analyzer` ([session wiring](../server/server-and-sessions.md)). The server exposes `/api/conversations/{id}/security/{path}` which forwards raw requests to the conversation's analyzer (404 if none), used by the Invariant UI.

## Controller behavior (`AgentController`)

In `_step`, for each *runnable* action when `state.confirmation_mode` is on and the action is a `CmdRunAction`, `IPythonRunCellAction`, `BrowseInteractiveAction`, `FileEditAction` or `FileReadAction`:

1. `_handle_security_analyzer(action)`: with an analyzer, overwrite `action.security_risk` with its verdict (any exception → `UNKNOWN`, logged); with no analyzer, set `UNKNOWN`. (The method's docstring says "HIGH (fail-safe)" but the code sets `UNKNOWN`; both lead to confirmation because of the next step.)
2. If `cli_mode`: mark `AWAITING_CONFIRMATION` unconditionally — the CLI decides what to auto-approve.
3. Otherwise mark `AWAITING_CONFIRMATION` if risk is `HIGH`, **or** risk is `UNKNOWN` and no analyzer is configured ("ask for every action").

An action awaiting confirmation moves the agent to `AWAITING_USER_CONFIRMATION`; the action is still published on the stream but `Runtime.run_action` returns a `NullObservation` for it, so nothing executes. When the user answers (`ChangeAgentStateAction(USER_CONFIRMED | USER_REJECTED)`) the controller re-publishes the same action with `confirmation_state` updated and a fresh event id; a confirmed action now runs, a rejected one yields `UserRejectObservation` and the agent returns to `AWAITING_USER_INPUT` ([AgentController](../architecture/agent-controller.md)).

Net effect: with an analyzer, LOW/MEDIUM actions run unprompted and only HIGH waits; with confirmation mode on but no analyzer, *every* gated action waits. Non-gated actions (messages, thinks, MCP calls, file writes by other action types) are never held.

### Client behavior

- **Web UI**: shows the pending action with its risk (the security-analyzer Redux slice receives `security_risk` from actions) and sends the confirm/reject state change.
- **CLI**: `AWAITING_USER_CONFIRMATION` prompts yes/no/always/auto-high-risk. `always` auto-confirms everything for the session; `auto_highrisk` auto-confirms anything not HIGH.

## Secrets

- **Redaction**: provider tokens and custom secrets are registered with the event stream (`set_secrets`/`update_secrets`), and every event is scrubbed before persistence and delivery, replacing secret values with `<secret_hidden>` ([Event stream](../architecture/event-stream.md), [Git providers](../integrations/git-providers.md)).
- **Typed storage**: `UserSecrets` (`storage/data_models/user_secrets.py`) is a frozen pydantic model holding read-only `MappingProxyType`s of provider tokens and custom secrets; serializers only reveal values when the serialization context sets `expose_secrets`. Secrets are persisted via the secrets store, and the agent is told only the *descriptions* of custom secrets (`custom_secrets_descriptions` in workspace context) rather than their values.
- **Exposure**: secrets become environment variables inside the sandbox so the agent's shell can use them — redaction only protects logs and events, not the sandbox environment. Treat anything the agent runs as able to read them.

## Isolation consequences

| Runtime | Isolation | Implication |
|---|---|---|
| Docker / Remote / Kubernetes | Container (or pod) per conversation; action server requires `X-Session-API-Key` | Default and recommended; the Docker socket mounted into the app container is itself a privileged capability. |
| Local | None | Server runs as a host process with the user's permissions. |
| CLI | None | Commands run as host subprocesses; therefore the CLI defaults to confirmation mode + LLM analyzer. |

The runtime README states this explicitly for the Local runtime. Choose confirmation mode and an analyzer whenever the runtime offers no isolation. The CLI additionally asks the user to accept a folder-trust agreement before operating in a directory.

Tests: `tests/unit/security/`, `tests/unit/controller/test_agent_controller.py`.

Related: [CodeActAgent](../agents/codeact-agent.md), [Runtime](../runtime/runtime-and-sandbox.md), [Configuration](../configuration/configuration.md).
