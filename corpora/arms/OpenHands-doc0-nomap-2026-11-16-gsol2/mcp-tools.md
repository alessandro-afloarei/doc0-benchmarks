---
title: "MCP Tools"
---
## Overview

MCP extends the agent's tool list with tools discovered from external servers. OpenHands supports SSE, streamable HTTP, and stdio configurations, converts discovered schemas into function definitions, and routes selected model calls through the runtime. Ordinary action execution is described in [[Sandbox Runtimes]], and [[Agents and Tools]] explains how a registered external name becomes `MCPAction`. Discovery happens before controller construction so the initial system message includes the resulting tools.

Sources: [openhands/core/config/mcp_config.py:202-214](repo://openhands/core/config/mcp_config.py#L202-L214), [openhands/mcp/tool.py:14-23](repo://openhands/mcp/tool.py#L14-L23), [openhands/agenthub/codeact_agent/function_calling.py:301-305](repo://openhands/agenthub/codeact_agent/function_calling.py#L301-L305), [openhands/server/session/agent_session.py:165-168](repo://openhands/server/session/agent_session.py#L165-L168)

## Server configuration

| Transport | Configuration | Connection |
| --- | --- | --- |
| SSE | `MCPSSEServerConfig` with URL and optional API key | `SSETransport` |
| Streamable HTTP | `MCPSHTTPServerConfig` with URL and optional API key | `StreamableHttpTransport` |
| Stdio | `MCPStdioServerConfig` with name, executable, arguments, and environment | `StdioTransport`, directly for CLI or behind the runtime proxy |

Sources: [openhands/core/config/mcp_config.py:46-77](repo://openhands/core/config/mcp_config.py#L46-L77), [openhands/core/config/mcp_config.py:191-214](repo://openhands/core/config/mcp_config.py#L191-L214), [openhands/mcp/client.py:84-98](repo://openhands/mcp/client.py#L84-L98), [openhands/mcp/client.py:125-132](repo://openhands/mcp/client.py#L125-L132), [openhands/mcp/utils.py:302-309](repo://openhands/mcp/utils.py#L302-L309), [openhands/runtime/impl/action_execution/action_execution_client.py:403-447](repo://openhands/runtime/impl/action_execution/action_execution_client.py#L403-L447)

URL validation requires a nonempty URL with a scheme and host, allowing HTTP, HTTPS, WS, or WSS. Stdio names accept letters, numbers, underscores, and hyphens. The command must be one executable without spaces; arguments belong in `args`, which accepts a list or a shell-like string parsed with `shlex.split`. Environment strings accept comma-separated `KEY=VALUE` pairs and validate variable names. [[Configuration]] explains how these models enter application settings.

Sources: [openhands/core/config/mcp_config.py:25-43](repo://openhands/core/config/mcp_config.py#L25-L43), [openhands/core/config/mcp_config.py:79-172](repo://openhands/core/config/mcp_config.py#L79-L172)

## Discover tools during startup

`add_mcp_tools_to_agent` requires an initialized runtime. It collects repository-microagent MCP configurations from memory and deduplicates stdio definitions using their equality comparison. Microagent SSE configuration produces a warning. It then asks the runtime for updated MCP configuration, fetches tools, and calls `agent.set_mcp_tools`. [[Memory and Microagents]] describes how repository microagents are loaded and why these configurations are available independently of keyword matching.

Sources: [openhands/mcp/utils.py:267-317](repo://openhands/mcp/utils.py#L267-L317), [openhands/core/config/mcp_config.py:174-188](repo://openhands/core/config/mcp_config.py#L174-L188), [openhands/memory/memory.py:302-318](repo://openhands/memory/memory.py#L302-L318)

`fetch_mcp_tools_from_config` creates clients for SSE and streamable HTTP servers, adding direct stdio connections only for `CLIRuntime`. Each client opens its FastMCP session, lists tools, and stores metadata in a tool list and name map. `MCPClientTool.to_param` preserves the tool name, description, and input schema as a function definition. The agent indexes these definitions by name and skips duplicate MCP names, making the discovered name the identity used for later calls.

Sources: [openhands/mcp/utils.py:151-203](repo://openhands/mcp/utils.py#L151-L203), [openhands/mcp/client.py:33-55](repo://openhands/mcp/client.py#L33-L55), [openhands/mcp/tool.py:14-23](repo://openhands/mcp/tool.py#L14-L23), [openhands/controller/agent.py:163-183](repo://openhands/controller/agent.py#L163-L183)

## Runtime stdio proxy

For HTTP action-execution runtimes, `get_mcp_config` merges configured and extra stdio servers with the previously synchronized list. It only posts `/update_mcp_server` when it finds new definitions, sorting the submitted servers by name. After a successful update it caches the combined list and, when any stdio servers are tracked, adds the runtime's `/mcp/sse` endpoint with its session API key to the returned SSE configuration. This exposes runtime-local processes through a transport the host client can reach.

Sources: [openhands/runtime/impl/action_execution/action_execution_client.py:372-450](repo://openhands/runtime/impl/action_execution/action_execution_client.py#L372-L450)

The execution server validates that updates are lists, converts entries to stdio configuration models, and invokes `MCPProxyManager.update_and_remount`. The manager rebuilds its name-keyed `mcpServers` mapping, initializes a FastMCP proxy, and mounts its SSE application. With no servers, initialization and mounting are skipped. Update exceptions are returned in `router_error_log` inside an HTTP 200 response, so callers inspect both HTTP status and that field.

Sources: [openhands/runtime/action_execution_server.py:854-883](repo://openhands/runtime/action_execution_server.py#L854-L883), [openhands/runtime/mcp/proxy/manager.py:54-85](repo://openhands/runtime/mcp/proxy/manager.py#L54-L85), [openhands/runtime/mcp/proxy/manager.py:105-146](repo://openhands/runtime/mcp/proxy/manager.py#L105-L146)

## Invoke a selected tool

An action-execution runtime obtains its current MCP configuration and creates clients for the operation. HTTP clients add bearer authorization, `s`, and `X-Session-API-Key` headers when an API key exists; a supplied conversation ID adds `X-OpenHands-ServerConversation-ID`. Tool invocation finds the first connected client advertising the action's name. That client checks its tool map, opens a session, and calls `call_tool_mcp` with the name and arguments.

Sources: [openhands/runtime/impl/action_execution/action_execution_client.py:452-480](repo://openhands/runtime/impl/action_execution/action_execution_client.py#L452-L480), [openhands/mcp/client.py:70-98](repo://openhands/mcp/client.py#L70-L98), [openhands/mcp/client.py:147-156](repo://openhands/mcp/client.py#L147-L156), [openhands/mcp/utils.py:225-248](repo://openhands/mcp/utils.py#L225-L248)

```mermaid
flowchart TD
  action["MCPAction name and arguments"] --> config["Runtime MCP configuration"]
  config --> clients["Connect and discover clients"]
  clients --> match["Find first matching tool name"]
  match --> call["Call tool in client session"]
  call --> result["Serialize MCP result as MCPObservation"]
  result --> stream["Runtime publishes correlated observation"]
```

Sources: [openhands/runtime/impl/action_execution/action_execution_client.py:466-480](repo://openhands/runtime/impl/action_execution/action_execution_client.py#L466-L480), [openhands/mcp/utils.py:230-264](repo://openhands/mcp/utils.py#L230-L264), [openhands/runtime/base.py:361-399](repo://openhands/runtime/base.py#L361-L399)

Results are JSON-serialized from the MCP result into `MCPObservation`, retaining the requested name and arguments. A protocol `McpError` becomes an MCP observation containing `isError: true`, an error string, and empty content. No clients or no matching client raises `ValueError` instead. The runtime handler then determines status reporting for exceptions and attaches normal observation correlation as described in [[Controller and Event Stream]].

Sources: [openhands/mcp/utils.py:225-264](repo://openhands/mcp/utils.py#L225-L264), [openhands/runtime/base.py:361-399](repo://openhands/runtime/base.py#L361-L399)

## Defaults and failure diagnosis

The default MCP configuration constructs the shared server URL `http://<host>/mcp/mcp` and optionally adds a Tavily stdio server when the search key begins with `tvly-`. The search definition runs `npx` with a pinned package argument and passes the key through its environment. Configuration construction and activation are separate: the calling entry point decides which returned server configurations to add.

Sources: [openhands/core/config/mcp_config.py:315-355](repo://openhands/core/config/mcp_config.py#L315-L355), [openhands/core/main.py:145-155](repo://openhands/core/main.py#L145-L155)

Client creation continues after individual connection failures and skips stdio servers whose executable cannot be found. Connection errors are logged and collected by server and transport type; conversion or fetch failures return an empty tool list. Thus a session may start with fewer tools than configured. Windows branches disable discovery and invocation in this implementation. Inspect executable availability, connection errors, `router_error_log`, and the final loaded tool names to distinguish a missing schema from a failing invocation.

Sources: [openhands/mcp/utils.py:69-148](repo://openhands/mcp/utils.py#L69-L148), [openhands/mcp/utils.py:42-59](repo://openhands/mcp/utils.py#L42-L59), [openhands/mcp/utils.py:184-203](repo://openhands/mcp/utils.py#L184-L203), [openhands/mcp/client.py:99-123](repo://openhands/mcp/client.py#L99-L123), [openhands/runtime/impl/action_execution/action_execution_client.py:419-432](repo://openhands/runtime/impl/action_execution/action_execution_client.py#L419-L432), [openhands/runtime/impl/action_execution/action_execution_client.py:457-460](repo://openhands/runtime/impl/action_execution/action_execution_client.py#L457-L460)
