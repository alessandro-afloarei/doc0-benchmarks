---
type: guide
title: OpenHands Quickstart and Wiki Map
description: What OpenHands is, how the repository is laid out, how to run and develop it, and a task-routing map telling you which wiki page to read for each kind of question or change.
tags: [quickstart, overview, repository-map, navigation, getting-started]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:38:52.407Z
sources:
  - id: openwiki-source-8037e2358a2c4f9b2c722a11
    resource: repo://AGENTS.md
  - id: openwiki-source-f1dae2c1abafd4f51485791d
    resource: repo://Development.md
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "claude-code", at: "2026-11-16T09:38:52.407Z" }
---

# OpenHands Quickstart and Wiki Map

**OpenHands** (formerly OpenDevin) is a platform for AI software-development agents. An agent receives a task, then repeatedly decides on an action (run a shell command, execute Python, edit a file, browse, call an MCP tool), has it executed in a sandboxed runtime, and reads the observation until the task is done. It ships as a Python package (`openhands-ai`), a React web app, a terminal CLI, an issue/PR resolver, an evaluation harness and a separately licensed enterprise (SaaS) layer.

> The README warns that the open-source server is meant for a **single user on a local workstation**: no built-in authentication, isolation or multi-tenancy. Multi-tenant hosting is the job of the commercially licensed `enterprise/` code ([Enterprise](enterprise/enterprise-saas.md)).

## How to run it

| Goal | Command |
|---|---|
| Web UI (uv) | `uvx --python 3.12 --from openhands-ai openhands serve` → http://localhost:3000 (launches Docker containers; see [CLI](clients/cli.md)) |
| Terminal agent | `uvx --python 3.12 --from openhands-ai openhands` |
| Docker directly | `docker run ... docker.all-hands.dev/all-hands-ai/openhands:<version>` with the Docker socket and `~/.openhands` mounted |
| From source | Python 3.12, Node ≥ 22, Poetry ≥ 1.8, Docker, tmux → `make build`, then `make run` ([Build and containers](operations/build-and-containers.md), `Development.md`) |
| Headless / scripted | `openhands.core.main.run_controller`, the resolver, or `evaluation/` ([CLI and headless](clients/cli.md)) |

On first start you pick an LLM provider and key (any LiteLLM-supported provider; Claude Sonnet 4 is the recommended default in the README). Settings are stored under `~/.openhands` ([Storage](server/storage-and-persistence.md)).

## Repository map

| Path | What lives there | Wiki |
|---|---|---|
| `openhands/controller/`, `events/`, `core/` | The agent loop, state, event stream, config, headless entry points | [Overview](architecture/overview.md), [AgentController](architecture/agent-controller.md), [Event stream](architecture/event-stream.md) |
| `openhands/agenthub/` | Agent implementations (CodeActAgent and variants) | [CodeActAgent](agents/codeact-agent.md) |
| `openhands/memory/`, `microagent/`, `microagents/` | History condensation, recall, microagent files | [Memory](agents/memory-and-condensation.md), [Microagents](agents/microagents.md) |
| `openhands/llm/` | LiteLLM wrapper, registry, routers, metrics | [LLM layer](llm/llm-layer.md) |
| `openhands/runtime/`, `third_party/runtime/` | Sandboxes (docker, local, cli, remote, kubernetes, third-party), the action-execution server, plugins | [Runtime](runtime/runtime-and-sandbox.md) |
| `openhands/mcp/` | MCP client and tool conversion | [MCP](integrations/mcp.md) |
| `openhands/integrations/` | GitHub / GitLab / Bitbucket services, token handling | [Git providers](integrations/git-providers.md) |
| `openhands/security/` | Security analyzers, confirmation mode support | [Security](security/security-and-confirmation.md) |
| `openhands/server/`, `openhands/storage/` | FastAPI + Socket.IO server, sessions, stores | [Server](server/server-and-sessions.md), [Storage](server/storage-and-persistence.md) |
| `openhands/cli/` | `openhands` command, TUI, GUI launcher | [CLI](clients/cli.md) |
| `openhands/resolver/` | Issue/PR resolver + PR sender | [Issue resolver](workflows/issue-resolver.md) |
| `frontend/`, `openhands-ui/` | React SPA and shared UI library | [Frontend](clients/frontend.md) |
| `enterprise/` | SaaS server, SQL storage, chat/issue integrations (PolyForm Free Trial license) | [Enterprise](enterprise/enterprise-saas.md) |
| `evaluation/`, `tests/` | Benchmarks and test suites | [Testing and evaluation](operations/testing-and-evaluation.md) |
| `containers/`, `Makefile`, `.github/workflows/` | Images, build, CI | [Build and containers](operations/build-and-containers.md) |
| `openhands/core/config/`, `config.template.toml` | Configuration models and reference file | [Configuration](configuration/configuration.md) |

