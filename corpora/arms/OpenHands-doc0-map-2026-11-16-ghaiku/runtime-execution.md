---
title: "Runtime and Action Execution"
---
## Overview

The runtime is the part that touches the workspace. It subscribes to the event stream, takes each `Action`, runs it, and publishes the result as an `Observation` whose `cause` is the action's id. `Runtime` defines the dispatch and the handling. `ActionExecutionClient` is the common base for the concrete runtimes, and it sends each action over HTTP to an action execution server that runs inside the sandbox. [[Runtime Implementations]] lists the concrete classes.

Sources: [openhands/runtime/base.py:90-128](repo://openhands/runtime/base.py#L90-L128) [openhands/runtime/impl/action_execution/action_execution_client.py:61-67](repo://openhands/runtime/impl/action_execution/action_execution_client.py#L61-L67)

## Subscribing to the stream

The runtime subscribes to the stream under the `RUNTIME` subscriber id, with its session id as the callback id. `on_event` ignores everything that is not an `Action`. Each action goes to `_handle_action`, which awaits `call_tool_mcp` for MCP actions and runs `run_action` on a worker thread for the rest. An exception from either becomes an `ErrorObservation`, and the observation's cause is set to the action's id before it is added to the stream.

Sources: [openhands/runtime/base.py:145-152](repo://openhands/runtime/base.py#L145-L152) [openhands/runtime/base.py:320-322](repo://openhands/runtime/base.py#L320-L322) [openhands/runtime/base.py:361-392](repo://openhands/runtime/base.py#L361-L392)

## Dispatch by action type

`Runtime.run_action` decides in three steps. An action that is not runnable returns a fixed observation: a logged thought, a task-tracking result, or a null observation. An action type that this runtime does not implement returns an `ErrorObservation`. An action that the user rejected returns a rejection observation without running. Anything else is passed to the method named after the action's type, so a `CmdRunAction` reaches `run` and a `FileReadAction` reaches `read`.

Sources: [openhands/runtime/base.py:890-912](repo://openhands/runtime/base.py#L890-L912) [openhands/runtime/base.py:958-972](repo://openhands/runtime/base.py#L958-L972)

## Sending actions to the sandbox

`ActionExecutionClient.send_action_for_execution` is the path for the concrete runtimes. An LLM-based file edit is handled separately. A command that has no timeout gets the sandbox timeout as a non-blocking hard timeout, and a blocking command without a timeout is refused. Each call takes the client's semaphore, which is created with a count of one, so only one action is in flight per client.

Sources: [openhands/runtime/impl/action_execution/action_execution_client.py:272-290](repo://openhands/runtime/impl/action_execution/action_execution_client.py#L272-L290) [openhands/runtime/impl/action_execution/action_execution_client.py:83-83](repo://openhands/runtime/impl/action_execution/action_execution_client.py#L83-L83)

The client serialises the action and posts it to `/execute_action`, with an HTTP timeout five seconds longer than the action's own timeout. The response is rebuilt into an observation and stamped with the action's id. A client-side timeout raises `AgentRuntimeTimeoutError`.

Sources: [openhands/runtime/impl/action_execution/action_execution_client.py:303-337](repo://openhands/runtime/impl/action_execution/action_execution_client.py#L303-L337) [openhands/runtime/impl/action_execution/action_execution_client.py:110-130](repo://openhands/runtime/impl/action_execution/action_execution_client.py#L110-L130)

The client's `run`, `read`, `write`, `edit`, `browse` and `browse_interactive` methods each pass their action to `send_action_for_execution`, so the path is the same for every action type.

Sources: [openhands/runtime/impl/action_execution/action_execution_client.py:340-359](repo://openhands/runtime/impl/action_execution/action_execution_client.py#L340-L359)

## The action execution server

The server runs inside the sandbox. Its `/execute_action` route rebuilds the action from the request body, rejects anything that is not an `Action`, and passes it to `run_action`. The response is the observation as a dict. Any other exception becomes an HTTP 500 with the traceback as its detail.

Sources: [openhands/runtime/action_execution_server.py:814-831](repo://openhands/runtime/action_execution_server.py#L814-L831)

`ActionExecutor.run_action` holds a lock for the whole call, then looks up the method named after the action type and awaits it. Like the client, it runs one action at a time.

Sources: [openhands/runtime/action_execution_server.py:379-384](repo://openhands/runtime/action_execution_server.py#L379-L384)
