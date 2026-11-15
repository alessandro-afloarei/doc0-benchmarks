---
title: "LLM Registry and Routing"
---
## Overview

One conversation uses several LLMs: the agent's model, a condenser's summarizer, a security analyzer, the model that writes the conversation title, and possibly a cheaper secondary model the agent is routed to. The `LLMRegistry` creates each of them once, under a name called the service id, so every component that asks for the same service gets the same instance. `ConversationStats` listens to the registry and keeps every LLM's `Metrics` together, so the conversation's total cost and the budget limit cover all of them.

Sources: [openhands/llm/llm_registry.py:23-56](repo://openhands/llm/llm_registry.py#L23-L56), [openhands/server/services/conversation_stats.py:14-32](repo://openhands/server/services/conversation_stats.py#L14-L32)

How a single `LLM` works is on [[LLM Client]].

Sources: [openhands/llm/llm.py:61-81](repo://openhands/llm/llm.py#L61-L81)

## Creating the registry

### Setup per conversation

`create_registry_and_conversation_stats(config, sid, user_id, user_settings)` is the one place both are built. With user settings (from the web UI), it first copies the config and overrides the default LLM's model, API key and base URL with the user's choices, and takes the agent class from the settings. It then creates the registry and a `ConversationStats` for the conversation, and subscribes the stats to the registry.

Sources: [openhands/utils/utils.py:10-43](repo://openhands/utils/utils.py#L10-L43)

The headless runner calls it without settings; the server's sessions call it with the user's settings.

Sources: [openhands/core/main.py:99-103](repo://openhands/core/main.py#L99-L103)

### The agent LLM

The registry's constructor resolves the LLM config of the selected agent class (from the agent's `llm_config` setting, see [[Configuration]]) and immediately creates it under the service id `agent`. `get_active_llm` returns that instance.

Sources: [openhands/llm/llm_registry.py:24-43](repo://openhands/llm/llm_registry.py#L24-L43), [openhands/llm/llm_registry.py:108-109](repo://openhands/llm/llm_registry.py#L108-L109)

## Getting an LLM

### Registry methods

| Method | Behaviour |
| --- | --- |
| `get_llm(service_id, config)` | returns the existing LLM for the service; creates it from `config` if new; raises if the service exists with a different config or no config is given for a new one |
| `get_llm_from_agent_config(service_id, agent_config)` | resolves the agent's LLM config and returns the existing LLM for the service, or creates it |
| `request_extraneous_completion(service_id, llm_config, messages)` | creates the service without a retry listener if needed, runs one completion and returns the stripped text |
| `get_router(agent_config)` | returns the agent LLM, or a `RouterLLM` when model routing is configured |

Sources: [openhands/llm/llm_registry.py:58-128](repo://openhands/llm/llm_registry.py#L58-L128)

The rule that one service id has one config prevents two components from silently sharing an LLM with different settings: a component that needs another model must use another service id. Agents use `agent`, condensers `condenser`, routing models `llm_for_routing.<name>`, and the conversation title generator `conversation_title_creator` through `request_extraneous_completion`.

Sources: [openhands/llm/llm_registry.py:91-98](repo://openhands/llm/llm_registry.py#L91-L98), [openhands/memory/condenser/impl/llm_summarizing_condenser.py:170-172](repo://openhands/memory/condenser/impl/llm_summarizing_condenser.py#L170-L172), [openhands/utils/conversation_summary.py:53-55](repo://openhands/utils/conversation_summary.py#L53-L55)

New LLMs normally receive the registry's retry listener, which the server uses to tell the user about retries; side completions do not.

Sources: [openhands/llm/llm_registry.py:45-56](repo://openhands/llm/llm_registry.py#L45-L56)

### Notifications

The registry has a single subscriber. Every new LLM is announced to it as a `RegistryEvent` with the LLM and its service id, and `subscribe` immediately announces the agent LLM, which was created before anyone could subscribe. A subscriber that raises only logs a warning.

Sources: [openhands/llm/llm_registry.py:14-20](repo://openhands/llm/llm_registry.py#L14-L20), [openhands/llm/llm_registry.py:130-146](repo://openhands/llm/llm_registry.py#L130-L146)

## Conversation stats

### Tracking and restoring

`ConversationStats.register_llm` is the subscriber. It stores each LLM's `Metrics` object by service id; if metrics for that service were restored from an earlier run, it first copies them into the LLM, so a resumed conversation keeps counting from where it stopped.

Sources: [openhands/server/services/conversation_stats.py:94-103](repo://openhands/server/services/conversation_stats.py#L94-L103)

On creation it reads `conversation_stats.pkl` from the conversation directory, a base64-encoded pickle of the service-to-metrics map. `save_metrics` writes back the restored metrics of services not yet registered together with the live ones, under a lock, so metrics for a service that has not been used in this run are not lost. The controller saves them each time the agent state changes.

Sources: [openhands/server/services/conversation_stats.py:34-80](repo://openhands/server/services/conversation_stats.py#L34-L80), [openhands/controller/state/state_tracker.py:246-252](repo://openhands/controller/state/state_tracker.py#L246-L252), [openhands/storage/locations.py:37-38](repo://openhands/storage/locations.py#L37-L38)

### Combined metrics

`get_combined_metrics` merges every registered service's metrics into one `Metrics`. The [[Agent Controller]] syncs the budget flag with its accumulated cost before every step and attaches a summary to each action for the UI, so the budget limit counts condenser and other side calls, not just the agent's. `get_metrics_for_service` returns one service's metrics.

Sources: [openhands/server/services/conversation_stats.py:82-92](repo://openhands/server/services/conversation_stats.py#L82-L92), [openhands/controller/state/state_tracker.py:260-268](repo://openhands/controller/state/state_tracker.py#L260-L268), [openhands/controller/agent_controller.py:1078-1100](repo://openhands/controller/agent_controller.py#L1078-L1100)

`merge_and_save` merges another stats object's restored metrics into this one, dropping zero-cost entries, and saves; the enterprise server uses it to combine stats reported from a nested conversation.

Sources: [openhands/server/services/conversation_stats.py:105-160](repo://openhands/server/services/conversation_stats.py#L105-L160), [enterprise/server/utils/conversation_callback_utils.py:290-296](repo://enterprise/server/utils/conversation_callback_utils.py#L290-L296)

## Model routing

### RouterLLM

> [!NOTE]
> Model routing is marked experimental in the code.

Sources: [openhands/llm/router/README.md:1-8](repo://openhands/llm/router/README.md#L1-L8)

A `RouterLLM` is an `LLM` that holds several LLMs and picks one per completion call. It gets the primary model from the agent config and one LLM per entry in `model_routing.llms_for_routing`, registered as `llm_for_routing.<name>`, names itself `router(model1,model2,...)`, and routes each `completion` call to the key returned by `_select_llm(messages)`. Any other attribute is read from the LLM chosen last, so callers such as the agent can treat it as a plain LLM.

Sources: [openhands/llm/router/base.py:31-86](repo://openhands/llm/router/base.py#L31-L86), [openhands/llm/router/base.py:105-152](repo://openhands/llm/router/base.py#L105-L152)

The [[CodeAct Agent]] asks the registry for `get_router(config)` at construction. With the default `router_name = 'noop_router'` this returns the ordinary agent LLM; any other name is looked up in `ROUTER_LLM_REGISTRY`, and an unknown name raises `ValueError`.

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:95-96](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L95-L96), [openhands/llm/llm_registry.py:111-128](repo://openhands/llm/llm_registry.py#L111-L128), [openhands/llm/router/base.py:154-164](repo://openhands/llm/router/base.py#L154-L164)

### The multimodal router

`MultimodalRouter` (`multimodal_router`) routes between the primary model and an LLM config named `secondary_model`, which must exist. It sends a request to the primary model when any message contains an image, or when the messages exceed the secondary model's `max_input_tokens`. Once the token limit has been exceeded, it stays on the primary model for the rest of the conversation, because the history only grows. Everything else goes to the cheaper secondary model. Vision support is reported from the primary model, so the agent still includes images.

Sources: [openhands/llm/router/rule_based/impl.py:9-74](repo://openhands/llm/router/rule_based/impl.py#L9-L74)

### Configuration

Routing is configured with a `[model_routing]` section and LLM groups marked `for_routing = true`; the config loader attaches those groups to the default agent's `model_routing.llms_for_routing`.

Sources: [openhands/core/config/model_routing_config.py:6-39](repo://openhands/core/config/model_routing_config.py#L6-L39), [openhands/core/config/utils.py:202-231](repo://openhands/core/config/utils.py#L202-L231)

```toml
[llm]
model = "claude-sonnet-4"
api_key = "your-api-key"

[llm.secondary_model]
model = "kimi-k2"
api_key = "your-api-key"
for_routing = true

[model_routing]
router_name = "multimodal_router"
```

Sources: [openhands/llm/router/README.md:17-35](repo://openhands/llm/router/README.md#L17-L35)

A new router subclasses `RouterLLM`, implements `_select_llm` to return `primary` or a routing config name, and adds itself to `ROUTER_LLM_REGISTRY` under its router name.

Sources: [openhands/llm/router/base.py:14-14](repo://openhands/llm/router/base.py#L14-L14), [openhands/llm/router/rule_based/impl.py:73-74](repo://openhands/llm/router/rule_based/impl.py#L73-L74)
