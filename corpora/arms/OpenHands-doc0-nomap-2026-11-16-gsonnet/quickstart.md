---
title: "Quickstart"
---
## Overview

This repository has three ways to start an agent: the `openhands` command (an interactive terminal app, or a launcher for the web app), the headless task runner `openhands.core.main`, and the web server `openhands.server.listen:app`. All of them load the same configuration and build the same controller, runtime and memory objects described in [[Overview]].

Sources: [pyproject.toml:170-171](repo://pyproject.toml#L170-L171), [openhands/core/main.py:286-320](repo://openhands/core/main.py#L286-L320), [openhands/server/listen.py:27](repo://openhands/server/listen.py#L27)

## Configure a model

A run needs an LLM. `config.template.toml` documents every option; the `[llm]` section holds the `model` (the template sets `gpt-4o`; `LLMConfig` itself defaults to `claude-sonnet-4-20250514`) and `api_key`, and `[core]` selects the runtime (default `"docker"`). A `config.toml` in the working directory is read first and environment variables override it; see [[Configuration System]].

Sources: [config.template.toml:71](repo://config.template.toml#L71), [openhands/core/config/utils.py:819-836](repo://openhands/core/config/utils.py#L819-L836)

```toml
[llm]
model = "gpt-4o"
api_key = "..."
```

Sources: [config.template.toml:100-141](repo://config.template.toml#L100-L141)

## Run it

### The openhands command

`openhands` is the Poetry script `openhands.cli.entry:main`. With no subcommand it inserts `cli`, so you get the terminal app; `serve` starts the web app instead. The help and version paths are answered before the heavy imports load. See [[Command-Line Interface]].

```bash
openhands          # terminal app
openhands serve    # web app, http://localhost:3000
```

Sources: [openhands/cli/entry.py:11-47](repo://openhands/cli/entry.py#L11-L47)

`serve` checks that Docker is available, pulls the runtime and app images for the installed version, and starts the app container on port 3000. With `--mount-cwd` it mounts the current directory as `/workspace`.

Sources: [openhands/cli/entry.py:11-47](repo://openhands/cli/entry.py#L11-L47), [openhands/cli/gui_launcher.py:28-50](repo://openhands/cli/gui_launcher.py#L28-L50), [openhands/cli/gui_launcher.py:95-127](repo://openhands/cli/gui_launcher.py#L95-L127), [openhands/cli/gui_launcher.py:165-173](repo://openhands/cli/gui_launcher.py#L165-L173)

### Headless task

The module `openhands.core.main` takes a task with `-t` (or `-f` for a file), an optional session name with `-n` and an LLM group with `-l`. It refuses to start without a task unless a trajectory replay is configured.

Sources: [openhands/core/config/arg_utils.py:15-61](repo://openhands/core/config/arg_utils.py#L15-L61), [openhands/core/main.py:286-320](repo://openhands/core/main.py#L286-L320)

```bash
python -m openhands.core.main -t "Write a hello world script"
```

Sources: [openhands/core/main.py:286-320](repo://openhands/core/main.py#L286-L320)

### From a source checkout

`make start-backend` runs `uvicorn openhands.server.listen:app` on `BACKEND_PORT` (3000) and `make start-frontend` runs the Vite dev server on `FRONTEND_PORT` (3001). `make run` starts both. The server can also be started with `python -m openhands.server`, which binds `0.0.0.0` on the port taken from the `port` environment variable, defaulting to 3000. See [[Web Server and Socket.IO Protocol]] and [[Web Frontend]].

Sources: [Makefile:248-283](repo://Makefile#L248-L283), [Makefile:6-9](repo://Makefile#L6-L9), [openhands/server/__main__.py:7-16](repo://openhands/server/__main__.py#L7-L16)

## What the first minute of a headless run does

`run_controller` works in this order.

1. It makes a session id with `generate_sid`, which hashes the session name with the JWT secret and cuts the result to 32 characters so Kubernetes resource names stay valid.
2. It creates the LLM registry and the agent from `default_agent`, which is `CodeActAgent` unless configured otherwise. See [[CodeAct Agent and the Agent Hub]].
3. It creates a runtime with `get_runtime_cls(config.runtime)`, connects it, and clones `sandbox.selected_repo` if one is set. See [[Runtime Implementations and Sandbox Image]].
4. It creates `Memory`, which loads microagents from the repository, and adds MCP tools to the agent when `enable_mcp` is on. See [[Microagents and Knowledge Recall]] and [[MCP Integration]].
5. It builds the `AgentController`, restoring a saved `State` for the session if one exists. See [[Agent Controller and Agent States]].
6. It adds the task as a `MessageAction` from the user, or a "get back on track" message if the restored state ended in an error.
7. It subscribes a callback that answers `AWAITING_USER_INPUT` with `read_input`, or with `auto_continue_response` unless `--no-auto-continue` was passed, then polls once a second until the state is `FINISHED`, `REJECTED`, `ERROR`, `PAUSED` or `STOPPED`.

Sources: [openhands/core/setup.py:246-270](repo://openhands/core/setup.py#L246-L270), [openhands/core/main.py:97-143](repo://openhands/core/main.py#L97-L143), [openhands/core/setup.py:35-89](repo://openhands/core/setup.py#L35-L89), [openhands/core/main.py:145-191](repo://openhands/core/main.py#L145-L191), [openhands/core/main.py:193-216](repo://openhands/core/main.py#L193-L216), [openhands/core/loop.py:44-45](repo://openhands/core/loop.py#L44-L45)

> [!NOTE]
> When `config.file_store` is not `memory`, the final `State` is saved so the same session id can be resumed, and `save_trajectory_path` writes the event history as JSON. See [[Storage and Persistence]].

Sources: [openhands/core/main.py:220-244](repo://openhands/core/main.py#L220-L244)
