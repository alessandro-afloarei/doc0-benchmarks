---
title: "MCP Tools and Integrations"
---
## Overview

MCP extends an agent's tool list with tools discovered from configured servers. Startup combines application configuration and repository microagent declarations, asks the initialized runtime for its effective configuration, fetches tool schemas and installs them on the agent. [[Memory and Microagents]] owns repository declarations; [[Model Calls and Routing]] owns conversion from model tool calls to `MCPAction`. This page follows the connection and execution boundary between those systems.

Sources: [openhands/mcp/utils.py:267-317](repo://openhands/mcp/utils.py#L267-L317), [openhands/agenthub/codeact_agent/function_calling.py:299-305](repo://openhands/agenthub/codeact_agent/function_calling.py#L299-L305)

## Configure transports

`MCPConfig` contains separate lists for SSE, streamable HTTP and stdio servers and forbids extra configuration fields. HTTP lists accept URL strings as shorthand for dictionaries. URL validation trims whitespace and requires a supported scheme and host. Stdio configuration names must be nonempty and contain only letters, digits, hyphens or underscores; it also carries the executable command, argument list and environment dictionary.

Sources: [openhands/core/config/mcp_config.py:25-43](repo://openhands/core/config/mcp_config.py#L25-L43), [openhands/core/config/mcp_config.py:64-94](repo://openhands/core/config/mcp_config.py#L64-L94), [openhands/core/config/mcp_config.py:202-237](repo://openhands/core/config/mcp_config.py#L202-L237)

| Transport | Configuration and client behavior |
| --- | --- |
| SSE | URL and optional API key; creates `SSETransport` |
| Streamable HTTP | URL and optional API key; creates `StreamableHttpTransport` |
| Stdio | Named command, arguments and environment; creates `StdioTransport` |

Sources: [openhands/core/config/mcp_config.py:46-77](repo://openhands/core/config/mcp_config.py#L46-L77), [openhands/mcp/client.py:57-98](repo://openhands/mcp/client.py#L57-L98), [openhands/mcp/client.py:125-132](repo://openhands/mcp/client.py#L125-L132)

HTTP connection includes bearer authorization plus the session headers expected by runtime endpoints when an API key is present. A supplied conversation ID adds `X-OpenHands-ServerConversation-ID`. Both HTTP and stdio clients default to a 30-second client timeout, then initialize and list tools through the configured transport. [[Configuration]] describes how these server configurations enter the application.

Sources: [openhands/mcp/client.py:57-98](repo://openhands/mcp/client.py#L57-L98), [openhands/mcp/client.py:125-132](repo://openhands/mcp/client.py#L125-L132)

## Discover and install tools

`create_mcp_clients` builds clients for the requested server lists, adding a client only after connection succeeds. Before launching a stdio server it checks that the command can be found with `shutil.which`; a missing command is logged and skipped. Connection failures are logged per server, allowing successful servers to contribute their tools. Empty configuration returns an empty list, and Windows skips client creation entirely in this implementation.

Sources: [openhands/mcp/utils.py:63-148](repo://openhands/mcp/utils.py#L63-L148)

Discovery enters each client's session, calls `list_tools` and creates local tool objects with name, description and input schema. Conversion calls each tool's `to_param` to produce the model-facing tool definitions. The agent then registers each MCP name and appends the definition to its normal tool list; duplicate MCP names are warned about and skipped. This registration supplies the names recognized during model response conversion.

Sources: [openhands/mcp/client.py:33-55](repo://openhands/mcp/client.py#L33-L55), [openhands/mcp/utils.py:28-60](repo://openhands/mcp/utils.py#L28-L60), [openhands/controller/agent.py:163-183](repo://openhands/controller/agent.py#L163-L183), [openhands/agenthub/codeact_agent/codeact_agent.py:295-299](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L295-L299)

`add_mcp_tools_to_agent` requires an initialized runtime. It gathers unique stdio declarations from repository microagents, asks the runtime to incorporate them and fetches the effective tool list. Direct stdio discovery is enabled only for `CLIRuntime`; other runtimes supply their own routed configuration. Browser session startup does this before constructing the controller so the recorded system message includes the tools.

Sources: [openhands/mcp/utils.py:279-315](repo://openhands/mcp/utils.py#L279-L315), [openhands/server/session/agent_session.py:165-189](repo://openhands/server/session/agent_session.py#L165-L189)

## Runtime routing for stdio servers

Execution-server runtimes copy their configured MCP settings and combine current stdio servers with extra microagent servers. Newly encountered servers trigger `/update_mcp_server`; the payload preserves previously known servers and sorts them by name. A successful response updates the runtime's cached list, while router error details are logged. Once stdio servers are registered, the runtime includes its own `/mcp/sse` endpoint with the session API key.

Sources: [openhands/runtime/impl/action_execution/action_execution_client.py:361-450](repo://openhands/runtime/impl/action_execution/action_execution_client.py#L361-L450)

This path lets discovery reach stdio tools through an HTTP-accessible runtime router. CLI execution instead includes the configured stdio servers when creating clients for the operation. [[Runtime and Workspace]] describes the standard action execution server and runtime lifecycle; MCP adds this tool-routing path alongside ordinary command and file actions.

Sources: [openhands/mcp/utils.py:176-182](repo://openhands/mcp/utils.py#L176-L182), [openhands/mcp/utils.py:302-309](repo://openhands/mcp/utils.py#L302-L309), [openhands/runtime/impl/action_execution/action_execution_client.py:441-480](repo://openhands/runtime/impl/action_execution/action_execution_client.py#L441-L480), [openhands/runtime/impl/cli/cli_runtime.py:724-745](repo://openhands/runtime/impl/cli/cli_runtime.py#L724-L745)

## Invoke a tool and return its result

For each MCP operation, the execution client obtains effective configuration and creates clients for that call. The shared handler selects the first client advertising the requested tool name, then invokes it with the action's arguments. `MCPClient.call_tool` validates that the name exists, requires an available client and enters its session for the call. Discovery does not leave a permanently open connection for subsequent operations.

Sources: [openhands/runtime/impl/action_execution/action_execution_client.py:466-481](repo://openhands/runtime/impl/action_execution/action_execution_client.py#L466-L481), [openhands/mcp/utils.py:225-248](repo://openhands/mcp/utils.py#L225-L248), [openhands/mcp/client.py:147-156](repo://openhands/mcp/client.py#L147-L156), [openhands/mcp/utils.py:176-182](repo://openhands/mcp/utils.py#L176-L182)

The handler returns an `MCPObservation` containing JSON for the protocol result, tool name and arguments. An `McpError` becomes an MCP observation with `isError` content, while missing clients or an unknown tool name raise `ValueError`. CLI runtime catches broader execution errors and returns an `ErrorObservation`. The generic runtime layer correlates the observation to the originating action as described in [[Events and Persistence]].

Sources: [openhands/mcp/utils.py:225-264](repo://openhands/mcp/utils.py#L225-L264), [openhands/runtime/impl/cli/cli_runtime.py:732-750](repo://openhands/runtime/impl/cli/cli_runtime.py#L732-L750), [openhands/runtime/base.py:391-399](repo://openhands/runtime/base.py#L391-L399)

## Defaults and discovery failures

The default MCP configuration creates an OpenHands HTTP endpoint from `mcp_host` and optionally adds Tavily through an `npx` stdio command when the search key begins with `tvly-`. The configuration implementation class itself can be overridden through `OPENHANDS_MCP_CONFIG_CLS`. This is an application extension point independent of individual server transport selection.

Sources: [openhands/core/config/mcp_config.py:315-363](repo://openhands/core/config/mcp_config.py#L315-L363)

Discovery and schema-conversion failures are collected with server or operation details and can result in an empty tool list. An empty list therefore indicates that no tools were installed, not necessarily that no servers were configured. Native Windows explicitly skips MCP fetching and execution in these helpers. Inspect the per-server connection and collected error messages when a configured tool is absent from the agent's advertised tools.

Sources: [openhands/mcp/utils.py:38-59](repo://openhands/mcp/utils.py#L38-L59), [openhands/mcp/utils.py:166-200](repo://openhands/mcp/utils.py#L166-L200), [openhands/mcp/utils.py:220-226](repo://openhands/mcp/utils.py#L220-L226), [openhands/mcp/client.py:99-123](repo://openhands/mcp/client.py#L99-L123)
