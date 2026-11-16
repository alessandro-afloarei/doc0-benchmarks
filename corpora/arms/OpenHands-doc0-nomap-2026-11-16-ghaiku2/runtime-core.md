---
title: "Runtime Core"
---
## Overview

The `Runtime` base class is the host-side half of action execution. It subscribes to the conversation's event stream, takes each `Action` the agent produces, runs it, and adds the answer back to the stream as an `Observation` whose cause is the action's ID. It also prepares the workspace: it sets environment variables, clones or initialises the repository, runs the repository's setup script, and loads the microagents. It does not know how to run a command itself. Each concrete runtime provides the typed methods that do the work, described in [[Runtime Implementations]], and most of those forward the work into a process inside the sandbox, described in [[Action Execution Server]].

Sources: [openhands/runtime/base.py:90-127](repo://openhands/runtime/base.py#L90-L127), [openhands/runtime/README.md:1-12](repo://openhands/runtime/README.md#L1-L12)

## Construction

`Runtime.__init__` builds a `GitHandler` for git queries, stores the stream, and subscribes to it under the runtime subscriber ID, so every event reaches `on_event`. It copies the plugin list the agent asked for, and adds the VS Code plugin unless the run is headless. The provider tokens it receives are used later, when the repository is cloned.

Sources: [openhands/runtime/base.py:128-160](repo://openhands/runtime/base.py#L128-L160)

`setup_initial_env` adds the configured initial variables and any `runtime_startup_env_vars` from the sandbox configuration. It does nothing when the runtime attaches to an existing sandbox, so an attached session keeps the environment it already has.

Sources: [openhands/runtime/base.py:207-221](repo://openhands/runtime/base.py#L207-L221)

## Receiving and answering actions

`on_event` passes only `Action` events on, and each one goes to `_handle_action` on the event loop. Before running it, `_handle_action` sets a hard timeout from the sandbox configuration if the action has none, and forwards any git provider tokens the action carries.

Sources: [openhands/runtime/base.py:320-322](repo://openhands/runtime/base.py#L320-L322), [openhands/runtime/base.py:361-372](repo://openhands/runtime/base.py#L361-L372)

The action runs in a thread through `run_action`, or, for an `MCPAction`, through `call_tool_mcp`. A `PermissionError` becomes an `ErrorObservation`, so the model can recover from it. A network error or a disconnect sets the runtime status to disconnected and adds nothing to the stream. Any other exception sets the status to `ERROR` with the exception's name and message, and also adds nothing.

Sources: [openhands/runtime/base.py:373-392](repo://openhands/runtime/base.py#L373-L392)

The observation gets the action's ID as its cause and the action's tool-call metadata, and is then added to the stream with the action's source. A `NullObservation` is dropped instead of being added. This is the step that wakes the controller: its observation has the cause that matches the pending action.

Sources: [openhands/runtime/base.py:393-400](repo://openhands/runtime/base.py#L393-L400), [openhands/controller/agent_controller.py:519-547](repo://openhands/controller/agent_controller.py#L519-L547)

## Dispatch

`run_action` first handles the actions that are not runnable. A thought is answered with a logged-thought observation, a task-tracking action reads or writes the task list in the conversation's directory, and a non-runnable action with no other handling gets a `NullObservation`.

Sources: [openhands/runtime/base.py:890-925](repo://openhands/runtime/base.py#L890-L925)

Next, an action that is waiting for confirmation gets no answer, and a rejected action gets a `UserRejectObservation` with the message that the user rejected it. An action name that is not a known class gets an `ErrorObservation`, and so does a name the runtime does not implement. Otherwise the action's name selects a method, such as `run`, `run_ipython`, `read`, `write`, `edit` or `browse`, and that method's observation is returned.

Sources: [openhands/runtime/base.py:926-960](repo://openhands/runtime/base.py#L926-L960), [openhands/runtime/base.py:1035-1062](repo://openhands/runtime/base.py#L1035-L1062)

The typed methods are abstract in the base class. A subclass must implement them, and the subclass decides what "run this command" means. The base class only decides which method to call and what to do with the result.

Sources: [openhands/runtime/base.py:1035-1062](repo://openhands/runtime/base.py#L1035-L1062)

## Preparing the workspace

`connect` is a no-op in the base class, and concrete runtimes override it to start their sandbox. Once a runtime is connected, `clone_or_init_repo` prepares the workspace. With no repository selected, it runs `git init` only when `init_git_in_empty_workspace` is set. With a repository, it asks the provider handler for an authenticated URL, clones the repository into a folder named after it, and checks out the selected branch. Without a selected branch it creates a random `openhands-workspace-` branch, so concurrent workspaces do not collide.

Sources: [openhands/runtime/base.py:985-987](repo://openhands/runtime/base.py#L985-L987), [openhands/runtime/base.py:401-462](repo://openhands/runtime/base.py#L401-L462)

After the clone, `maybe_run_setup_script` runs `.openhands/setup.sh` from the workspace, if the file exists. The script is the repository's own way to install what it needs before the agent starts.

Sources: [openhands/runtime/base.py:463-494](repo://openhands/runtime/base.py#L463-L494)

The microagents of the selected repository are loaded from the runtime with `get_microagents_from_selected_repo`, which reads the folders described on [[Microagents]].

Sources: [openhands/runtime/base.py:823-889](repo://openhands/runtime/base.py#L823-L889)

## Status

`set_runtime_status` stores a `RuntimeStatus` and passes it to the status callback that the controller and the session install, so the user sees the state in the interface. Statuses cover the workspace setup, the disconnect, and errors from the memory and the LLM. On the command line, `run_agent_until_done` installs the callbacks when a run starts; the server's session does the same for its conversation. The controller reports its own errors through the same callback. See [[Agent Controller]].

Sources: [openhands/runtime/base.py:235-244](repo://openhands/runtime/base.py#L235-L244), [openhands/runtime/runtime_status.py:1-24](repo://openhands/runtime/runtime_status.py#L1-L24), [openhands/core/loop.py:20-45](repo://openhands/core/loop.py#L20-L45)

## Git and MCP

Git queries go through `GitHandler`, which runs commands and writes files through the runtime's own methods, so the changes list and diffs shown to the user come from inside the sandbox. `get_git_changes` and `get_git_diff` are the entry points.

Sources: [openhands/runtime/base.py:1115-1150](repo://openhands/runtime/base.py#L1115-L1150)

`MCPAction` is the only action that does not reach a typed method. Its tool call is sent to an MCP server through `call_tool_mcp`, and [[MCP Tools]] describes how those servers are configured and connected.

Sources: [openhands/runtime/base.py:1025-1034](repo://openhands/runtime/base.py#L1025-L1034), [openhands/runtime/base.py:1063-1070](repo://openhands/runtime/base.py#L1063-L1070)
