---
title: "Model Calls and Routing"
---
## Overview

OpenHands uses `LLM` as its model-service boundary and `LLMRegistry` to manage named services within a conversation. CodeAct sends prepared messages and tools through that boundary, then converts the response into executable actions. [[Configuration]] explains selecting model groups; [[Agent Control Loop]] explains when a completion is requested. This page follows service selection, request adaptation, retries and accounting without repeating the history-building rules in [[Memory and Microagents]].

Sources: [openhands/llm/llm_registry.py:23-55](repo://openhands/llm/llm_registry.py#L23-L55), [openhands/agenthub/codeact_agent/codeact_agent.py:207-224](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L207-L224), [openhands/agenthub/codeact_agent/codeact_agent.py:282-299](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L282-L299)

## Registry identity and reuse

The registry deep-copies application configuration, creates the initial `agent` service and keeps a map from service IDs to LLM instances. Creating a service emits a registry event. A subscriber installed after startup is immediately notified about the active agent LLM, allowing conversation-level consumers to discover that already-created service.

Sources: [openhands/llm/llm_registry.py:23-55](repo://openhands/llm/llm_registry.py#L23-L55), [openhands/llm/llm_registry.py:130-146](repo://openhands/llm/llm_registry.py#L130-L146)

`get_llm` reuses a service only when its requested configuration matches; requesting the same ID with a different configuration raises `ValueError`. Creating a new service requires a configuration. The agent-specific getter has a narrower current behavior: it returns an existing service even if the newly resolved agent configuration differs, leaving a TODO for configuration replacement. Auxiliary completions use a service ID too, but create their service without the retry listener used for the main agent.

Sources: [openhands/llm/llm_registry.py:58-106](repo://openhands/llm/llm_registry.py#L58-L106)

## Model routing

For `noop_router`, the registry returns the agent LLM directly. Other router names construct a registered `RouterLLM` implementation. A router has a primary model plus named routing models, each registered under a separate service ID. For each completion it chooses a model key from the messages, records the current model and decision, then calls that model's completion method. An unknown selected key or unknown router name raises an error.

Sources: [openhands/llm/llm_registry.py:111-128](repo://openhands/llm/llm_registry.py#L111-L128), [openhands/llm/router/base.py:42-58](repo://openhands/llm/router/base.py#L42-L58), [openhands/llm/router/base.py:95-135](repo://openhands/llm/router/base.py#L95-L135), [openhands/llm/router/base.py:154-164](repo://openhands/llm/router/base.py#L154-L164)

The multimodal rule-based router requires its named secondary configuration. It uses the primary model when any message contains an image or when the secondary input-token limit has been exceeded. Once that limit is exceeded, its flag keeps subsequent requests on the primary model. Otherwise it selects the secondary model. Vision capability is reported through the primary model.

Sources: [openhands/llm/router/rule_based/impl.py:10-70](repo://openhands/llm/router/rule_based/impl.py#L10-L70)

## Request formatting and capabilities

The LLM constructor binds LiteLLM completion to the configured model, credentials, endpoint, token limit, timeout and other request options. The wrapper accepts internal `Message` objects or dictionaries and formats internal objects before transport. An empty message list raises an error. Request metadata in `extra_body` is removed unless the configured model uses the LiteLLM proxy path.

Sources: [openhands/llm/llm.py:112-116](repo://openhands/llm/llm.py#L112-L116), [openhands/llm/llm.py:194-208](repo://openhands/llm/llm.py#L194-L208), [openhands/llm/llm.py:223-256](repo://openhands/llm/llm.py#L223-L256), [openhands/llm/llm.py:294-310](repo://openhands/llm/llm.py#L294-L310)

When native function calling is inactive and tools are supplied, the wrapper translates function-call messages into a prompt-based representation. It adds stop words only when supported and enabled, removes the transport tool definitions and adjusts tool choice for that mode. After the provider returns, the wrapper converts the textual response back to function-call form. These transformations preserve the action-conversion interface used by CodeAct even when the provider path uses text prompting.

Sources: [openhands/llm/llm.py:258-292](repo://openhands/llm/llm.py#L258-L292), [openhands/llm/llm.py:335-355](repo://openhands/llm/llm.py#L335-L355)

Vision is active only when the feature is supported and not disabled. Support can be forced with `OPENHANDS_FORCE_VISION` or inferred from model metadata. Prompt caching also requires a configured caching option and a supported feature; native function calling uses an explicit configuration override when supplied and otherwise follows model feature support. These capability decisions affect message formatting and image acceptance in [[Conversations and Web Interface]].

Sources: [openhands/llm/llm.py:523-581](repo://openhands/llm/llm.py#L523-L581), [openhands/server/session/session.py:353-368](repo://openhands/server/session/session.py#L353-L368)

## Retry behavior

The completion wrapper uses a retry decorator configured with attempt count, exception types and exponential waiting bounds. The decorator stops at the configured attempt limit or shutdown request, retries only the supplied exception classes and re-raises failures. Before sleeping it logs the attempt and notifies an optional listener. For an empty-response error, it changes a zero temperature to `1.0` for the next attempt, while preserving an already nonzero temperature.

Sources: [openhands/llm/llm.py:211-218](repo://openhands/llm/llm.py#L211-L218), [openhands/llm/retry_mixin.py:28-69](repo://openhands/llm/retry_mixin.py#L28-L69)

Retry logging attaches attempt and maximum-attempt information to exceptions when the stop condition exposes it. The controller can use these fields when distinguishing a temporarily rate-limited task from exhausted retries. [[Agent Control Loop]] owns the resulting state changes; this service layer owns the retry schedule and provider request.

Sources: [openhands/llm/retry_mixin.py:71-100](repo://openhands/llm/retry_mixin.py#L71-L100), [openhands/controller/agent_controller.py:337-352](repo://openhands/controller/agent_controller.py#L337-L352)

## Metrics and response conversion

Every successful transport call records response latency. Post-completion processing calculates cost and records provider token usage, including supported cache-token fields. Cost can come from a provider response header or LiteLLM calculation, with optional custom per-token prices. Unsupported cost calculation disables further cost tracking and returns zero; post-completion processing also catches calculation errors so accounting alone does not fail the task.

Sources: [openhands/llm/llm.py:328-333](repo://openhands/llm/llm.py#L328-L333), [openhands/llm/llm.py:583-615](repo://openhands/llm/llm.py#L583-L615), [openhands/llm/llm.py:625-666](repo://openhands/llm/llm.py#L625-L666), [openhands/llm/llm.py:733-791](repo://openhands/llm/llm.py#L733-L791)

CodeAct's converter parses each tool call's arguments, validates required fields and maps tool names to action classes. Registered MCP names become `MCPAction`; unknown tool names raise a tool-not-found error. Tool-call metadata retains the call ID, function name, model response and total call count. Plain response text follows the message-action branch. [[MCP Tools and Integrations]] follows external tool actions beyond this conversion boundary.

Sources: [openhands/agenthub/codeact_agent/function_calling.py:73-110](repo://openhands/agenthub/codeact_agent/function_calling.py#L73-L110), [openhands/agenthub/codeact_agent/function_calling.py:299-338](repo://openhands/agenthub/codeact_agent/function_calling.py#L299-L338)
