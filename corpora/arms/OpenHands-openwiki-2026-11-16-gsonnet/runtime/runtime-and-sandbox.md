---
type: architecture
title: Runtime and Sandbox Architecture
description: How actions get executed — the Runtime base class, the HTTP split between ActionExecutionClient and the in-sandbox action_execution_server, the docker/local/cli/remote/kubernetes implementations and their lifecycles, plugins, the tmux-backed bash session, file editing, and runtime image building.
tags: [runtime, sandbox, docker, action-execution-server, plugins, bash, kubernetes]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:38:52.407Z
sources:
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
  - id: openwiki-source-e5d7287997f599ed3fb8ced4
    resource: repo://openhands/runtime/impl/kubernetes/kubernetes_runtime.py
  - id: openwiki-source-291db9c7df21d01a746bddad
    resource: repo://openhands/runtime/impl/local/local_runtime.py
  - id: openwiki-source-875ead9d81cce04a8ddd308b
    resource: repo://openhands/runtime/impl/remote/remote_runtime.py
  - id: openwiki-source-0d620e1e634dd7b41f1c6022
    resource: repo://openhands/runtime/plugins/requirement.py
  - id: openwiki-source-3b9ac0f0231c225f39b5320d
    resource: repo://openhands/runtime/utils/bash.py
  - id: openwiki-source-1232a379aedf441aa24216d3
    resource: repo://openhands/runtime/utils/command.py
generated: { by: "claude-code", at: "2026-11-16T09:38:52.407Z" }
---

# Runtime and Sandbox Architecture

The **Runtime** (`openhands/runtime/`) is the only component that touches the outside world on the agent's behalf. It subscribes to the [event stream](../architecture/event-stream.md), executes *runnable* actions, and publishes observations. Everything agents do — shell commands, Python, file edits, browsing, MCP calls — runs through it.

## Layers

```
AgentController ──Action──▶ EventStream ──▶ Runtime (base.py)            [host / server process]
                                              │  ActionExecutionClient (HTTP)
                                              ▼
                          action_execution_server.py (FastAPI)           [inside the sandbox]
                              ActionExecutor: bash session, Jupyter, browser, file editor, plugins
```

1. **`Runtime`** (`base.py`) — abstract base. Subscribes with `EventStreamSubscriber.RUNTIME`; `on_event` → `_handle_action`. Owns environment variables (`add_env_vars`, written to the bash profile so they survive restarts), plugin requirements, git helpers (`clone_or_init_repo`, setup script, git hooks, `GitHandler` for changes/diffs), microagent loading ([Microagents](../agents/microagents.md)) and the generic `run_action` dispatcher.
2. **`ActionExecutionClient`** (`impl/action_execution/`) — base for runtimes whose sandbox is an HTTP server: Docker, Local, Remote, Kubernetes. It serializes the action (`event_to_dict`) and POSTs it to `/execute_action`, rebuilds the observation with `observation_from_dict`, sets `cause`, and applies timeouts.
3. **`action_execution_server.py`** — the FastAPI app that runs *inside* the sandbox (`ActionExecutor`).

### `Runtime._handle_action` and `run_action`

- Actions without an explicit timeout get `sandbox.timeout` (default 120 s) as a **soft, non-blocking** timeout. The action id is stamped as the observation's `cause`.
- `MCPAction` goes to `call_tool_mcp` ([MCP](../integrations/mcp.md)); everything else to `run_action` in a worker thread (`call_sync_from_async`).
- `run_action` returns `NullObservation` for non-runnable actions (think and task-tracking actions are handled locally: task lists are written to `TASKS.md` in the conversation directory via the file store), for actions awaiting confirmation, an `ErrorObservation` for unknown/unsupported action types, `UserRejectObservation` for rejected ones ([Security](../security/security-and-confirmation.md)), else it dispatches by name to `run`, `run_ipython`, `read`, `write`, `edit`, `browse`, `browse_interactive`.
- Error handling: `PermissionError` becomes an `ErrorObservation` (the agent can continue); network errors/`AgentRuntimeDisconnectedError` set runtime status `ERROR_RUNTIME_DISCONNECTED`, any other exception sets `ERROR` — in both of those cases **no observation is published** and the status callback surfaces the failure, which moves the controller to `ERROR`.
- Before every action, provider tokens referenced by the command are refreshed ([Git providers](../integrations/git-providers.md)).

