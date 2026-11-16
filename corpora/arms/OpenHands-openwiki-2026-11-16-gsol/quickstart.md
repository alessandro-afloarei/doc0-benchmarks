---
type: guide
title: Quickstart and task map
description: Build and run this OpenHands checkout, choose web or headless entrypoints, and navigate implementation documentation by engineering task.
tags: [quickstart, development, navigation, openhands]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:50:03.393Z
sources:
  - id: openwiki-source-1047363cf615000e4c9bb694
    resource: repo://frontend/package.json
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-ab3c6807c36a554faa63f162
    resource: repo://openhands/cli/entry.py
  - id: openwiki-source-33bda7da9a7aaa1b62b92f7d
    resource: repo://openhands/cli/gui_launcher.py
  - id: openwiki-source-d3f14b919d4ae24afe8df275
    resource: repo://openhands/core/main.py
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
generated: { by: "codex", at: "2026-11-16T06:50:03.393Z" }
---

# Quickstart and task map

OpenHands runs coding agents that decide through a language model and act through a runtime. This checkout contains the Python engine and server, React browser application, runtime tooling, integrations, evaluation harness, and a separately packaged enterprise extension. Start with [execution architecture](architecture/execution.md) to understand component ownership.

## Run this checkout for development

The documented development baseline is Linux/macOS/WSL, Python 3.12, Node.js 22 or newer, Poetry 1.8 or newer, and Docker for the default runtime. The Python package allows Python versions from 3.12 up to but excluding 3.14, while the Makefile selects 3.12. The current frontend manifest requires Node 22; use that instead of older frontend README prerequisites. A dev-container configuration is also available.

From the repository root:

```bash
make build
make setup-config
make run
```

`make build` checks dependencies, installs Python and frontend packages, installs pre-commit hooks, and builds the client. Python setup normally installs the dev, test, and runtime groups and Playwright Chromium/system dependencies. For an environment where browser dependencies are already managed, `INSTALL_PLAYWRIGHT=false make build` skips that installation.

`make setup-config` interactively creates `config.toml`. It asks for workspace, model, credentials, and optional model endpoint. Choose model settings in the UI for browser conversations. Headless execution uses core configuration and supported command-line overrides; see [configuration](operations/configuration.md).

`make run` starts the backend on port 3000 and the frontend on port 3001. Open `http://localhost:3001`. To work in separate terminals:

```bash
make start-backend
```

```bash
make start-frontend
```

The backend entrypoint is `openhands.server.listen:app`. The frontend development proxy sends API and Socket.IO traffic to it. Static application serving uses the built `frontend/build/` assets; avoid confusing the development client port with the packaged app's port 3000.

## Other execution surfaces

After dependency installation, the installed CLI is available through Poetry:

```bash
poetry run openhands
```

The command defaults to interactive CLI mode. `poetry run openhands serve` instead launches the packaged GUI through Docker using versioned images; use the development server targets above to run modified local server/client source.

For a scriptable task using this checkout:

```bash
poetry run python -m openhands.core.main --config-file config.toml -t "Inspect the workspace and describe its project structure" --max-iterations 10
```

The headless parser also supports task files, named LLM configuration, agent class, budget, selected repository, and session name. Its default synthetic user response asks the agent to continue; `--no-auto-continue` uses stdin when more user input is needed.

The runtime defaults to Docker. Changing to `local` runs an execution-server process on the host; `cli` executes commands/files directly and lacks browser/notebook support. Workspace mounts and persistent conversation storage are separate configuration choices. Read [runtime operations](operations/runtimes.md) before changing those boundaries.

For frontend-only work, run `npm run dev:mock` or `npm run dev:mock:saas` from `frontend/`. Ordinary `npm run dev` uses the real backend in the current scripts.

## Navigate by task

| Engineering task | Read |
| --- | --- |
| Understand a user task from input to tools | [Execution architecture](architecture/execution.md) |
| Change agent decisions, prompts, model transport, retries, or metrics | [Agents and LLMs](concepts/agents-llm.md) |
| Debug pending actions, ordering, replay, checkpoints, or delegation | [Events, state, and recovery](concepts/events-state.md) |
| Add repository instructions or reduce model context | [Memory, microagents, and condensation](concepts/memory.md) |
| Change HTTP creation, Socket.IO, persistence, or cleanup | [Conversation server](architecture/conversation-server.md) |
| Change routes, interface state, reconnects, or query invalidation | [Browser client](architecture/browser-client.md) |
| Change sandbox tools, images, networking, mounts, or lifecycle | [Runtime operations](operations/runtimes.md) |
| Trace effective settings, credentials, or confirmation mode | [Configuration and action security](operations/configuration.md) |
| Add MCP tools, Git providers, or repository setup hooks | [MCP and Git providers](integrations/tools-providers.md) |
| Work on SaaS auth, stores, distributed ownership, or callbacks | [Enterprise composition](integrations/enterprise.md) |
| Select tests, lint, CI checks, or real browser/runtime verification | [Testing and validation](testing/validation.md) |
| Evaluate task-solving or generate issue patches/PRs | [Evaluation and resolver workflows](workflows/evaluation-resolver.md) |

## Verify a change

A focused Python starting point is `poetry run pytest tests/unit/<affected-suite>`. Frontend changes use `npm run typecheck`, a targeted Vitest test, and relevant build/lint checks from `frontend/`. The root `make test` currently runs only frontend tests. Real execution behavior belongs in runtime integration tests, while benchmark inference and scoring measure task-solving behavior.

For a first startup failure, check credentials and settings, Docker/runtime health, built frontend assets, and effective port/proxy configuration. Runtime startup and model completion are different failure stages; logs and event history help identify which owns the problem.

## Repository map and existing guides

`openhands/` contains the engine, server, agents, runtimes, stores, and integrations. `frontend/` is the browser app; `openhands-ui/` is a separate reusable UI package. `microagents/` contains packaged context extensions. `tests/` holds Python unit/runtime/E2E tests, `evaluation/` holds benchmark workflows, and `enterprise/` has its own environment and services.

Keep [Development.md](../Development.md), [CONTRIBUTING.md](../CONTRIBUTING.md), [config.template.toml](../config.template.toml), and [docs/README.md](../docs/README.md) nearby for established contributor and user-documentation workflows. This wiki explains implementation relationships with repository evidence; source and focused tests remain authoritative.
