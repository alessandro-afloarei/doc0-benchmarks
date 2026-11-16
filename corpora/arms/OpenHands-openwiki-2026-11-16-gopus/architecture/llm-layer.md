---
type: subsystem
title: LLM Layer
description: How OpenHands calls language models through a litellm-based LLM wrapper, including configuration, retries, prompt-based function-call emulation, model feature detection, cost and token metrics, the per-conversation LLM registry, conversation stats persistence, and experimental model routing.
tags: [llm, litellm, function-calling, retries, metrics, model-routing]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:35:38.671Z
sources:
  - id: openwiki-source-8188f5ddf5232a9c93c0ccb0
    resource: repo://openhands/core/config/llm_config.py
  - id: openwiki-source-a2c4f6dc92cf0cd76a23c3d8
    resource: repo://openhands/core/config/utils.py
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
  - id: openwiki-source-3edb4df7893792e34eefed47
    resource: repo://openhands/server/services/conversation_stats.py
  - id: openwiki-source-9060771be52d41c49d57018b
    resource: repo://openhands/utils/utils.py
generated: { by: "claude-code", at: "2026-11-16T07:35:38.671Z" }
---

# LLM Layer

All model calls go through `openhands/llm/`. The `LLM` class (`llm.py`) wraps litellm's `completion` and adds OpenHands behavior on top: retries, function-call emulation, logging, metrics, and cost. Agents call `self.llm.completion(messages=..., tools=...)` (see [Agents](../agents/agenthub.md)). Condensers, security analyzers, and server-side helpers get their own `LLM` instances from the same registry.

## Configuration

`LLMConfig` (`openhands/core/config/llm_config.py`) is a pydantic model. The main fields:

- **Model and endpoint:** `model` (default `claude-sonnet-4-20250514`), `api_key`, `base_url`, `api_version`, AWS credentials for Bedrock, `custom_llm_provider`, `ollama_base_url`.
- **Retries:** `num_retries=5`, `retry_multiplier=8`, `retry_min_wait=8`, `retry_max_wait=64`, `timeout`.
- **Sampling:** `temperature=0.0`, `top_p`, `top_k`, `seed`, `reasoning_effort`.
- **Limits and cost:** `max_input_tokens`, `max_output_tokens`, `max_message_chars`, `input_cost_per_token`, `output_cost_per_token`.
- **Behavior toggles:** `native_tool_calling` (None means auto-detect), `caching_prompt=True`, `disable_vision`, `disable_stop_word`, `drop_params=True`, `modify_params=True`.
- **Debugging:** `log_completions` and `log_completions_folder`, which write a full JSON record of every request and response.
- **Routing:** `for_routing` marks an LLM as a secondary model for routing.

In `config.toml`, the plain keys under `[llm]` are the default config. Each `[llm.<name>]` subsection starts from those defaults and overrides some of them (`LLMConfig.from_toml_section`). Agents and other features then refer to these named configs. See [Configuration System](../configuration/config-system.md).

## The completion pipeline

`LLM.__init__` reads model info from litellm (context window, max output tokens, and vision support). It looks up feature flags with `get_features(model)` and builds `self._completion` as a `functools.partial` of `litellm_completion` with the configured parameters. `reasoning_effort` is passed through for models that support it. For Gemini models, `reasoning_effort` values of `None`, `low`, or `none` are turned into a thinking budget. The partial is then wrapped in the retry decorator and a `wrapper` that does the following on each call:

1. Accepts either `Message` objects or dicts. `Message`s are formatted with the cache and function-calling flags.
2. **Function-call emulation.** If the model has no native tool calling (`is_function_calling_active()` is false) and the call passes `tools`, `convert_fncall_messages_to_non_fncall_messages` (`fn_call_converter.py`) turns the tool schemas into a text description and the tool-call history into plain text. It also adds an in-context example, except for `openhands-lm` and `devstral` models. When the model supports stop words, the stop word `</function` is added. After the response comes back, `convert_non_fncall_messages_to_fncall_messages` parses the text back into proper `tool_calls`, so agents always receive a function-calling response.
3. Sets litellm's global `modify_params`. Removes `extra_body` unless the model goes through `litellm_proxy`. Agents put conversation metadata there for proxy-side tracking.
4. Calls litellm and records latency.
5. Raises `LLMNoResponseError` if the response has no choices. This has been seen with Gemini.
6. `_post_completion` computes cost and records token usage in `self.metrics`: prompt, completion, cache-read, and cache-write tokens, plus the context window. Cost comes from the configured per-token prices if they're set, otherwise from a cost header in the response, otherwise from `litellm.completion_cost`.
7. When `log_completions` is on, writes the messages, response, kwargs, and cost to a file.

### Retries

