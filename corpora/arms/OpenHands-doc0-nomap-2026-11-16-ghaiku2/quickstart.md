---
title: "Quickstart"
---
## Overview

Running OpenHands locally means three processes: the Python backend (a FastAPI app served by uvicorn), the React frontend (served from a build or by a dev server), and the sandbox runtime the agent uses, which is a Docker container by default. The Makefile wraps the steps; this page lists them in the order they depend on each other. For the settings the backend reads, see [[Configuration]]; for what happens once a request reaches the server, see [[Server Application]].

Sources: [Development.md:9-24](repo://Development.md#L9-L24), [Makefile:249-252](repo://Makefile#L249-L252)

## Requirements

The development guide asks for Linux, macOS or WSL, Docker, Python 3.12, Node.js 22 or later and Poetry 1.8 or later. The Docker requirement comes from the runtime: the default runtime starts the sandbox as a container.

Sources: [Development.md:11-22](repo://Development.md#L11-L22), [openhands/core/config/openhands_config.py:71-71](repo://openhands/core/config/openhands_config.py#L71-L71)

## Build and run

`make build` installs the Python and frontend dependencies. `make run` then starts the backend, waits until its port accepts connections, and starts the frontend dev server. Each part can also be started alone.

Sources: [Development.md:51-58](repo://Development.md#L51-L58), [Development.md:81-104](repo://Development.md#L81-L104), [Makefile:266-283](repo://Makefile#L266-L283)

```bash
make build
make run              # backend and frontend together
make start-backend    # uvicorn openhands.server.listen:app on BACKEND_PORT
make start-frontend   # Vite dev server in frontend/
```

Sources: [Makefile:249-252](repo://Makefile#L249-L252), [Makefile:279-283](repo://Makefile#L279-L283)

The backend entry point is `openhands.server.listen:app`. It wraps the FastAPI app in a socket.io application, so one ASGI server handles both HTTP routes and the socket channel. When `SERVE_FRONTEND` is `true`, it also mounts the built frontend from `./frontend/build` at the root path, which is how a production-style run serves the UI from the backend port.

Sources: [openhands/server/listen.py:15-26](repo://openhands/server/listen.py#L15-L26)

```python
base_app.mount(
    '/', SPAStaticFiles(directory='./frontend/build', html=True), name='dist'
)
app = socketio.ASGIApp(sio, other_asgi_app=base_app)
```

Sources: [openhands/server/listen.py:15-26](repo://openhands/server/listen.py#L15-L26)

> [!NOTE]
> `make start-backend` runs uvicorn with `--reload` and excludes `./workspace`, so edits to the Python code restart the server but agent workspaces do not.

Sources: [Makefile:251-251](repo://Makefile#L251-L251)

## Command-line use

The `openhands` console script is `openhands.cli.entry:main`. With no subcommand it runs the interactive session (`cli`), `serve` starts the GUI server, and `--version` and help are answered before the heavier imports load.

Sources: [pyproject.toml:170-171](repo://pyproject.toml#L170-L171), [openhands/cli/entry.py:12-45](repo://openhands/cli/entry.py#L12-L45)

```bash
openhands             # same as: openhands cli
openhands serve       # start the web GUI server
```

Sources: [openhands/cli/entry.py:12-45](repo://openhands/cli/entry.py#L12-L45)

## Configure the language model

The guide's third step configures the model. The backend reads `config.toml` from the working directory and then environment variables, so the template in the repository lists the keys with their defaults. Uncomment and change only the keys you need.

Sources: [config.template.toml:1-12](repo://config.template.toml#L1-L12), [openhands/core/config/utils.py:819-837](repo://openhands/core/config/utils.py#L819-L837)
