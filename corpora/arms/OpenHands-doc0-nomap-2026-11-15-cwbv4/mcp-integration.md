---
title: "MCP Integration"
---
## Overview

The Model Context Protocol (MCP) lets an agent use tools served by external programs: a search engine, a ticket tracker, a database. OpenHands treats every MCP tool as one more tool definition in the agent's list. When the model calls one, the agent emits an `MCPAction(name, arguments)`, the runtime calls the tool on the server that offers it, and the JSON result comes back as an `MCPObservation`.

Sources: [openhands/mcp/utils.py:206-264](repo://openhands/mcp/utils.py#L206-L264), [openhands/agenthub/codeact_agent/function_calling.py:298-305](repo://openhands/agenthub/codeact_agent/function_calling.py#L298-L305)

OpenHands is also an MCP server itself: the application server exposes tools such as `create_pr` at `/mcp`, so an agent in the sandbox can open pull requests with the user's credentials without ever seeing them. All MCP support is switched off on Windows.

Sources: [openhands/server/routes/mcp.py:26-31](repo://openhands/server/routes/mcp.py#L26-L31), [openhands/server/app.py:37-64](repo://openhands/server/app.py#L37-L64), [openhands/mcp/utils.py:71-76](repo://openhands/mcp/utils.py#L71-L76)

## Configuring servers

### Three transports

`MCPConfig` holds three lists. SSE and streamable-HTTP (SHTTP) servers are remote and given by `url` and an optional `api_key`; stdio servers are local programs given by `name`, `command`, `args` and `env`. The `[mcp]` section of `config.toml` fills them, and user settings from the web UI are merged in when a conversation starts.

Sources: [openhands/core/config/mcp_config.py:46-120](repo://openhands/core/config/mcp_config.py#L46-L120), [openhands/core/config/mcp_config.py:191-213](repo://openhands/core/config/mcp_config.py#L191-L213), [openhands/core/config/mcp_config.py:257-313](repo://openhands/core/config/mcp_config.py#L257-L313), [openhands/server/session/session.py:186-210](repo://openhands/server/session/session.py#L186-L210)

```toml
[mcp]
sse_servers = ["http://localhost:8080/sse"]
shttp_servers = [{ url = "https://mcp.example.com/mcp", api_key = "..." }]
stdio_servers = [{ name = "fetch", command = "uvx", args = ["mcp-server-fetch"] }]
```

Sources: [openhands/core/config/mcp_config.py:217-237](repo://openhands/core/config/mcp_config.py#L217-L237)

### Default servers

`OpenHandsMCPConfig.create_default_mcp_server_config` adds two things to every conversation: the OpenHands server's own MCP endpoint as an SHTTP server at `http://<mcp_host>/mcp/mcp`, and, when `search_api_key` is a Tavily key (`tvly-...`), a `tavily-mcp` stdio server for web search. The class can be replaced through `OPENHANDS_MCP_CONFIG_CLS`, as the enterprise server does.

Sources: [openhands/core/config/mcp_config.py:315-363](repo://openhands/core/config/mcp_config.py#L315-L363)

Repository microagents can contribute stdio servers through `mcp_tools` in their frontmatter, see [[Microagents]].

Sources: [openhands/memory/memory.py:302-318](repo://openhands/memory/memory.py#L302-L318)

## Giving the agent its tools

### add_mcp_tools_to_agent

The headless runner, the CLI and the server's agent session all call `add_mcp_tools_to_agent(agent, runtime, memory)` once the runtime is connected:

Sources: [openhands/mcp/utils.py:267-282](repo://openhands/mcp/utils.py#L267-L282)

1. collect stdio servers from repository microagents (SSE servers there are not supported);
2. ask the runtime for its MCP config with those extra servers, `runtime.get_mcp_config(extra)`;
3. connect to each server, list its tools and convert them to tool definitions;
4. hand them to `agent.set_mcp_tools`, which skips names it already has.

Sources: [openhands/mcp/utils.py:267-317](repo://openhands/mcp/utils.py#L267-L317), [openhands/core/main.py:145-155](repo://openhands/core/main.py#L145-L155), [openhands/server/session/agent_session.py:160-170](repo://openhands/server/session/agent_session.py#L160-L170)

### Stdio servers run in the sandbox

Stdio servers are programs, and programs should run in the sandbox, not on the OpenHands host. For sandboxed runtimes, `get_mcp_config` therefore sends the stdio server list to the action server's `/update_mcp_server` endpoint whenever new servers appear. There an `MCPProxyManager` runs them behind a FastMCP proxy mounted at `/mcp`, protected by the session API key. The runtime then adds the action server's `/mcp/sse` endpoint as one more SSE server, so the host reaches every sandboxed stdio tool over HTTP. Only the CLI runtime connects to stdio servers directly.

Sources: [openhands/runtime/impl/action_execution/action_execution_client.py:361-450](repo://openhands/runtime/impl/action_execution/action_execution_client.py#L361-L450), [openhands/runtime/action_execution_server.py:833-884](repo://openhands/runtime/action_execution_server.py#L833-L884), [openhands/runtime/mcp/proxy/manager.py:21-110](repo://openhands/runtime/mcp/proxy/manager.py#L21-L110), [openhands/mcp/utils.py:305-309](repo://openhands/mcp/utils.py#L305-L309)

### MCPClient

`MCPClient` wraps a FastMCP client. `connect_http` uses an SSE or streamable-HTTP transport with a 30-second timeout and sends the server's API key both as `Authorization: Bearer` and as `X-Session-API-Key` (the remote runtime expects the latter), plus `X-OpenHands-ServerConversation-ID` when a conversation id is known. `connect_stdio` starts the program over stdio; `create_mcp_clients` skips stdio servers whose command is not installed. After connecting, the client lists the server's tools.

Sources: [openhands/mcp/client.py:33-120](repo://openhands/mcp/client.py#L33-L120), [openhands/mcp/client.py:125-156](repo://openhands/mcp/client.py#L125-L156), [openhands/mcp/utils.py:63-148](repo://openhands/mcp/utils.py#L63-L148)

Connection failures do not stop the conversation: the server is skipped and the error is recorded in `mcp_error_collector`, which the CLI shows to the user.

Sources: [openhands/mcp/utils.py:50-59](repo://openhands/mcp/utils.py#L50-L59), [openhands/cli/tui.py:195-205](repo://openhands/cli/tui.py#L195-L205)

## Calling a tool

The runtime handles `MCPAction` separately from other actions: `_handle_action` awaits `call_tool_mcp` instead of `run_action`. For sandboxed runtimes it rebuilds the MCP config, creates fresh clients for the SSE and SHTTP servers with the conversation id, finds the client whose tool list contains the action's name, and calls the tool. The result's JSON becomes the observation's content. An `McpError` is returned as an `MCPObservation` with `isError: true` rather than raised, so the model sees the failure; an unknown tool name raises.

Sources: [openhands/runtime/base.py:361-372](repo://openhands/runtime/base.py#L361-L372), [openhands/runtime/impl/action_execution/action_execution_client.py:452-481](repo://openhands/runtime/impl/action_execution/action_execution_client.py#L452-L481), [openhands/mcp/utils.py:206-264](repo://openhands/mcp/utils.py#L206-L264)

## OpenHands as an MCP server

### Mounting

`openhands/server/routes/mcp.py` defines `mcp_server`, a stateless-HTTP FastMCP server whose error details are masked. The FastAPI app mounts its HTTP app at `/mcp` and combines its lifespan with the conversation manager's.

Sources: [openhands/server/routes/mcp.py:26-31](repo://openhands/server/routes/mcp.py#L26-L31), [openhands/server/app.py:37-64](repo://openhands/server/app.py#L37-L64)

### Tools

| Tool | Provider | Does |
| --- | --- | --- |
| `create_pr` | GitHub | opens a pull request (draft by default) with title, body, branches and optional existing labels |
| `create_mr` | GitLab | opens a merge request |
| `create_bitbucket_pr` | Bitbucket | opens a pull request |

Sources: [openhands/server/routes/mcp.py:83-152](repo://openhands/server/routes/mcp.py#L83-L152), [openhands/server/routes/mcp.py:225-230](repo://openhands/server/routes/mcp.py#L225-L230)

Each tool reads the calling conversation from the `X-OpenHands-ServerConversation-ID` header and the user's provider tokens from the request, builds the provider's service (see [[Git Provider Integrations]]), and creates the pull request. In SaaS mode it appends a link back to the conversation to the PR body. It then records the PR number on the conversation's metadata. Failures are raised as `ToolError`.

Sources: [openhands/server/routes/mcp.py:34-82](repo://openhands/server/routes/mcp.py#L34-L82), [openhands/server/routes/mcp.py:100-149](repo://openhands/server/routes/mcp.py#L100-L149)

The bundled `github` microagent tells the agent to always use the `create_pr` tool to open pull requests, which is what routes PR creation through this server.

Sources: [microagents/github.md:14-18](repo://microagents/github.md#L14-L18)
