---
type: guide
title: OpenHands quickstart and task map
description: Start this checkout locally and find the documentation for agent execution, conversations, runtime tools, integrations, configuration, and validation.
tags: [quickstart, development, navigation, openhands]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:43:51.947Z
sources:
  - id: openwiki-source-1047363cf615000e4c9bb694
    resource: repo://frontend/package.json
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-ab3c6807c36a554faa63f162
    resource: repo://openhands/cli/entry.py
  - id: openwiki-source-45991f21437c2f30c93a3e24
    resource: repo://openhands/server/routes/health.py
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
generated: { by: "codex", at: "2026-11-16T17:43:51.947Z" }
---

# OpenHands quickstart and task map

OpenHands runs AI software-development agents through a controller, event stream, and execution runtime. This checkout contains the Python application, browser frontend, sandbox implementations, evaluation harness, enterprise extensions, and a separate UI component package. The package manifests identify the application as version `0.56.0`; commands here describe this checkout rather than a newer release.

## Start a development environment

Use Python 3.12 for the Makefile workflow, Node.js 22 or later, Poetry, Docker, and tmux on the documented Linux/macOS/WSL development path. The Python manifest accepts Python 3.12 through versions below 3.14, but the Makefile explicitly selects 3.12. `.nvmrc` selects Node 22 and the frontend's engine requirement is Node 22 or later. `Development.md` describes platform prerequisites; the Makefile checks them.

From the repository root:

```bash
make build
make setup-config
make run
```

`make build` installs backend and frontend dependencies, installs pre-commit hooks, and builds the frontend. `make setup-config` interactively writes `config.toml`, including model credentials and workspace choices; preserve an existing configuration before regenerating it. Set or confirm the model in the browser settings as well. The setup helper still writes the legacy workspace field; new mount configurations can use `SANDBOX_VOLUMES`, described in [configuration](operations/configuration.md).

Open the development frontend at `http://localhost:3001`; the backend defaults to port 3000. To run them in separate terminals, use `make start-backend` and `make start-frontend`. A successful backend `/alive` response checks the web process, while a conversation must also connect its runtime and model successfully.

For command-line work after installation:

```bash
poetry run openhands --help
poetry run openhands cli
```

The `openhands` executable defaults to the interactive CLI. `openhands serve` uses the GUI-launcher workflow. Programmatic/headless execution and benchmarks assemble tasks through `openhands.core.main.run_controller`; they do not run the browser application.

For a frontend-only UI session, run `npm run dev:mock` inside `frontend/`. It generates translations and starts the mocked development application. Use a live backend/runtime when validating actual execution or persistence.

## Choose a page by task

| Task or question | Read |
| --- | --- |
| Understand how a task becomes actions and observations | [System architecture](architecture/system.md) |
| Debug stored history, missing observations, resumption, or replay | [Events, state, and persistence](architecture/events-persistence.md) |
| Trace conversation creation, reconnect, authentication, or cleanup | [Server conversation lifecycle](architecture/server-conversations.md) |
| Change Docker/local/remote execution, workspace setup, or sandbox tools | [Runtime lifecycle](architecture/runtime.md) |
| Add an agent/tool, change LLM behavior, or investigate budgets and retries | [Agents and LLM services](concepts/agents-llms.md) |
| Change prompts, repository knowledge, or history condensation | [Memory and microagents](concepts/memory.md) |
| Add MCP tools, integrate a Git provider, or automate issue resolution | [Tools and repository integration](integrations/tools-repositories.md) |
| Work on SaaS authentication, database stores, clustering, or callbacks | [Enterprise boundaries](integrations/enterprise.md) |
| Diagnose settings precedence, mounts, deployment, or startup | [Configuration and operations](operations/configuration.md) |
| Change browser chat, event handling, settings, or UI state | [Frontend conversation workflow](workflows/frontend.md) |
| Select unit/runtime/browser checks or run a benchmark | [Testing and evaluation](testing/validation.md) |

## First checks for a change

For a Python controller change, start with:

```bash
poetry run pytest tests/unit/controller/test_agent_controller.py
```

For a frontend change, run a relevant test and type checking inside `frontend/`:

```bash
npm test -- __tests__/context/ws-client-provider.test.tsx
npm run typecheck
```

Choose tests that exercise the changed boundary. Real runtime tests need execution infrastructure; live end-to-end tests and benchmark inference can use external provider/model credentials. Frontend mock tests and Python unit tests serve different purposes from those workflows.

## Keep these boundaries in mind

The controller manages progress; the agent chooses actions; the runtime executes them. Conversation records and sandbox files have independent retention. Browser process configuration and stored user settings both affect session behavior. Condensation reduces the model-facing history view without deleting the underlying event log. The enterprise application replaces selected services, and `openhands-ui/` has its own library build rather than being the main application's build output.

Use the linked pages for current implementation details and representative tests. Existing repository READMEs provide additional context, but some describe older layouts or behavior; verify the implementation before using those passages as operational contracts.
