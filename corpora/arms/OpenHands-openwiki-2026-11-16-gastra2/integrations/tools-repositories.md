---
type: integration
title: MCP tools, Git providers, and issue resolution
description: External tool discovery and calls, provider credential handling, repository preparation, and the resolver's inference-to-publication workflow.
tags: [mcp, git, providers, resolver, integrations]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:43:51.947Z
sources:
  - id: openwiki-source-20d30eb50754232cae150363
    resource: repo://openhands/integrations/provider.py
  - id: openwiki-source-046a1c2f5e20e3c35ef192a4
    resource: repo://openhands/mcp/utils.py
  - id: openwiki-source-0aa9c8cee8d147e243969427
    resource: repo://openhands/resolver/issue_resolver.py
  - id: openwiki-source-52a4a23cdc5525a9cbbefc83
    resource: repo://openhands/resolver/send_pull_request.py
  - id: openwiki-source-f38350b0cd074145e71451f8
    resource: repo://openhands/runtime/base.py
generated: { by: "codex", at: "2026-11-16T17:43:51.947Z" }
---

# MCP tools, Git providers, and issue resolution

OpenHands integrates external capabilities through two primary paths: MCP exposes tools to the agent, while Git provider services supply repository and issue operations. The issue resolver composes provider context with the normal runtime/controller loop and produces an artifact that a separate publication step can turn into a branch or pull request.

## MCP discovery and execution

`add_mcp_tools_to_agent` requires an initialized runtime. It collects stdio server definitions from repository microagents, deduplicates them, asks the runtime for its effective MCP configuration, fetches schemas, and sets the agent's MCP tools. CLI runtime enables direct stdio discovery; the action-execution client can configure stdio servers behind its runtime MCP proxy and expose them over HTTP. SSE and streamable HTTP are supported connection configurations. Current client setup skips MCP on Windows.

Discovery tries each configured server independently. A missing stdio executable is skipped; connection failures are logged, with client errors collected for diagnosis. A partial tool list or no tools can therefore be a discovery outcome rather than a startup exception. Check the server type, command availability in the actual execution environment, proxy configuration, and discovered tool names.

Tool schemas are converted into the model's function-call format. CodeAct translates a selected tool into `MCPAction`; runtime dispatch finds the first client advertising that tool name. The client opens a connection for the call. Successful results become JSON content in `MCPObservation`, retaining tool name and arguments. `McpError` becomes an error-shaped MCP observation; absence of clients or a matching tool raises instead. Tool-name collisions should be resolved at configuration time because selection uses the first match.

MCP server placement determines where subprocesses run and which credentials they receive. A repository microagent's tool declaration affects runtime configuration, so inspect tool configuration separately from its natural-language instructions.

## Git provider ownership

`ProviderHandler` coordinates GitHub, GitLab, and Bitbucket services and requires a `MappingProxyType` token mapping. Provider tokens wrap secret values and can include a custom host. The handler performs repository discovery, branch queries, authenticated clone-URL construction, and provider-specific operations through service abstractions.

For headless setup, `get_provider_tokens` reads provider token environment variables and builds user secrets. Browser sessions obtain tokens from their configured secrets/authentication services. The runtime registers token values with the event stream before exposing the corresponding environment variables. Before actions that reference provider-token variables, it can request refreshed tokens and update both redaction and sandbox environment values.

This separation matters when a long-running conversation loses Git access: the provider token in a UI setting, the current token from an external manager, and the value already exported into the sandbox may be at different lifecycle points. Investigate refresh configuration and the action that references the token rather than assuming a repository URL is wrong.

Repository preparation clones or initializes through the runtime, then can run `.openhands/setup.sh` and configure repository hooks. Workspace microagents are loaded after the repository is available. See [runtime lifecycle](../architecture/runtime.md) and [memory](../concepts/memory.md).

## Issue resolver workflow

`python -m openhands.resolver.resolve_issue --help` exposes the inference command. `IssueHandlerFactory` chooses issue or pull-request strategies for GitHub, GitLab, or Bitbucket. The strategy prepares instructions and provider context; `IssueResolver.process_issue` prepares a workspace, connects a runtime, and invokes `run_controller` with a user task and optional conversation instructions.

After inference, the resolver stages workspace changes and extracts a diff against the base commit. It packages the patch, history, error information, metrics, and success assessment in `ResolverOutput`, persisted by the resolver workflow to `output.jsonl`. The success assessment comes from the issue handler's `guess_success` path; it is not equivalent to independently passing the target repository's tests.

`python -m openhands.resolver.send_pull_request --help` describes the separate publication command. It reads resolver output, applies and commits the patch, pushes a branch, and can create a draft or ready pull request or leave a branch. It skips unsuccessful outputs unless failure publication is explicitly enabled. Existing pull-request updates follow their own path. Review patch content and validation before invoking publication against a real provider.

The example workflow under `openhands/resolver/examples/` demonstrates automation around these stages. SaaS webhook and callback integrations use additional enterprise orchestration, described in [enterprise boundaries](enterprise.md).

## Extension and verification

For MCP, test discovery failures, tool naming, schema conversion, and error observations. For a provider, preserve token handling and implement both repository operations and any resolver strategy that needs the provider. For resolver changes, check patch application, issue/PR instruction building, success assessment, and publication separately.

Relevant coverage includes `tests/unit/events/test_mcp_action_observation.py`, `tests/unit/cli/test_cli_runtime_mcp.py`, `tests/unit/server/routes/test_mcp_routes.py`, and the provider-specific and patching tests under `tests/unit/resolver/`.
