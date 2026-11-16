---
type: integration
title: MCP Integration
description: How OpenHands consumes Model Context Protocol servers — config types (SSE, streamable HTTP, stdio), MCPClient and tool conversion, how tools reach the agent, the action-execution server's stdio proxy, MCPAction execution, and the MCP server OpenHands itself exposes.
tags: [mcp, tools, fastmcp, stdio, sse, runtime-proxy]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:38:52.407Z
sources:
  - id: openwiki-source-cd5a510bbd00e96ba21e2a6c
    resource: repo://openhands/core/config/mcp_config.py
  - id: openwiki-source-9a556068930ff18bf4357f60
    resource: repo://openhands/mcp/client.py
  - id: openwiki-source-046a1c2f5e20e3c35ef192a4
    resource: repo://openhands/mcp/utils.py
  - id: openwiki-source-fd6d296a69771bcf356e0886
    resource: repo://openhands/runtime/action_execution_server.py
  - id: openwiki-source-f38350b0cd074145e71451f8
    resource: repo://openhands/runtime/base.py
  - id: openwiki-source-8aa44ffeca89d68fc256f906
    resource: repo://openhands/runtime/impl/action_execution/action_execution_client.py
  - id: openwiki-source-9aa4bafb00b741ce01f9a811
    resource: repo://openhands/runtime/mcp/proxy/manager.py
  - id: openwiki-source-f8228654e759fdf2fd0ec8f2
    resource: repo://openhands/server/app.py
  - id: openwiki-source-813f6b682591140a7a517aa0
    resource: repo://openhands/server/routes/mcp.py
  - id: openwiki-source-a3e1d91fcd3a9a6f3c96821f
    resource: repo://openhands/server/session/agent_session.py
generated: { by: "claude-code", at: "2026-11-16T09:38:52.407Z" }
---

# MCP Integration

OpenHands is both an **MCP client** (agents can call tools from external MCP servers) and an **MCP server** (it exposes PR/MR creation tools). MCP is disabled on Windows throughout: client creation, tool fetching, tool calls and the runtime proxy all short-circuit when `sys.platform == 'win32'`.

## Configuration (`core/config/mcp_config.py`)

`MCPConfig` (the `[mcp]` section / `OpenHandsConfig.mcp`) has three lists:

- `sse_servers: list[MCPSSEServerConfig]` — `url`, optional `api_key`.
- `shttp_servers: list[MCPSHTTPServerConfig]` — streamable-HTTP servers, same shape.
- `stdio_servers: list[MCPStdioServerConfig]` — `name`, `command`, `args`, `env`.

Plain URL strings in config are normalized into server configs and the config validates itself. `OpenHandsMCPConfig.create_default_mcp_server_config(host, config, user_id)` returns OpenHands' **default servers**: an SHTTP server at `http://<host>/mcp/mcp` (the server's own MCP endpoint) and, if `search_api_key` starts with `tvly-`, a Tavily stdio server (`npx -y tavily-mcp@0.2.1`) with the key in its environment. The CLI lets users manage servers through `/mcp` ([CLI](../clients/cli.md)). Repo [microagents](../agents/microagents.md) may carry `mcp_tools` configs too; only their stdio servers are supported (SSE entries are warned about and ignored).

## Client side (`openhands/mcp/`)

`MCPClient` (a pydantic model wrapping a `fastmcp.Client`) connects and lists tools:

