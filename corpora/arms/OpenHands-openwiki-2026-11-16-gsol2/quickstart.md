---
type: guide
title: Quickstart and task map
description: Build and launch this OpenHands checkout, locate execution entrypoints and choose documentation for architecture, workflows, integrations and testing.
tags: [quickstart, development, navigation]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:55:05.802Z
sources:
  - id: openwiki-source-1047363cf615000e4c9bb694
    resource: repo://frontend/package.json
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-ab3c6807c36a554faa63f162
    resource: repo://openhands/cli/entry.py
  - id: openwiki-source-1051c839bf54b8086942f0ff
    resource: repo://openhands/core/config/arg_utils.py
  - id: openwiki-source-d3f14b919d4ae24afe8df275
    resource: repo://openhands/core/main.py
  - id: openwiki-source-da85fde896f6c6bf21228a40
    resource: repo://tests/unit/README.md
generated: { by: "codex", at: "2026-11-16T16:55:05.802Z" }
---

# Quickstart and task map

OpenHands runs software-development agents that select model tools and execute them in a workspace. This wiki documents the checked-out implementation. Start with [system architecture](architecture/system.md) for the component model, or use the task map below when making a focused change.

## Run this checkout

The development workflow targets Python 3.12, Node.js 22 or newer, npm, Poetry and Docker on Linux, macOS or WSL. `.nvmrc` selects Node 22; the frontend manifest and Makefile also require 22+, despite older prerequisites in the frontend README. Python packaging accepts a broader range than the Makefile's selected development version. Follow [Development.md](../Development.md) for OS packages and dev-container options.

From the repository root:

```bash
make build
make setup-config
make run
```

`make build` checks tools, installs Python dev/test/runtime groups and frontend dependencies, installs hooks and builds the frontend. It can install Playwright Chromium dependencies. `make setup-config` interactively writes `config.toml`, including workspace and headless model settings; review existing configuration before replacing it. `make run` launches the backend on port 3000 and frontend development server on port 3001 by default. Open `http://localhost:3001` and configure the model/provider in the UI for browser sessions.

To work on each process separately, use `make start-backend` and `make start-frontend` in different terminals. Backend startup is `poetry run uvicorn openhands.server.listen:app`; the Makefile supplies host/port and development reload options. `make docker-run` builds/runs the Compose application on port 3000, with persisted application data and Docker runtime access. See [deployment and configuration](operations/configuration-and-deployment.md) before changing mounts or exposing the server.

For frontend work with mocked APIs:

```bash
cd frontend
npm run dev:mock
```

Use `npm run dev` for the real backend and `dev:mock:saas` for the mocked SaaS variant. The package scripts define these modes; some prose in `frontend/README.md` predates the current defaults.

## CLI and headless entrypoints

Within the installed Poetry environment, `poetry run openhands` starts the interactive CLI; `poetry run openhands serve` launches the Docker-based GUI path. These are different from the source-development `make run` servers. Use their help output for available options.

For a direct headless task, configure `[llm]` and runtime/workspace settings, then run:

```bash
poetry run python -m openhands.core.main -t "Inspect the workspace and describe its tests"
```

The installed CLI enters `openhands.cli.entry:main`; headless assembly lives in `core.main.run_controller`; web assembly lives in `server/session/agent_session.py`. Model configuration in a default TOML section is not the only source of GUI session settings. See [models](concepts/models.md) and [configuration precedence](operations/configuration-and-deployment.md).

## Find the right page

| Task or question | Read first | Main source seam |
| --- | --- | --- |
| Understand components and task execution | [System architecture](architecture/system.md) | `core/setup.py`, `core/main.py`, `server/app.py` |
| Change agent decisions, sequencing, limits or delegation | [Agent loop](concepts/agent-loop.md) | Controller, CodeAct and state trackers |
| Change event schemas, persistence or restoration | [Events and storage](architecture/events-and-storage.md) | Events, serializers and storage factories |
| Fix conversation creation, sockets or reconnect | [Server conversations](architecture/conversations.md) | Conversation manager, session and socket handlers |
| Add execution capabilities or debug workspace setup | [Runtimes](architecture/runtimes.md) | Runtime adapters and action execution server |
| Add a model/provider adaptation or debug retries | [Models](concepts/models.md) | LLM wrapper, registry and feature rules |
| Change repository instructions, recall or context size | [Memory and microagents](concepts/memory-and-microagents.md) | Microagent loader, memory and condensers |
| Change chat, terminal, file views or client event handling | [Browser workflow](workflows/frontend.md) | Routes, socket context, service dispatch and query state |
| Add MCP/Git capabilities or issue automation | [Tools, Git and resolver](integrations/tools-and-git.md) | MCP utilities, provider services and resolver |
| Change SaaS identity, SQL stores or distributed sessions | [Enterprise boundaries](integrations/enterprise.md) | Enterprise entrypoint and selected implementations |
| Configure deployment, credentials or confirmation | [Configuration and deployment](operations/configuration-and-deployment.md) | Typed config, Compose and controller policy |
| Select tests or run an agent benchmark | [Validation and evaluation](testing/validation-and-evaluation.md) | Unit/runtime suites, frontend scripts and eval harness |

## Verify a focused change

Run the smallest relevant test file and expand when the behavior crosses boundaries. Typical commands from the root are:

```bash
poetry run pytest tests/unit/events/test_event_stream.py
poetry run pytest tests/unit/controller/test_agent_controller.py
```

From `frontend/`, use `npm test`, `npm run typecheck` and `npm run lint`. `make test` currently runs only frontend tests; use `poetry run pytest tests/unit` for the Python unit suite. Runtime tests require a working execution backend, and evaluations additionally require a configured model and task-specific data. Mocked browser tests and successful inference do not establish the same result as real runtime execution and benchmark scoring.

When investigating failures, distinguish persisted history, controller state, displayed client state and workspace files. A reconnect can restore display without restarting commands, while a missing runtime can still prevent continued execution. The linked pages explain those ownership boundaries and their focused tests.
