---
type: architecture
title: Runtime Abstraction and Execution Backends
description: How the Runtime base class turns events into sandboxed execution, how backends (Docker, local, remote, Kubernetes, CLI) provide the sandbox, and how the action execution server inside the sandbox runs commands, file operations, browser actions, and MCP tools.
tags: [runtime, sandbox, docker, action-execution-server, mcp, backends, workspace]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T11:08:31.416Z
sources:
  - id: openwiki-source-9941cabbb453d6800d37b944
    resource: repo://openhands/runtime/__init__.py
  - id: openwiki-source-fd6d296a69771bcf356e0886
    resource: repo://openhands/runtime/action_execution_server.py
  - id: openwiki-source-f38350b0cd074145e71451f8
    resource: repo://openhands/runtime/base.py
  - id: openwiki-source-8aa44ffeca89d68fc256f906
    resource: repo://openhands/runtime/impl/action_execution/action_execution_client.py
  - id: openwiki-source-a93fe2478f100d6d83bde21d
    resource: repo://openhands/runtime/impl/docker/docker_runtime.py
  - id: openwiki-source-875ead9d81cce04a8ddd308b
    resource: repo://openhands/runtime/impl/remote/remote_runtime.py
generated: { by: "claude-code", at: "2026-11-16T11:08:31.416Z" }
---

# Runtime Abstraction and Execution Backends

The agent never runs code itself. Every concrete effect (a shell command, a file edit, a browser
step, an MCP tool call) is an `Action` that a **runtime** executes and answers with an
`Observation`. The runtime is the boundary between the agent's decisions and the machine they
affect. It also owns the workspace, the git state, microagent loading, and the sandbox lifecycle.

The abstract class is `Runtime` in `openhands/runtime/base.py` (line 90). Concrete backends are in
`openhands/runtime/impl/`.

## Backend selection

`openhands/runtime/__init__.py` defines the built-in backends (`_DEFAULT_RUNTIME_CLASSES`,
lines 14-21):

| Name | Class | Where the sandbox runs |
| --- | --- | --- |
| `docker` (alias `eventstream`) | `DockerRuntime` | A Docker container on the host. This is the default (`openhands_config.py:71`). |
| `local` | `LocalRuntime` | The action execution server runs as a process on the host, without isolation. |
| `remote` | `RemoteRuntime` | A sandbox started through a remote API. |
| `kubernetes` | `KubernetesRuntime` | A pod in a Kubernetes cluster, with a service for the action server. |
| `cli` | `CLIRuntime` | Commands run through subprocess and Python file operations, without the action server. |

Third-party backends found under `third_party/runtime/impl/` are discovered at import time
(`__init__.py:20-86`). `get_runtime_cls(name)` (`__init__.py:90-102`) resolves a name to its class
and raises with the list of known names when the name is not recognized.

## The `Runtime` base class

The base class handles everything that does not depend on where the sandbox runs:

- **Event handling.** `on_event` (`base.py:320-323`) passes each `Action` to `_handle_action`
  (`base.py:361-400`). That method sets a default hard timeout from `sandbox.timeout` when the
  action has none, routes `MCPAction` to `call_tool_mcp` and everything else to `run_action` in a
  worker thread, and attaches the causing event ID and tool-call metadata to the observation.
  Observations are published to the event stream, except `NullObservation`s, which are dropped.
- **Error mapping.** A `PermissionError` becomes an `ErrorObservation`, so the agent can see the
  problem and recover. A network or disconnect failure sets the runtime status to
  `ERROR_RUNTIME_DISCONNECTED` and produces no observation. Any other exception sets `ERROR`
  (`base.py:372-393`). The controller decides what to do with the status.
- **Non-runnable actions.** `run_action` (`base.py:890`) answers actions that do not need the
  sandbox locally. `AgentThinkAction` returns an acknowledgement. `TaskTrackingAction` writes the
  task list to `TASKS.md` in the conversation directory.
- **Workspace and repository setup.** `clone_or_init_repo` (`base.py:401`) clones the selected
  repository and branch, or initializes an empty git repository when configured to. Setup scripts,
  git hooks, and git identity are applied (`maybe_run_setup_script`, `maybe_setup_git_hooks`,
  `_setup_git_config`).
- **Microagents.** The runtime loads microagents from the selected repository and from the
  organization or user's `.openhands` repository (`base.py:586-890`; see
  [Agents, Tools, and Microagents](agents-and-tools.md)).
- **Provider tokens.** Before a command runs, `_export_latest_git_provider_tokens` refreshes git
  provider tokens if the command references them (`base.py:324`).
- **Session key.** `session_api_key` (`base.py:1092`) is passed to the action server, which checks
  the `X-Session-API-Key` header on every request except `/alive` and `/server_info`
  (`action_execution_server.py:787-796`).

Backends implement the concrete methods `run`, `run_ipython`, `read`, `write`, `edit`, `browse`,
`browse_interactive`, `copy_to`, `copy_from`, and `list_files` (`base.py:1035-1090`). For the
action-execution backends these are forwarded over HTTP.

## Action execution backends

