---
type: integration
title: Model Context Protocol (MCP) Integration
description: How OpenHands configures MCP servers (SSE, streamable HTTP, stdio), discovers their tools and exposes them to agents, executes MCPActions through short-lived clients, proxies stdio servers inside the sandbox, and serves its own built-in MCP server with PR/MR creation tools.
tags: [mcp, tools, fastmcp, stdio, sse, shttp]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:35:38.671Z
sources:
  - id: openwiki-source-cd5a510bbd00e96ba21e2a6c
    resource: repo://openhands/core/config/mcp_config.py
  - id: openwiki-source-9a556068930ff18bf4357f60
    resource: repo://openhands/mcp/client.py
  - id: openwiki-source-046a1c2f5e20e3c35ef192a4
    resource: repo://openhands/mcp/utils.py
  - id: openwiki-source-fd6d296a69771bcf356e0886
    resource: repo://openhands/runtime/action_execution_server.py
  - id: openwiki-source-8aa44ffeca89d68fc256f906
    resource: repo://openhands/runtime/impl/action_execution/action_execution_client.py
  - id: openwiki-source-f8228654e759fdf2fd0ec8f2
    resource: repo://openhands/server/app.py
  - id: openwiki-source-813f6b682591140a7a517aa0
    resource: repo://openhands/server/routes/mcp.py
generated: { by: "claude-code", at: "2026-11-16T07:35:38.671Z" }
---

# Model Context Protocol (MCP) Integration

OpenHands acts as an **MCP client**, so agents can call tools from external MCP servers. It also runs an **MCP server** of its own that provides PR-creation tools. The pieces live in `openhands/core/config/mcp_config.py` (config), `openhands/mcp/` (client utilities), `openhands/runtime/mcp/` (the in-sandbox proxy), and `openhands/server/routes/mcp.py` (the built-in server).

## Configuration

`MCPConfig` has three server lists:

| Kind | Model | Fields |
| --- | --- | --- |
| SSE | `MCPSSEServerConfig` | `url`, optional `api_key` |
| Streamable HTTP | `MCPSHTTPServerConfig` | `url`, optional `api_key` |
| stdio | `MCPStdioServerConfig` | `name`, `command`, `args`, `env` |

URLs are checked on load. Stdio args can be given as a list or a shell-style string, and env can be a dict or a comma-separated `KEY=VALUE` string. Two stdio configs compare equal by name, command, args, and env, and that equality is how duplicates are skipped. `MCPConfig.merge(other)` combines configs. MCP servers come from four places:

