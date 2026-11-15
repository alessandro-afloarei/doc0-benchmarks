---
title: "Quickstart"
---
## Overview

OpenHands runs in four ways from the same Python package: the web application started with `openhands serve` or a Docker image, the terminal client started with `openhands`, a development setup driven by `make`, and a headless one-shot run with `python -m openhands.core.main`. Every way needs a model name and an API key for a LiteLLM-supported provider; every way except the CLI's local runtime also needs Docker, because the agent's commands run in a sandbox container.

Sources: [README.md:63-72](repo://README.md#L63-L72), [README.md:103-107](repo://README.md#L103-L107)

This page gets each mode running. [[Configuration]] explains the settings in `config.toml`, and [[Runtime Implementations]] explains how to pick a sandbox other than Docker.

Sources: [openhands/core/main.py:97-143](repo://openhands/core/main.py#L97-L143)

## Run the packaged application

### With uv

The `openhands-ai` package installs one console script, `openhands`, bound to `openhands.cli.entry:main`. The project's README launches it through `uvx`, which keeps it isolated from the current virtual environment:

Sources: [pyproject.toml:170-171](repo://pyproject.toml#L170-L171)

```bash
# Launch the GUI server
uvx --python 3.12 --from openhands-ai openhands serve

# Or launch the CLI
uvx --python 3.12 --from openhands-ai openhands
```

Sources: [README.md:63-72](repo://README.md#L63-L72), [pyproject.toml:170-171](repo://pyproject.toml#L170-L171)

`main` answers `--help` and `--version` without importing the heavy modules, injects `cli` as the command when none of `cli` or `serve` is given, and then either launches the GUI server in Docker (`serve`, with `--mount-cwd` to mount the current directory and `--gpu` to pass GPUs through) or starts the interactive terminal client. The GUI answers at `http://localhost:3000`. The [[CLI]] page follows both commands.

Sources: [openhands/cli/entry.py:12-48](repo://openhands/cli/entry.py#L12-L48), [openhands/core/config/arg_utils.py:171-186](repo://openhands/core/config/arg_utils.py#L171-L186)

### With Docker

The app image needs the Docker socket so it can start sandbox containers next to itself, the `~/.openhands` folder for settings and conversation history, and the runtime image to use for sandboxes:

Sources: [README.md:79-80](repo://README.md#L79-L80)

```bash
docker pull docker.all-hands.dev/all-hands-ai/runtime:0.56-nikolaik

docker run -it --rm --pull=always \
    -e SANDBOX_RUNTIME_CONTAINER_IMAGE=docker.all-hands.dev/all-hands-ai/runtime:0.56-nikolaik \
    -e LOG_ALL_EVENTS=true \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v ~/.openhands:/.openhands \
    -p 3000:3000 \
    --add-host host.docker.internal:host-gateway \
    --name openhands-app \
    docker.all-hands.dev/all-hands-ai/openhands:0.56
```

Sources: [README.md:81-93](repo://README.md#L81-L93)

`docker-compose.yml` builds the same app image from `containers/app/Dockerfile` and additionally mounts `WORKSPACE_BASE` (default `./workspace`) at `/opt/workspace_base`, so the agent works on a host folder.

Sources: [docker-compose.yml:2-23](repo://docker-compose.yml#L2-L23)

When the application opens, it asks for an LLM provider and an API key; these are stored as user settings (see [[Settings, Secrets and User Auth]]).

Sources: [README.md:103-107](repo://README.md#L103-L107)

> [!WARNING]
> OpenHands is meant for a single user on their own workstation. The OSS server has no built-in authentication, isolation or scaling for several users.

Sources: [README.md:114-119](repo://README.md#L114-L119)

## Set up a development environment

### Requirements

Development needs Linux, macOS or WSL, Docker, Python 3.12, Node.js 22 or later and Poetry. `make build` checks each of them before it installs anything: `check-python` looks for `python3.12`, and `check-nodejs` fails on a Node major version below 22.

Sources: [Development.md:11-22](repo://Development.md#L11-L22), [Makefile:34-45](repo://Makefile#L34-L45), [Makefile:64-96](repo://Makefile#L64-L96)

### Build and configure

1. Run `make build`. It checks dependencies, installs Python packages with Poetry and the frontend's npm packages, installs pre-commit hooks and builds the frontend.
2. Run `make setup-config`. It asks for a workspace directory, a model name (default `gpt-4o`), an API key and an optional base URL, and writes them to `config.toml` under `[core]` and `[llm]`. The model in this file applies to headless runs; the UI keeps its own setting.

Sources: [Makefile:25-32](repo://Makefile#L25-L32), [Makefile:301-325](repo://Makefile#L301-L325), [Makefile:10-11](repo://Makefile#L10-L11), [Development.md:60-76](repo://Development.md#L60-L76)

### Start the servers

`make run` starts the backend with `uvicorn openhands.server.listen:app` on port 3000, waits for the port to open, then starts the Vite frontend on port 3001 pointing at the backend. `make start-backend` and `make start-frontend` start each one alone; the backend version runs uvicorn with `--reload`.

Sources: [Makefile:4-9](repo://Makefile#L4-L9), [Makefile:249-283](repo://Makefile#L249-L283)

```bash
make build
make setup-config
make run          # backend on :3000, frontend on :3001
```

Sources: [Development.md:56-89](repo://Development.md#L56-L89)

To work on OpenHands from inside an OpenHands sandbox, the guide sets `INSTALL_DOCKER=0` and `RUNTIME=local` before `make build && make run`, which runs actions directly on the host instead of in a nested container. Setting `DEBUG=1` logs every prompt and response under `logs/llm/`.

Sources: [Development.md:106-132](repo://Development.md#L106-L132)

## Run a headless task

`openhands.core.main` runs one task to completion without any UI. It reads the task from `-t` or a file given with `-f`, and accepts the agent class (`-c`), the iteration limit (`-i`), the budget (`-b`), a named LLM section (`-l`), a repository to clone (`--selected-repo`) and `--no-auto-continue`:

Sources: [openhands/core/config/arg_utils.py:102-142](repo://openhands/core/config/arg_utils.py#L102-L142)

```bash
poetry run python -m openhands.core.main \
  -t "write a bash script that prints hello" \
  -c CodeActAgent -i 30
```

Sources: [openhands/core/config/arg_utils.py:15-61](repo://openhands/core/config/arg_utils.py#L15-L61), [openhands/core/main.py:286-320](repo://openhands/core/main.py#L286-L320)

Without `--no-auto-continue`, the agent receives an automatic "please continue" reply whenever it waits for the user, so the run ends only when the agent finishes or hits a limit. [[Headless Mode]] follows this run step by step.

Sources: [openhands/core/main.py:247-260](repo://openhands/core/main.py#L247-L260)

## Run the tests

Unit tests run with pytest through Poetry:

Sources: [Development.md:146-150](repo://Development.md#L146-L150)

```bash
poetry run pytest ./tests/unit/test_*.py
```

Sources: [Development.md:142-150](repo://Development.md#L142-L150)
