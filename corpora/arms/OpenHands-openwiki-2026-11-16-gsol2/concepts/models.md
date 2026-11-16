---
type: concept
title: Model services and completion handling
description: How LLM services adapt provider calls, manage retries and capabilities, and report usage through a conversation-level registry.
tags: [llm, models, retries, metrics]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:55:05.802Z
sources:
  - id: openwiki-source-846d81305e1163067ac4815f
    resource: repo://openhands/llm/llm_registry.py
  - id: openwiki-source-30e374a20e6e9e785cf0d1b1
    resource: repo://openhands/llm/llm.py
  - id: openwiki-source-fb5e2382ea09f5d9eb14b2ad
    resource: repo://openhands/llm/retry_mixin.py
generated: { by: "codex", at: "2026-11-16T16:55:05.802Z" }
---

# Model services and completion handling

## Registry and ownership

`LLMRegistry` creates the active agent model and holds service-ID-to-LLM instances for a conversation. Agents, condensers and auxiliary features can use separate services while sharing registry notifications and conversation accounting. Configuration is copied into the registry and again into individual LLM instances, reducing accidental mutation across services.

`get_llm` reuses an existing service only with an equal configuration, rejects a conflicting configuration and requires configuration for a new service. The agent-config helper has a different existing-service path: it currently returns that instance even when a requested config differs. Use a distinct service ID for a distinct model configuration rather than assuming every access path switches an existing service. A no-op router returns the agent model directly; configured routers are constructed through `RouterLLM`.

## Completion path

The `LLM` wrapper configures LiteLLM with model/provider settings, credentials, base URL, token limits, sampling options and timeout. It initializes model information and capabilities before building its completion callable. The wrapper accepts internal `Message` objects or dictionaries and normalizes them to provider input.

When native function calling is unavailable, tool messages and schemas are converted into a prompting representation, tools are removed from the provider call, and the response is converted back into tool-call form. Supported stop words and model-specific handling participate in that conversion. CodeAct can therefore consume a consistent action-conversion interface across native and emulated function calling, but malformed or empty provider output still needs validation.

Calls are synchronous and non-streaming in this completion path. Empty messages fail immediately; responses without choices raise `LLMNoResponseError`. The wrapper records latency, processes usage/cost, logs prompts and responses, and optionally writes raw completion artifacts. It removes `extra_body` for models outside the LiteLLM proxy path. Capability behavior comes from current model metadata, feature rules and configuration: provider compatibility should be checked in this code rather than inferred only from a model name.

## Retries and failures

`RetryMixin` uses configured exception types, attempt count and exponential backoff bounds. Shutdown can stop retrying. Before sleeping, it logs the retry and invokes the retry listener used by session/UI status handling. For `LLMNoResponseError`, an unset or zero temperature is changed to `1.0` on the next retry; a nonzero temperature is preserved. Consequently a retried request is not always identical to its first attempt.

Retries do not replace controller failure handling. Exhausted failures propagate to the controller, which maps recognized authentication, service, credit, policy and rate-limit errors to state/status behavior. Context-window failures are handled with the controller and condenser path described in [agent control](agent-loop.md).

## Accounting and diagnostics

Successful responses contribute latency and available input/output/cache token usage to per-service metrics. Cost processing tolerates missing or unsupported provider cost information, so a missing cost estimate should not be interpreted as proof that an external call was free. Conversation statistics aggregate model services, and the controller synchronizes spending before applying its budget flag.

Completion logging requires `log_completions_folder` and writes request/response artifacts, including separate emulated function-call representations when applicable. Those artifacts can contain task and repository content; use the configured location deliberately when diagnosing provider behavior.

Follow [llm.py](../../openhands/llm/llm.py), [llm_registry.py](../../openhands/llm/llm_registry.py), [retry_mixin.py](../../openhands/llm/retry_mixin.py), model feature rules and router implementations. Focused checks include `tests/unit/llm/test_llm.py`, `test_api_connection_error_retry.py`, `test_model_features.py` and `test_llm_fncall_converter.py`.

Related: [memory and context](memory-and-microagents.md), [configuration](../operations/configuration-and-deployment.md), [quickstart](../quickstart.md).
