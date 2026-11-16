---
type: architecture-component
title: Git Provider Integrations and MCP
description: How OpenHands talks to GitHub, GitLab, and Bitbucket through per-provider services and a ProviderHandler facade, how provider tokens are exposed to the sandbox and masked in the event stream, how the MCP client attaches external tool servers to agents, and how OpenHands exposes its own MCP server for pull-request creation.
tags: [integrations, git-providers, github, gitlab, bitbucket, provider-tokens, mcp, fastmcp, pull-requests]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:30:54.023Z
sources:
  - id: openwiki-source-20d30eb50754232cae150363
    resource: repo://openhands/integrations/provider.py
  - id: openwiki-source-046a1c2f5e20e3c35ef192a4
    resource: repo://openhands/mcp/utils.py
  - id: openwiki-source-813f6b682591140a7a517aa0
    resource: repo://openhands/server/routes/mcp.py
generated: { by: "claude-code", at: "2026-11-16T18:30:54.023Z" }
---

# Git Provider Integrations and MCP

OpenHands does two kinds of external work. It reads and writes git hosts (repositories, branches, microagents, pull requests) through the **provider integrations** in `openhands/integrations/`, and it extends the agent's toolset through the **Model Context Protocol** in `openhands/mcp/`. The two meet in the sandbox: provider tokens are exported as environment variables into the runtime, and MCP servers can run as stdio processes inside it.

## Provider integrations

### Per-provider services

`openhands/integrations/service_types.py` defines the shared contract:

- `ProviderType` enumerates `GITHUB`, `GITLAB`, `BITBUCKET`, and `ENTERPRISE_SSO`.
- `BaseGitService` (~L198) is the abstract base. Each concrete service implements `_make_request` and the microagent-directory hooks (`_get_microagents_directory_url`, `_is_valid_microagent_file`, `_get_file_name_from_item`, and related methods). The base class supplies the shared logic for finding `.openhands/microagents` (or `microagents/` for `.openhands` and `openhands-config` repositories).
- `GitService` and `InstallationsService` (~L431-L437) are protocols that the rest of the code depends on instead of a concrete class.
- The error types `AuthenticationError`, `RateLimitError`, `ResourceNotFoundError`, `UnknownException`, and `MicroagentParseError` are raised by services and mapped to HTTP responses by the routes.

Concrete implementations live in `openhands/integrations/github/github_service.py` (`GitHubService`), `gitlab/gitlab_service.py`, and `bitbucket/`. The GitHub service takes a `base_domain` so that GitHub Enterprise Server uses `https://<host>/api/v3` and a GraphQL URL under the same host (`github_service.py` ~L44-L64).

### ProviderHandler facade

`ProviderHandler` (`openhands/integrations/provider.py`, class at ~L105) is the single entry point the server uses:

- Its constructor requires `provider_tokens` to be a `MappingProxyType` (a read-only mapping view), and raises `TypeError` otherwise.
- `service_class_map` maps each provider to its service class, and `_get_service` instantiates it with the token.
- High-level methods wrap the services: `get_user`, `get_repositories`, `search_repositories`, `search_branches`, `get_suggested_tasks`, `get_microagents`, `get_microagent_content`, `verify_repo_provider`, `get_authenticated_git_url`, and `is_pr_open`.
- Routes in `openhands/server/routes/git.py` construct a `ProviderHandler` per request (for example at ~L46, ~L77, ~L144) with the tokens from the caller's settings.

Repository URL detection (`_is_repository_url`, ~L318) lets search accept a pasted URL. `_deduplicate_repositories` (~L328) removes duplicates across providers.

### Token exposure and masking

Provider tokens reach the sandbox as environment variables and are masked in the event stream:

- `get_env_vars` (~L385) returns tokens keyed by provider, or as strings when `expose_secrets=True`. `get_provider_env_key` (~L443) names the variable `<provider>_token` in lower case (for example `github_token`).
- `get_env_vars(..., get_latest=True)` first refreshes a token through `_get_latest_provider_token` (~L172), which calls the web service's refresh endpoint (`WEB_HOST`, `REFRESH_TOKEN_URL`) with the session API key. A failed refresh logs a warning and returns `None`. `get_env_vars` then omits that provider from its result (the stored token is not substituted), so the sandbox does not receive a token for it.
<!-- openwiki: broken internal link [/openwiki/architecture/event-stream.md] link "/openwiki/architecture/event-stream.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- `set_event_stream_secrets` (~L338) passes the exposed values to `EventStream.set_secrets`. Those values are then redacted from stored events (see [Event Stream, Actions, and Observations](/openwiki/architecture/event-stream.md)).
- `check_cmd_action_for_provider_token_ref` (~L426) inspects a shell command and returns the providers whose token variable name (for example `github_token`) it mentions.

These two mechanisms are what keep a token out of the conversation log. The redaction is a string replacement, so it covers the token value only where it appears verbatim.