- the `[mcp]` section of `config.toml` (`sse_servers`, `shttp_servers`, `stdio_servers`);
- user settings in the web UI (**Settings → MCP**), merged into the conversation's config by `Session`;
- repo microagents that declare `mcp_tools`, which must be stdio ([Microagents](../concepts/microagents.md#microagents-that-add-mcp-tools));
- the defaults from `OpenHandsMCPConfig.create_default_mcp_server_config(host, config, user_id)`:
  - the built-in OpenHands server as an SHTTP server at `http://{mcp_host}/mcp/mcp`;
  - a Tavily search stdio server (`npx -y tavily-mcp@0.2.1`) when `search_api_key` starts with `tvly-`.

  This class can be replaced through `OPENHANDS_MCP_CONFIG_CLS`. The enterprise build swaps in its own version.

MCP is turned off on Windows. Every entry point checks `sys.platform == 'win32'` and returns empty results or an error observation.

## Making MCP tools available to the agent

`add_mcp_tools_to_agent(agent, runtime, memory)` (`openhands/mcp/utils.py`) runs once the runtime has connected and **before** the controller is created, because the tools need to be part of the `SystemMessageAction` ([Architecture Overview](../architecture/overview.md#assembly-server-path)). It:

1. Collects stdio servers from repo microagents and drops duplicates.
2. Calls `runtime.get_mcp_config(extra_stdio_servers)` to get the effective config. For sandboxed runtimes, this registers the stdio servers with the sandbox proxy (next section).
3. Calls `fetch_mcp_tools_from_config(config, use_stdio=isinstance(runtime, CLIRuntime))`. That function creates temporary `MCPClient`s, lists their tools, and converts each to an OpenAI-style function schema (`convert_mcp_clients_to_tools`).
4. Passes the schemas to `agent.set_mcp_tools(...)`, which appends them to the agent's tool list. Tool names that already exist are skipped.

During a step, `CodeActAgent` turns a tool call whose name is one of its MCP tools into an `MCPAction(name, arguments)` ([Agents](../agents/agenthub.md#tool-calls-to-actions)).

## Executing an MCPAction

`Runtime._handle_action` sends `MCPAction`s to `runtime.call_tool_mcp(action)` instead of the action server ([Runtime Architecture](../runtime/runtime-architecture.md)):

- `ActionExecutionClient.call_tool_mcp` gets the current MCP config, creates fresh clients for its SSE and SHTTP servers, finds the client that offers `action.name`, calls the tool, and returns an `MCPObservation` holding the JSON-serialized result. If no client offers the tool, it raises `ValueError`, which the runtime reports as an error.
- `CLIRuntime` also connects to stdio servers directly on the host, since it has no sandbox to proxy them.

`MCPClient` (`openhands/mcp/client.py`, built on FastMCP clients) connects in one of two ways:

- `connect_http` for SSE or SHTTP. It sends the API key as `Authorization: Bearer`, `s`, and `X-Session-API-Key` headers, plus `X-OpenHands-ServerConversation-ID` when a conversation id is known.
- `connect_stdio` for stdio servers. It first checks that the command exists with `shutil.which`, and skips the server if it doesn't.

Connection and tool errors go to `mcp_error_collector` so they can be reported.

## The stdio proxy inside the sandbox

Stdio MCP servers usually need to run where the code is, inside the sandbox. To make that work:

1. `ActionExecutionClient.get_mcp_config` compares the combined stdio server list with what it last pushed. When there are new servers, it `POST`s the full list to the in-sandbox `/update_mcp_server` endpoint.
2. The action execution server's `MCPProxyManager` (`openhands/runtime/mcp/proxy/manager.py`, a FastMCP proxy) launches those stdio servers and exposes them over SSE. The response's `router_error_log` lists servers that failed to start.
3. Once any stdio servers are registered, the client adds `<action_execution_server_url>/mcp/sse` as an extra **SSE server** in the returned config, authenticated with the session API key. The backend then reaches stdio tools over HTTP.

## Built-in OpenHands MCP server

`openhands/server/routes/mcp.py` defines `mcp_server = FastMCP('mcp', stateless_http=True, ...)`. `openhands/server/app.py` mounts it at `/mcp` (stateless streamable HTTP, endpoint `/mcp/mcp`). Its tools:

- `create_pr`: opens a GitHub pull request, draft by default, with optional labels.
- `create_mr`: opens a GitLab merge request.
- `create_bitbucket_pr`: opens a Bitbucket pull request.

Each tool authenticates the HTTP request through the normal user-auth dependencies. It gets the user's provider tokens, builds the provider service ([Git Provider Integrations](git-providers.md)), appends a link to the OpenHands conversation (`https://{WEB_HOST}/conversations/{id}`, using the conversation-ID header) to the body, and saves the PR or MR number from the tool result into the conversation's metadata (`save_pr_metadata`). The bundled `github` microagent tells agents to "ALWAYS use the `create_pr` tool".

## Tests

`tests/unit/mcp/` covers config parsing, client creation (including timeouts and stalled tools), the error collector, and integration with the agent tool list. `tests/runtime/test_mcp_action.py` runs MCP actions against a real sandbox, including the stdio proxy.

## Related pages

- [Runtime Architecture](../runtime/runtime-architecture.md)
- [Agents: CodeAct and the Agent Hub](../agents/agenthub.md)
- [Microagents](../concepts/microagents.md)
- [Configuration System](../configuration/config-system.md): the `[mcp]` section
