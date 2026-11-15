---
title: "Events, Actions and Observations"
---
## Overview

Everything that happens in an OpenHands conversation is an event: a user's message, the agent's command, the command's output, a change of agent state. An event is either an **action**, a request for something to be done, or an **observation**, a report of what happened. The controller, the runtime, the memory and the server exchange nothing else, so one vocabulary of classes defined in `openhands/events` is shared by every part of the system.

Sources: [openhands/README.md:16-20](repo://openhands/README.md#L16-L20), [openhands/events/event.py:35-51](repo://openhands/events/event.py#L35-L51)

This page describes the classes and their JSON form. How events are numbered, stored and delivered is on [[Event Stream]].

Sources: [openhands/events/serialization/event.py:52-152](repo://openhands/events/serialization/event.py#L52-L152)

## The Event base class

`Event` is a plain dataclass. Its identity fields are not dataclass fields but underscore attributes exposed as read-only properties, which is why a subclass can declare its own constructor arguments freely and why the stream, not the creator, fills them in.

Sources: [openhands/events/event.py:35-131](repo://openhands/events/event.py#L35-L131)

| Property | Backing attribute | Meaning |
| --- | --- | --- |
| `id` | `_id` | position in the stream; `INVALID_ID` (-1) until the event is added |
| `timestamp` | `_timestamp` | ISO time set when the event is added |
| `source` | `_source` | `EventSource.AGENT`, `USER` or `ENVIRONMENT` |
| `cause` | `_cause` | id of the action this observation answers |
| `timeout` | `_timeout` | hard timeout in seconds; `set_hard_timeout` also sets `blocking` when the event has it |
| `llm_metrics` | `_llm_metrics` | optional `Metrics` with the cost of producing the event |
| `tool_call_metadata` | `_tool_call_metadata` | the LLM tool call (function name, call id, full response, number of calls) that produced the action |
| `response_id` | `_response_id` | id of the LLM response |
| `message` | `_message` | human-readable summary, overridden by most subclasses |

Sources: [openhands/events/event.py:9-13](repo://openhands/events/event.py#L9-L13), [openhands/events/event.py:36-131](repo://openhands/events/event.py#L36-L131), [openhands/events/tool.py:5-11](repo://openhands/events/tool.py#L5-L11)

`cause` and `tool_call_metadata` are what tie an answer to its question. When the runtime finishes an action, it sets the observation's `_cause` to the action's id and copies the action's tool call metadata onto it, so the agent can later pair each tool result with the tool call that requested it.

Sources: [openhands/runtime/base.py:390-398](repo://openhands/runtime/base.py#L390-L398)

## Actions

### Common action fields

Every action class sets an `action` string from `ActionType` and may declare `runnable = True`, meaning the runtime has to execute it. Runnable actions also carry a `confirmation_state` (`confirmed`, `rejected` or `awaiting_confirmation`) and a `security_risk` (`UNKNOWN`, `LOW`, `MEDIUM`, `HIGH`), which [[Security Analyzers and Confirmation Mode]] uses to hold back risky commands.

Sources: [openhands/events/action/action.py:8-23](repo://openhands/events/action/action.py#L8-L23), [openhands/events/action/commands.py:12-28](repo://openhands/events/action/commands.py#L12-L28)

```python
@dataclass
class CmdRunAction(Action):
    command: (
        str  # When `command` is empty, it will be used to print the current tmux window
    )
    is_input: bool = False  # if True, the command is an input to the running process
    thought: str = ''
    blocking: bool = False  # if True, the command will be run in a blocking manner, but a timeout must be set through _set_hard_timeout
    is_static: bool = False  # if True, runs the command in a separate process
    cwd: str | None = None  # current working directory, only used if is_static is True
    hidden: bool = (
        False  # if True, this command does not go through the LLM or event stream
    )
    action: str = ActionType.RUN
    runnable: ClassVar[bool] = True
    confirmation_state: ActionConfirmationStatus = ActionConfirmationStatus.CONFIRMED
    security_risk: ActionSecurityRisk = ActionSecurityRisk.UNKNOWN
```

Sources: [openhands/events/action/commands.py:12-28](repo://openhands/events/action/commands.py#L12-L28)

### Actions the runtime executes

| Class | Type string | What it asks for |
| --- | --- | --- |
| `CmdRunAction` | `run` | run a shell command, or send input to a running one (`is_input`) |
| `IPythonRunCellAction` | `run_ipython` | run a Jupyter cell |
| `FileReadAction` | `read` | read a file, whole or a line range |
| `FileWriteAction` | `write` | write a file |
| `FileEditAction` | `edit` | edit a file through the ACI editor or the LLM-based editor |
| `BrowseURLAction` | `browse` | open a URL |
| `BrowseInteractiveAction` | `browse_interactive` | run BrowserGym actions on the page |
| `MCPAction` | `call_tool_mcp` | call a tool on an MCP server |

Sources: [openhands/events/action/commands.py:42-64](repo://openhands/events/action/commands.py#L42-L64), [openhands/events/action/files.py:9-62](repo://openhands/events/action/files.py#L9-L62), [openhands/core/schema/action.py:17-45](repo://openhands/core/schema/action.py#L17-L45)

### Actions about the conversation

| Class | Type string | Meaning |
| --- | --- | --- |
| `MessageAction` | `message` | a chat message, with optional image and file URLs and `wait_for_response` |
| `SystemMessageAction` | `system` | the system prompt and tool list, the first event of a conversation |
| `AgentThinkAction` | `think` | the agent records a thought |
| `AgentFinishAction` | `finish` | the agent ends the task with a final thought and outputs |
| `AgentRejectAction` | `reject` | the agent refuses the task |
| `AgentDelegateAction` | `delegate` | hand a subtask to another agent with inputs |
| `RecallAction` | `recall` | ask memory for workspace context or knowledge (see [[Microagents]]) |
| `CondensationAction` | `condensation` | forget a list or range of event ids, optionally with a summary (see [[Context Condensers]]) |
| `CondensationRequestAction` | `condensation_request` | the agent asks for its history to be condensed |
| `TaskTrackingAction` | `task_tracking` | update the agent's task list |
| `ChangeAgentStateAction` | `change_agent_state` | the user pauses, resumes or stops the agent |
| `NullAction` | `null` | no-op |

Sources: [openhands/events/action/message.py:9-66](repo://openhands/events/action/message.py#L9-L66), [openhands/events/action/agent.py:10-121](repo://openhands/events/action/agent.py#L10-L121), [openhands/events/action/agent.py:192-218](repo://openhands/events/action/agent.py#L192-L218)

## Observations

### Observation classes

`Observation` adds one field, `content`, the text the agent will see; subclasses set an `observation` string from `ObservationType` and add structured extras.

Sources: [openhands/events/observation/observation.py:6-15](repo://openhands/events/observation/observation.py#L6-L15)

| Class | Answers | Extras |
| --- | --- | --- |
| `CmdOutputObservation` | `CmdRunAction` | `command`, `metadata` (`CmdOutputMetadata`), `hidden` |
| `IPythonRunCellObservation` | `IPythonRunCellAction` | always reports success |
| `FileReadObservation`, `FileWriteObservation`, `FileEditObservation` | file actions | path, diff data for edits |
| `BrowserOutputObservation` | browse actions | URL, screenshot, accessibility tree (see [[Browser Environment]]) |
| `MCPObservation` | `MCPAction` | tool name and arguments |
| `AgentDelegateObservation` | `AgentDelegateAction` | the delegate's outputs |
| `RecallObservation` | `RecallAction` | `recall_type`, repository and runtime info, `microagent_knowledge` |
| `AgentStateChangedObservation` | state changes | `agent_state` |
| `AgentCondensationObservation`, `AgentThinkObservation`, `TaskTrackingObservation` | agent bookkeeping | |
| `ErrorObservation`, `SuccessObservation`, `UserRejectObservation`, `NullObservation`, `FileDownloadObservation` | generic outcomes | |

Sources: [openhands/events/serialization/observation.py:35-59](repo://openhands/events/serialization/observation.py#L35-L59), [openhands/events/observation/commands.py:98-127](repo://openhands/events/observation/commands.py#L98-L127), [openhands/events/observation/commands.py:209-226](repo://openhands/events/observation/commands.py#L209-L226)

### Command output metadata

`CmdOutputMetadata` holds what the shell reports about a finished command: `exit_code`, `pid`, `username`, `hostname`, `working_dir` and `py_interpreter_path`, plus a `prefix` and `suffix` added around the output. `to_ps1_prompt` builds a PS1 prompt that prints these values as JSON between `###PS1JSON###` and `###PS1END###` markers; [[Shell Sessions]] explains how the bash session parses them. `success` is true when the exit code is zero.

Sources: [openhands/events/observation/commands.py:13-57](repo://openhands/events/observation/commands.py#L13-L57), [openhands/events/observation/commands.py:176-186](repo://openhands/events/observation/commands.py#L176-L186)

Command output longer than `MAX_CMD_OUTPUT_SIZE` (30,000 characters) is cut in the middle when the observation is built, keeping the head and tail and inserting a truncation notice, so very large outputs never reach the stored stream. Hidden commands skip this, since they never reach the LLM.

Sources: [openhands/events/observation/commands.py:20-23](repo://openhands/events/observation/commands.py#L20-L23), [openhands/events/observation/commands.py:108-160](repo://openhands/events/observation/commands.py#L108-L160)

## Serialization

### To a dictionary

`event_to_dict` produces the JSON shape stored on disk, sent to the sandbox and pushed to browsers. The common keys (`id`, `timestamp`, `source`, `message`, `cause`, `action` or `observation`, `tool_call_metadata`, `llm_metrics`) go to the top level. An action's remaining fields go under `args`, with `security_risk` written as its integer value and `timeout` added at the top level when set. An observation's `content` stays at the top level and its other fields go under `extras`, with enums turned into values and Pydantic models dumped.

Sources: [openhands/events/serialization/event.py:16-34](repo://openhands/events/serialization/event.py#L16-L34), [openhands/events/serialization/event.py:100-152](repo://openhands/events/serialization/event.py#L100-L152)

```json
{
  "id": 12,
  "timestamp": "2025-01-01T12:00:00",
  "source": "agent",
  "message": "Running command: ls",
  "action": "run",
  "args": {"command": "ls", "is_input": false, "thought": "", "blocking": false, "security_risk": 0},
  "timeout": 120
}
```

Sources: [openhands/events/serialization/event.py:129-135](repo://openhands/events/serialization/event.py#L129-L135)

### From a dictionary

`event_from_dict` picks `action_from_dict` or `observation_from_dict` by which key is present, then restores the underscore attributes, rebuilding `EventSource`, `ToolCallMetadata` and `Metrics` objects. `action_from_dict` looks the class up in `ACTION_TYPE_TO_CLASS`, a map built from every action class's `action` string, and raises `LLMMalformedActionError` for an unknown type or wrong arguments. `observation_from_dict` does the same with `OBSERVATION_TYPE_TO_CLASS`, and rebuilds `CmdOutputMetadata` and `MicroagentKnowledge` objects from their dictionaries.

Sources: [openhands/events/serialization/event.py:52-91](repo://openhands/events/serialization/event.py#L52-L91), [openhands/events/serialization/action.py:53-154](repo://openhands/events/serialization/action.py#L53-L154), [openhands/events/serialization/observation.py:99-140](repo://openhands/events/serialization/observation.py#L99-L140)

### Backward compatibility

Old stored conversations still load. The action decoder renames `is_confirmed` to `confirmation_state` and `images_urls` to `image_urls`, drops the removed `keep_prompt` and `task_completed` arguments, and turns the old `translated_ipython_code` form of file-editor calls back into editor arguments. The observation decoder moves the old top-level `exit_code` and `command_id` extras into `CmdOutputMetadata`.

Sources: [openhands/events/serialization/action.py:56-137](repo://openhands/events/serialization/action.py#L56-L137), [openhands/events/serialization/observation.py:82-96](repo://openhands/events/serialization/observation.py#L82-L96)

### Trajectories

`event_to_trajectory` is the variant used when a conversation is exported or saved for evaluation. It removes bulky browser extras such as the DOM and accessibility-tree objects, and also the screenshot and set-of-marks images unless screenshots were requested.

Sources: [openhands/events/serialization/event.py:36-49](repo://openhands/events/serialization/event.py#L36-L49), [openhands/events/serialization/event.py:155-164](repo://openhands/events/serialization/event.py#L155-L164)