## Pull-request tooling

The routes under `openhands/server/routes/mcp.py` are not a client for external MCP servers. They define a **FastMCP server** (`mcp_server`, ~L26) that OpenHands mounts into its own app (`openhands/server/app.py`, ~L28). It exposes pull-request helpers: `get_conversation_link`, `save_pr_metadata`, `create_pr` (~L84), `create_mr` (~L152), and `create_bitbucket_pr` (~L226). These are called by agents or clients that need to open a GitHub, GitLab, or Bitbucket pull or merge request on the user's behalf.

## MCP client

The client side lives in `openhands/mcp/`:

- `MCPClient` (`openhands/mcp/client.py`, class at ~L23) wraps a FastMCP `Client`. `connect_http` connects to SSE or streamable-HTTP servers, `connect_stdio` starts a local command, and `_initialize_and_list_tools` builds one `MCPClientTool` per server tool.
- `create_mcp_clients` (`openhands/mcp/utils.py` ~L63) iterates the configured servers. For stdio servers it first checks that the command exists with `shutil.which`, and skips missing commands with an error. Each connection is attempted independently: a failed server is logged and omitted, so others still load. The function returns nothing on Windows.
- `fetch_mcp_tools_from_config` (~L151) connects, lists tools, and converts them to the function-calling schema through `convert_mcp_clients_to_tools` (~L28).
- `call_tool_mcp` (~L206) finds the client that owns the requested tool name and invokes it. A tool-not-found condition raises `ValueError`. An MCP protocol error is converted into an `MCPObservation` whose JSON content carries `isError: true`, so the agent sees the failure as an observation instead of a crash.
- `add_mcp_tools_to_agent` (~L267) is called by the agent session after the runtime is initialized (`openhands/server/session/agent_session.py` ~L168). It merges three sources: stdio servers declared by microagents, which are added to the runtime's MCP configuration (`runtime.get_mcp_config`); the configured servers; and the runtime's own MCP entry. It then sets the resulting tools on the agent through `agent.set_mcp_tools`. Microagent SSE servers are not supported and are logged and ignored.

Stdio servers run inside the sandbox by default, through the runtime's MCP router. The CLI runtime uses stdio directly (`use_stdio=isinstance(runtime, CLIRuntime)`).

### Configuration

`MCPConfig` (`openhands/core/config/mcp_config.py` ~L202) has three lists:

- `sse_servers`: `MCPSSEServerConfig` with `url` and optional `api_key`.
- `shttp_servers`: `MCPSHTTPServerConfig` with `url` and optional `api_key`.
- `stdio_servers`: `MCPStdioServerConfig` with `name`, `command`, `args`, and `env`.

<!-- openwiki: broken internal link [/openwiki/architecture/configuration.md] link "/openwiki/architecture/configuration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Declared from the `[mcp]` section of `config.toml` (see [Configuration Model](/openwiki/architecture/configuration.md)).

## Invariants and failure behavior

- A provider token is a `SecretStr` until the moment it is exported; it becomes a plain string only in `expose_env_vars` and `set_event_stream_secrets`.
- A provider service failure surfaces as one of the typed integration errors defined in `service_types.py`. A token refresh failure is not raised: the provider is left out of the exported environment for that call.
- An MCP server that fails to connect is skipped, and the others still load. A tool call against a missing server raises rather than silently succeeding.
- MCP is disabled on Windows in both client creation and tool invocation.

## Extension seams

- A new git host is a `BaseGitService` subclass, an entry in `ProviderHandler.service_class_map`, a `ProviderType` value, and a `PROVIDER_DOMAINS` entry.
- A new MCP transport is a `connect_*` method on `MCPClient` and a branch in `create_mcp_clients`.
- Additional MCP tools for OpenHands itself are `@mcp_server.tool()` functions in `openhands/server/routes/mcp.py`.

## Representative tests

- `tests/unit/integrations/` (10 test files) covers provider handling and services.
- `tests/unit/mcp/` (6 test files) covers the MCP client, tool conversion, and error collection.
- `tests/unit/server/routes/` covers the git and MCP routes.

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/server-sessions.md] link "/openwiki/architecture/server-sessions.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Server, Sockets, and Conversation Sessions](/openwiki/architecture/server-sessions.md)
<!-- openwiki: broken internal link [/openwiki/architecture/runtime-sandbox.md] link "/openwiki/architecture/runtime-sandbox.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Runtime and Sandbox Execution](/openwiki/architecture/runtime-sandbox.md)
<!-- openwiki: broken internal link [/openwiki/workflows/issue-resolver.md] link "/openwiki/workflows/issue-resolver.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Issue Resolver Workflow](/openwiki/workflows/issue-resolver.md)
<!-- openwiki: broken internal link [/openwiki/enterprise/saas-platform.md] link "/openwiki/enterprise/saas-platform.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Enterprise SaaS Platform](/openwiki/enterprise/saas-platform.md)
