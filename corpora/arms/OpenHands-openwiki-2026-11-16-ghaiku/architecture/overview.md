---
type: architecture
title: System Architecture Overview
description: The top-level map of OpenHands, showing the Python agent core, the FastAPI and Socket.IO server, the React web app, the CLI, the enterprise SaaS layer, and the evaluation harness, and how they share the event stream, the runtime, and the configuration model.
tags: [architecture, overview, backend, server, frontend, cli, enterprise, evaluation]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T11:08:31.416Z
sources:
  - id: openwiki-source-957b5faddd905c3cfecf57d8
    resource: repo://enterprise/saas_server.py
  - id: openwiki-source-ab3c6807c36a554faa63f162
    resource: repo://openhands/cli/entry.py
  - id: openwiki-source-33bda7da9a7aaa1b62b92f7d
    resource: repo://openhands/cli/gui_launcher.py
  - id: openwiki-source-e0ec246e2fc8f4ba808dfc7f
    resource: repo://openhands/core/config/openhands_config.py
  - id: openwiki-source-61b5d6e6c4155cc8921df93e
    resource: repo://openhands/core/setup.py
  - id: openwiki-source-f8228654e759fdf2fd0ec8f2
    resource: repo://openhands/server/app.py
  - id: openwiki-source-c959928a0c3c7ad69fd438cc
    resource: repo://openhands/server/listen.py
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
generated: { by: "claude-code", at: "2026-11-16T11:08:31.416Z" }
---

# System Architecture Overview

OpenHands is a platform in which an LLM-driven agent works inside a sandboxed runtime on behalf of a
user. This repository contains the open-source platform and several surrounding applications.
This page is the map. Each subsystem has its own page, linked below.

## The main parts

| Part | Location | Role |
| --- | --- | --- |
| Agent core | `openhands/` (`controller`, `agenthub`, `events`, `llm`, `memory`, `microagent`) | Decides what to do next, records every action and observation, and calls the model. |
| Runtime | `openhands/runtime/` | Executes actions in a sandbox (Docker by default) and returns observations. |
| Server | `openhands/server/` | FastAPI routes, Socket.IO real-time channel, conversation manager, and sessions. |
| Web app | `frontend/`, shared components in `openhands-ui/` | React Router single-page app served by the server. |
| CLI and launchers | `openhands/cli/` | The `openhands` command: terminal UI, headless runs, and the `serve` command that starts the GUI. |
| Integrations and resolver | `openhands/integrations/`, `openhands/resolver/`, `openhands/mcp/` | Git hosting providers, issue and pull-request resolution, and MCP tool servers. |
| Enterprise SaaS | `enterprise/` | Multi-tenant server with auth, billing, storage, and third-party integrations. |
| Evaluation | `evaluation/` | Benchmark runners that drive the agent headlessly and score results. |
| Shared tooling | `tests/`, `containers/`, `.github/workflows/`, `Makefile`, `build.sh` | Tests, images, CI, and build scripts. |

The Python package is published as `openhands-ai` (`pyproject.toml:8-9`), with the `openhands`
console command bound to `openhands.cli.entry:main` (`pyproject.toml:170-171`).

## Core flow in one paragraph

A user message reaches the server, either through a REST route or a Socket.IO event. The server
attaches it to a conversation, which owns an `EventStream` and an `AgentSession`. The session builds
an `AgentController` and a `Runtime`. The controller asks the agent for the next `Action`; the
agent calls the LLM through the LLM layer. The action is written to the event stream. The runtime
subscribes to the stream, executes the action in the sandbox, and writes an `Observation`. The
controller reacts to that observation and steps again, until the agent finishes, stops, or
reaches an error. Every step is persisted, so the conversation can be replayed or resumed. See
[Conversation Lifecycle End to End](../workflows/conversation-lifecycle.md) for the full trace.

## Process and entry points

- **Server.** `openhands/server/listen.py` wraps the FastAPI application from `openhands/server/app.py`
  in a Socket.IO ASGI app, mounts the built frontend when `SERVE_FRONTEND` is true, and adds CORS,
  cache-control, and rate-limit middleware. The Makefile starts it with
  `uvicorn openhands.server.listen:app` (`Makefile:251`). `app.py` includes the routers for public,
  files, security, feedback, conversations, settings, secrets, git, and trajectories
  (`app.py:75-85`).
- **CLI.** `openhands/cli/entry.py` dispatches subcommands. With no subcommand, or with `cli`, it runs
  the terminal experience through `run_cli_command`. With `serve`, it calls `launch_gui_server`,
  which pulls the app and runtime images and starts them with Docker (`cli/gui_launcher.py:97-98`).
  Headless runs call `run_controller` in `openhands/core/main.py` directly; the issue resolver and
  the benchmark runners under `evaluation/benchmarks/` are examples.
- **Enterprise.** `enterprise/saas_server.py` imports the base `openhands.server.app` application
  (line 40) and extends it with enterprise routes, middleware, and exception handlers. It mounts the
  SPA build and wraps the result in Socket.IO (`saas_server.py:110`, `saas_server.py:130`).
- **Frontend.** The web app is built with `react-router build` (`frontend/package.json`, `build`
  script) and served as static files by the backend.

## Configuration and wiring

Everything is driven by one configuration model, `OpenHandsConfig`
(`openhands/core/config/openhands_config.py`). It is filled from `config.toml`, environment
variables, and command-line arguments, in that order of increasing precedence
(see [Configuration System](configuration.md)). The `runtime` field defaults to `docker`
(`openhands_config.py:71`), and `create_runtime` resolves the class with `get_runtime_cls`
(`openhands/core/setup.py:72-73`). Agents are looked up by name in a registry
(see [Agents, Tools, and Microagents](agents-and-tools.md)).

## Design choices that shape the codebase

- **Events are the source of truth.** Agents, the runtime, the server, and memory communicate only
  through the event stream. This makes the conversation replayable and lets components be replaced
  without changing their callers. See [Event Model and Event Stream](event-stream.md).
- **Execution is isolated from decision-making.** The controller never runs commands. Runtimes can
  be swapped (Docker, local, remote, Kubernetes) without touching agents.
  See [Runtime Abstraction and Execution Backends](runtime.md).
- **One LLM abstraction.** All model calls pass through the LLM layer, which handles retries,
  metrics, function-calling emulation, and routing. See [LLM Layer](llm-layer.md).
- **Shared core, multiple shells.** The server, CLI, evaluation runners, and enterprise server all
  reuse the same controller and runtime code.

## Where to go next

- Changing agent behavior: [Agent Controller and Step Loop](agent-controller.md) and
  [Agents, Tools, and Microagents](agents-and-tools.md).
- Changing server behavior: [Server, Routes, and Conversation Management](server-and-conversations.md).
- Changing the UI: [Web Frontend and Shared UI](../frontend/web-app.md).
- Changing the CLI: [CLI and Local Launchers](../cli/cli-and-launchers.md).
- Enterprise deployment: [Enterprise SaaS Layer](../enterprise/saas-server.md).
- Running tests and CI: [Testing and CI](../operations/testing-and-ci.md).
