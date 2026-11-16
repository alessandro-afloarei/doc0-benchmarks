---
type: architecture
title: Security Model and Sandboxing
description: How OpenHands limits what an agent can do, covering the sandbox that isolates execution, the confirmation policy that pauses risky actions, the security analyzers that rate action risk (LLM-reported and Invariant-based), how secrets are kept out of the event history, and the configuration settings that control each mechanism.
tags: [security, sandbox, confirmation-mode, security-analyzer, invariant, secrets, docker, risk]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T11:08:31.416Z
sources:
  - id: openwiki-source-2560404802cbc340c233d2ec
    resource: repo://openhands/cli/main.py
  - id: openwiki-source-2129d0084f64a3f5714baf90
    resource: repo://openhands/controller/agent_controller.py
  - id: openwiki-source-f0fa538b22f586fd775d4bce
    resource: repo://openhands/core/config/sandbox_config.py
  - id: openwiki-source-2f40e451df496f81af63b0fe
    resource: repo://openhands/events/stream.py
  - id: openwiki-source-f38350b0cd074145e71451f8
    resource: repo://openhands/runtime/base.py
  - id: openwiki-source-a93fe2478f100d6d83bde21d
    resource: repo://openhands/runtime/impl/docker/docker_runtime.py
  - id: openwiki-source-a2a242ef7d71e849ead8ac57
    resource: repo://openhands/security/invariant/analyzer.py
  - id: openwiki-source-f5d47f95ebeced62d5070711
    resource: repo://openhands/security/llm/analyzer.py
  - id: openwiki-source-9d573bf693875e13ea554451
    resource: repo://openhands/security/options.py
generated: { by: "claude-code", at: "2026-11-16T11:08:31.416Z" }
---

# Security Model and Sandboxing

OpenHands gives an LLM the ability to run shell commands, edit files, and browse the web, so the
security model rests on three layers. The first is **isolation**: commands run in a sandbox, not on the
user's host, when a container backend is used. The second is **confirmation**: the controller can pause
an action until a human approves it. The third is **risk rating**: a security analyzer labels each
action as low, medium, high, or unknown, and that label decides whether confirmation is needed. Secrets
are handled separately, so they do not reach the model or the stored history in clear text.

This page describes the mechanisms and their settings. The sandbox itself is described in
[Runtime Abstraction and Execution Backends](../architecture/runtime.md), and the confirmation state
machine is in [Agent Controller and Step Loop](../architecture/agent-controller.md).

## Isolation: where commands run

The runtime decides where an agent's actions execute (`sandbox` and `runtime` in the configuration).

- **Docker (default).** Each conversation gets a container. The `DockerRuntime` maps the action server to
  a host port, binds it to `sandbox.runtime_binding_address` (default `0.0.0.0`,
  `sandbox_config.py:73`; used at `docker_runtime.py:433-450`), and stops the container when the
  conversation closes unless `keep_runtime_alive` is set (`sandbox_config.py:51`,
  `docker_runtime.py:606`).
- **Remote, Kubernetes.** The sandbox runs on another host or in a pod. `remote_runtime_class` accepts
  only `sysbox` or `gvisor` for the remote runtime (`remote_runtime.py:97`), which select isolation
  runtimes that restrict the container more than plain Docker.
- **Local.** Commands run directly on the host as the user. This is convenient but offers no isolation,
  and it should be used only for trusted repositories.
- **CLI.** The terminal session runs commands on the host, which is why the CLI forces confirmation mode
  and the LLM analyzer (see below).

Mounts are the main way a sandbox sees host files. The `sandbox.volumes` setting (`sandbox_config.py:91`)
lists `host:container:mode` mounts, and `trusted_dirs` (`sandbox_config.py:89`) lists host directories the
user has approved for the CLI. Only mount what the task needs. Read-write mounts of the host's home
directory give the agent write access to it.

Networking is controlled by `use_host_network` (default `False`, `sandbox_config.py:71`) and
`additional_networks`. Using the host network removes the network boundary between the sandbox and the
host.

## Confirmation mode

`security.confirmation_mode` (`openhands/core/config/security_config.py`, default `False`) turns on
pausing. When it is on, the controller checks five action types: `CmdRunAction`, `IPythonRunCellAction`,
`BrowseInteractiveAction`, `FileEditAction`, and `FileReadAction` (`agent_controller.py:920-958`). An action
is held in `AWAITING_CONFIRMATION` when:

- its risk is `HIGH`, or
- its risk is `UNKNOWN` and no analyzer is configured, so every such action is asked about.

In CLI mode every checked action is held, regardless of risk (`agent_controller.py` `cli_mode` branch).
The user approves or rejects, and the controller moves to `USER_CONFIRMED` or `USER_REJECTED`
(`agent_controller.py:631-684`). The held action is then written to the event stream with its confirmation
status set to confirmed or rejected.

Confirmation mode and the analyzer can be set in `config.toml`, by environment variable, or per user in
settings. The server applies the per-user values over the configuration when a session starts
(`openhands/server/session/session.py:146-150`).

## Security analyzers

A `SecurityAnalyzer` (`openhands/security/analyzer.py:8`) implements `security_risk(action)`, which returns
an `ActionSecurityRisk`, and `handle_api_request`, which lets an analyzer expose its own endpoints under
`/security/...` (`openhands/server/routes/security.py:19`). The analyzer is chosen by name from
`SecurityAnalyzers` (`openhands/security/options.py`), which maps `llm` to `LLMRiskAnalyzer` and `invariant`
to `InvariantAnalyzer`. `Runtime.__init__` creates the analyzer when `security.security_analyzer` is set
(`openhands/runtime/base.py:194-201`).

