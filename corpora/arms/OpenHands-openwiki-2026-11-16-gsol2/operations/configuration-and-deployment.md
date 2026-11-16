---
type: operations
title: Configuration, deployment and security
description: Configuration precedence, development and container processes, workspace mounts, confirmation policy and operational diagnostics.
tags: [configuration, deployment, security, operations]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:55:05.802Z
sources:
  - id: openwiki-source-b79fbbd921df689b4bbdc82f
    resource: repo://docker-compose.yml
  - id: openwiki-source-2129d0084f64a3f5714baf90
    resource: repo://openhands/controller/agent_controller.py
  - id: openwiki-source-c09980a03acbee243c8816ff
    resource: repo://openhands/core/config/security_config.py
  - id: openwiki-source-a2c4f6dc92cf0cd76a23c3d8
    resource: repo://openhands/core/config/utils.py
  - id: openwiki-source-e6edead93b3c17764753cbdb
    resource: repo://openhands/server/user_auth/default_user_auth.py
generated: { by: "codex", at: "2026-11-16T16:55:05.802Z" }
---

# Configuration, deployment and security

## Configuration ownership and precedence

`load_openhands_config` creates defaults, loads `config.toml`, applies environment values, finalizes derived settings and registers custom agents. Environment values therefore override TOML in this loader. CLI argument setup and web session settings have additional entrypoint-specific behavior; the web UI's selected model/settings participate in conversation initialization. Do not assume editing the default `[llm]` section changes every existing GUI session.

Environment mapping uses uppercase field names and prefixes such as `LLM_`, `AGENT_`, `SANDBOX_` and `SECURITY_`. Empty values are skipped; booleans recognize `true` and `1`, while collection values are parsed as Python literals. Conversion failures are logged. TOML sections and typed config models remain the better reference for structured settings. The commented template is an example, and may differ from current defaults: `OpenHandsConfig` currently defaults to Docker runtime and local storage at `~/.openhands`.

Finalization normalizes paths, creates cache directories and obtains a persistent JWT secret if absent. For CLI runtime it disables Jupyter and browsing capabilities. `SANDBOX_VOLUMES` accepts comma-separated `host:container[:mode]` mounts; an explicit `/workspace` target establishes the workspace host path. Other mount targets do not implicitly become the workspace. Legacy workspace-base/mount settings are still handled with deprecation warnings.

## Processes and container boundaries

Development targets launch Uvicorn at `openhands.server.listen:app` on `127.0.0.1:3000` and a frontend development server on port 3001. `make run` starts the backend, waits for its port, then runs the frontend; separate targets support independent work. The backend can serve built frontend assets, controlled by `SERVE_FRONTEND`.

The Compose service builds `containers/app/Dockerfile`, exposes port 3000, mounts `~/.openhands` at `/.openhands`, and supplies Docker socket access plus workspace mounts. The app container hosts the server; execution runtimes are separate environments created by the runtime backend. `SANDBOX_RUNTIME_CONTAINER_IMAGE` selects an already-built execution image. Otherwise Docker runtime may build one from its configured base image and extra dependencies.

The app entrypoint normally starts as root to configure the effective user and Docker socket group, requires `SANDBOX_USER_ID`, and runs the supplied command as root or the created enduser accordingly. `NO_SETUP=true` bypasses that setup. Host paths used by the Docker daemon and paths visible inside the app container must refer to the intended data; verify mount translation when files appear in one process but not another.

## Action security and credentials

Confirmation is disabled by default in `SecurityConfig`. When enabled, the controller analyzes selected runnable command, notebook, interactive-browser, read and edit actions. The web path requests confirmation for high-risk actions or unknown risk without an analyzer. Analyzer exceptions set risk to unknown; this is distinct from the no-analyzer condition. CLI actions use a separate interactive confirmation path with session choices in `cli/main.py`. These gates do not cover every possible action type or external integration uniformly.

The built-in analyzers are `llm` and `invariant`. Runtime dispatch suppresses actions awaiting confirmation and returns user-rejection observations for rejected actions. Risk classification is a policy decision; actual execution permissions also depend on the selected runtime, user, mounts and external credentials.

The default OSS auth implementation returns no user ID and explicitly lacks multi-tenancy. Deployments requiring user isolation use alternate auth, validation and storage implementations, as described in [enterprise boundaries](../integrations/enterprise.md). Event secret replacement masks registered values in serialized history; settings persistence and model/debug logs have their own handling.

## Diagnostics and checks

`/alive` and `/health` report application liveness; `/server_info` reports system information. They do not prove an individual model call or runtime is ready. Investigate session startup logs, runtime status, execution-container logs and model retry/error status separately. `DEBUG=1` enables more model diagnostics; completion logs and trajectories can contain repository/task content.

Source references: [config loader](../../openhands/core/config/utils.py), [template](../../config.template.toml), [Compose](../../docker-compose.yml), [app entrypoint](../../containers/app/entrypoint.sh) and [controller policy](../../openhands/controller/agent_controller.py). Configuration, middleware, security and runtime-mount tests provide focused validation.

Related: [quickstart](../quickstart.md), [runtimes](../architecture/runtimes.md), [models](../concepts/models.md), [conversations](../architecture/conversations.md).
