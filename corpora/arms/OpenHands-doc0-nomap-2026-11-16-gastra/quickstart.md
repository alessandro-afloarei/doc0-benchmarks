---
title: "Quickstart"
---
## Overview

Use the development workflow when you want to run and change this checkout. It builds the Python environment and frontend, writes local model configuration, and starts the browser application. The same checkout also has an interactive CLI entry and a direct headless module. They enter the systems described in [[OpenHands Architecture]] through different startup paths, so choose the entry that matches the behavior you want to inspect.

Sources: [Makefile:24-32](repo://Makefile#L24-L32), [Makefile:249-282](repo://Makefile#L249-L282), [openhands/cli/entry.py:23-45](repo://openhands/cli/entry.py#L23-L45), [openhands/core/main.py:286-319](repo://openhands/core/main.py#L286-L319)

## Prepare the development environment

The development guide specifies Linux, macOS or WSL, Docker, Python 3.12, Node.js 22 or newer and Poetry 1.8 or newer. It also lists Ubuntu build dependencies and netcat for WSL. The Makefile checks those tools before building; its tmux check is explicitly optional. Python package metadata allows a broader Python range, but the development Makefile selects Python 3.12 directly, so that is the concrete interpreter for this workflow.

Sources: [Development.md:11-22](repo://Development.md#L11-L22), [Makefile:14-14](repo://Makefile#L14-L14), [Makefile:34-45](repo://Makefile#L34-L45), [Makefile:107-117](repo://Makefile#L107-L117), [Makefile:145-155](repo://Makefile#L145-L155), [pyproject.toml:27-28](repo://pyproject.toml#L27-L28)

From the repository root, run the build target. It checks dependencies, installs Python and frontend dependencies, installs pre-commit hooks, and builds the frontend. This target prepares a contributor checkout; it is more than starting an already installed application.

Sources: [Makefile:24-32](repo://Makefile#L24-L32), [Makefile:185-188](repo://Makefile#L185-L188)

```bash
make build
```

Sources: [Development.md:51-58](repo://Development.md#L51-L58)

By default, Python installation includes the `dev`, `test` and `runtime` groups. `POETRY_GROUP` changes that selection to an explicit `--only` group. The build also installs Chromium through Playwright unless `INSTALL_PLAYWRIGHT` is `false` or `0`; outside the Manjaro branch it records successful installation in a cache marker. These switches explain differences between a full development setup and a reduced environment when investigating missing test or browser dependencies.

Sources: [Makefile:139-175](repo://Makefile#L139-L175)

## Configure the model

Run the configuration target and supply your workspace, model name, API key and optional base URL. It writes `[core]` and `[llm]` sections to a temporary file and then moves that file to `config.toml`. The model prompt explicitly says the selection applies to running without the UI; browser model selection happens in the UI. [[Configuration]] explains how this file interacts with environment variables and saved session settings.

Sources: [Makefile:300-325](repo://Makefile#L300-L325)

```bash
make setup-config
```

Sources: [Development.md:60-72](repo://Development.md#L60-L72)

When opening the browser application, choose the provider and enter its API key. Conversation startup loads saved settings and refuses to start if they are absent. It also checks for a missing or whitespace API key for non-Bedrock model names; this check does not perform an inference to validate the credential. A successful settings save and a successful provider request are therefore separate checkpoints.

Sources: [README.md:103-107](repo://README.md#L103-L107), [openhands/server/services/conversation_service.py:98-124](repo://openhands/server/services/conversation_service.py#L98-L124)

## Start the browser application

The combined target starts the backend, waits for its port with `nc`, then launches the frontend. Default ports are 3000 for the backend and 3001 for the development frontend, with loopback binding. Open the development interface at `http://localhost:3001`. This port comes from the checkout's development workflow; the packaged GUI launcher documented in the repository README uses port 3000.

Sources: [Makefile:5-9](repo://Makefile#L5-L9), [Makefile:265-282](repo://Makefile#L265-L282), [Development.md:119-121](repo://Development.md#L119-L121), [README.md:63-72](repo://README.md#L63-L72)

```bash
make run
```

Sources: [Development.md:81-89](repo://Development.md#L81-L89)

For separate terminals, use the backend and frontend targets below. The backend target enables Uvicorn reload and excludes the workspace directory. The frontend target passes the backend address to Vite and selects the WSL development script when it detects WSL. Once the interface is ready, a new conversation can contain an initial message and an optional repository and branch; [[Browser Conversations]] traces how that request starts execution.

Sources: [Makefile:249-263](repo://Makefile#L249-L263), [openhands/server/routes/manage_conversations.py:160-175](repo://openhands/server/routes/manage_conversations.py#L160-L175)

```bash
make start-backend
```

Sources: [Development.md:91-98](repo://Development.md#L91-L98)

```bash
make start-frontend
```

Sources: [Development.md:100-104](repo://Development.md#L100-L104)

## Run a task without the browser

The direct module reads configuration, reads the task, creates a `MessageAction` and invokes `run_controller`. For example, the following invocation supplies a small task and caps the iteration count. The task text is an example; `-t` and `--max-iterations` are the actual parser options. A task file supplied with `-f` takes precedence over `-t` according to the parser contract.

Sources: [openhands/core/main.py:286-319](repo://openhands/core/main.py#L286-L319), [openhands/core/config/arg_utils.py:23-35](repo://openhands/core/config/arg_utils.py#L23-L35), [openhands/core/config/arg_utils.py:117-129](repo://openhands/core/config/arg_utils.py#L117-L129)

```bash
poetry run python -m openhands.core.main -t "Describe the files in the workspace" --max-iterations 10
```

Sources: [openhands/core/main.py:286-319](repo://openhands/core/main.py#L286-L319), [openhands/core/config/arg_utils.py:23-29](repo://openhands/core/config/arg_utils.py#L23-L29), [openhands/core/config/arg_utils.py:117-123](repo://openhands/core/config/arg_utils.py#L117-L123)

Headless execution automatically supplies a continuation response when the agent requests input unless `--no-auto-continue` is set. With that option, the controller reads input instead. The packaged `openhands` entry is a different interface: absent a subcommand it selects `cli`, while `serve` calls the GUI launcher. Use the direct module when you specifically need its task and evaluation-style argument handling.

Sources: [openhands/core/main.py:193-203](repo://openhands/core/main.py#L193-L203), [openhands/core/main.py:311-319](repo://openhands/core/main.py#L311-L319), [openhands/core/config/arg_utils.py:130-135](repo://openhands/core/config/arg_utils.py#L130-L135), [openhands/cli/entry.py:23-45](repo://openhands/cli/entry.py#L23-L45)

## Check startup failures

If no browser conversation starts, first distinguish missing settings from runtime startup. The conversation route returns HTTP 400 for missing settings and LLM authentication configuration errors. The session subsequently creates its runtime before memory and controller initialization, recording whether runtime connection succeeded. [[Sandbox Execution]] describes that later stage; repeating provider configuration cannot repair a failed sandbox connection.

Sources: [openhands/server/routes/manage_conversations.py:270-288](repo://openhands/server/routes/manage_conversations.py#L270-L288), [openhands/server/session/agent_session.py:134-168](repo://openhands/server/session/agent_session.py#L134-L168), [openhands/server/session/agent_session.py:204-221](repo://openhands/server/session/agent_session.py#L204-L221)

For development validation, the repository gives a Python unit-test command and dedicated frontend targets. [[Testing and Evaluation]] separates those checks from benchmark inference, which uses its own runners and configuration. The startup workflow above does not run those suites as part of `make run`.

Sources: [Development.md:142-150](repo://Development.md#L142-L150), [Makefile:241-246](repo://Makefile#L241-L246), [Makefile:279-282](repo://Makefile#L279-L282), [evaluation/README.md:7-23](repo://evaluation/README.md#L7-L23)
