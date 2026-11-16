---
type: architecture
title: LLM Layer
description: How OpenHands wraps LiteLLM in the LLM class, applies retries and metrics, emulates function calling for models without native tool support, registers shared LLM services, and routes calls between models through RouterLLM.
tags: [llm, litellm, retries, function-calling, model-routing, metrics, registry]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T11:08:31.416Z
sources:
  - id: openwiki-source-4053869873aed42cfc26f7fb
    resource: repo://openhands/llm/fn_call_converter.py
  - id: openwiki-source-846d81305e1163067ac4815f
    resource: repo://openhands/llm/llm_registry.py
  - id: openwiki-source-30e374a20e6e9e785cf0d1b1
    resource: repo://openhands/llm/llm.py
  - id: openwiki-source-7cd57427f21d6e3130335854
    resource: repo://openhands/llm/model_features.py
  - id: openwiki-source-fb5e2382ea09f5d9eb14b2ad
    resource: repo://openhands/llm/retry_mixin.py
  - id: openwiki-source-60f85e8ce99a26752e8a3812
    resource: repo://openhands/llm/router/base.py
  - id: openwiki-source-20a5ae5721db1ed6dfb11d0d
    resource: repo://openhands/llm/router/rule_based/impl.py
generated: { by: "claude-code", at: "2026-11-16T11:08:31.416Z" }
---

# LLM Layer

Every agent talks to a model through the `LLM` class in `openhands/llm/llm.py`. That class wraps
LiteLLM's `completion` with retry policy, metrics, prompt-format adaptation, and cost accounting.
Other classes build on it: `AsyncLLM` for coroutine callers, a streaming variant, a `RouterLLM`
that picks between several configured models, and an `LLMRegistry` that owns instances shared by
the agent and its helpers. The configuration that feeds the layer lives in
[Configuration System](configuration.md).

## Construction and the completion wrapper

`LLM.__init__` (`llm.py:61`) takes an `LLMConfig` and creates a `Metrics` object, either the one
passed in or a fresh one keyed by the model name (`llm.py:80-81`). It then builds the call to
LiteLLM's `completion`, with the configured model, credentials, base URL, temperature, seed, and
other provider options.

The public `completion` attribute is a decorated wrapper (`llm.py:213-219`) with these steps:

1. **Message normalization.** `Message` objects are converted to LiteLLM dicts with
   `format_messages_for_llm`. Positional arguments are accepted in LiteLLM's style, but the
   configured model always wins.
2. **Function-calling emulation.** If the model does not support native tool calls, the tools are
   removed from the request and rendered as text in the prompt (`llm.py:226-290`). The stop
   sequence `</function` is added when the model supports stop words (`fn_call_converter.py:56`).
   The reply is parsed back into tool calls on the way out.
3. **Retry.** The call is wrapped in `retry_decorator` (`retry_mixin.py:18-70`), which retries the
   exception classes in `LLM_RETRY_EXCEPTIONS` (`llm.py:44-51`): connection errors, rate limits,
   service-unavailable, timeouts, internal server errors, and `LLMNoResponseError`. Backoff uses
   `retry_min_wait`, `retry_max_wait`, and `retry_multiplier`, with `num_retries` attempts
   (`core/config/llm_config.py:62-63`). When the failure is an empty response at temperature 0,
   the retry raises the temperature to 1.0 so the next attempt differs.
4. **Post-processing.** `_post_completion` (`llm.py:583`) logs cost and usage through `Metrics`.
   Response latency is recorded separately when the response arrives (`llm.py:333`), and
   `_completion_cost` computes the cost of each call.

`is_function_calling_active` (`llm.py:576`) reports the cached result of the model feature check.
Feature flags come from `openhands/llm/model_features.py` (`ModelFeatures` at line 54), which
matches model names against pattern lists. Each model can therefore opt in or out of native tool
calling, stop words, reasoning-effort parameters, and prompt caching without code changes.

