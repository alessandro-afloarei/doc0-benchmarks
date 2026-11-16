---
title: "Configuration"
---
## Overview

Configuration connects startup choices to the components that execute a task. `OpenHandsConfig` contains named LLM and agent configurations, sandbox and security settings, runtime selection, persistence settings and execution limits. The setup commands in [[Quickstart]] create only a small part of that configuration. To explain an unexpected value, first identify whether the caller uses the base loader, command-line overrides or browser conversation settings.

Sources: [openhands/core/config/openhands_config.py:65-118](repo://openhands/core/config/openhands_config.py#L65-L118), [openhands/core/config/utils.py:819-850](repo://openhands/core/config/utils.py#L819-L850), [openhands/server/services/conversation_service.py:98-135](repo://openhands/server/services/conversation_service.py#L98-L135), [Makefile:307-325](repo://Makefile#L307-L325)

## Loading order

`load_openhands_config` constructs defaults, applies the selected TOML file, applies environment values, finalizes the result and registers custom agents. `setup_config_from_args` calls that loader before applying explicit command-line choices. In this path, environment values override TOML values for the fields they set, and later CLI handling can replace the selected LLM configuration, agent class, iteration limit, budget and repository. The CLI selection of a named LLM is a replacement of the default configuration object, not merely a model-name edit.

Sources: [openhands/core/config/utils.py:819-850](repo://openhands/core/config/utils.py#L819-L850), [openhands/core/config/utils.py:853-904](repo://openhands/core/config/utils.py#L853-L904)

```mermaid
flowchart LR
  defaults["OpenHandsConfig defaults"] --> toml["load_from_toml"]
  toml --> env["load_from_env"]
  env --> final["finalize_config"]
  final --> custom["Register custom agents"]
  custom --> cli["Explicit CLI overrides"]
```

Sources: [openhands/core/config/utils.py:828-835](repo://openhands/core/config/utils.py#L828-L835), [openhands/core/config/utils.py:850-904](repo://openhands/core/config/utils.py#L850-L904)

A missing TOML file returns without applying TOML configuration. A syntax error logs a warning and also returns. Unknown top-level sections produce warnings. Validation is section-specific: agent and LLM parsing errors can be logged without applying the section, while invalid sandbox and security configurations can raise `ValueError`. Consequently, a process that continues after a configuration warning may be running with defaults or previously loaded values.

Sources: [openhands/core/config/utils.py:148-167](repo://openhands/core/config/utils.py#L148-L167), [openhands/core/config/utils.py:192-227](repo://openhands/core/config/utils.py#L192-L227), [openhands/core/config/utils.py:258-271](repo://openhands/core/config/utils.py#L258-L271), [openhands/core/config/utils.py:349-364](repo://openhands/core/config/utils.py#L349-L364)

## Environment and named configurations

The environment loader derives uppercase names from model fields. Nested models receive prefixes, and the default LLM and agent configurations are explicitly processed with `LLM_` and `AGENT_`. Empty values are skipped. Boolean strings are true only when their lowercase form is `true` or `1`; list and dictionary values use `literal_eval`. Conversion failures log an error. Examples of the resulting names include `LLM_BASE_URL`, `AGENT_ENABLE_MCP` and `SANDBOX_VOLUMES`.

Sources: [openhands/core/config/utils.py:65-135](repo://openhands/core/config/utils.py#L65-L135), [openhands/core/config/agent_config.py:44-45](repo://openhands/core/config/agent_config.py#L44-L45), [openhands/core/config/sandbox_config.py:91-94](repo://openhands/core/config/sandbox_config.py#L91-L94)

Agent TOML configuration separates non-dictionary base fields from named override sections. Each named configuration merges the validated base with its overrides; invalid custom sections are skipped independently. An agent's `llm_config` chooses a named LLM, falling back to the default name when unset. A missing named LLM lookup logs a warning and returns the default configuration. [[Model Decisions and Tools]] follows the resulting model selection into the registry and completion call.

Sources: [openhands/core/config/agent_config.py:102-154](repo://openhands/core/config/agent_config.py#L102-L154), [openhands/core/config/openhands_config.py:131-169](repo://openhands/core/config/openhands_config.py#L131-L169)

The CLI `--llm-config` path first checks loaded named configurations, then attempts the specified file and, when appropriate, the user's `~/.openhands/config.toml`. If the requested configuration cannot be found, it raises an error rather than silently choosing another name. This explicit selection path has different failure behavior from the ordinary named lookup on `OpenHandsConfig`.

Sources: [openhands/core/config/utils.py:853-885](repo://openhands/core/config/utils.py#L853-L885), [openhands/core/config/openhands_config.py:131-141](repo://openhands/core/config/openhands_config.py#L131-L141)

## Controls by responsibility

| Configuration | Fields and defaults in this checkout | Owning behavior |
| --- | --- | --- |
| Core execution | `runtime="docker"`, `max_iterations=500`, `max_budget_per_task=None` | [[Agent Control Loop]] and [[Sandbox Execution]] |
| Persistence | `file_store="local"`, `file_store_path="~/.openhands"`, optional trajectory paths | [[Events and Persistence]] |
| Session capacity | `max_concurrent_conversations=3`, `conversation_max_age_seconds=864000` | [[Browser Conversations]] |
| Agent tools | Command, editor, Jupyter and MCP toggles; plan mode enabled | [[Model Decisions and Tools]] |
| Security | `confirmation_mode=False`, `security_analyzer=None` | [[Agent Control Loop]] |
| Sandbox mounts | `volumes` accepts comma-separated host/container mappings | [[Sandbox Execution]] |

Sources: [openhands/core/config/openhands_config.py:65-118](repo://openhands/core/config/openhands_config.py#L65-L118), [openhands/core/config/config_utils.py:7-9](repo://openhands/core/config/config_utils.py#L7-L9), [openhands/core/config/agent_config.py:27-60](repo://openhands/core/config/agent_config.py#L27-L60), [openhands/core/config/security_config.py:12-15](repo://openhands/core/config/security_config.py#L12-L15), [openhands/core/config/sandbox_config.py:91-94](repo://openhands/core/config/sandbox_config.py#L91-L94)

Condenser defaults depend on the construction path. `AgentConfig` starts with a conversation-window condenser, with a comment explaining that a no-op condenser would leave context-limit condensation requests unhandled. When a TOML file is successfully processed without a condenser section and `enable_default_condenser` is true, the TOML loader replaces that with an LLM summarizing condenser. An explicit condenser section is parsed and assigned to the default agent. [[Memory and Microagents]] explains the policies themselves.

Sources: [openhands/core/config/agent_config.py:54-60](repo://openhands/core/config/agent_config.py#L54-L60), [openhands/core/config/utils.py:301-338](repo://openhands/core/config/utils.py#L301-L338), [openhands/core/config/utils.py:148-158](repo://openhands/core/config/utils.py#L148-L158)

## Workspace finalization

Finalization favors `sandbox.volumes` over deprecated workspace mount fields. Each comma-separated mount must contain two or three colon-separated parts. An explicit `/workspace` destination supplies the absolute host workspace path; if no mount targets `/workspace`, the legacy workspace fields are cleared to avoid unintended mounting. The code warns when the old `WORKSPACE_BASE` or `WORKSPACE_MOUNT_PATH` values are used and names `SANDBOX_VOLUMES` as their replacement.

Sources: [openhands/core/config/utils.py:377-424](repo://openhands/core/config/utils.py#L377-L424)

Other finalization work makes completion-log directories absolute, creates the configured cache directory and obtains a JWT secret from the selected file store when none is configured. For the `cli` runtime it disables Jupyter and browsing on configured agents because that runtime does not support those operations. These are mutations after loading, so the final effective configuration can differ from the literal TOML values.

Sources: [openhands/core/config/utils.py:438-470](repo://openhands/core/config/utils.py#L438-L470)

## Browser session settings

Browser startup loads `SettingsStoreImpl` for the user and copies saved settings into `ConversationInitData`. Repository, branch, provider tokens, custom secrets and conversation instructions are then added; a supplied MCP configuration is also included. The experiment manager can transform this initialization data before the conversation manager receives it. This is why a browser session must be traced through saved settings in addition to the base application configuration.

Sources: [openhands/server/services/conversation_service.py:98-159](repo://openhands/server/services/conversation_service.py#L98-L159)

Absent saved settings raises `MissingSettingsError`. A non-Bedrock model with a missing or whitespace key raises `LLMAuthenticationError`; the code explicitly avoids an inference-based credential check at this point. The API maps those failures to HTTP 400 responses. [[Browser Conversations]] continues from validated initialization data into the asynchronous session lifecycle.

Sources: [openhands/server/services/conversation_service.py:104-124](repo://openhands/server/services/conversation_service.py#L104-L124), [openhands/server/routes/manage_conversations.py:270-288](repo://openhands/server/routes/manage_conversations.py#L270-L288)
