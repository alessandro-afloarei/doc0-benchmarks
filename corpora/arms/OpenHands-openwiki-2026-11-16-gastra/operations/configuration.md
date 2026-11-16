---
type: operations
title: Configuration, deployment and security
description: Configuration layering, launch modes, runtime and volume selection, persistence, security settings, and practical troubleshooting boundaries.
tags: [configuration, deployment, security, operations]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T08:14:39.912Z
sources:
  - id: openwiki-source-b79fbbd921df689b4bbdc82f
    resource: repo://docker-compose.yml
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-e0ec246e2fc8f4ba808dfc7f
    resource: repo://openhands/core/config/openhands_config.py
  - id: openwiki-source-c09980a03acbee243c8816ff
    resource: repo://openhands/core/config/security_config.py
  - id: openwiki-source-a2c4f6dc92cf0cd76a23c3d8
    resource: repo://openhands/core/config/utils.py
generated: { by: "codex", at: "2026-11-16T08:14:39.912Z" }
---

# Configuration, deployment and security

Start with the launch path: a source-development server, packaged CLI, Docker application, and enterprise server have different initialization and settings layers. The model selected in a web session can differ from the model in `config.toml`.

## Configuration layering

`load_openhands_config` creates defaults, loads the selected TOML file, applies environment variables, finalizes derived settings, and registers custom agents. Environment overrides therefore follow TOML in this base loader.

Environment names are uppercase field names, with prefixes for nested models: examples include `LLM_MODEL`, `LLM_API_KEY`, `SANDBOX_TIMEOUT`, and `SECURITY_CONFIRMATION_MODE`. Empty values are skipped; boolean true values include `true` and `1`; dictionary/list fields are decoded from JSON. Check the field model and parsing implementation for a setting rather than assuming every environment variable is an untyped string.

`setup_config_from_args` subsequently applies explicit CLI choices, including a named LLM configuration. Named LLM lookup can fall back to the user's `~/.openhands/config.toml` when absent from the selected file. Interactive CLI and web initialization have additional user-settings behavior, so a single global precedence list is insufficient for every interface.

The template documents sections such as `[core]`, `[llm]`, `[agent]`, `[sandbox]`, and `[security]`. Some commented examples are not current defaults: `OpenHandsConfig` currently defaults to Docker and a local file store at `~/.openhands`, whereas the template includes a commented memory-store example.

## Launch choices

| Purpose | Repository entrypoint |
| --- | --- |
| Develop backend | `make start-backend` → `openhands.server.listen:app` |
| Develop frontend | `make start-frontend` |
| Develop both | `make run` |
| Interactive installed CLI | `openhands` / `openhands cli` |
| Packaged GUI launcher | `openhands serve` |
| Compose app and Docker runtime access | Root `docker-compose.yml` |
| Enterprise application | `enterprise/saas_server.py` and its Dockerfile |

The root Compose definition builds the application image, maps port 3000, mounts the Docker socket, persists `~/.openhands` at `/.openhands`, and passes workspace/runtime-image configuration. The Docker socket gives the application the ability to create runtime containers. Treat both socket access and workspace mounts as deployment capabilities.

The repository README describes OSS usage as a single-user local-workstation application. Its default conversation validator does not supply multi-tenant access control. [Enterprise](../integrations/enterprise.md) adds separate auth, stores, and distributed management; these do not become active merely by exposing an OSS port.

## Runtime and volume choices

`runtime` selects the execution adapter. Docker executes through a container action server; local execution starts that server on the host. CLI runtime has a narrower tool surface: configuration finalization disables Jupyter and browsing for its agents.

Prefer the explicit `sandbox.volumes` model when configuring mounts. Finalization examines comma-separated `host:container[:mode]` entries, recognizes a `/workspace` mount, validates formats, and suppresses deprecated workspace auto-mount behavior when no workspace mount is present. The older `workspace_base`, `workspace_mount_path`, and rewrite fields still have compatibility handling.

`sandbox.runtime_container_image` selects a prepared image. Without one, DockerRuntime needs a base image and may build an execution image. A runtime that stays in startup can be waiting on image construction, ports, action-server health, or plugins rather than an LLM.

Persistence has two dimensions: file-store event/checkpoint state and runtime workspace/container state. Retaining a container does not preserve data in an in-memory event store. See [runtime lifecycle](../architecture/runtime.md) and [events/storage](../architecture/events-storage.md).

## Confirmation and credentials

`SecurityConfig` defaults to confirmation disabled and no explicit analyzer. Enabling confirmation changes controller handling for a specific set of runnable actions; it is not a universal interceptor for every tool. Risk classification and CLI behavior are described in [agent control](../architecture/agent-control.md).

Provider/custom secrets are registered for event masking, but filtering only covers known values and supported payload shapes. Model completion logs and exported trajectories are separate artifacts that may contain task content. Configure their locations deliberately when diagnosing provider behavior.

## Troubleshooting by boundary

| Symptom | Inspect first |
| --- | --- |
| Model setting appears ignored | Launch path, environment, selected TOML, CLI override, web-session settings |
| Runtime never ready | Image/build logs, Docker connectivity, port allocation, action-server/plugin readiness |
| Agent waits after a tool call | Pending action ID, observation cause, confirmation state, runtime error status |
| History disappears after restart | Actual file-store type/path and user-scoped event/checkpoint location |
| Tool missing from prompt | Enabled agent tools, MCP discovery errors, runtime placement, microagent metadata |
| Browser reconnect misses state | Latest-event cursor and server replay/live-event path |

Use the [quickstart](../quickstart.md) for setup and [testing](../testing/validation.md) for focused checks. Configuration changes should exercise `tests/unit/core/config/`, especially precedence, casting, and MCP merge behavior.
