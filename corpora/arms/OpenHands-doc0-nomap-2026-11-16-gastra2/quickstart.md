---
title: "Quickstart"
---
## Overview

Use this procedure to build the checkout, start the development application, and submit a task. The development setup runs a Python backend and a separate frontend server. The packaged launcher is also available when you want to run OpenHands without building the source. [[OpenHands Overview]] explains the agent and runtime pieces that these entry points assemble.

Sources: [Development.md:51-104](repo://Development.md#L51-L104), [README.md:53-72](repo://README.md#L53-L72), [openhands/core/main.py:97-167](repo://openhands/core/main.py#L97-L167)

## Prepare the development environment

The development guide targets Linux, macOS, or Windows through WSL, and calls for Python 3.12, Node.js 22 or later, Poetry 1.8 or later, and Docker. The Makefile checks specifically for the `python3.12` executable, so another installed Python version does not satisfy that check. Although package metadata allows Python versions below 3.14, the source development workflow selects 3.12 explicitly.

Sources: [Development.md:11-22](repo://Development.md#L11-L22), [Makefile:64-96](repo://Makefile#L64-L96), [Makefile:119-145](repo://Makefile#L119-L145), [pyproject.toml:27-28](repo://pyproject.toml#L27-L28)

On Ubuntu the guide lists `build-essential` and `python3.12-dev`; for WSL it lists `netcat`. The combined launch target actually uses `nc` to wait for the backend port. Missing `tmux` produces an optional-feature notice, whereas missing required build tools stops the dependency checks. Docker is checked unless `INSTALL_DOCKER` has been set; skipping that check does not itself choose another runtime.

Sources: [Development.md:18-22](repo://Development.md#L18-L22), [Makefile:34-44](repo://Makefile#L34-L44), [Makefile:98-117](repo://Makefile#L98-L117), [Makefile:266-275](repo://Makefile#L266-L275)

## Build the checkout

Run the repository's build target from its root:

Sources: [Development.md:51-58](repo://Development.md#L51-L58)

```bash
make build
```

Sources: [Development.md:56-58](repo://Development.md#L56-L58)

This checks dependencies, installs Python and frontend dependencies, installs pre-commit hooks, and builds the frontend. Python installation uses Poetry with the `dev`, `test`, and `runtime` groups by default. `POETRY_GROUP` changes which groups are installed. The frontend installation runs its Node-version detection script before `npm install`, and its build executes both `prepare` and `build` scripts.

Sources: [Makefile:25-32](repo://Makefile#L25-L32), [Makefile:139-156](repo://Makefile#L139-L156), [Makefile:177-185](repo://Makefile#L177-L185), [Makefile:244-246](repo://Makefile#L244-L246)

The Python dependency target also installs Chromium through Playwright unless `INSTALL_PLAYWRIGHT` is `false` or `0`. Its usual path requests browser system dependencies and writes a cache marker when installation succeeds. A failure at this stage is a build-environment issue before any agent session starts; the agent execution loop has not yet been launched.

Sources: [Makefile:157-174](repo://Makefile#L157-L174), [Makefile:25-32](repo://Makefile#L25-L32)

## Configure the model

Use the setup target to enter a workspace path, model name, API key, and optional base URL. It writes a temporary configuration and moves it into `config.toml`, so it replaces that file when it completes. The prompt explicitly says that this model selection is for running without the UI; configure the model in the UI when using the browser application.

Sources: [Makefile:301-325](repo://Makefile#L301-L325)

```bash
make setup-config
```

Sources: [Development.md:64-72](repo://Development.md#L64-L72)

Existing environment variables can override values loaded from the TOML file. If the effective model or runtime differs from the file you edited, check the loading sequence in [[Configuration and Language Models]]. Browser conversation startup additionally loads saved user settings and rejects missing settings or a missing API key for non-Bedrock models, so a valid file alone does not guarantee browser session startup.

Sources: [openhands/core/config/utils.py:828-836](repo://openhands/core/config/utils.py#L828-L836), [openhands/server/services/conversation_service.py:98-124](repo://openhands/server/services/conversation_service.py#L98-L124)

## Start the development application

Start both servers with the combined target. By default the backend binds to `127.0.0.1:3000` and the frontend uses port `3001`; open the frontend at `http://localhost:3001`. These are the development ports, while the packaged GUI launcher documented below exposes its application at port `3000`.

Sources: [Makefile:5-9](repo://Makefile#L5-L9), [Makefile:254-282](repo://Makefile#L254-L282), [Development.md:119-121](repo://Development.md#L119-L121), [README.md:63-72](repo://README.md#L63-L72)

```bash
make run
```

Sources: [Development.md:83-89](repo://Development.md#L83-L89)

For separate development terminals, use `make start-backend` and `make start-frontend`. The standalone backend target enables Uvicorn reload and excludes `./workspace` from reload watching. The combined target starts the backend without that reload flag, waits for its port, then starts the frontend. The frontend target detects WSL and selects `dev_wsl` instead of `dev` when appropriate.

Sources: [Makefile:249-282](repo://Makefile#L249-L282)

Choose the provider and credentials in the application, then submit a task. The create-conversation hook forwards the query and optional repository, branch, and instructions. The backend returns a conversation ID and status; successful request creation is followed by session initialization and live events, explained in [[Conversations and Server API]] and [[Web Interface]].

Sources: [README.md:103-107](repo://README.md#L103-L107), [frontend/src/hooks/mutation/use-create-conversation.ts:8-42](repo://frontend/src/hooks/mutation/use-create-conversation.ts#L8-L42), [openhands/server/routes/manage_conversations.py:242-269](repo://openhands/server/routes/manage_conversations.py#L242-L269)

## Verify startup and diagnose failures

The backend provides `/alive`, returning a status object with `ok`, and `/health`, returning `OK`. These handlers confirm the server can answer requests; they do not start a runtime or test model credentials. If the server responds but a task does not start, distinguish saved-settings errors from runtime initialization errors before investigating [[Agent Execution]].

Sources: [openhands/server/routes/health.py:6-17](repo://openhands/server/routes/health.py#L6-L17), [openhands/server/services/conversation_service.py:98-124](repo://openhands/server/services/conversation_service.py#L98-L124), [openhands/server/session/agent_session.py:204-222](repo://openhands/server/session/agent_session.py#L204-L222)

The headless module is another diagnostic entry point: it loads configuration, reads a task from arguments, a file, or standard input, and wraps the task in a `MessageAction`. Without a task it raises an error naming `-t` and `-f`. Trajectory replay is a separate mode that rejects a simultaneous user task. Controller execution and saved output are described in [[Agent Execution]] and [[Events and Persistence]].

Sources: [openhands/core/main.py:286-320](repo://openhands/core/main.py#L286-L320), [openhands/core/main.py:220-240](repo://openhands/core/main.py#L220-L240)

## Run the packaged launcher

The README provides these launcher commands when building the checkout is unnecessary. It recommends `uv` for isolation from the current project's environment and for the default MCP servers. The first command launches the GUI and the second launches the interactive CLI; they install and run the package rather than the working tree you just edited.

Sources: [README.md:53-72](repo://README.md#L53-L72)

```bash
uvx --python 3.12 --from openhands-ai openhands serve
uvx --python 3.12 --from openhands-ai openhands
```

Sources: [README.md:63-70](repo://README.md#L63-L70)
