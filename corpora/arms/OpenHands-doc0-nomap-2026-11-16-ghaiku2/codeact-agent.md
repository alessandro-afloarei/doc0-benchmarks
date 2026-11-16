---
title: "CodeAct Agent"
---
## Overview

`CodeActAgent` is the default agent. On each step it sends the model the conversation so far together with a list of tools, and it turns the model's tool calls into actions. Its tools are the same kinds of action the runtime can run: a shell command, a file edit, a Python cell, a browser call and a few control tools. The class does not run anything itself. Its step is a short pipeline that uses the [[Condensers]], [[Memory and Recall]] and [[LLM Client]] pages for the parts it does not own.

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:49-69](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L49-L69), [openhands/agenthub/codeact_agent/codeact_agent.py:160-224](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L160-L224)

The agent declares two sandbox plugins, the agent-skills library and Jupyter, in a fixed order because the skills must load before Jupyter can use them. Those plugins are installed in the runtime before the first step.

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:70-74](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L70-L74)

## Tools offered to the model

`_get_tools` builds the tool list from the agent's configuration flags. Each flag adds one tool: `enable_cmd` for the shell, `enable_think`, `enable_finish`, `enable_condensation_request`, `enable_browsing`, `enable_jupyter` and `enable_plan_mode` for the task tracker. The editor is either the LLM-based editor (when `enable_llm_editor` is set) or the string-replace editor (when `enable_editor` is set), and never both.

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:108-152](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L108-L152)

Some model families get shorter tool descriptions. A model whose name contains `gpt-4`, `o1`, `o3` or `o4` gets the short form of the shell, task-tracker and editor tools, to stay under the token limit that older OpenAI models enforced on tool descriptions. On Windows the browser tool is left out because the runtime does not support browsing there.

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:110-127](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L110-L127), [openhands/agenthub/codeact_agent/codeact_agent.py:129-148](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L129-L148)

## One step

`step` first returns a queued action if one is waiting from an earlier response, since a single model reply can contain several tool calls. A user message that is exactly `/exit` ends the run with an `AgentFinishAction`. Otherwise the condenser is asked for the history to send: it returns either a `View` of events, which the agent uses, or a `Condensation`, which the agent returns at once as its action so the controller can step again with a shorter history.

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:160-200](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L160-L200)

When the view is used, the agent builds the messages, adds the tool list after `check_tools` adapts it to the model, adds metadata for the LLM call, and calls `llm.completion`. Each action in the reply is appended to `pending_actions`, and the first one is returned.

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:200-224](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L200-L224), [openhands/llm/llm_utils.py:11-30](repo://openhands/llm/llm_utils.py#L11-L30)

## Building the messages

`_get_messages` hands the condensed events to `ConversationMemory.process_events`, together with the initial user message, the character limit for each message, and whether the model accepts images. If the LLM uses prompt caching, the memory marks the messages for caching. The function-calling pairing of tool calls and results, and the alternation of roles, are handled there.

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:246-293](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L246-L293)

The system prompt is loaded from a Jinja2 template chosen by `resolved_system_prompt_filename`. The templates live in `codeact_agent/prompts`: a base prompt, an interactive variant, a long-horizon variant, a technical-philosophy variant, the user prompt, the microagent and additional-info templates, and the security risk assessment template.

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:100-107](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L100-L107)

## Turning the reply into actions

With function calling, `response_to_actions` reads each tool call, parses its JSON arguments, and builds the matching action. A bash call becomes a `CmdRunAction`, after checking the required `command` argument and reading an optional timeout. Malformed arguments raise `FunctionCallValidationError`, which the controller reports back to the model as an error observation rather than ending the run.

Sources: [openhands/agenthub/codeact_agent/function_calling.py:73-120](repo://openhands/agenthub/codeact_agent/function_calling.py#L73-L120), [openhands/agenthub/codeact_agent/codeact_agent.py:295-299](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L295-L299)

Each tool name maps to one action class. A tool name the agent does not offer and does not recognise as an MCP tool raises `FunctionCallNotExistsError`. MCP tools are recognised by the names the agent was given, so a call to an MCP server becomes an `MCPAction`. The reply's text is attached only to the first action of the reply, through `combine_thought`.

Sources: [openhands/agenthub/codeact_agent/function_calling.py:301-315](repo://openhands/agenthub/codeact_agent/function_calling.py#L301-L315), [openhands/agenthub/codeact_agent/function_calling.py:49-57](repo://openhands/agenthub/codeact_agent/function_calling.py#L49-L57)

## Models without native tool calls

When the LLM reports that function calling is not active, the LLM wrapper converts the tools and the messages into plain-text prompts before the call and parses the reply back. The agent still sees tool calls in its own format; the conversion happens inside [[LLM Client]].

Sources: [openhands/llm/llm.py:220-232](repo://openhands/llm/llm.py#L220-L232), [openhands/llm/llm.py:266-273](repo://openhands/llm/llm.py#L266-L273), [openhands/llm/llm.py:576-581](repo://openhands/llm/llm.py#L576-L581)
