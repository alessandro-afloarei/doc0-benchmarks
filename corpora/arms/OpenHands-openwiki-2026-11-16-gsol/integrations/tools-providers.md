---
type: integration
title: MCP tools and Git providers
description: External tool discovery and execution through MCP, runtime-hosted stdio routing, provider credentials, and repository initialization.
tags: [mcp, integrations, git, tools, credentials]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:50:03.393Z
sources:
  - id: openwiki-source-20d30eb50754232cae150363
    resource: repo://openhands/integrations/provider.py
  - id: openwiki-source-046a1c2f5e20e3c35ef192a4
    resource: repo://openhands/mcp/utils.py
  - id: openwiki-source-f38350b0cd074145e71451f8
    resource: repo://openhands/runtime/base.py
  - id: openwiki-source-8aa44ffeca89d68fc256f906
    resource: repo://openhands/runtime/impl/action_execution/action_execution_client.py
generated: { by: "codex", at: "2026-11-16T06:50:03.393Z" }
---

# MCP tools and Git providers

MCP extends an agent's tool catalog; Git providers supply repository APIs and credentials. Both cross the runtime boundary, but they have separate configuration, authentication, and failure paths.

## MCP discovery and execution

MCPConfig holds SSE, streamable HTTP (`shttp_servers`), and stdio server definitions. Remote definitions include a URL and optional API key; stdio definitions describe a named command, arguments, and environment. Configuration merging concatenates server lists.

At session startup, enabled MCP setup requires an initialized runtime. It gathers stdio configurations from repository microagents, asks the runtime for a combined configuration, fetches remote tool schemas, converts them to agent tool definitions, and appends them to the agent before the system message is recorded.

For ActionExecutionClient-based backends, stdio processes run behind the MCP router inside the execution environment. The client sends new stdio server definitions to `/update_mcp_server`, preserves the union of known definitions, and exposes the runtime's `/mcp/sse` endpoint when stdio servers are present. CLI runtime discovery instead permits direct stdio clients. A missing executable can therefore mean a missing dependency in different environments depending on runtime choice.

An MCP model call becomes MCPAction. Runtime execution creates clients for that operation, locates the first client advertising the exact tool name, invokes it, and returns MCPObservation containing serialized protocol output. McpError becomes an MCPObservation with `isError: true`; no clients or no matching tool raises a ValueError and follows runtime error handling. Duplicate names should be avoided because dispatch chooses the first match and agent registration skips duplicate names.

MCPClient uses FastMCP transports, lists tools inside a managed client context, and opens a managed connection for calls. HTTP API keys populate authorization and runtime-specific headers; an optional conversation ID is passed in its own header. Discovery failures are logged/collected and can leave a partial or empty tool catalog instead of aborting every server connection. MCP creation/discovery is disabled on Windows in this implementation.

## Git provider ownership

ProviderHandler maps GitHub, GitLab, and Bitbucket to their service implementations. It requires an immutable MappingProxyType token mapping. Token records can include provider user ID, secret token, and custom host; handlers carry external-auth context for enterprise token management.

Headless setup reads host variables such as `GITHUB_TOKEN`, `GITLAB_TOKEN`, and `BITBUCKET_TOKEN`. Runtime-exported provider variable names are generated as lowercase `<provider>_token`, for example `github_token`. When a command references one of those names, the runtime attempts to fetch the latest token, refresh event-stream masking, and export it before execution. Latest-token requests depend on the configured refresh URL and conversation ID.

Provider refresh, custom-secret injection, and event redaction are separate steps. The event stream only masks secrets registered with it; avoid assuming a new credential path automatically participates in that mechanism. Enterprise identity-provider refresh is covered in [enterprise composition](enterprise.md).

## Workspace preparation and hooks

Runtime repository initialization obtains a provider-authenticated clone URL and clones into the repository's final path segment. With a selected branch it checks out that branch; otherwise it creates a random `openhands-workspace-*` branch. Without a selected repository, it optionally initializes Git in an empty workspace according to configuration.

After repository initialization, setup helpers run `.openhands/setup.sh` when present and install configured repository Git hooks. The setup script is sourced as a hidden environment action with a 600-second hard timeout. It executes repository code in the selected runtime, so runtime choice and mounts define its access. Microagent instructions and setup scripts have different roles: one supplies model context, the other executes shell code.

Provider services also expose repository search, branches, user information, suggested tasks, microagent APIs, and pull-request information. New provider behavior should extend the shared service protocols and ProviderHandler routing as well as the concrete provider implementation.

## Verification routes

For tool availability problems, inspect the effective server lists, runtime initialization, stdio command availability inside the correct environment, router update errors, and discovered names before changing agent prompts. For tool stalls, follow the MCP call and runtime status path through the action/observation cause.

Focused suites include `tests/unit/mcp/test_mcp_utils.py`, `test_mcp_integration.py`, `test_mcp_tool_timeout_stall.py`, server MCP-route tests, and `tests/unit/integrations/`. Related system details are in [agents and LLMs](../concepts/agents-llm.md), [memory](../concepts/memory.md), and [runtime operations](../operations/runtimes.md).
