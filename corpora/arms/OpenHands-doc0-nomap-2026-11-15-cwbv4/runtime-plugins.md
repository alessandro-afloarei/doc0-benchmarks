---
title: "Runtime Plugins"
---
## Overview

Plugins are long-running services inside the sandbox that some agents need and others do not: a Jupyter kernel for Python cells, a VS Code server for the user, and a library of Python helpers for the agent. An agent declares the plugins it needs as `PluginRequirement`s; the runtime passes their names to the [[Action Execution Server]], which starts the matching `Plugin` objects when it boots. Only then do actions that depend on them, such as `IPythonRunCellAction`, work.

Sources: [openhands/runtime/plugins/requirement.py:8-31](repo://openhands/runtime/plugins/requirement.py#L8-L31), [openhands/runtime/plugins/__init__.py:21-25](repo://openhands/runtime/plugins/__init__.py#L21-L25)

## Interfaces and wiring

### Requirement and plugin

A `PluginRequirement` is a dataclass holding only a `name`; it lives on the host side, in the agent class's `sandbox_plugins`. A `Plugin` is the sandbox-side object with an async `initialize(username)` and an async `run(action)`. `ALL_PLUGINS` maps the three names, `jupyter`, `agent_skills` and `vscode`, to their plugin classes.

Sources: [openhands/runtime/plugins/requirement.py:8-31](repo://openhands/runtime/plugins/requirement.py#L8-L31), [openhands/runtime/plugins/__init__.py:1-25](repo://openhands/runtime/plugins/__init__.py#L1-L25)

### From agent to sandbox

1. The agent class lists requirements; the [[CodeAct Agent]] asks for `AgentSkillsRequirement` and `JupyterRequirement`, in that order.
2. `create_runtime` passes `agent_cls.sandbox_plugins` to the runtime, which adds `VSCodeRequirement` unless it runs headless.
3. The startup command passes the names as `--plugins agent_skills jupyter vscode`.
4. The action server instantiates each name from `ALL_PLUGINS` and initialises them all in parallel within `INIT_PLUGIN_TIMEOUT`.

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:71-76](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L71-L76), [openhands/core/setup.py:65-82](repo://openhands/core/setup.py#L65-L82), [openhands/runtime/base.py:152-157](repo://openhands/runtime/base.py#L152-L157), [openhands/runtime/utils/command.py:31-34](repo://openhands/runtime/utils/command.py#L31-L34), [openhands/runtime/action_execution_server.py:686-692](repo://openhands/runtime/action_execution_server.py#L686-L692), [openhands/runtime/action_execution_server.py:291-323](repo://openhands/runtime/action_execution_server.py#L291-L323)

## Jupyter

### Starting the kernel gateway

`JupyterPlugin.initialize` picks a free port between 40000 and 49999 and starts `jupyter kernelgateway` on it. In a container it runs as the sandbox user, from `/openhands/code` inside the micromamba `openhands` environment; under the local runtime (`LOCAL_RUNTIME_MODE=1`) it runs from `OPENHANDS_REPO_PATH`, which must be set; on Windows it uses a plain subprocess. It reads the gateway's output until it reports it is listening, then runs `import sys; print(sys.executable)` to record the kernel's Python interpreter path.

Sources: [openhands/runtime/plugins/jupyter/__init__.py:17-60](repo://openhands/runtime/plugins/jupyter/__init__.py#L17-L60), [openhands/runtime/plugins/jupyter/__init__.py:103-140](repo://openhands/runtime/plugins/jupyter/__init__.py#L103-L140)

### Running a cell

`run` accepts only `IPythonRunCellAction`. It lazily connects a `JupyterKernel` client to the gateway, sends an `execute_request` over the kernel's websocket, and collects the messages answering it until `execute_reply`: stream text, results and display data as text, PNG images as `data:image/png;base64` URLs, and error tracebacks. A heartbeat every ten seconds detects a dead kernel connection.

Sources: [openhands/runtime/plugins/jupyter/__init__.py:142-172](repo://openhands/runtime/plugins/jupyter/__init__.py#L142-L172), [openhands/runtime/plugins/jupyter/execute_server.py:53-140](repo://openhands/runtime/plugins/jupyter/execute_server.py#L53-L140), [openhands/runtime/plugins/jupyter/execute_server.py:142-219](repo://openhands/runtime/plugins/jupyter/execute_server.py#L142-L219)

If the action's timeout passes first, the kernel is interrupted through the gateway's REST API and the result is `[Execution timed out (N seconds).]`. A cell with no output reports `[Code executed successfully with no output]`, and ANSI colour codes are stripped from the text. The text and images become an `IPythonRunCellObservation`.

Sources: [openhands/runtime/plugins/jupyter/execute_server.py:221-257](repo://openhands/runtime/plugins/jupyter/execute_server.py#L221-L257)

### Keeping Python and bash in step

Before each cell, the action server moves the kernel to the bash session's current directory if it changed, so `cd` in the shell affects relative paths in Python too. After the cell it appends `[Jupyter current working directory: ...]` and `[Jupyter Python interpreter: ...]` lines; [[Stuck Detection]] relies on those trailer lines to recognise repeated syntax errors.

Sources: [openhands/runtime/action_execution_server.py:399-434](repo://openhands/runtime/action_execution_server.py#L399-L434), [openhands/controller/stuck.py:241-248](repo://openhands/controller/stuck.py#L241-L248)

## Agent skills

`agent_skills` is not a service: `AgentSkillsPlugin.initialize` does nothing and `run` is not supported. Its value is the `agentskills` module, which the action server imports into the Jupyter kernel with `from openhands.runtime.plugins.agent_skills.agentskills import *` once both plugins are up, which is why agent skills must be listed before Jupyter.

Sources: [openhands/runtime/plugins/agent_skills/__init__.py:1-24](repo://openhands/runtime/plugins/agent_skills/__init__.py#L1-L24), [openhands/runtime/action_execution_server.py:308-318](repo://openhands/runtime/action_execution_server.py#L308-L318)

The module gathers helper functions from three groups and builds a `DOCUMENTATION` string from their signatures and docstrings, exposed on the requirement:

Sources: [openhands/runtime/plugins/agent_skills/agentskills.py:28-39](repo://openhands/runtime/plugins/agent_skills/agentskills.py#L28-L39)

| Group | Functions |
| --- | --- |
| `file_ops` | `open_file`, `goto_line`, `scroll_down`, `scroll_up`, `search_dir`, `search_file`, `find_file` |
| `file_reader` | `parse_pdf`, `parse_docx`, `parse_latex`, `parse_pptx`, `parse_audio`, `parse_image`, `parse_video` |
| `repo_ops` | repository helpers, when the optional module imports |
| editor | `file_editor` |

Sources: [openhands/runtime/plugins/agent_skills/agentskills.py:1-45](repo://openhands/runtime/plugins/agent_skills/agentskills.py#L1-L45), [openhands/runtime/plugins/agent_skills/file_ops/file_ops.py:183-297](repo://openhands/runtime/plugins/agent_skills/file_ops/file_ops.py#L183-L297), [openhands/runtime/plugins/agent_skills/file_ops/file_ops.py:337-403](repo://openhands/runtime/plugins/agent_skills/file_ops/file_ops.py#L337-L403), [openhands/runtime/plugins/agent_skills/file_reader/file_readers.py:38-142](repo://openhands/runtime/plugins/agent_skills/file_reader/file_readers.py#L38-L142), [openhands/runtime/plugins/agent_skills/file_reader/file_readers.py:142-245](repo://openhands/runtime/plugins/agent_skills/file_reader/file_readers.py#L142-L245)

The skill set's stated rule is to add a helper only when the model could not easily write the code itself (for example, line-precise file viewing) or when it needs an external model, such as speech-to-text for audio or a vision model for images and video.

Sources: [openhands/runtime/plugins/agent_skills/README.md:14-21](repo://openhands/runtime/plugins/agent_skills/README.md#L14-L21)

## VS Code

`VSCodePlugin` starts an OpenVSCode server so the user can open the agent's workspace in a browser IDE. It is skipped on Windows, for users other than `root` and `openhands`, when `VSCODE_PORT` is missing, or when that port is taken. Otherwise it copies a default `settings.json` into the workspace's `.vscode` folder, generates a random connection token, and runs `openvscode-server` as the sandbox user in the workspace with that token and `--disable-workspace-trust`. Behind a path-based router (the remote runtime's `<url>/<runtime_id>` form or `OPENVSCODE_SERVER_BASE_PATH`) it adds a server base path.

Sources: [openhands/runtime/plugins/vscode/__init__.py:19-137](repo://openhands/runtime/plugins/vscode/__init__.py#L19-L137)

The token is served from the action server's `/vscode/connection_token`, and each runtime builds the user-facing `vscode_url` from it. VS Code on the user's own machine is a different feature, covered on [[VS Code Integration]].

Sources: [openhands/runtime/action_execution_server.py:982-993](repo://openhands/runtime/action_execution_server.py#L982-L993), [openhands/runtime/impl/docker/docker_runtime.py:697-704](repo://openhands/runtime/impl/docker/docker_runtime.py#L697-L704)

## Adding a plugin

A new plugin needs a `PluginRequirement` subclass with a default `name`, a `Plugin` subclass that starts its service in `initialize` and implements `run` if actions should reach it, and an entry in `ALL_PLUGINS`; the server refuses plugin names it does not know. The service must also be installable in the runtime image (see [[Runtime Images]]).

Sources: [openhands/runtime/plugins/__init__.py:21-25](repo://openhands/runtime/plugins/__init__.py#L21-L25), [openhands/runtime/action_execution_server.py:686-692](repo://openhands/runtime/action_execution_server.py#L686-L692)
