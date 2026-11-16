---
title: "Quickstart"
---
## Overview

There are four ways to run OpenHands from this repository: the `openhands` command (interactive terminal), `openhands serve` (web GUI in Docker), a headless run through `python -m openhands.core.main`, and a development checkout driven by `make`. All of them end in the same wiring described in [[OpenHands Overview]]. This page shows the commands; options are in [[Configuration]].

Sources: [openhands/cli/entry.py:12-48](repo://openhands/cli/entry.py#L12-L48), [Makefile:249-285](repo://Makefile#L249-L285)

## Launch with uv

The README recommends the CLI launcher through `uv`, because it isolates OpenHands from the current project's virtual environment and is needed for the default MCP servers.

Sources: [README.md:55-58](repo://README.md#L55-L58)

```bash
# Launch the GUI server
uvx --python 3.12 --from openhands-ai openhands serve

# Or launch the CLI
uvx --python 3.12 --from openhands-ai openhands
```

Sources: [README.md:63-69](repo://README.md#L63-L69)

The GUI is then at `http://localhost:3000`.

Sources: [README.md:71-71](repo://README.md#L71-L71)

Sources: [README.md:55-71](repo://README.md#L55-L71)

`main` in `openhands/cli/entry.py` handles help and version first through a fast path. Any first argument that is not `cli` or `serve` makes it insert `cli` as the subcommand, so a bare `openhands` starts the interactive CLI ([[Command-Line Interface]]). `serve` calls `launch_gui_server` with the `--mount-cwd` and `--gpu` flags.

Sources: [openhands/cli/entry.py:12-48](repo://openhands/cli/entry.py#L12-L48)

## What `serve` runs

`launch_gui_server` requires Docker (`check_docker_requirements`), computes the image names from the installed version, pulls the runtime image, then runs the app image with the Docker socket mounted so the app can start sandbox containers.

Sources: [openhands/cli/gui_launcher.py:28-100](repo://openhands/cli/gui_launcher.py#L28-L100)

```python
runtime_image = f'docker.all-hands.dev/all-hands-ai/runtime:{version}-nikolaik'
app_image = f'docker.all-hands.dev/all-hands-ai/openhands:{version}'
```

Sources: [openhands/cli/gui_launcher.py:28-100](repo://openhands/cli/gui_launcher.py#L28-L100)

The resulting command is `docker run -it --rm --pull=always` with `SANDBOX_RUNTIME_CONTAINER_IMAGE` and `LOG_ALL_EVENTS=true` set, `/var/run/docker.sock` mounted, the config directory mounted at `/.openhands`, and port `3000:3000` published. `--gpu` inserts `--gpus all`; `--mount-cwd` also mounts the current directory and sets `SANDBOX_USER_ID`.

Sources: [openhands/cli/gui_launcher.py:133-206](repo://openhands/cli/gui_launcher.py#L133-L206)

The README gives the same command for running Docker by hand.

Sources: [README.md:74-94](repo://README.md#L74-L94)

> [!WARNING]
> The README points to a hardened Docker installation guide for deployments on a public network.

Sources: [README.md:99-101](repo://README.md#L99-L101)

## First use

On first open the application asks for an LLM provider and API key; the README names `anthropic/claude-sonnet-4-20250514` as the model that works best.

Sources: [README.md:103-107](repo://README.md#L103-L107)

## Run headless

`openhands/core/main.py` is runnable directly. It parses arguments, reads the task from `-t` or `-f`, builds a `MessageAction`, derives a session id with `generate_sid` and runs `run_controller`. With no task, and no replay file, it raises `No task provided`.

Sources: [openhands/core/main.py:286-320](repo://openhands/core/main.py#L286-L320)

```bash
python -m openhands.core.main -t "write a bash script that prints hello"
```

Sources: [openhands/core/main.py:286-320](repo://openhands/core/main.py#L286-L320)

Headless mode answers the agent's questions itself: unless `--no-auto-continue` is given, `auto_continue_response` tells the agent to carry on, finish, and never ask for a human.

Sources: [openhands/core/main.py:247-260](repo://openhands/core/main.py#L247-L260), [openhands/core/main.py:314-320](repo://openhands/core/main.py#L314-L320)

| Flag | Meaning |
| --- | --- |
| `-t`, `-f` | Task text, or a file holding it (the file wins) |
| `-n` | Session name, hashed into the session id |
| `-d` | Working directory for the agent |
| `-c` | Name of the default agent |
| `-i` | Maximum iterations |
| `-b` | Maximum budget per task |
| `-l`, `--agent-config` | Pick a named `[llm.X]` or `[agent.X]` section of the config file |
| `--selected-repo` | Repository to clone, as `owner/repo` |
| `--config-file` | Config file, default `config.toml` in the current directory |

Sources: [openhands/core/config/arg_utils.py:15-65](repo://openhands/core/config/arg_utils.py#L15-L65), [openhands/core/config/arg_utils.py:102-142](repo://openhands/core/config/arg_utils.py#L102-L142)

## Develop from a checkout

`Development.md` lists three steps: `make build` to install dependencies, `make setup-config` to enter the LLM key and model (the model entered applies only when running headless; in the UI it is set in the UI), and `make run`.

Sources: [Development.md:51-91](repo://Development.md#L51-L91)

```bash
make build
make setup-config
make run
```

Sources: [Development.md:51-91](repo://Development.md#L51-L91)

`make run` starts the backend (`uvicorn openhands.server.listen:app`, see [[Server, Conversations and Sessions]]) in the background, waits for the backend port with `nc -z`, then starts the Vite dev server for the [[Web Frontend]]. `make start-backend` runs the backend alone with `--reload`; `make start-frontend` runs the frontend alone. Windows is refused: the Makefile says to use WSL.

Sources: [Makefile:249-285](repo://Makefile#L249-L285)

Settings are layered; from highest to lowest priority these are environment variables, then `config.toml`, then defaults.

Sources: [Development.md:69-72](repo://Development.md#L69-L72)
