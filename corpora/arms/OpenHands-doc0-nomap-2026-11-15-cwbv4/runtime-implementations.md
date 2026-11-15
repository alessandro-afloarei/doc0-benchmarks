---
title: "Runtime Implementations"
---
## Overview

OpenHands ships five runtime backends, chosen with `runtime` in the `[core]` config section. Four of them start the [[Action Execution Server]] somewhere (a Docker container, a remote sandbox service, a local process or a Kubernetes pod) and talk to it through the shared HTTP client described on [[Runtime Architecture]]. The fifth, the CLI runtime, runs commands directly in the current process's environment with no server at all.

Sources: [openhands/runtime/__init__.py:14-21](repo://openhands/runtime/__init__.py#L14-L21), [openhands/core/config/openhands_config.py:71-71](repo://openhands/core/config/openhands_config.py#L71-L71)

## Choosing a backend

| `runtime` | Class | Sandbox | Choose it when |
| --- | --- | --- | --- |
| `docker` (default) | `DockerRuntime` | a container per conversation on the local Docker daemon | running OpenHands on a workstation |
| `remote` | `RemoteRuntime` | a container started by a remote runtime API | hosted deployments and large evaluation runs |
| `kubernetes` | `KubernetesRuntime` | a pod with services, a volume claim and an ingress | running on a Kubernetes cluster |
| `local` | `LocalRuntime` | none; the action server runs as a local process | developing OpenHands inside a sandbox it already runs in |
| `cli` | `CLIRuntime` | none; commands run as subprocesses | the terminal client working on the user's own folder |

Sources: [openhands/runtime/impl/docker/docker_runtime.py:75-90](repo://openhands/runtime/impl/docker/docker_runtime.py#L75-L90), [openhands/runtime/impl/remote/remote_runtime.py:39-51](repo://openhands/runtime/impl/remote/remote_runtime.py#L39-L51), [openhands/runtime/impl/kubernetes/kubernetes_runtime.py:61-80](repo://openhands/runtime/impl/kubernetes/kubernetes_runtime.py#L61-L80), [openhands/runtime/impl/local/local_runtime.py:123-134](repo://openhands/runtime/impl/local/local_runtime.py#L123-L134), [openhands/runtime/impl/cli/cli_runtime.py:90-105](repo://openhands/runtime/impl/cli/cli_runtime.py#L90-L105)

> [!WARNING]
> The local and CLI runtimes log `NO SANDBOX IS USED`: the agent's commands run with the user's own permissions on the host.

Sources: [openhands/runtime/impl/local/local_runtime.py:160-168](repo://openhands/runtime/impl/local/local_runtime.py#L160-L168), [openhands/runtime/impl/cli/cli_runtime.py:162-166](repo://openhands/runtime/impl/cli/cli_runtime.py#L162-L166)

## DockerRuntime

### Starting a container

`connect` first tries to attach to a container named `openhands-runtime-<sid>`. If none exists, it builds the runtime image when only a base image is configured (see [[Runtime Images]]), starts the container, waits until `/alive` answers, runs the initial environment setup, and connects the container to any `additional_networks`. With `attach_to_existing`, a missing container is a disconnection error instead.

Sources: [openhands/runtime/impl/docker/docker_runtime.py:170-249](repo://openhands/runtime/impl/docker/docker_runtime.py#L170-L249)

`init_container` allocates four host ports: the action server (30000-39999), VS Code (40000-49999, or `sandbox.vscode_port`) and two application ports (50000-54999 and 55000-59999), with smaller ranges on Windows and WSL. The application ports are what `web_hosts` reports to the agent, so a web app it starts can be opened from the host. Ports are mapped on `runtime_binding_address`, unless `use_host_network` puts the container on the host network.

Sources: [openhands/runtime/impl/docker/docker_runtime.py:43-55](repo://openhands/runtime/impl/docker/docker_runtime.py#L43-L55), [openhands/runtime/impl/docker/docker_runtime.py:391-454](repo://openhands/runtime/impl/docker/docker_runtime.py#L391-L454), [openhands/runtime/impl/docker/docker_runtime.py:706-713](repo://openhands/runtime/impl/docker/docker_runtime.py#L706-L713)

Port allocation takes a file lock per port in the temp directory, so several conversations or workers starting at once do not pick the same port, and double-checks the port against running containers; it falls back to a plain free-port search if locking fails.

Sources: [openhands/runtime/impl/docker/docker_runtime.py:643-688](repo://openhands/runtime/impl/docker/docker_runtime.py#L643-L688), [openhands/runtime/utils/port_lock.py:21-35](repo://openhands/runtime/utils/port_lock.py#L21-L35)

The container runs the action server command with the initial environment, the port numbers, `runtime_startup_env_vars` and `DEBUG` when debugging. GPUs are passed through when `enable_gpu` is set, limited to `cuda_visible_devices` if given, and `docker_runtime_kwargs` is forwarded to `containers.run` unchanged.

Sources: [openhands/runtime/impl/docker/docker_runtime.py:456-541](repo://openhands/runtime/impl/docker/docker_runtime.py#L456-L541)

### Volumes

`sandbox.volumes` is a comma-separated list of `host:container[:mode]`. A host part starting with `/` is a bind mount, `volume:<name>` or a bare name is a Docker named volume, and a mode containing `overlay` creates an overlay mount: the host directory is a read-only lower layer and each container writes to its own copy-on-write layer. Without `volumes`, the deprecated `workspace_mount_path` is mounted read-write at the sandbox workspace.

Sources: [openhands/runtime/impl/docker/docker_runtime.py:261-330](repo://openhands/runtime/impl/docker/docker_runtime.py#L261-L330)

### Closing

`close` stops the conversation's container (or all `openhands-runtime-` containers when `rm_all_containers` is set) and releases its port locks, unless `keep_runtime_alive` is set or the runtime only attached. `pause` and `resume` stop and start the container; environment variables survive because they were also written to `~/.bashrc`. A shutdown listener stops all runtime containers when the process exits.

Sources: [openhands/runtime/impl/docker/docker_runtime.py:593-633](repo://openhands/runtime/impl/docker/docker_runtime.py#L593-L633), [openhands/runtime/impl/docker/docker_runtime.py:715-744](repo://openhands/runtime/impl/docker/docker_runtime.py#L715-L744), [openhands/runtime/impl/docker/docker_runtime.py:105-109](repo://openhands/runtime/impl/docker/docker_runtime.py#L105-L109)

## RemoteRuntime

### Starting or resuming

`RemoteRuntime` asks a runtime API at `remote_runtime_api_url`, authenticated with `X-API-Key: sandbox.api_key`, for a sandbox. It first looks up `/sessions/<sid>`: a running sandbox is reused, a paused one is resumed, a stopped one is replaced. To start a new one it builds the image through the API's registry when only a base image is given, then POSTs `/start` with the image, the action server command, environment, session id, `remote_runtime_resource_factor` and, for `remote_runtime_class = "sysbox"`, the `sysbox-runc` runtime class.

Sources: [openhands/runtime/impl/remote/remote_runtime.py:125-222](repo://openhands/runtime/impl/remote/remote_runtime.py#L125-L222), [openhands/runtime/impl/remote/remote_runtime.py:224-304](repo://openhands/runtime/impl/remote/remote_runtime.py#L224-L304)

The response gives the runtime id, its URL, its work hosts and a session API key, which is added to every later request as `X-Session-API-Key`. `connect` then polls `/runtime/<id>` every two seconds until the pod is `ready` and `/alive` answers, within `remote_runtime_init_timeout`; `failed`, `unknown` and `crashloopbackoff` statuses fail immediately.

Sources: [openhands/runtime/impl/remote/remote_runtime.py:358-376](repo://openhands/runtime/impl/remote/remote_runtime.py#L358-L376), [openhands/runtime/impl/remote/remote_runtime.py:403-475](repo://openhands/runtime/impl/remote/remote_runtime.py#L403-L475)

### Requests and closing

Action requests answered with 404, 502 or 504 raise `AgentRuntimeDisconnectedError`. A 503 means the sandbox was paused; with `keep_runtime_alive` the runtime resumes it and retries. On close it calls `/pause` when `keep_runtime_alive` and `pause_closed_runtimes` are set, and `/stop` otherwise.

Sources: [openhands/runtime/impl/remote/remote_runtime.py:541-597](repo://openhands/runtime/impl/remote/remote_runtime.py#L541-L597), [openhands/runtime/impl/remote/remote_runtime.py:477-508](repo://openhands/runtime/impl/remote/remote_runtime.py#L477-L508)

VS Code is reached at `<runtime_url>/<id>/vscode` when the runtime URL is path-based, or at a `vscode-` subdomain otherwise.

Sources: [openhands/runtime/impl/remote/remote_runtime.py:378-398](repo://openhands/runtime/impl/remote/remote_runtime.py#L378-L398)

## KubernetesRuntime

`KubernetesRuntime` creates, per conversation, a persistent volume claim (kept across restarts), a pod running the runtime image, a service for the action server, a service and an ingress for VS Code, and waits for the pod to be ready. It needs `runtime_container_image` set; namespace, ingress domain and TLS secret, volume size and storage class, CPU and memory requests and limits, image pull secret, node selector, tolerations and privileged mode come from the `[kubernetes]` section. Closing deletes the pod and services but keeps the volume claim unless the runtime is kept alive.

Sources: [openhands/runtime/impl/kubernetes/kubernetes_runtime.py:219-277](repo://openhands/runtime/impl/kubernetes/kubernetes_runtime.py#L219-L277), [openhands/runtime/impl/kubernetes/kubernetes_runtime.py:627-710](repo://openhands/runtime/impl/kubernetes/kubernetes_runtime.py#L627-L710), [openhands/core/config/kubernetes_config.py:22-63](repo://openhands/core/config/kubernetes_config.py#L22-L63), [openhands/runtime/impl/kubernetes/README.md:26-54](repo://openhands/runtime/impl/kubernetes/README.md#L26-L54)

The repository's `kind` folder and `make kind` set up a local KIND cluster for developing against this runtime, with mirrord letting a locally running OpenHands reach the cluster.

Sources: [openhands/runtime/impl/kubernetes/README.md:5-24](repo://openhands/runtime/impl/kubernetes/README.md#L5-L24), [Makefile:203-203](repo://Makefile#L203-L203)

## LocalRuntime

`LocalRuntime` starts the action server as a subprocess of the current Python, in `workspace_base` if set (with a warning that the agent can edit it) or in a fresh temporary directory. It keeps a registry of running servers by session id so a reconnecting session reuses its server, and can keep a pool of pre-started warm servers (`INITIAL_NUM_WARM_SERVERS`, `DESIRED_NUM_WARM_SERVERS`) to hide startup time. Its class-level `setup` checks that Jupyter, tmux and, when browsing is on, the browser are installed, unless `SKIP_DEPENDENCY_CHECK=1`. `run_as_openhands` is ignored: the server runs as the current user.

Sources: [openhands/runtime/impl/local/local_runtime.py:81-121](repo://openhands/runtime/impl/local/local_runtime.py#L81-L121), [openhands/runtime/impl/local/local_runtime.py:217-300](repo://openhands/runtime/impl/local/local_runtime.py#L217-L300), [openhands/runtime/impl/local/local_runtime.py:395-413](repo://openhands/runtime/impl/local/local_runtime.py#L395-L413), [openhands/runtime/impl/local/local_runtime.py:750-800](repo://openhands/runtime/impl/local/local_runtime.py#L750-L800)

## CLIRuntime

`CLIRuntime` subclasses `Runtime` directly. It works in `workspace_base` or a temporary directory, changes the process into it, and implements the actions itself:

Sources: [openhands/runtime/impl/cli/cli_runtime.py:168-192](repo://openhands/runtime/impl/cli/cli_runtime.py#L168-L192)

- shell commands run with `subprocess.Popen(shell=True)` and the action's timeout (default `sandbox.timeout`), and output can be streamed to a subscriber such as the terminal UI; on Windows they run in a PowerShell session;
- `is_input` and IPython cells are refused, and browsing is not implemented, which is why the config loader turns Jupyter and browsing off for this runtime;
- file reads, writes and edits use Python and the ACI editor, and every path is checked to stay inside the workspace (`/workspace/...` paths are mapped onto it);
- environment variables are set on `os.environ`, and git config is left as the user has it.

Sources: [openhands/runtime/impl/cli/cli_runtime.py:107-218](repo://openhands/runtime/impl/cli/cli_runtime.py#L107-L218), [openhands/runtime/impl/cli/cli_runtime.py:432-524](repo://openhands/runtime/impl/cli/cli_runtime.py#L432-L524), [openhands/runtime/impl/cli/cli_runtime.py:588-598](repo://openhands/runtime/impl/cli/cli_runtime.py#L588-L598), [openhands/core/config/utils.py:458-470](repo://openhands/core/config/utils.py#L458-L470)

Its `additional_agent_instructions` tell the agent that it works on the user's machine and may only touch the workspace directory. MCP servers come from the user's config directly, and are disabled on Windows. The [[CLI]] uses this runtime.

Sources: [openhands/runtime/impl/cli/cli_runtime.py:917-962](repo://openhands/runtime/impl/cli/cli_runtime.py#L917-L962)

## Third-party runtimes

The `third_party/runtime/impl` package holds optional integrations with hosted sandbox providers, Daytona, E2B, Modal and Runloop, each in its own folder. They are registered under their folder name when their client libraries are installed, and skipped silently otherwise.

Sources: [openhands/runtime/__init__.py:23-87](repo://openhands/runtime/__init__.py#L23-L87), [third_party/runtime/impl/__init__.py:1-1](repo://third_party/runtime/impl/__init__.py#L1-L1)

## Shared sandbox settings

| Setting | Effect |
| --- | --- |
| `base_container_image`, `runtime_container_image` | image to build from, or a ready runtime image |
| `timeout` | default action timeout (120 s) |
| `keep_runtime_alive`, `pause_closed_runtimes`, `rm_all_containers`, `close_delay` | what happens when a conversation closes |
| `volumes`, `use_host_network`, `additional_networks`, `runtime_binding_address` | container wiring |
| `runtime_startup_env_vars`, `runtime_extra_deps`, `runtime_extra_build_args`, `force_rebuild_runtime`, `platform` | image and environment customisation |
| `remote_runtime_api_url`, `api_key`, `remote_runtime_*` | remote runtime service |
| `enable_gpu`, `cuda_visible_devices`, `docker_runtime_kwargs` | Docker resources |

Sources: [openhands/core/config/sandbox_config.py:49-98](repo://openhands/core/config/sandbox_config.py#L49-L98)
