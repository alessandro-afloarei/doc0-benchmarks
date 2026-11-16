---
title: "Quickstart"
---
## Overview

OpenHands can be run four ways: the `openhands` command in a terminal, the web app started by `openhands serve`, the web app from a Docker command, or a development checkout started with `make`. Every way needs a language model and an API key; the web app asks for them on first launch, and the other ways read them from `config.toml` or environment variables ([[Configuration]]).

Sources: [README.md:62-110](repo://README.md#L62-L110), [Development.md:60-76](repo://Development.md#L60-L76)

> [!WARNING]
> The project's README says OpenHands is meant for one user on their own workstation: it has no built-in authentication, isolation or scaling for shared instances. The multi-user deployment is the [[Enterprise Server]].

Sources: [README.md:114-119](repo://README.md#L114-L119)

## Run the installed command

The package installs one console script, `openhands`, bound to `openhands.cli.entry:main`. The README recommends launching it through `uv` so it runs isolated from your project's virtual environment; the README also says `uv` is required for OpenHands' default MCP servers.

Sources: [pyproject.toml:170-171](repo://pyproject.toml#L170-L171), [README.md:56-60](repo://README.md#L56-L60)

```bash
# Launch the GUI server
uvx --python 3.12 --from openhands-ai openhands serve

# Or launch the CLI
uvx --python 3.12 --from openhands-ai openhands
```

Sources: [README.md:62-76](repo://README.md#L62-L76)

`main` answers `--help` and `--version` on a fast path before importing anything heavy. It then treats any first argument other than `cli` or `serve` as CLI arguments by inserting `cli` in front, so `openhands -t "fix the tests"` is the same as `openhands cli -t "fix the tests"`. `serve` calls `launch_gui_server` and `cli` calls `run_cli_command`, described in [[Command-Line Interface]].

Sources: [openhands/cli/entry.py:12-48](repo://openhands/cli/entry.py#L12-L48)

| Command | Arguments |
| --- | --- |
| `openhands serve` | `--mount-cwd` mounts the current directory as `/workspace`; `--gpu` passes all GPUs to the container |
| `openhands cli` | `--config-file` (default `config.toml`), `-t/--task`, `-f/--file`, `-n/--name`, `--log-level`, `-l/--llm-config`, `--agent-config`, `--override-cli-mode`, `-v/--version` |
| `openhands` (top level) | `--conversation` resumes a conversation by id |

Sources: [openhands/core/config/arg_utils.py:15-64](repo://openhands/core/config/arg_utils.py#L15-L64), [openhands/core/config/arg_utils.py:145-207](repo://openhands/core/config/arg_utils.py#L145-L207)

## Run the web app with Docker

`openhands serve` is a wrapper around Docker. It checks that `docker` is on the path and that `docker info` succeeds, creates `~/.openhands`, pulls the runtime image tagged with the installed version, and runs the app image with the Docker socket mounted, `~/.openhands` mounted at `/.openhands`, and port 3000 published. The app container starts sandbox containers next to itself through the mounted socket, which is why the socket mount is required.

Sources: [openhands/cli/gui_launcher.py:28-73](repo://openhands/cli/gui_launcher.py#L28-L73), [openhands/cli/gui_launcher.py:93-147](repo://openhands/cli/gui_launcher.py#L93-L147), [openhands/cli/gui_launcher.py:191-206](repo://openhands/cli/gui_launcher.py#L191-L206)

With `--mount-cwd` it sets `SANDBOX_VOLUMES=<cwd>:/workspace:rw` and, on Unix, `SANDBOX_USER_ID` to your user id so files the agent writes belong to you. With `--gpu` it adds `--gpus all` and `SANDBOX_ENABLE_GPU=true`.

Sources: [openhands/cli/gui_launcher.py:149-189](repo://openhands/cli/gui_launcher.py#L149-L189)

The same container can be started by hand, without the launcher.

Sources: [README.md:77-80](repo://README.md#L77-L80)

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

Open `http://localhost:3000`, choose an LLM provider and enter its API key. Conversations, settings and secrets are kept under `~/.openhands` ([[Storage]]).

Sources: [README.md:103-110](repo://README.md#L103-L110), [openhands/cli/gui_launcher.py:69-73](repo://openhands/cli/gui_launcher.py#L69-L73)

## Run from a source checkout

Development needs Linux, macOS or WSL, Docker, Python 3.12, Node.js 22 or later and Poetry 1.8 or later.

Sources: [Development.md:11-22](repo://Development.md#L11-L22)

1. Run `make build` to check dependencies and install the Python and frontend packages.
2. Run `make setup-config` to write `config.toml`; it prompts for the workspace directory, model and API key.
3. Run `make run` to start the backend on `127.0.0.1:3000` and the frontend on `127.0.0.1:3001`, or start them separately with `make start-backend` and `make start-frontend`.

Sources: [Makefile:5-11](repo://Makefile#L5-L11), [Makefile:25-28](repo://Makefile#L25-L28), [Makefile:249-282](repo://Makefile#L249-L282), [Makefile:301-310](repo://Makefile#L301-L310)

`make start-backend` runs `uvicorn openhands.server.listen:app` with reload enabled, which is the FastAPI app described in [[Server Application]]. Settings resolve in priority order: environment variables, then `config.toml`, then defaults.

Sources: [Makefile:249-251](repo://Makefile#L249-L251), [Development.md:74-76](repo://Development.md#L74-L76)

To let OpenHands work on its own source without Docker, set `RUNTIME=local` before building and running; the `local` runtime runs the sandbox server as a local process ([[Runtime Implementations]]). Setting `SANDBOX_RUNTIME_CONTAINER_IMAGE` to a published runtime image skips building the sandbox image ([[Runtime Images]]).

Sources: [Development.md:106-127](repo://Development.md#L106-L127), [Development.md:157-162](repo://Development.md#L157-L162)

## Run one task headless

`python -m openhands.core.main` runs a single task without any interface and exits when the agent finishes. It uses the headless parser, which adds `-d/--directory`, `-c/--agent-cls`, `-i/--max-iterations`, `-b/--max-budget-per-task`, `--no-auto-continue` and `--selected-repo` to the common arguments.

Sources: [openhands/core/config/utils.py:784-792](repo://openhands/core/config/utils.py#L784-L792), [openhands/core/config/arg_utils.py:102-142](repo://openhands/core/config/arg_utils.py#L102-L142)

```bash
poetry run python -m openhands.core.main -t "write a bash script that prints hi"

# Work on a repository; a provider token is required
export GITHUB_TOKEN="your-token"
poetry run python -m openhands.core.main \
  --selected-repo "owner/repo-name" \
  -t "analyze the codebase and suggest improvements"
```

Sources: [docs/usage/how-to/headless-mode.mdx:9-47](repo://docs/usage/how-to/headless-mode.mdx#L9-L47)

Without `--no-auto-continue`, each time the agent asks for input it receives a canned reply telling it to continue and to finish when done. [[Headless Mode]] follows the run from start to saved trajectory.

Sources: [openhands/core/main.py:247-260](repo://openhands/core/main.py#L247-L260), [openhands/core/main.py:311-320](repo://openhands/core/main.py#L311-L320)

## Debug model calls

Exporting `DEBUG=1` before starting the backend logs every prompt and response under `logs/llm/<date>`.

Sources: [Development.md:129-132](repo://Development.md#L129-L132)