`AgentController._handle_security_analyzer` (`agent_controller.py:204-246`) applies it to each checked
action:

- with an analyzer, the risk is replaced by the analyzer's result. If the analyzer raises an exception, the
  risk becomes `UNKNOWN` and a warning is logged;
- without an analyzer, the risk becomes `UNKNOWN` (`agent_controller.py:240-246`). The method's docstring
  says HIGH, but the code sets UNKNOWN, and the confirmation rule above depends on the code.

### LLM risk analyzer

`LLMRiskAnalyzer` (`openhands/security/llm/analyzer.py:12`) does not make a separate model call. It reads
the `security_risk` field that the model set on the action when it proposed it, and returns that value if
it is low, medium, or high, otherwise `UNKNOWN` (`analyzer.py:19-40`). The CodeAct tool schemas include
that field (`openhands/agenthub/codeact_agent/tools/security_utils.py`), and `function_calling.py` sets it
on each action (`set_security_risk`). The security risk assessment prompt, `security_risk_assessment.j2`,
is part of the CodeAct prompt set. This analyzer is only as reliable as the model's own judgment, which
can be wrong or manipulated by content the agent has read. It is the default for the CLI.

### Invariant analyzer

`InvariantAnalyzer` (`openhands/security/invariant/analyzer.py:15`) is a rule-based analyzer. It runs the
Invariant policy engine in a container (`ghcr.io/invariantlabs-ai/server:openhands`, set in
`invariant/analyzer.py`),
and it keeps a trace of the actions in the conversation.

- Each new action is converted to trace elements (`parse_element`) and checked against the policy with
  `monitor.check` (`analyzer.py:110-125`).
- The policy defaults to the Invariant template when none is given (`analyzer.py:83-84`).
- `get_risk` (`analyzer.py:92-108`) reads `risk=high`, `risk=medium`, or `risk=low` from the policy results,
  and returns the highest. If no result matches, it returns `LOW`.

This analyzer evaluates the trace, so it can flag an action because of what came earlier in the
conversation, not only the action itself. Its policy is the main tuning point, and its container adds an
operational dependency.

## Secrets

Secrets are kept separate from conversation content.

- Provider tokens and custom secrets are stored in the secrets store, not in `Settings`. The
  `invalidate_legacy_secrets_store` routine (`openhands/server/routes/secrets.py:33`) moves tokens that an
  older version kept in settings into the dedicated store.
- The secrets routes (`openhands/server/routes/secrets.py`) read and write the user's secrets.
- The event stream replaces each known secret value with `<secret_hidden>` before the event is written or
  delivered (`openhands/events/stream.py:221-244`; see [Event Model and Event Stream](../architecture/event-stream.md)).
  Replacement applies to nested string fields and skips protected top-level metadata fields.
- Provider tokens are exported into the sandbox environment when the agent needs them
  (see [Git Provider Integrations and Issue Resolver](../integrations/git-providers-and-resolver.md)).

The redaction depends on the secret values being registered with the stream. A secret that was never set
on the stream is not redacted. A secret that the agent reads from a file, or prints in a form the stream
does not recognize, is not caught. Redaction is therefore a safeguard, not a guarantee.

## Configuration summary

| Setting | Default | Effect |
| --- | --- | --- |
| `security.confirmation_mode` | `false` | Hold risky actions for approval. |
| `security.security_analyzer` | none | `llm` or `invariant`. None means every checked action is `UNKNOWN`. |
| `sandbox.runtime` / `runtime` | `docker` | Where commands run. |
| `sandbox.runtime_binding_address` | `0.0.0.0` | Address the action server is bound to. Bind to `127.0.0.1` on a shared machine. |
| `sandbox.use_host_network` | `false` | Shares the host network with the sandbox when true. |
| `sandbox.volumes`, `sandbox.trusted_dirs` | empty | Host paths visible to the sandbox or approved in the CLI. |
| `sandbox.keep_runtime_alive` | `false` | Keeps containers after a conversation ends. |
| `sandbox.timeout` | `120` | Default timeout for each action, in seconds. |

## Operational guidance

- Keep confirmation mode on for any repository you have not reviewed, and use the `invariant` analyzer
  where its policy covers your risks.
- Prefer Docker or a remote sandbox to local execution. Mount only the directories a task needs.
- On a shared host, bind the action server to `127.0.0.1` and keep `use_host_network` off.
- Treat the LLM analyzer as a convenience. It does not check the action against any independent policy.
- Review the Docker socket mount in the GUI launcher: the application container can control the host's
  Docker (see [CLI and Local Launchers](../cli/cli-and-launchers.md)).

## Extension seams

- New analyzer: subclass `SecurityAnalyzer`, implement `security_risk`, and add it to `SecurityAnalyzers`.
- New confirmation rule: change the action-type checks in `agent_controller.py`.
- New secret type: register its values with the event stream's `update_secrets`.

## Tests

Security code is covered under `tests/unit/security/` and the controller tests under `tests/unit/controller/`.

## Related pages

- [Runtime Abstraction and Execution Backends](../architecture/runtime.md)
- [Agent Controller and Step Loop](../architecture/agent-controller.md)
- [Configuration System](../architecture/configuration.md)
- [Event Model and Event Stream](../architecture/event-stream.md)