### `ActionExecutionClient.send_action_for_execution`

LLM-based `FileEditAction`s are handled client-side (`llm_based_edit`). A blocking `CmdRunAction` with no timeout is rejected. Calls hold a one-permit semaphore so only one action runs at a time; the HTTP timeout is `action.timeout + 5` so the server-side timeout is reported first; `httpx.TimeoutException` becomes `AgentRuntimeTimeoutError`. HTTP calls retry up to 5 times with exponential backoff only for `RemoteProtocolError`. It also provides `list_files`, `copy_to`/`copy_from` (zip transfer), `check_if_alive`, VS Code token retrieval, and the MCP config sync.

## Inside the sandbox: `ActionExecutor`

Started by `python -m openhands.runtime.action_execution_server <port> --working-dir ... --plugins ... --username ... --user-id ...`. Its FastAPI `lifespan` creates the `ActionExecutor`, awaits `ainit()` and mounts the MCP proxy manager (skipped on Windows). Routes: `POST /execute_action`, `/update_mcp_server`, `/upload_file`, `/list_files`, and `GET /download_files`, `/alive`, `/server_info`, `/vscode/connection_token`. A middleware enforces the **`X-Session-API-Key`** header on everything except `/alive` and `/server_info`.

- **Init order** (`ainit`): create the bash session first; start browser init in the background; initialize plugins concurrently (timeout `INIT_PLUGIN_TIMEOUT`, default 120 s); if both `agent_skills` and `jupyter` are loaded, import the agent-skills functions into Jupyter; then run init bash commands.
- `run_action` takes an **asyncio lock**, so actions are strictly serialized inside the sandbox as well.
- **Bash** (`utils/bash.py::BashSession`): a persistent shell inside **tmux** (`libtmux`) so state (cwd, env, background jobs) persists across commands. It sets a custom PS1 that encodes exit code and working dir into `CmdOutputMetadata`, polls every 0.5 s, and implements two timeouts: a **no-change timeout** (default 30 s with no new output → returns partial output and lets the agent continue, interact, or interrupt) and a hard timeout from the action. Windows uses `windows_bash.py` (PowerShell).
- **Files**: `read`/`write` resolve relative paths against the shell's cwd; edits use `OHEditor` from `openhands_aci` (str_replace-style editor) or the LLM-based edit path (`utils/edit.py`, with linting). Uploads and downloads are bounded by server config.
- **IPython**: `run_ipython` requires the Jupyter plugin; it syncs the Jupyter working directory with the bash cwd before each run.
- **Browser**: `BrowserEnv` (BrowserGym/Playwright) is initialized lazily in the background; `browse` and `browse_interactive` wait for readiness.
- Resource safety: optional `RUNTIME_MAX_MEMORY_GB` and `RUNTIME_MEMORY_MONITOR`; `last_execution_time` is updated on every action and exposed through `/server_info` so orchestrators can detect idle runtimes.

### Plugins (`plugins/`)

`PluginRequirement` (name + documentation, serializable as a dataclass) declares what an agent needs; `Plugin` implements `initialize(username)` and `run(action)`. Built-ins: `agent_skills` (Python helper functions exposed in Jupyter; has no `run`), `jupyter` (a Jupyter kernel gateway with its own execute server), and `vscode` (OpenVSCode server with a connection token). The agent's `sandbox_plugins` class attribute decides which are loaded ([CodeActAgent](../agents/codeact-agent.md)); the runtime passes them on the server's command line.