## The one-paragraph architecture

A user message lands on the **event stream**; the **controller** asks `Memory` to recall workspace context and microagent knowledge, then repeatedly calls `agent.step(state)`; the **agent** (CodeAct) builds LLM messages from the condensed history and returns an **action**; the **runtime** (subscribed to the same stream) executes runnable actions inside a **sandbox** via an HTTP action-execution server and publishes **observations**, which trigger the next step. The server wraps this per conversation (`WebSession` + `AgentSession`), streams events to the browser over Socket.IO, and persists events and state through a `FileStore`. Details: [Overview](architecture/overview.md).

## Task routing: where to look

- **"How does one agent step work / why did the agent stop or loop?"** → [AgentController](architecture/agent-controller.md) (states, pending actions, stuck detection, iteration and budget limits), [CodeActAgent](agents/codeact-agent.md).
- **"Why is the context too long / what does the model see?"** → [Memory and condensation](agents/memory-and-condensation.md).
- **"Add or change an agent tool"** → [CodeActAgent](agents/codeact-agent.md) (tools, function-call parsing), then the action/observation classes in [Event stream](architecture/event-stream.md) and execution in [Runtime](runtime/runtime-and-sandbox.md).
- **"Give the agent repo-specific instructions"** → [Microagents](agents/microagents.md) (`.openhands/microagents/`, `AGENTS.md`).
- **"A command hangs / sandbox won't start / which runtime should I use?"** → [Runtime](runtime/runtime-and-sandbox.md); images and tags in [Build and containers](operations/build-and-containers.md).
- **"Add an MCP server"** → [MCP](integrations/mcp.md).
- **"Use a different model, tune retries, or add a router"** → [LLM layer](llm/llm-layer.md), [Configuration](configuration/configuration.md).
- **"Which config wins: TOML, env or CLI?"** → [Configuration](configuration/configuration.md).
- **"Require approval before risky commands"** → [Security](security/security-and-confirmation.md).
- **"Clone/push, token refresh, GitHub Enterprise, GitLab"** → [Git providers](integrations/git-providers.md).
- **"A new API route, Socket.IO event, conversation limits, auth hook"** → [Server and sessions](server/server-and-sessions.md).
- **"Where is conversation data stored / switch to S3"** → [Storage](server/storage-and-persistence.md).
- **"Change the UI, add a settings page"** → [Frontend](clients/frontend.md).
- **"Automatically fix issues or PR comments"** → [Issue resolver](workflows/issue-resolver.md).
- **"Run a benchmark or write a test"** → [Testing and evaluation](operations/testing-and-evaluation.md).
- **"What differs in OpenHands Cloud?"** → [Enterprise](enterprise/enterprise-saas.md).

## Conventions worth knowing

- **Extension by dotted path**: agents (`classpath`), runtimes (`runtime = "pkg.Cls"`), conversation managers, stores, user-auth and monitoring classes are all resolved through `get_impl`; this is how enterprise overrides OSS behavior.
- **Everything is an event.** If you need to know what happened in a conversation, read its event stream; state and UI are derived from it.
- **Source and tests are authoritative.** `AGENTS.md` at the repo root says to treat generated wiki pages as just-in-time context and to prefer the narrowest validation that proves a change. Microagent and instruction files such as `AGENTS.md` are loaded by OpenHands itself when it works in a repo ([Microagents](agents/microagents.md)).
- Python 3.12 only (`^3.12,<3.14`); Windows is partially supported (no MCP, tmux-less PowerShell bash) and the dev `Makefile` requires macOS, Linux or WSL.
