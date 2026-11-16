---
title: "Actions and Observations"
---
## Overview

Every event on the [[Event Stream]] is either an `Action` (a request to do something: run a command, edit a file, send a message, finish) or an `Observation` (what the environment reported back: command output, file contents, an error). Agents produce actions, the runtime executes the runnable ones and answers with observations, and the controller reacts to both. This page lists each type, what answers it, and how events become the JSON written to the file store and sent to the browser.

Sources: [openhands/README.md:16-20](repo://openhands/README.md#L16-L20)

Both kinds are dataclasses extending `Event`. An action has an `action` string field naming its type and a class-level `runnable` flag, false by default; an observation has a `content` string and an `observation` type string. The answer to an action carries the action's id in its `cause`, which is how the controller matches observations to its pending action, as [[Agent Controller]] describes.

Sources: [openhands/events/action/action.py:21-23](repo://openhands/events/action/action.py#L21-L23), [openhands/events/observation/observation.py:1-15](repo://openhands/events/observation/observation.py#L1-L15), [openhands/controller/agent_controller.py:537-547](repo://openhands/controller/agent_controller.py#L537-L547)

## Runnable actions

Runnable actions are the ones the runtime executes. Each carries a `thought` (the LLM's reasoning, shown in the UI) and a `security_risk`, and command and code actions also carry a `confirmation_state`.

Sources: [openhands/events/action/commands.py:12-53](repo://openhands/events/action/commands.py#L12-L53)

| Action | `action` | Key fields | Answered by |
| --- | --- | --- | --- |
| `CmdRunAction` | `run` | `command`, `is_input`, `blocking`, `is_static`, `cwd`, `hidden` | `CmdOutputObservation` |
| `IPythonRunCellAction` | `run_ipython` | `code`, `include_extra`, `kernel_init_code` | `IPythonRunCellObservation` |
| `FileReadAction` | `read` | `path`, `start`, `end`, `view_range`, `impl_source` | `FileReadObservation` |
| `FileWriteAction` | `write` | `path`, `content`, `start`, `end` | `FileWriteObservation` |
| `FileEditAction` | `edit` | `path`, `command`, `old_str`, `new_str`, `file_text`, `insert_line`, or `content` with `start`/`end` | `FileEditObservation` |
| `BrowseURLAction` | `browse` | `url` | `BrowserOutputObservation` |
| `BrowseInteractiveAction` | `browse_interactive` | `browser_actions`, `browsergym_send_msg_to_user` | `BrowserOutputObservation` |
| `MCPAction` | `call_tool_mcp` | `name`, `arguments` | `MCPObservation` |

Sources: [openhands/events/action/commands.py:12-53](repo://openhands/events/action/commands.py#L12-L53), [openhands/events/action/files.py:9-115](repo://openhands/events/action/files.py#L9-L115), [openhands/events/action/browse.py:8-36](repo://openhands/events/action/browse.py#L8-L36), [openhands/events/action/mcp.py:8-15](repo://openhands/events/action/mcp.py#L8-L15), [openhands/core/schema/action.py:1-99](repo://openhands/core/schema/action.py#L1-L99)

`CmdRunAction` with an empty `command` prints the current terminal window, and with `is_input` sends the text to the process already running instead of starting a new command. `is_static` runs the command in a separate process in `cwd`, and `hidden` commands bypass the LLM and event stream entirely. A hard timeout set with `set_hard_timeout` makes the command blocking. How the shell interprets these is in [[Action Execution Server]].

Sources: [openhands/events/action/commands.py:13-28](repo://openhands/events/action/commands.py#L13-L28), [openhands/events/event.py:86-96](repo://openhands/events/event.py#L86-L96)

`FileEditAction` has two modes chosen by `impl_source`. With `oh_aci` (the default) it carries an editor `command` (`create`, `str_replace`, `insert`, `undo_edit` or `write`) and its arguments; `view` is turned into a `FileReadAction` instead. With `llm_based_edit` it carries `content` and a 1-indexed line range, and `start = -1` appends.

Sources: [openhands/events/action/files.py:61-115](repo://openhands/events/action/files.py#L61-L115)

## Agent and control actions

These actions are not executed by the runtime. The controller or memory component handles them.

Sources: [openhands/controller/agent_controller.py:494-517](repo://openhands/controller/agent_controller.py#L494-L517)

| Action | `action` | Fields | Handled by |
| --- | --- | --- | --- |
| `MessageAction` | `message` | `content`, `image_urls`, `file_urls`, `wait_for_response` | Controller; from the agent, a reply to the user |
| `SystemMessageAction` | `system` | `content`, `tools`, `openhands_version`, `agent_class` | First event: system prompt and tools |
| `AgentThinkAction` | `think` | `thought` | Logged; answered by `AgentThinkObservation` |
| `AgentFinishAction` | `finish` | `final_thought`, `outputs` | Controller sets `FINISHED` |
| `AgentRejectAction` | `reject` | `outputs` | Controller sets `REJECTED` |
| `AgentDelegateAction` | `delegate` | `agent`, `inputs` | Controller starts a delegate; answered by `AgentDelegateObservation` |
| `ChangeAgentStateAction` | `change_agent_state` | `agent_state` | Controller changes state |
| `RecallAction` | `recall` | `recall_type`, `query` | Memory; answered by `RecallObservation` |
| `CondensationAction` | `condensation` | `forgotten_event_ids` or a start/end range, `summary`, `summary_offset` | Marks events dropped from the LLM view |
| `CondensationRequestAction` | `condensation_request` | none | Asks the condenser to run |
| `TaskTrackingAction` | `task_tracking` | `command`, `task_list` | Answered by `TaskTrackingObservation` |
| `NullAction` | `null` | none | Does nothing |

Sources: [openhands/events/action/message.py:9-66](repo://openhands/events/action/message.py#L9-L66), [openhands/events/action/agent.py:9-106](repo://openhands/events/action/agent.py#L9-L106), [openhands/events/action/agent.py:107-218](repo://openhands/events/action/agent.py#L107-L218), [openhands/events/action/empty.py:1-15](repo://openhands/events/action/empty.py#L1-L15)

The condensation actions belong to the memory system and are covered in [[Conversation Memory and Condensers]]; recall is covered in [[Microagents]].

Sources: [openhands/events/action/agent.py:88-136](repo://openhands/events/action/agent.py#L88-L136), [openhands/events/action/agent.py:191-199](repo://openhands/events/action/agent.py#L191-L199)

## Observations

| Observation | `observation` | Extra fields |
| --- | --- | --- |
| `CmdOutputObservation` | `run` | `command`, `metadata` (exit code, pid, user, host, working dir, Python path), `hidden` |
| `IPythonRunCellObservation` | `run_ipython` | `code`, `image_urls` |
| `FileReadObservation` | `read` | `path`, `impl_source` |
| `FileWriteObservation` | `write` | `path` |
| `FileEditObservation` | `edit` | `path`, `prev_exist`, `old_content`, `new_content` |
| `BrowserOutputObservation` | `browse` | `url`, `screenshot`, `set_of_marks`, `axtree_object`, `dom_object`, `open_pages_urls`, `error` |
| `MCPObservation` | `mcp` | `name`, `arguments` |
| `RecallObservation` | `recall` | Workspace context fields or `microagent_knowledge` |
| `AgentDelegateObservation` | `delegate` | `outputs` |
| `AgentStateChangedObservation` | `agent_state_changed` | `agent_state`, `reason` |
| `AgentCondensationObservation` | `condense` | none |
| `AgentThinkObservation` | `think` | none |
| `TaskTrackingObservation` | `task_tracking` | `command`, `task_list` |
| `ErrorObservation` | `error` | `error_id` |
| `SuccessObservation` | `success` | none |
| `UserRejectObservation` | `user_rejected` | none |
| `FileDownloadObservation` | `download` | `file_path` |
| `NullObservation` | `null` | none |

Sources: [openhands/events/observation/commands.py:26-36](repo://openhands/events/observation/commands.py#L26-L36), [openhands/events/observation/commands.py:98-106](repo://openhands/events/observation/commands.py#L98-L106), [openhands/events/observation/commands.py:209-214](repo://openhands/events/observation/commands.py#L209-L214), [openhands/events/observation/files.py:12-64](repo://openhands/events/observation/files.py#L12-L64), [openhands/events/observation/browse.py:9-29](repo://openhands/events/observation/browse.py#L9-L29), [openhands/events/observation/agent.py:9-82](repo://openhands/events/observation/agent.py#L9-L82), [openhands/events/observation/mcp.py:9-14](repo://openhands/events/observation/mcp.py#L9-L14), [openhands/events/observation/delegate.py:8-18](repo://openhands/events/observation/delegate.py#L8-L18), [openhands/events/observation/error.py:8-16](repo://openhands/events/observation/error.py#L8-L16), [openhands/events/observation/task_tracking.py:9-14](repo://openhands/events/observation/task_tracking.py#L9-L14), [openhands/core/schema/observation.py:1-60](repo://openhands/core/schema/observation.py#L1-L60)

`CmdOutputObservation` truncates its content to 30,000 characters at construction, keeping the start and end around a `[... Observation truncated due to length ...]` marker; hidden commands are not truncated because they never reach the LLM. Its `exit_code` and `command_id` come from `metadata`, and `error` is true for a non-zero exit code.

Sources: [openhands/events/observation/commands.py:23-23](repo://openhands/events/observation/commands.py#L23-L23), [openhands/events/observation/commands.py:108-178](repo://openhands/events/observation/commands.py#L108-L178)

The metadata gets into the output through the shell prompt: `CmdOutputMetadata.to_ps1_prompt` builds a `PS1` that prints a JSON block with `$!`, `$?`, `\u`, `\h`, `$(pwd)` and the Python path between fixed markers, and `matches_ps1_metadata` and `from_ps1_match` parse those blocks out of the terminal output.

Sources: [openhands/events/observation/commands.py:38-97](repo://openhands/events/observation/commands.py#L38-L97)

A `RecallObservation` of type `workspace_context` carries the repository name, directory, branch and instructions, runtime hosts, extra agent instructions, the date, custom secret descriptions, conversation instructions and working directory. One of type `knowledge` carries a list of `MicroagentKnowledge` items, each with the microagent's `name`, the `trigger` word that matched, and its `content`.

Sources: [openhands/events/observation/agent.py:47-106](repo://openhands/events/observation/agent.py#L47-L106)

## Tool call metadata

Agents that use native function calling attach a `ToolCallMetadata` to each action they create from a tool call: the function name, the tool call id, the full LiteLLM `ModelResponse`, and how many tool calls that response held. The runtime copies it onto the observation, so the memory layer can rebuild the assistant message and its matching tool result when it builds the next prompt, as [[Conversation Memory and Condensers]] explains. The controller does the same when it fabricates an error for an action that never ran.

Sources: [openhands/events/tool.py:5-11](repo://openhands/events/tool.py#L5-L11), [openhands/controller/agent_controller.py:590-628](repo://openhands/controller/agent_controller.py#L590-L628)

## Serialization

`event_to_dict` produces the wire and storage format. Metadata (`id`, `timestamp`, `source`, `message`, `cause`, `tool_call_metadata`, `llm_metrics`) and the type key go at the top level, with an unassigned id left out. For actions the remaining dataclass fields go under `args`, with `security_risk` as its integer value and the hard `timeout` alongside; for observations `content` stays at the top level and the rest go under `extras`, with enums and Pydantic models converted to plain values.

Sources: [openhands/events/serialization/event.py:16-34](repo://openhands/events/serialization/event.py#L16-L34), [openhands/events/serialization/event.py:100-152](repo://openhands/events/serialization/event.py#L100-L152)

```json
{
  "id": 7,
  "timestamp": "2025-01-01T12:00:00",
  "source": "agent",
  "message": "Running command: ls",
  "action": "run",
  "args": {"command": "ls", "is_input": false, "thought": "", "blocking": false, "security_risk": -1}
}
```

Sources: [openhands/events/serialization/event.py:100-135](repo://openhands/events/serialization/event.py#L100-L135)

`event_from_dict` picks `action_from_dict` or `observation_from_dict` by which key is present, then restores the underscore metadata, rebuilding `EventSource`, `ToolCallMetadata` and `Metrics` objects.

Sources: [openhands/events/serialization/event.py:52-91](repo://openhands/events/serialization/event.py#L52-L91)

`action_from_dict` maps the `action` string to its class through `ACTION_TYPE_TO_CLASS` and builds it from `args`. An unknown type, a missing key or wrong arguments raise `LLMMalformedActionError`. It also upgrades old event logs: `is_confirmed` becomes `confirmation_state`, `images_urls` becomes `image_urls`, and deprecated fields such as `keep_prompt` and `translated_ipython_code` are dropped or converted.

Sources: [openhands/events/serialization/action.py:30-95](repo://openhands/events/serialization/action.py#L30-L95), [openhands/events/serialization/action.py:98-154](repo://openhands/events/serialization/action.py#L98-L154)

`observation_from_dict` does the same through `OBSERVATION_TYPE_TO_CLASS`, rebuilding `CmdOutputMetadata` (and moving the old top-level `exit_code` and `command_id` into it), `RecallType` and `MicroagentKnowledge` objects.

Sources: [openhands/events/serialization/observation.py:35-140](repo://openhands/events/serialization/observation.py#L35-L140)

`event_to_trajectory` is the export format for saved trajectories: it removes bulky browser fields (DOM, accessibility tree and similar) from `extras`, and screenshots too unless asked to keep them. `truncate_content` cuts the middle of long content with the same truncation marker used for command output.

Sources: [openhands/events/serialization/event.py:36-49](repo://openhands/events/serialization/event.py#L36-L49), [openhands/events/serialization/event.py:155-178](repo://openhands/events/serialization/event.py#L155-L178)