- `connect_http(server, conversation_id, timeout=30)` builds a custom `StreamableHttpTransport` or `SSETransport` so it can send headers: `Authorization: Bearer <key>`, plus `s` and `X-Session-API-Key` (needed by the runtime's MCP router and by remote runtimes), and `X-OpenHands-ServerConversation-ID` when a conversation id is given.
- `connect_stdio(server)` launches a stdio server process.
- On connect it calls `list_tools` and stores `MCPClientTool` objects, which convert to ChatCompletion tool params (`to_param`). Connection errors are logged and recorded in a global `mcp_error_collector` so the UI/CLI can show them.

`mcp/utils.py`:

- `create_mcp_clients(sse, shttp, conversation_id, stdio)` creates one client per server, skipping stdio servers whose command is not on `PATH`, and logging-but-continuing past servers that fail to connect (only successfully connected clients are returned).
- `convert_mcp_clients_to_tools` flattens client tools into the dict format the agent consumes.
- `fetch_mcp_tools_from_config(mcp_config, conversation_id, use_stdio)` creates clients and converts tools; stdio servers are used directly **only when `use_stdio` is true** (the CLI runtime); otherwise stdio servers are reached through the runtime's proxy as SSE (below). Any failure yields an empty list rather than an exception.
- `call_tool_mcp(clients, action)` finds the client that owns `action.name` and returns an `MCPObservation` with the JSON-serialized result; an `McpError` becomes an observation with `isError: true` rather than an exception, so the agent sees and can react to the failure.
- `add_mcp_tools_to_agent(agent, runtime, memory)` is the wiring function: it requires an initialized runtime, collects stdio servers from repo microagents (`Memory.get_microagent_mcp_tools`), asks the runtime for the merged config via `runtime.get_mcp_config(extra_stdio_servers)`, fetches tools, and calls `agent.set_mcp_tools(...)`. `AgentSession.start` calls it **before creating the controller**, so the tools are in the system message ([Agent](../agents/codeact-agent.md)); the headless `run_controller` does the same after appending the default OpenHands MCP servers to `runtime.config.mcp.stdio_servers`. It runs only if `agent.config.enable_mcp`.

## From tool call to observation

1. The model emits a tool call whose name is in `agent.mcp_tools`; `function_calling.response_to_actions` produces an `MCPAction(name, arguments)`.
2. The controller publishes it; since `MCPAction` is runnable, `Runtime._handle_action` routes it to `await self.call_tool_mcp(event)` instead of the synchronous `run_action` path ([Runtime](../runtime/runtime-and-sandbox.md)).
3. `ActionExecutionClient.call_tool_mcp` re-computes the MCP config, **creates fresh clients for this call** (SSE + SHTTP servers only), invokes `call_tool_mcp` and returns the observation. Connections are not kept open between calls.

## The runtime proxy for stdio servers

Stdio servers must run *inside the sandbox*. `ActionExecutionClient.get_mcp_config` copies the configured MCP config, merges extra stdio servers, and, if there are servers not yet synced, POSTs the full sorted list to the action-execution server's `/update_mcp_server` endpoint (60 s timeout), remembering what was last synced so only changes trigger updates. Once at least one stdio server is tracked, it appends the runtime itself as an **SSE MCP server** at `<action_execution_server_url>/mcp/sse` authenticated with the session API key. The agent therefore only ever talks SSE/HTTP; the runtime fans out to stdio processes.

On the server side, `/update_mcp_server` validates the list, builds `MCPStdioServerConfig`s and calls `MCPProxyManager.update_and_remount(app, servers, ['*'])` (`runtime/mcp/proxy/manager.py`, a FastMCP proxy kept in memory and re-mounted on the FastAPI app). Failures are returned as a 200 response with `router_error_log` populated, which the client logs as a warning, so one bad server does not break the others.

## OpenHands as an MCP server (`server/routes/mcp.py`)

A `FastMCP('mcp', stateless_http=True, mask_error_details=True)` instance is mounted on the main app (its lifespan is combined with the app lifespan in `app.py`). It exposes tools `create_pr`, `create_mr` (GitLab) and `create_bitbucket_pr`, which use the caller's provider tokens, create the PR/MR through the [git provider](git-providers.md) service, and record PR metadata and a conversation link for the conversation. The enterprise edition patches this server (`patch_mcp_server`, `server/mcp/mcp_config.py`).

Related: [Configuration](../configuration/configuration.md), [Runtime](../runtime/runtime-and-sandbox.md).
