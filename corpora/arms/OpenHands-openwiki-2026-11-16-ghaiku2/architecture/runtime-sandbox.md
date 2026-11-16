---
type: architecture-component
title: Runtime and Sandbox Execution
description: The Runtime abstraction that subscribes to the event stream and executes agent actions; the action execution server and client protocol; the docker, local, remote, kubernetes, and CLI runtime implementations; runtime selection; timeouts, one-action-at-a-time execution, confirmation and rejection handling; and the plugins that a runtime installs.
tags: [runtime, sandbox, docker, action-execution-server, execution, timeouts, plugins, mcp, runtime-selection]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:30:54.023Z
sources:
  - id: openwiki-source-61b5d6e6c4155cc8921df93e
    resource: repo://openhands/core/setup.py
  - id: openwiki-source-9941cabbb453d6800d37b944
    resource: repo://openhands/runtime/__init__.py
  - id: openwiki-source-fd6d296a69771bcf356e0886
    resource: repo://openhands/runtime/action_execution_server.py
  - id: openwiki-source-f38350b0cd074145e71451f8
    resource: repo://openhands/runtime/base.py
  - id: openwiki-source-8aa44ffeca89d68fc256f906
    resource: repo://openhands/runtime/impl/action_execution/action_execution_client.py
  - id: openwiki-source-5fd9c2da50df7a7af7278df9
    resource: repo://openhands/runtime/impl/cli/cli_runtime.py
  - id: openwiki-source-a93fe2478f100d6d83bde21d
    resource: repo://openhands/runtime/impl/docker/docker_runtime.py
generated: { by: "claude-code", at: "2026-11-16T18:30:54.023Z" }
---

# Runtime and Sandbox Execution

<!-- openwiki: broken internal link [/openwiki/architecture/event-stream.md] link "/openwiki/architecture/event-stream.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
The runtime is where agent actions do work. It subscribes to the [event stream](/openwiki/architecture/event-stream.md), receives `Action` events (run a shell command, run IPython, read or edit a file, browse, call an MCP tool), executes them in an environment, and publishes the matching `Observation` with the action's ID as its cause. The agent never touches the environment directly.

## Runtime base class

