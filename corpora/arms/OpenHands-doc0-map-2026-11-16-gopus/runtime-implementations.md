---
title: "Runtime Implementations"
---
## Overview

OpenHands ships five runtime backends, selected with the `runtime` setting. Four of them (`docker`, `remote`, `kubernetes`, `local`) start an [[Action Execution Server]] somewhere and talk to it through `ActionExecutionClient`; they differ in where that server runs, how its ports are allocated, and what happens when a conversation closes. The fifth, `cli`, has no server and runs commands directly on the host. All of them inherit event handling and workspace setup from the base class in [[Runtime Architecture]].

Sources: [openhands/runtime/__init__.py:14-21](repo://openhands/runtime/__init__.py#L14-L21), [openhands/core/config/openhands_config.py:71](repo://openhands/core/config/openhands_config.py#L71)

## Choosing a backend

| `runtime` | Class | Where actions run | Isolation | Choose it when |
| --- | --- | --- | --- | --- |
| `docker` (default) | `DockerRuntime` | A container per conversation on the local Docker daemon | Container | Running OpenHands on your own machine or server |
| `remote` | `RemoteRuntime` | A sandbox started by a remote runtime API | Remote sandbox (gVisor or Sysbox) | Large-scale or hosted use, evaluations |
| `kubernetes` | `KubernetesRuntime` | A pod per conversation, with a service, PVC and optional ingress | Pod | Running on a Kubernetes cluster (tested with Kind) |
| `local` | `LocalRuntime` | An action execution server process on the host | None | Developing OpenHands itself, controlled environments |
| `cli` | `CLIRuntime` | Subprocesses on the host, no server | None | The terminal CLI working in your own project directory |

Sources: [openhands/runtime/impl/docker/docker_runtime.py:75-86](repo://openhands/runtime/impl/docker/docker_runtime.py#L75-L86), [openhands/runtime/impl/remote/remote_runtime.py:39-40](repo://openhands/runtime/impl/remote/remote_runtime.py#L39-L40), [openhands/runtime/impl/kubernetes/kubernetes_runtime.py:61-76](repo://openhands/runtime/impl/kubernetes/kubernetes_runtime.py#L61-L76), [openhands/runtime/impl/local/local_runtime.py:123-131](repo://openhands/runtime/impl/local/local_runtime.py#L123-L131), [openhands/runtime/impl/cli/cli_runtime.py:1-3](repo://openhands/runtime/impl/cli/cli_runtime.py#L1-L3)

> [!WARNING]
> `local` and `cli` log `WARNING: NO SANDBOX IS USED`: the agent's commands run as your user on your machine. The local runtime's warning recommends a sandboxed runtime unless the environment is controlled.

Sources: [openhands/runtime/impl/local/local_runtime.py:159-167](repo://openhands/runtime/impl/local/local_runtime.py#L159-L167), [openhands/runtime/impl/cli/cli_runtime.py:160-164](repo://openhands/runtime/impl/cli/cli_runtime.py#L160-L164)

## The server start command

Every server-based backend starts the server with the same command, built by `get_action_execution_server_startup_command`: Python from the image's `openhands` micromamba environment through Poetry, running `openhands.runtime.action_execution_server` with the port, the working directory in the sandbox, the plugin names, the user (`openhands`/1000 when `run_as_openhands`, else `root`/0), any BrowserGym evaluation environment, and `--no-enable-browser` when the browser is off.

Sources: [openhands/runtime/utils/command.py:5-69](repo://openhands/runtime/utils/command.py#L5-L69)

## DockerRuntime

### Starting a container

`connect` first tries to attach to an existing container named `openhands-runtime-<sid>`, restarting it if it exited, and reads its ports back from the container's environment and exposed ports. If there is none (and attaching is not required), it builds the runtime image when no `runtime_container_image` is set ([[Runtime Images]]) and starts a new container. It then waits for `/alive` (retrying for up to two minutes), applies the initial environment, reports `READY`, and connects the container to any `additional_networks`.

Sources: [openhands/runtime/impl/docker/docker_runtime.py:170-250](repo://openhands/runtime/impl/docker/docker_runtime.py#L170-L250), [openhands/runtime/impl/docker/docker_runtime.py:543-592](repo://openhands/runtime/impl/docker/docker_runtime.py#L543-L592)

`init_container` allocates four host ports from fixed ranges: the server port (30000–39999), the VS Code port (40000–49999, or `sandbox.vscode_port`) and two application ports (50000–54999 and 55000–59999) that the agent can serve web apps on. On Windows and WSL2 the ranges are lower to stay below 49152. Each port is taken with a file-based lock and checked against ports used by running containers, so concurrent conversations do not collide.

Sources: [openhands/runtime/impl/docker/docker_runtime.py:43-54](repo://openhands/runtime/impl/docker/docker_runtime.py#L43-L54), [openhands/runtime/impl/docker/docker_runtime.py:391-416](repo://openhands/runtime/impl/docker/docker_runtime.py#L391-L416), [openhands/runtime/impl/docker/docker_runtime.py:643-688](repo://openhands/runtime/impl/docker/docker_runtime.py#L643-L688)

The container gets the ports bound on `runtime_binding_address` (or host networking with `use_host_network`), the initial environment variables plus `port`, `VSCODE_PORT`, `APP_PORT_1`, `APP_PORT_2` and `PIP_BREAK_SYSTEM_PACKAGES`, the volumes from `SANDBOX_VOLUMES` (bind mounts or named volumes) and overlay mounts, GPU device requests when `enable_gpu` is set (limited by `cuda_visible_devices`), and any extra `docker_runtime_kwargs`.

Sources: [openhands/runtime/impl/docker/docker_runtime.py:417-480](repo://openhands/runtime/impl/docker/docker_runtime.py#L417-L480), [openhands/runtime/impl/docker/docker_runtime.py:481-541](repo://openhands/runtime/impl/docker/docker_runtime.py#L481-L541), [openhands/runtime/impl/docker/docker_runtime.py:261-280](repo://openhands/runtime/impl/docker/docker_runtime.py#L261-L280)

### Lifecycle

`close` stops the conversation's container (or every `openhands-runtime-` container with `rm_all_containers`) and releases the port locks, unless `keep_runtime_alive` is set or the runtime only attached. `pause` and `resume` stop and start the container; environment variables survive because `add_env_vars` also wrote them to `~/.bashrc`. A process-wide shutdown listener stops all OpenHands containers when the server exits.

Sources: [openhands/runtime/impl/docker/docker_runtime.py:593-612](repo://openhands/runtime/impl/docker/docker_runtime.py#L593-L612), [openhands/runtime/impl/docker/docker_runtime.py:716-743](repo://openhands/runtime/impl/docker/docker_runtime.py#L716-L743), [openhands/runtime/impl/docker/docker_runtime.py:105-108](repo://openhands/runtime/impl/docker/docker_runtime.py#L105-L108)

The VS Code URL is `http://localhost:<vscode_port>/?tkn=<token>&folder=<workspace>`, and `web_hosts` maps `http://<DOCKER_HOST_ADDR or localhost>:<port>` for both application ports. `DOCKER_HOST_ADDR` also replaces `local_runtime_url` when OpenHands itself runs in a container.

Sources: [openhands/runtime/impl/docker/docker_runtime.py:697-714](repo://openhands/runtime/impl/docker/docker_runtime.py#L697-L714), [openhands/runtime/impl/docker/docker_runtime.py:122-128](repo://openhands/runtime/impl/docker/docker_runtime.py#L122-L128)

## RemoteRuntime

### Starting a sandbox

`RemoteRuntime` asks a runtime API at `sandbox.remote_runtime_api_url` for a sandbox, authenticating with `sandbox.api_key` in `X-API-Key`; both are required. It first looks up `/sessions/<sid>`: a running sandbox is reused, a paused one is resumed with `/resume`, and a stopped or missing one leads to a new start. Attaching to a sandbox that does not exist raises `AgentRuntimeNotFoundError`.

Sources: [openhands/runtime/impl/remote/remote_runtime.py:51-106](repo://openhands/runtime/impl/remote/remote_runtime.py#L51-L106), [openhands/runtime/impl/remote/remote_runtime.py:135-222](repo://openhands/runtime/impl/remote/remote_runtime.py#L135-L222)

Without a prebuilt image it builds one through `RemoteRuntimeBuilder` into the registry the API reports, and checks with `/image_exists`. `/start` receives the image, the server command, environment, session id, `remote_runtime_resource_factor`, and `sysbox-runc` as runtime class when `remote_runtime_class` is `sysbox` (the default maps to gVisor). The response gives the runtime id, URL, work hosts and a session API key, which is then sent as `X-Session-API-Key` on every server request.

Sources: [openhands/runtime/impl/remote/remote_runtime.py:224-304](repo://openhands/runtime/impl/remote/remote_runtime.py#L224-L304), [openhands/runtime/impl/remote/remote_runtime.py:358-377](repo://openhands/runtime/impl/remote/remote_runtime.py#L358-L377)

### Failures and closing

Server requests retry network errors three times. A 503 from a paused sandbox triggers a resume when `keep_runtime_alive` is set; 404, 502 and 504 are treated as the sandbox being gone. On close, with `keep_runtime_alive` the sandbox is paused (`pause_closed_runtimes`, default on) or left running; otherwise it is stopped with `/stop`.

Sources: [openhands/runtime/impl/remote/remote_runtime.py:523-596](repo://openhands/runtime/impl/remote/remote_runtime.py#L523-L596), [openhands/runtime/impl/remote/remote_runtime.py:477-508](repo://openhands/runtime/impl/remote/remote_runtime.py#L477-L508)

## KubernetesRuntime

`KubernetesRuntime` needs a `[kubernetes]` section ([[Configuration]]) and uses the runtime image, falling back to the base image. For each conversation it creates, in the configured namespace, a pod named `openhands-runtime-<sid>`, a PVC for the workspace, a service for the server and one for VS Code, and an ingress for VS Code under `ingress_domain`. Pods get the configured CPU and memory requests, node selector, tolerations and image pull secret.

Sources: [openhands/runtime/impl/kubernetes/kubernetes_runtime.py:57-58](repo://openhands/runtime/impl/kubernetes/kubernetes_runtime.py#L57-L58), [openhands/runtime/impl/kubernetes/kubernetes_runtime.py:108-133](repo://openhands/runtime/impl/kubernetes/kubernetes_runtime.py#L108-L133), [openhands/runtime/impl/kubernetes/kubernetes_runtime.py:394-480](repo://openhands/runtime/impl/kubernetes/kubernetes_runtime.py#L394-L480), [openhands/runtime/impl/kubernetes/kubernetes_runtime.py:627-683](repo://openhands/runtime/impl/kubernetes/kubernetes_runtime.py#L627-L683)

`connect` attaches to an existing pod or creates the resources, waits for the pod to be ready, and sets up the environment. `close` deletes the conversation's resources but keeps the PVC, so the workspace survives a restart; `delete` removes everything including the PVC.

Sources: [openhands/runtime/impl/kubernetes/kubernetes_runtime.py:219-277](repo://openhands/runtime/impl/kubernetes/kubernetes_runtime.py#L219-L277), [openhands/runtime/impl/kubernetes/kubernetes_runtime.py:685-710](repo://openhands/runtime/impl/kubernetes/kubernetes_runtime.py#L685-L710), [openhands/runtime/impl/kubernetes/kubernetes_runtime.py:739-745](repo://openhands/runtime/impl/kubernetes/kubernetes_runtime.py#L739-L745)

## LocalRuntime

`LocalRuntime` starts the action execution server as a subprocess of the current Python, as the current user. The agent works in `workspace_base` if set (with a warning that the agent can edit files there) or in a fresh temporary directory. Servers are kept in a process-wide map by session id, so a reconnect reuses the running server.

Sources: [openhands/runtime/impl/local/local_runtime.py:135-215](repo://openhands/runtime/impl/local/local_runtime.py#L135-L215), [openhands/runtime/impl/local/local_runtime.py:217-280](repo://openhands/runtime/impl/local/local_runtime.py#L217-L280)

To make new conversations start fast, `setup` can pre-start `INITIAL_NUM_WARM_SERVERS` servers, and after each action the runtime tops the pool back up to `DESIRED_NUM_WARM_SERVERS` in the background; a new conversation takes a warm server and gets a fresh temporary workspace. `setup` also checks that the required tools (tmux, Jupyter, and the browser when enabled) are installed unless `SKIP_DEPENDENCY_CHECK=1`.

Sources: [openhands/runtime/impl/local/local_runtime.py:281-330](repo://openhands/runtime/impl/local/local_runtime.py#L281-L330), [openhands/runtime/impl/local/local_runtime.py:395-410](repo://openhands/runtime/impl/local/local_runtime.py#L395-L410), [openhands/runtime/impl/local/local_runtime.py:434-478](repo://openhands/runtime/impl/local/local_runtime.py#L434-L478), [openhands/runtime/impl/local/local_runtime.py:81-121](repo://openhands/runtime/impl/local/local_runtime.py#L81-L121)

## CLIRuntime

`CLIRuntime` subclasses `Runtime` directly. It works in `workspace_base` or a temporary directory, `chdir`s there on connect, and runs each command as `bash -c <command>` in its own process session with the action's timeout (or `sandbox.timeout`), terminating the process group on timeout and returning exit code -1. File reads and edits use `OHEditor` against the same directory.

Sources: [openhands/runtime/impl/cli/cli_runtime.py:90-192](repo://openhands/runtime/impl/cli/cli_runtime.py#L90-L192), [openhands/runtime/impl/cli/cli_runtime.py:325-430](repo://openhands/runtime/impl/cli/cli_runtime.py#L325-L430), [openhands/runtime/impl/cli/cli_runtime.py:432-476](repo://openhands/runtime/impl/cli/cli_runtime.py#L432-L476), [openhands/runtime/impl/cli/cli_runtime.py:525-567](repo://openhands/runtime/impl/cli/cli_runtime.py#L525-L567), [openhands/runtime/impl/cli/cli_runtime.py:650-686](repo://openhands/runtime/impl/cli/cli_runtime.py#L650-L686)

Because there is no persistent shell, the bash soft timeout and interactive input of the other runtimes do not apply. IPython and browsing return errors, which is why `finalize_config` disables Jupyter and browsing for every agent when `runtime` is `cli`. MCP stdio servers run directly on the host, since there is no sandbox proxy. Its extra agent instructions tell the model it is working on the user's machine and may only read and write in the working directory.

Sources: [openhands/runtime/impl/cli/cli_runtime.py:478-494](repo://openhands/runtime/impl/cli/cli_runtime.py#L478-L494), [openhands/runtime/impl/cli/cli_runtime.py:588-598](repo://openhands/runtime/impl/cli/cli_runtime.py#L588-L598), [openhands/core/config/utils.py:457-470](repo://openhands/core/config/utils.py#L457-L470), [openhands/runtime/impl/cli/cli_runtime.py:687-751](repo://openhands/runtime/impl/cli/cli_runtime.py#L687-L751), [openhands/runtime/impl/cli/cli_runtime.py:918-962](repo://openhands/runtime/impl/cli/cli_runtime.py#L918-L962)

## Third-party runtimes

Packages under `third_party/runtime/impl/<name>/` that provide `<name>_runtime.py` with a class named `<NAME>Runtime` or `<Name>Runtime` are registered under `<name>` when their dependencies are installed; a missing dependency is ignored silently, any other import error is logged.

Sources: [openhands/runtime/__init__.py:23-87](repo://openhands/runtime/__init__.py#L23-L87)
