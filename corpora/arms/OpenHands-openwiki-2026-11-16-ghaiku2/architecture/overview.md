---
type: "Reference"
title: "System Architecture Overview"
openwiki_generated: true
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:30:54.023Z
sources:
  - id: openwiki-source-d3f14b919d4ae24afe8df275
    resource: repo://openhands/core/main.py
  - id: openwiki-source-61b5d6e6c4155cc8921df93e
    resource: repo://openhands/core/setup.py
  - id: openwiki-source-0aa9c8cee8d147e243969427
    resource: repo://openhands/resolver/issue_resolver.py
  - id: openwiki-source-f38350b0cd074145e71451f8
    resource: repo://openhands/runtime/base.py
  - id: openwiki-source-f8228654e759fdf2fd0ec8f2
    resource: repo://openhands/server/app.py
  - id: openwiki-source-c959928a0c3c7ad69fd438cc
    resource: repo://openhands/server/listen.py
  - id: openwiki-source-8ba2c1538eda07356c0947f1
    resource: repo://openhands/server/routes/manage_conversations.py
generated: { by: "claude-code", at: "2026-11-16T18:30:54.023Z" }
---


# System Architecture Overview

OpenHands is an AI software-engineering agent. A user states a task, an LLM-driven agent plans and acts, and every action runs inside an isolated runtime whose results feed back into the next decision. The repository contains the Python backend (`openhands/`), the React web frontend (`frontend/`), a shared component library (`openhands-ui/`), the enterprise SaaS layer (`enterprise/`), benchmark tooling (`evaluation/`), and container and deployment definitions (`containers/`, `kind/`, `docker-compose.yml`).

## The agent loop

Every conversation, whatever its entry point, is the same loop of components. The `openhands/README.md` describes the core classes, and the code confirms the pattern:

<!-- openwiki: broken internal link [/openwiki/architecture/agents-and-prompting.md] link "/openwiki/architecture/agents-and-prompting.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
1. **Agent** (`openhands/controller/agent.py`, implementations in `openhands/agenthub/`) receives a `State` and returns one `Action`. The default is `CodeActAgent`. See [Agents, Prompting, and Delegation](/openwiki/architecture/agents-and-prompting.md).
<!-- openwiki: broken internal link [/openwiki/architecture/agent-controller.md] link "/openwiki/architecture/agent-controller.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
2. **AgentController** (`openhands/controller/agent_controller.py`) owns the agent and state, subscribes to the event stream, enforces iteration and budget limits, detects loops, and publishes the agent's action. See [Agent Controller and Step Loop](/openwiki/architecture/agent-controller.md).
<!-- openwiki: broken internal link [/openwiki/architecture/event-stream.md] link "/openwiki/architecture/event-stream.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
3. **EventStream** (`openhands/events/stream.py`) is the shared, persisted log of actions and observations. Every component publishes to and subscribes from it. See [Event Stream, Actions, and Observations](/openwiki/architecture/event-stream.md).
<!-- openwiki: broken internal link [/openwiki/architecture/runtime-sandbox.md] link "/openwiki/architecture/runtime-sandbox.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
4. **Runtime** (`openhands/runtime/`) subscribes to actions, executes them in a sandbox (bash, IPython, file edits, browser, MCP tools), and publishes an observation with the same `cause`. See [Runtime and Sandbox Execution](/openwiki/architecture/runtime-sandbox.md).
<!-- openwiki: broken internal link [/openwiki/architecture/memory-and-context.md] link "/openwiki/architecture/memory-and-context.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
5. **Memory** (`openhands/memory/`) answers recall requests with workspace context and microagent knowledge, and the agent's **condenser** shortens the history it sees. See [Memory, Condensation, and Microagents](/openwiki/architecture/memory-and-context.md).
<!-- openwiki: broken internal link [/openwiki/architecture/llm-layer.md] link "/openwiki/architecture/llm-layer.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
6. **LLM** (`openhands/llm/`) wraps LiteLLM with retries, cost accounting, and function-calling emulation. See [LLM Layer, Routing, Metrics, and Retries](/openwiki/architecture/llm-layer.md).

The loop is event-driven rather than polled. The controller steps once an observation arrives or a user message is published, and it does not step again while an action is pending. A single LLM response can produce several tool calls, which the agent queues and emits one at a time.

## Entry points

The same backend is reached through four entry points, and each assembles the components from `openhands/core/setup.py` (`create_agent`, `create_memory`, `create_runtime`, `create_controller`):

