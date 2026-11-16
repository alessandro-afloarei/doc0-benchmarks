---
type: operations
title: Configuration, deployment, and troubleshooting
description: Configuration precedence and operational boundaries for process settings, user settings, runtime mounts, persistence, and server deployment.
tags: [configuration, deployment, operations, troubleshooting]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:43:51.947Z
sources:
  - id: openwiki-source-78ec4e3f6fcd64012fc1f029
    resource: repo://containers/app/Dockerfile
  - id: openwiki-source-c554f23202451dc6bd47c8a8
    resource: repo://containers/app/entrypoint.sh
  - id: openwiki-source-b79fbbd921df689b4bbdc82f
    resource: repo://docker-compose.yml
  - id: openwiki-source-e0ec246e2fc8f4ba808dfc7f
    resource: repo://openhands/core/config/openhands_config.py
  - id: openwiki-source-a2c4f6dc92cf0cd76a23c3d8
    resource: repo://openhands/core/config/utils.py
generated: { by: "codex", at: "2026-11-16T17:43:51.947Z" }
---

# Configuration, deployment, and troubleshooting

Configuration is layered across process defaults, TOML, environment variables, CLI arguments, and per-user web settings. Diagnose the composition path first: a browser conversation and a headless benchmark do not necessarily use the same final settings even when started from the same checkout.

## Process configuration

`load_openhands_config` constructs defaults, loads the requested TOML file, applies environment variables, finalizes configuration, and registers custom agents. Environment overrides therefore follow TOML. A missing TOML file leaves defaults intact; an invalid TOML document logs a warning and does not apply its values.

The principal sections are `[core]`, `[llm]`, `[agent]`, `[sandbox]`, `[security]`, `[condenser]`, `[mcp]`, `[kubernetes]`, and `[model_routing]`, with extended configuration also supported. Named model and agent sections allow different services to select different configurations. Use `config.template.toml` alongside the typed configuration models as the local reference.

Environment names use uppercase field prefixes, such as `LLM_MODEL`, `LLM_API_KEY`, and `SANDBOX_TIMEOUT`. Empty values are skipped. Boolean conversion recognizes `true` and `1`; list/dictionary inputs are parsed rather than treated as arbitrary strings. Invalid casts are handled by the loader, so read configuration warnings during startup.

`setup_config_from_args` applies supported CLI overrides after loading the base configuration. Named LLM selection first uses the loaded configuration, then checks the specified file and, where applicable, the user's `~/.openhands/config.toml`. It also overrides selected agent, iteration/budget limits, and repository when supplied. This is a specific fallback path, not a universal merge of every home-directory setting.

Web sessions additionally load saved settings and secrets through server-configured stores. `DefaultUserAuth` merges loaded settings with process-derived settings, and `WebSession.initialize_agent` applies session selections. For model, image, budget, or MCP differences, inspect both the process configuration and the saved web setting.

## Runtime and persistence choices

Core defaults select Docker runtime and local file storage at `~/.openhands`. Container deployment sets its own local file-store location to `/.openhands`. Persist that directory when conversation history and settings should survive application-container replacement. Runtime workspace files need their own persistence strategy.

Use `SANDBOX_VOLUMES` or `[sandbox].volumes` for mounts, formatted as comma-separated `host_path:container_path[:mode]` entries. Finalization recognizes an explicit `/workspace` mount; unrelated mounts do not implicitly become the workspace. `WORKSPACE_BASE` and `WORKSPACE_MOUNT_PATH` remain compatibility inputs but are deprecated. The checked-in Compose file still uses those legacy inputs.

Choose runtime/base images, default action timeout, connection timeouts, keep-alive, and close delay according to the execution backend. `close_delay` participates in server cleanup after inactivity, while `keep_runtime_alive` affects runtime close. CLI configuration finalization disables Jupyter and browsing for the CLI runtime. Local execution has host permissions; Docker mounts and Docker-socket access expose the host resources they grant.

## Build and launch surfaces

For development, `make build` checks dependencies, installs backend/frontend dependencies and hooks, and builds the frontend. `make run` launches both services; `make start-backend` and `make start-frontend` run them separately. Defaults are backend port 3000 and frontend port 3001, with the frontend receiving a backend target from Makefile variables.

The app image builds frontend assets and installs the Python application, then launches `uvicorn openhands.server.listen:app` on port 3000. Its entrypoint normally requires root for setup and a `SANDBOX_USER_ID`; it either runs with root sandbox-user configuration or creates/selects an end user and grants Docker-socket group access. `NO_SETUP=true` bypasses that setup path.

`docker compose up --build` uses the checked-in Compose recipe, including Docker socket, application state, and workspace mounts. Review those host paths before using it with a different workspace. `SERVE_FRONTEND=false` allows the backend to run without mounting built frontend assets. SaaS uses a different entrypoint and class-path configuration; see [enterprise](../integrations/enterprise.md).

## Diagnose by boundary

| Symptom | First evidence to inspect |
| --- | --- |
| Wrong model or provider endpoint | TOML/environment precedence, named LLM selection, saved web settings, LLM registry service |
| Runtime never becomes ready | Image/build output, Docker connectivity, executor URL, session key, runtime connection status |
| Agent stops after a tool action | Pending action ID, matching observation cause, runtime error status, action timeout |
| Conversation returns without its files | File-store persistence versus sandbox/container retention and mounts |
| Tool missing from the model | Agent feature flags, MCP discovery errors, microagent tool configuration, platform restrictions |
| Repeated context failures | Effective condenser, current history view, model input limits, truncation setting |

Configuration tests under `tests/unit/core/config/` cover precedence, casting, mounts, LLM profiles, and MCP configuration. See [quickstart](../quickstart.md), [runtime](../architecture/runtime.md), and [testing](../testing/validation.md) for concrete entrypoints and checks.
