---
title: "Quickstart"
---
## Overview

Use the source checkout when you want to run and change OpenHands together. The development workflow builds the Python environment and browser application, configures a model, then starts a backend and frontend. A separate headless module accepts a task directly. Both paths reach the agent, memory and runtime systems described in [[Architecture]], but the development browser uses a different port from the packaged GUI launcher.

Sources: [Development.md:9-22](repo://Development.md#L9-L22), [Development.md:51-104](repo://Development.md#L51-L104), [Development.md:119-120](repo://Development.md#L119-L120), [README.md:67-87](repo://README.md#L67-L87), [openhands/core/main.py:286-320](repo://openhands/core/main.py#L286-L320)

## Prepare the development environment

The development guide specifies Linux, macOS or WSL with Ubuntu 22.04 or newer, Python 3.12, Node.js 22 or newer, Poetry 1.8 or newer and Docker. Ubuntu also needs `build-essential` and `python3.12-dev`; WSL needs `netcat`. The Makefile checks these tools before dependency installation. Its tmux check is advisory: it reports that some advanced terminal features may be unavailable when tmux is absent.

Sources: [Development.md:11-22](repo://Development.md#L11-L22), [Makefile:34-45](repo://Makefile#L34-L45), [Makefile:64-117](repo://Makefile#L64-L117), [Makefile:119-137](repo://Makefile#L119-L137)

From the repository root, build the environment:

Sources: [Development.md:51-58](repo://Development.md#L51-L58)

```bash
make build
```

Sources: [Development.md:51-58](repo://Development.md#L51-L58)

The target checks dependencies, installs Python packages, installs frontend packages, registers pre-commit hooks and builds the browser application. The Python installation selects Python 3.12 and normally includes the `dev`, `test` and `runtime` dependency groups. It also installs Chromium through Playwright unless `INSTALL_PLAYWRIGHT` disables that step. [[Development and Testing]] explains the individual build and check targets when you need a narrower development cycle.

Sources: [Makefile:24-32](repo://Makefile#L24-L32), [Makefile:139-188](repo://Makefile#L139-L188), [Makefile:244-246](repo://Makefile#L244-L246)

## Configure a model and workspace

The repository provides an interactive configuration target:

Sources: [Development.md:60-68](repo://Development.md#L60-L68)

```bash
make setup-config
```

Sources: [Development.md:60-68](repo://Development.md#L60-L68)

It writes `config.toml` with a `[core]` workspace setting and an `[llm]` section for the model, API key and optional base URL. The workspace prompt defaults to `./workspace`; the model prompt defaults to the Makefile's `gpt-4o` value. These are the values implemented by the checkout's setup target. For a browser conversation, select the model in the UI after startup; the prompt explicitly describes the TOML model as the headless setting.

Sources: [Makefile:10-12](repo://Makefile#L10-L12), [Makefile:300-325](repo://Makefile#L300-L325)

The loader starts with defaults, applies TOML, applies environment variables and finalizes the configuration. If a setting appears different from the file you edited, inspect matching environment variables such as `LLM_MODEL` or `LLM_BASE_URL`: environment values are loaded after the file. [[Configuration]] describes named groups, value conversion and the separate browser settings path.

Sources: [openhands/core/config/utils.py:65-95](repo://openhands/core/config/utils.py#L65-L95), [openhands/core/config/utils.py:127-135](repo://openhands/core/config/utils.py#L127-L135), [openhands/core/config/utils.py:819-831](repo://openhands/core/config/utils.py#L819-L831)

## Start the browser application

Start both development servers:

Sources: [Development.md:81-89](repo://Development.md#L81-L89)

```bash
make run
```

Sources: [Development.md:81-89](repo://Development.md#L81-L89)

Open `http://localhost:3001`. The backend defaults to port 3000 and the frontend to 3001. The run target starts the backend, waits for its port with `nc`, then starts the frontend with the backend address supplied through `VITE_BACKEND_HOST`. It rejects native Windows execution and directs users to WSL. The development frontend selects its WSL script by examining `/proc/version`.

Sources: [Development.md:119-120](repo://Development.md#L119-L120), [Makefile:5-9](repo://Makefile#L5-L9), [Makefile:253-283](repo://Makefile#L253-L283)

Choose the LLM provider and API key when the application requests them, then begin a conversation. [[Conversations and Web Interface]] traces how the browser joins a conversation and receives events; [[Runtime and Workspace]] explains where the resulting commands and file operations execute. A browser reconnect supplies its last event ID so the server can replay subsequent stored events before joining the live session.

Sources: [README.md:118-126](repo://README.md#L118-L126), [openhands/server/listen_socket.py:39-48](repo://openhands/server/listen_socket.py#L39-L48), [openhands/server/listen_socket.py:78-129](repo://openhands/server/listen_socket.py#L78-L129), [openhands/runtime/base.py:361-399](repo://openhands/runtime/base.py#L361-L399)

## Run a headless task

The checked-in headless guide gives this first task command:

Sources: [docs/usage/how-to/headless-mode.mdx:9-16](repo://docs/usage/how-to/headless-mode.mdx#L9-L16)

```bash
poetry run python -m openhands.core.main -t "write a bash script that prints hi"
```

Sources: [docs/usage/how-to/headless-mode.mdx:9-16](repo://docs/usage/how-to/headless-mode.mdx#L9-L16)

The module loads configuration, reads the task and wraps it in a `MessageAction` before calling `run_controller`. Use `-f` for a task file; its parser documents that a file overrides `-t`. Headless options include `--max-iterations`, `--max-budget-per-task`, `--selected-repo`, a named LLM configuration and `--no-auto-continue`. Without that last flag, the entry point uses its automatic continuation function when the agent requests user input.

Sources: [openhands/core/main.py:286-320](repo://openhands/core/main.py#L286-L320), [openhands/core/config/arg_utils.py:23-54](repo://openhands/core/config/arg_utils.py#L23-L54), [openhands/core/config/arg_utils.py:117-142](repo://openhands/core/config/arg_utils.py#L117-L142)

## Use the packaged launcher

The README also provides a packaged GUI command for running OpenHands without the source build:

Sources: [README.md:67-87](repo://README.md#L67-L87)

```bash
uvx --python 3.12 --from openhands-ai openhands serve
```

Sources: [README.md:67-87](repo://README.md#L67-L87)

That GUI is documented at `http://localhost:3000`. Running the same launcher without `serve` selects the terminal CLI; the entry point injects `cli` when no recognized subcommand is present. Keep the launcher path distinct from the source workflow when diagnosing which application and port you started. The README describes local OpenHands as intended for a single user on their workstation; the repository's development setup follows that local execution model.

Sources: [README.md:79-87](repo://README.md#L79-L87), [README.md:128-139](repo://README.md#L128-L139), [openhands/cli/entry.py:23-45](repo://openhands/cli/entry.py#L23-L45)