<!-- openwiki: broken internal link [/openwiki/workflows/cli-and-headless.md] link "/openwiki/workflows/cli-and-headless.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **CLI** (`openhands` console script → `openhands/cli/entry.py` → `openhands/cli/main.py`). The `cli` subcommand (the default) loads configuration with `setup_config_from_args`, builds the agent, runtime, memory, and controller itself through the same `create_*` factories, and runs an interactive session in the terminal. The `serve` subcommand launches the GUI container through `gui_launcher.py`. The CLI does not call `run_controller`. See [CLI and Headless Execution](/openwiki/workflows/cli-and-headless.md).
- **Headless controller** (`openhands/core/main.py`, `run_controller`). A single function that builds the agent, runtime, memory, and controller, clones the repository when one is selected, adds the first user action to the stream, and runs until the agent reaches a terminal state. Its `__main__` block is a command-line headless runner that takes a task from `-t`, `-f`, or stdin. The issue resolver and the evaluation harness call this function.
<!-- openwiki: broken internal link [/openwiki/architecture/server-sessions.md] link "/openwiki/architecture/server-sessions.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **Web server** (`openhands/server/listen.py`). A Socket.IO app wrapping a FastAPI application (`openhands/server/app.py`). REST routers handle conversations, files, settings, secrets, git, and MCP. Socket.IO events carry the live stream to the browser. The server serves the built frontend from `./frontend/build` when `SERVE_FRONTEND` is enabled. See [Server, Sockets, and Conversation Sessions](/openwiki/architecture/server-sessions.md).
<!-- openwiki: broken internal link [/openwiki/workflows/issue-resolver.md] link "/openwiki/workflows/issue-resolver.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/evaluation/benchmarks.md] link "/openwiki/evaluation/benchmarks.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **Resolver and evaluation** (`openhands/resolver/issue_resolver.py` and `evaluation/benchmarks/`). The resolver calls `run_controller` (~L440) against an issue and collects the resulting patch. The benchmark runners drive the same function against benchmark tasks. See [Issue Resolver Workflow](/openwiki/workflows/issue-resolver.md) and [Evaluation Harness and Benchmarks](/openwiki/evaluation/benchmarks.md).

<!-- openwiki: broken internal link [/openwiki/architecture/configuration.md] link "/openwiki/architecture/configuration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Configuration is shared by all four paths and is loaded from `config.toml`, environment variables, and command-line flags, in that precedence order. See [Configuration Model](/openwiki/architecture/configuration.md).

## Request and event flow in the server

<!-- openwiki: broken internal link [/openwiki/workflows/conversation-lifecycle.md] link "/openwiki/workflows/conversation-lifecycle.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
A browser request to create or continue a conversation goes through `openhands/server/routes/manage_conversations.py` and then `conversation_manager.maybe_start_agent_loop`. The conversation manager (`standalone_conversation_manager.py` in OSS, with a nested variant in Docker deployments) creates or attaches to a `WebSession`/`AgentSession`, which constructs the same components as the headless path. Socket.IO events from the browser become events on the stream, and the stream's events are sent back to the browser as the agent works. See [Conversation Lifecycle, End to End](/openwiki/workflows/conversation-lifecycle.md).

## Runtime placement

<!-- openwiki: broken internal link [/openwiki/architecture/integrations-and-mcp.md] link "/openwiki/architecture/integrations-and-mcp.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
The runtime is where code runs, so its placement matters. The runtime abstraction is implemented by Docker, local, remote, Kubernetes, and CLI runtimes (`openhands/runtime/impl/`). Most of them run an **action execution server** inside a sandbox and forward actions to it. The runtime also owns repository cloning, microagent discovery from the workspace, git-provider token export, and the MCP router for stdio servers. Git-provider access is described in [Git Provider Integrations and MCP](/openwiki/architecture/integrations-and-mcp.md).

## Storage

<!-- openwiki: broken internal link [/openwiki/architecture/storage-persistence.md] link "/openwiki/architecture/storage-persistence.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Conversation metadata, settings, secrets, and the event log are kept through a `FileStore` abstraction with local, in-memory, S3, and Google Cloud backends (`openhands/storage/`). The event store writes one file per event and cache pages of events. See [Storage, Persistence, and Secrets](/openwiki/architecture/storage-persistence.md).

## Security

<!-- openwiki: broken internal link [/openwiki/architecture/security-analysis.md] link "/openwiki/architecture/security-analysis.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Actions pass through a security analyzer, which can mark high-risk actions as needing confirmation before they reach the runtime. The analyzer is pluggable (Invariant-based or LLM-based). See [Security Analysis and Action Gating](/openwiki/architecture/security-analysis.md).

## Frontend

<!-- openwiki: broken internal link [/openwiki/frontend/web-application.md] link "/openwiki/frontend/web-application.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
The web UI is a React application with TanStack Query as the data-access layer. Components call hooks, the hooks call the `frontend/src/api` client, and the client calls REST endpoints; live updates arrive over Socket.IO. Shared UI primitives live in `openhands-ui`. See [Frontend Web Application](/openwiki/frontend/web-application.md).

## Enterprise layer

<!-- openwiki: broken internal link [/openwiki/enterprise/saas-platform.md] link "/openwiki/enterprise/saas-platform.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`enterprise/` contains the hosted SaaS version. `enterprise/saas_server.py` wraps the open-source server with authentication (Keycloak-backed sessions and API keys), billing (Stripe), per-user settings and secrets stores, rate limiting, and integrations for Slack, Jira, Jira Data Center, Linear, GitHub, and GitLab. Its own database migrations live in `enterprise/migrations/`. See [Enterprise SaaS Platform](/openwiki/enterprise/saas-platform.md).

## Where to go next

<!-- openwiki: broken internal link [/openwiki/quickstart.md] link "/openwiki/quickstart.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- For a task-oriented map of the repository, start at [Repository Quickstart](/openwiki/quickstart.md).
<!-- openwiki: broken internal link [/openwiki/workflows/conversation-lifecycle.md] link "/openwiki/workflows/conversation-lifecycle.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- For one task traced through every component, read [Conversation Lifecycle, End to End](/openwiki/workflows/conversation-lifecycle.md).
- For the component contracts, read the architecture pages linked above.
