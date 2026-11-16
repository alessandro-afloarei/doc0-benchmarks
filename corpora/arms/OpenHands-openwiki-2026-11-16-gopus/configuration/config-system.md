---
type: reference
title: Configuration System
description: How OpenHands builds its OpenHandsConfig from config.toml sections, environment variables, CLI arguments, and per-user settings, including named [llm.*] and [agent.*] groups, sub-config sections, defaults, finalization, and custom agent registration.
tags: [configuration, config-toml, environment-variables, cli-arguments, settings]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:35:38.671Z
sources:
  - id: openwiki-source-4ae545fc5168dd6cca0bd13a
    resource: repo://openhands/core/config/agent_config.py
  - id: openwiki-source-9947aa826aa74aa615d56765
    resource: repo://openhands/core/config/config_utils.py
  - id: openwiki-source-e0ec246e2fc8f4ba808dfc7f
    resource: repo://openhands/core/config/openhands_config.py
  - id: openwiki-source-a2c4f6dc92cf0cd76a23c3d8
    resource: repo://openhands/core/config/utils.py
  - id: openwiki-source-7e3b4bedad14af18fc5d861e
    resource: repo://openhands/server/shared.py
  - id: openwiki-source-9060771be52d41c49d57018b
    resource: repo://openhands/utils/utils.py
generated: { by: "claude-code", at: "2026-11-16T07:35:38.671Z" }
---

# Configuration System

All backend configuration lives in a single pydantic model, `OpenHandsConfig` (`openhands/core/config/openhands_config.py`), with typed sub-configs in `openhands/core/config/`. `config.template.toml` at the repository root is the annotated reference for every option.

## Structure

| TOML section | Model | Stored at |
| --- | --- | --- |
| `[core]` | top-level `OpenHandsConfig` fields | `cfg.*` |
| `[llm]`, `[llm.<name>]` | `LLMConfig` | `cfg.llms['llm']`, `cfg.llms['<name>']` |
| `[agent]`, `[agent.<Name>]` | `AgentConfig` | `cfg.agents['agent']`, `cfg.agents['<Name>']` |
| `[sandbox]` | `SandboxConfig` | `cfg.sandbox` |
| `[security]` | `SecurityConfig` | `cfg.security` |
| `[mcp]` | `MCPConfig` | `cfg.mcp` |
| `[kubernetes]` | `KubernetesConfig` | `cfg.kubernetes` |
| `[condenser]` | condenser configs | default agent's `condenser` |
| `[model_routing]` | `ModelRoutingConfig` | default agent's `model_routing` |
| `[extended]` | `ExtendedConfig` (free-form dict) | `cfg.extended` |

Notable `[core]` fields and defaults: `default_agent='CodeActAgent'`, `runtime='docker'`, `file_store='local'`, `file_store_path='~/.openhands'`, `max_iterations=500`, `max_budget_per_task=None`, `workspace_mount_path_in_sandbox='/workspace'`, `enable_browser=True`, `save_trajectory_path`, `replay_trajectory_path`, `jwt_secret`, `conversation_max_age_seconds=864000` (10 days), `max_concurrent_conversations`, `enable_default_condenser=True`, `mcp_host`, `run_as_openhands=True`, file-upload limits, and `git_user_name`/`git_user_email`. Unknown `[core]` keys and unknown sections log warnings rather than failing.

### Named groups and inheritance

`LLMConfig.from_toml_section` and `AgentConfig.from_toml_section` treat scalar keys as the **default** group (`llm` / `agent`) and every nested table as a **named** group whose values override the defaults:

```toml
[llm]
model = "claude-sonnet-4-20250514"
num_retries = 5

[llm.gpt4o-mini]          # inherits num_retries, overrides model
model = "gpt-4o-mini"

[agent]
enable_prompt_extensions = false

[agent.BrowsingAgent]     # per-agent override
enable_prompt_extensions = true
llm_config = "gpt4o-mini" # which [llm.*] group this agent uses
```

`get_llm_config(name)` falls back to the default group (with a warning) for unknown names; `get_agent_config(name)` falls back to `agent`. `get_llm_config_from_agent(name)` resolves an agent's `llm_config` reference. This is how delegates and condensers use different models ([LLM Layer](../architecture/llm-layer.md)).