## Implementations and selection

`runtime/__init__.py::get_runtime_cls(name)` maps `eventstream`/`docker` → `DockerRuntime`, `remote` → `RemoteRuntime`, `local` → `LocalRuntime`, `kubernetes` → `KubernetesRuntime`, `cli` → `CLIRuntime`; third-party runtimes found under `third_party/runtime/impl/<name>/<name>_runtime.py` (e.g. E2B, Daytona, Modal, Runloop) are registered if their optional dependencies import, and an unknown name is treated as a dotted import path (`get_impl`), so `runtime = "my.pkg.MyRuntime"` works. Selection comes from `config.runtime` ([Configuration](../configuration/configuration.md)).

| Runtime | Isolation | How it works |
|---|---|---|
| **Docker** (default) | Container per conversation | `connect()` → try `_attach_to_container`; on `NotFound` (unless `attach_to_existing`) build the image if only a base image is configured (`maybe_build_runtime_container_image` → [`build_runtime_image`](../operations/build-and-containers.md)), then `init_container`: lock free ports for the server, VS Code and two app ports (port locks avoid races between concurrent starts), run the container with env, volumes (`sandbox.volumes`; bind mounts, named volumes, overlay mounts), optional host network/GPU, and the server startup command; `wait_until_alive` polls `/alive`; then `setup_initial_env`. Containers are named `openhands-sandbox-<sid>`; `close` stops the container unless `keep_runtime_alive`/attached; `pause`/`resume` stop/start it; `delete(conversation_id)` removes it. A shutdown listener stops all sandbox containers on exit. |
| **Local** | **None** — runs the server as a host subprocess as the current user | Verifies dependencies (Jupyter, tmux/libtmux, optionally the browser), starts `action_execution_server` via `_create_server`, optionally keeps a **warm server** pool for fast starts; URL `local_runtime_url:port`. |
| **CLI** | None, host subprocess | Does not use the HTTP server at all: commands run with `subprocess`, file ops via the Python stdlib; no browser or Jupyter (the config finalizer disables them). Used by the terminal UI. |
| **Remote** | Provider-managed (`sysbox`/`gvisor` classes) | Talks to a runtime API: check for an existing runtime, build/obtain the image (via `RemoteRuntimeBuilder`), start or resume it, wait until alive; requests go through `_send_runtime_api_request`/`_send_action_server_request` with retries; used for evaluation at scale and by SaaS. |
| **Kubernetes** | Pod per conversation | Creates a PVC, pod, service and optional VS Code ingress from manifests, with node selector/tolerations from `KubernetesConfig`; cleans up resources on close/delete. |

`Runtime.setup(config)`/`teardown` classmethods allow one-time per-process preparation (the CLI uses them around sessions).

### Image builders (`builder/`)

`RuntimeBuilder` ABC (`build`, `image_exists`) with `DockerRuntimeBuilder` (docker buildx, with local cache management) and `RemoteRuntimeBuilder` (remote build API). Tagging and reuse rules are in [Build and containers](../operations/build-and-containers.md).

## Invariants and failure modes

- One in-flight action per conversation at both ends (controller pending-action gate, client semaphore, server lock).
- Every observation carries `cause` = triggering action id; runtime failures that abort without an observation are signalled through `RuntimeStatus` callbacks instead.
- The server API key is mandatory for all but liveness endpoints; remote/local URLs are only as safe as that key, and the **Local and CLI runtimes provide no isolation** — all actions run with the user's permissions ([Security](../security/security-and-confirmation.md)).
- Tests parametrize over runtimes via `TEST_RUNTIME` ([Testing](../operations/testing-and-evaluation.md)).

Related: [Overview](../architecture/overview.md), [Server and sessions](../server/server-and-sessions.md) (creates runtimes in `AgentSession._create_runtime`).
