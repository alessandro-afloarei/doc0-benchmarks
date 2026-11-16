---
title: "Configuration and Language Models"
---
## Overview

OpenHands separates application configuration from the model service used by an agent. Configuration loading constructs an `OpenHandsConfig`, applies TOML and environment values, finalizes derived settings, and registers custom agents. An `LLMRegistry` then copies that configuration and creates model services. This page explains the effective settings behind the setup commands in [[Quickstart]]; [[Agent Execution]] explains what the agent asks those services to do.

Sources: [openhands/core/config/utils.py:819-836](repo://openhands/core/config/utils.py#L819-L836), [openhands/llm/llm_registry.py:23-55](repo://openhands/llm/llm_registry.py#L23-L55)

## Loading and precedence

`load_openhands_config` starts with model defaults, calls `load_from_toml`, then `load_from_env`, and finally `finalize_config`. A missing TOML file is allowed. Invalid TOML is logged and its values are not applied. A missing `[core]` section produces a warning and leaves core defaults available; unknown core keys also produce warnings. These behaviors mean startup can continue with defaults after a configuration mistake, so warnings matter when diagnosing an unexpected model or workspace.

Sources: [openhands/core/config/utils.py:138-190](repo://openhands/core/config/utils.py#L138-L190), [openhands/core/config/utils.py:828-836](repo://openhands/core/config/utils.py#L828-L836)

Environment names are uppercase field names with prefixes for nested settings. The loader explicitly visits the default LLM with `LLM_` and the default agent with `AGENT_`; nested sandbox fields produce names such as `SANDBOX_TIMEOUT`. Empty values are skipped. Boolean strings are true only for `true` or `1`, ignoring case; dictionaries and lists use Python literal parsing. Conversion failures are logged rather than silently accepted as correctly typed settings.

Sources: [openhands/core/config/utils.py:66-135](repo://openhands/core/config/utils.py#L66-L135)

The command-line setup calls that base loader before applying supported arguments. A requested LLM profile is looked up in the loaded mapping, then in the specified configuration file, and, when necessary, the user's `~/.openhands/config.toml`. Failure to find it raises `ValueError`. Explicit agent class, iteration limit, task budget, and selected repository arguments also override their corresponding loaded fields.

Sources: [openhands/core/config/utils.py:839-904](repo://openhands/core/config/utils.py#L839-L904)

## Named model profiles

`LLMConfig.from_toml_section` treats scalar values under `[llm]` as the base configuration and dictionary values as named profiles. Each profile inherits the validated base values and then overlays its own fields. Invalid base configuration falls back to a default `LLMConfig`; an invalid named profile is skipped independently, so a broken profile does not remove every other profile. Environment processing later targets the default model, which is distinct from defining inherited values during TOML parsing.

Sources: [openhands/core/config/llm_config.py:100-160](repo://openhands/core/config/llm_config.py#L100-L160), [openhands/core/config/utils.py:130-135](repo://openhands/core/config/utils.py#L130-L135)

| Setting | Role in this checkout |
| --- | --- |
| `model`, `api_key`, `base_url`, `api_version` | Identify the model and provider connection |
| `temperature`, `top_p`, `top_k` | Control sampling parameters |
| `max_input_tokens`, `max_output_tokens` | Configure token limits |
| `timeout` | Sets the provider request timeout |
| `num_retries`, `retry_min_wait`, `retry_max_wait`, `retry_multiplier` | Configure bounded retry attempts and exponential waiting |
| `native_tool_calling` | Controls native tool-calling behavior where supported |
| `log_completions`, `log_completions_folder` | Enable raw completion records and choose their destination |

Sources: [openhands/core/config/llm_config.py:38-96](repo://openhands/core/config/llm_config.py#L38-L96), [openhands/llm/llm.py:194-218](repo://openhands/llm/llm.py#L194-L218), [openhands/llm/retry_mixin.py:56-68](repo://openhands/llm/retry_mixin.py#L56-L68)

Some model configuration has process-level effects. Post-initialization sets OpenRouter attribution environment values and configured AWS credentials for LiteLLM. It also supplies default reasoning effort for most models and an API version for Azure models when absent. These are implementation choices in this checkout, rather than a catalogue of current provider capabilities.

Sources: [openhands/core/config/llm_config.py:162-194](repo://openhands/core/config/llm_config.py#L162-L194)

## Workspace settings

Configuration finalization interprets `sandbox.volumes` as comma-separated `host_path:container_path[:mode]` mounts. An explicit `/workspace` destination updates the derived workspace fields using an absolute host path. If the mounts do not target `/workspace`, it clears the legacy workspace mount fields to avoid unintended mounting. Incorrect component counts raise `ValueError`. Legacy `workspace_base` and `workspace_mount_path` settings still have compatibility handling but emit a deprecation warning directing users to sandbox volumes.

Sources: [openhands/core/config/utils.py:377-432](repo://openhands/core/config/utils.py#L377-L432)

## Model service lifecycle

The registry owns services by `service_id`, initially registering the selected agent under `agent`. `get_llm` reuses a service with the same configuration, rejects a conflicting configuration for an existing ID, and requires a configuration for a new service. Registration emits an event to its subscriber. An extension that needs a separate model service should therefore use a distinct service ID instead of attempting to replace an existing service's configuration through this method.

Sources: [openhands/llm/llm_registry.py:23-56](repo://openhands/llm/llm_registry.py#L23-L56), [openhands/llm/llm_registry.py:82-106](repo://openhands/llm/llm_registry.py#L82-L106)

Routing is selected from the agent's model-routing configuration. `noop_router` returns the agent's main LLM directly; other router names are passed to `RouterLLM.from_config`. The registry also exposes an extraneous-completion path for ancillary services, registering them without the usual retry listener. Those requests still use an LLM object, but their service identity and notification behavior differ from the main agent call.

Sources: [openhands/llm/llm_registry.py:58-80](repo://openhands/llm/llm_registry.py#L58-L80), [openhands/llm/llm_registry.py:111-128](repo://openhands/llm/llm_registry.py#L111-L128)

## Completion processing

An `LLM` copies its configuration, initializes metrics and model information, and prepares a LiteLLM completion callable with provider credentials, timeout, sampling, and token settings. The wrapper accepts structured `Message` objects or dictionaries and normalizes them before making the call. Empty message lists are rejected locally, before a provider request.

Sources: [openhands/llm/llm.py:76-124](repo://openhands/llm/llm.py#L76-L124), [openhands/llm/llm.py:194-207](repo://openhands/llm/llm.py#L194-L207), [openhands/llm/llm.py:223-298](repo://openhands/llm/llm.py#L223-L298)

When native function calling is inactive, the wrapper converts tool-bearing messages into a prompting representation, removes native tool parameters, and later converts the response back. Stop words are conditional on model features and configuration. `modify_params` is assigned globally on LiteLLM, while `drop_params` belongs to the prepared call. Metadata in `extra_body` is removed for models outside the LiteLLM proxy path.

Sources: [openhands/llm/llm.py:258-310](repo://openhands/llm/llm.py#L258-L310), [openhands/llm/llm.py:335-357](repo://openhands/llm/llm.py#L335-L357)

## Retries and diagnostics

Retries apply only to the configured exception tuple, stop after the configured attempt count or an exit request, and re-raise the final exception. The default `num_retries` is five, but it is passed to `stop_after_attempt`, so it bounds total attempts. The retry listener is notified before sleeping. A no-response error can change an unset or zero temperature to `1.0` for the next attempt.

Sources: [openhands/core/config/llm_config.py:61-65](repo://openhands/core/config/llm_config.py#L61-L65), [openhands/llm/llm.py:211-218](repo://openhands/llm/llm.py#L211-L218), [openhands/llm/retry_mixin.py:28-69](repo://openhands/llm/retry_mixin.py#L28-L69)

Successful responses record latency and pass through cost and usage processing. Responses without choices raise `LLMNoResponseError`. Optional completion logs include messages, response, call arguments, timestamp, and cost; mocked function calling additionally preserves both representations. Controller recovery from malformed actions or context-window failures happens after this service boundary and belongs to [[Agent Execution]].

Sources: [openhands/llm/llm.py:328-403](repo://openhands/llm/llm.py#L328-L403), [openhands/llm/llm.py:583-620](repo://openhands/llm/llm.py#L583-L620), [openhands/controller/agent_controller.py:874-917](repo://openhands/controller/agent_controller.py#L874-L917)
