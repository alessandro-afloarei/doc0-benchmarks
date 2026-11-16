---
type: integration
title: MCP and Git provider integrations
description: Tool discovery and execution across MCP transports, failure observations, provider-token ownership, and workspace credential refresh.
tags: [mcp, tools, git, credentials]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T08:14:39.912Z
sources:
  - id: openwiki-source-20d30eb50754232cae150363
    resource: repo://openhands/integrations/provider.py
  - id: openwiki-source-046a1c2f5e20e3c35ef192a4
    resource: repo://openhands/mcp/utils.py
  - id: openwiki-source-f38350b0cd074145e71451f8
    resource: repo://openhands/runtime/base.py
  - id: openwiki-source-8aa44ffeca89d68fc256f906
    resource: repo://openhands/runtime/impl/action_execution/action_execution_client.py
generated: { by: "codex", at: "2026-11-16T08:14:39.912Z" }
---

# MCP and Git provider integrations

MCP extends the agent's callable tools; Git provider services supply repository APIs and credentials used by workspace setup and commands. Both cross runtime and session boundaries, but they have different configuration and failure contracts.

## MCP discovery before execution

Session startup calls `add_mcp_tools_to_agent` after runtime initialization and memory loading, before the controller creates its system message. The helper gathers unique stdio configurations from repository microagents, asks the runtime for an effective MCP configuration, fetches tools, and installs their schemas on the agent.

`create_mcp_clients` supports SSE, streamable HTTP, and stdio configurations. It validates that a stdio executable is available before connecting. Failed server connections are logged and skipped, allowing successful servers to remain available. Tool-conversion or discovery failures can return an empty tool list and record details in the MCP error collector. These helpers explicitly disable MCP on Windows.

Direct stdio discovery is enabled for `CLIRuntime`. Action-execution runtimes update stdio-server configuration inside the environment and expose those tools through the runtime's MCP endpoint. This is why an executable available on the application host may not be enough for a sandboxed tool: trace where that runtime starts the server.

Repository microagent MCP support currently accepts stdio configuration; general MCP HTTP support does not imply every transport is supported through microagent metadata. See [LLMs and memory](../concepts/llm-memory.md).

## Tool-call contract and failure handling

An `MCPAction` names the tool and supplies arguments. `call_tool_mcp` selects the first client advertising that name, opens the client call, and produces an `MCPObservation` containing JSON for the result. Duplicate advertised names are therefore ambiguous at this matching boundary.

A caught `McpError` becomes an MCP observation with `isError: true`, preserving a result for the controller instead of leaving the action pending indefinitely. Missing clients or an unmatched tool name raise `ValueError`; these are not handled by that same catch clause. The outer runtime still owns error/status reporting and action-cause association.

The regression test `tests/unit/mcp/test_mcp_tool_timeout_stall.py` checks timeout-as-MCP-error feedback. Related tests cover client creation timeouts, integration, and error collection. When adding a transport or changing timeouts, verify both tool discovery and the observation that releases pending execution.

## Provider service boundary

`ProviderHandler` maps GitHub, GitLab, and Bitbucket to provider-specific services. Tokens carry a secret value, optional provider user ID, and optional host. The handler requires a `MappingProxyType` token mapping; provider-token and user-secret immutability are tested to prevent accidental mutation of shared credential state.

Repository APIs are delegated through a common Git service interface. Service construction receives identity, token, external-token-manager settings, and custom host information. Keep repository identity and provider host together when supporting self-hosted providers.

## Credentials from session to workspace

Provider credentials are acquired by the application auth/settings layer and passed into runtime setup. The handler can expose selected provider values as environment variables and register those values with the event stream for masking.

Before an action, the runtime checks whether the command references provider-token variables. If relevant, it requests current tokens, updates the environment, and refreshes event-stream secret registration. Latest-token retrieval depends on a configured refresh endpoint derived from `WEB_HOST` and a session ID; not every local command performs an external OAuth refresh.

The registration method calls `EventStream.set_secrets`, which replaces the registered map. Changes to this flow should be reviewed alongside custom-secret registration so one registration path does not accidentally remove another value from filtering. Event filtering itself has payload-shape limits described in [events and storage](../architecture/events-storage.md).

## Practical extension path

For a new MCP tool/server, trace configuration validation, runtime transport placement, schema discovery, agent tool conversion, action execution, and error observations. For a new Git provider capability, trace the service interface, handler delegation, API route, frontend data shape, and credential lifecycle.

Focused checks live in `tests/unit/mcp/`, `tests/unit/events/test_mcp_action_observation.py`, and `tests/unit/integrations/`. The [runtime page](../architecture/runtime.md) explains execution placement, while [enterprise](enterprise.md) explains application identity and refreshed provider tokens in SaaS deployments.
