---
title: "LLM Access"
---
## Overview

Agents never call a model provider directly. `LLM` wraps the LiteLLM completion function with the settings from one `LLMConfig`, adds retries, converts tool calls for models without native function calling, and records cost and latency. `LLMRegistry` creates and caches these wrappers by service id, and a router can stand in for a single `LLM` when an agent uses more than one model.

Sources: [openhands/llm/llm.py:54-61](repo://openhands/llm/llm.py#L54-L61) [openhands/llm/llm_registry.py:23-24](repo://openhands/llm/llm_registry.py#L23-L24)

## Building the completion function

`LLM.__init__` binds the configured model, API key, base URL, API version, provider, timeout, parameter dropping and seed into a `functools.partial` over the LiteLLM completion function. Caller keyword arguments are added on top.

Sources: [openhands/llm/llm.py:194-206](repo://openhands/llm/llm.py#L194-L206)

The bound function is then wrapped in a retry decorator built from the configuration: the number of attempts, the exception types that retry, and the minimum wait, maximum wait and multiplier for the backoff. The wrapper is what callers reach through the `completion` property.

Sources: [openhands/llm/llm.py:207-216](repo://openhands/llm/llm.py#L207-L216) [openhands/llm/llm.py:410-415](repo://openhands/llm/llm.py#L410-L415)

The exception types that retry are listed once in `LLM_RETRY_EXCEPTIONS`. The asynchronous wrapper in `AsyncLLM` uses the same list.

Sources: [openhands/llm/llm.py:44-44](repo://openhands/llm/llm.py#L44-L44) [openhands/llm/async_llm.py:44-44](repo://openhands/llm/async_llm.py#L44-L44)

`RetryMixin.retry_decorator` builds a Tenacity retry that stops after `num_retries` attempts or when the process is asked to exit. Each failed attempt calls the retry listener the `LLM` was built with.

Sources: [openhands/llm/retry_mixin.py:18-58](repo://openhands/llm/retry_mixin.py#L18-L58)

## Function calling for models without it

When function calling is not active for the model, the wrapper converts the tool definitions into prompt text before the call and the response back into tool calls. The conversion lives in `fn_call_converter`, which holds the prompt suffix template and the stop word `</function` that ends the model's output.

Sources: [openhands/llm/llm.py:226-227](repo://openhands/llm/llm.py#L226-L227) [openhands/llm/llm.py:262-264](repo://openhands/llm/llm.py#L262-L264) [openhands/llm/fn_call_converter.py:1-7](repo://openhands/llm/fn_call_converter.py#L1-L7) [openhands/llm/fn_call_converter.py:56-56](repo://openhands/llm/fn_call_converter.py#L56-L56)

## Cost and latency

After each completion, `_post_completion` asks `_completion_cost` for the cost of the response and logs it with the usage numbers. A cost that cannot be computed is recorded as zero rather than failing the call. The cost is computed with LiteLLM's `completion_cost`, and the totals are kept on a `Metrics` object that the controller reads for the budget check.

Sources: [openhands/llm/llm.py:583-592](repo://openhands/llm/llm.py#L583-L592) [openhands/llm/llm.py:733-790](repo://openhands/llm/llm.py#L733-L790) [openhands/llm/metrics.py:47-56](repo://openhands/llm/metrics.py#L47-L56) [openhands/llm/metrics.py:74-78](repo://openhands/llm/metrics.py#L74-L78)

## Registry

`LLMRegistry.get_llm` returns the existing wrapper for a service id. It raises when the same id is requested with a different configuration, so one id always means one configuration. A new id needs a configuration and creates a new wrapper.

Sources: [openhands/llm/llm_registry.py:82-107](repo://openhands/llm/llm_registry.py#L82-L107)

`get_router` returns the plain agent LLM when the router name is `noop_router`. Any other name builds a `RouterLLM` from the agent configuration.

Sources: [openhands/llm/llm_registry.py:111-129](repo://openhands/llm/llm_registry.py#L111-L129)

## Routing

`RouterLLM` extends `LLM`. Its `completion` picks one of several registered LLMs through `_select_llm` and delegates the call to it, so the agent sees one object. The shipped rule-based router, `MultimodalRouter`, sends a call to the primary model when any message holds an image or the token limit has been exceeded. Otherwise it checks the secondary model's input limit before using it.

Sources: [openhands/llm/router/base.py:17-30](repo://openhands/llm/router/base.py#L17-L30) [openhands/llm/router/base.py:89-94](repo://openhands/llm/router/base.py#L89-L94) [openhands/llm/router/rule_based/impl.py:9-45](repo://openhands/llm/router/rule_based/impl.py#L9-L45)
