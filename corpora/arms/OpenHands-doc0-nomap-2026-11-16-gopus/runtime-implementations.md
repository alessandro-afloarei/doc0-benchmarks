---
title: "Runtime Implementations"
---
## Overview

`config.runtime` selects the backend that provides the agent's sandbox. Five ship with OpenHands, registered by name in `openhands/runtime/__init__.py`; third-party packages and any class path can add more. Four of them extend `ActionExecutionClient`: they only start (or find) an environment running the [[Action Execution Server]] and give the client its URL, while action handling is shared as [[Runtime Architecture]] describes. The fifth, `CLIRuntime`, implements `Runtime` directly and runs everything in-process.

Sources: [openhands/runtime/__init__.py:1-21](repo://openhands/runtime/__init__.py#L1-L21), [openhands/runtime/README.md:43-59](repo://openhands/runtime/README.md#L43-L59)

| `runtime` | Class | Sandbox | Choose it when |
| --- | --- | --- | --- |
| `docker` (default), `eventstream` | `DockerRuntime` | A local Docker container per conversation | Running on your own machine with Docker |
| `remote` | `RemoteRuntime` | A container started by a remote runtime API | Hosted or scaled deployments with a runtime service |
| `kubernetes` | `KubernetesRuntime` | A pod, service and volume in a cluster | Running on Kubernetes |
| `local` | `LocalRuntime` | None: a server process on the host | Already inside a controlled environment |
| `cli` | `CLIRuntime` | None: subprocesses in a workspace folder | The terminal app working on your machine |

Sources: [openhands/runtime/__init__.py:14-21](repo://openhands/runtime/__init__.py#L14-L21), [openhands/core/config/openhands_config.py:71-71](repo://openhands/core/config/openhands_config.py#L71-L71)

## Starting the action execution server

Every client-based backend launches the server with the same command from `get_action_execution_server_startup_command`: `python -u -m openhands.runtime.action_execution_server <port> --working-dir <workspace_mount_path_in_sandbox>`, then `--plugins` with the agent's plugin names, `--username` and `--user-id` (`openhands` and 1000 when `run_as_openhands` is set, otherwise `root` and 0), `--browsergym-eval-env` when configured, and `--no-enable-browser` when the browser is off.

Sources: [openhands/runtime/utils/command.py:18-69](repo://openhands/runtime/utils/command.py#L18-L69)

## DockerRuntime

`DockerRuntime` names its container `openhands-runtime-<sid>`, one per conversation. `connect` first tries to attach to that container, starting it if it had exited, and reads its ports back from its environment. Only when none exists (and attaching was not required) does it build the image if needed and start a new container. It then waits up to two minutes for `/alive`, sets up the initial environment, reports `READY`, and joins any `sandbox.additional_networks`.

Sources: [openhands/runtime/impl/docker/docker_runtime.py:130-137](repo://openhands/runtime/impl/docker/docker_runtime.py#L130-L137), [openhands/runtime/impl/docker/docker_runtime.py:170-232](repo://openhands/runtime/impl/docker/docker_runtime.py#L170-L232), [openhands/runtime/impl/docker/docker_runtime.py:543-591](repo://openhands/runtime/impl/docker/docker_runtime.py#L543-L591)

When `sandbox.runtime_container_image` is not set, `maybe_build_runtime_container_image` builds one from `base_container_image` with the Docker builder, reporting `BUILDING_RUNTIME`; with neither set it raises. [[Runtime Images]] explains the build.

Sources: [openhands/runtime/impl/docker/docker_runtime.py:233-250](repo://openhands/runtime/impl/docker/docker_runtime.py#L233-L250)

`init_container` reserves four host ports: the server port (30000 to 39999), a VS Code port (40000 to 49999, unless `sandbox.vscode_port` is set) and two application ports (50000 to 59999) the agent can serve web apps on. On Windows and WSL2 the ranges are moved below 49152. Ports are taken with a file lock so parallel workers do not pick the same one, and skipped if another container already publishes them. The ports are passed to the container as `port`, `VSCODE_PORT`, `APP_PORT_1` and `APP_PORT_2`, and published unless `use_host_network` is set.

Sources: [openhands/runtime/impl/docker/docker_runtime.py:43-54](repo://openhands/runtime/impl/docker/docker_runtime.py#L43-L54), [openhands/runtime/impl/docker/docker_runtime.py:391-475](repo://openhands/runtime/impl/docker/docker_runtime.py#L391-L475), [openhands/runtime/impl/docker/docker_runtime.py:643-688](repo://openhands/runtime/impl/docker/docker_runtime.py#L643-L688)

Volumes come from `sandbox.volumes` (`host:container[:mode]`, with overlay modes mounted separately) or the legacy workspace mount. With `enable_gpu` the container gets all GPUs, or those in `cuda_visible_devices`. `web_hosts` reports the two application ports as `http://<DOCKER_HOST_ADDR or localhost>:<port>`, which the workspace context passes to the agent, and `vscode_url` builds a link with the VS Code token and workspace folder.

Sources: [openhands/runtime/impl/docker/docker_runtime.py:261-330](repo://openhands/runtime/impl/docker/docker_runtime.py#L261-L330), [openhands/runtime/impl/docker/docker_runtime.py:476-520](repo://openhands/runtime/impl/docker/docker_runtime.py#L476-L520), [openhands/runtime/impl/docker/docker_runtime.py:697-713](repo://openhands/runtime/impl/docker/docker_runtime.py#L697-L713)

`close` stops the container (or all `openhands-runtime-` containers with `rm_all_containers`) and releases the port locks, unless `keep_runtime_alive` is set or it attached to an existing container. `pause` and `resume` stop and start the container; resume waits for `/alive` again. A shutdown listener stops every runtime container when the process exits, and `delete(conversation_id)` force-removes a conversation's container.

Sources: [openhands/runtime/impl/docker/docker_runtime.py:593-633](repo://openhands/runtime/impl/docker/docker_runtime.py#L593-L633), [openhands/runtime/impl/docker/docker_runtime.py:716-756](repo://openhands/runtime/impl/docker/docker_runtime.py#L716-L756), [openhands/runtime/impl/docker/docker_runtime.py:105-108](repo://openhands/runtime/impl/docker/docker_runtime.py#L105-L108)

## RemoteRuntime

`RemoteRuntime` asks a runtime API at `sandbox.remote_runtime_api_url` for a sandbox, authenticating with `X-API-Key: sandbox.api_key`; both settings are required. On connect it looks up `/sessions/<sid>`: a running runtime is reused, a paused one is resumed through `/resume`, and otherwise it builds an image if needed (through `/registry_prefix`, `/image_exists` and the remote builder) and calls `/start`.

Sources: [openhands/runtime/impl/remote/remote_runtime.py:39-107](repo://openhands/runtime/impl/remote/remote_runtime.py#L39-L107), [openhands/runtime/impl/remote/remote_runtime.py:135-222](repo://openhands/runtime/impl/remote/remote_runtime.py#L135-L222), [openhands/runtime/impl/remote/remote_runtime.py:224-268](repo://openhands/runtime/impl/remote/remote_runtime.py#L224-L268)

The `/start` request carries the image, the server command, the startup environment, the session id and `remote_runtime_resource_factor`, plus `runtime_class: sysbox-runc` when `remote_runtime_class` is `sysbox`. The response gives the runtime id, its URL, its work hosts and a session API key, which the client then sends as `X-Session-API-Key` on every request to the server.

Sources: [openhands/runtime/impl/remote/remote_runtime.py:270-305](repo://openhands/runtime/impl/remote/remote_runtime.py#L270-L305), [openhands/runtime/impl/remote/remote_runtime.py:358-377](repo://openhands/runtime/impl/remote/remote_runtime.py#L358-L377)

Readiness is polled through `/runtime/<id>` until the pod status is `ready`, within `remote_runtime_init_timeout` (180 seconds by default); `failed`, `unknown` or `crashloopbackoff` fail it. Requests to a runtime that answers 404, 502 or 504 raise `AgentRuntimeDisconnectedError`; a 503 means the runtime was paused and is resumed when `keep_runtime_alive` allows it. On close it pauses the runtime when `keep_runtime_alive` and `pause_closed_runtimes` are both set, keeps it running with only `keep_runtime_alive`, and otherwise calls `/stop`.

Sources: [openhands/runtime/impl/remote/remote_runtime.py:403-475](repo://openhands/runtime/impl/remote/remote_runtime.py#L403-L475), [openhands/runtime/impl/remote/remote_runtime.py:477-508](repo://openhands/runtime/impl/remote/remote_runtime.py#L477-L508), [openhands/runtime/impl/remote/remote_runtime.py:541-596](repo://openhands/runtime/impl/remote/remote_runtime.py#L541-L596), [openhands/core/config/sandbox_config.py:49-66](repo://openhands/core/config/sandbox_config.py#L49-L66)

## KubernetesRuntime

`KubernetesRuntime` creates the sandbox as Kubernetes resources: a pod running the server, a service in front of it reached at `<service>.<namespace>.svc.cluster.local`, a persistent volume claim for the workspace, and a VS Code service with an ingress. On connect it attaches to an existing pod for the session or creates the resources, then waits for the pod to be ready. On close the resources are deleted unless `keep_runtime_alive` is set or it attached to an existing pod.

Sources: [openhands/runtime/impl/kubernetes/kubernetes_runtime.py:61-76](repo://openhands/runtime/impl/kubernetes/kubernetes_runtime.py#L61-L76), [openhands/runtime/impl/kubernetes/kubernetes_runtime.py:136-185](repo://openhands/runtime/impl/kubernetes/kubernetes_runtime.py#L136-L185), [openhands/runtime/impl/kubernetes/kubernetes_runtime.py:219-326](repo://openhands/runtime/impl/kubernetes/kubernetes_runtime.py#L219-L326), [openhands/runtime/impl/kubernetes/kubernetes_runtime.py:339-380](repo://openhands/runtime/impl/kubernetes/kubernetes_runtime.py#L339-L380), [openhands/runtime/impl/kubernetes/kubernetes_runtime.py:690-710](repo://openhands/runtime/impl/kubernetes/kubernetes_runtime.py#L690-L710)

It needs `runtime = "kubernetes"` and a prebuilt `sandbox.runtime_container_image`; namespace, storage, ingress, pod security, node selectors, tolerations and resource limits come from the `[kubernetes]` section. The README walks through a local cluster with KIND and mirrord, which lets a locally running server reach the cluster as if it ran inside it. The session id limit of 32 characters in `generate_sid` exists for these resource names, as [[OpenHands Overview]] notes.

Sources: [openhands/runtime/impl/kubernetes/README.md:1-60](repo://openhands/runtime/impl/kubernetes/README.md#L1-L60), [openhands/core/config/kubernetes_config.py:1-85](repo://openhands/core/config/kubernetes_config.py#L1-L85), [openhands/core/setup.py:246-270](repo://openhands/core/setup.py#L246-L270)

## LocalRuntime

`LocalRuntime` starts the action execution server as a subprocess on the host, as the current user. It logs a warning that no sandbox is used, that `run_as_openhands` is ignored, and that a sandbox such as Docker is recommended unless the environment is controlled. On Windows, features that need tmux are limited.

Sources: [openhands/runtime/impl/local/local_runtime.py:1-1](repo://openhands/runtime/impl/local/local_runtime.py#L1-L1), [openhands/runtime/impl/local/local_runtime.py:123-168](repo://openhands/runtime/impl/local/local_runtime.py#L123-L168)

The workspace is `workspace_base` when set and otherwise a new temporary directory per session. It can keep pre-started "warm" servers (`DESIRED_NUM_WARM_SERVERS`, default 0) and hand one to a new session, replacing its temporary workspace. A `SESSION_API_KEY` in the environment is sent to the server. The development guide uses `RUNTIME=local` to run OpenHands on OpenHands inside its own container.

Sources: [openhands/runtime/impl/local/local_runtime.py:200-300](repo://openhands/runtime/impl/local/local_runtime.py#L200-L300), [openhands/runtime/impl/local/local_runtime.py:65-66](repo://openhands/runtime/impl/local/local_runtime.py#L65-L66), [Development.md:106-117](repo://Development.md#L106-L117)

## CLIRuntime

`CLIRuntime` has no server at all: commands run as subprocesses (or in a PowerShell session on Windows) and files are read and written with Python's standard library in a workspace directory, `workspace_base` or a temporary folder. It tells the agent through `additional_agent_instructions` that it is working directly on the user's machine and may only touch files in that directory.

Sources: [openhands/runtime/impl/cli/cli_runtime.py:1-3](repo://openhands/runtime/impl/cli/cli_runtime.py#L1-L3), [openhands/runtime/impl/cli/cli_runtime.py:90-193](repo://openhands/runtime/impl/cli/cli_runtime.py#L90-L193), [openhands/runtime/impl/cli/cli_runtime.py:918-924](repo://openhands/runtime/impl/cli/cli_runtime.py#L918-L924)

IPython cells and browsing return an `ErrorObservation` saying they are not implemented, which is why `finalize_config` turns off Jupyter and browsing for every agent when `runtime = "cli"`. File edits run through the same editor as the server, and MCP calls are made from the host process. The [[Command-Line Interface]] uses this runtime for its local mode.

Sources: [openhands/runtime/impl/cli/cli_runtime.py:478-494](repo://openhands/runtime/impl/cli/cli_runtime.py#L478-L494), [openhands/runtime/impl/cli/cli_runtime.py:588-598](repo://openhands/runtime/impl/cli/cli_runtime.py#L588-L598), [openhands/runtime/impl/cli/cli_runtime.py:600-700](repo://openhands/runtime/impl/cli/cli_runtime.py#L600-L700), [openhands/core/config/utils.py:459-470](repo://openhands/core/config/utils.py#L459-L470)

## Adding a runtime

A runtime can be added without changing OpenHands. Set `runtime` to a fully qualified class path and `get_runtime_cls` loads it with `get_impl`, checking it subclasses `Runtime`. Or place a package in `third_party/runtime/impl/<name>/` with a `<name>_runtime.py` defining `<NAME>Runtime` or `<Name>Runtime`; it is discovered at import and selectable as `runtime = "<name>"`, and is silently skipped when its optional dependencies are missing.

Sources: [openhands/runtime/__init__.py:23-103](repo://openhands/runtime/__init__.py#L23-L103), [openhands/runtime/base.py:90-117](repo://openhands/runtime/base.py#L90-L117)
