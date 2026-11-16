---
title: "MCP Tools"
---
## Overview

MCP integration makes tools from external servers available in the agent's function-call list. Setup collects server configuration, discovers tool schemas and registers them before the controller constructs its system message. At execution time an `MCPAction` follows a dedicated runtime branch and returns an observation. [[Sandbox Execution]] covers built-in actions; [[Memory and Microagents]] explains repository microagents that contribute additional MCP servers.

Sources: [openhands/mcp/utils.py:267-317](repo://openhands/mcp/utils.py#L267-L317), [openhands/server/session/agent_session.py:165-189](repo://openhands/server/session/agent_session.py#L165-L189), [openhands/runtime/base.py:361-399](repo://openhands/runtime/base.py#L361-L399)

## Server configuration

| Transport | Configuration fields | Connection behavior |
| --- | --- | --- |
| SSE | URL and optional API key | Creates an SSE transport with request headers |
| Streamable HTTP | URL and optional API key | Creates a streamable HTTP transport with request headers |
| stdio | Name, executable, arguments and environment | Starts a stdio transport; CLI can connect directly, while action-server runtimes expose these through a proxy |

Sources: [openhands/core/config/mcp_config.py:46-77](repo://openhands/core/config/mcp_config.py#L46-L77), [openhands/core/config/mcp_config.py:191-214](repo://openhands/core/config/mcp_config.py#L191-L214), [openhands/mcp/client.py:57-98](repo://openhands/mcp/client.py#L57-L98), [openhands/mcp/client.py:125-132](repo://openhands/mcp/client.py#L125-L132), [openhands/mcp/utils.py:302-309](repo://openhands/mcp/utils.py#L302-L309), [openhands/runtime/impl/action_execution/action_execution_client.py:395-448](repo://openhands/runtime/impl/action_execution/action_execution_client.py#L395-L448)

URL validation requires a non-empty URL with scheme and host; allowed schemes are HTTP, HTTPS, WS and WSS. Stdio names accept letters, numbers, hyphens and underscores. The command must be a single non-empty executable without spaces, with parameters placed in `args`. String arguments use `shlex.split`, and string environment values use comma-separated `KEY=VALUE` entries with validated keys. Invalid forms raise configuration validation errors before discovery.

Sources: [openhands/core/config/mcp_config.py:25-43](repo://openhands/core/config/mcp_config.py#L25-L43), [openhands/core/config/mcp_config.py:79-172](repo://openhands/core/config/mcp_config.py#L79-L172)

Application and persisted settings combine transport lists as described in [[Configuration]]. MCP's own `merge` concatenates lists. The default OpenHands MCP configuration also constructs a server URL under `/mcp/mcp` and optionally adds Tavily through `npx` when the configured search key starts with the expected prefix. The caller determines which returned entries it installs; the headless setup appends the returned stdio entries to its runtime configuration.

Sources: [openhands/core/config/mcp_config.py:307-355](repo://openhands/core/config/mcp_config.py#L307-L355), [openhands/core/main.py:145-155](repo://openhands/core/main.py#L145-L155), [openhands/storage/data_models/settings.py:158-185](repo://openhands/storage/data_models/settings.py#L158-L185)

## Discovery and agent registration

`add_mcp_tools_to_agent` requires an initialized runtime. It collects stdio configurations from repository microagents, removes duplicate extra entries by configuration equality, asks the runtime for its effective MCP configuration and discovers tools. Direct stdio discovery is enabled only for `CLIRuntime`. On Windows, this setup path installs an empty external-tool list and returns early because MCP functionality is disabled.

Sources: [openhands/mcp/utils.py:267-317](repo://openhands/mcp/utils.py#L267-L317)

Client creation visits configured servers independently. A missing stdio executable is logged and skipped, failed connections are logged, and successful connections remain available for discovery. HTTP clients attach optional bearer, session and router authentication headers, plus a conversation-ID header when one is provided. Each client lists tools and stores their supplied names, descriptions and input schemas. `MCPClientTool.to_param` translates that metadata directly into a model function schema.

Sources: [openhands/mcp/utils.py:81-148](repo://openhands/mcp/utils.py#L81-L148), [openhands/mcp/client.py:33-55](repo://openhands/mcp/client.py#L33-L55), [openhands/mcp/client.py:70-98](repo://openhands/mcp/client.py#L70-L98), [openhands/mcp/tool.py:14-23](repo://openhands/mcp/tool.py#L14-L23)

`Agent.set_mcp_tools` records tools by function name and appends them to its full tool list. A duplicate external-tool name is logged and skipped. The client metadata adapter does not rename supplied tools, so the names returned by discovery determine what the action parser and execution lookup use. A tool failing to appear in the agent list should be investigated at discovery and registration before checking the model's choice of action.

Sources: [openhands/controller/agent.py:163-183](repo://openhands/controller/agent.py#L163-L183), [openhands/mcp/client.py:44-53](repo://openhands/mcp/client.py#L44-L53), [openhands/agenthub/codeact_agent/codeact_agent.py:295-299](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L295-L299)

## Runtime proxy and execution

For action-server runtimes, `get_mcp_config` compares current stdio servers with its last successfully updated list. When new entries appear, it sends the combined server list to `/update_mcp_server`, retaining older entries and sorting by server name. Successful updates refresh the tracked list; router error logs are surfaced as warnings. Once stdio servers are tracked, the effective configuration includes the runtime's `/mcp/sse` endpoint with its session API key.

Sources: [openhands/runtime/impl/action_execution/action_execution_client.py:372-450](repo://openhands/runtime/impl/action_execution/action_execution_client.py#L372-L450)

The proxy manager turns stdio configurations into an `mcpServers` mapping keyed by server name, recreates its FastMCP proxy and remounts its SSE application. An empty server set skips initialization and mounting. This places stdio server processes behind the action runtime's network interface, while CLI execution uses the configured stdio transports directly. The runtime-specific split is a deployment boundary, not a difference in model-facing tool schemas.

Sources: [openhands/runtime/mcp/proxy/manager.py:54-85](repo://openhands/runtime/mcp/proxy/manager.py#L54-L85), [openhands/runtime/mcp/proxy/manager.py:105-146](repo://openhands/runtime/mcp/proxy/manager.py#L105-L146), [openhands/runtime/impl/cli/cli_runtime.py:724-745](repo://openhands/runtime/impl/cli/cli_runtime.py#L724-L745), [openhands/mcp/tool.py:14-23](repo://openhands/mcp/tool.py#L14-L23)

```mermaid
flowchart LR
  action["MCPAction name and arguments"] --> runtime["Runtime-specific client creation"]
  runtime --> match["Find first client exposing tool name"]
  match --> call["MCPClient.call_tool"]
  call --> server["Server tool invocation"]
  server --> observation["MCPObservation with serialized result"]
  observation --> stream["Event stream with action cause"]
```

Sources: [openhands/runtime/impl/action_execution/action_execution_client.py:452-481](repo://openhands/runtime/impl/action_execution/action_execution_client.py#L452-L481), [openhands/mcp/utils.py:225-264](repo://openhands/mcp/utils.py#L225-L264), [openhands/mcp/client.py:147-156](repo://openhands/mcp/client.py#L147-L156), [openhands/runtime/base.py:391-399](repo://openhands/runtime/base.py#L391-L399)

Execution creates clients for the operation and selects the first one whose discovered tools contain the action name. `MCPClient.call_tool` verifies the name exists, opens its client context and invokes the tool. The complete MCP result is JSON-serialized into `MCPObservation`, alongside the tool name and arguments. The base runtime then carries over tool metadata and action cause so [[Agent Decisions and Control]] can match the result to pending work.

Sources: [openhands/mcp/utils.py:230-255](repo://openhands/mcp/utils.py#L230-L255), [openhands/mcp/client.py:147-156](repo://openhands/mcp/client.py#L147-L156), [openhands/runtime/base.py:391-399](repo://openhands/runtime/base.py#L391-L399)

## Failure reporting

Discovery can return an empty tool list when no connections succeed, and conversion errors are logged and collected. Invocation with no clients or no matching tool raises `ValueError`. An MCP protocol error during invocation becomes an `MCPObservation` containing an error payload rather than escaping as that protocol exception. The CLI runtime additionally converts missing-server, missing-client and other execution failures into `ErrorObservation`. [[CLI and Headless Tasks]] documents the `/mcp` command used to inspect configuration and collected errors.

Sources: [openhands/mcp/utils.py:38-60](repo://openhands/mcp/utils.py#L38-L60), [openhands/mcp/utils.py:173-200](repo://openhands/mcp/utils.py#L173-L200), [openhands/mcp/utils.py:225-264](repo://openhands/mcp/utils.py#L225-L264), [openhands/runtime/impl/cli/cli_runtime.py:705-750](repo://openhands/runtime/impl/cli/cli_runtime.py#L705-L750), [openhands/cli/commands.py:166-167](repo://openhands/cli/commands.py#L166-L167)
