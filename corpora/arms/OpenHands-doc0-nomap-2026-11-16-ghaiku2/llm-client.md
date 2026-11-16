---
title: "LLM Client"
---
## Overview

`LLM` is the one class through which OpenHands calls a language model. It wraps LiteLLM's `completion` with retries, converts tool calls for models that cannot take them natively, records cost, token use and latency, and can be swapped for a router that picks a model per request. Agents never call LiteLLM directly. They receive an `LLM` from the registry, which keeps one shared instance per service ID so that every agent and delegate in a conversation reports into the same metrics.

Sources: [openhands/llm/llm.py:54-70](repo://openhands/llm/llm.py#L54-L70), [openhands/llm/llm_registry.py:23-44](repo://openhands/llm/llm_registry.py#L23-L44)

## Construction and the registry

`LLM.__init__` takes an `LLMConfig`, a service ID and an optional `Metrics` object. The service ID names the instance in the registry. Asking the registry again for the same ID returns the existing instance, but asking for the same ID with a different config raises an error, so one name always means one configuration.

Sources: [openhands/llm/llm_registry.py:82-107](repo://openhands/llm/llm_registry.py#L82-L107)

`get_llm_from_agent_config` is the path agents take. It creates the LLM under the agent's service ID the first time and returns it afterwards. Each new LLM is announced to the registry's subscribers. The conversation statistics subscribe to that announcement, so every LLM created for a conversation is counted in one place.

Sources: [openhands/llm/llm_registry.py:71-81](repo://openhands/llm/llm_registry.py#L71-L81), [openhands/llm/llm_registry.py:130-145](repo://openhands/llm/llm_registry.py#L130-L145), [openhands/utils/utils.py:26-43](repo://openhands/utils/utils.py#L26-L43)

## The completion path

`completion` returns a wrapper that was built once in `__init__`. The wrapper is decorated with a retry policy whose attempts, waits and exceptions come from the LLM config. The retried exceptions are connection errors, rate limits, service unavailability, timeouts, internal server errors and an empty response. Other errors are raised to the caller unchanged.

Sources: [openhands/llm/llm.py:200-216](repo://openhands/llm/llm.py#L200-L216), [openhands/llm/llm.py:44-51](repo://openhands/llm/llm.py#L44-L51)

`RetryMixin.retry_decorator` builds that policy with tenacity. Each retry is reported to a listener, which the server uses to tell the user that the model is being retried.

Sources: [openhands/llm/retry_mixin.py:15-34](repo://openhands/llm/retry_mixin.py#L15-L34), [openhands/llm/retry_mixin.py:71-80](repo://openhands/llm/retry_mixin.py#L71-L80)

Inside the wrapper, the LLM checks whether function calling is active. If it is not, the messages and tools are converted into a text prompt with `convert_fncall_messages_to_non_fncall_messages` before the call, so a model without native tool calls can still be driven by the same agent code. The reply is parsed back into tool calls by the converter.

Sources: [openhands/llm/llm.py:220-232](repo://openhands/llm/llm.py#L220-L232), [openhands/llm/llm.py:266-273](repo://openhands/llm/llm.py#L266-L273), [openhands/llm/fn_call_converter.py:478-490](repo://openhands/llm/fn_call_converter.py#L478-L490)

`is_function_calling_active` returns a value that was decided when the LLM was initialised, so the check is not repeated on each call.

Sources: [openhands/llm/llm.py:576-581](repo://openhands/llm/llm.py#L576-L581)

## Cost, usage and latency

After a successful call, `_post_completion` computes the response's cost and logs it with the accumulated cost and the latency. `_completion_cost` works the cost out and adds it to the metrics. If the cost cannot be computed, the call is recorded at zero cost rather than failing.

Sources: [openhands/llm/llm.py:583-604](repo://openhands/llm/llm.py#L583-L604), [openhands/llm/llm.py:733-790](repo://openhands/llm/llm.py#L733-L790)

`Metrics` keeps a list of `Cost` entries, a list of `ResponseLatency` entries and token usage per response. The budget control flag reads the accumulated cost from the conversation's combined metrics, so the cost a user sees and the cost that stops a run come from the same numbers.

Sources: [openhands/llm/metrics.py:7-60](repo://openhands/llm/metrics.py#L7-L60), [openhands/llm/metrics.py:74-95](repo://openhands/llm/metrics.py#L74-L95)

## Routing

`LLMRegistry.get_router` returns the plain LLM when the agent's routing name is `noop_router`. Any other name builds a `RouterLLM`, which holds several LLMs from `llms_for_routing` and delegates every call to the one that `_select_llm` picks. The CodeAct agent asks for a router when it is built, so routing applies to every model call it makes.

Sources: [openhands/llm/llm_registry.py:111-128](repo://openhands/llm/llm_registry.py#L111-L128), [openhands/llm/router/base.py:17-30](repo://openhands/llm/router/base.py#L17-L30), [openhands/llm/router/base.py:89-94](repo://openhands/llm/router/base.py#L89-L94)

The one built-in router, `multimodal_router`, sends a request to the primary model when any message holds an image, when it has already switched to the primary model after a token-limit overflow, or when the messages exceed the secondary model's input limit. Otherwise it uses the secondary model. The class is added to `ROUTER_LLM_REGISTRY` when its module is imported.

Sources: [openhands/llm/router/rule_based/impl.py:1-30](repo://openhands/llm/router/rule_based/impl.py#L1-L30), [openhands/llm/router/rule_based/impl.py:26-62](repo://openhands/llm/router/rule_based/impl.py#L26-L62), [openhands/llm/router/rule_based/impl.py:74-74](repo://openhands/llm/router/rule_based/impl.py#L74-L74)

## Token counting

`get_token_count` counts the tokens of a list of messages, given either as dictionaries or as `Message` objects. The multimodal router uses it to check whether the messages fit the secondary model's input limit, so the count is only as good as the tokenizer LiteLLM provides for that model.

Sources: [openhands/llm/llm.py:668-716](repo://openhands/llm/llm.py#L668-L716), [openhands/llm/router/rule_based/impl.py:44-47](repo://openhands/llm/router/rule_based/impl.py#L44-L47)
