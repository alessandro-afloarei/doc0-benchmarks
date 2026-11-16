---
title: "Function Calling Emulation"
---
## Overview

The [[CodeAct Agent]] is written entirely around tool calls: it sends tool definitions and expects `tool_calls` in the reply. Many models, especially open-weight ones served locally, have no native tool-calling API. For those, `openhands/llm/fn_call_converter.py` rewrites the request into plain text that teaches the model a simple XML-like call syntax, and parses the model's text reply back into a standard tool call. The agent never knows the difference.

Sources: [openhands/llm/fn_call_converter.py:1-7](repo://openhands/llm/fn_call_converter.py#L1-L7)

The [[LLM Client]] decides when to emulate: whenever `is_function_calling_active()` is false and the caller passed `tools`. That flag comes from the model feature table or from the `native_tool_calling` config option, so emulation can also be forced on for a model that does support native calls.

Sources: [openhands/llm/llm.py:228-229](repo://openhands/llm/llm.py#L228-L229), [openhands/llm/llm.py:261-290](repo://openhands/llm/llm.py#L261-L290), [openhands/llm/llm.py:524-528](repo://openhands/llm/llm.py#L524-L528)

## The call syntax

### Format

The model is told to answer a tool call in exactly this form, with one call per message and optional reasoning before it but nothing after:

Sources: [openhands/llm/fn_call_converter.py:44-54](repo://openhands/llm/fn_call_converter.py#L44-L54)

```text
<function=example_function_name>
<parameter=example_parameter_1>value_1</parameter>
<parameter=example_parameter_2>
This is the value for the second parameter
that can span
multiple lines
</parameter>
</function>
```

Sources: [openhands/llm/fn_call_converter.py:30-54](repo://openhands/llm/fn_call_converter.py#L30-L54)

`</function` is the stop word. Sending it as a stop sequence makes the model stop right after the call, before it can invent a tool result of its own; it is only sent to models whose feature table allows stop words and when `disable_stop_word` is not set.

Sources: [openhands/llm/fn_call_converter.py:56-56](repo://openhands/llm/fn_call_converter.py#L56-L56), [openhands/llm/llm.py:276-282](repo://openhands/llm/llm.py#L276-L282)

### Tool descriptions

`convert_tools_to_description` renders every tool as a text block between `---- BEGIN FUNCTION #n: name ----` and `---- END FUNCTION #n ----`, with its description and numbered parameters showing type, whether required, description, and allowed enum values.

Sources: [openhands/llm/fn_call_converter.py:439-475](repo://openhands/llm/fn_call_converter.py#L439-L475)

## Outgoing: tool messages to text

### Rewriting by role

`convert_fncall_messages_to_non_fncall_messages(messages, tools)` rewrites each message by role:

Sources: [openhands/llm/fn_call_converter.py:478-490](repo://openhands/llm/fn_call_converter.py#L478-L490)

| Role | Rewrite |
| --- | --- |
| `system` | appends the format instructions and the tool descriptions |
| first `user` | wraps the text with an in-context example before it and a reminder after it |
| `assistant` with a tool call | appends the call in the text syntax; more than one call raises `FunctionCallConversionError` |
| `tool` | becomes a `user` message starting `EXECUTION RESULT of [tool_name]:`, keeping a cache marker if present |

Sources: [openhands/llm/fn_call_converter.py:492-558](repo://openhands/llm/fn_call_converter.py#L492-L558), [openhands/llm/fn_call_converter.py:560-619](repo://openhands/llm/fn_call_converter.py#L560-L619)

Tool call arguments are written one `<parameter=...>` tag each; multi-line strings get their own lines, and lists and dictionaries are written as JSON.

Sources: [openhands/llm/fn_call_converter.py:405-436](repo://openhands/llm/fn_call_converter.py#L405-L436)

### The in-context example

`get_example_for_tools` builds a worked example from fixed snippets in `TOOL_EXAMPLES`, using only the tools actually offered: checking a directory, creating a file with the editor, starting a web server, viewing it in the browser, killing and fixing it, and finishing. It is framed as `START OF EXAMPLE` ... `END OF EXAMPLE`, followed by a warning not to assume the environment is the same, and the real task is closed with a reminder to emit exactly one call per message.

Sources: [openhands/llm/fn_call_converter.py:320-396](repo://openhands/llm/fn_call_converter.py#L320-L396)

The client omits the example for models whose name contains `openhands-lm` or `devstral`, which were trained on this format; for `openhands-lm` it also sends `tool_choice='none'` so the serving stack does not try to parse calls itself.

Sources: [openhands/llm/llm.py:263-290](repo://openhands/llm/llm.py#L263-L290)

On Windows, `refine_prompt` replaces the word `bash` with `powershell` in prompts and tool descriptions.

Sources: [openhands/llm/fn_call_converter.py:59-63](repo://openhands/llm/fn_call_converter.py#L59-L63)

## Incoming: text back to tool calls

### Parsing the reply

After the call, the client appends the model's reply to the converted messages and runs `convert_non_fncall_messages_to_fncall_messages` over the whole list, keeping only the last message. For an assistant message it:

Sources: [openhands/llm/llm.py:322-346](repo://openhands/llm/llm.py#L322-L346)

1. repairs a missing stop word: if the text has exactly one `<function=` and ends in `</`, it completes `function>`, otherwise it appends `</function>`;
2. finds the call with `<function=([^>]+)>\n(.*?)</function>`;
3. normalizes malformed tags such as `<parameter=command=str_replace</parameter>`;
4. looks up the tool by name and parses each `<parameter=name>value</parameter>`;
5. builds a tool call with id `toolu_NN` and the parameters as JSON arguments, and strips the call text from the message content.

Sources: [openhands/llm/llm.py:322-346](repo://openhands/llm/llm.py#L322-L346), [openhands/llm/fn_call_converter.py:698-724](repo://openhands/llm/fn_call_converter.py#L698-L724), [openhands/llm/fn_call_converter.py:854-930](repo://openhands/llm/fn_call_converter.py#L854-L930)

The same function also undoes the outgoing conversion for earlier messages: it strips the format suffix from the system prompt and the example from the first user message, and turns `EXECUTION RESULT of [...]` user messages back into `tool` messages tied to the previous call id. This is how completion logs can store both forms.

Sources: [openhands/llm/fn_call_converter.py:727-790](repo://openhands/llm/fn_call_converter.py#L727-L790), [openhands/llm/fn_call_converter.py:791-852](repo://openhands/llm/fn_call_converter.py#L791-L852)

### Validation

`_extract_and_validate_params` checks every parameter against the tool's schema: unknown names, `integer` values that do not parse, `array` values that are not JSON, values outside an `enum`, and missing required parameters all raise `FunctionCallValidationError`. A function name that is not among the tools raises the same error.

Sources: [openhands/llm/fn_call_converter.py:622-695](repo://openhands/llm/fn_call_converter.py#L622-L695), [openhands/llm/fn_call_converter.py:882-892](repo://openhands/llm/fn_call_converter.py#L882-L892)

## What fails and how it surfaces

| Problem | Error | Where it ends up |
| --- | --- | --- |
| reply calls an unknown tool or has bad parameters | `FunctionCallValidationError` | the controller adds an `ErrorObservation`, and the model sees it next step |
| history has an assistant message with several tool calls | `FunctionCallConversionError` | raised from the completion call |
| content of an unexpected type | `FunctionCallConversionError` | raised from the completion call |
| reply has no call at all | none | a plain assistant message, which the agent turns into a message to the user |

Sources: [openhands/llm/fn_call_converter.py:565-568](repo://openhands/llm/fn_call_converter.py#L565-L568), [openhands/llm/fn_call_converter.py:926-930](repo://openhands/llm/fn_call_converter.py#L926-L930), [openhands/controller/agent_controller.py:873-887](repo://openhands/controller/agent_controller.py#L873-L887), [openhands/agenthub/codeact_agent/function_calling.py:322-328](repo://openhands/agenthub/codeact_agent/function_calling.py#L322-L328)

Because the emulated format allows a single call per message, an emulated model performs one action per LLM call, while a native model may return several.

Sources: [openhands/llm/fn_call_converter.py:394-396](repo://openhands/llm/fn_call_converter.py#L394-L396)

## Splitting parallel calls

`convert_from_multiple_tool_calls_to_single_tool_call_messages` is a helper for transforming recorded conversations: it splits an assistant message with several tool calls into one message per call, each followed by its result, and raises if a call has no result unless `ignore_final_tool_result` is set.

Sources: [openhands/llm/fn_call_converter.py:933-976](repo://openhands/llm/fn_call_converter.py#L933-L976)
