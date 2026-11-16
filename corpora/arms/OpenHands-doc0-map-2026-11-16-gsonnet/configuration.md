---
title: "Configuration"
---
## Overview

All runtime behaviour starts from one pydantic model, `OpenHandsConfig`, which holds named dictionaries of LLM and agent configurations plus the sandbox, security, MCP and Kubernetes sections. `load_openhands_config` builds it in a fixed order: defaults, then `config.toml`, then environment variables, then a finalisation pass. The CLI and headless entry points then apply command-line overrides on top. The model forbids unknown fields (`extra='forbid'`).

Sources: [openhands/core/config/openhands_config.py:23-129](repo://openhands/core/config/openhands_config.py#L23-L129), [openhands/core/config/utils.py:819-836](repo://openhands/core/config/utils.py#L819-L836)

## Loading order

```python
config = OpenHandsConfig()
load_from_toml(config, config_file)
load_from_env(config, os.environ)
finalize_config(config)
register_custom_agents(config)
```

Sources: [openhands/core/config/utils.py:819-836](repo://openhands/core/config/utils.py#L819-L836)

So an environment variable overrides `config.toml`, which overrides defaults, matching what `Development.md` says (environment variables over `config.toml` over defaults). `config.template.toml` lists every option, and its header says that all settings have defaults and fields within each section are alphabetical.

Sources: [Development.md:69-72](repo://Development.md#L69-L72), [config.template.toml:1-12](repo://config.template.toml#L1-L12)

`load_from_toml` returns quietly when the file does not exist, and warns without applying anything when it cannot be parsed. It reads the `[core]` section onto the top-level fields (warning on an unknown key, and converting strings to `SecretStr` for secret fields), then the sections `[agent]`, `[llm]`, `[security]`, `[model_routing]`, `[sandbox]`, `[mcp]`, `[kubernetes]`, `[condenser]` and `[extended]`. Named subsections such as `[llm.gpt4o-mini]` or `[agent.CustomAgent]` create additional configs that agents and flags can refer to by name.

Sources: [openhands/core/config/utils.py:138-200](repo://openhands/core/config/utils.py#L138-L200), [openhands/core/config/utils.py:204-300](repo://openhands/core/config/utils.py#L204-L300), [openhands/core/config/utils.py:301-362](repo://openhands/core/config/utils.py#L301-L362), [config.template.toml:100-106](repo://config.template.toml#L100-L106), [config.template.toml:214-218](repo://config.template.toml#L214-L218)

`load_from_env` walks the model's fields and looks up the upper-cased field name, so `SANDBOX_TIMEOUT` sets `sandbox.timeout`; nested models extend the prefix. The default LLM and agent configs are read with the prefixes `LLM_` and `AGENT_`. Empty values are skipped. Booleans accept `true` or `1`, dictionaries and lists are parsed as Python literals (with list items of a model type built from dictionaries), and a value that cannot be cast is logged as an error and ignored.

Sources: [openhands/core/config/utils.py:40-135](repo://openhands/core/config/utils.py#L40-L135)

## Finalisation

`finalize_config` makes the loaded values consistent in four ways.

Sources: [openhands/core/config/utils.py:377-382](repo://openhands/core/config/utils.py#L377-L382)

- `sandbox.volumes` (`host:container[:mode]`, comma-separated) is validated, and a mount whose container path is `/workspace` sets the workspace paths; a mount in the wrong format raises `ValueError`. The `workspace_base` and `workspace_mount_path` settings are deprecated and trigger a warning pointing to `SANDBOX_VOLUMES`.
- Each LLM's `log_completions_folder` becomes an absolute path, and `cache_dir` is created.
- A missing `jwt_secret` is read from the file store, or generated and written there. `generate_sid` uses it ([[OpenHands Overview]]).
- With the `cli` runtime, Jupyter and browsing are turned off for every agent, because that runtime cannot support them ([[Runtime and Action Execution Server]]).

Sources: [openhands/core/config/utils.py:367-470](repo://openhands/core/config/utils.py#L367-L470)

`register_custom_agents` imports every agent config that has a `classpath` and registers it under its name, so an agent can be added from config alone ([[CodeAct Agent and Agent Catalogue]]).

Sources: [openhands/core/config/utils.py:796-816](repo://openhands/core/config/utils.py#L796-L816)

## Command-line overrides

`setup_config_from_args` documents its precedence as: CLI parameters, then `config.toml` in the current directory (or `--config-file`), then `~/.openhands` files. After loading, it applies `-l` (using a named LLM config, searched in the loaded configs, the given file, and finally `~/.openhands/config.toml`; failing to find it raises `ValueError`), `--agent-cls`, `--max-iterations`, `--max-budget-per-task` and `--selected-repo`. The flags themselves are listed in [[Quickstart]].

Sources: [openhands/core/config/utils.py:839-904](repo://openhands/core/config/utils.py#L839-L904)

## Key options

Defaults below come straight from the field declarations.

Sources: [openhands/core/config/openhands_config.py:65-125](repo://openhands/core/config/openhands_config.py#L65-L125)

| Section | Option | Default | Meaning |
| --- | --- | --- | --- |
| core | `default_agent` | `CodeActAgent` | Agent used when none is chosen |
| core | `max_iterations` | 500 | Iteration limit ([[Agent Controller Loop]]) |
| core | `max_budget_per_task` | none | Spending limit in dollars |
| core | `runtime` | `docker` | Runtime name |
| core | `file_store`, `file_store_path` | `local`, `~/.openhands` | Where state is stored ([[Storage, Settings and Secrets]]) |
| core | `max_concurrent_conversations` | 3 | Agent loops allowed per user |
| core | `conversation_max_age_seconds` | 864,000 | 10 days |
| core | `enable_default_condenser` | true | See [[Condensers]] |
| core | `git_user_name`, `git_user_email` | `openhands`, `openhands@all-hands.dev` | Identity for agent commits |
| core | `mcp_host` | `localhost:3000` (from `port`) | Host of the default MCP server |
| `llm` | `model` | `claude-sonnet-4-20250514` | Model name |
| `llm` | `num_retries`, `retry_min_wait`, `retry_max_wait`, `retry_multiplier` | 5, 8, 64, 8 | Retry policy ([[LLM Layer]]) |
| `llm` | `temperature`, `top_p` | 0.0, 1.0 | Sampling |
| `llm` | `caching_prompt`, `drop_params`, `modify_params` | true, true, true | Provider behaviour |
| `llm` | `native_tool_calling` | none | Forces or disables native function calling |
| `agent` | `enable_browsing`, `enable_jupyter`, `enable_cmd`, `enable_editor`, `enable_mcp` | true | Which tools the agent has |
| `agent` | `enable_llm_editor`, `enable_condensation_request` | false | Optional tools |
| `agent` | `enable_history_truncation` | true | Condense on context overflow |
| `sandbox` | `timeout` | 120 | Default command timeout in seconds |
| `sandbox` | `volumes` | none | Host mounts |
| `sandbox` | `base_container_image`, `runtime_container_image` | none | Sandbox images |
| `sandbox` | `use_host_network` | false | Host networking for Docker |
| `security` | `security_analyzer` | none | `llm` or `invariant` ([[MCP Tools and Security Analyzers]]) |

Sources: [openhands/core/config/openhands_config.py:65-125](repo://openhands/core/config/openhands_config.py#L65-L125), [openhands/core/config/config_utils.py:8-10](repo://openhands/core/config/config_utils.py#L8-L10), [openhands/core/config/llm_config.py:52-96](repo://openhands/core/config/llm_config.py#L52-L96), [openhands/core/config/agent_config.py:16-60](repo://openhands/core/config/agent_config.py#L16-L60), [openhands/core/config/sandbox_config.py:49-96](repo://openhands/core/config/sandbox_config.py#L49-L96), [openhands/core/config/security_config.py:5-13](repo://openhands/core/config/security_config.py#L5-L13)

`OpenHandsConfig` resolves names through helper methods. `get_llm_config(name)` falls back to the default `llm` config with a warning when a name is unknown, `get_agent_config(name)` falls back to the default `agent` config, and `get_llm_config_from_agent` follows an agent's `llm_config` field to the LLM it should use, so different agents can use different models.

Sources: [openhands/core/config/openhands_config.py:131-172](repo://openhands/core/config/openhands_config.py#L131-L172)

## Settings from the UI

In server mode, the user's saved `Settings` override part of this config per conversation (model, agent, limits, images and so on), and `DefaultUserAuth` merges `config.toml` values into the loaded settings. See [[Storage, Settings and Secrets]] and [[Server, Conversations and Sessions]].

Sources: [openhands/server/session/session.py:132-212](repo://openhands/server/session/session.py#L132-L212), [openhands/server/user_auth/default_user_auth.py:49-61](repo://openhands/server/user_auth/default_user_auth.py#L49-L61)
