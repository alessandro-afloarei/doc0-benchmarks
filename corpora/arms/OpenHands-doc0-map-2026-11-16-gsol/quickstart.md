---
title: "Quickstart"
---
## Overview

Use the packaged launcher to try OpenHands, or build this checkout when you want to change its implementation. Both paths lead to a task handled by the agent, memory and runtime described in [[OpenHands Architecture]]. The GUI asks for model settings in the browser; a headless task reads configuration before it starts. Keep those setup paths distinct when checking which model a task actually uses.

Sources: [README.md:53-107](repo://README.md#L53-L107), [Development.md:60-76](repo://Development.md#L60-L76), [openhands/core/main.py:286-305](repo://openhands/core/main.py#L286-L305)

## Launch the packaged application

The README provides a `uvx` launcher using Python 3.12. Its GUI subcommand starts the Docker-based server launcher, while running without a subcommand enters the terminal client. Have Docker available for the GUI path: `serve` delegates to `launch_gui_server`, which runs the assembled Docker command and reports startup failure if that command fails.

Sources: [README.md:55-72](repo://README.md#L55-L72), [openhands/cli/entry.py:23-45](repo://openhands/cli/entry.py#L23-L45), [openhands/cli/gui_launcher.py:191-213](repo://openhands/cli/gui_launcher.py#L191-L213)

```bash
uvx --python 3.12 --from openhands-ai openhands serve
```

Sources: [README.md:63-70](repo://README.md#L63-L70)

Open `http://localhost:3000`. On first use, choose an LLM provider and supply its API key. A browser conversation has its own creation and connection lifecycle, explained in [[Conversation Lifecycle]]; the initial model selection belongs in the UI even if you also have a local `config.toml` for headless work.

Sources: [README.md:72-72](repo://README.md#L72-L72), [README.md:103-107](repo://README.md#L103-L107), [Development.md:70-76](repo://Development.md#L70-L76), [openhands/server/routes/manage_conversations.py:189-201](repo://openhands/server/routes/manage_conversations.py#L189-L201)

To make the launcher's current directory the sandbox workspace, add `--mount-cwd` to `serve`. The launcher translates this into `SANDBOX_VOLUMES` targeting `/workspace` with read/write mode. That mapping determines which files an agent can edit; [[Sandbox Execution]] explains mount processing and the distinction between the application container and the action runtime.

Sources: [openhands/core/config/arg_utils.py:171-180](repo://openhands/core/config/arg_utils.py#L171-L180), [openhands/cli/gui_launcher.py:165-189](repo://openhands/cli/gui_launcher.py#L165-L189)

For a terminal conversation, use the second launcher command. It reaches the interactive CLI rather than the headless module, and [[CLI and Headless Tasks]] describes its prompts, session state and commands.

Sources: [README.md:63-70](repo://README.md#L63-L70), [openhands/cli/entry.py:23-45](repo://openhands/cli/entry.py#L23-L45)

```bash
uvx --python 3.12 --from openhands-ai openhands
```

Sources: [README.md:68-69](repo://README.md#L68-L69)

## Build this checkout

The development guide calls for Linux, macOS or WSL, Docker, Python 3.12, Node.js 22 or newer, and Poetry. The package itself allows Python 3.12 through versions below 3.14, but the Makefile's development check explicitly looks for Python 3.12. `make build` checks dependencies, installs Python and frontend dependencies, installs pre-commit hooks, and builds the frontend. Use [[Development and Testing]] for the individual targets and validation workflow.

Sources: [Development.md:11-22](repo://Development.md#L11-L22), [pyproject.toml:27-29](repo://pyproject.toml#L27-L29), [Makefile:24-44](repo://Makefile#L24-L44), [Makefile:64-70](repo://Makefile#L64-L70)

```bash
make build
make setup-config
make run
```

Sources: [Development.md:51-89](repo://Development.md#L51-L89)

`make setup-config` prompts for model configuration. `make run` starts the backend and frontend, whose default ports are 3000 and 3001 respectively. Open the development frontend at `http://localhost:3001`. If a setting seems ignored, inspect your environment: its values take precedence over TOML values. [[Configuration]] explains loading order and named model groups in detail.

Sources: [Development.md:60-89](repo://Development.md#L60-L89), [Development.md:119-126](repo://Development.md#L119-L126), [Makefile:4-12](repo://Makefile#L4-L12)

## Run a headless task

From the configured checkout, invoke `openhands.core.main` with a task. The parser accepts `-t` for text, `-f` for a task file, `--config-file` for another TOML file, and `-i` for the iteration limit. A file takes precedence over task text. This example asks the runtime to report its workspace; it uses the configured model and runtime rather than starting a browser session.

Sources: [openhands/core/config/arg_utils.py:15-35](repo://openhands/core/config/arg_utils.py#L15-L35), [openhands/core/config/arg_utils.py:102-123](repo://openhands/core/config/arg_utils.py#L102-L123), [openhands/core/main.py:286-319](repo://openhands/core/main.py#L286-L319)

```bash
poetry run python -m openhands.core.main -t "Report the current working directory and list its files." -i 10
```

Sources: [openhands/core/main.py:286-319](repo://openhands/core/main.py#L286-L319), [openhands/core/config/arg_utils.py:23-29](repo://openhands/core/config/arg_utils.py#L23-L29), [openhands/core/config/arg_utils.py:117-123](repo://openhands/core/config/arg_utils.py#L117-L123)

The headless entry point rejects an empty task unless replay is configured. It creates an initial `MessageAction`, initializes the task components, and waits for a terminal controller state. If you want to answer subsequent agent questions through standard input, use `--no-auto-continue`; otherwise this entry point supplies automatic continuation responses. That option changes interaction behavior, so use [[CLI and Headless Tasks]] when embedding the runner in scripts.

Sources: [openhands/core/main.py:286-319](repo://openhands/core/main.py#L286-L319), [openhands/core/main.py:193-216](repo://openhands/core/main.py#L193-L216), [openhands/core/config/arg_utils.py:130-136](repo://openhands/core/config/arg_utils.py#L130-L136)

## Check the outcome

In the GUI, the conversation route connects a `WsClientProvider` and event handler; incoming actions and observations update the client. In headless mode, the runner can save a JSON trajectory when `save_trajectory_path` is configured. A directory uses the session ID as its filename. Inspect that history when you need the actual commands and observations rather than relying only on the final natural-language reply.

Sources: [frontend/src/routes/conversation.tsx:76-95](repo://frontend/src/routes/conversation.tsx#L76-L95), [frontend/src/context/ws-client-provider.tsx:164-205](repo://frontend/src/context/ws-client-provider.tsx#L164-L205), [openhands/core/main.py:232-242](repo://openhands/core/main.py#L232-L242)

If the runtime never becomes ready, follow its connection path in [[Sandbox Execution]]. Docker startup first tries attachment or container creation, then waits for the action server before reporting readiness. If a web conversation fails before that point, the create endpoint distinguishes missing settings from model authentication failure with separate message IDs; [[Conversation Lifecycle]] follows those responses.

Sources: [openhands/runtime/impl/docker/docker_runtime.py:170-214](repo://openhands/runtime/impl/docker/docker_runtime.py#L170-L214), [openhands/server/routes/manage_conversations.py:270-288](repo://openhands/server/routes/manage_conversations.py#L270-L288)
