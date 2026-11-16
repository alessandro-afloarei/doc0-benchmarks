---
title: "LLM Layer"
---
## Overview

Every model call in OpenHands goes through the `LLM` class in `openhands/llm/llm.py`, a wrapper around LiteLLM's `completion`. It fixes the provider parameters once from the `LLMConfig`, retries transient failures, emulates function calling for models that lack it, logs prompts and responses, and records cost, latency and token usage in a `Metrics` object. Agents call `llm.completion(messages=..., tools=...)` and get back a LiteLLM `ModelResponse` whose tool calls look the same whatever model answered.

Sources: [openhands/llm/llm.py:54-82](repo://openhands/llm/llm.py#L54-L82), [openhands/llm/llm.py:409-415](repo://openhands/llm/llm.py#L409-L415)

Around that class sit the `LLMRegistry`, which creates and hands out one `LLM` per service in a conversation; `ConversationStats`, which collects and persists their metrics; and `RouterLLM`, which can pick a different model per call. The config fields used here are listed in [[Configuration]].

Sources: [openhands/llm/llm_registry.py:23-56](repo://openhands/llm/llm_registry.py#L23-L56), [openhands/server/services/conversation_stats.py:14-32](repo://openhands/server/services/conversation_stats.py#L14-L32), [openhands/llm/router/base.py:17-29](repo://openhands/llm/router/base.py#L17-L29)

## Building the completion call

The constructor deep-copies the config, looks up model information, and assembles keyword arguments for a `functools.partial` over `litellm_completion` holding the model, API key, base URL, API version, custom provider, timeout, `drop_params` and seed. Model-specific adjustments happen here, once:

Sources: [openhands/llm/llm.py:194-207](repo://openhands/llm/llm.py#L194-L207)

- `temperature` and `max_completion_tokens` are always passed, `top_k` and `top_p` when set.
- A model named `openhands/<name>` is rewritten to `litellm_proxy/<name>` against the All Hands LLM proxy.
- Models that support reasoning effort get `reasoning_effort` and lose `temperature` and `top_p`; Gemini 2.5 Pro with low or no effort gets a 128-token thinking budget instead.
- Azure models get `max_tokens` instead of `max_completion_tokens`; Mistral and Gemini get `safety_settings`; AWS credentials are passed for Bedrock.
- Claude Opus 4.1 has thinking disabled and drops `top_p` when `temperature` is also set.

Sources: [openhands/llm/llm.py:107-207](repo://openhands/llm/llm.py#L107-L207)

`init_model_info` fills in what the config leaves blank. It asks a LiteLLM proxy's `/v1/model/info` endpoint for `litellm_proxy/` models and otherwise LiteLLM's model table, then sets `max_input_tokens` and `max_output_tokens` from it (Claude 3.7 Sonnet is capped at 64,000 output tokens, which the code notes would otherwise need an extra header). It also decides whether native function calling is on: `native_tool_calling` in the config wins, otherwise the model's detected features decide.

Sources: [openhands/llm/llm.py:417-528](repo://openhands/llm/llm.py#L417-L528)

## Model features

`get_features(model)` returns four flags by matching the model name against glob pattern lists: `supports_function_calling`, `supports_reasoning_effort`, `supports_prompt_cache`, and `supports_stop_words` (true unless the model is in a list that rejects stop words, such as the o1 family). Names are normalized first: lower-cased, provider prefixes like `openrouter/` or `litellm_proxy/` dropped, Ollama-style `:tag` variants and a `-gguf` suffix removed. A pattern containing `/` is matched against the full name instead, so a rule can target one provider.

Sources: [openhands/llm/model_features.py:7-58](repo://openhands/llm/model_features.py#L7-L58), [openhands/llm/model_features.py:131-139](repo://openhands/llm/model_features.py#L131-L139)

The flags drive behaviour elsewhere: `is_caching_prompt_active` is true only when `caching_prompt` is set and the model needs explicit cache breakpoints (the code notes only Anthropic models do), and `vision_is_active` combines `disable_vision` with LiteLLM's vision support.

Sources: [openhands/llm/llm.py:530-581](repo://openhands/llm/llm.py#L530-L581)

## One completion

```mermaid
sequenceDiagram
  participant Agent
  participant Wrapper as LLM.completion
  participant Conv as fn_call_converter
  participant LiteLLM as litellm.completion
  Agent->>Wrapper: messages, tools
  Wrapper->>Wrapper: format Message objects to dicts
  alt no native function calling
    Wrapper->>Conv: convert_fncall_messages_to_non_fncall_messages
    Wrapper->>Wrapper: add stop words, drop tools
  end
  Wrapper->>LiteLLM: completion(**kwargs)
  LiteLLM-->>Wrapper: ModelResponse
  alt no native function calling
    Wrapper->>Conv: convert_non_fncall_messages_to_fncall_messages
  end
  Wrapper->>Wrapper: record latency, cost, tokens; log
  Wrapper-->>Agent: ModelResponse with tool_calls
```

Sources: [openhands/llm/llm.py:219-310](repo://openhands/llm/llm.py#L219-L310), [openhands/llm/llm.py:328-405](repo://openhands/llm/llm.py#L328-L405)

The wrapper accepts `Message` objects or plain dicts and formats `Message` objects with `format_messages_for_llm`. It refuses an empty message list, sets LiteLLM's `modify_params` from the config, and drops `extra_body` unless the model goes through a LiteLLM proxy. After the call it records the latency against the response id and fails with `LLMNoResponseError` if the response has no choices, which the code notes has only been seen with Gemini.

Sources: [openhands/llm/llm.py:223-256](repo://openhands/llm/llm.py#L223-L256), [openhands/llm/llm.py:295-364](repo://openhands/llm/llm.py#L295-L364)

With `log_completions`, each call is written to a JSON file in `log_completions_folder` holding the messages, response, arguments, timestamp and cost; for emulated function calling it holds both the text exchange and the converted one. Separately, at debug level `log_prompt` and `log_response` write every prompt and reply through dedicated loggers under `logs/llm/<session>`.

Sources: [openhands/llm/llm.py:373-403](repo://openhands/llm/llm.py#L373-L403), [openhands/llm/debug_mixin.py:13-45](repo://openhands/llm/debug_mixin.py#L13-L45), [openhands/core/logger.py:436-442](repo://openhands/core/logger.py#L436-L442)

## Function calling for models without tools

When native function calling is off and the call has tools, `convert_fncall_messages_to_non_fncall_messages` rewrites the conversation into plain text. The system message gets a suffix listing every tool and the reply format, `<function=name>` with one `<parameter=name>value</parameter>` per argument, ending in `</function>`, with the reminder to call only one function at a time. The first user message gets an in-context example built from the available tools (skipped for `openhands-lm` and `devstral` models), assistant tool calls become that text format, and tool results become user messages prefixed `EXECUTION RESULT of [name]:`.

Sources: [openhands/llm/fn_call_converter.py:1-56](repo://openhands/llm/fn_call_converter.py#L1-L56), [openhands/llm/fn_call_converter.py:478-530](repo://openhands/llm/fn_call_converter.py#L478-L530), [openhands/llm/fn_call_converter.py:560-620](repo://openhands/llm/fn_call_converter.py#L560-L620), [openhands/llm/llm.py:262-292](repo://openhands/llm/llm.py#L262-L292)

The wrapper then removes `tools` from the call, adds the stop word `</function` when the model supports stop words, and after the response runs `convert_non_fncall_messages_to_fncall_messages` to parse the text back into a proper `tool_calls` entry with a generated id, validating parameters against the tool schema. The agent never sees the difference: CodeAct's `response_to_actions` handles both kinds of response the same way, as [[Agents and CodeAct]] describes.

Sources: [openhands/llm/llm.py:276-292](repo://openhands/llm/llm.py#L276-L292), [openhands/llm/llm.py:338-357](repo://openhands/llm/llm.py#L338-L357), [openhands/llm/fn_call_converter.py:398-402](repo://openhands/llm/fn_call_converter.py#L398-L402), [openhands/llm/fn_call_converter.py:727-760](repo://openhands/llm/fn_call_converter.py#L727-L760)

## Retries

The wrapper is decorated by `RetryMixin.retry_decorator`, built on `tenacity`. It retries only `APIConnectionError`, `RateLimitError`, `ServiceUnavailableError`, `Timeout`, `InternalServerError` and `LLMNoResponseError`, up to `num_retries` attempts (default 5), with exponential waits between `retry_min_wait` and `retry_max_wait` seconds scaled by `retry_multiplier`. It also stops when the process is shutting down, and re-raises the last error.

Sources: [openhands/llm/llm.py:44-51](repo://openhands/llm/llm.py#L44-L51), [openhands/llm/llm.py:211-218](repo://openhands/llm/llm.py#L211-L218), [openhands/llm/retry_mixin.py:18-69](repo://openhands/llm/retry_mixin.py#L18-L69), [openhands/core/config/llm_config.py:62-65](repo://openhands/core/config/llm_config.py#L62-L65)

Before each wait it logs the attempt, calls the optional `retry_listener` with the attempt number and the limit (the web session uses this to tell the user it is retrying), and stores `retry_attempt` and `max_retries` on the exception, which the controller reads to decide between `RATE_LIMITED` and `ERROR`. An empty response (`LLMNoResponseError`) at temperature 0 is retried at temperature 1.0; at any other temperature the setting is kept.

Sources: [openhands/llm/retry_mixin.py:35-100](repo://openhands/llm/retry_mixin.py#L35-L100), [openhands/controller/agent_controller.py:337-352](repo://openhands/controller/agent_controller.py#L337-L352), [openhands/server/session/session.py:306-309](repo://openhands/server/session/session.py#L306-L309)

## Cost and token metrics

`_post_completion` computes the call's cost and records token usage. The cost comes from the LiteLLM proxy's `x-litellm-response-cost` header when present, otherwise from LiteLLM's price table (retrying with the provider prefix stripped), using `input_cost_per_token` and `output_cost_per_token` from the config when both are set. If no price can be found, `cost_metric_supported` turns off and later calls cost 0.

Sources: [openhands/llm/llm.py:583-630](repo://openhands/llm/llm.py#L583-L630), [openhands/llm/llm.py:733-791](repo://openhands/llm/llm.py#L733-L791)

`Metrics` keeps the accumulated cost, a list of per-call costs, response latencies, and `TokenUsage` records (prompt, completion, cache read and write tokens, context window and response id). It can `merge` another instance, `diff` against a baseline (used to compute a delegate's own share), `copy`, and serialize with `get`.

Sources: [openhands/llm/metrics.py:21-32](repo://openhands/llm/metrics.py#L21-L32), [openhands/llm/metrics.py:47-150](repo://openhands/llm/metrics.py#L47-L150), [openhands/llm/metrics.py:180-276](repo://openhands/llm/metrics.py#L180-L276)

## The LLM registry

A conversation has one `LLMRegistry`. It deep-copies the config, creates the active agent's LLM under service id `agent`, and hands out further LLMs by service id: the condenser, routing models, and one-off helpers each get their own, so their costs are tracked separately. `get_llm` returns the existing instance for a known id and refuses a known id with a different config; `get_llm_from_agent_config` resolves the agent config's named LLM group; `request_extraneous_completion` creates a service without a retry listener and returns the reply text, for small side calls.

Sources: [openhands/llm/llm_registry.py:23-109](repo://openhands/llm/llm_registry.py#L23-L109)

Each new LLM is announced to one subscriber as a `RegistryEvent`. `create_registry_and_conversation_stats`, used by both the headless runner and the server, builds the registry (applying the user's saved settings when given), builds a `ConversationStats` for the conversation, and subscribes `register_llm`, so every LLM's `Metrics` is tracked from creation.

Sources: [openhands/llm/llm_registry.py:130-146](repo://openhands/llm/llm_registry.py#L130-L146), [openhands/utils/utils.py:22-43](repo://openhands/utils/utils.py#L22-L43)

`ConversationStats` maps service ids to their `Metrics`. `get_combined_metrics` merges them, which is what the controller uses for the budget limit and the frontend's cost display. `save_metrics` pickles the map to the conversation's stats file; on restart `maybe_restore_metrics` loads it, and `register_llm` hands each re-created service its old metrics, so cost survives a server restart.

Sources: [openhands/server/services/conversation_stats.py:14-103](repo://openhands/server/services/conversation_stats.py#L14-L103), [openhands/controller/state/state_tracker.py:260-268](repo://openhands/controller/state/state_tracker.py#L260-L268)

## Model routing

`LLMRegistry.get_router` returns the agent's plain LLM when the agent config's `model_routing.router_name` is `noop_router`, the default. Otherwise it builds the named `RouterLLM` subclass from `ROUTER_LLM_REGISTRY`. A router is itself an `LLM` whose `completion` calls `_select_llm(messages)` to choose between the primary model and the LLMs listed in `llms_for_routing` (the `[llm.*]` groups marked `for_routing = true`), then forwards the call; other attributes are forwarded to the model chosen last.

Sources: [openhands/llm/llm_registry.py:111-128](repo://openhands/llm/llm_registry.py#L111-L128), [openhands/llm/router/base.py:31-86](repo://openhands/llm/router/base.py#L31-L86), [openhands/llm/router/base.py:105-159](repo://openhands/llm/router/base.py#L105-L159), [openhands/core/config/utils.py:229-248](repo://openhands/core/config/utils.py#L229-L248)

The built-in `multimodal_router` requires a routing LLM named `secondary_model`. It sends a request to the primary model when any message contains an image or when the messages exceed the secondary model's `max_input_tokens`, and once that limit has been exceeded it keeps using the primary model for the rest of the conversation. Everything else goes to the secondary model.

Sources: [openhands/llm/router/rule_based/impl.py:9-74](repo://openhands/llm/router/rule_based/impl.py#L9-L74)
