---
title: "Quickstart"
---
## Overview

OpenHands has three ways to start from this repository: the source tree through `make`, the Docker image through `openhands serve` or `docker compose`, and the terminal program `openhands`. The first runs the backend and the React frontend side by side on your machine. The other two run the server inside a container, or run the agent in the terminal without the web interface.

Sources: [Makefile:266-279](repo://Makefile#L266-L279), [openhands/cli/entry.py:24-45](repo://openhands/cli/entry.py#L24-L45)

## Run from source

Run `make build` once. It checks the system dependencies, installs the Python and frontend packages, installs the pre-commit hooks, and builds the frontend.

Sources: [Makefile:25-32](repo://Makefile#L25-L32)

Then run `make run`. It starts the backend with uvicorn on `BACKEND_PORT`, which defaults to 3000, and waits until that port accepts connections. It then starts the frontend dev server on `FRONTEND_PORT`, which defaults to 3001, and points it at the backend.

Sources: [Makefile:5-9](repo://Makefile#L5-L9), [Makefile:266-279](repo://Makefile#L266-L279), [Makefile:251](repo://Makefile#L251)

The `_run_setup` target refuses to run on Windows and tells you to use WSL. It also creates a `logs` directory before starting the backend.

Sources: [Makefile:266-273](repo://Makefile#L266-L273)

## Run the server in Docker

`docker compose up` builds `containers/app/Dockerfile` and maps port 3000. It mounts the Docker socket, so the server can start sandbox containers, and it mounts `~/.openhands` and the workspace folder. `make docker-run` sets `WORKSPACE_BASE`, the sandbox user id and a timestamp, then calls `docker compose up`. It does nothing when it runs inside a container.

Sources: [docker-compose.yml:1-23](repo://docker-compose.yml#L1-L23), [Makefile:286-299](repo://Makefile#L286-L299)

The `openhands serve` subcommand does the same without compose. It checks that Docker is available, pulls the runtime image and the application image for the installed version, and runs the app container with port 3000 published. It prints `http://localhost:3000` when the container is up.

Sources: [openhands/cli/gui_launcher.py:76-127](repo://openhands/cli/gui_launcher.py#L76-L127), [openhands/cli/gui_launcher.py:191-196](repo://openhands/cli/gui_launcher.py#L191-L196)

## Run the terminal program

The `openhands` script maps to `openhands.cli.entry:main`. With no arguments, or with any argument other than `cli` or `serve`, the entry point inserts `cli` as the subcommand. `serve` starts the Docker launcher, and `cli` runs the terminal session.

Sources: [pyproject.toml:170-171](repo://pyproject.toml#L170-L171), [openhands/cli/entry.py:24-45](repo://openhands/cli/entry.py#L24-L45)

> [!NOTE]
> The README starts the same entry points without a checkout, with `uvx --python 3.12 --from openhands-ai openhands`. The terminal flow itself is described in [[Command-Line Interface]].

Sources: [README.md:66-69](repo://README.md#L66-L69)

## Choose an entry point

| Goal | Command | Process started |
| --- | --- | --- |
| Develop the backend or frontend | `make run` | uvicorn on 3000, frontend dev server on 3001 |
| Use the web interface in a container | `openhands serve` or `make docker-run` | app container on 3000 |
| Run an agent in the terminal | `openhands` or `openhands cli` | a terminal session, see [[Command-Line Interface]] |

Sources: [Makefile:251-279](repo://Makefile#L251-L279), [openhands/cli/entry.py:36-45](repo://openhands/cli/entry.py#L36-L45)

The server behind the first two rows is described in [[Conversation Lifecycle]]. The frontend that connects to it is described in [[Web Frontend]].

Sources: [openhands/server/listen.py:12-27](repo://openhands/server/listen.py#L12-L27)
