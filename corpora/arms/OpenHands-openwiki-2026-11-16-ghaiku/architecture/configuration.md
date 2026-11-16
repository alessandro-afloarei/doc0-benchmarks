---
type: architecture
title: Configuration System
description: How OpenHands assembles its OpenHandsConfig from config.toml, environment variables, and CLI arguments, including precedence, the sub-config schemas for LLM, agent, sandbox, security, condenser, MCP, and model routing, and where settings.json fits.
tags: [configuration, config-toml, environment-variables, cli-arguments, pydantic, settings]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T11:08:31.416Z
sources:
  - id: openwiki-source-19133d494fc7efa3c076265d
    resource: repo://config.template.toml
  - id: openwiki-source-2560404802cbc340c233d2ec
    resource: repo://openhands/cli/main.py
  - id: openwiki-source-e0ec246e2fc8f4ba808dfc7f
    resource: repo://openhands/core/config/openhands_config.py
  - id: openwiki-source-a2c4f6dc92cf0cd76a23c3d8
    resource: repo://openhands/core/config/utils.py
generated: { by: "claude-code", at: "2026-11-16T11:08:31.416Z" }
---

# Configuration System

OpenHands runs from a single pydantic model, `OpenHandsConfig`
(`openhands/core/config/openhands_config.py`). Every entry point (the server, the CLI, headless
runs, and the evaluation harness) builds one of these objects and passes it down to the runtime,
agents, and LLM layer. This page explains how that object is filled and which sub-configs it
contains.

## Sources and precedence

Loading is implemented in `openhands/core/config/utils.py`.

1. **Defaults.** `OpenHandsConfig()` starts with the field defaults.
2. **`config.toml`.** `load_from_toml` reads the file (default `config.toml` in the working
   directory). A missing file is ignored; a file that fails to parse logs a warning and is skipped
   (`utils.py:138-160`). The `[core]` table maps directly onto top-level fields, and unknown keys
   produce a warning. Other tables are handed to their own parsers: `[agent]` through
   `AgentConfig.from_toml_section`, and `[llm]`, `[sandbox]`, `[security]`, `[condenser]`,
   `[kubernetes]`, `[model_routing]`, and `[extended]` through their respective loaders.
3. **Environment variables.** `load_from_env(config, os.environ)` runs after the TOML load
   (`utils.py:819-836`), so environment values override TOML values.
4. **`finalize_config`.** Post-processing, including the deprecated `WORKSPACE_BASE` and
   `WORKSPACE_MOUNT_PATH` handling and parsing of `sandbox.volumes` into the workspace mount
   (`utils.py:377`).
5. **Custom agents.** `register_custom_agents` (`utils.py:796`) registers agent classes named in
   configuration with the agent registry (see [Agents, Tools, and Microagents](agents-and-tools.md)).

For command-line runs, `setup_config_from_args` (`utils.py:839`) calls `load_openhands_config` and
then applies CLI overrides, which take precedence over everything above:

- `--llm-config NAME` selects a named `[llm.NAME]` table. If the name is not already loaded, it is
  looked up in the file given by `--config-file` and then in `~/.openhands/config.toml`. An unknown
  name is an error.
- `--agent-cls` sets `default_agent`.
- `--max-iterations` and `--max-budget-per-task` set the corresponding limits.
- the selected-repository option sets `sandbox.selected_repo`.

The docstring of `setup_config_from_args` also lists `~/.openhands/settings.json` as the lowest
precedence source. In this codebase that file is consumed by the CLI itself (`openhands/cli/main.py`,
around lines 621-633), not by the shared loader.

## Environment variable naming

`load_from_env` walks the model fields recursively. A top-level field `timeout` in `sandbox` is
read from `SANDBOX_TIMEOUT`; nested models use the field path joined by underscores and uppercased
(`utils.py:66-80`). Values are cast to the annotated type. This is the mechanism behind variables
such as `LLM_BASE_URL`, `AGENT_MEMORY_ENABLED`, and `SANDBOX_VOLUMES` named in the loader's docstring.

## Schema layout

`OpenHandsConfig` (`openhands_config.py:65-70`) holds:

- `llms`: named `LLMConfig` entries, with the default LLM selected by `set_llm_config`;
- `agents`: named `AgentConfig` entries, with `default_agent` (see the agent configuration below);
- `sandbox`: `SandboxConfig`, covering runtime choice, timeouts, container images, volumes, and
  keep-alive behavior;
- `security`: `SecurityConfig` for confirmation and analyzer choices;
- `extended`: free-form `ExtendedConfig` for deployment-specific settings;
- top-level operational fields such as `max_iterations`, `max_budget_per_task`, `file_store`,
  `file_uploads_*`, `cache_dir`, `save_trajectory_path`, `mcp`, and git identity fields for commits
  made by the agent.

The sub-config modules in the same directory are:

| Module | Contents |
| --- | --- |
| `llm_config.py` | Model, credentials, base URL, retries, and provider options for one LLM. |
| `agent_config.py` | Per-agent feature flags (`enable_cmd`, `enable_browsing`, `enable_finish`, and so on), prompt options, history truncation, and the condenser reference. |
| `condenser_config.py` | Condenser strategy and its parameters. |
| `sandbox_config.py` | Runtime selection, timeouts, images, volumes, and keep-alive. |
| `security_config.py` | Confirmation and security analyzer settings. |
| `mcp_config.py` | MCP server definitions and their settings. |
| `model_routing_config.py` | Model routing settings (`[model_routing]`). |
| `kubernetes_config.py` | Kubernetes runtime settings. |
| `cli_config.py` | CLI-specific settings. |
| `extended_config.py` | Pass-through `[extended]` table. |
| `arg_utils.py` | Argparse parsers (`get_cli_parser`, `get_headless_parser`, `get_evaluation_parser`). |
| `config_utils.py` | Helpers for describing model fields and producing defaults. |

## The shipped template

`config.template.toml` at the repository root documents every supported option. Its top-level
tables are `[core]` (line 12), `[llm]` with named variants such as `[llm.draft_editor]` (lines 100
and 214), `[agent]` with per-agent overrides (line 237), `[sandbox]` (line 291), `[security]`
(line 368), `[condenser]` (line 384), `[kubernetes]` (line 452), and `[model_routing]` (line 496).
Treat the template as the reference for option names; the code in `utils.py` is the authority for
parsing behavior.

## Operational consequences

- Environment variables always win over `config.toml`. A stale variable in a deployment silently
  overrides a committed file.
- Secret-typed fields (for example `search_api_key`) are wrapped in `SecretStr` when read from
  TOML, so they are masked when the object is printed.
- Deprecated `WORKSPACE_*` variables still work but log a warning; `SANDBOX_VOLUMES` is the
  supported mount mechanism.
- Unknown `[core]` keys are warnings, not errors, so a typo in a key name leaves the default in
  place. Check the log at startup when a setting seems to have no effect.

## Extension seams

- Add a field to the relevant sub-config model. The TOML and environment loaders pick it up
  automatically if it is in the model and, for `[core]`, in `OpenHandsConfig`.
- Add a CLI flag to `arg_utils.py` and apply it in `setup_config_from_args`.
- Add a new table by extending `load_from_toml` with a dedicated parser, as `[extended]` does.

## Tests

Configuration behavior is exercised under `tests/unit/core/config/`. LLM-specific behavior is covered
under `tests/unit/llm/`.

## Related pages

- [LLM Layer](llm-layer.md)
- [Runtime Abstraction and Execution Backends](runtime.md)
- [Security Model and Sandboxing](../operations/security.md)
- [CLI and Local Launchers](../cli/cli-and-launchers.md)
