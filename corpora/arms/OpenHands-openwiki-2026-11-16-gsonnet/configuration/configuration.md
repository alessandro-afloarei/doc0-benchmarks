---
type: concept
title: Configuration System
description: How OpenHandsConfig and its nested pydantic configs (LLM, agent, sandbox, security, MCP, condenser) are loaded from defaults, config.toml, environment variables and CLI args, what finalize_config rewrites, and how the server-side ServerConfig is selected.
tags: [configuration, config-toml, environment-variables, pydantic, sandbox, server-config]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:38:52.407Z
sources:
  - id: openwiki-source-9947aa826aa74aa615d56765
    resource: repo://openhands/core/config/config_utils.py
  - id: openwiki-source-e0ec246e2fc8f4ba808dfc7f
    resource: repo://openhands/core/config/openhands_config.py
  - id: openwiki-source-a2c4f6dc92cf0cd76a23c3d8
    resource: repo://openhands/core/config/utils.py
  - id: openwiki-source-50d13a3f8c24f3a49234fd56
    resource: repo://openhands/server/config/server_config.py
generated: { by: "claude-code", at: "2026-11-16T09:38:52.407Z" }
---

# Configuration System

All behavior is driven by one pydantic tree, `OpenHandsConfig` (`openhands/core/config/openhands_config.py`). Sub-models live in sibling modules of `openhands/core/config/`: `LLMConfig`, `AgentConfig`, `SandboxConfig`, `SecurityConfig`, `MCPConfig`, `KubernetesConfig`, `CLIConfig`, `ModelRoutingConfig`, condenser configs and an `ExtendedConfig` bag for extensions. Models use `extra='forbid'`, so unknown keys are rejected. A fully commented reference is `config.template.toml` at the repository root (sections `[core]`, `[llm]` (+ named groups like `[llm.gpt4o-mini]`), `[agent]` (+ `[agent.<Name>]`), `[sandbox]`, `[security]`, `[condenser]`, `[kubernetes]`, `[model_routing]`).

## Shape of the root config

- `llms: dict[str, LLMConfig]` — the default is under key `llm`; other keys are named groups. `get_llm_config(name)` falls back to the default (warning if a non-default name is missing).
- `agents: dict[str, AgentConfig]` — default under `agent`; `AgentConfig.llm_config` names which LLM group an agent uses (`get_llm_config_from_agent`). `get_agent_to_llm_config_map()` feeds the controller so delegates can use different LLMs.
- `default_agent` (default `CodeActAgent`), `max_iterations` (default 500), `max_budget_per_task` (None), `runtime` (default `docker`), `file_store` (`local`) + `file_store_path` (`~/.openhands`), optional web-hook settings, `sandbox`, `security`, `mcp`, `kubernetes`, `cli`.
- Operational limits: `max_concurrent_conversations` (3 per user), `conversation_max_age_seconds` (10 days), file upload limits, `enable_default_condenser`, `git_user_name`/`git_user_email` (default `openhands` identity for agent commits), `cache_dir`, `jwt_secret` (a `SecretStr`), trajectory save/replay paths.
- Deprecated: `workspace_base`, `workspace_mount_path`, `workspace_mount_rewrite` in favor of `sandbox.volumes`.

Notable sub-configs:

- **`SandboxConfig`** — `timeout` (default 120 s command timeout), `runtime_container_image`/`base_container_image`, `volumes` (`host:container[:mode]`, comma-separated), `use_host_network`, `enable_gpu`, `keep_runtime_alive`, `pause_closed_runtimes`, `remote_runtime_api_url`/`api_key`, `selected_repo`, `trusted_dirs`, `runtime_startup_env_vars`, `force_rebuild_runtime`, `user_id`, `vscode_port`, and more. See [Runtime](../runtime/runtime-and-sandbox.md).
- **`SecurityConfig`** — `confirmation_mode` (default false) and `security_analyzer` (name or None). See [Security](../security/security-and-confirmation.md).
- **`AgentConfig`** — the `enable_*` tool flags, `enable_mcp`, `enable_history_truncation`, `system_prompt_filename`, `cli_mode`, `condenser`, `model_routing`. See [CodeActAgent](../agents/codeact-agent.md); the default condenser is the conversation-window condenser ([Memory](../agents/memory-and-condensation.md)).
- **`LLMConfig`** — model, key, base URL, retries, `max_message_chars`, caching/vision toggles, `for_routing`. See [LLM layer](../llm/llm-layer.md).

