---
type: guide
title: OpenHands Wiki Quickstart
description: Entry point for the OpenHands repository wiki. Routes a reader or agent from a task, such as changing the agent loop, adding a runtime or LLM provider, changing the UI, running benchmarks, or working on the enterprise SaaS, to the page that owns it.
tags: [quickstart, overview, navigation, routing, onboarding]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T11:08:31.416Z
sources:
  - id: openwiki-source-b2fcefff62615b684f3fdca9
    resource: repo://evaluation/README.md
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-a2c4f6dc92cf0cd76a23c3d8
    resource: repo://openhands/core/config/utils.py
  - id: openwiki-source-f38350b0cd074145e71451f8
    resource: repo://openhands/runtime/base.py
generated: { by: "claude-code", at: "2026-11-16T11:08:31.416Z" }
---

# OpenHands Wiki Quickstart

OpenHands is an agent platform. An LLM plans and acts, the controller drives the loop, and a sandboxed
runtime executes the actions. This repository also contains the web app, the CLI, the enterprise SaaS
layer, and the evaluation harness around that core. Use this page to find the owner of a concern. The
pages below are grouped by the kind of work you are doing, not by directory.

## Find your task

| If you want to... | Read first | Then |
| --- | --- | --- |
| Understand the system as a whole | [System Architecture Overview](architecture/overview.md) | [Conversation Lifecycle End to End](workflows/conversation-lifecycle.md) |
| Change how the agent decides its next step | [Agent Controller and Step Loop](architecture/agent-controller.md) | [Agents, Tools, and Microagents](architecture/agents-and-tools.md) |
| Add or change an agent, a tool, or a prompt | [Agents, Tools, and Microagents](architecture/agents-and-tools.md) | [Agent Controller and Step Loop](architecture/agent-controller.md) |
| Add an LLM provider, change retries, or add model routing | [LLM Layer](architecture/llm-layer.md) | [Configuration System](architecture/configuration.md) |
| Change how context is kept within the model's window | [Memory, Context Condensation, and Conversation Memory](workflows/memory-and-condensation.md) | [Event Model and Event Stream](architecture/event-stream.md) |
| Add a runtime backend, or change how actions execute | [Runtime Abstraction and Execution Backends](architecture/runtime.md) | [Security Model and Sandboxing](operations/security.md) |
| Change the event model or how events are stored | [Event Model and Event Stream](architecture/event-stream.md) | [Agent Controller and Step Loop](architecture/agent-controller.md) |
| Change the server, REST routes, or real-time channel | [Server, Routes, and Conversation Management](architecture/server-and-conversations.md) | [Conversation Lifecycle End to End](workflows/conversation-lifecycle.md) |
| Add or change a configuration option | [Configuration System](architecture/configuration.md) | The option's owner page, such as [LLM Layer](architecture/llm-layer.md) or [Security Model and Sandboxing](operations/security.md) |
| Change the web UI | [Web Frontend and Shared UI](frontend/web-app.md) | [Server, Routes, and Conversation Management](architecture/server-and-conversations.md) |
| Change the `openhands` command, the terminal session, or `serve` | [CLI and Local Launchers](cli/cli-and-launchers.md) | [Configuration System](architecture/configuration.md) |
| Add an MCP server, or change MCP tool handling | [Model Context Protocol (MCP) Integration](integrations/mcp.md) | [Runtime Abstraction and Execution Backends](architecture/runtime.md) |
| Work on GitHub, GitLab, or Bitbucket integration, or the issue resolver | [Git Provider Integrations and Issue Resolver](integrations/git-providers-and-resolver.md) | [Server, Routes, and Conversation Management](architecture/server-and-conversations.md) |
| Run a benchmark or evaluate an agent | [Evaluation Harness and Benchmarks](evaluation/benchmarks.md) | [Configuration System](architecture/configuration.md) |
| Work on the hosted SaaS, billing, or enterprise auth | [Enterprise SaaS Layer](enterprise/saas-server.md) | [Server, Routes, and Conversation Management](architecture/server-and-conversations.md) |
| Write or run tests, or change CI | [Testing and CI](operations/testing-and-ci.md) | The owner page of the area under test |
| Review security boundaries | [Security Model and Sandboxing](operations/security.md) | [Runtime Abstraction and Execution Backends](architecture/runtime.md) |

## Map of the repository

| Directory | Owner page |
| --- | --- |
| `openhands/controller/` | [Agent Controller and Step Loop](architecture/agent-controller.md) |
| `openhands/events/` | [Event Model and Event Stream](architecture/event-stream.md) |
| `openhands/runtime/` | [Runtime Abstraction and Execution Backends](architecture/runtime.md) |
| `openhands/llm/` | [LLM Layer](architecture/llm-layer.md) |
| `openhands/agenthub/`, `openhands/microagent/`, `openhands/critic/` | [Agents, Tools, and Microagents](architecture/agents-and-tools.md) |
| `openhands/memory/` | [Memory, Context Condensation, and Conversation Memory](workflows/memory-and-condensation.md) |
| `openhands/server/` | [Server, Routes, and Conversation Management](architecture/server-and-conversations.md) |
| `openhands/core/config/` | [Configuration System](architecture/configuration.md) |
| `openhands/cli/` | [CLI and Local Launchers](cli/cli-and-launchers.md) |
| `openhands/mcp/` | [Model Context Protocol (MCP) Integration](integrations/mcp.md) |
| `openhands/integrations/`, `openhands/resolver/` | [Git Provider Integrations and Issue Resolver](integrations/git-providers-and-resolver.md) |
| `openhands/security/` | [Security Model and Sandboxing](operations/security.md) |
| `frontend/`, `openhands-ui/` | [Web Frontend and Shared UI](frontend/web-app.md) |
| `enterprise/` | [Enterprise SaaS Layer](enterprise/saas-server.md) |
| `evaluation/` | [Evaluation Harness and Benchmarks](evaluation/benchmarks.md) |
| `tests/`, `.github/workflows/`, `Makefile` | [Testing and CI](operations/testing-and-ci.md) |

## Local development in brief

The full setup is in `Development.md`. The short version:

1. Install Python 3.12, Node.js 22 or later, Poetry, Docker, and tmux. `make build` checks for these and
   installs the dependencies (`Makefile:25`).
2. Configure a model in `config.toml` (copy `config.template.toml`). Only the `[llm]` section is used for
   evaluations.
3. Run `make run` to start the backend and the frontend. The backend is the FastAPI app at
   `openhands.server.listen:app`.
4. Run the unit tests with `poetry run pytest --forked -n auto ./tests/unit`. See
   [Testing and CI](operations/testing-and-ci.md) for the other suites.

## Conventions to keep in mind

- **Events are the record.** A component that needs to know what happened subscribes to the event stream.
  It should not reach into another component's state.
- **Actions run elsewhere.** The controller never executes a command. It emits an action, and the runtime
  answers with an observation.
- **Configuration has one owner.** `OpenHandsConfig` is built once per run from TOML, environment, and
  command-line sources. Add new options there, not in local defaults.
- **The enterprise layer extends, it does not fork.** It replaces interfaces through configuration. See
  [Enterprise SaaS Layer](enterprise/saas-server.md) before changing shared server code.
- **This wiki is generated.** The `openwiki/` pages are maintained by the OpenWiki update workflow. Edit the
  source, and let the next update regenerate the pages.
