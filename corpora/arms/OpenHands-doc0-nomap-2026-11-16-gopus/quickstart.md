---
title: "Quickstart"
---
## Overview

OpenHands runs four ways on your own machine: the `openhands` command (a terminal app, or `openhands serve` for the web GUI in Docker), the published Docker image, a development checkout started with `make`, and a headless script that runs one task and exits. All four start the same agent loop described in [[OpenHands Overview]]; they differ only in what drives it.

Sources: [README.md:48-128](repo://README.md#L48-L128)

> [!WARNING]
> OpenHands is meant to be run by a single user on their local workstation. The README states it has no built-in authentication, isolation or scalability for multi-tenant deployments.

Sources: [README.md:114-119](repo://README.md#L114-L119)

## Run the CLI launcher

The README recommends launching through `uv`, which isolates OpenHands from your project's virtual environment and is required for OpenHands' default MCP servers.

Sources: [README.md:52-62](repo://README.md#L52-L62)

```bash
# Launch the GUI server
uvx --python 3.12 --from openhands-ai openhands serve

# Or launch the CLI
uvx --python 3.12 --from openhands-ai openhands
```

Sources: [README.md:52-72](repo://README.md#L52-L72)

The `openhands` script is `openhands.cli.entry:main`. It answers `--help` and `--version` on a fast path before importing anything heavy, and treats any first argument other than `cli` or `serve` as a `cli` invocation, so `openhands -t "..."` and `openhands cli -t "..."` are the same. `serve` calls `launch_gui_server` with `--mount-cwd` (mount the current directory into the GUI container) and `--gpu`; `cli` calls `run_cli_command`, which [[Command-Line Interface]] follows from there.

Sources: [pyproject.toml:170-171](repo://pyproject.toml#L170-L171), [openhands/cli/entry.py:12-48](repo://openhands/cli/entry.py#L12-L48), [openhands/core/config/arg_utils.py:145-208](repo://openhands/core/config/arg_utils.py#L145-L208)

The GUI listens on `http://localhost:3000`. When it opens, it asks you to choose an LLM provider and enter an API key.

Sources: [README.md:74-107](repo://README.md#L74-L107)

## Run the Docker image

The app image needs the Docker socket so it can start a separate runtime container for each conversation, and `~/.openhands` so conversations and settings survive restarts. `SANDBOX_RUNTIME_CONTAINER_IMAGE` names the runtime image to start.

Sources: [README.md:84-92](repo://README.md#L84-L92)

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

Sources: [README.md:76-97](repo://README.md#L76-L97)

The runtime image tag in `SANDBOX_RUNTIME_CONTAINER_IMAGE` must match one the app can pull; how that image is built and tagged is in [[Runtime Images]], and how the app starts and reaches the container is in [[Runtime Implementations]].

Sources: [Development.md:157-162](repo://Development.md#L157-L162)

## Run from a checkout

Development needs Linux, macOS or WSL, Docker, Python 3.12, Node.js 22 or later and Poetry 1.8 or later. The steps:

Sources: [Development.md:11-22](repo://Development.md#L11-L22)

1. Build: `make build` checks the dependencies, installs the Python and frontend packages, installs pre-commit hooks and builds the frontend.
2. Configure: `make setup-config` writes a `config.toml` with a `[core]` workspace and an `[llm]` model and key. The model applies only to headless runs; in the UI you set it in settings.
3. Run: `make run` starts the backend with `uvicorn openhands.server.listen:app` on port 3000, waits for it, then starts the Vite frontend on port 3001. `make start-backend` and `make start-frontend` start each alone.

Sources: [Development.md:11-104](repo://Development.md#L11-L104), [Makefile:1-33](repo://Makefile#L1-L33), [Makefile:249-283](repo://Makefile#L249-L283), [Makefile:301-332](repo://Makefile#L301-L332)

Settings are applied from highest to lowest priority: environment variables, then `config.toml`, then defaults; [[Configuration]] explains how they are merged. To skip rebuilding the runtime image when you have not changed it, set `SANDBOX_RUNTIME_CONTAINER_IMAGE` to an existing image. `make docker-run` runs the whole app through `docker compose` without installing the toolchain on the host.

Sources: [Development.md:74-77](repo://Development.md#L74-L77), [Development.md:157-187](repo://Development.md#L157-L187), [Makefile:286-297](repo://Makefile#L286-L297)

## Run one task headless

`python -m openhands.core.main` parses the headless argument set, reads the task from `-t`, `-f` or standard input, and runs `run_controller` until the agent stops. With no task and no replay trajectory it refuses to start.

Sources: [openhands/core/main.py:286-320](repo://openhands/core/main.py#L286-L320), [openhands/core/config/utils.py:784-792](repo://openhands/core/config/utils.py#L784-L792)

```bash
poetry run python -m openhands.core.main -t "Write a hello world program in hello.py"
```

Sources: [openhands/core/main.py:301-305](repo://openhands/core/main.py#L301-L305), [openhands/core/config/arg_utils.py:23-29](repo://openhands/core/config/arg_utils.py#L23-L29)

| Flag | What it does |
| --- | --- |
| `-t`, `--task` | The task text |
| `-f`, `--file` | A file holding the task; overrides `-t` |
| `-n`, `--name` | Session name, hashed into the session id |
| `--config-file` | Config path, default `config.toml` |
| `-l`, `--llm-config` | Use the `[llm.<name>]` section instead of `[llm]` |
| `--agent-config` | Use the `[agent.<name>]` section instead of `[agent]` |
| `-c`, `--agent-cls` | Agent class to run |
| `-i`, `--max-iterations` | Iteration limit |
| `-b`, `--max-budget-per-task` | Spending limit in dollars |
| `--selected-repo` | `owner/repo` to clone into the workspace |
| `--no-auto-continue` | Read replies from stdin instead of auto-continuing |

Sources: [openhands/core/config/arg_utils.py:15-64](repo://openhands/core/config/arg_utils.py#L15-L64), [openhands/core/config/arg_utils.py:102-143](repo://openhands/core/config/arg_utils.py#L102-L143)

By default, when the agent asks for input, headless mode answers with `auto_continue_response`: a message telling it to continue, finish when done, and never ask for a human response. `--no-auto-continue` switches to reading your reply from the terminal. A `GITHUB_TOKEN`, `GITLAB_TOKEN` or `BITBUCKET_TOKEN` in the environment is picked up to clone `--selected-repo`.

Sources: [openhands/core/main.py:247-260](repo://openhands/core/main.py#L247-L260), [openhands/core/main.py:193-205](repo://openhands/core/main.py#L193-L205), [openhands/core/setup.py:96-121](repo://openhands/core/setup.py#L96-L121)

## Debug the model calls

Exporting `DEBUG=1` and restarting the backend logs every prompt and response under `logs/llm/<date>`, which [[LLM Layer]] explains. Unit tests run with `poetry run pytest ./tests/unit/test_*.py`.

Sources: [Development.md:129-150](repo://Development.md#L129-L150)
