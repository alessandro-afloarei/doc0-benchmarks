---
type: operations
title: Runtime execution and sandbox operations
description: Runtime selection, action execution transport, Docker and local lifecycle, sandbox workspace boundaries, and operational failure diagnosis.
tags: [runtime, sandbox, docker, execution, operations]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:50:03.393Z
sources:
  - id: openwiki-source-9941cabbb453d6800d37b944
    resource: repo://openhands/runtime/__init__.py
  - id: openwiki-source-f38350b0cd074145e71451f8
    resource: repo://openhands/runtime/base.py
  - id: openwiki-source-8aa44ffeca89d68fc256f906
    resource: repo://openhands/runtime/impl/action_execution/action_execution_client.py
  - id: openwiki-source-a93fe2478f100d6d83bde21d
    resource: repo://openhands/runtime/impl/docker/docker_runtime.py
  - id: openwiki-source-291db9c7df21d01a746bddad
    resource: repo://openhands/runtime/impl/local/local_runtime.py
generated: { by: "codex", at: "2026-11-16T06:50:03.393Z" }
---

# Runtime execution and sandbox operations

A runtime owns execution and workspace access, not model decisions. Runtime construction subscribes to the conversation stream, copies configuration, prepares provider environment values, and selects any security analyzer. Agents declare plugin requirements; non-headless construction adds VS Code support.

## Selecting a backend

`get_runtime_cls` resolves built-in names and can resolve a fully qualified Runtime subclass. Optional implementations under `third_party/runtime/impl/` are discovered when their dependencies import successfully.

| Selection | Execution boundary |
| --- | --- |
| `docker` or legacy `eventstream` | Docker container running the action execution server |
| `remote` | Remote runtime service and execution server; requires sandbox API key and service URL |
| `kubernetes` | Kubernetes pod managed through the Kubernetes client |
| `local` | Action execution server subprocess on the host, using the current user |
| `cli` | Direct local command/file operations, without the HTTP execution-server layer |
| Optional third-party runtime | Provider-specific implementation and installed dependencies |

LocalRuntime provides no container sandbox. CLI runtime also executes locally and lacks browser/IPython functionality; configuration finalization disables those tools. Backend names are not promises of identical tool support.

## Actions across the boundary

The stream callback handles actions, sets default timeout when absent, refreshes referenced provider credentials, and invokes the appropriate operation. Normal observations receive the action ID as `cause`, preserve tool-call metadata, and are appended to the stream. PermissionError becomes an ErrorObservation; network/disconnection and unexpected execution failures report runtime status errors.

`Runtime.run_action` handles some non-runnable bookkeeping actions, checks action registration and backend support, holds awaiting-confirmation actions, and returns rejection feedback for rejected actions. MCP uses a separate asynchronous runtime method.

Docker, Remote, Kubernetes, and Local backends share ActionExecutionClient. It serializes actions with a semaphore, posts to `/execute_action`, converts the response back to an observation, and waits for the action timeout plus five seconds of HTTP allowance. A blocking command without an explicit timeout is rejected. HTTP timeout becomes AgentRuntimeTimeoutError. File copying, listing, VS Code access, health checks, and MCP router updates use neighboring endpoints.

Inside the execution server, ActionExecutor owns a persistent shell session, editor, browser, and plugins. An async lock serializes tool dispatch. Jupyter execution follows the current shell working directory and requires the Jupyter plugin. Command state and notebook state therefore persist beyond a single action.

## Docker startup and shutdown

DockerRuntime first tries to attach to its named container. If it is missing and the runtime was explicitly attaching to an existing container, it reports disconnection. Otherwise it builds/selects the runtime image, creates the container, waits for the execution server, exports initial environment, and marks itself initialized.

A configured runtime image bypasses runtime image construction. Otherwise a base image is required and the builder incorporates source/dependency inputs and configured extra dependencies/build arguments. The application image and sandbox runtime image serve different roles. Changing execution-server code may require refreshing the runtime image even when the main server reloads.

Container setup allocates execution, VS Code, and application ports with locks and configures host networking or bound port mappings. Workspace volumes, user configuration, additional networks, and runtime startup variables change the environment seen by tools. For mount syntax and defaults, see [configuration](configuration.md).

Closing normally stops the matching container and releases port locks. `keep_runtime_alive` or attaching to an existing runtime preserves the container. `rm_all_containers` broadens the cleanup prefix beyond one container. Preserve important output using an appropriate mount or runtime persistence mechanism; event-store durability does not preserve a removed container filesystem.

## Local operation and service authentication

LocalRuntime launches the same execution-server module as a subprocess and tracks servers by session. It checks host Jupyter, tmux/libtmux where applicable, and browser availability. Those dependencies live on the host rather than inside a runtime image.

The execution server checks `X-Session-API-Key` when `SESSION_API_KEY` is set. Remote runtime service authentication and per-session execution authentication are separate layers. A successful main-server request does not establish that the sandbox health endpoint, file service, or MCP router is reachable.

## Diagnose by lifecycle stage

| Symptom | Inspect |
| --- | --- |
| Startup stays building | Base/runtime image, builder output, dependency installation |
| Runtime cannot attach | Container/pod/runtime existence and selected session ID |
| Server never becomes ready | Execution-server logs, ports, host networking, authentication |
| Tool appears unsupported | Agent tool flags, backend implementation, initialized plugins |
| Agent waits after a tool | Runtime status, timeout, emitted observation cause, pending confirmation |
| Files disappear after closing | Mount/persistence configuration and cleanup policy |

Use `tests/unit/runtime/` for transport/lifecycle logic and `tests/runtime/` for real shell, files, notebook, and browser behavior. Runtime tests default to Docker and accept `TEST_RUNTIME`. Consult [validation](../testing/validation.md) for commands. [Execution architecture](../architecture/execution.md) explains startup ownership; [MCP and providers](../integrations/tools-providers.md) explains remote tools and repository preparation.
