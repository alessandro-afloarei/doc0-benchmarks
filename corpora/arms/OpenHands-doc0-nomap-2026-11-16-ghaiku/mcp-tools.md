---
title: "MCP Tools"
---
## Overview

The Model Context Protocol (MCP) lets an external server offer tools to the agent. OpenHands connects to the servers named in its configuration and in the microagents of the workspace, lists their tools, and offers those tools to the agent as ordinary function calls. When the agent calls one, the call becomes an `MCPAction`, and the runtime forwards it to the server that owns the tool.

Sources: [openhands/mcp/utils.py:267-317](repo://openhands/mcp/utils.py#L267-L317), [openhands/events/action/mcp.py:9-15](repo://openhands/events/action/mcp.py#L9-L15)

## Configuration

`MCPConfig` holds three lists: `sse_servers`, `stdio_servers` and `shttp_servers`. Each entry is a server config model. A stdio server has a name, a command, arguments and environment variables. The SSE and streamable HTTP entries have a URL that is validated when the config is built.

Sources: [openhands/core/config/mcp_config.py:202-214](repo://openhands/core/config/mcp_config.py#L202-L214), [openhands/core/config/mcp_config.py:64-72](repo://openhands/core/config/mcp_config.py#L64-L72)

The runtime adds its own action server as one more MCP server. `get_mcp_config` copies the configured `mcp` settings, appends any stdio servers from the microagents, and returns the result. A runtime that sees new stdio servers sends them to the sandbox with `/update_mcp_server`.

Sources: [openhands/runtime/impl/action_execution/action_execution_client.py:361-400](repo://openhands/runtime/impl/action_execution/action_execution_client.py#L361-L400), [openhands/runtime/action_execution_server.py:833-840](repo://openhands/runtime/action_execution_server.py#L833-L840)

## Discovering tools

`add_mcp_tools_to_agent` runs after the runtime connects. It adds the stdio servers declared by the loaded microagents, asks the runtime for its updated config, and fetches the tools from that config. The agent receives the list with `set_mcp_tools`. On Windows MCP is disabled, and the agent gets an empty list.

Sources: [openhands/mcp/utils.py:267-317](repo://openhands/mcp/utils.py#L267-L317), [openhands/server/session/agent_session.py:167-168](repo://openhands/server/session/agent_session.py#L167-L168)

`fetch_mcp_tools_from_config` creates a client for each server. Stdio servers are used only when the runtime is the CLI runtime. Each client's tools are turned into function-call dictionaries by `MCPClientTool.to_param`, and the agent offers them alongside its own tools.

Sources: [openhands/mcp/utils.py:28-60](repo://openhands/mcp/utils.py#L28-L60), [openhands/mcp/utils.py:151-165](repo://openhands/mcp/utils.py#L151-L165), [openhands/mcp/tool.py:14-23](repo://openhands/mcp/tool.py#L14-L23)

Sessions are created for each operation rather than kept open. `connect_http` handles SSE and streamable HTTP servers with a 30-second timeout by default, and `connect_stdio` starts a stdio transport with the server's command, arguments and environment.

Sources: [openhands/mcp/client.py:57-70](repo://openhands/mcp/client.py#L57-L70), [openhands/mcp/client.py:125-134](repo://openhands/mcp/client.py#L125-L134)

## Calling a tool

When the agent's tool call names an MCP tool, `function_calling` builds an `MCPAction` from the arguments. A name that matches neither a built-in tool nor an MCP tool is an error. The controller then runs the action, and `Runtime._handle_action` sends every `MCPAction` to `call_tool_mcp`, not to `run_action`.

Sources: [openhands/agenthub/codeact_agent/function_calling.py:301-308](repo://openhands/agenthub/codeact_agent/function_calling.py#L301-L308), [openhands/runtime/base.py:361-372](repo://openhands/runtime/base.py#L361-L372)

The client-side `call_tool_mcp` builds fresh clients from the updated config for the call. `call_tool_mcp` in `openhands/mcp/utils.py` finds the client that owns the tool name and calls it. It raises when no client has the tool, and it returns the server's error inside an `MCPObservation` when the server replies with an MCP error.

Sources: [openhands/runtime/impl/action_execution/action_execution_client.py:452-481](repo://openhands/runtime/impl/action_execution/action_execution_client.py#L452-L481), [openhands/mcp/utils.py:206-262](repo://openhands/mcp/utils.py#L206-L262)

`MCPClient.call_tool` checks that the tool is in the client's map and opens a session for the call. The result is returned as the server's own tool-call result.

Sources: [openhands/mcp/client.py:147-156](repo://openhands/mcp/client.py#L147-L156)

On Windows, the runtime returns an `ErrorObservation` for an MCP action instead of calling a server.

Sources: [openhands/runtime/impl/action_execution/action_execution_client.py:457-460](repo://openhands/runtime/impl/action_execution/action_execution_client.py#L457-L460), [openhands/mcp/utils.py:216-223](repo://openhands/mcp/utils.py#L216-L223)

The agent-side tool list and its selection are described in [[CodeAct Agent]]. The memory that adds microagent tool configs is described in [[Memory and Microagent Recall]].

Sources: [openhands/agenthub/codeact_agent/function_calling.py:301-308](repo://openhands/agenthub/codeact_agent/function_calling.py#L301-L308), [openhands/memory/memory.py:302-318](repo://openhands/memory/memory.py#L302-L318)
