---
title: "Actions and Observations"
---
## Overview

Every event in a conversation is one of a fixed set of dataclasses. Actions say what someone wants done; observations say what happened. This page lists them, what each field means, and which observation answers which action. How events are numbered, stored and delivered is in [[Events and Event Stream]]; how the sandbox carries out the runnable actions is in [[Action Execution Server]].

Sources: [openhands/events/serialization/action.py:30-53](repo://openhands/events/serialization/action.py#L30-L53), [openhands/events/serialization/observation.py:35-59](repo://openhands/events/serialization/observation.py#L35-L59)

Each class carries its type string in an `action` or `observation` field, taken from `ActionType` or `ObservationType`. The serialisers build their lookup tables from those strings, so an event type that is not in these two tuples cannot be read back from storage.

Sources: [openhands/core/schema/action.py:5-98](repo://openhands/core/schema/action.py#L5-L98), [openhands/core/schema/observation.py:5-59](repo://openhands/core/schema/observation.py#L5-L59)

## Common action fields

`Action` adds one class attribute to `Event`: `runnable`, false by default. A runnable action needs the runtime to produce an observation, so the controller holds it as the pending action until the answer arrives ([[Agent Controller]]). Non-runnable actions (messages, finish, think, recall, condensation) are handled by the controller or memory and never reach the sandbox.

Sources: [openhands/events/action/action.py:21-23](repo://openhands/events/action/action.py#L21-L23), [openhands/controller/agent_controller.py:918-919](repo://openhands/controller/agent_controller.py#L918-L919)

Most actions the model can produce also have a `thought` (the model's explanation), a `security_risk` and, for executable ones, a `confirmation_state`. `ActionSecurityRisk` is an integer enum: `UNKNOWN` (-1), `LOW` (0), `MEDIUM` (1), `HIGH` (2). `ActionConfirmationStatus` is `confirmed` (the default), `rejected` or `awaiting_confirmation`. [[Security Analyzers and Confirmation]] explains how they are set.

Sources: [openhands/events/action/action.py:8-18](repo://openhands/events/action/action.py#L8-L18), [openhands/events/action/commands.py:25-28](repo://openhands/events/action/commands.py#L25-L28)

The tool call that produced an action is kept as `ToolCallMetadata`: the function name, the tool-call id, the full LiteLLM `ModelResponse` and the number of calls in that response. The runtime copies it onto the observation, which lets [[Conversation Memory]] pair them as a tool call and its result.

Sources: [openhands/events/tool.py:1-11](repo://openhands/events/tool.py#L1-L11), [openhands/runtime/base.py:390-391](repo://openhands/runtime/base.py#L390-L391)

## Executable actions

### Types and results

| Action | Type string | Key fields | Answered by |
| --- | --- | --- | --- |
| `CmdRunAction` | `run` | `command`, `is_input`, `blocking`, `is_static`, `cwd`, `hidden` | `CmdOutputObservation` |
| `IPythonRunCellAction` | `run_ipython` | `code`, `include_extra`, `kernel_init_code` | `IPythonRunCellObservation` |
| `FileReadAction` | `read` | `path`, `start`, `end`, `impl_source`, `view_range` | `FileReadObservation` |
| `FileWriteAction` | `write` | `path`, `content`, `start`, `end` | `FileWriteObservation` |
| `FileEditAction` | `edit` | `path`, `command`, `file_text`, `old_str`, `new_str`, `insert_line`, `content`, `start`, `end`, `impl_source` | `FileEditObservation` |
| `BrowseURLAction` | `browse` | `url`, `return_axtree` | `BrowserOutputObservation` |
| `BrowseInteractiveAction` | `browse_interactive` | `browser_actions`, `browsergym_send_msg_to_user`, `return_axtree` | `BrowserOutputObservation` |
| `MCPAction` | `call_tool_mcp` | `name`, `arguments` | `MCPObservation` |

Sources: [openhands/events/action/commands.py:12-64](repo://openhands/events/action/commands.py#L12-L64), [openhands/events/action/files.py:9-115](repo://openhands/events/action/files.py#L9-L115), [openhands/events/action/browse.py:8-48](repo://openhands/events/action/browse.py#L8-L48), [openhands/events/action/mcp.py:8-24](repo://openhands/events/action/mcp.py#L8-L24)

### Commands

`CmdRunAction.command` is a shell command. An empty command prints the current tmux window, which is how the agent checks on a long-running process. With `is_input=True` the text is sent to the running process instead of starting a new command. `blocking` waits for the hard timeout instead of returning early; `is_static` runs the command in a separate process in `cwd`; `hidden` marks internal commands that should not reach the model.

Sources: [openhands/events/action/commands.py:12-28](repo://openhands/events/action/commands.py#L12-L28)

`IPythonRunCellAction` runs `code` in the sandbox's Jupyter kernel. `include_extra` appends the working directory and interpreter to the output, and `kernel_init_code` is rerun if the kernel restarts.

Sources: [openhands/events/action/commands.py:42-64](repo://openhands/events/action/commands.py#L42-L64)

### Files

`FileReadAction` reads a whole file or a line range; `view_range` is only used with the `oh_aci` implementation. `FileWriteAction` writes `content` to a path.

Sources: [openhands/events/action/files.py:9-58](repo://openhands/events/action/files.py#L9-L58), [openhands/events/event.py:15-22](repo://openhands/events/event.py#L15-L22)

`FileEditAction` has two modes, chosen by `impl_source`. The default `oh_aci` mode is the `str_replace_editor` tool: `command` is `view`, `create`, `str_replace`, `insert`, `undo_edit` or `write`, with `file_text`, `old_str`, `new_str` and `insert_line` as arguments. The `llm_based_edit` mode replaces lines `start` to `end` with `content` (append when `start` is -1), and the runtime applies it with a separate LLM call. A `view` command is turned into a `FileReadAction` rather than kept as an edit.

Sources: [openhands/events/action/files.py:61-138](repo://openhands/events/action/files.py#L61-L138)

### Browser and MCP

`BrowseURLAction` opens a URL; `BrowseInteractiveAction` runs a string of BrowserGym actions such as clicks and typing. Both can ask for the accessibility tree back with `return_axtree`. `MCPAction` calls the MCP tool `name` with `arguments` ([[MCP Tools]]).

Sources: [openhands/events/action/browse.py:8-48](repo://openhands/events/action/browse.py#L8-L48), [openhands/events/action/mcp.py:8-32](repo://openhands/events/action/mcp.py#L8-L32)

## Conversation and control actions

| Action | Type string | Purpose |
| --- | --- | --- |
| `MessageAction` | `message` | Text from the user or agent, with optional `image_urls`, `file_urls` and `wait_for_response` |
| `SystemMessageAction` | `system` | The system prompt and tool list, with `openhands_version` and `agent_class`; the first event of a conversation |
| `AgentFinishAction` | `finish` | Ends the task with `final_thought` and `outputs` |
| `AgentRejectAction` | `reject` | Refuses the task; `outputs['reason']` is shown |
| `AgentThinkAction` | `think` | Logs a thought; answered with a fixed acknowledgement |
| `AgentDelegateAction` | `delegate` | Hands a subtask to the agent named in `agent` with `inputs` |
| `RecallAction` | `recall` | Asks memory for workspace context or microagent knowledge for `query` |
| `CondensationAction` | `condensation` | Records which events are forgotten from the prompt and an optional summary |
| `CondensationRequestAction` | `condensation_request` | Asks the condenser to condense now |
| `TaskTrackingAction` | `task_tracking` | Views or replaces the agent's task list (`command`, `task_list`) |
| `ChangeAgentStateAction` | `change_agent_state` | Sets the agent state, for example from the UI's stop button |
| `NullAction` | `null` | Does nothing |

Sources: [openhands/events/action/message.py:9-66](repo://openhands/events/action/message.py#L9-L66), [openhands/events/action/agent.py:9-104](repo://openhands/events/action/agent.py#L9-L104), [openhands/events/action/agent.py:191-228](repo://openhands/events/action/agent.py#L191-L228), [openhands/events/action/empty.py:7-15](repo://openhands/events/action/empty.py#L7-L15)

`CondensationAction` names the forgotten events either as a list (`forgotten_event_ids`) or as an inclusive range (`forgotten_events_start_id`, `forgotten_events_end_id`), never both; `summary` and `summary_offset` must be set together. The constructor raises `ValueError` otherwise. The `forgotten` property always returns the list form. [[Condensers]] describes how these are produced and applied.

Sources: [openhands/events/action/agent.py:107-188](repo://openhands/events/action/agent.py#L107-L188)

## Observations

`Observation` adds one field to `Event`: `content`, the text the model sees. Its `cause` points at the action it answers.

Sources: [openhands/events/observation/observation.py:6-15](repo://openhands/events/observation/observation.py#L6-L15)

| Observation | Type string | Extra fields |
| --- | --- | --- |
| `CmdOutputObservation` | `run` | `command`, `metadata` (`CmdOutputMetadata`), `hidden` |
| `IPythonRunCellObservation` | `run_ipython` | `code`, `image_urls` |
| `FileReadObservation` | `read` | `path`, `impl_source` |
| `FileWriteObservation` | `write` | `path` |
| `FileEditObservation` | `edit` | `path`, `prev_exist`, `old_content`, `new_content`, `diff`, `impl_source` |
| `BrowserOutputObservation` | `browse` | `url`, `screenshot`, `set_of_marks`, `axtree_object`, `dom_object`, `open_pages_urls`, `last_browser_action_error`, `error` |
| `MCPObservation` | `mcp` | `name`, `arguments` |
| `AgentDelegateObservation` | `delegate` | `outputs` |
| `RecallObservation` | `recall` | Workspace context fields and `microagent_knowledge` |
| `AgentStateChangedObservation` | `agent_state_changed` | `agent_state`, `reason` |
| `AgentCondensationObservation` | `condense` | none |
| `AgentThinkObservation` | `think` | none |
| `TaskTrackingObservation` | `task_tracking` | `command`, `task_list` |
| `FileDownloadObservation` | `download` | `file_path` |
| `ErrorObservation` | `error` | `error_id` |
| `SuccessObservation` | `success` | none |
| `UserRejectObservation` | `user_rejected` | none |
| `NullObservation` | `null` | none |

Sources: [openhands/events/observation/commands.py:97-137](repo://openhands/events/observation/commands.py#L97-L137), [openhands/events/observation/commands.py:208-232](repo://openhands/events/observation/commands.py#L208-L232), [openhands/events/observation/files.py:12-68](repo://openhands/events/observation/files.py#L12-L68), [openhands/events/observation/browse.py:9-35](repo://openhands/events/observation/browse.py#L9-L35), [openhands/events/observation/agent.py:8-82](repo://openhands/events/observation/agent.py#L8-L82), [openhands/events/observation/error.py:7-16](repo://openhands/events/observation/error.py#L7-L16), [openhands/events/observation/task_tracking.py:9-14](repo://openhands/events/observation/task_tracking.py#L9-L14), [openhands/events/observation/mcp.py:9-14](repo://openhands/events/observation/mcp.py#L9-L14), [openhands/events/observation/delegate.py:8-18](repo://openhands/events/observation/delegate.py#L8-L18), [openhands/events/observation/file_download.py:8-10](repo://openhands/events/observation/file_download.py#L8-L10)

`ErrorObservation` is the error the model is expected to recover from, such as a lint failure after an edit; its docstring says so. The controller and runtime use it whenever an action cannot be carried out, so a failure becomes input for the next step rather than a crash.

Sources: [openhands/events/observation/error.py:7-23](repo://openhands/events/observation/error.py#L7-L23)

## Command output

`CmdOutputObservation` stores the exit code, process id, user, host, working directory and Python interpreter in `CmdOutputMetadata`. The sandbox shell gets them by setting a PS1 prompt that prints that metadata as JSON between `###PS1JSON###` and `###PS1END###` markers after each command, which the bash session parses ([[Action Execution Server]]).

Sources: [openhands/events/observation/commands.py:13-94](repo://openhands/events/observation/commands.py#L13-L94)

The constructor truncates content over 30,000 characters (matching `max_message_chars`) by keeping the first and last halves around a marker, except for hidden commands. `exit_code`, `error` and `success` are derived from the metadata. `to_agent_observation` is what the model reads: the output with any prefix and suffix, then the working directory, interpreter and exit code on separate lines.

Sources: [openhands/events/observation/commands.py:20-23](repo://openhands/events/observation/commands.py#L20-L23), [openhands/events/observation/commands.py:108-205](repo://openhands/events/observation/commands.py#L108-L205)

## Recall results

`RecallObservation` answers a `RecallAction`. For `workspace_context` it carries the repository name, directory, branch and instructions, runtime hosts, extra agent instructions, the date, descriptions of the user's custom secrets, conversation instructions and the working directory. For `knowledge`, and alongside workspace context, it carries a list of `MicroagentKnowledge` entries, each the microagent's name, the trigger word that matched, and its content. [[Microagents]] describes where these come from.

Sources: [openhands/events/observation/agent.py:47-107](repo://openhands/events/observation/agent.py#L47-L107), [openhands/events/event.py:25-32](repo://openhands/events/event.py#L25-L32)

## File edit results

`FileEditObservation.content` depends on the mode: in LLM-based editing it is a git-style diff, and in `oh_aci` mode it is the editor's message to the model. Both modes keep `old_content` and `new_content`, and `get_edit_groups` builds numbered before/after line groups from them with `SequenceMatcher` for display.

Sources: [openhands/events/observation/files.py:47-120](repo://openhands/events/observation/files.py#L47-L120)
