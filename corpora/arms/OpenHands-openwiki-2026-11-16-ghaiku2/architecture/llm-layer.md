---
type: architecture-component
title: LLM Layer, Routing, Metrics, and Retries
description: How OpenHands wraps LiteLLM in an LLM class that adds retries, cost and token accounting, function-calling emulation for models without native tool calls, and prompt-caching checks; how LLMRegistry shares named LLM instances; how RouterLLM selects among several models; and how the async and streaming variants are built.
tags: [llm, litellm, retries, metrics, cost-accounting, function-calling, prompt-caching, llm-registry, routing, streaming]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:30:54.023Z
sources:
  - id: openwiki-source-2129d0084f64a3f5714baf90
    resource: repo://openhands/controller/agent_controller.py
  - id: openwiki-source-846d81305e1163067ac4815f
    resource: repo://openhands/llm/llm_registry.py
  - id: openwiki-source-30e374a20e6e9e785cf0d1b1
    resource: repo://openhands/llm/llm.py
  - id: openwiki-source-2dc66421e6fcfb9eabee2066
    resource: repo://openhands/llm/metrics.py
  - id: openwiki-source-fb5e2382ea09f5d9eb14b2ad
    resource: repo://openhands/llm/retry_mixin.py
  - id: openwiki-source-60f85e8ce99a26752e8a3812
    resource: repo://openhands/llm/router/base.py
  - id: openwiki-source-20a5ae5721db1ed6dfb11d0d
    resource: repo://openhands/llm/router/rule_based/impl.py
  - id: openwiki-source-161f3e3474385de1a14bca17
    resource: repo://openhands/llm/streaming_llm.py
generated: { by: "claude-code", at: "2026-11-16T18:30:54.023Z" }
---

# LLM Layer, Routing, Metrics, and Retries

Every model call in OpenHands goes through `LLM` (`openhands/llm/llm.py`). It is a thin, opinionated wrapper over LiteLLM's `completion`. It adds retries, request and response logging, cost and token accounting, emulation of function calling for models that do not support it, and capability checks. Agents never call LiteLLM directly. They receive an `LLM` from an `LLMRegistry`, and when a configuration needs several models, a `RouterLLM` takes its place.

## The LLM class

`LLM` (`llm.py`, class at ~L54) inherits from `RetryMixin` and `DebugMixin`. Its constructor (~L61) does the following:

- Binds a `partial` of `litellm.completion` (`self._completion`, ~L194) with the configured model, API key, base URL, API version, timeout (`config.timeout`), and seed. Keyword arguments from `LLMConfig` are applied here, so callers pass only messages and per-call options.
- Wraps that partial in a retry decorator (`@self.retry_decorator(...)`, ~L211-L220). The wrapper is the value of `self._completion`, and `completion` returns it (~L410).
- Calls `init_model_info` (~L417), which loads LiteLLM's model metadata and sets capability fields such as vision and function calling.

The public surface agents use is `completion(...)`, `get_token_count(...)`, `vision_is_active()`, `is_caching_prompt_active()`, `is_function_calling_active()`, and `format_messages_for_llm(...)`.

### Retry behavior

`RetryMixin.retry_decorator` (`openhands/llm/retry_mixin.py`, ~L18-L70) builds a Tenacity retry with:

- `stop_after_attempt(num_retries)` combined with a stop check for an exit request;
- an exponential wait with `retry_multiplier`, bounded by `retry_min_wait` and `retry_max_wait`;
- a `before_sleep` hook that calls `retry_listener` so the controller can show "retrying" status.

<!-- openwiki: broken internal link [/openwiki/architecture/agent-controller.md] link "/openwiki/architecture/agent-controller.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
The retried exceptions are fixed by `LLM_RETRY_EXCEPTIONS` (`llm.py` ~L44-L51): `APIConnectionError`, `RateLimitError`, `ServiceUnavailableError`, `litellm.Timeout`, `litellm.InternalServerError`, and `LLMNoResponseError`. Other errors, including authentication and context-window errors, are not retried. They propagate to the controller, which maps them to specific runtime statuses (see [Agent Controller and Step Loop](/openwiki/architecture/agent-controller.md)).

### Function-calling emulation

Many models do not accept a `tools` parameter. The wrapper handles this in one place (`llm.py` ~L226-L370):

- `mock_function_calling = not self.is_function_calling_active()` (~L226). `is_function_calling_active` reflects the model's feature flag, set from `get_features` during `init_model_info` (~L526).
- When mocking is on, prior tool-call messages are converted to plain text with `convert_fncall_messages_to_non_fncall_messages` (~L270), the `tools` argument is removed and remembered (~L284), and the response is converted back to tool calls with `convert_non_fncall_messages_to_fncall_messages` (~L348). The converter lives in `openhands/llm/fn_call_converter.py`.
- A response with no choices raises `LLMNoResponseError` so that it is retried.

The conversion is what lets the same agent code run against providers with and without native tool calls.

### Message formatting and prompt caching

<!-- openwiki: broken internal link [/openwiki/architecture/agents-and-prompting.md] link "/openwiki/architecture/agents-and-prompting.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`format_messages_for_llm` (~L803) converts `Message` objects to the dictionary shape LiteLLM expects. `is_caching_prompt_active` (~L565) returns true only when `caching_prompt` is enabled in config and the model's feature set reports prompt-cache support. Only Anthropic-style models need explicit cache breakpoints, so the check uses `get_features`. The CodeAct agent applies cache markers only when this returns true (see [Agents, Prompting, and Delegation](/openwiki/architecture/agents-and-prompting.md)).

## Accounting

