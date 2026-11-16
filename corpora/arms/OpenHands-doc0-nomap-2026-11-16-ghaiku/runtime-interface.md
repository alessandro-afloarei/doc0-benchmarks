---
title: "Runtime Interface"
---
## Overview

The runtime is the part of OpenHands that runs what the agent asks for: shell commands, file reads and writes, browsing, IPython cells and MCP tool calls. It is split in two. In the server process, a `Runtime` subclass listens to the event stream, and for each action it returns an observation to the stream. The work itself happens in an action execution server, a FastAPI app in a sandbox, which the runtime calls over HTTP. The concrete subclasses that start that server are described in [[Runtime Implementations]].

Sources: [openhands/runtime/base.py:90-128](repo://openhands/runtime/base.py#L90-L128), [openhands/runtime/action_execution_server.py:799-831](repo://openhands/runtime/action_execution_server.py#L799-L831)

## Receiving actions

`Runtime.__init__` subscribes `on_event` to the event stream under the runtime subscriber, and `on_event` passes each action to `_handle_action` on the event loop. Observations and other events are ignored.

Sources: [openhands/runtime/base.py:146-152](repo://openhands/runtime/base.py#L146-L152), [openhands/runtime/base.py:320-322](repo://openhands/runtime/base.py#L320-L322)

`_handle_action` gives the action a default timeout from the sandbox config when it has none. It also refreshes the provider tokens if the action refers to one. An `MCPAction` goes to `call_tool_mcp`. Every other action runs through `run_action` in a worker thread.

Sources: [openhands/runtime/base.py:361-372](repo://openhands/runtime/base.py#L361-L372), [openhands/runtime/base.py:361-368](repo://openhands/runtime/base.py#L361-L368)

Failures are handled in three ways. A `PermissionError` becomes an `ErrorObservation` so the agent can see it and go on. A network error or a disconnected runtime sets the runtime status to disconnected and produces no observation. Any other exception sets the runtime status to `ERROR` and produces no observation.

Sources: [openhands/runtime/base.py:372-389](repo://openhands/runtime/base.py#L372-L389)

A successful result gets the cause id of the action and its tool-call metadata. A `NullObservation` is dropped. Anything else is written to the stream with the source of the action.

Sources: [openhands/runtime/base.py:391-399](repo://openhands/runtime/base.py#L391-L399)

## Dispatch by action type

`run_action` handles the actions that do not run in the sandbox first. `AgentThinkAction` returns a fixed observation, and `TaskTrackingAction` reads or writes a `TASKS.md` file in the conversation directory. Any other action that is not runnable returns a `NullObservation`.

Sources: [openhands/runtime/base.py:890-951](repo://openhands/runtime/base.py#L890-L951)

An action waiting for confirmation returns a `NullObservation`, and a rejected one returns a `UserRejectObservation`. An action type not in `ACTION_TYPE_TO_CLASS` gives an `ErrorObservation`, and so does a type the runtime has no method for. Otherwise the method with the action's name runs, such as `run`, `read`, `write`, `edit`, `browse` or `run_ipython`.

Sources: [openhands/runtime/base.py:952-972](repo://openhands/runtime/base.py#L952-L972), [openhands/runtime/base.py:1035-1062](repo://openhands/runtime/base.py#L1035-L1062)

## Sending actions to the server

`ActionExecutionClient.send_action_for_execution` is the step that goes to the server. It sets a default timeout, holds a semaphore so one action runs at a time, and checks the same confirmation and rejection states as `run_action`. It serializes the action and posts it to `/execute_action`. The HTTP timeout is the action's timeout plus five seconds, so the server's own timeout reports first.

Sources: [openhands/runtime/impl/action_execution/action_execution_client.py:272-301](repo://openhands/runtime/impl/action_execution/action_execution_client.py#L272-L301), [openhands/runtime/impl/action_execution/action_execution_client.py:318-326](repo://openhands/runtime/impl/action_execution/action_execution_client.py#L318-L326)

A response becomes an observation through `observation_from_dict`, and the cause id is set on it. An HTTP timeout raises `AgentRuntimeTimeoutError`, which the caller reports as a runtime error.

Sources: [openhands/runtime/impl/action_execution/action_execution_client.py:326-338](repo://openhands/runtime/impl/action_execution/action_execution_client.py#L326-L338)

The request helper retries up to five times with exponential waits, but only when the connection drops with a remote protocol error. `check_if_alive` calls `/alive` with a five-second timeout.

Sources: [openhands/runtime/impl/action_execution/action_execution_client.py:55-58](repo://openhands/runtime/impl/action_execution/action_execution_client.py#L55-L58), [openhands/runtime/impl/action_execution/action_execution_client.py:105-138](repo://openhands/runtime/impl/action_execution/action_execution_client.py#L105-L138)

## The action execution server

Inside the sandbox, `/execute_action` turns the request body back into an action, runs it, and returns the observation as a dictionary. A non-action body is refused with a 400, and an exception returns a 500 with the traceback. The server runs each action under a lock, so the actions it receives run one at a time.

Sources: [openhands/runtime/action_execution_server.py:814-831](repo://openhands/runtime/action_execution_server.py#L814-L831), [openhands/runtime/action_execution_server.py:379-383](repo://openhands/runtime/action_execution_server.py#L379-L383)

`/alive` reports `not initialized` until the server's client has finished starting, and `ok` after that. The Docker runtime calls `check_if_alive` from `wait_until_alive` while it connects, so the first action is not sent before the server answers.

Sources: [openhands/runtime/action_execution_server.py:972-976](repo://openhands/runtime/action_execution_server.py#L972-L976), [openhands/runtime/impl/docker/docker_runtime.py:196-201](repo://openhands/runtime/impl/docker/docker_runtime.py#L196-L201), [openhands/runtime/impl/docker/docker_runtime.py:579-592](repo://openhands/runtime/impl/docker/docker_runtime.py#L579-L592)

The events these calls produce are the ones described in [[Events and the Event Stream]], and the checks on what may run are covered in [[Security and Confirmation]].

Sources: [openhands/runtime/base.py:361-399](repo://openhands/runtime/base.py#L361-L399)