## Load order

`load_openhands_config(config_file='config.toml')`:

1. `OpenHandsConfig()` — defaults.
2. `load_from_toml` — reads `[core]` keys (unknown keys warn, strings become `SecretStr` where typed so), then `[agent]`, `[llm]`, `[security]`, `[model_routing]`, `[sandbox]` and other sections via each model's `from_toml_section`. A missing file is silently ignored; a malformed file or section logs a warning and skips it.
3. `load_from_env` — **environment overrides TOML**. Names are the upper-cased field path joined by underscores: top-level fields as `FIELD`, nested configs with their field name as prefix (`SANDBOX_TIMEOUT`), plus the special prefixes `LLM_` (default LLM) and `AGENT_` (default agent), e.g. `LLM_API_KEY`, `LLM_MODEL`, `SANDBOX_VOLUMES`. Empty values are ignored; booleans accept `true`/`1`; dict/list fields are parsed with `literal_eval`; cast failures are logged and the default kept.
4. `finalize_config` and `register_custom_agents`, then debug/color logging flags are applied.

For the CLI and `main.py`, `setup_config_from_args(args)` layers **command-line arguments on top** (highest precedence): `-l/--llm-config` (resolved from the loaded config, then the given file, then `~/.openhands/config.toml`; error if not found), `--agent-cls`, `--max-iterations`, `--max-budget-per-task`, selected repo, etc. The docstring states precedence: CLI parameters > `config.toml` in the cwd (or `--config-file`) > `~/.openhands/settings.json` and `~/.openhands/config.toml`. The interactive CLI additionally merges `settings.json` (see [CLI](../clients/cli.md)). In the server, user settings are stored through `SettingsStore` and applied per conversation ([Server](../server/server-and-sessions.md)).

## `finalize_config`

Post-processing that changes behavior and is easy to miss:

- Warns on deprecated `WORKSPACE_*` settings.
- Parses `sandbox.volumes`: validates every mount (`host:container[:mode]`, 2–3 parts, else `ValueError`); a mount whose container path is exactly `/workspace` sets `workspace_mount_path`, `workspace_mount_path_in_sandbox` and `workspace_base` (absolute host path); if no `/workspace` mount exists these are explicitly **cleared** so other mounts do not accidentally become the workspace.
- Otherwise normalizes deprecated `workspace_base`/`workspace_mount_rewrite`.
- Makes `log_completions_folder` absolute for each LLM, creates `cache_dir`.
- **Generates and persists a JWT secret** in the file store if none is configured (`get_or_create_jwt_secret`); this secret also feeds session-id generation (`generate_sid`).
- If `runtime == 'cli'`, force-disables `enable_jupyter` and `enable_browsing` on all agent configs because the CLI runtime cannot support them. The CLI calls `finalize_config` a second time after switching the runtime for this reason.

## Server configuration (`ServerConfig`)

Separate from `OpenHandsConfig`, `openhands/server/config/server_config.py::ServerConfig` names the **implementation classes** the server should use as dotted paths: `settings_store_class`, `secret_store_class`, `conversation_store_class`, `conversation_manager_class` (overridable by `CONVERSATION_MANAGER_CLASS`), `monitoring_listener_class` and `user_auth_class`, plus feature flags (`ENABLE_BILLING`, `HIDE_LLM_SETTINGS`) and `app_mode` (`OSS`). `load_server_config()` picks the class via `OPENHANDS_CONFIG_CLS` using `get_impl`, and this is the seam the [enterprise edition](../enterprise/enterprise-saas.md) uses to swap stores, auth and the conversation manager. The OSS class refuses a custom config path (`verify_config`).

Related: [Overview](../architecture/overview.md), [Build and containers](../operations/build-and-containers.md).
