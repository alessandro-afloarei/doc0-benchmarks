---
title: "Model Context Protocol"
---
## Overview

The Model Context Protocol (MCP) lets an agent call tools that run in external servers. OpenHands has two sides to this. As a client, it connects to MCP servers named in the configuration, lists their tools, and offers them to the agent as actions. As a server, it exposes its own pull-request tools through a FastMCP instance mounted in the web server. This page covers the client side and the server's tools; the action and observation types it uses are the ones described in [[Events and the Event Stream]].

Sources: [openhands/mcp/client.py:23-33](repo://openhands/mcp/client.py#L23-L33) [openhands/server/routes/mcp.py:26-26](repo://openhands/server/routes/mcp.py#L26-L26) [openhands/server/routes/mcp.py:83-84](repo://openhands/server/routes/mcp.py#L83-L84)

## Server configuration

`MCPConfig` lists three kinds of server: SSE servers, stdio servers and streamable HTTP servers. Its docstring says the stdio servers are added to the MCP router that runs inside the runtime container.

Sources: [openhands/core/config/mcp_config.py:202-212](repo://openhands/core/config/mcp_config.py#L202-L212) [openhands/core/config/mcp_config.py:46-63](repo://openhands/core/config/mcp_config.py#L46-L63) [openhands/core/config/mcp_config.py:64-72](repo://openhands/core/config/mcp_config.py#L64-L72) [openhands/core/config/mcp_config.py:191-201](repo://openhands/core/config/mcp_config.py#L191-L201)

## Adding tools to the agent

When the agent has `enable_mcp` set, `run_controller` adds OpenHands' default MCP server to the runtime's stdio servers and then calls `add_mcp_tools_to_agent`. That function gathers the microagent MCP configurations and skips SSE servers from microagents, which the code does not yet support. The clients it creates are turned into tool definitions by `convert_mcp_clients_to_tools`, and each client's tools are represented by `MCPClientTool`.

Sources: [openhands/core/main.py:146-155](repo://openhands/core/main.py#L146-L155) [openhands/mcp/utils.py:267-290](repo://openhands/mcp/utils.py#L267-L290) [openhands/mcp/utils.py:28-62](repo://openhands/mcp/utils.py#L28-L62) [openhands/mcp/tool.py:5-14](repo://openhands/mcp/tool.py#L5-L14)

`MCPClient` opens a connection on demand. Its `connect_http` and `connect_stdio` methods create the transport, and `_initialize_and_list_tools` records the tool names it finds. `call_tool` opens a session for each call, so a client holds no session between calls.

Sources: [openhands/mcp/client.py:33-56](repo://openhands/mcp/client.py#L33-L56) [openhands/mcp/client.py:57-124](repo://openhands/mcp/client.py#L57-L124) [openhands/mcp/client.py:125-146](repo://openhands/mcp/client.py#L125-L146) [openhands/mcp/client.py:147-156](repo://openhands/mcp/client.py#L147-L156)

## From an agent call to an observation

An agent calls an MCP tool by emitting an `MCPAction` with the tool's name and arguments. The runtime handles it in `_handle_action` by calling `call_tool_mcp` instead of `run_action`. The action execution client rebuilds the clients from the current configuration and passes the action to `call_tool_mcp`. The result comes back as an observation with the action's id as its cause.

Sources: [openhands/runtime/base.py:361-372](repo://openhands/runtime/base.py#L361-L372) [openhands/runtime/impl/action_execution/action_execution_client.py:452-470](repo://openhands/runtime/impl/action_execution/action_execution_client.py#L452-L470) [openhands/mcp/utils.py:206-222](repo://openhands/mcp/utils.py#L206-L222) [openhands/events/action/mcp.py:9-16](repo://openhands/events/action/mcp.py#L9-L16)

`call_tool_mcp` returns an error observation on Windows, where MCP is disabled, and `add_mcp_tools_to_agent` skips tool setup there too.

Sources: [openhands/mcp/utils.py:213-222](repo://openhands/mcp/utils.py#L213-L222) [openhands/mcp/utils.py:267-276](repo://openhands/mcp/utils.py#L267-L276)

## OpenHands as an MCP server

The FastMCP instance in the server routes is mounted at `/mcp` on the FastAPI application, and it exposes three tools: `create_pr` for GitHub, `create_mr` for GitLab, and `create_bitbucket_pr` for Bitbucket. Each is registered with the `@mcp_server.tool()` decorator, so a client that connects to the server's MCP endpoint can call them. The git providers they use are described in [[Git Provider Integrations]].

Sources: [openhands/server/routes/mcp.py:26-26](repo://openhands/server/routes/mcp.py#L26-L26) [openhands/server/routes/mcp.py:83-84](repo://openhands/server/routes/mcp.py#L83-L84) [openhands/server/routes/mcp.py:151-152](repo://openhands/server/routes/mcp.py#L151-L152) [openhands/server/routes/mcp.py:225-226](repo://openhands/server/routes/mcp.py#L225-L226) [openhands/server/app.py:58-66](repo://openhands/server/app.py#L58-L66)
