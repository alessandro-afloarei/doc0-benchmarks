---
type: integration
title: MCP tools, Git providers and issue resolution
description: Tool discovery and dispatch, provider credential refresh and the resolver workflow that turns issue context into patches and publication artifacts.
tags: [mcp, tools, git, resolver, integrations]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:55:05.802Z
sources:
  - id: openwiki-source-20d30eb50754232cae150363
    resource: repo://openhands/integrations/provider.py
  - id: openwiki-source-046a1c2f5e20e3c35ef192a4
    resource: repo://openhands/mcp/utils.py
  - id: openwiki-source-0aa9c8cee8d147e243969427
    resource: repo://openhands/resolver/issue_resolver.py
  - id: openwiki-source-f38350b0cd074145e71451f8
    resource: repo://openhands/runtime/base.py
generated: { by: "codex", at: "2026-11-16T16:55:05.802Z" }
---

# MCP tools, Git providers and issue resolution

## MCP discovery and execution

MCP integration has two directions: the agent consumes external/runtime tools, and the application exposes its own FastMCP server at `/mcp`. The server includes Git operations such as pull-request creation using request authentication and can record PR metadata on the conversation. Tool execution may therefore have external effects beyond the runtime filesystem.

For consumed tools, `add_mcp_tools_to_agent` requires an initialized runtime. It gathers always-active repository microagent stdio configuration, asks the runtime for the effective MCP configuration, fetches tool schemas and installs them on the agent. This runs before controller creation in web startup so those tools appear in the system message. CLI runtime discovery can use stdio directly; other runtimes supply their own MCP transport configuration.

Client creation supports SSE, streamable HTTP and stdio. A missing stdio executable is skipped; server connection failures are logged and do not automatically discard successfully connected servers. Conversion/fetch failures may yield an empty tool list. These helper paths disable MCP on native Windows, which differs from running under Linux/WSL.

The model emits an `MCPAction` with a name and arguments. Dispatch finds the first client advertising that name and returns serialized output in an `MCPObservation`. An MCP protocol error is represented as an error payload inside that observation. Missing clients or missing tool names raise errors instead. Distinct names across servers matter because selection is by the advertised name. Runtime handlers attach action causality and tool-call metadata just as they do for other execution results.

## Git provider boundary

`ProviderHandler` selects GitHub, GitLab or Bitbucket service implementations behind shared repository, branch, identity and PR interfaces. Its tokens are supplied as an immutable mapping of provider type to token metadata, including optional host and user ID. Host-aware URL construction is important for self-hosted providers.

The handler builds authenticated clone URLs and provider environment variables, and registers actual credential values with the event stream's secret replacement map. Before executing command actions referencing provider-token environment names, the runtime can fetch the latest provider tokens, update masking and export fresh values. This permits short-lived credential refresh without treating startup credentials as permanently valid. Keep credential refresh, masking and environment export aligned when adding a provider.

Secret wrapping and event masking are scoped mechanisms. Commands execute with real credentials in the runtime; masking a serialized event does not remove a secret from every possible external log or persisted settings record.

## Issue-to-patch automation

The resolver CLI and provider-specific issue/PR handlers prepare issue context and instructions. `IssueResolver.process_issue` replaces its working copy from the prepared repository, creates/connects a runtime, initializes it, builds the task message and calls the shared headless `run_controller`. It then extracts a Git patch relative to the base commit and returns `ResolverOutput` containing issue data, history, metrics, success assessment, explanation and error information.

Success assessment belongs to the issue handler and is not proof that arbitrary project tests passed. Inspect the patch and task-specific execution results. Publication is a separate path in `send_pull_request.py`, which applies output patches and uses provider handlers to push or create/update PR artifacts. The example workflow wires resolution and publication together; invoking that workflow has broader effects than producing a local resolver result.

## Extension and checks

Trace [MCP utilities](../../openhands/mcp/utils.py), [MCP server routes](../../openhands/server/routes/mcp.py), [provider.py](../../openhands/integrations/provider.py), [issue_resolver.py](../../openhands/resolver/issue_resolver.py) and [send_pull_request.py](../../openhands/resolver/send_pull_request.py). Tests under `tests/unit/mcp/` cover discovery, errors and timeouts; provider and resolver tests exercise immutability, Git services, patches and publication behavior.

Related: [runtimes](../architecture/runtimes.md), [microagents](../concepts/memory-and-microagents.md), [enterprise integrations](enterprise.md), [quickstart](../quickstart.md).
