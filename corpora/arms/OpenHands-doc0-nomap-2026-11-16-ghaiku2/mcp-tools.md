---
title: "MCP Tools"
---
## Overview

The Model Context Protocol (MCP) lets an external server offer tools that an agent can call. OpenHands has two sides to it. It is a client of other MCP servers: it connects to the servers named in the configuration, lists their tools, and offers those tools to the agent as if they were its own. It is also a server, mounted at `/mcp`, which exposes a few tools that open pull requests and merge requests for the conversation's repository. This page covers both, and the call path from the agent to a server. The runtime side of the call is on [[Runtime Core]].

Sources: [openhands/mcp/__init__.py:1-21](repo://openhands/mcp/__init__.py#L1-L21), [openhands/server/routes/mcp.py:26-33](repo://openhands/server/routes/mcp.py#L26-L33)

## Configuration

`MCPConfig` holds three lists: SSE servers, streamable HTTP servers and stdio servers. Each entry is validated when it is parsed. A URL must be well formed, a stdio server needs a name and a command, and its arguments and environment are parsed from strings. The configuration loader reads the MCP settings into this model, through `MCPConfig.from_toml_section`.

Sources: [openhands/core/config/mcp_config.py:46-63](repo://openhands/core/config/mcp_config.py#L46-L63), [openhands/core/config/mcp_config.py:64-120](repo://openhands/core/config/mcp_config.py#L64-L120), [openhands/core/config/mcp_config.py:202-256](repo://openhands/core/config/mcp_config.py#L202-L256)

Two sources add servers without the user writing them into the file. A configured search key that starts with `tvly-` adds a stdio server running the Tavily search package. Microagents can also name MCP servers in their metadata, and those are merged into the list when the agent's tools are set up.

Sources: [openhands/core/config/mcp_config.py:315-335](repo://openhands/core/config/mcp_config.py#L315-L335), [openhands/mcp/utils.py:151-205](repo://openhands/mcp/utils.py#L151-L205), [openhands/mcp/utils.py:267-300](repo://openhands/mcp/utils.py#L267-L300)

## Connecting

`MCPClient` wraps a FastMCP client for one server. `connect_http` opens an SSE or streamable HTTP connection, and `connect_stdio` starts the server as a child process with its command, arguments and environment. Both take a timeout, which is 30 seconds by default. After the connection opens, `_initialize_and_list_tools` asks the server for its tools and wraps each one as an `MCPClientTool` that keeps a reference to the session.

Sources: [openhands/mcp/client.py:23-56](repo://openhands/mcp/client.py#L23-L56), [openhands/mcp/client.py:57-146](repo://openhands/mcp/client.py#L57-L146)

`create_mcp_clients` builds one client for each configured server, and `fetch_mcp_tools_from_config` connects them and returns the tools as dictionaries in the function-calling format. A CLI runtime sets `use_stdio`, so the stdio servers are started on the user's machine. A connection error is recorded in the MCP error collector, which the command line shows to the user, and the tools that do connect are still returned.

Sources: [openhands/mcp/utils.py:63-150](repo://openhands/mcp/utils.py#L63-L150), [openhands/mcp/utils.py:151-205](repo://openhands/mcp/utils.py#L151-L205), [openhands/mcp/error_collector.py:19-47](repo://openhands/mcp/error_collector.py#L19-L47)

`convert_mcp_clients_to_tools` produces the dictionaries the LLM receives: the tool's name, description and input schema, in the same shape as the built-in tools. `set_mcp_tools` on the agent keeps them, so the model can call them by name.

Sources: [openhands/mcp/utils.py:28-62](repo://openhands/mcp/utils.py#L28-L62), [openhands/controller/agent.py:163-175](repo://openhands/controller/agent.py#L163-L175)

## Calling a tool

When the model calls an MCP tool, the CodeAct agent creates an `MCPAction` whose name and arguments are the model's. `call_tool_mcp` finds the client that lists a tool with that name and calls it through the session. If no client has the tool, it raises a `ValueError`. The runtime's action handler catches that exception and reports it as a runtime error status, not as an observation.

Sources: [openhands/agenthub/codeact_agent/function_calling.py:301-306](repo://openhands/agenthub/codeact_agent/function_calling.py#L301-L306), [openhands/mcp/utils.py:206-266](repo://openhands/mcp/utils.py#L206-L266)

`MCPClient.call_tool` sends the call through the FastMCP client. The result becomes an `MCPObservation` with the tool's name, arguments and the JSON of the response. An MCP protocol error is turned into an observation that says `isError`, so the model sees the failure. On Windows the MCP path is disabled, and calls there return an error observation.

Sources: [openhands/mcp/client.py:147-156](repo://openhands/mcp/client.py#L147-L156), [openhands/mcp/utils.py:206-222](repo://openhands/mcp/utils.py#L206-L222)

## The MCP server

The application mounts a FastMCP server at `/mcp`, stateless over HTTP and protected by the same session API key as the other routes. It exposes three tools: `create_pr` for GitHub, `create_mr` for GitLab and `create_bitbucket_pr` for Bitbucket. Each takes a repository, source and target branches, a title and body, and opens the request through the matching provider service.

Sources: [openhands/server/routes/mcp.py:26-33](repo://openhands/server/routes/mcp.py#L26-L33), [openhands/server/routes/mcp.py:84-150](repo://openhands/server/routes/mcp.py#L84-L150)

After a request is opened, the tool saves the conversation's link on the pull request, so the provider's page leads back to the conversation. The link uses the web host, which is read from the `WEB_HOST` environment variable.

Sources: [openhands/server/routes/mcp.py:34-83](repo://openhands/server/routes/mcp.py#L34-L83), [openhands/server/routes/mcp.py:28-30](repo://openhands/server/routes/mcp.py#L28-L30)

The git provider services that do the work are described on [[Git Provider Integrations]].

Sources: [openhands/server/routes/mcp.py:84-96](repo://openhands/server/routes/mcp.py#L84-L96)
