---
title: "Quickstart"
---
## Overview

This quickstart runs the repository checkout with its Python backend and React frontend. The build installs both dependency sets, installs commit hooks, and builds the frontend. The development run then starts a backend process and a frontend development server. Use this path when changing source code; the packaged launcher is also available when the goal is simply to run OpenHands.

Sources: [Makefile:24-32](repo://Makefile#L24-L32), [Makefile:265-283](repo://Makefile#L265-L283), [README.md:53-72](repo://README.md#L53-L72)

## Prepare the development environment

Use Linux, macOS, or WSL with Python 3.12, Node.js 22 or later, Poetry 1.8 or later, and Docker. The development guide additionally names build tools and Python headers for Ubuntu, and netcat for WSL. The Makefile uses `nc` while waiting for the backend, so that command must be available for the combined startup target. Its tmux check is advisory: missing tmux does not stop the build.

Sources: [Development.md:11-22](repo://Development.md#L11-L22), [Makefile:107-137](repo://Makefile#L107-L137), [Makefile:265-275](repo://Makefile#L265-L275)

Run the build from the repository root. Its dependency checks report missing executables or unsupported versions before installation proceeds. Python installation uses Poetry's Python 3.12 environment and normally includes the development, test, and runtime groups. Frontend installation runs the repository's Node detection script before `npm install`.

Sources: [Makefile:24-45](repo://Makefile#L24-L45), [Makefile:139-183](repo://Makefile#L139-L183)

```bash
make build
```

Sources: [Development.md:51-58](repo://Development.md#L51-L58)

The default Python installation also installs Chromium through Playwright. `INSTALL_PLAYWRIGHT=false` or `0` skips that installation; `POETRY_GROUP` switches installation to only the specified group. These are changes to what the build prepares, so retain the default path when you need the normal runtime and test dependencies. Commit-hook installation unsets an existing `core.hooksPath` and installs the project's pre-commit configuration.

Sources: [Makefile:151-188](repo://Makefile#L151-L188)

## Configure the model and workspace

The setup target prompts for a workspace directory, model name, API key, and optional model base URL, writes a temporary TOML file, then moves it to `config.toml`. That replaces the file at the configured destination. The generated model configuration is used for runs without the UI; the prompt explicitly tells UI users to select their model after the application starts.

Sources: [Makefile:300-325](repo://Makefile#L300-L325)

```bash
make setup-config
```

Sources: [Development.md:60-72](repo://Development.md#L60-L72)

Existing environment variables can override TOML settings because the application loads defaults, reads TOML, and then reads the environment. [[Configuration]] explains the field names and named groups when the effective model or runtime differs from the file you edited. The workspace prompt still writes `workspace_base`; the configuration finalizer identifies this as deprecated and points to `SANDBOX_VOLUMES` for explicit mounts.

Sources: [openhands/core/config/utils.py:819-836](repo://openhands/core/config/utils.py#L819-L836), [Makefile:307-312](repo://Makefile#L307-L312), [openhands/core/config/utils.py:377-384](repo://openhands/core/config/utils.py#L377-L384)

## Start the application

The combined target starts the backend, waits for its port to accept connections, and launches the frontend. Default addresses are backend `127.0.0.1:3000` and frontend port `3001`. Open the development interface at `http://localhost:3001`. The frontend proxy forwards API and socket traffic to the backend, so the browser entry point is the frontend address.

Sources: [Makefile:4-9](repo://Makefile#L4-L9), [Makefile:265-283](repo://Makefile#L265-L283), [Development.md:119-121](repo://Development.md#L119-L121), [frontend/vite.config.ts:80-100](repo://frontend/vite.config.ts#L80-L100)

```bash
make run
```

Sources: [Development.md:81-89](repo://Development.md#L81-L89)

For separate terminals, use the backend target in one terminal and the frontend target in another. The backend-only target includes Uvicorn reload and excludes the workspace directory from reload watching. The frontend target selects a WSL script when it detects Microsoft in the kernel version and passes the backend address through `VITE_BACKEND_HOST`.

Sources: [Makefile:248-263](repo://Makefile#L248-L263)

| Terminal | Command | Behavior |
| --- | --- | --- |
| Backend | `make start-backend` | Starts `openhands.server.listen:app` with reload |
| Frontend | `make start-frontend` | Starts frontend development with backend proxy configuration |

Sources: [Makefile:248-263](repo://Makefile#L248-L263)

Open the application and configure the LLM provider and key. Conversation creation loads stored user settings and rejects missing settings; it also rejects a missing or whitespace API key for non-Bedrock models. After settings are saved, a conversation can carry an initial task and repository selection into startup. [[Conversations]] explains the initialization states if the UI loads but the agent has not yet become ready.

Sources: [README.md:103-107](repo://README.md#L103-L107), [openhands/server/services/conversation_service.py:98-159](repo://openhands/server/services/conversation_service.py#L98-L159)

## Validate development changes

The documented Python unit-test invocation uses Poetry. Run the relevant unit tests while changing backend behavior; the repository's top-level `make test` target invokes frontend tests only. This distinction matters when interpreting a successful command: frontend checks do not exercise Python controller or runtime behavior.

Sources: [Development.md:142-150](repo://Development.md#L142-L150), [Makefile:237-242](repo://Makefile#L237-L242)

```bash
poetry run pytest ./tests/unit/test_*.py
```

Sources: [Development.md:146-150](repo://Development.md#L146-L150)

The frontend package defines separate scripts for Vitest, Playwright, coverage, typechecking, and linting. Its lint command runs route type generation and TypeScript checks before ESLint and formatting checks. Use the package scripts from the frontend directory; `make test-frontend` already performs that directory change for the ordinary test script.

Sources: [frontend/package.json:63-81](repo://frontend/package.json#L63-L81), [Makefile:237-239](repo://Makefile#L237-L239)

## Diagnose startup problems

If the combined startup waits indefinitely, its wait condition is a successful `nc` connection to the backend port. Start the backend separately to inspect its output. If requests reach the wrong server after changing ports, check the Makefile's backend host and port together with the frontend proxy settings. [[Web Client]] follows the subsequent REST and socket stages once those processes are reachable.

Sources: [Makefile:248-275](repo://Makefile#L248-L275), [frontend/vite.config.ts:10-25](repo://frontend/vite.config.ts#L10-L25), [frontend/vite.config.ts:80-100](repo://frontend/vite.config.ts#L80-L100)

For model debugging, the development guide documents `DEBUG=1` and prompt/response logs under the dated LLM log directory. For a packaged launch, the repository documents the following GUI command; its interface is on port 3000. [[CLI and Headless Runs]] covers the terminal entry point and scripted task execution when a browser is unnecessary.

Sources: [Development.md:129-132](repo://Development.md#L129-L132), [README.md:63-72](repo://README.md#L63-L72)

```bash
uvx --python 3.12 --from openhands-ai openhands serve
```

Sources: [README.md:64-70](repo://README.md#L64-L70)

