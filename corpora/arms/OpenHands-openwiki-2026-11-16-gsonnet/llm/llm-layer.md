---
type: component
title: LLM Layer
description: The LLM wrapper around LiteLLM — LLMRegistry and service ids, how completion calls are configured, retried and logged, emulated function calling for models without native tool support, model feature tables, cost/token metrics, conversation-level stats, and model routers.
tags: [llm, litellm, retry, metrics, function-calling, routing]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:38:52.407Z
sources:
  - id: openwiki-source-f161159e8a959406ae10a085
    resource: repo://openhands/agenthub/codeact_agent/codeact_agent.py
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
generated: { by: "claude-code", at: "2026-11-16T09:38:52.407Z" }
---

# LLM Layer

Everything that talks to a model goes through `openhands/llm/`. It wraps **LiteLLM**, so any provider LiteLLM supports can be used; the layer adds configuration, retries, prompt/response logging, cost accounting, emulated tool calling and optional routing. Agents never call LiteLLM directly: they hold an `LLM` obtained from the registry ([CodeActAgent](../agents/codeact-agent.md)). Configuration comes from `LLMConfig` ([Configuration](../configuration/configuration.md)).

## `LLMRegistry` (`llm_registry.py`)

One registry exists per conversation/run (`create_registry_and_conversation_stats` in the entry points). It deep-copies the app config, maps agents to LLM configs and keeps `service_to_llm: dict[str, LLM]`:

- `get_llm(service_id, config)` returns the existing LLM for a service id, creates one if a config is given, and **raises if the same service id is requested with a different config** (use a new id instead). `get_llm_from_agent_config('agent', cfg)` is what `Agent.__init__` uses; the registry's `active_agent_llm` is created from the default agent's LLM config at construction.
- `request_extraneous_completion(service_id, config, messages)` makes one-off completions (for example conversation title/summaries) on a separate service id without a retry listener.
- `get_router(agent_config)` returns the plain agent LLM for `noop_router` and otherwise a `RouterLLM` built from config.
- `subscribe(callback)`/`notify` publish a `RegistryEvent` whenever an LLM is created, which is how `ConversationStats` attaches to every LLM's metrics.

## `LLM` (`llm.py`)

`LLM(config, service_id, metrics=None, retry_listener=None)` deep-copies its config and builds a `functools.partial` over `litellm.completion` (`self._completion`) with model, API key, base URL, API version, timeout, `drop_params`, `seed`, temperature/top-p/top-k and `max_completion_tokens`. Provider-specific adjustments are applied at construction:

- A model prefixed `openhands/` is rewritten to `litellm_proxy/<model>` with the OpenHands LLM proxy base URL.
- Models in the reasoning-effort table get `reasoning_effort` and drop `temperature`/`top_p` (Gemini 2.5 Pro maps `low`/`none` to a small `thinking` budget); Azure uses `max_tokens`; Bedrock credentials/region and safety settings are forwarded; Claude Opus 4.1 explicitly disables extended thinking and drops `top_p` when `temperature` is set.

`completion` is a wrapper around the partial that:

1. Normalizes messages (`Message` objects → dicts via `format_messages_for_llm`).
2. If the model lacks native function calling (`is_function_calling_active()` false) and tools were passed, **emulates tool calling**: `fn_call_converter.convert_fncall_messages_to_non_fncall_messages` rewrites tool definitions and tool calls into prompt text (with an in-context example except for some models), adds `STOP_WORDS` when the model supports stop words, removes `tools`/`tool_choice`; after the call, `convert_non_fncall_messages_to_fncall_messages` parses the text reply back into a tool-call message. Agents therefore always see the native tool-call shape.
3. Logs the prompt, strips `extra_body` unless using the LiteLLM proxy, calls LiteLLM, records response latency, and raises `LLMNoResponseError` for empty `choices` (seen with some Gemini responses).
4. Logs the response, computes cost and token usage in `_post_completion` (including cache read/write tokens and context window) into `metrics`, and optionally writes a JSON file per completion when `log_completions` is set (used by evaluation).

