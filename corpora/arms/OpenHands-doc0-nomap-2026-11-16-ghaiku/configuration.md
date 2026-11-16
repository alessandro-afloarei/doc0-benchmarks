---
title: "Configuration Loading"
---
## Overview

One `OpenHandsConfig` object holds the settings the backend reads. It is built at start from defaults, then `config.toml`, then environment variables, and the terminal program adds its command-line arguments last. The config holds the groups that the other pages read: the LLMs, the agents, the sandbox, the security settings, the file store, the MCP servers and the default runtime.

Sources: [openhands/core/config/openhands_config.py:23-72](repo://openhands/core/config/openhands_config.py#L23-L72), [openhands/core/config/utils.py:819-837](repo://openhands/core/config/utils.py#L819-L837)

## Loading order

`load_openhands_config` reads the TOML file first, then the environment, then finishes the config and registers custom agents. Because the environment is applied second, an environment variable overrides the same key in the file.

Sources: [openhands/core/config/utils.py:819-837](repo://openhands/core/config/utils.py#L819-L837)

The terminal program's `setup_config_from_args` adds the last layer. Command-line options such as `-l` for the LLM group take precedence over the loaded file. A named LLM group that is missing from the loaded file is looked up in the file given on the command line, and then in the user's `~/.openhands/config.toml`.

Sources: [openhands/core/config/utils.py:839-870](repo://openhands/core/config/utils.py#L839-L870)

## The TOML file

`load_from_toml` reads each known section of `config.toml` into the matching part of the config. The sections it handles include `core`, `agent`, `llm`, `security`, `model_routing`, `sandbox`, `mcp` and `kubernetes`. A section that fails to parse is reported with a message saying its values have not been applied. An unknown key in the `core` section is also reported.

Sources: [openhands/core/config/utils.py:138-165](repo://openhands/core/config/utils.py#L138-L165), [openhands/core/config/utils.py:189-200](repo://openhands/core/config/utils.py#L189-L200), [openhands/core/config/utils.py:204-230](repo://openhands/core/config/utils.py#L204-L230), [openhands/core/config/utils.py:259-300](repo://openhands/core/config/utils.py#L259-L300)

The loader's docstring points to `config.template.toml` as the full list of options.

Sources: [openhands/core/config/utils.py:138-147](repo://openhands/core/config/utils.py#L138-L147)

## Environment variables

`load_from_env` walks the config model. For each field it builds the variable name from the field's path and upper-cases it, so `llm.base_url` becomes `LLM_BASE_URL` and `sandbox.timeout` becomes `SANDBOX_TIMEOUT`. Nested models use the parent name as a prefix. List and dict values are parsed from text.

Sources: [openhands/core/config/utils.py:40-100](repo://openhands/core/config/utils.py#L40-L100)

## Finishing the config

`finalize_config` runs after both sources are loaded. It warns that `WORKSPACE_BASE` and `WORKSPACE_MOUNT_PATH` are deprecated in favour of sandbox volumes, and it reads the volume list to find the mount for `/workspace`.

Sources: [openhands/core/config/utils.py:377-400](repo://openhands/core/config/utils.py#L377-L400)

## Named groups

The config holds LLMs and agents as named groups. `get_llm_config` returns the group with the given name and falls back to the default `llm` group, which it creates if it is missing. `get_agent_config` does the same for agents. An agent's `llm_config` field names the LLM group it uses.

Sources: [openhands/core/config/openhands_config.py:131-156](repo://openhands/core/config/openhands_config.py#L131-L156), [openhands/core/config/openhands_config.py:161-170](repo://openhands/core/config/openhands_config.py#L161-L170)

The fields of an LLM group include the model, the API key, the base URL, the retry count and the retry timing. The defaults are a Claude model and five retries.

Sources: [openhands/core/config/llm_config.py:12-63](repo://openhands/core/config/llm_config.py#L12-L63)

The sandbox group holds the runtime image, the execution timeout, which is 120 seconds by default, and the volumes. The default runtime is `docker`, and the default agent is `CodeActAgent`.

Sources: [openhands/core/config/sandbox_config.py:8-61](repo://openhands/core/config/sandbox_config.py#L8-L61), [openhands/core/config/openhands_config.py:67-71](repo://openhands/core/config/openhands_config.py#L67-L71), [openhands/core/config/config_utils.py:7](repo://openhands/core/config/config_utils.py#L7)

## Where each setting is read

The security group selects the analyzer and the confirmation mode, as [[Security and Confirmation]] describes. The agent group selects the tools, the prompt and the condenser, as [[CodeAct Agent]] and [[Condenser Catalogue]] describe. The file store settings are read by the storage code in [[Storage and Persistence]]. The MCP group is read by the MCP code in [[MCP Tools]].

Sources: [openhands/core/config/security_config.py:12-13](repo://openhands/core/config/security_config.py#L12-L13), [openhands/core/config/agent_config.py:15-60](repo://openhands/core/config/agent_config.py#L15-L60), [openhands/core/config/openhands_config.py:72-76](repo://openhands/core/config/openhands_config.py#L72-L76), [openhands/core/config/openhands_config.py:116](repo://openhands/core/config/openhands_config.py#L116)
