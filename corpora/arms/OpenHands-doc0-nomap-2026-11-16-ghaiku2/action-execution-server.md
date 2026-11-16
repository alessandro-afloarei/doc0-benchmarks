---
title: "Action Execution Server"
---
## Overview

The action execution server is a FastAPI program that runs inside the sandbox. The Docker, remote and Kubernetes runtimes start it in the container, and the local runtime starts it as a process. It holds the bash session, the Jupyter kernel, the browser and the plugins, and it runs one action at a time for each `POST /execute_action` request. The host sends it actions as JSON and receives observations back, so the sandbox needs no copy of the agent or the event stream. The host side is in [[Runtime Core]], and the concrete runtimes that start the server are in [[Runtime Implementations]].

Sources: [openhands/runtime/action_execution_server.py:166-170](repo://openhands/runtime/action_execution_server.py#L166-L170), [openhands/runtime/action_execution_server.py:814-831](repo://openhands/runtime/action_execution_server.py#L814-L831)

## Startup

The FastAPI lifespan creates one `ActionExecutor` with the requested plugins, working directory and user, and calls its `ainit`. `ainit` starts the bash session first, because other setup needs it. It then starts the browser in the background, loads every plugin with a timeout taken from `INIT_PLUGIN_TIMEOUT` (120 seconds by default), and runs the agent-skills import in IPython when both the agent-skills and Jupyter plugins are present.

Sources: [openhands/runtime/action_execution_server.py:698-716](repo://openhands/runtime/action_execution_server.py#L698-L716), [openhands/runtime/action_execution_server.py:291-326](repo://openhands/runtime/action_execution_server.py#L291-L326)

The executor marks itself initialised only after all of that, and `/alive` reports `not initialized` until then. The Docker runtime's `wait_until_alive` waits on the server before it is used, so a container that is still starting is not sent any action.

Sources: [openhands/runtime/action_execution_server.py:972-980](repo://openhands/runtime/action_execution_server.py#L972-L980), [openhands/runtime/impl/docker/docker_runtime.py:579-592](repo://openhands/runtime/impl/docker/docker_runtime.py#L579-L592)

## Endpoints

| Method and path | Purpose |
| --- | --- |
| `GET /server_info` | Reports uptime, idle time and system resource figures |
| `POST /execute_action` | Runs one action, given as an event dictionary, and returns the observation |
| `POST /update_mcp_server` | Updates the MCP servers the sandbox uses |
| `POST /upload_file` | Writes an uploaded file into the workspace |
| `GET /download_files` | Returns files from the sandbox by path |
| `POST /list_files` | Lists files in a folder |
| `GET /alive` | Reports whether the executor has finished starting |
| `GET /vscode/connection_token` | Returns the token for the VS Code view |

Sources: [openhands/runtime/action_execution_server.py:799-880](repo://openhands/runtime/action_execution_server.py#L799-L880), [openhands/runtime/action_execution_server.py:942-1000](repo://openhands/runtime/action_execution_server.py#L942-L1000)

`/execute_action` parses the body with `event_from_dict` and rejects anything that is not an `Action` with a 400. It records the time of the last execution, passes the action to `run_action`, and returns `event_to_dict` of the observation. Any other exception becomes a 500 with the traceback as its detail. The `finally` block updates the idle timer, which is how the server knows it is still in use.

Sources: [openhands/runtime/action_execution_server.py:814-831](repo://openhands/runtime/action_execution_server.py#L814-L831)

Every request except `/alive` and `/server_info` must carry the session API key in the `X-Session-API-Key` header. A missing or wrong key is answered with 401 before the route runs.

Sources: [openhands/runtime/action_execution_server.py:788-798](repo://openhands/runtime/action_execution_server.py#L788-L798)

## Running an action

`run_action` takes a lock, so actions never run at the same time inside one sandbox. It then calls the method named after the action's `action` field: `run` for `CmdRunAction`, `run_ipython`, `read`, `write`, `edit`, `browse` and `browse_interactive`. Each returns an observation. The `run` method, for one, turns an exception into an `ErrorObservation` rather than raising it.

Sources: [openhands/runtime/action_execution_server.py:379-384](repo://openhands/runtime/action_execution_server.py#L379-L384), [openhands/runtime/action_execution_server.py:385-398](repo://openhands/runtime/action_execution_server.py#L385-L398), [openhands/runtime/action_execution_server.py:442-445](repo://openhands/runtime/action_execution_server.py#L442-L445), [openhands/runtime/action_execution_server.py:591-605](repo://openhands/runtime/action_execution_server.py#L591-L605)

Shell commands go through a `BashSession`, which runs commands in one persistent shell and polls its output on an interval, so a long command keeps its state between calls. Static commands get a fresh session in the requested directory instead.

Sources: [openhands/runtime/utils/bash.py:175-180](repo://openhands/runtime/utils/bash.py#L175-L180), [openhands/runtime/action_execution_server.py:385-398](repo://openhands/runtime/action_execution_server.py#L385-L398)

File paths in actions are resolved against the working directory, so a relative path always lands in the workspace the agent was given.

Sources: [openhands/runtime/action_execution_server.py:436-441](repo://openhands/runtime/action_execution_server.py#L436-L441)

## Plugins

A plugin is a `PluginRequirement` that the agent declares and the server initialises at startup. The three built in are VS Code, Jupyter and agent skills. The agent-skills plugin provides Python helper functions that the IPython kernel imports at startup, so it has to load before the Jupyter one can use them. The order is set in the agent's list of sandbox plugins.

Sources: [openhands/runtime/plugins/requirement.py:28-31](repo://openhands/runtime/plugins/requirement.py#L28-L31), [openhands/runtime/plugins/vscode/__init__.py:20-30](repo://openhands/runtime/plugins/vscode/__init__.py#L20-L30), [openhands/runtime/plugins/jupyter/__init__.py:18-28](repo://openhands/runtime/plugins/jupyter/__init__.py#L18-L28), [openhands/runtime/plugins/agent_skills/__init__.py:10-20](repo://openhands/runtime/plugins/agent_skills/__init__.py#L10-L20), [openhands/agenthub/codeact_agent/codeact_agent.py:70-74](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L70-L74)