`RetryMixin.retry_decorator` (`retry_mixin.py`) uses tenacity with exponential backoff and stops after `num_retries` attempts or when the process is shutting down. The retried exceptions (`LLM_RETRY_EXCEPTIONS`) are `APIConnectionError`, `RateLimitError`, `ServiceUnavailableError`, `Timeout`, `InternalServerError`, and `LLMNoResponseError`. When an `LLMNoResponseError` happens at temperature 0, the next attempt uses temperature 1.0. Each retry calls `retry_listener(attempt, max)`. The server uses this to show rate-limit status. After the last retry, the exception is re-raised with its attempt counts attached. The [controller](agent-controller.md) uses those counts to choose between `RATE_LIMITED` and `ERROR`.

### Model features

`model_features.py` normalizes model names (dropping provider prefixes) and matches them against glob tables to fill in `ModelFeatures`:

- `supports_function_calling`: recent Claude Sonnet, Opus, and Haiku models; GPT-4o, GPT-4.1, and GPT-5; o3 and o4-mini; Gemini 2.5 Pro; Qwen3-Coder; Kimi K2; DeepSeek chat; and others.
- `supports_reasoning_effort`: the o-series, GPT-5, Gemini 2.5, and DeepSeek R1.
- `supports_prompt_cache`: Anthropic Claude models. `is_caching_prompt_active()` is true only when `caching_prompt` is on **and** the model is in this list, and then `ConversationMemory` adds cache breakpoints.
- `supports_stop_words`.

`native_tool_calling` in the config overrides auto-detection.

### Variants

- `AsyncLLM` (`async_llm.py`) wraps `litellm.acompletion`. While the call runs, a task polls an optional `on_cancel_requested_fn` hook on the config.
- `StreamingLLM` (`streaming_llm.py`) adds async streaming completion.
- `bedrock.py` lists Bedrock models. `debug_mixin.py` handles prompt and response logging. `llm_utils.check_tools` adjusts tool schemas for providers with stricter rules, such as Gemini.

## Metrics

`Metrics` (`metrics.py`) holds `accumulated_cost`, a list of `Cost` records, `ResponseLatency` records, `TokenUsage` entries, `accumulated_token_usage`, and `max_budget_per_task`. Metrics can be merged and copied. The controller attaches a trimmed copy to each action for the UI. Delegates use a snapshot to compute their local spend.

## LLM registry and conversation stats

Each conversation gets one `LLMRegistry` (`llm_registry.py`), created together with its stats by `create_registry_and_conversation_stats()` (`openhands/utils/utils.py`):

- The registry deep-copies the config and creates the **active agent LLM** under the service id `agent`, using the LLM config of the selected agent.
- `get_llm(service_id, config)` returns the cached LLM for that service id. Asking for an existing id with a *different* config raises `ValueError`. `get_llm_from_agent_config` returns the existing LLM for the id even when the config differs, so delegates reuse the parent's LLM.
- `request_extraneous_completion(service_id, config, messages)` makes one-off calls, such as generating conversation titles. It doesn't attach the retry listener.
- `get_router(agent_config)` returns the plain agent LLM for `noop_router`, otherwise a `RouterLLM`.
- Each new LLM triggers a `RegistryEvent` to the single subscriber. That subscriber is `ConversationStats.register_llm`.

`ConversationStats` (`openhands/server/services/conversation_stats.py`) keeps a map from service id to `Metrics`. It pickles the map to `conversation_stats.pkl` in the conversation directory. When an LLM registers, metrics saved under the same service id are restored into it, so costs keep adding up across restarts. `get_combined_metrics()` adds up every service, and the controller's budget flag reads that total. The stats are saved whenever the controller saves state.

## Model routing (experimental)

`openhands/llm/router/` lets one agent switch between models during a conversation:

- `RouterLLM` (`router/base.py`) subclasses `LLM`. It holds the primary LLM plus the LLMs listed in `model_routing.llms_for_routing`, which are the `[llm.*]` sections with `for_routing = true`. On every `completion` call it runs `_select_llm(messages)`.
- `MultimodalRouter` (`rule_based/impl.py`, registered as `multimodal_router`) uses the primary model when any message has an image, or once the conversation has grown past the secondary model's `max_input_tokens`. That second switch is permanent. Otherwise it uses the secondary model.
- To add a router, subclass `RouterLLM`, implement `_select_llm`, and add the class to the router registry. Then set `[model_routing] router_name = "..."`.

## Tests

`tests/unit/llm/` covers the wrapper (`test_llm.py`), async completion, retries on connection errors, the function-call converter, and model-feature matching. `tests/unit/test_llm_registry.py` and `tests/unit/test_conversation_stats.py` cover the registry and the metrics persistence.

## Related pages

- [Agents: CodeAct and the Agent Hub](../agents/agenthub.md)
- [Configuration System](../configuration/config-system.md)
- [Agent Controller and State](agent-controller.md): budget limits and error mapping
- [Conversation Memory and Condensers](memory-and-condensers.md): message formatting and caching
