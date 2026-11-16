---
type: architecture
title: Model Context Protocol (MCP) Integration
description: How OpenHands models MCP servers as configuration, connects to them from the sandbox, exposes their tools to the agent as MCPAction events, and also runs its own FastMCP server at /mcp with git pull-request tools.
tags: [mcp, tools, fastmcp, configuration, actions, runtime, pull-requests]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T11:08:31.416Z
sources:
  - id: openwiki-source-cd5a510bbd00e96ba21e2a6c
    resource: repo://openhands/core/config/mcp_config.py
  - id: openwiki-source-a2c4f6dc92cf0cd76a23c3d8
    resource: repo://openhands/core/config/utils.py
  - id: openwiki-source-9a556068930ff18bf4357f60
    resource: repo://openhands/mcp/client.py
  - id: openwiki-source-046a1c2f5e20e3c35ef192a4
    resource: repo://openhands/mcp/utils.py
  - id: openwiki-source-f38350b0cd074145e71451f8
    resource: repo://openhands/runtime/base.py
  - id: openwiki-source-8aa44ffeca89d68fc256f906
    resource: repo://openhands/runtime/impl/action_execution/action_execution_client.py
  - id: openwiki-source-f8228654e759fdf2fd0ec8f2
    resource: repo://openhands/server/app.py
  - id: openwiki-source-813f6b682591140a7a517aa0
    resource: repo://openhands/server/routes/mcp.py
generated: { by: "claude-code", at: "2026-11-16T11:08:31.416Z" }
---

# Model Context Protocol (MCP) Integration

The Model Context Protocol lets an agent call tools that live outside OpenHands: a search engine, a
database, an internal API. OpenHands integrates MCP in two directions. It **consumes** external MCP
servers that the user configures, and it **provides** its own MCP server at `/mcp` with tools for
opening pull requests. This page covers both, and how a consumed tool call travels from the agent
through the event stream to the sandbox.

## Configuration model

MCP servers are described by `MCPConfig` in `openhands/core/config/mcp_config.py:202`. It has three lists:

| Field | Model | Transport |
| --- | --- | --- |
| `sse_servers` | `MCPSSEServerConfig` (line 46): `url`, optional `api_key` | Server-sent events over HTTP. |
| `shttp_servers` | `MCPSHTTPServerConfig` (line 191): `url`, optional `api_key` | Streamable HTTP. |
| `stdio_servers` | `MCPStdioServerConfig` (line 64): `name`, `command`, `args`, `env` | A local process started with stdio transport. |

`MCPConfig` forbids unknown keys (`model_config = ConfigDict(extra='forbid')`), so a misspelled field
fails validation rather than being ignored. Validators normalize URLs, server names, commands,
arguments, and environment values. `from_toml_section` (`mcp_config.py:257`) parses the `[mcp]` table of
`config.toml` when the loader reads it (`openhands/core/config/utils.py:274-279`), and `merge`
(`mcp_config.py:307`) combines configurations from several sources. See
[Configuration System](../architecture/configuration.md) for how the TOML file is loaded.

Two servers are added automatically by `OpenHandsMCPConfig` (`mcp_config.py:315`):

- a search engine, the `tavily` stdio server started with `npx`, when the configured search API key
  has the `tvly-` prefix (`add_search_engine`, `mcp_config.py:317-333`). It is skipped in SaaS mode, where
  the server adds it;
- a default streamable-HTTP server that points back to OpenHands' own `/mcp` endpoint, plus any
  default stdio servers (`create_default_mcp_server_config`, `mcp_config.py:336`).

## Where servers run

The runtime, not the controller, connects to MCP servers. The base class declares `get_mcp_config`
(`openhands/runtime/base.py:1025`). `ActionExecutionClient.get_mcp_config` (`action_execution_client.py:362`)
builds the effective configuration for a runtime. It adds any extra stdio servers passed in, and it
remembers which stdio servers it last published so that changes are sent only when the set changes
(`action_execution_client.py:86`).

Stdio servers are started inside the sandbox, where a router process hosts them, as the `MCPConfig`
docstring describes. SSE and streamable-HTTP servers are reached directly from the sandbox or the
runtime process. On Windows, MCP is disabled, and the runtime returns an `ErrorObservation` instead
of connecting (`mcp/utils.py:206-220`).

## Clients

`MCPClient` (`openhands/mcp/client.py:23`) wraps a FastMCP client for one server.

- `connect_http` (`client.py:57`) connects to an SSE or streamable-HTTP server.
- `connect_stdio` (`client.py:125`) starts a local server. The default timeout is 30 seconds
  (`client.py:61`, `client.py:125`).
- `_initialize_and_list_tools` (`client.py:33`) lists the server's tools and builds an `MCPClientTool`
  for each. The clients keep a `tool_map` from tool name to tool.
