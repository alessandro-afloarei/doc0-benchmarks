---
title: "Quickstart"
---
## Overview

Use this workflow to build the checkout and run OpenHands while editing its source. The repository's development path runs a Python backend and a frontend development server separately, with `make run` coordinating their startup. The installed command also exposes a terminal interface and a packaged GUI launcher. The entry points share the agent platform described in [[OpenHands Overview]], but their launch commands and configuration paths differ, so choose the surface that matches the work you want to inspect.

Sources: [Makefile:248-283](repo://Makefile#L248-L283), [openhands/cli/entry.py:12-48](repo://openhands/cli/entry.py#L12-L48)

## Prepare the checkout

The Makefile targets Python 3.12, Node.js 22 or later, npm, Poetry 1.8 or later, and Docker. Its dependency checks recognize macOS and Linux and report unsupported systems; the development guide includes WSL and lists platform-specific packages. A missing tmux installation produces an optional-feature notice rather than failing the build. The package's Python constraint is broader than the development target: it allows Python versions from 3.12 up to, but excluding, 3.14.

Sources: [Makefile:34-137](repo://Makefile#L34-L137), [Makefile:14-14](repo://Makefile#L14-L14), [Development.md:11-22](repo://Development.md#L11-L22), [pyproject.toml:27-28](repo://pyproject.toml#L27-L28)

Build from the repository root. The build target checks dependencies, installs Python and frontend dependencies, installs pre-commit hooks, and builds the frontend. The normal Python installation includes the `dev`, `test`, and `runtime` dependency groups. Playwright Chromium installation is part of this setup unless `INSTALL_PLAYWRIGHT` is `false` or `0`; the Makefile records a cache marker after installing it.

Sources: [Makefile:24-32](repo://Makefile#L24-L32), [Makefile:139-175](repo://Makefile#L139-L175), [Makefile:177-189](repo://Makefile#L177-L189), [Makefile:244-246](repo://Makefile#L244-L246)

```bash
make build
```

Sources: [Development.md:51-58](repo://Development.md#L51-L58)

## Set up model access

The setup target prompts for a workspace directory, model name, API key, and optional base URL, then replaces `config.toml` with the generated file. It writes workspace settings under `[core]` and model settings under `[llm]`. The model prompt explicitly identifies this model as the headless setting and tells UI users to set the model in the UI. [[Configuration]] explains loading precedence and named model groups when a single default is insufficient.

Sources: [Makefile:300-325](repo://Makefile#L300-L325)

```bash
make setup-config
```

Sources: [Development.md:60-72](repo://Development.md#L60-L72)

Web conversation startup loads stored user settings. It raises `MissingSettingsError` when those settings do not exist and checks for a model API key before starting a non-Bedrock model. Consequently, a successful source build and a working headless configuration do not by themselves establish the settings needed by a browser conversation. The settings and session boundary is described in [[Conversations and Sessions]].

Sources: [openhands/server/services/conversation_service.py:98-135](repo://openhands/server/services/conversation_service.py#L98-L135)

## Start the development application

The default backend address is `127.0.0.1:3000`, and the default frontend port is `3001`. `make run` starts Uvicorn, waits for the backend TCP port using `nc`, and starts the frontend. The standalone backend target adds reload support and excludes the workspace from reload watching. The frontend target passes backend and frontend addresses through Vite environment settings and selects a separate development script when it detects WSL.

Sources: [Makefile:4-14](repo://Makefile#L4-L14), [Makefile:248-283](repo://Makefile#L248-L283)

```bash
make run
```

Sources: [Development.md:81-89](repo://Development.md#L81-L89)

To work on one side independently, use `make start-backend` or `make start-frontend` in its own terminal. Open the development frontend at `http://localhost:3001`. The backend exposes `/alive`, returning a status object, and `/health`, returning `OK`; these endpoints check that the application answers HTTP requests. A task still needs valid conversation settings and a connected runtime before the agent can execute workspace actions.

Sources: [Development.md:91-104](repo://Development.md#L91-L104), [Development.md:119-121](repo://Development.md#L119-L121), [openhands/server/routes/health.py:6-17](repo://openhands/server/routes/health.py#L6-L17), [openhands/server/session/agent_session.py:134-197](repo://openhands/server/session/agent_session.py#L134-L197)

## Choose terminal or headless execution

Poetry installs the `openhands` command through `openhands.cli.entry:main`. Invoke that command with `cli` for the terminal interface or `serve` for the GUI launcher; omitting the subcommand inserts `cli`. The parser accepts `--task` and `--config-file`. The CLI sets up its selected runtime, runs a session, supports starting another session afterward, and calls runtime teardown when the session loop ends. This path is useful for following interactive terminal behavior without running the frontend development server.

Sources: [pyproject.toml:170-171](repo://pyproject.toml#L170-L171), [openhands/cli/entry.py:18-45](repo://openhands/cli/entry.py#L18-L45), [openhands/core/config/arg_utils.py:15-35](repo://openhands/core/config/arg_utils.py#L15-L35), [openhands/cli/main.py:733-755](repo://openhands/cli/main.py#L733-L755)

For the headless path, run the module `openhands.core.main` through Poetry and supply a task with `-t` or a task file with `-f`. The parser also exposes `--max-iterations` and `--max-budget-per-task`. The module rejects an empty task unless replay is configured, wraps the task in `MessageAction`, and invokes `run_controller`. It supplies automatic continuation replies by default; `--no-auto-continue` switches that callback off so input can be read instead. [[Controller and Event Stream]] explains the limits and final states consumed by this entry point.

Sources: [openhands/core/config/arg_utils.py:23-35](repo://openhands/core/config/arg_utils.py#L23-L35), [openhands/core/config/arg_utils.py:102-142](repo://openhands/core/config/arg_utils.py#L102-L142), [openhands/core/main.py:286-320](repo://openhands/core/main.py#L286-L320), [openhands/core/main.py:193-216](repo://openhands/core/main.py#L193-L216)

## Verify a development change

The unit-test guide supports running the whole Python unit suite, a single file, or an individual test. Start with the test covering the behavior changed; the documented single-file example targets function-call conversion. Frontend scripts expose Vitest, Playwright, type generation and TypeScript checking. The Makefile's `test` target currently delegates to frontend tests, so use the Python test command explicitly when checking backend changes.

Sources: [tests/unit/README.md:3-26](repo://tests/unit/README.md#L3-L26), [frontend/package.json:63-81](repo://frontend/package.json#L63-L81), [Makefile:237-242](repo://Makefile#L237-L242)

```bash
poetry run pytest ./tests/unit/test_llm_fncall_converter.py
```

Sources: [tests/unit/README.md:11-15](repo://tests/unit/README.md#L11-L15)

For linting, `make lint-backend` runs pre-commit across tracked files after installing hooks, and `make lint-frontend` runs the frontend lint script after dependency installation. Frontend lint includes type checking, ESLint, and Prettier. When an application task fails after startup, follow the runtime's status and action error handling in [[Sandbox Runtimes]]; a responding health endpoint and a passing static check cover different boundaries from sandbox execution.

Sources: [Makefile:185-201](repo://Makefile#L185-L201), [frontend/package.json:75-80](repo://frontend/package.json#L75-L80), [openhands/runtime/base.py:361-399](repo://openhands/runtime/base.py#L361-L399)
