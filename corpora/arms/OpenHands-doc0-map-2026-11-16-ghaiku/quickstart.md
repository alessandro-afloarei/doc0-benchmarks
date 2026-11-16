---
title: "Quickstart"
---
## Overview

A checkout of this repository runs in two ways: directly on the host with `make`, or inside Docker with `docker compose`. The host path installs Python dependencies with Poetry and frontend dependencies with npm, then starts a backend server and a frontend dev server. The Docker path builds one image and runs the backend on port 3000. Both paths read the same configuration, described in [[Configuration]].

Sources: [Development.md:51-57](repo://Development.md#L51-L57) [Makefile:25-32](repo://Makefile#L25-L32) [docker-compose.yml:3-14](repo://docker-compose.yml#L3-L14)

## Build the host environment

`make build` runs the dependency checks, installs the Python and frontend dependencies, installs the pre-commit hooks, and builds the frontend bundle. The steps run in that order, and make stops at the first one that fails.

Sources: [Makefile:25-32](repo://Makefile#L25-L32) [Makefile:244-247](repo://Makefile#L244-L247)

## Set the language model

`make setup-config` prompts for an API key and a model name and writes `config.toml`. The settings resolve in this order: environment variables, then `config.toml`, then the built-in defaults. The model name applies only to headless runs; the web UI takes its model from its own settings screen.

Sources: [Development.md:60-78](repo://Development.md#L60-L78) [Makefile:301-305](repo://Makefile#L301-L305)

## Run both servers

`make run` starts the backend, waits until its port accepts connections, then starts the frontend dev server. The backend listens on port 3000 and the frontend on port 3001 by default. The frontend reads the backend address from `VITE_BACKEND_HOST`, which defaults to `127.0.0.1:3000`.

Sources: [Makefile:5-9](repo://Makefile#L5-L9) [Makefile:266-284](repo://Makefile#L266-L284) [frontend/vite.config.ts:12-14](repo://frontend/vite.config.ts#L12-L14)

1. `make build`, once per checkout.
2. `make setup-config`, once per model choice.
3. `make run`, then open the frontend port in a browser.

Sources: [Makefile:5-9](repo://Makefile#L5-L9) [Makefile:266-284](repo://Makefile#L266-L284) [frontend/vite.config.ts:12-14](repo://frontend/vite.config.ts#L12-L14)

`make run` refuses to start on native Windows and asks for WSL instead.

Sources: [Makefile:266-272](repo://Makefile#L266-L272)

To start one server at a time, use `make start-backend` or `make start-frontend`. The backend runs uvicorn with `--reload` and excludes the `./workspace` folder from the reloader, so agent output in that folder does not restart the server.

Sources: [Makefile:249-251](repo://Makefile#L249-L251) [Makefile:254-262](repo://Makefile#L254-L262)

## Run in Docker

`make docker-run` starts `docker compose up` after it refuses to run inside a container. It exports the workspace path, the current user ID and a timestamp for the container name. The compose service maps port 3000, mounts the Docker socket, and mounts the workspace folder.

Sources: [Makefile:286-299](repo://Makefile#L286-L299) [docker-compose.yml:13-20](repo://docker-compose.yml#L13-L20)

The image runs the same ASGI application as the host backend, on port 3000 on all interfaces.

Sources: [containers/app/Dockerfile:95](repo://containers/app/Dockerfile#L95)
