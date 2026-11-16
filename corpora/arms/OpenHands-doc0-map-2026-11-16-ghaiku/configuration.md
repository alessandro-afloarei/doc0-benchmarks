---
title: "Configuration"
---
## Overview

The loaders return one `OpenHandsConfig` object, which the rest of the code reads. The class holds named LLM configurations, named agent configurations, the sandbox, security, condenser and MCP settings, and run limits such as the iteration count and the budget per task.

Sources: [openhands/core/config/openhands_config.py:23-60](repo://openhands/core/config/openhands_config.py#L23-L60)

## Load order

`load_openhands_config` starts from the class defaults, reads the TOML file named by `config_file` (default `config.toml` in the working directory), then reads the process environment, then runs `finalize_config` and registers custom agents. Environment values therefore win over the TOML file, which matches the order the development guide gives.

Sources: [openhands/core/config/utils.py:819-837](repo://openhands/core/config/utils.py#L819-L837) [openhands/core/config/utils.py:138-160](repo://openhands/core/config/utils.py#L138-L160)

`setup_config_from_args` runs that loader and then applies command-line arguments on top, so a flag such as the LLM selector beats both files. Its docstring also lists `~/.openhands/settings.json` and `~/.openhands/config.toml` as sources. The loader it calls reads only the file named by `config_file`, so those home-directory paths are not read by this function.

Sources: [openhands/core/config/utils.py:839-849](repo://openhands/core/config/utils.py#L839-L849) [openhands/core/config/utils.py:819-837](repo://openhands/core/config/utils.py#L819-L837)

`load_from_env` sets fields from variable names such as `LLM_BASE_URL`, `AGENT_MEMORY_ENABLED` and `SANDBOX_TIMEOUT`, the examples its docstring gives.

Sources: [openhands/core/config/utils.py:40-50](repo://openhands/core/config/utils.py#L40-L50)

## Sections of config.template.toml

The template lists each section the loader reads. The table names the page that uses each one.

Sources: [config.template.toml:12-14](repo://config.template.toml#L12-L14) [config.template.toml:496-498](repo://config.template.toml#L496-L498)

| Section | Template line | Controls | Page |
| --- | --- | --- | --- |
| `[core]` | 12 | Top-level settings shared by all parts | This page |
| `[llm]` | 100 | Named model settings, including the default `llm` entry | [[LLM Access]] |
| `[agent]` | 237 | Named agent settings, with per-agent overrides | [[Agents]] |
| `[sandbox]` | 291 | Runtime choice, volumes and timeouts | [[Runtime Implementations]] |
| `[security]` | 368 | Risk analysis and confirmation | [[Security Analysis and Confirmation]] |
| `[condenser]` | 384 | History condensation strategy | [[Condenser Strategies]] |
| `[kubernetes]` | 452 | Kubernetes runtime options | [[Runtime Implementations]] |
| `[model_routing]` | 496 | Routing between named LLM configurations | [[LLM Access]] |

Sources: [config.template.toml:12](repo://config.template.toml#L12) [config.template.toml:100](repo://config.template.toml#L100) [config.template.toml:237](repo://config.template.toml#L237) [config.template.toml:291](repo://config.template.toml#L291) [config.template.toml:368](repo://config.template.toml#L368) [config.template.toml:384](repo://config.template.toml#L384) [config.template.toml:452](repo://config.template.toml#L452) [config.template.toml:496](repo://config.template.toml#L496)

## Named LLM and agent configurations

`llms` and `agents` are dictionaries keyed by name. The entry under `llm` and the entry under `agent` are the defaults, and any other name is a separate configuration that a run can select. The template defines named LLMs such as `llm.draft_editor` and `llm.gpt4o-mini`, and named agents such as `agent.RepoExplorerAgent` and `agent.CustomAgent`.

Sources: [openhands/core/config/openhands_config.py:23-40](repo://openhands/core/config/openhands_config.py#L23-L40) [config.template.toml:214-218](repo://config.template.toml#L214-L218) [config.template.toml:278-283](repo://config.template.toml#L278-L283)

## Deprecated and derived settings

The old workspace variables are deprecated. When `WORKSPACE_BASE` or `WORKSPACE_MOUNT_PATH` is set, `finalize_config` logs a warning and points to `SANDBOX_VOLUMES`. When `sandbox.volumes` is set, `finalize_config` splits it on commas so that several mounts can be given in one value.

Sources: [openhands/core/config/utils.py:377-388](repo://openhands/core/config/utils.py#L377-L388)

## Command-line surface

The command parser has two subcommands, `serve` for the web server and `cli` for the terminal interface. Running `openhands` with no subcommand is the same as `openhands cli`. A shared helper adds the common arguments to each subcommand parser.

Sources: [openhands/core/config/arg_utils.py:145-160](repo://openhands/core/config/arg_utils.py#L145-L160)