`[agent.<Name>] classpath = "pkg.module.Class"` registers a **custom agent** at load time (`register_custom_agents` → `Agent.register`), loading its own config model class when available ([Agents](../agents/agenthub.md)).

## Load order and precedence

`load_openhands_config(config_file='config.toml')` (`openhands/core/config/utils.py`) runs:

1. `OpenHandsConfig()` defaults.
2. `load_from_toml` — silently returns if the file is missing; on TOML decode errors logs and applies nothing. Each section is parsed independently, so one invalid section doesn't block others (except `[security]`, `[sandbox]`, and `[mcp]`, whose `ValueError`s are re-raised). If no `[condenser]` section exists and `enable_default_condenser` is true, the default agent gets an `LLMSummarizingCondenserConfig` using the default LLM.
3. `load_from_env(os.environ)` — every field is settable via an upper-cased env var built from the field path: `SANDBOX_TIMEOUT`, `SANDBOX_VOLUMES`, `SECURITY_CONFIRMATION_MODE`, top-level `RUNTIME`, `MAX_ITERATIONS`, etc. The default LLM uses the `LLM_` prefix (`LLM_MODEL`, `LLM_API_KEY`, `LLM_BASE_URL`) and the default agent the `AGENT_` prefix. Values are cast to the annotated type: booleans accept `true`/`1`; dicts/lists are parsed with `literal_eval` (lists of pydantic models are constructed); empty values are skipped. **Environment variables override TOML.**
4. `finalize_config`:
   - Parses `sandbox.volumes` (`host:container[:mode]`, comma-separated); a mount targeting `/workspace` sets `workspace_mount_path`/`workspace_base`. The old `WORKSPACE_BASE`/`WORKSPACE_MOUNT_PATH` are deprecated but still honored.
   - Makes LLM `log_completions_folder` paths absolute, creates `cache_dir`.
   - Generates and persists a `jwt_secret` in the file store if none is configured.
   - For `runtime = "cli"`, disables Jupyter and browsing for all agents.
5. `register_custom_agents`.

For the CLI and `openhands.core.main`, `setup_config_from_args(args)` then applies **command-line overrides** (highest precedence): `-l/--llm-config <name>` makes a named LLM group the default (looking in the given config file, then `~/.openhands/config.toml`), `-c/--agent-cls`, `-i/--max-iterations`, `-b/--max-budget-per-task`, `--selected-repo`, plus `--config-file`, `-t/-f` (task text/file), `-n` (session name), `--no-auto-continue`, and eval-specific flags (`openhands/core/config/arg_utils.py`).

## Server and per-user settings

The web server loads one process-wide config at import (`openhands/server/shared.py: config = load_openhands_config()`). Per-conversation, user **Settings** (model, API key, base URL, agent, confirmation mode, condenser options, MCP servers — persisted by the settings store) are layered on a deep copy: `setup_llm_config()` in `openhands/utils/utils.py` overrides the default LLM's `model`, `api_key`, and `base_url`, and `Session` applies agent/security/sandbox overrides. This keeps the shared config immutable across users. See [Storage, Settings, Secrets, and Auth](../server/storage-and-settings.md).

The CLI persists its own settings in `~/.openhands/settings.json` and reads `~/.openhands/config.toml` ([CLI](../interfaces/cli.md)).

## Extension: `[extended]`

`ExtendedConfig` is a root model over an arbitrary dict with attribute-style access; it's available at `cfg.extended` and `AgentConfig.extended` for third-party or experimental features without schema changes.

## Tests

`tests/unit/core/config/` covers TOML parsing, env-var casting, named LLM/agent inheritance, condenser/MCP/sandbox/kubernetes sections, volume parsing, and argument precedence.

## Related pages

- [LLM Layer](../architecture/llm-layer.md)
- [Runtime Implementations](../runtime/runtime-implementations.md) — `[sandbox]` and `[kubernetes]`
- [Security Analyzers](../security/security-analyzers.md) — `[security]`
- [MCP Integration](../integrations/mcp.md) — `[mcp]`
- [Conversation Memory and Condensers](../architecture/memory-and-condensers.md) — `[condenser]`
- [Command-Line Interface](../interfaces/cli.md)
