---
title: "CodeAct Agent"
---
## Overview

`CodeActAgent` is the default agent. Each step it turns the event history into a chat prompt, asks the model for a reply with a list of tools, and converts the reply into `Action` objects. It returns one action per step and keeps the rest in a queue for the next steps. It does not run anything itself: the controller passes the action on to the runtime.

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:49-96](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L49-L96), [openhands/agenthub/codeact_agent/codeact_agent.py:160-224](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L160-L224)

The constructor creates a queue for pending actions, builds the tool list, creates a `ConversationMemory` for prompt construction and a condenser from the config, and asks the LLM registry for the model to use. The prompt manager loads the templates from the agent's `prompts` folder.

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:78-106](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L78-L106)

## The step

A step first returns a queued action if one exists, so one model reply can yield several actions in order. A user message that is exactly `/exit` ends the agent with an `AgentFinishAction` without calling the model.

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:182-190](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L182-L190)

The condenser then decides what the model sees. It returns either a view of the events or a `Condensation` action. A condensation is returned to the controller at once, and the controller asks the agent to step again with the new view. The condensers are described in [[Condenser Catalogue]].

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:192-204](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L192-L204)

With a view in hand, the agent finds the first user message in the full history, builds the messages, and adds the tool list and the `state.to_llm_metadata` payload to the call. `LLM.completion` makes the request, and the reply goes to `response_to_actions`. The first action is returned and the rest wait in the queue.

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:206-224](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L206-L224)

The initial user message is passed on to the conversation memory with the events. A history with no user message raises a `ValueError`.

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:226-244](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L226-L244)

`_get_messages` hands the condensed events and the initial message to `ConversationMemory.process_events`, passing the model's character limit and whether vision is active. When prompt caching is active for the model, it marks the cacheable messages afterwards.

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:246-293](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L246-L293)

## Tools

The tool list depends on the agent config. Command execution, think, finish, condensation request, browsing, IPython, plan mode, the LLM-based editor and the string-replace editor each have a flag. Browsing is left out on Windows, with a warning. Short tool descriptions are used for models whose name contains `gpt-4`, `o1`, `o3` or `o4`.

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:108-152](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L108-L152)

The flags default to the values in `AgentConfig`. The `enable_llm_editor` flag, which uses the deprecated LLM-based editor, is off by default, and `enable_editor` takes the string-replace editor in its place.

Sources: [openhands/core/config/agent_config.py:24-52](repo://openhands/core/config/agent_config.py#L24-L52)

Plan mode also changes the system prompt: when it is on and the prompt file is the default, the long-horizon template is used.

Sources: [openhands/core/config/agent_config.py:69-77](repo://openhands/core/config/agent_config.py#L69-L77)

## From reply to actions

`response_to_actions` reads the single choice in the model response. If the message has no tool calls, the text becomes a `MessageAction` with `wait_for_response` set, so the agent asks the user something and waits.

Sources: [openhands/agenthub/codeact_agent/function_calling.py:73-80](repo://openhands/agenthub/codeact_agent/function_calling.py#L73-L80), [openhands/agenthub/codeact_agent/function_calling.py:322-328](repo://openhands/agenthub/codeact_agent/function_calling.py#L322-L328)

Each tool call becomes one action. The arguments are parsed as JSON, and a parse failure raises `FunctionCallValidationError`. The tool name then selects the action class. A bash call needs a `command`. The finish tool becomes an `AgentFinishAction` carrying its message. A tool name that is neither built in nor an MCP tool raises `FunctionCallNotExistsError`, which the controller turns into an error observation.

Sources: [openhands/agenthub/codeact_agent/function_calling.py:91-110](repo://openhands/agenthub/codeact_agent/function_calling.py#L91-L110), [openhands/agenthub/codeact_agent/function_calling.py:147-150](repo://openhands/agenthub/codeact_agent/function_calling.py#L147-L150), [openhands/agenthub/codeact_agent/function_calling.py:301-308](repo://openhands/agenthub/codeact_agent/function_calling.py#L301-L308)

The text the model wrote alongside the first tool call becomes that action's `thought`. Every action records the tool call id, the function name and the number of calls in the reply, so the observation can be matched back to the call later.

Sources: [openhands/agenthub/codeact_agent/function_calling.py:311-320](repo://openhands/agenthub/codeact_agent/function_calling.py#L311-L320)

The model call itself is described in [[LLM Client]]. The rest of the loop is in [[Agent Controller]], and the other agents that share the same base class are in [[Agent Catalogue]].

Sources: [openhands/controller/agent_controller.py:864-880](repo://openhands/controller/agent_controller.py#L864-L880), [openhands/agenthub/codeact_agent/codeact_agent.py:295-298](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L295-L298)