`_post_completion` (`llm.py` ~L583) is called after each successful call (~L370). It computes the call cost through `_completion_cost` (~L733, which uses LiteLLM's `completion_cost`; errors yield zero cost), logs cost and accumulated cost, and records the latency and token usage.

`Metrics` (`openhands/llm/metrics.py`, class at ~L47) holds the running totals: `accumulated_cost`, lists of `Cost`, `ResponseLatency`, and `TokenUsage` records, and an optional `max_budget_per_task`. `add_cost` (~L130) rejects negative values. `add_token_usage` (~L143) records prompt tokens, completion tokens, cache read and write tokens, the context-window size, and the response ID. `merge` (~L180) adds another `Metrics` object's accumulated cost, cost records, and token usage into this one, and keeps the other's `max_budget_per_task` if this one has none.

<!-- openwiki: broken internal link [/openwiki/architecture/agent-controller.md] link "/openwiki/architecture/agent-controller.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
The controller reads the combined cost through the budget control flag (see [Agent Controller and Step Loop](/openwiki/architecture/agent-controller.md)). Delegate agents are constructed with the parent's `llm_registry`, so their metrics accumulate into the same totals.

## Registry

`LLMRegistry` (`openhands/llm/llm_registry.py`, class at ~L23) is a per-conversation map from service ID to `LLM` instance:

- `get_llm_from_agent_config(service_id, agent_config)` (~L71) resolves the agent's LLM config from the global config and returns the existing instance for that service ID, or creates one.
- `get_llm(service_id, config)` (~L82) raises if the same service ID is requested with a different config, so one ID always means one configuration.
- `_create_new_llm` (~L45) builds the `LLM`, stores it, and emits a `RegistryEvent` to registered subscribers.
- `get_router(agent_config)` (~L111) builds a `RouterLLM` for the agent's model-routing configuration.
- `request_extraneous_completion` (~L58) runs a one-off completion outside an agent. Its callers are conversation-title and summary generation (`openhands/utils/conversation_summary.py`) and the standalone conversation manager (`standalone_conversation_manager.py` ~L393).

## Routing

`RouterLLM` (`openhands/llm/router/base.py`, class at ~L17) subclasses `LLM` and overrides `completion` (~L106-L135). Each call goes through `_select_llm(messages)` (~L89), which returns a key, and then `_get_llm_by_key` (~L95) returns the underlying `LLM`. The router records the current model and the last routing decision, then delegates the call. Attribute access that the router does not define is forwarded to the currently selected LLM (`__getattr__`, ~L150).

<!-- openwiki: broken internal link [/openwiki/architecture/configuration.md] link "/openwiki/architecture/configuration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`_select_llm` is abstract in the base class. The concrete router in `openhands/llm/router/rule_based/impl.py` (`MultimodalRouter`, `_select_llm` at ~L26) sends a call to the primary model when any message contains an image or when the token limit has been exceeded (`max_token_exceeded`). `RouterLLM.from_config` (`router/base.py` ~L155-L185) looks up the router class by `agent_config.model_routing.router_name` in `ROUTER_LLM_REGISTRY` and raises if the name is unknown. The routing configuration itself is described in [Configuration Model](/openwiki/architecture/configuration.md).

## Async and streaming variants

- `AsyncLLM` (`openhands/llm/async_llm.py`, class at ~L17) subclasses `LLM` and adds `_async_completion`, a partial over LiteLLM's async completion, with the same retry policy.
- `StreamingLLM` (`openhands/llm/streaming_llm.py`, class at ~L11) subclasses `AsyncLLM` and binds a streaming partial with `stream=True` (~L17-L31). Its wrapper iterates chunks as they arrive.

## Capability detection

`get_features(model)` (`openhands/llm/model_features.py` ~L131) matches the model name against pattern lists to return `supports_function_calling`, `supports_reasoning_effort`, `supports_prompt_cache`, and `supports_stop_words`. Names are normalized first (`normalize_model_name`, ~L7). `vision_is_active` (~L530) combines the config flag `disable_vision` with LiteLLM's vision support check.

## Invariants and failure behavior

- Only the listed transient errors are retried. Retry count is `num_retries` and the wait is bounded by min and max.
- Cost is never negative; a failure to compute cost is recorded as zero rather than failing the call.
- A registry service ID is bound to one configuration; reusing it with a different config is an error.
- Routing decisions are recorded on the router, so the chosen model for the last call can be inspected.

## Extension seams

- New provider quirks go in `LLM.__init__` (parameter mapping) or in `model_features.py` pattern lists, not in agents.
- A new router is a `RouterLLM` subclass implementing `_select_llm`.
- A new retryable error is added to `LLM_RETRY_EXCEPTIONS`.

## Representative tests

- `tests/unit/llm/test_llm.py` covers completion behavior and metrics.
- `tests/unit/llm/test_api_connection_error_retry.py` covers the retry policy.
- `tests/unit/llm/test_llm_fncall_converter.py` covers the function-calling emulation.
- `tests/unit/llm/test_model_features.py` covers capability detection.
- `tests/unit/llm/test_acompletion.py` covers the async path.

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/agents-and-prompting.md] link "/openwiki/architecture/agents-and-prompting.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Agents, Prompting, and Delegation](/openwiki/architecture/agents-and-prompting.md)
<!-- openwiki: broken internal link [/openwiki/architecture/configuration.md] link "/openwiki/architecture/configuration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Configuration Model](/openwiki/architecture/configuration.md)
<!-- openwiki: broken internal link [/openwiki/architecture/memory-and-context.md] link "/openwiki/architecture/memory-and-context.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Memory, Condensation, and Microagents](/openwiki/architecture/memory-and-context.md)
