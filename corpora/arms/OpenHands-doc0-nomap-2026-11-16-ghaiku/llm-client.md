---
title: "LLM Client"
---
## Overview

`LLM` wraps a litellm `completion` call for one model configuration. Agents and condensers call `llm.completion(messages=..., tools=...)` and get a `ModelResponse` back. The wrapper adds three things around the raw call: retries on transient errors, conversion of tool calls for models without native function calling, and accounting of cost, latency and tokens in a `Metrics` object. The callers are described in [[CodeAct Agent]] and [[Condenser Catalogue]].

Sources: [openhands/llm/llm.py:54-61](repo://openhands/llm/llm.py#L54-L61), [openhands/llm/llm.py:194-219](repo://openhands/llm/llm.py#L194-L219), [openhands/llm/llm.py:410-415](repo://openhands/llm/llm.py#L410-L415)

## The call

The raw function is a `functools.partial` over litellm's `completion`, with the configured model, seed and keyword arguments fixed. The public `completion` property returns the retry-wrapped function, not the raw one. The raw function is kept as `_completion_unwrapped` so the wrapper can call it.

Sources: [openhands/llm/llm.py:194-209](repo://openhands/llm/llm.py#L194-L209), [openhands/llm/llm.py:410-415](repo://openhands/llm/llm.py#L410-L415)

The wrapper accepts the messages either as keyword arguments or as the second positional argument, and it ignores a model argument passed by a caller. A `Message` object is converted to the dictionary format before the call. An empty message list raises `ValueError`.

Sources: [openhands/llm/llm.py:219-258](repo://openhands/llm/llm.py#L219-L258), [openhands/llm/llm.py:295-298](repo://openhands/llm/llm.py#L295-L298)

## Function calling

A model is treated as having native function calling when `is_function_calling_active` says so. Otherwise, when the caller passes tools, the wrapper rewrites the messages into a text prompt that describes the tools. It also adds stop words when the model supports them and the config does not disable them. The tools are removed from the request, and `tool_choice` is dropped, except that `openhands-lm` gets `none`.

Sources: [openhands/llm/llm.py:226-292](repo://openhands/llm/llm.py#L226-L292), [openhands/llm/llm.py:576-582](repo://openhands/llm/llm.py#L576-L582)

The conversion itself lives in `fn_call_converter`. It describes each tool as text and writes a single example for the model to follow, except for the models that are named as not needing one. The reply is converted back to tool-call form after the call.

Sources: [openhands/llm/fn_call_converter.py:439-478](repo://openhands/llm/fn_call_converter.py#L439-L478), [openhands/llm/llm.py:262-275](repo://openhands/llm/llm.py#L262-L275), [openhands/llm/llm.py:338-357](repo://openhands/llm/llm.py#L338-L357)

Model features are looked up by name patterns. `get_features` returns the flags for function calling, reasoning effort, prompt caching and stop words for a model name.

Sources: [openhands/llm/model_features.py:33-40](repo://openhands/llm/model_features.py#L33-L40), [openhands/llm/model_features.py:54-58](repo://openhands/llm/model_features.py#L54-L58), [openhands/llm/model_features.py:131-135](repo://openhands/llm/model_features.py#L131-L135)

## Retries

The retry decorator is applied to the wrapper with the configured retry count, minimum and maximum wait and multiplier. It retries on `APIConnectionError`, `RateLimitError`, `ServiceUnavailableError`, timeouts, internal server errors and an empty response. The wait grows exponentially between attempts, and a listener is told about each retry, so the UI can show it.

Sources: [openhands/llm/llm.py:44-51](repo://openhands/llm/llm.py#L44-L51), [openhands/llm/llm.py:211-218](repo://openhands/llm/llm.py#L211-L218), [openhands/llm/retry_mixin.py:18-70](repo://openhands/llm/retry_mixin.py#L18-L70)

The retry mixin stops after the configured number of attempts, or when the process is shutting down. Its wait is exponential between the minimum and maximum set in the config.

Sources: [openhands/llm/retry_mixin.py:54-70](repo://openhands/llm/retry_mixin.py#L54-L70)

## Response checks and accounting

A response with no choices raises `LLMNoResponseError`, which is one of the retried errors. A successful response goes to `_post_completion`, which computes the cost of the call and records it. The response latency and token usage are recorded in `Metrics` from the same response.

Sources: [openhands/llm/llm.py:359-370](repo://openhands/llm/llm.py#L359-L370), [openhands/llm/llm.py:583-600](repo://openhands/llm/llm.py#L583-L600), [openhands/llm/llm.py:331-334](repo://openhands/llm/llm.py#L331-L334), [openhands/llm/llm.py:653-656](repo://openhands/llm/llm.py#L653-L656)

`Metrics` keeps the accumulated cost, the list of costs, the response latencies and the token usages for one model. The controller reads the accumulated cost to enforce the budget, as [[Agent Controller]] describes.

Sources: [openhands/llm/metrics.py:7-21](repo://openhands/llm/metrics.py#L7-L21), [openhands/llm/metrics.py:47-80](repo://openhands/llm/metrics.py#L47-L80), [openhands/controller/state/state_tracker.py:260-268](repo://openhands/controller/state/state_tracker.py#L260-L268)

## Registry and routing

`LLMRegistry` holds the LLM instances for the conversation. `get_llm` builds an LLM from an agent config, and `get_router` returns either the main LLM or a `RouterLLM`, depending on the agent's model-routing config. Subscribers are notified when an LLM is created.

Sources: [openhands/llm/llm_registry.py:23-30](repo://openhands/llm/llm_registry.py#L23-L30), [openhands/llm/llm_registry.py:45-56](repo://openhands/llm/llm_registry.py#L45-L56), [openhands/llm/llm_registry.py:82-89](repo://openhands/llm/llm_registry.py#L82-L89), [openhands/llm/llm_registry.py:111-128](repo://openhands/llm/llm_registry.py#L111-L128), [openhands/llm/llm_registry.py:130-145](repo://openhands/llm/llm_registry.py#L130-L145)

The agent calls `get_router` in its constructor, so a routed agent uses the router as its model. Condensers get their LLM through the same registry.

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:94-96](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L94-L96)