`Runtime` (`openhands/runtime/base.py`, class at ~L90) is the abstract base. Its constructor (~L128) takes the config, the event stream, the session ID, the plugin requirements (`plugins`, taken from the agent class's `sandbox_plugins`), headless mode, the LLM registry, and the git-provider tokens. It registers itself as a subscriber of the event stream. The `RUNTIME` subscriber receives each event through `on_event` (~L320), and `_handle_action` (~L361) runs the action.

`_handle_action` does four things:

1. Gives an action without a timeout the sandbox default (`config.sandbox.timeout`, 120 seconds by default) as a non-blocking hard timeout (~L362-L364).
<!-- openwiki: broken internal link [/openwiki/architecture/integrations-and-mcp.md] link "/openwiki/architecture/integrations-and-mcp.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
2. Exports the latest git-provider tokens into the environment when the action needs them (`_export_latest_git_provider_tokens`, ~L324). See [Git Provider Integrations and MCP](/openwiki/architecture/integrations-and-mcp.md).
3. Dispatches to `call_tool_mcp` for `MCPAction`, and to `run_action` (in a thread) for all other actions (~L368-L372).
4. Publishes the observation. A `PermissionError` becomes an `ErrorObservation` so the agent can recover. A network failure or any other exception sets a runtime status (`ERROR_RUNTIME_DISCONNECTED` or `ERROR`) and publishes nothing, so the controller sees the runtime status rather than a fabricated observation. A `NullObservation` is never added to the stream (~L393-L400).

`run_action` (~L890) maps each action type to a method on the runtime. The typed methods are `run` (shell), `run_ipython`, `read`, `write`, `edit`, `browse`, `browse_interactive`, and `call_tool_mcp`. These are declared as abstract methods (~L1035-L1063) that each concrete runtime implements.

Beyond action execution the base class also handles repository cloning and initialization (`clone_or_init_repo`, ~L401), workspace setup scripts (`maybe_run_setup_script`, ~L463), git hooks (`maybe_setup_git_hooks`, ~L495), discovery of microagents from the selected repository and from organization repositories (~L666-L890), and the MCP configuration for the sandbox (`get_mcp_config`, ~L1025).

## Action execution server and client

Most runtimes run a small FastAPI server inside the sandbox and talk to it over HTTP. The protocol is implemented by two classes.

- **Server**: `openhands/runtime/action_execution_server.py` defines the endpoints `/server_info`, `/execute_action` (~L814), `/update_mcp_server`, `/upload_file`, `/download_files`, `/alive`, `/vscode/connection_token`, and `/list_files`. `/execute_action` deserializes the action with `event_from_dict`, runs it on the in-sandbox client, and returns the observation as a dictionary. Errors return HTTP 500 with the traceback.
- **Client**: `ActionExecutionClient` (`openhands/runtime/impl/action_execution/action_execution_client.py`, class at ~L61) is the host-side base class for Docker, local, and remote runtimes. Its `send_action_for_execution` (~L272) is the central path:
  - a `FileEditAction` whose implementation source is LLM-based is edited on the host instead (~L273-L278);
  - a blocking shell command without a timeout raises a `RuntimeError`, and a non-blocking one gets the sandbox default (~L282-L287);
  - the call is guarded by `action_semaphore`, a single-permit semaphore, so only one action runs at a time (~L83, ~L286);
  - a non-runnable action returns `NullObservation`; an `AgentThinkAction` returns a fixed acknowledgement;
  - an action still `AWAITING_CONFIRMATION` returns `NullObservation`, so it is not run until the user confirms; one that was `REJECTED` returns a `UserRejectObservation` (~L300-L310);
  - otherwise the action is POSTed to `/execute_action` with a client-side timeout of the action's timeout plus five seconds (~L320-L333). A timeout raises `AgentRuntimeTimeoutError`.

The single-permit semaphore and the one-action-at-a-time rule are why the controller's pending-action gating and this semaphore agree: the sandbox never runs two commands concurrently.

## Runtime implementations

Runtime classes are selected by `config.runtime` through `get_runtime_cls` (`openhands/runtime/__init__.py`, ~L90). The default registry (~L14-L21) maps:

| `runtime` value | Class | How it runs |
| --- | --- | --- |
| `docker` or `eventstream` (default `docker`) | `DockerRuntime` (`impl/docker/docker_runtime.py`) | Starts or attaches to a Docker container that runs the action execution server, on a locked host port |
| `local` | `LocalRuntime` (`impl/local/local_runtime.py`) | Runs the action execution server as a host process |
| `remote` | `RemoteRuntime` (`impl/remote/remote_runtime.py`) | Asks a remote runtime API to build and start a sandbox, then talks to it over HTTP |
| `kubernetes` | `KubernetesRuntime` (`impl/kubernetes/kubernetes_runtime.py`) | Runs the server in a Kubernetes pod |
| `cli` | `CLIRuntime` (`impl/cli/cli_runtime.py`) | Runs commands directly on the host through subprocess, with no separate action server |

Third-party runtimes (for example E2B, Daytona, Modal, or Runloop) are discovered at import time by module name and a class name pattern (`__init__.py` ~L24-L87) and merged into the registry.

### DockerRuntime

`DockerRuntime` extends `ActionExecutionClient` (class at ~L75). In `connect` (~L170) it builds the runtime image if needed (`maybe_build_runtime_container_image`, ~L233), creates the container (`init_container`, ~L391) or attaches to an existing one (`_attach_to_container`, ~L543), and waits for the server to answer (`wait_until_alive`, ~L579). Mounts come from `sandbox.volumes` through `_process_volumes` (~L261) and overlay mounts (~L324). Ports are reserved with file-based locks (`_find_available_port_with_lock`, ~L643). `pause` (~L716) stops the container and `resume` (~L730) starts it again. `close` (~L593) keeps the container when `sandbox.keep_runtime_alive` is set or the runtime attached to an existing one; otherwise it stops containers with the sandbox name prefix, and `rm_all_containers` widens that to every container with the prefix.

### LocalRuntime

`LocalRuntime` extends `ActionExecutionClient` and runs the action execution server as a host process it manages. Its `connect` (~L217) starts the process, records its address in `ActionExecutionServerInfo` (~L49), and polls for readiness. It offers no container isolation; it is intended for development and for environments that already provide isolation.

### RemoteRuntime

`RemoteRuntime` extends `ActionExecutionClient` and delegates provisioning. It attaches to an existing runtime for the conversation if one exists (`_check_existing_runtime`, ~L173), otherwise builds (`_build_runtime`, ~L224) and starts (`_start_runtime`, ~L270) one through the remote API. Retries on recoverable connection errors are controlled by `sandbox.remote_runtime_enable_retries`.

### CLIRuntime

`CLIRuntime` extends `Runtime` directly rather than the client. Its `run` (~L432) and `run_ipython` (~L478) execute on the host, with PowerShell and shell variants (`_execute_powershell_command`, ~L291; `_execute_shell_command`, ~L325). It is selected with `runtime = "cli"` and is the only runtime for which MCP tools are fetched over stdio (`add_mcp_tools_to_agent` checks `isinstance(runtime, CLIRuntime)`).

## Runtime selection

`create_runtime` (`openhands/core/setup.py` ~L35-L90) creates the `EventStream` for the session, resolves the runtime class from `config.runtime`, and constructs it with the agent's `sandbox_plugins`. Headless entry points (`run_controller`, the evaluation harness, and the resolver) call it directly. The web server creates runtimes through its session classes. A separate `DockerNestedConversationManager` (`openhands/server/conversation_manager/docker_nested_conversation_manager.py`) also builds `DockerRuntime` instances for Docker-based deployments.

## Plugins

`PluginRequirement` objects (`openhands/runtime/plugins/requirement.py`) describe components that must exist inside the sandbox. The built-in plugins are `agent_skills`, `jupyter`, and `vscode`. The runtime installs the VS Code plugin when it is not in headless mode (`base.py` ~L152-L160). The `sandbox_plugins` list on an agent class is how an agent requests the plugins it needs.

## Invariants and failure behavior

- One action executes at a time in an `ActionExecutionClient`.
- Each observation carries the `cause` of the action that produced it, and a `NullObservation` is not published.
- A confirmation-pending action does not run; a rejected one returns a `UserRejectObservation`.
- Command timeouts are enforced twice: the sandbox's hard timeout on the action, and a client-side HTTP timeout slightly longer than that.
- A disconnected runtime sets `ERROR_RUNTIME_DISCONNECTED` and stops publishing, so the controller must recover the runtime rather than silently continuing.
- Provider tokens are exported just before actions that need them, not at startup only.

## Extension seams

- A new runtime is a subclass of `ActionExecutionClient` (for a remote API that speaks the same protocol) or of `Runtime` (for a different execution model). Register it under a `runtime` name or as a third-party module.
- A new sandbox capability is a `PluginRequirement` and the agent's `sandbox_plugins`.
- A new action type needs a method on `Runtime` and a case in `run_action`, plus a server-side handler.

## Representative tests

- `tests/unit/runtime/impl/test_docker_runtime.py` and `test_local_runtime.py` cover the implementations.
- `tests/unit/runtime/utils/test_bash_session.py` and `test_bash_parsing.py` cover bash-session handling.
- `tests/unit/runtime/test_runtime_git_tokens.py` covers token export.
- `tests/unit/runtime/test_setup.py` covers runtime setup.
- `tests/runtime/` contains integration tests that exercise the runtime end to end against real sandboxes (`test_bash.py`, `test_aci_edit.py`, and others).

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/event-stream.md] link "/openwiki/architecture/event-stream.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Event Stream, Actions, and Observations](/openwiki/architecture/event-stream.md)
<!-- openwiki: broken internal link [/openwiki/architecture/agent-controller.md] link "/openwiki/architecture/agent-controller.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Agent Controller and Step Loop](/openwiki/architecture/agent-controller.md)
<!-- openwiki: broken internal link [/openwiki/architecture/configuration.md] link "/openwiki/architecture/configuration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Configuration Model](/openwiki/architecture/configuration.md)
<!-- openwiki: broken internal link [/openwiki/architecture/security-analysis.md] link "/openwiki/architecture/security-analysis.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Security Analysis and Action Gating](/openwiki/architecture/security-analysis.md)
<!-- openwiki: broken internal link [/openwiki/operations/deployment-and-docker.md] link "/openwiki/operations/deployment-and-docker.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Deployment, Containers, and Build](/openwiki/operations/deployment-and-docker.md)