## Shared instances: `LLMRegistry`

`LLMRegistry` (`openhands/llm/llm_registry.py`) owns one `LLM` per service ID.

- `get_llm(service_id, config)` (`llm_registry.py:82-106`) returns the existing instance for the ID.
  Asking for the same ID with a different config is an error, so a service cannot silently change
  model mid-conversation. A new ID creates a new instance.
- `get_llm_from_agent_config` supplies the agent's LLM (see the `Agent` constructor in
  [Agents, Tools, and Microagents](agents-and-tools.md)).
- `get_router` (`llm_registry.py:111-128`) returns either the plain agent LLM, when the router name is
  `noop_router`, or a `RouterLLM` built from `model_routing`.
- Listeners subscribe with `subscribe` and receive `RegistryEvent` notifications. The conversation
  statistics object uses this to total costs across every LLM a conversation touches.

## Model routing

`ModelRoutingConfig` (`openhands/core/config/model_routing_config.py:6-15`) has a `router_name`, which
defaults to `noop_router`, and `llms_for_routing`, a map from names to `LLMConfig`.

`RouterLLM` (`openhands/llm/router/base.py:17`) is an `LLM` subclass that holds several underlying
LLMs in `available_llms`. Its `completion` property (`base.py:106-135`) calls the abstract
`_select_llm(messages)` to choose a key, records the choice as `_last_routing_decision`, and
forwards the call to that LLM. `RouterLLM.from_config` (`base.py:155-164`) looks up the class by
`router_name` in `ROUTER_LLM_REGISTRY`.

The shipped router is `MultimodalRouter` (`openhands/llm/router/rule_based/impl.py:9`). It sends a
request to the primary model when any message contains an image, or when the messages would not fit
the secondary model's input-token limit. Otherwise it uses the model configured under
`secondary_model` (`impl.py:10`, `impl.py:26-60`). Routing decisions are made per call, so a
conversation can alternate between models.

## Async and streaming variants

- `AsyncLLM` (`openhands/llm/async_llm.py:17`) provides `async_completion` with the same retry and
  metrics behavior, and supports cancellation through a stop check.
- The streaming module (`openhands/llm/streaming_llm.py`) enables `stream=True` on the wrapped call
  and reuses the retry exception set.

## Failure behavior

- Transient provider failures are retried up to `num_retries` with exponential backoff. The final
  failure is re-raised to the controller, which classifies it for the user (see
  [Agent Controller and Step Loop](agent-controller.md)).
- Authentication, bad-request, and budget errors are not in the retry set, so they fail on the first
  attempt.
- Context-window overflow is not retried here. The controller either requests history condensation
  or stops, depending on configuration.
- In function-calling emulation, a malformed tool call from the model becomes an error observation
  so the model can try again, rather than an exception.

## Operational consequences

- Retry settings multiply: with `num_retries` set high and a large `retry_multiplier`, a rate-limited
  request can wait a long time before failing. Tune both for the provider's limits.
- Costs are attributed per `Metrics` object. Models shared across services share a registry entry,
  so a single cost total covers all calls.
- Changing a service's config in place is rejected; use a new service ID.

## Extension seams

- New provider: add patterns to `model_features.py` for the capability flags, and configuration in
  `llm_config.py`. LiteLLM handles the provider call.
- New routing policy: subclass `RouterLLM`, implement `_select_llm`, and register it in
  `ROUTER_LLM_REGISTRY`, then select it with `router_name`.
- New retry trigger: extend `LLM_RETRY_EXCEPTIONS`. Only add exceptions that are safe to repeat.

## Tests

`tests/unit/llm/` covers the LLM wrapper, retry behavior, and function-call conversion. The
registry is covered by `tests/unit/test_llm_registry.py`.

## Related pages

- [Configuration System](configuration.md)
- [Agents, Tools, and Microagents](agents-and-tools.md)
- [Memory, Context Condensation, and Conversation Memory](../workflows/memory-and-condensation.md)