### Retries (`retry_mixin.py`)

`RetryMixin.retry_decorator` wraps `completion` with `tenacity`: retry only on `LLM_RETRY_EXCEPTIONS` (`APIConnectionError`, `RateLimitError`, `ServiceUnavailableError`, `litellm.Timeout`, `InternalServerError`, `LLMNoResponseError`), exponential wait between `retry_min_wait` and `retry_max_wait` with `retry_multiplier`, stop after `num_retries` (default 5) or on process shutdown, and re-raise the last error. Before each sleep it logs, attaches `retry_attempt`/`max_retries` to the exception, and calls the retry listener (used to show "retrying" statuses). For `LLMNoResponseError` with temperature 0 the next attempt bumps temperature to 1.0 to escape deterministic empty replies. The controller uses the attached counters to decide between `RATE_LIMITED` and `ERROR` ([AgentController](../architecture/agent-controller.md)).

### Model features (`model_features.py`)

`get_features(model)` matches the model name against glob tables (`normalize_model_name` lower-cases and keeps only the basename after `/`, dropping Ollama `:tag` suffixes; patterns containing `/` match the full string) to decide: `supports_function_calling` (Claude 3.5/3.7/4, GPT-4o/4.1/5, o3/o4-mini, Gemini 2.5 Pro, Kimi K2, Qwen3-Coder, DeepSeek chat, ...), `supports_reasoning_effort`, `supports_prompt_cache` (Claude families) and `supports_stop_words` (false for o1, DeepSeek R1, some Grok). `LLM` also derives `vision_is_active`, `is_caching_prompt_active` and token limits from LiteLLM model info and config (`disable_vision`, `caching_prompt`, `max_input_tokens`, `max_output_tokens`).

## Metrics and cost

`Metrics` (`metrics.py`) accumulates `Cost`, `ResponseLatency` and `TokenUsage` entries, with `accumulated_cost`, `max_budget_per_task`, `merge`, `copy`, `diff(baseline)` (used for delegate-local metrics) and `get()` (serialization into events' `llm_metrics`). The controller syncs the budget flag with these accumulated costs each step. `ConversationStats` (`server/services/conversation_stats.py`) subscribes to the registry, keeps per-service metrics, **persists them to `conversation_stats.pkl`** under the conversation directory and restores them on resume (`maybe_restore_metrics`), so cost limits survive restarts ([Storage](../server/storage-and-persistence.md)).

## Routers (`llm/router/`)

`RouterLLM` subclasses `LLM` so it can be dropped in wherever an LLM is expected. It holds a primary LLM plus `llms_for_routing` (configs flagged `for_routing`), exposes a synthetic model name `router(...)`, and its `completion` calls `_select_llm(messages)` and delegates to the chosen LLM; unknown attributes are forwarded to the current LLM. Routers register themselves in `ROUTER_LLM_REGISTRY`; `RouterLLM.from_config` picks one by `model_routing.router_name`. The only shipped router is `multimodal_router` (rule-based): it requires a `secondary_model` config and routes to the **primary** model when messages contain images or when the secondary model's `max_input_tokens` would be exceeded (and then sticks to primary via `max_token_exceeded`), otherwise to the secondary (cheaper) model. `CodeActAgent` obtains its LLM through `get_router` after construction.

## Other pieces

- `async_llm.AsyncLLM` / `streaming_llm.StreamingLLM`: async and streaming variants over `litellm.acompletion`.
- `debug_mixin.DebugMixin`: prompt/response logging helpers.
- `bedrock.py`: lists Bedrock models; `llm_utils.py`: helpers; `tool_names.py`: well-known tool names.
- Tests: `tests/unit/llm/` and `tests/unit/test_llm_registry.py`.

Related: [Overview](../architecture/overview.md), [Memory and condensation](../agents/memory-and-condensation.md) (condensers that use an LLM obtain it from the same registry).
