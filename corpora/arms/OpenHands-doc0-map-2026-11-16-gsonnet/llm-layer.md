---
title: "LLM Layer"
---
## Overview

Every model call in OpenHands goes through the `LLM` class, a thin wrapper over LiteLLM. It builds one `litellm.completion` partial from an `LLMConfig`, wraps it in a retry decorator, optionally emulates function calling for models that lack it, and records cost, latency and token usage in a `Metrics` object. `LLMRegistry` hands out the LLM instances by service id, and `RouterLLM` lets several of them act as one. Agents call `llm.completion(...)` ([[CodeAct Agent and Agent Catalogue]]); the cost recorded here is what the budget limit in the [[Agent Controller Loop]] reads. The fields of `LLMConfig` are covered in [[Configuration]].

Sources: [openhands/llm/llm.py:54-115](repo://openhands/llm/llm.py#L54-L115), [openhands/llm/llm.py:194-219](repo://openhands/llm/llm.py#L194-L219)

## Building the completion function

The `LLM` constructor deep-copies the config, creates `Metrics` for the model unless one is passed, and calls `init_model_info`. That method fills `model_info` from LiteLLM (for `litellm_proxy/` models it queries `{base_url}/v1/model/info` first) and, when not set explicitly, takes `max_input_tokens` and `max_output_tokens` from it, with a 64,000 output cap for Claude 3.7 Sonnet. Function calling is on when the config's `native_tool_calling` says so, and otherwise when `get_features(model).supports_function_calling` is true.

Sources: [openhands/llm/llm.py:76-110](repo://openhands/llm/llm.py#L76-L110), [openhands/llm/llm.py:417-528](repo://openhands/llm/llm.py#L417-L528)

It then assembles keyword arguments for LiteLLM with several model-specific rules, each commented in place.

Sources: [openhands/llm/llm.py:112-207](repo://openhands/llm/llm.py#L112-L207)

- A model named `openhands/<name>` is rewritten to `litellm_proxy/<name>` with the All Hands proxy as `base_url`.
- Reasoning models get `reasoning_effort` and lose `temperature` and `top_p`; for `gemini-2.5-pro` a low or unset effort becomes a 128-token thinking budget.
- Azure models use `max_tokens` rather than `max_completion_tokens`.
- AWS credentials, safety settings for Mistral and Gemini, and `thinking` disabled for Opus 4.1 are added where they apply.

Sources: [openhands/llm/llm.py:112-207](repo://openhands/llm/llm.py#L112-L207)

## Calling the model

The inner `wrapper` is what `llm.completion` runs.

Sources: [openhands/llm/llm.py:219-258](repo://openhands/llm/llm.py#L219-L258)

1. Normalises arguments: converts `Message` objects to dicts with `format_messages_for_llm`.
2. If function calling is not active and tools were passed, converts the messages with `convert_fncall_messages_to_non_fncall_messages`, adds the stop word `</function` when the model supports stop words and `disable_stop_word` is off, and removes `tools` from the call.
3. Rejects an empty message list, logs the prompt and calls the unwrapped LiteLLM function, timing it.
4. Converts a text reply back into a tool call with `convert_non_fncall_messages_to_fncall_messages` when it emulated.
5. Raises `LLMNoResponseError` if there are no choices, then logs the response and calls `_post_completion` to compute cost.
6. With `log_completions` on, writes the request and response to a JSON file in `log_completions_folder`.

Sources: [openhands/llm/llm.py:243-340](repo://openhands/llm/llm.py#L243-L340), [openhands/llm/llm.py:341-405](repo://openhands/llm/llm.py#L341-L405)

`extra_body` is dropped unless the model goes through `litellm_proxy`.

Sources: [openhands/llm/llm.py:308-310](repo://openhands/llm/llm.py#L308-L310)

## Retries

`RetryMixin.retry_decorator` builds a `tenacity` retry with exponential wait (`retry_multiplier`, `retry_min_wait`, `retry_max_wait`), stopping after `num_retries` attempts or when the process is shutting down. `LLM_RETRY_EXCEPTIONS` lists what is retried: connection errors, rate limits, service-unavailable, timeouts, internal server errors and `LLMNoResponseError`. Before each sleep the mixin logs, calls the `retry_listener` (which the server uses to tell the client) and, for `LLMNoResponseError` at temperature 0, raises the temperature to 1.0 for the next attempt. `log_retry_attempt` attaches `retry_attempt` and `max_retries` to the exception, which is how the controller tells a final rate-limit failure from one that is still being retried.

Sources: [openhands/llm/retry_mixin.py:18-100](repo://openhands/llm/retry_mixin.py#L18-L100), [openhands/llm/llm.py:43-51](repo://openhands/llm/llm.py#L43-L51), [openhands/llm/llm.py:211-218](repo://openhands/llm/llm.py#L211-L218)

## Model features

`model_features.get_features` returns four flags for a model name using glob tables: `supports_function_calling`, `supports_reasoning_effort`, `supports_prompt_cache` and `supports_stop_words` (true unless the model matches an exclusion list such as `o1*`). Matching works on a normalised name: lowercased, with provider prefixes stripped to the basename and any Ollama-style `:tag` and `-gguf` suffix removed; a pattern containing `/` is matched against the whole lowercase string instead. Prompt caching, for example, is limited to the Claude 3 and 4 families in `PROMPT_CACHE_PATTERNS`, and `is_caching_prompt_active` reads it.

Sources: [openhands/llm/model_features.py:7-60](repo://openhands/llm/model_features.py#L7-L60), [openhands/llm/model_features.py:107-139](repo://openhands/llm/model_features.py#L107-L139)

## Function-calling emulation

For models outside `FUNCTION_CALLING_PATTERNS`, `fn_call_converter` rewrites the conversation to plain text. `convert_fncall_messages_to_non_fncall_messages` appends a description of the tools to the system prompt, and renders each tool call as `<function=name>` with `<parameter=...>` children (`convert_tool_call_to_string`). On the way back, `convert_non_fncall_messages_to_fncall_messages` removes the suffix and parses the model's reply into a real tool call with a counter-based id. The `</function` stop word cuts the reply right after the call. An in-context example is added unless the model is `openhands-lm` or `devstral`.

Sources: [openhands/llm/fn_call_converter.py:405-437](repo://openhands/llm/fn_call_converter.py#L405-L437), [openhands/llm/fn_call_converter.py:478-500](repo://openhands/llm/fn_call_converter.py#L478-L500), [openhands/llm/fn_call_converter.py:727-745](repo://openhands/llm/fn_call_converter.py#L727-L745), [openhands/llm/llm.py:262-292](repo://openhands/llm/llm.py#L262-L292)

## Cost and metrics

`_post_completion` computes the cost of each response, builds a log line with cost, latency and token counts (including cache-hit and cache-write tokens), and records a `TokenUsage`. `_completion_cost` first takes the cost from the `x-litellm-response-cost` header, then from `litellm.completion_cost` (with `input_cost_per_token` and `output_cost_per_token` from the config if both are set), then retries with the model name minus its provider prefix; if all fail it sets `cost_metric_supported` to false and reports 0.

Sources: [openhands/llm/llm.py:583-666](repo://openhands/llm/llm.py#L583-L666), [openhands/llm/llm.py:733-775](repo://openhands/llm/llm.py#L733-L775)

`Metrics` tracks `accumulated_cost` with the individual `Cost` entries, `max_budget_per_task`, a list of `ResponseLatency` and a `TokenUsage` per call plus their accumulated total. Events carry it as `llm_metrics`, which is why the serializer rebuilds it.

Sources: [openhands/llm/metrics.py:47-72](repo://openhands/llm/metrics.py#L47-L72), [openhands/events/serialization/event.py:67-90](repo://openhands/events/serialization/event.py#L67-L90)

## Registry and routing

`LLMRegistry` is created from the whole config. It creates an `active_agent_llm` under the service id `agent` for the chosen agent class, and `get_llm(service_id, config)` returns the same instance for a repeated id, raising `ValueError` if the id is reused with a different config. `get_llm_from_agent_config` does the same from an `AgentConfig`. `request_extraneous_completion` makes a one-off call on a separately named service, which is how features outside the agent loop use a model. `subscribe` registers a callback that is notified of every new LLM, which is how the cost of each service is collected.

Sources: [openhands/llm/llm_registry.py:23-109](repo://openhands/llm/llm_registry.py#L23-L109), [openhands/llm/llm_registry.py:130-146](repo://openhands/llm/llm_registry.py#L130-L146)

`get_router(agent_config)` returns the plain agent LLM when `model_routing.router_name` is `noop_router`, otherwise builds a `RouterLLM`. A `RouterLLM` is itself an `LLM`: it holds the primary LLM plus every LLM in `llms_for_routing`, and its `completion` calls `_select_llm(messages)` to pick a key, then forwards the call to that LLM. Other attributes fall through to the current LLM through `__getattr__`. `from_config` looks the router class up in `ROUTER_LLM_REGISTRY`.

Sources: [openhands/llm/llm_registry.py:111-128](repo://openhands/llm/llm_registry.py#L111-L128), [openhands/llm/router/base.py:17-60](repo://openhands/llm/router/base.py#L17-L60), [openhands/llm/router/base.py:88-164](repo://openhands/llm/router/base.py#L88-L164)

The one built-in router is `multimodal_router`, marked experimental in its README. `MultimodalRouter` requires an LLM named `secondary_model`. It routes to the primary model when any message contains an image, or when the messages exceed the secondary model's `max_input_tokens` (after which it keeps choosing the primary), and otherwise to the secondary model.

Sources: [openhands/llm/router/rule_based/impl.py:9-74](repo://openhands/llm/router/rule_based/impl.py#L9-L74), [openhands/llm/router/README.md:1-16](repo://openhands/llm/router/README.md#L1-L16)
