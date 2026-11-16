---
title: "Language Models"
---
## Overview

The model layer supplies a common completion interface for agents and supporting services. `LLMRegistry` owns model instances by service ID; `LLM` wraps LiteLLM with configuration, message conversion, retries, capability detection, logging, and usage metrics. [[Configuration]] describes how model groups are selected, and [[Agents and Tools]] owns the meaning of tool calls after a completion returns. This page follows the request between those boundaries.

Sources: [openhands/llm/llm_registry.py:23-56](repo://openhands/llm/llm_registry.py#L23-L56), [openhands/llm/llm.py:61-110](repo://openhands/llm/llm.py#L61-L110), [openhands/llm/llm.py:194-218](repo://openhands/llm/llm.py#L194-L218)

## Registry and service identity

The registry deep-copies application configuration, derives agent-to-model mappings, and creates an active agent LLM under service ID `agent`. A newly created model is stored and announced through `RegistryEvent`. Subscribers also receive the already initialized active model when subscribing. This lets consumers discover both the initial model and later supporting services without requiring those services to share one metrics object.

Sources: [openhands/llm/llm_registry.py:23-56](repo://openhands/llm/llm_registry.py#L23-L56), [openhands/llm/llm_registry.py:130-146](repo://openhands/llm/llm_registry.py#L130-L146)

`get_llm` reuses an existing service ID only with the same configuration; requesting a changed configuration for that ID raises `ValueError`. Creating a new ID requires an explicit configuration. `get_llm_from_agent_config` resolves the agent's model group but currently returns an existing service even if its configuration differs, with a TODO marking that behavior. Supporting text-only requests can use `request_extraneous_completion`, which creates its service without the retry listener and returns stripped content from the first choice.

Sources: [openhands/llm/llm_registry.py:58-106](repo://openhands/llm/llm_registry.py#L58-L106)

## Construct a provider request

`LLM` deep-copies its model configuration and creates metrics unless supplied. It initializes model information before binding completion arguments because that information can determine output-token limits. It also creates the completion-log directory when logging is enabled and loads a custom tokenizer when configured. The resulting LiteLLM partial binds the model, secret API-key value, base URL, API version, provider override, timeout, dropped-parameter behavior, seed, and sampling parameters.

Sources: [openhands/llm/llm.py:76-123](repo://openhands/llm/llm.py#L76-L123), [openhands/llm/llm.py:194-207](repo://openhands/llm/llm.py#L194-L207)

Compatibility adjustments are explicit branches in this checkout. An `openhands/` model name is rewritten to a `litellm_proxy/` name with the configured OpenHands proxy address. Model features control reasoning parameters, including a Gemini-specific thinking budget branch. For Claude Opus 4.1, the wrapper disables extended thinking and drops `top_p` when temperature is also supplied. These are implementation-specific rules, so inspect the branch for the actual model string when changing provider behavior.

Sources: [openhands/llm/llm.py:125-159](repo://openhands/llm/llm.py#L125-L159), [openhands/llm/llm.py:180-192](repo://openhands/llm/llm.py#L180-L192)

## Message and tool compatibility

The wrapper accepts OpenHands `Message` objects or message dictionaries and normalizes them to a list of provider dictionaries. Empty messages fail before the provider call. If native function calling is inactive and tools were supplied, it converts tool-call history into a prompt-based representation, removes native tools from the request, and applies supported stop words when enabled. After the completion, it converts the response back into function-call form, allowing the agent parser to keep one action interface.

Sources: [openhands/llm/llm.py:223-298](repo://openhands/llm/llm.py#L223-L298), [openhands/llm/llm.py:335-357](repo://openhands/llm/llm.py#L335-L357)

Before sending the request, the wrapper logs the prompt and assigns LiteLLM's global `modify_params` flag. Unlike the per-call `drop_params`, that setting is global. It removes `extra_body` unless the configured model uses `litellm_proxy`, measures elapsed time around the non-streaming provider call, and records latency with the response ID. A response without any choices raises `LLMNoResponseError`, which is eligible for the configured retry handling.

Sources: [openhands/llm/llm.py:300-333](repo://openhands/llm/llm.py#L300-L333), [openhands/llm/llm.py:359-364](repo://openhands/llm/llm.py#L359-L364)

## Capabilities and limits

Model information is obtained from LiteLLM, or from `/v1/model/info` for a LiteLLM proxy. Name-based fallback attempts try the configured name without a colon suffix and then its last path component. Explicit input and output token limits take precedence over inferred values; output inference includes a special Claude 3.7 Sonnet limit. Native tool support defaults to centralized model features but can be overridden through `native_tool_calling`.

Sources: [openhands/llm/llm.py:417-478](repo://openhands/llm/llm.py#L417-L478), [openhands/llm/llm.py:494-528](repo://openhands/llm/llm.py#L494-L528)

Vision requires both an enabled configuration and detected support. Support checks include a manual `OPENHANDS_FORCE_VISION` override and LiteLLM/model-information checks, including names stripped of proxy prefixes. This capability enters message processing and web image validation; changing a prompt alone does not bypass the model-layer capability decision.

Sources: [openhands/llm/llm.py:530-563](repo://openhands/llm/llm.py#L530-L563), [openhands/agenthub/codeact_agent/codeact_agent.py:282-288](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L282-L288), [openhands/server/session/session.py:353-368](repo://openhands/server/session/session.py#L353-L368)

## Retries and observability

The retry decorator uses configured exception types, exponential waits, an attempt limit, and the process shutdown condition. It reraises the final failure. Before sleeping, it logs the failure and calls the retry listener when present. For `LLMNoResponseError`, a zero or absent per-call temperature is changed to `1.0` for the next attempt; other temperatures remain unchanged. Retry metadata is attached to exceptions for downstream reporting.

Sources: [openhands/llm/llm.py:211-218](repo://openhands/llm/llm.py#L211-L218), [openhands/llm/retry_mixin.py:28-100](repo://openhands/llm/retry_mixin.py#L28-L100)

Post-processing records prompt and completion tokens, cache-read and cache-write usage, available context-window size, response ID, and cost. Cost calculation failure falls back to zero in this stage. Optional completion logs include messages, response, arguments, timestamp, and calculated cost; prompt-based tool conversion additionally preserves converted forms. [[Controller and Event Stream]] uses combined model costs for budget control, so service-level metrics contribute to task-level execution decisions.

Sources: [openhands/llm/llm.py:369-404](repo://openhands/llm/llm.py#L369-L404), [openhands/llm/llm.py:583-666](repo://openhands/llm/llm.py#L583-L666), [openhands/controller/state/state_tracker.py:260-268](repo://openhands/controller/state/state_tracker.py#L260-L268)

## Model routing

The registry returns the main agent LLM directly for `noop_router`; otherwise it constructs a registered `RouterLLM`. Routing selects a model from the incoming messages, records the active model and routing decision, and delegates completion to that model. The multimodal router uses the primary model for image-containing messages or when the secondary context limit has been exceeded, otherwise the configured `secondary_model`. Once the secondary token limit is exceeded, its state keeps subsequent calls on the primary path. Missing secondary configuration or unknown router names raise `ValueError`.

Sources: [openhands/llm/llm_registry.py:111-128](repo://openhands/llm/llm_registry.py#L111-L128), [openhands/llm/router/base.py:105-135](repo://openhands/llm/router/base.py#L105-L135), [openhands/llm/router/base.py:154-164](repo://openhands/llm/router/base.py#L154-L164), [openhands/llm/router/rule_based/impl.py:9-70](repo://openhands/llm/router/rule_based/impl.py#L9-L70)