`ActionExecutionClient` (`openhands/runtime/impl/action_execution/action_execution_client.py`) is the
base for `DockerRuntime`, `LocalRuntime`, `RemoteRuntime`, and `KubernetesRuntime`. It:

- sets a default timeout on commands that have none, and refuses blocking commands without one
  (`client.py:272-285`);
- serializes the action with `event_to_dict` and POSTs it to the server's `/execute_action` endpoint
  with the session key (`client.py:321`);
- deserializes the returned observation with `event_from_dict`.

Each action-execution backend differs in how it starts the server and where it runs:

- `DockerRuntime` (`impl/docker/docker_runtime.py`) builds or pulls the runtime image, starts a
  container, and maps the server port to a free host port. It reserves ports with lock files so
  concurrent conversations do not collide (`docker_runtime.py:614-690`). Image building lives in
  `openhands/runtime/builder/`.
- `LocalRuntime` (`impl/local/local_runtime.py`) starts the action server as a local process and
  checks host dependencies before starting (`local_runtime.py:81-217`).
- `RemoteRuntime` (`impl/remote/remote_runtime.py`) asks a remote service to start the sandbox. Its
  `remote_runtime_class` setting accepts only `sysbox` or `gvisor` (`remote_runtime.py:97`), which
  select the isolation runtime.
- `KubernetesRuntime` (`impl/kubernetes/kubernetes_runtime.py`) creates a pod and a service, and
  derives service names from the pod name (`kubernetes_runtime.py:154-159`).

## The action execution server

`openhands/runtime/action_execution_server.py` is the program that runs inside the sandbox. It is a
FastAPI application with these endpoints (`action_execution_server.py:799-995`):

- `POST /execute_action`: deserializes an `Action`, runs it, and returns the serialized
  observation (`action_execution_server.py:814-831`);
- `POST /update_mcp_server`: updates the MCP server configuration;
- `POST /upload_file`, `GET /download_files`, `POST /list_files`: file transfer;
- `GET /server_info`, `GET /alive`, `GET /vscode/connection_token`: health and integration info.

Inside the server, `ActionExecutor` holds the shell session, the IPython kernel, and the browser.
`run_action` (`action_execution_server.py:379-383`) takes a lock and dispatches to a method named
after the action's `action` field (`run`, `run_ipython`, `read`, `write`, `edit`, `browse`,
`browse_interactive`). Commands run in a tmux-backed `BashSession`
(`openhands/runtime/utils/bash.py`), so a working directory and environment variables persist
across commands. File edits are delegated to `openhands/runtime/utils/edit.py`.

Plugins are initialized by the executor: agent skills, Jupyter, and VS Code, as configured
(`openhands/runtime/plugins/`).

## MCP tool calls

`MCPAction` bypasses `run_action`. `_handle_action` sends it to `call_tool_mcp`
(`base.py:1063`), which forwards the call to the MCP server that provides the tool. On Windows MCP
is disabled and returns an `ErrorObservation` (`action_execution_client.py:452-460`). The MCP
configuration comes from `mcp_config.py`. See [Model Context Protocol Integration](../integrations/mcp.md).

## Lifecycle

- `connect()` starts or attaches to the sandbox for the backend.
- `set_runtime_status` (`base.py:235`) records a status and level, and reports it through the status
  callback when one is set.
- `close()` (`base.py:221`) shuts the sandbox down. For Docker, the stop is skipped when
  `keep_runtime_alive` is set or the runtime attaches to an existing container
  (`docker_runtime.py:606`).

## Security and failure semantics

- The local backend runs commands directly on the host with the user's privileges. Use it only for
  trusted repositories. See [Security Model and Sandboxing](../operations/security.md).
- Docker, Kubernetes, and remote sandboxes isolate the workspace from the host. The session key
  protects the action server endpoints, but a sandbox that is reachable from the network should
  also be protected at the network layer.
- A runtime that disconnects is reported as an error; the controller does not retry the action
  automatically.
- Every action receives a timeout: an explicit one, or the default from `sandbox.timeout`
  (`base.py:361-366`, `action_execution_client.py:272-285`).

## Extension seams

- New backend: subclass `ActionExecutionClient` (for a server-based sandbox) or `Runtime` (for a
  custom execution model), implement the startup and shutdown hooks, and register it in
  `_DEFAULT_RUNTIME_CLASSES` or as a third-party runtime.
- New action type: add an `Action` and `Observation` pair, then a handler method on
  `ActionExecutor` with the same name as the action's `action` field.
- New plugin: add a `Plugin` under `openhands/runtime/plugins/` and initialize it in the executor.

## Tests

`tests/runtime/` holds runtime integration tests, such as `test_bash.py`, `test_aci_edit.py`, and
`test_git_hooks.py`. `tests/unit/runtime/` holds unit tests for the builder, backend implementations,
and plugins.

## Related pages

- [Agent Controller and Step Loop](agent-controller.md)
- [Event Model and Event Stream](event-stream.md)
- [Model Context Protocol Integration](../integrations/mcp.md)
- [Security Model and Sandboxing](../operations/security.md)
