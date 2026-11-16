---
type: architecture-component
title: Configuration Model
description: How OpenHandsConfig is built from config.toml, environment variables, and CLI arguments, how named LLM and agent sections are parsed, what the sub-configs control, and where the loading precedence is defined.
tags: [configuration, config-toml, environment-variables, openhands-config, llm-config, sandbox-config, precedence]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:30:54.023Z
sources:
  - id: openwiki-source-8188f5ddf5232a9c93c0ccb0
    resource: repo://openhands/core/config/llm_config.py
  - id: openwiki-source-f0fa538b22f586fd775d4bce
    resource: repo://openhands/core/config/sandbox_config.py
  - id: openwiki-source-c09980a03acbee243c8816ff
    resource: repo://openhands/core/config/security_config.py
  - id: openwiki-source-a2c4f6dc92cf0cd76a23c3d8
    resource: repo://openhands/core/config/utils.py
generated: { by: "claude-code", at: "2026-11-16T18:30:54.023Z" }
---

# Configuration Model

OpenHands uses one root Pydantic model, `OpenHandsConfig` (`openhands/core/config/openhands_config.py`), that aggregates every runtime setting: named LLM configurations, named agent configurations, the sandbox, security, MCP, and a set of top-level switches. The model is populated from three sources and then finalized. The loading code lives in `openhands/core/config/utils.py`.

## Sources and precedence

`load_openhands_config` (`utils.py` ~L819-L836) defines the base order:

1. `load_from_toml(config, config_file)`: reads the TOML file (default `config.toml` in the current directory).
2. `load_from_env(config, os.environ)`: applies environment variables after the TOML, so **environment variables override TOML values**.
3. `finalize_config(config)` (~L377): post-processing, such as deprecated-variable warnings and deriving the workspace mount from `sandbox.volumes`.
4. `register_custom_agents(config)` (~L796): imports and registers agents named in `[agent.<name>]` sections that carry a `classpath`.

`setup_config_from_args` (~L839) is used by the entry points. It calls `load_openhands_config` and then applies command-line overrides. These are, in code order: the named LLM (`-l`), the default agent, `max_iterations`, `max_budget_per_task`, and the selected repository. The CLI entry point (`openhands/cli/main.py`, ~L581-L640) applies `~/.openhands/config.toml` and `~/.openhands/settings.json` as fallbacks for the LLM choice, with `settings.json` lowest. Note that the docstring of `setup_config_from_args` lists the user-level files as precedence level 3, but the loader itself only reads the file it is given. The user-level `config.toml` is consulted only as a fallback when a named LLM is not found in the primary file (`utils.py` ~L860-L870).

## TOML layout

`config.template.toml` documents every option. The loader recognizes these sections:

| Section | Maps to |
| --- | --- |
| `[core]` | top-level fields on `OpenHandsConfig`, such as `workspace_base`, `cache_dir`, `debug`, `disable_color`, `save_trajectory_path`, `max_iterations`, `max_budget_per_task`, `file_store`, `runtime` |
| `[llm]` and `[llm.<name>]` | `llms` dictionary. `[llm]` is the default. `[llm.<name>]` overrides keys for a named configuration. |
| `[agent]` and `[agent.<name>]` | `agents` dictionary. `[agent]` is the default. `[agent.<name>]` can set a `classpath` for a custom agent. |
| `[sandbox]` | `SandboxConfig` |
| `[security]` | `SecurityConfig` |
<!-- openwiki: broken internal link [/openwiki/architecture/memory-and-context.md] link "/openwiki/architecture/memory-and-context.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| `[condenser]` | the default agent's condenser (see [Memory, Condensation, and Microagents](/openwiki/architecture/memory-and-context.md)) |
| `[mcp]` | `MCPConfig` |
| `[kubernetes]` | `KubernetesConfig` |
| `[model_routing]` | `ModelRoutingConfig` |
| `[extended]` | free-form `ExtendedConfig` |

Parsing is per section. A malformed section logs a warning and is skipped, so the rest of the file still applies. Unknown top-level sections are reported with a warning. The exceptions are `[security]` and `[sandbox]`: a parse failure there raises a `ValueError` instead of being skipped.

Named LLMs are parsed by `LLMConfig.from_toml_section` (`openhands/core/config/llm_config.py` ~L101): non-dictionary keys form the default, and each dictionary-valued key is a named override that starts from the default.

## Environment variables