- `call_tool` (`client.py:147`) invokes a tool and returns the result.

`create_mcp_clients` (`openhands/mcp/utils.py:63`) builds the list of clients for one configuration.
Clients are created for each operation rather than kept for a whole session, so a failed server does
not hold other calls.

## Making tools visible to the agent

`fetch_mcp_tools_from_config` (`mcp/utils.py:151`) connects, lists tools across all configured servers,
and returns them as tool definitions. `convert_mcp_clients_to_tools` (`mcp/utils.py:28`) converts the
clients to the tool-schema format, and `MCPClientTool.to_param` (`openhands/mcp/tool.py:14`) produces
the parameter dictionary that the model sees. `add_mcp_tools_to_agent` (`mcp/utils.py:267`) gives the
list to the agent. CodeAct stores them through `set_mcp_tools` (`openhands/controller/agent.py:163`) and
maps function calls that match an MCP tool name to an `MCPAction` (see
[Agents, Tools, and Microagents](../architecture/agents-and-tools.md)).

Errors that happen while connecting or listing tools are collected by `MCPErrorCollector`
(`openhands/mcp/error_collector.py:19`), which records them without stopping the conversation.

## A tool call, end to end

1. The model emits a function call for an MCP tool. CodeAct converts it to `MCPAction`
   (`openhands/events/action/mcp.py:9`), with `name`, `arguments`, and the `thought`. `MCPAction` is
   runnable.
2. The action is written to the event stream and delivered to the runtime's subscriber.
3. `Runtime._handle_action` sends `MCPAction` to `call_tool_mcp` instead of `run_action`
   (`openhands/runtime/base.py:361-370`; see [Runtime Abstraction and Execution Backends](../architecture/runtime.md)).
4. The action execution client builds clients for the current configuration with `create_mcp_clients`,
   then calls `call_tool_mcp` (`action_execution_client.py:452-478`).
5. `call_tool_mcp` (`mcp/utils.py:206`) finds the client whose `tool_map` has the tool name and calls it.
6. The result becomes an `MCPObservation` (`openhands/events/observation/mcp.py:9`), which carries the
   tool name and arguments back to the agent.

Because each step is an event, an MCP call appears in the conversation history like any other action,
and it can be replayed.

## OpenHands as an MCP server

`openhands/server/routes/mcp.py` defines a FastMCP server named `mcp`. It is mounted at `/mcp` by
`openhands/server/app.py` (`app.py:37`, `app.py:62-63`). It exposes three tools for pull requests,
usable by an MCP client connected to OpenHands:

- `create_pr` (`routes/mcp.py:83`) for GitHub;
- `create_mr` (`routes/mcp.py:151`) for GitLab merge requests;
- `create_bitbucket_pr` (`routes/mcp.py:225`) for Bitbucket.

Each tool uses the caller's provider tokens, obtained from the request through `get_provider_tokens`
and `get_access_token` (`routes/mcp.py:107-108`). Failures are raised as `ToolError` with the message
from the provider, and error details are masked for other exceptions (`mask_error_details=True`,
`routes/mcp.py:27`). In SaaS mode `get_conversation_link` (`routes/mcp.py:34`) appends a link to the
OpenHands conversation that opened the pull request, so reviewers can find the context.

In the enterprise deployment, `enterprise/server/routes/mcp_patch.py` adds a search engine server to the
hosted MCP configuration when `ENABLE_MCP_SEARCH_ENGINE` is `true` (`mcp_patch.py:9-15`).

## Security and operations

- MCP servers run with the permissions of their process. Configure only servers you trust.
- API keys in `MCPConfig` are sent to the runtime, so treat anything the agent can execute as able to
  read them. Use keys with the narrowest scope.
- A server that fails to start is reported through `MCPErrorCollector` and its tools are omitted. The
  conversation continues with the remaining tools.
- Each tool call creates clients, so a slow server adds latency to every call. Keep the server list short.

## Extension seams

- New transport: add a server-config model to `mcp_config.py`, add it to `MCPConfig`, and handle it in
  `create_mcp_clients`.
- New built-in tools for the OpenHands server: add a `@mcp_server.tool()` function to
  `openhands/server/routes/mcp.py`.
- New default server: add it to `OpenHandsMCPConfig.create_default_mcp_server_config`.

## Tests

Unit tests for MCP are under `tests/unit/mcp/` (for example for configuration parsing and tool conversion).
Runtime behavior is covered by `tests/runtime/` and the CLI runtime MCP tests in `tests/unit/cli/`
(`test_cli_runtime_mcp.py`).

## Related pages

- [Agents, Tools, and Microagents](../architecture/agents-and-tools.md)
- [Runtime Abstraction and Execution Backends](../architecture/runtime.md)
- [Git Provider Integrations and Issue Resolver](git-providers-and-resolver.md)
- [Configuration System](../architecture/configuration.md)
