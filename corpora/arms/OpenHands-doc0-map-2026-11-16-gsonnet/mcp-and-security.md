---
title: "MCP Tools and Security Analyzers"
---
## Overview

Two extension points sit between the agent's tool call and the sandbox. MCP (Model Context Protocol) servers add tools the agent can call beyond the built-in ones: `openhands/mcp` connects to the servers, lists their tools, and executes an `MCPAction` against the right one. Security analyzers rate each action's risk as an `ActionSecurityRisk`, which the [[Agent Controller Loop]] uses to decide whether to ask the user first. Both are wired in at session start, by the [[Runtime and Action Execution Server]] and the [[Server, Conversations and Sessions]] flow.

Sources: [openhands/mcp/utils.py:267-317](repo://openhands/mcp/utils.py#L267-L317), [openhands/security/analyzer.py:8-29](repo://openhands/security/analyzer.py#L8-L29)

## Connecting to MCP servers

An `MCPClient` wraps one FastMCP `Client`. Three transports exist, matching the three server config types.

Sources: [openhands/mcp/client.py:57-146](repo://openhands/mcp/client.py#L57-L146)

| Server config | Transport | Notes |
| --- | --- | --- |
| `MCPSSEServerConfig` | `SSETransport` | URL and optional `api_key`; URL must use http, https, ws or wss |
| `MCPSHTTPServerConfig` | `StreamableHttpTransport` | Same headers as SSE |
| `MCPStdioServerConfig` | `StdioTransport` | `command`, `args`, `env`; the command must be found on `PATH` |

Sources: [openhands/mcp/client.py:57-146](repo://openhands/mcp/client.py#L57-L146), [openhands/core/config/mcp_config.py:23-62](repo://openhands/core/config/mcp_config.py#L23-L62)

`connect_http` sets `Authorization: Bearer <key>`, plus `s` and `X-Session-API-Key` headers (the comments say these serve the action server's MCP router and the remote runtime), and an `X-OpenHands-ServerConversation-ID` header when there is a conversation. It uses a 30-second timeout. `_initialize_and_list_tools` opens the client, calls `list_tools` and stores each as an `MCPClientTool` in `tools` and `tool_map`. Connection errors are logged, recorded in the global `mcp_error_collector`, and re-raised.

Sources: [openhands/mcp/client.py:23-124](repo://openhands/mcp/client.py#L23-L124), [openhands/mcp/error_collector.py:19-78](repo://openhands/mcp/error_collector.py#L19-L78)

`create_mcp_clients` connects to every configured server and keeps only those that succeeded: a stdio server whose command is not on `PATH` is skipped with an error, and a failed connection is logged and dropped. On Windows it returns no clients at all.

Sources: [openhands/mcp/utils.py:63-148](repo://openhands/mcp/utils.py#L63-L148)

## From servers to agent tools

`add_mcp_tools_to_agent(agent, runtime, memory)` is the entry point, called after the runtime is connected (it asserts `runtime_initialized`). It works in four steps.

Sources: [openhands/mcp/utils.py:267-282](repo://openhands/mcp/utils.py#L267-L282)

1. Collects stdio servers from repo microagents through `memory.get_microagent_mcp_tools()` (SSE servers there only produce a warning).
2. Asks the runtime for its MCP config with those extra servers, which adds the sandbox's own `/mcp/sse` endpoint ([[Runtime and Action Execution Server]]).
3. Fetches tools with `fetch_mcp_tools_from_config`, using stdio servers directly only for a `CLIRuntime`.
4. Calls `agent.set_mcp_tools`.

Sources: [openhands/mcp/utils.py:267-317](repo://openhands/mcp/utils.py#L267-L317)

`MCPClientTool.to_param` turns each tool into a function definition (`type: function`, with `name`, `description` and the server's `inputSchema` as `parameters`), and `Agent.set_mcp_tools` records them in `agent.mcp_tools` and appends them to `agent.tools`, skipping duplicate names.

Sources: [openhands/mcp/tool.py:5-23](repo://openhands/mcp/tool.py#L5-L23), [openhands/controller/agent.py:163-181](repo://openhands/controller/agent.py#L163-L181)

The default servers come from `OpenHandsMCPConfig.create_default_mcp_server_config`: an SHTTP server at `http://<host>/mcp/mcp` and, when `search_api_key` starts with `tvly-`, a Tavily stdio server run with `npx`. `run_controller` calls it for the headless path when `enable_mcp` is set.

Sources: [openhands/core/config/mcp_config.py:317-355](repo://openhands/core/config/mcp_config.py#L317-L355), [openhands/core/main.py:147-155](repo://openhands/core/main.py#L147-L155)

## Calling an MCP tool

When the model calls a tool whose name is in `mcp_tools`, `response_to_actions` builds an `MCPAction(name, arguments)` ([[CodeAct Agent and Agent Catalogue]]). The runtime's `call_tool_mcp` creates fresh clients and passes the action to `openhands.mcp.utils.call_tool_mcp`, which finds the client whose tools include `action.name` (raising `ValueError` if none does) and calls it. The result becomes an `MCPObservation` with the JSON-dumped response. An `McpError` does not raise: it becomes an `MCPObservation` whose content is `{"isError": true, ...}`, so the model sees the failure.

Sources: [openhands/agenthub/codeact_agent/function_calling.py:301-306](repo://openhands/agenthub/codeact_agent/function_calling.py#L301-L306), [openhands/runtime/impl/action_execution/action_execution_client.py:452-482](repo://openhands/runtime/impl/action_execution/action_execution_client.py#L452-L482), [openhands/mcp/utils.py:206-264](repo://openhands/mcp/utils.py#L206-L264)

## Security analyzers

`SecurityAnalyzer` is the base class: `security_risk(action)` returns an `ActionSecurityRisk`, `handle_api_request(request)` serves analyzer-specific HTTP calls and `close()` frees resources. `options.SecurityAnalyzers` maps the config value (`security.security_analyzer`) to a class, and `Runtime.__init__` instantiates the chosen one; an unknown name falls back to the base class.

Sources: [openhands/security/analyzer.py:8-29](repo://openhands/security/analyzer.py#L8-L29), [openhands/security/options.py:1-8](repo://openhands/security/options.py#L1-L8), [openhands/core/config/security_config.py:5-13](repo://openhands/core/config/security_config.py#L5-L13), [openhands/runtime/base.py:195-204](repo://openhands/runtime/base.py#L195-L204)

| Name | Class | How it rates an action |
| --- | --- | --- |
| `llm` | `LLMRiskAnalyzer` | Trusts the risk the model itself supplied on the action; anything unrecognised is `UNKNOWN` |
| `invariant` | `InvariantAnalyzer` | Runs the action through Invariant policies in a Docker container and takes the highest risk found |

Sources: [openhands/security/llm/analyzer.py:10-42](repo://openhands/security/llm/analyzer.py#L10-L42), [openhands/security/invariant/analyzer.py:15-125](repo://openhands/security/invariant/analyzer.py#L15-L125)

The `llm` analyzer works because the CodeAct bash tool requires a `security_risk` argument (one of `LOW`, `MEDIUM`, `HIGH`) and `set_security_risk` copies it onto the action.

Sources: [openhands/agenthub/codeact_agent/tools/bash.py:70-80](repo://openhands/agenthub/codeact_agent/tools/bash.py#L70-L80), [openhands/agenthub/codeact_agent/tools/security_utils.py:10-10](repo://openhands/agenthub/codeact_agent/tools/security_utils.py#L10-L10), [openhands/agenthub/codeact_agent/function_calling.py:59-70](repo://openhands/agenthub/codeact_agent/function_calling.py#L59-L70)

`InvariantAnalyzer` starts or reuses a Docker container named `openhands-invariant-server` from `ghcr.io/invariantlabs-ai/server:openhands`, waits for it to be running, finds its mapped port and creates a monitor from a policy (the Invariant default template when none is given). Each action is parsed into trace elements appended to the running trace, then checked. A policy-check error returns `UNKNOWN`. Otherwise it looks for `risk=<level>` in each result and returns the maximum. The default policy in `policies.py` raises medium risk for secrets in bash commands and for semgrep findings in Python or bash code.

Sources: [openhands/security/invariant/analyzer.py:15-125](repo://openhands/security/invariant/analyzer.py#L15-L125), [openhands/security/invariant/policies.py:1-19](repo://openhands/security/invariant/policies.py#L1-L19)

An analyzer can also expose its own API: the `/security/{path}` route forwards any request to the conversation's `handle_api_request`, and answers with an error when there is no analyzer.

Sources: [openhands/server/routes/security.py:19-42](repo://openhands/server/routes/security.py#L19-L42)