`load_from_env` (`utils.py` ~L40-L135) walks the root model and every nested sub-config. A field is read from an environment variable named `PREFIX + FIELD` in upper case, where the prefix comes from the nesting. Nested sub-configs use their field name as the prefix. Examples: `SANDBOX_TIMEOUT`, `SECURITY_CONFIRMATION_MODE`. The default LLM is read with prefix `LLM_` and the default agent with `AGENT_`. Values are cast to the declared field type, and a bad value logs an error naming the variable.

`load_dotenv()` runs at import (`utils.py` ~L37), so a `.env` file in the working directory is loaded into `os.environ` before the loader reads it.

Deprecated variables such as `WORKSPACE_BASE` and `WORKSPACE_MOUNT_PATH` still work but emit a warning that points to `SANDBOX_VOLUMES` (`finalize_config`).

## Sub-configs that matter most

<!-- openwiki: broken internal link [/openwiki/architecture/llm-layer.md] link "/openwiki/architecture/llm-layer.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **LLM** (`LLMConfig`): model, credentials, base URL, retry and timeout settings, and the features used by [the LLM layer](/openwiki/architecture/llm-layer.md). The default LLM is the one under key `llm`.
<!-- openwiki: broken internal link [/openwiki/architecture/agents-and-prompting.md] link "/openwiki/architecture/agents-and-prompting.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **Agent** (`AgentConfig`): the tool-enable flags (`enable_cmd`, `enable_browsing`, and so on), the system-prompt filename, and the condenser. See [Agents, Prompting, and Delegation](/openwiki/architecture/agents-and-prompting.md) for how these gate the tool set.
<!-- openwiki: broken internal link [/openwiki/architecture/runtime-sandbox.md] link "/openwiki/architecture/runtime-sandbox.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **Sandbox** (`SandboxConfig`): the runtime container image, timeouts, networking (`use_host_network`, `additional_networks`, `runtime_binding_address`), volumes, GPU and platform, and remote-runtime settings. Defaults include a 120-second execution `timeout`. See [Runtime and Sandbox Execution](/openwiki/architecture/runtime-sandbox.md).
<!-- openwiki: broken internal link [/openwiki/architecture/security-analysis.md] link "/openwiki/architecture/security-analysis.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **Security** (`SecurityConfig`): `confirmation_mode` (default `False`) and `security_analyzer` (default `None`). These control whether high-risk actions wait for user confirmation. See [Security Analysis and Action Gating](/openwiki/architecture/security-analysis.md).
<!-- openwiki: broken internal link [/openwiki/architecture/integrations-and-mcp.md] link "/openwiki/architecture/integrations-and-mcp.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **MCP** (`MCPConfig`): external MCP tool servers, parsed from `[mcp]`. See [Git Provider Integrations and MCP](/openwiki/architecture/integrations-and-mcp.md).

## Invariants and failure behavior

- Environment variables always win over the TOML file for any field they set.
- A malformed TOML file is logged and the defaults are kept for the sections that failed, so a broken file does not stop startup. Errors in `[security]` and `[sandbox]` are the exceptions: they raise.
- If `sandbox.volumes` includes a mount whose container path is `/workspace`, `finalize_config` sets `workspace_mount_path` to that host path and `workspace_mount_path_in_sandbox` to `/workspace`. Other mounts are not used for this derivation.
- `default_agent` names an agent in the registry. An unknown name fails at agent construction, not at load.

## Extension seams

- Add a sub-config as a Pydantic model field on `OpenHandsConfig` and give it a `from_toml_section` parser. Then add a branch to `load_from_toml` and a known-section entry.
- Environment mapping is automatic for any new field of a sub-config.
- A custom agent is added through `[agent.<name>] classpath = "..."`, handled by `register_custom_agents`.

## Representative tests

- `tests/unit/core/config/test_config.py` and `test_config_precedence.py` cover the TOML and environment precedence rules.
- `tests/unit/core/config/test_llm_config.py` and `test_llm_draft_config.py` cover named LLM sections.
- `tests/unit/core/config/test_config_extended.py` covers the `[extended]` section.
- `tests/unit/core/config/test_mcp_config.py` and `test_kubernetes_config.py` cover those sections.

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/llm-layer.md] link "/openwiki/architecture/llm-layer.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [LLM Layer, Routing, Metrics, and Retries](/openwiki/architecture/llm-layer.md)
<!-- openwiki: broken internal link [/openwiki/architecture/runtime-sandbox.md] link "/openwiki/architecture/runtime-sandbox.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Runtime and Sandbox Execution](/openwiki/architecture/runtime-sandbox.md)
<!-- openwiki: broken internal link [/openwiki/operations/deployment-and-docker.md] link "/openwiki/operations/deployment-and-docker.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Deployment, Containers, and Build](/openwiki/operations/deployment-and-docker.md)
