---
title: "MCP Tools"
---
## Overview

OpenHands integrates Model Context Protocol tools by discovering server schemas, registering them with the agent and dispatching `MCPAction` events through the runtime. The schema conversion preserves each tool's name, description and input schema as a function tool. This extends the built-in tools covered by [[Model Decisions and Tools]] while using the same action/observation cycle for results.

Sources: [openhands/mcp/utils.py:267-317](repo://openhands/mcp/utils.py#L267-L317), [openhands/mcp/tool.py:14-23](repo://openhands/mcp/tool.py#L14-L23), [openhands/agenthub/codeact_agent/function_calling.py:301-305](repo://openhands/agenthub/codeact_agent/function_calling.py#L301-L305), [openhands/runtime/base.py:361-371](repo://openhands/runtime/base.py#L361-L371)

## Transport configuration

`MCPConfig` holds three server lists: `sse_servers`, `shttp_servers` and `stdio_servers`. SSE and streamable-HTTP entries contain a URL and optional API key; URL strings can be normalized into objects. Stdio entries contain a name, executable, arguments and environment. [[Configuration]] describes how the `[mcp]` section reaches the runtime, while [[Memory and Microagents]] describes repository entries that can contribute extra stdio servers.

Sources: [openhands/core/config/mcp_config.py:46-77](repo://openhands/core/config/mcp_config.py#L46-L77), [openhands/core/config/mcp_config.py:191-237](repo://openhands/core/config/mcp_config.py#L191-L237), [openhands/core/config/utils.py:273-286](repo://openhands/core/config/utils.py#L273-L286), [openhands/mcp/utils.py:283-303](repo://openhands/mcp/utils.py#L283-L303)

Validation rejects empty URLs, missing schemes or hosts, and schemes outside the configured HTTP/WebSocket set. Stdio names allow letters, numbers, hyphens and underscores. The executable must be a nonempty single command without spaces; parameters belong in `args`, which also accepts shell-like strings through `shlex.split`. String environment input is parsed as comma-separated `KEY=VALUE` pairs with validated variable names. TOML parsing additionally checks duplicate SSE URLs; that check should not be described as universal duplicate detection across all transports.

Sources: [openhands/core/config/mcp_config.py:25-43](repo://openhands/core/config/mcp_config.py#L25-L43), [openhands/core/config/mcp_config.py:79-172](repo://openhands/core/config/mcp_config.py#L79-L172), [openhands/core/config/mcp_config.py:239-254](repo://openhands/core/config/mcp_config.py#L239-L254), [openhands/core/config/mcp_config.py:293-295](repo://openhands/core/config/mcp_config.py#L293-L295)

## Discovery and agent registration

`add_mcp_tools_to_agent` requires an initialized runtime. It collects microagent stdio configurations without exact duplicates, asks the runtime for its effective MCP configuration, fetches schemas and calls `agent.set_mcp_tools`. Direct stdio discovery is enabled only for `CLIRuntime`; action-server runtimes expose their stdio tools through the runtime proxy. On Windows, these helpers skip MCP registration. Browser startup performs registration before controller creation so the system message includes the tools.

Sources: [openhands/mcp/utils.py:267-317](repo://openhands/mcp/utils.py#L267-L317), [openhands/server/session/agent_session.py:165-189](repo://openhands/server/session/agent_session.py#L165-L189), [openhands/runtime/impl/action_execution/action_execution_client.py:441-448](repo://openhands/runtime/impl/action_execution/action_execution_client.py#L441-L448)

Discovery tries SSE, streamable HTTP and eligible stdio configurations, retaining clients only after successful connection. Stdio executables must be discoverable through `shutil.which`; missing commands are logged and skipped. Each client enters its connection context, calls `list_tools` and builds schema objects and a name-to-tool map. The agent skips MCP names it has already registered, keeping the first definition in its MCP dictionary. This is name-based registration, not a mechanism for selecting among several same-named external tools.

Sources: [openhands/mcp/utils.py:81-148](repo://openhands/mcp/utils.py#L81-L148), [openhands/mcp/client.py:33-55](repo://openhands/mcp/client.py#L33-L55), [openhands/controller/agent.py:163-183](repo://openhands/controller/agent.py#L163-L183)

## Runtime proxy lifecycle

For action-server runtimes, `get_mcp_config` combines configured and extra stdio entries with previously updated servers. When new entries exist, it sorts the combined definitions by name and posts them to `/update_mcp_server`. A successful HTTP response updates the client's remembered list, even if the returned `router_error_log` is nonempty and produces a warning. Once any stdio servers are remembered, the effective SSE list includes the runtime's `/mcp/sse` endpoint with its session key.

Sources: [openhands/runtime/impl/action_execution/action_execution_client.py:372-450](repo://openhands/runtime/impl/action_execution/action_execution_client.py#L372-L450)

The server validates that the update body is a list, constructs stdio configurations and calls `MCPProxyManager.update_and_remount`. That manager replaces its `mcpServers` dictionary, clears the old proxy reference, initializes `FastMCP.as_proxy` and mounts an SSE app. The update route catches proxy-update exceptions and returns their text as `router_error_log` in an HTTP 200 response. Inspecting that field is therefore part of determining whether the requested server setup succeeded.

Sources: [openhands/runtime/action_execution_server.py:854-883](repo://openhands/runtime/action_execution_server.py#L854-L883), [openhands/runtime/mcp/proxy/manager.py:54-67](repo://openhands/runtime/mcp/proxy/manager.py#L54-L67), [openhands/runtime/mcp/proxy/manager.py:105-146](repo://openhands/runtime/mcp/proxy/manager.py#L105-L146)

The CLI runtime follows a different path: it directly updates its own MCP configuration with additional stdio entries and returns the configured SSE, streamable-HTTP and stdio lists. It does not need the action-server proxy update to discover those local subprocess tools. [[Sandbox Execution]] explains the runtime boundary behind this distinction.

Sources: [openhands/runtime/impl/cli/cli_runtime.py:926-962](repo://openhands/runtime/impl/cli/cli_runtime.py#L926-L962), [openhands/mcp/utils.py:305-309](repo://openhands/mcp/utils.py#L305-L309)

## Invocation and observations

```mermaid
flowchart LR
  response["Registered MCP tool call"] --> action["MCPAction"]
  action --> runtime["Runtime.call_tool_mcp"]
  runtime --> clients["Create clients and find matching name"]
  clients --> call["MCPClient.call_tool"]
  call --> observation["MCPObservation"]
  observation --> stream["Cause and tool metadata added to EventStream"]
```

Sources: [openhands/agenthub/codeact_agent/function_calling.py:301-305](repo://openhands/agenthub/codeact_agent/function_calling.py#L301-L305), [openhands/runtime/base.py:367-399](repo://openhands/runtime/base.py#L367-L399), [openhands/runtime/impl/action_execution/action_execution_client.py:466-481](repo://openhands/runtime/impl/action_execution/action_execution_client.py#L466-L481), [openhands/mcp/utils.py:230-264](repo://openhands/mcp/utils.py#L230-L264), [openhands/mcp/client.py:147-156](repo://openhands/mcp/client.py#L147-L156)

For each action-server-runtime invocation, the runtime creates clients from effective SSE and streamable-HTTP settings, including the conversation ID. HTTP clients choose the corresponding transport and, when a key exists, attach bearer authorization plus the compatibility `s` and `X-Session-API-Key` headers. The conversation ID becomes `X-OpenHands-ServerConversation-ID`. `MCPClient.call_tool` validates the tool map and enters the client context for the call; discovery metadata does not keep a permanently open tool session.

Sources: [openhands/runtime/impl/action_execution/action_execution_client.py:466-481](repo://openhands/runtime/impl/action_execution/action_execution_client.py#L466-L481), [openhands/mcp/client.py:70-98](repo://openhands/mcp/client.py#L70-L98), [openhands/mcp/client.py:147-156](repo://openhands/mcp/client.py#L147-L156), [openhands/mcp/tool.py:5-9](repo://openhands/mcp/tool.py#L5-L9)

The dispatch helper chooses the first client advertising the requested name. A successful call becomes an `MCPObservation` whose content is the JSON serialization of the MCP result, alongside the action name and arguments. `McpError` becomes an observation with an error payload rather than propagating. No clients or no matching tool raise `ValueError` before that handler. The enclosing runtime then follows its general unexpected-error status path, so not every discovery or routing failure becomes ordinary tool feedback.

Sources: [openhands/mcp/utils.py:225-264](repo://openhands/mcp/utils.py#L225-L264), [openhands/runtime/base.py:383-399](repo://openhands/runtime/base.py#L383-L399)

## Diagnosing missing tools

Connection failures are logged and collected with server name, transport type, timestamp and exception details. Server discovery continues after individual failures, and schema-conversion or fetch failures can return an empty list. The error collector stores entries under a lock and exposes copies and counts. Distinguish three checkpoints when a tool is absent: configuration validation, successful server discovery and final agent registration; a running conversation alone does not establish that every configured MCP server contributed tools.

Sources: [openhands/mcp/client.py:99-145](repo://openhands/mcp/client.py#L99-L145), [openhands/mcp/utils.py:42-60](repo://openhands/mcp/utils.py#L42-L60), [openhands/mcp/utils.py:118-148](repo://openhands/mcp/utils.py#L118-L148), [openhands/mcp/utils.py:184-203](repo://openhands/mcp/utils.py#L184-L203), [openhands/mcp/error_collector.py:27-56](repo://openhands/mcp/error_collector.py#L27-L56)
