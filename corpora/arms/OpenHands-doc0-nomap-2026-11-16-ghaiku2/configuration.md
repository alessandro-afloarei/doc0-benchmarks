---
title: "Configuration"
---
## Overview

Every entry point builds one `OpenHandsConfig` before anything else starts. It is a pydantic model whose fields have defaults, and it is filled in three layers: the `config.toml` file, environment variables, and then command-line arguments. The config holds the sub-configs the rest of the system reads: named LLM configs, agent configs, the sandbox, security, and condenser settings. This page explains how values get into that object; each page of this site says which fields it reads.

Sources: [openhands/core/config/openhands_config.py:23-70](repo://openhands/core/config/openhands_config.py#L23-L70), [openhands/core/config/utils.py:819-837](repo://openhands/core/config/utils.py#L819-L837)

## Loading order

`load_openhands_config` starts from the defaults, applies `config.toml` with `load_from_toml`, then applies the environment with `load_from_env`, then runs `finalize_config` and `register_custom_agents`. Because the environment is applied second, an environment variable overrides the same key in `config.toml`.

Sources: [openhands/core/config/utils.py:819-837](repo://openhands/core/config/utils.py#L819-L837)

```python
config = OpenHandsConfig()
load_from_toml(config, config_file)   # config.toml
load_from_env(config, os.environ)     # overrides the file
finalize_config(config)
register_custom_agents(config)
```

Sources: [openhands/core/config/utils.py:819-837](repo://openhands/core/config/utils.py#L819-L837)

Command-line entry points then call `setup_config_from_args`, which loads the same config and applies the arguments that were given. Its docstring lists the precedence as CLI parameters, then `config.toml` in the current directory (or the `--config-file` path), then `~/.openhands/config.toml` and `settings.json`. The LLM named by `-l` is looked up in the loaded configs first, then in the given file, then in the user's file.

Sources: [openhands/core/config/utils.py:839-870](repo://openhands/core/config/utils.py#L839-L870)

## The TOML file

`load_from_toml` reads the file and, if it cannot parse it, logs a warning and applies nothing. Top-level settings go under `[core]`, and the template in the repository groups the rest by sub-config: `[llm]`, `[agent]`, `[sandbox]`, `[security]`, `[condenser]`, `[kubernetes]` and `[model_routing]`. A missing `[core]` section only produces a warning, and the defaults are used.

Sources: [openhands/core/config/utils.py:138-175](repo://openhands/core/config/utils.py#L138-L175), [config.template.toml:12-12](repo://config.template.toml#L12-L12), [config.template.toml:100-100](repo://config.template.toml#L100-L100), [config.template.toml:237-237](repo://config.template.toml#L237-L237), [config.template.toml:291-291](repo://config.template.toml#L291-L291), [config.template.toml:368-368](repo://config.template.toml#L368-L368)

Named sub-tables create named configs. `[llm.draft_editor]` adds an entry to `llms` under that name, and `[agent.RepoExplorerAgent]` adds per-agent settings. The unnamed `[llm]` table is the default LLM, which the field `llms` stores under the key `llm`.

Sources: [config.template.toml:214-218](repo://config.template.toml#L214-L218), [config.template.toml:278-283](repo://config.template.toml#L278-L283), [openhands/core/config/openhands_config.py:65-67](repo://openhands/core/config/openhands_config.py#L65-L67)

## Environment variables

`load_from_env` walks each sub-config's fields. The variable name is the sub-config prefix plus the field name in upper case, so `LLM_BASE_URL` sets the default LLM's base URL, `AGENT_MEMORY_ENABLED` sets an agent flag and `SANDBOX_TIMEOUT` sets the sandbox timeout. Each value is cast to the field's type: booleans accept `true` or `1`, and dictionary and list fields are parsed as Python literals. A value that cannot be cast is logged and skipped.

Sources: [openhands/core/config/utils.py:40-75](repo://openhands/core/config/utils.py#L40-L75), [openhands/core/config/utils.py:76-130](repo://openhands/core/config/utils.py#L76-L130)

## Finalising the config

`finalize_config` rewrites a few values after loading. A deprecated `WORKSPACE_BASE` or `WORKSPACE_MOUNT_PATH` logs a warning and points users at `SANDBOX_VOLUMES`. When a sandbox volume is mounted at `/workspace`, its host path becomes `workspace_mount_path`, and the path inside the sandbox is fixed to `/workspace`.

Sources: [openhands/core/config/utils.py:377-400](repo://openhands/core/config/utils.py#L377-L400)

The settings that most often need changing are the runtime and file store, which choose where code runs and where events are saved. Both have defaults on the root object.

Sources: [openhands/core/config/openhands_config.py:71-73](repo://openhands/core/config/openhands_config.py#L71-L73), [openhands/core/config/openhands_config.py:98-99](repo://openhands/core/config/openhands_config.py#L98-L99)

The defaults are `docker` for the runtime, `local` for the file store at `~/.openhands`, a limit of `max_iterations` steps, and no budget per task. These are read by [[Runtime Implementations]], [[File Stores and Settings]] and [[Agent State and Limits]].

Sources: [openhands/core/config/openhands_config.py:71-73](repo://openhands/core/config/openhands_config.py#L71-L73), [openhands/core/config/openhands_config.py:98-99](repo://openhands/core/config/openhands_config.py#L98-L99)
