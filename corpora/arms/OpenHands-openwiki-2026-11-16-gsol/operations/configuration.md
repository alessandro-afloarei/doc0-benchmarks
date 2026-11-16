---
type: operations
title: Configuration and action security
description: Configuration load order, named model and agent profiles, browser settings, secrets persistence, runtime mounts, and action confirmation.
tags: [configuration, security, secrets, operations]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:50:03.393Z
sources:
  - id: openwiki-source-2129d0084f64a3f5714baf90
    resource: repo://openhands/controller/agent_controller.py
  - id: openwiki-source-e0ec246e2fc8f4ba808dfc7f
    resource: repo://openhands/core/config/openhands_config.py
  - id: openwiki-source-a2c4f6dc92cf0cd76a23c3d8
    resource: repo://openhands/core/config/utils.py
  - id: openwiki-source-f38350b0cd074145e71451f8
    resource: repo://openhands/runtime/base.py
  - id: openwiki-source-d5332d718f6cd21e525b683b
    resource: repo://openhands/storage/secrets/file_secrets_store.py
generated: { by: "codex", at: "2026-11-16T06:50:03.393Z" }
---

# Configuration and action security

There are three configuration scopes: process/core configuration, server implementation selection, and conversation/user settings. A value observed in a browser conversation may have been changed after the process loaded TOML and environment variables.

## Core load order

`load_openhands_config` creates Pydantic OpenHandsConfig defaults, applies `config.toml`, applies environment variables, finalizes paths and derived settings, and registers custom agent classes. Environment values override the loaded default groups. `setup_config_from_args` then applies supported CLI choices such as LLM profile, agent, iteration limit, budget, and selected repository.

The main sections are `[core]`, `[llm]`, `[agent]`, `[sandbox]`, `[security]`, `[mcp]`, `[kubernetes]`, and condenser/routing configuration. `config.template.toml` is the broad option reference; current model fields and loader behavior are authoritative when an older README uses a renamed API.

Environment names generally uppercase root fields and prefix nested settings: `RUNTIME`, `FILE_STORE_PATH`, `LLM_MODEL`, `LLM_API_KEY`, `SANDBOX_TIMEOUT`, and `SECURITY_CONFIRMATION_MODE`. Boolean true values are `true` and `1`; list/dictionary environment values are parsed as Python literals. Empty values are skipped. Conversion failures are logged. Missing TOML files leave defaults in place, while parse errors log a warning and skip TOML application.

## Profiles and model selection

OpenHandsConfig owns dictionaries of named LLM and agent configurations. The default keys are `llm` and `agent`. An agent's `llm_config` selects the LLM profile; missing named LLM groups fall back to the default with a warning. A CLI `--llm-config` selection can load a named profile from the requested config file and, if needed, the user's `~/.openhands/config.toml`.

A minimal TOML shape is:

```toml
[core]
runtime = "docker"

[llm]
model = "provider/model"

[agent]
enable_mcp = true

[security]
confirmation_mode = false
```

Supply credentials through the intended local config, environment, or settings workflow. The provider/model string is a placeholder, not a specific supported-provider recommendation.

## Server and conversation settings

`OPENHANDS_CONFIG_CLS` selects the ServerConfig implementation that defines auth, settings/secrets stores, metadata storage, monitoring, conversation manager, and browser feature flags. This happens during shared server initialization. See [enterprise composition](../integrations/enterprise.md).

WebSession applies user settings to the effective conversation config, including confirmation/analyzer choice, runtime images, Git identity, budget/iteration settings, MCP, and condenser policy. The UI's selected model is therefore not governed solely by the headless TOML default.

Settings and secrets use different store interfaces. The OSS file stores persist `settings.json` and `secrets.json` through the selected file store and explicitly expose secret values during serialization; SecretStr masks representations but does not itself encrypt these files. Enterprise supplies different stores. Provider secrets also need registration with the event stream for masking.

Stored settings' MCP configuration can be merged with config-derived server lists. The merge preserves both sets, placing config-derived lists first; it is not a blanket replacement of all user settings.

## Workspace and runtime consequences

`SANDBOX_VOLUMES` uses comma-separated `host_path:container_path[:mode]` entries. Finalization validates their shape and recognizes an explicit `/workspace` mount to derive the workspace host path. Mounting only other directories does not implicitly mount the current workspace. Older workspace mount fields remain for compatibility.

Runtime defaults to Docker and storage defaults to local `~/.openhands`. Runtime configuration controls tool execution location; storage configuration controls events/checkpoints/settings. Selecting CLI runtime disables Jupyter and browsing in agent configs during finalization. See [runtime operations](runtimes.md).

## Action confirmation

Confirmation mode defaults off. When enabled, the controller analyzes selected runnable command, notebook, interactive-browser, file-edit, and file-read action classes. A configured analyzer can override risk. Without an analyzer, risk becomes UNKNOWN and these actions require confirmation; HIGH risk requires confirmation in the non-CLI path. Analyzer exceptions set UNKNOWN, whose treatment differs from the no-analyzer branch. Do not assume all unknown-risk cases automatically block.

CLI mode marks these actions awaiting confirmation and leaves its own flow to handle approval. Other modes move the controller to AWAITING_USER_CONFIRMATION when appropriate. Runtime.run_action does not execute actions still awaiting confirmation and returns user-rejection feedback for rejected actions. Approval/rejection is recorded by re-emitting the pending action with updated status.

## Diagnostics and tests

Use `DEBUG=1` for backend debugging, `LOG_ALL_EVENTS` for detailed event logging, and LLM completion logging for provider input/output inspection. These logs can contain task content. For stalls, distinguish a pending confirmation, pending tool observation, context-limit recovery, and runtime disconnect.

Focused suites are `tests/unit/core/config/`, `tests/unit/security/`, `tests/unit/server/routes/test_settings_api.py`, `test_secrets_api.py`, and controller confirmation tests. Start with [quickstart](../quickstart.md) for runnable setup and [conversation server](../architecture/conversation-server.md) for lifecycle scope.
