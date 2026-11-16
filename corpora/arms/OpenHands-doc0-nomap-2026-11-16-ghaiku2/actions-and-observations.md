---
title: "Actions and Observations"
---
## Overview

The event types are grouped by what they ask for and what they return. An action names work: a shell command, a file operation, a browser request, a message to the user, or a control instruction to the controller. An observation reports what came of an action, or what the memory or the controller recorded. This page lists the classes by kind, says which of them the runtime executes, and points to the page that produces or handles each group. The base classes and their serialization are on [[Event Model]].

Sources: [openhands/events/action/action.py:20-23](repo://openhands/events/action/action.py#L20-L23), [openhands/events/observation/observation.py:7-15](repo://openhands/events/observation/observation.py#L7-L15)

## Runnable actions

An action is runnable when its class sets `runnable` to true. The runtime executes those in its sandbox and answers each with an observation. Eight classes are runnable, and they are the ones that touch the environment: the shell, the IPython cell, file read, write and edit, the two browsing actions, and MCP calls.

Sources: [openhands/events/action/commands.py:13-50](repo://openhands/events/action/commands.py#L13-L50), [openhands/events/action/files.py:10-113](repo://openhands/events/action/files.py#L10-L113), [openhands/events/action/browse.py:9-35](repo://openhands/events/action/browse.py#L9-L35), [openhands/events/action/mcp.py:9-14](repo://openhands/events/action/mcp.py#L9-L14)

Non-runnable actions are handled without the sandbox. `run_action` returns a thought log for `AgentThinkAction` and a task-tracking result for `TaskTrackingAction`, and any other non-runnable action gets a `NullObservation`. A runtime that does not support an action returns an `ErrorObservation`.

Sources: [openhands/runtime/base.py:890-935](repo://openhands/runtime/base.py#L890-L935)

## Action catalogue

| Class | Kind | What it asks for |
| --- | --- | --- |
| `CmdRunAction` | runnable | Run a shell command in the sandbox |
| `IPythonRunCellAction` | runnable | Run a Python cell in the Jupyter kernel |
| `FileReadAction` | runnable | Read a file |
| `FileWriteAction` | runnable | Write a whole file |
| `FileEditAction` | runnable | Edit a file with view, create, replace-text, insert or undo commands, by ACI or LLM-based editing |
| `BrowseURLAction` | runnable | Fetch a URL and return its text |
| `BrowseInteractiveAction` | runnable | Run browser actions against a page |
| `MCPAction` | runnable | Call a tool on an MCP server |
| `MessageAction` | not runnable | A message from the user or the agent; the agent may wait for a reply |
| `SystemMessageAction` | not runnable | The system prompt, placed at the start of the history |
| `AgentThinkAction` | not runnable | A logged thought with no effect on the environment |
| `AgentFinishAction` | not runnable | The agent reports the task complete, with outputs |
| `AgentRejectAction` | not runnable | The agent declines the task, with outputs |
| `AgentDelegateAction` | not runnable | Start a delegate agent on a subtask |
| `ChangeAgentStateAction` | not runnable | Ask the controller to change the agent state |
| `RecallAction` | not runnable | Ask the memory for context for a message |
| `CondensationAction` | not runnable | Record a condensed view of the history |
| `CondensationRequestAction` | not runnable | Ask a condenser to shorten the history |
| `TaskTrackingAction` | not runnable | Read or update the task list |
| `NullAction` | not runnable | A placeholder that does nothing |

Sources: [openhands/events/action/commands.py:13-60](repo://openhands/events/action/commands.py#L13-L60), [openhands/events/action/files.py:10-75](repo://openhands/events/action/files.py#L10-L75), [openhands/events/action/browse.py:9-40](repo://openhands/events/action/browse.py#L9-L40), [openhands/events/action/mcp.py:9-20](repo://openhands/events/action/mcp.py#L9-L20), [openhands/events/action/message.py:10-60](repo://openhands/events/action/message.py#L10-L60), [openhands/events/action/agent.py:10-110](repo://openhands/events/action/agent.py#L10-L110), [openhands/events/action/agent.py:111-205](repo://openhands/events/action/agent.py#L111-L205), [openhands/events/action/empty.py:8-15](repo://openhands/events/action/empty.py#L8-L15)

`MessageAction` is the one action both sides use. A user message starts a recall before the agent steps, and an agent message with `wait_for_response` moves the controller to `AWAITING_USER_INPUT`. The state rules are on [[Agent Controller]].

Sources: [openhands/controller/agent_controller.py:549-589](repo://openhands/controller/agent_controller.py#L549-L589)

The condensation actions are the only ones that change what the agent sees. `CondensationAction` is produced by a condenser, and `CondensationRequestAction` by the controller after a context-window error. How they are used is on [[Condensers]].

Sources: [openhands/controller/agent_controller.py:880-917](repo://openhands/controller/agent_controller.py#L880-L917)

## Observation catalogue

| Class | Answers | What it carries |
| --- | --- | --- |
| `CmdOutputObservation` | `CmdRunAction` | Command output and exit status, with `CmdOutputMetadata` |
| `IPythonRunCellObservation` | `IPythonRunCellAction` | Cell output |
| `FileReadObservation` | `FileReadAction` | File content |
| `FileWriteObservation` | `FileWriteAction` | Result of a write |
| `FileEditObservation` | `FileEditAction` | Result of an edit, including a diff |
| `BrowserOutputObservation` | `BrowseURLAction`, `BrowseInteractiveAction` | The browser's output for a URL |
| `MCPObservation` | `MCPAction` | The MCP tool's result |
| `TaskTrackingObservation` | `TaskTrackingAction` | The task list |
| `SuccessObservation` | a successful action | The result of an action that succeeded |
| `ErrorObservation` | any action that failed | An error the model can recover from |
| `UserRejectObservation` | a rejected action | The result of an action the user declined |
| `AgentThinkObservation` | `AgentThinkAction` | The thought was logged |
| `AgentDelegateObservation` | `AgentDelegateAction` | The outputs of the delegate |
| `RecallObservation` | `RecallAction` | Workspace context or matched microagent knowledge |
| `AgentCondensationObservation` | `CondensationAction` | The output of a condensation |
| `AgentStateChangedObservation` | `ChangeAgentStateAction` | The new agent state |
| `FileDownloadObservation` | a file download | The downloaded file's details |
| `NullObservation` | a non-executable action | Nothing; it marks that the action produced no result |

Sources: [openhands/events/observation/commands.py:98-120](repo://openhands/events/observation/commands.py#L98-L120), [openhands/events/observation/commands.py:209-220](repo://openhands/events/observation/commands.py#L209-L220), [openhands/events/observation/files.py:12-60](repo://openhands/events/observation/files.py#L12-L60), [openhands/events/observation/browse.py:9-20](repo://openhands/events/observation/browse.py#L9-L20), [openhands/events/observation/mcp.py:9-20](repo://openhands/events/observation/mcp.py#L9-L20), [openhands/events/observation/task_tracking.py:9-18](repo://openhands/events/observation/task_tracking.py#L9-L18), [openhands/events/observation/success.py:8-15](repo://openhands/events/observation/success.py#L8-L15), [openhands/events/observation/error.py:8-20](repo://openhands/events/observation/error.py#L8-L20), [openhands/events/observation/reject.py:8-15](repo://openhands/events/observation/reject.py#L8-L15), [openhands/events/observation/agent.py:9-62](repo://openhands/events/observation/agent.py#L9-L62), [openhands/events/observation/delegate.py:8-16](repo://openhands/events/observation/delegate.py#L8-L16), [openhands/events/observation/file_download.py:8-16](repo://openhands/events/observation/file_download.py#L8-L16), [openhands/events/observation/empty.py:8-16](repo://openhands/events/observation/empty.py#L8-L16)

The controller answers a failed step with an `ErrorObservation` that carries the error text, which is how a malformed model reply reaches the model. The memory answers a recall with a `RecallObservation`, or with a `NullObservation` when nothing matches.

Sources: [openhands/controller/agent_controller.py:874-887](repo://openhands/controller/agent_controller.py#L874-L887), [openhands/memory/memory.py:100-119](repo://openhands/memory/memory.py#L100-L119)

## Matching answers to actions

An observation is linked to its action by its `cause`, which the runtime sets to the action's ID when it adds the answer. The controller uses that link to clear the pending action, so the agent steps only after its last action has been answered.

Sources: [openhands/runtime/base.py:386-400](repo://openhands/runtime/base.py#L386-L400), [openhands/controller/agent_controller.py:519-547](repo://openhands/controller/agent_controller.py#L519-L547)
