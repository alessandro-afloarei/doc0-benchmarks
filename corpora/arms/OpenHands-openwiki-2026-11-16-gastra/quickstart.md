---
type: guide
title: OpenHands quickstart
description: Set up this OpenHands checkout, identify its execution entrypoints, and navigate to the architecture, integration, workflow, or testing guide for your task.
tags: [quickstart, development, navigation, setup]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T08:14:39.912Z
sources:
  - id: openwiki-source-1047363cf615000e4c9bb694
    resource: repo://frontend/package.json
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-ab3c6807c36a554faa63f162
    resource: repo://openhands/cli/entry.py
  - id: openwiki-source-33bda7da9a7aaa1b62b92f7d
    resource: repo://openhands/cli/gui_launcher.py
  - id: openwiki-source-2129d0084f64a3f5714baf90
    resource: repo://openhands/controller/agent_controller.py
  - id: openwiki-source-f38350b0cd074145e71451f8
    resource: repo://openhands/runtime/base.py
generated: { by: "codex", at: "2026-11-16T08:14:39.912Z" }
---

# OpenHands quickstart

This repository contains the OpenHands agent application: a Python backend, React web frontend, runtime adapters, issue-resolution/evaluation tooling, a separate UI component package, and enterprise extensions. Start with the task map below; the detailed pages explain behavior and failure boundaries rather than listing every source file.

## Run this checkout for development

The standard source workflow targets Python 3.12, Node 22 or later, Poetry, and Docker for the default runtime. The Python manifest permits a broader range below Python 3.14, but the Makefile and primary CI use 3.12. Linux, macOS, or Windows through WSL are the documented source-development environments.

From the repository root:

```bash
make build
make setup-config
make run
```

`make build` checks dependencies, installs Python dev/test/runtime groups and frontend dependencies, installs hooks, and builds the frontend. It can also install Playwright Chromium and system dependencies. `make setup-config` is interactive and writes `config.toml`; inspect an existing configuration before replacing it.

The standard development ports are backend 3000 and frontend 3001. Open the frontend at `http://localhost:3001`. Configure the model/provider in the web settings; the headless model configuration does not automatically determine the web session's model.

To run the two development processes separately, use `make start-backend` and `make start-frontend` in separate terminals. For frontend-only mocked work:

```bash
cd frontend
npm ci
npm run dev:mock
```

Plain `npm run dev` uses the real API path; `dev:mock:saas` selects the SaaS mock mode. See [configuration and deployment](operations/configuration.md) for settings precedence, volumes, persistence, and launch-mode differences.

The installed `openhands` console command dispatches to the CLI; `openhands serve` launches a Docker-based GUI. Use the source Makefile when your intent is to exercise edited backend/frontend code.

## Find the right explanation

| Task or question | Start here |
| --- | --- |
| Understand the whole request/action/result flow | [System architecture](architecture/system.md) |
| Change agent scheduling, limits, confirmation, or delegation | [Agent control and CodeAct](architecture/agent-control.md) |
| Debug event IDs, missing history, secret filtering, or restore | [Events and durable state](architecture/events-storage.md) |
| Add an API or debug conversation startup/reconnect | [Sessions and server APIs](architecture/sessions-api.md) |
| Change shell/file/browser execution or sandbox cleanup | [Runtime execution](architecture/runtime.md) |
| Change prompts, model access, recall, or condensation | [LLMs, memory and microagents](concepts/llm-memory.md) |
| Add MCP tools or change Git credentials/provider APIs | [MCP and Git integrations](integrations/tools-providers.md) |
| Trace SaaS identity, database storage, callbacks, or workers | [Enterprise boundaries](integrations/enterprise.md) |
| Change conversation UI, socket state, or file-cache updates | [Frontend workflow](workflows/frontend.md) |
| Run issue resolution or understand benchmark outputs | [Resolver and evaluation](workflows/resolver-evaluation.md) |
| Select commands and required test environments | [Testing and validation](testing/validation.md) |

## A small working model

The controller reads State and asks the agent for an Action. The event stream persists and distributes it. The runtime executes it and publishes an Observation linked to the action ID. Memory answers recall requests, condensers shape the model's history view, and the frontend displays a projection of server events and metadata.

A conversation has several independent kinds of state: event history, controller checkpoint, runtime workspace, application metadata, and client display state. A successful socket reconnect does not by itself prove that all of those have been restored.

## Validate a focused change

After installing development dependencies:

```bash
poetry run pytest tests/unit/events/test_event_stream.py
```

For a frontend change, run its focused Vitest tests and `npm run typecheck` from `frontend/`. The root `make test` runs frontend tests only; use explicit pytest commands for Python. Runtime tests execute real tools and need the selected runtime environment. Live end-to-end tests and evaluations have additional credentials and model requirements.

This wiki is grounded in the checked-out source. Use its source references and focused tests when changing a contract; do not assume comments in older README files override the current implementation.
