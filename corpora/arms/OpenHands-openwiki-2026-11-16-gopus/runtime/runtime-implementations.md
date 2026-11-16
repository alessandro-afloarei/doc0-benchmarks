---
type: reference
title: Runtime Implementations and Image Building
description: The concrete OpenHands runtimes — Docker, Remote, Local, Kubernetes, CLI, and optional third-party runtimes — how one is selected, their lifecycle, ports, and isolation trade-offs, the [sandbox] configuration, and how runtime sandbox images are built, tagged, and reused.
tags: [runtime, docker, kubernetes, remote-runtime, sandbox-config, image-build]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:35:38.671Z
sources:
  - id: openwiki-source-ef0eefc8baa05844ac6d2e7c
    resource: repo://openhands/core/config/kubernetes_config.py
  - id: openwiki-source-f0fa538b22f586fd775d4bce
    resource: repo://openhands/core/config/sandbox_config.py
  - id: openwiki-source-9941cabbb453d6800d37b944
    resource: repo://openhands/runtime/__init__.py
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
  - id: openwiki-source-1526c13fed87a2dc10ce6868
    resource: repo://openhands/runtime/utils/runtime_build.py
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
generated: { by: "claude-code", at: "2026-11-16T07:35:38.671Z" }
---

# Runtime Implementations and Image Building

Every runtime implements the `Runtime` interface ([Runtime Architecture](runtime-architecture.md)). Most extend `ActionExecutionClient` and differ only in **where the action execution server runs** and how its lifecycle is managed.

## Selection

`get_runtime_cls(name)` (`openhands/runtime/__init__.py`) looks up `config.runtime` (env `RUNTIME`, default `docker`):

| Name | Class | Where actions run |
| --- | --- | --- |
| `docker` (alias `eventstream`) | `DockerRuntime` | A local Docker container per conversation |
| `remote` | `RemoteRuntime` | A container managed by a remote Runtime API |
| `local` | `LocalRuntime` | An `action_execution_server` subprocess on the host (no container) |
| `kubernetes` | `KubernetesRuntime` | A pod per conversation |
| `cli` | `CLIRuntime` | Directly on the host, in-process (no server) |
| `e2b`, `modal`, `runloop`, `daytona` | third-party | Vendor sandboxes. Discovered from `third_party/runtime/impl/<name>/<name>_runtime.py` when the `third_party_runtimes` extra is installed. |

Any other value is treated as a classpath and resolved with `get_impl(Runtime, name)`, so custom runtimes plug in through `runtime = "my.module.MyRuntime"`.

## DockerRuntime (`impl/docker/docker_runtime.py`)

- **Connect:** tries to attach to an existing container named `openhands-runtime-<sid>`. If none exists, it builds the runtime image when needed (`maybe_build_runtime_container_image`, status `BUILDING_RUNTIME`), starts the container (`init_container`), waits until `/alive` responds, sets up the initial env, and reports `READY`. It also connects the container to any `sandbox.additional_networks`. With `attach_to_existing` and no container, it raises `AgentRuntimeDisconnectedError`.
- **Ports:** the execution server gets a host port from 30000–39999, VS Code from 40000–49999 (or `sandbox.vscode_port`), and two app ports from 50000–59999. The ranges are smaller on platforms with a lower ephemeral limit. Ports are allocated under **file-based port locks** (`runtime/utils/port_lock.py`) so concurrent conversations don't race. The app ports appear in `web_hosts` so agents can run web servers that the user can reach.
- **Networking:** port mappings bound to `runtime_binding_address`, or `network_mode=host` when `use_host_network` is set. The backend reaches the server at `sandbox.local_runtime_url:<port>`. Inside the app container that is `http://host.docker.internal`.
- **Mounts:** `SANDBOX_VOLUMES` and the workspace mount become bind mounts, with optional overlay mounts. GPU support (`enable_gpu`, `cuda_visible_devices`). `docker_runtime_kwargs` are passed through to `containers.run`.
- **Lifecycle:** `pause()` and `resume()` stop and start the container. `close()` stops this conversation's container (or every `openhands-runtime-` container when `rm_all_containers` is set) and releases its port locks. Nothing happens if `keep_runtime_alive` or `attach_to_existing` is set. `DockerRuntime.delete(conversation_id)` removes a conversation's container.
- Startup command: `python -m openhands.runtime.action_execution_server <port> --working-dir /workspace --plugins … --username openhands|root --user-id <uid>` (`runtime/utils/command.py`).

## RemoteRuntime (`impl/remote/remote_runtime.py`)

This runtime is for scale (OpenHands Cloud and evaluations). It calls a **Runtime API** at `sandbox.remote_runtime_api_url`, authenticated with `sandbox.api_key`:

1. `GET /sessions/{sid}` checks for an existing runtime. A running one is reused and a paused one is `POST /resume`d.
2. Otherwise it builds the image if `/image_exists` says it is missing, using `RemoteRuntimeBuilder`. Then it calls `POST /start` with the image, startup command, working dir, environment, `session_id`, resource factor (`remote_runtime_resource_factor`), and runtime class (for example `sysbox`).
3. It polls `GET /runtime/{runtime_id}` until the runtime is ready (`remote_runtime_init_timeout`). Action-server requests go to the returned URL with the session API key. A 503 from a paused runtime triggers a resume when `keep_runtime_alive` is set.
4. On close, it calls `/pause` if `keep_runtime_alive` and `pause_closed_runtimes` are set, and `/stop` otherwise.

## LocalRuntime (`impl/local/local_runtime.py`)

LocalRuntime runs `action_execution_server` as a **subprocess on the host**, for environments that are already sandboxed, such as when OpenHands works on itself inside a dev container. `.openhands/microagents/repo.md` recommends `RUNTIME=local` for that case. Running processes are tracked in `_RUNNING_SERVERS`. A pool of pre-started **warm servers** (`DESIRED_NUM_WARM_SERVERS`, default 0) can make conversations start faster. Without a mounted workspace it uses a temporary workspace directory. There is no isolation: commands run as the host user.

## KubernetesRuntime (`impl/kubernetes/`)

KubernetesRuntime creates one **pod**, **PVC**, and **service** per conversation, plus a VS Code service and **ingress** (optionally with TLS). It uses names derived from the `sid` and settings from `[kubernetes]` (`KubernetesConfig`: namespace, ingress domain, PVC storage class and size, resource requests and limits, node selector, tolerations, privileged mode). `connect()` attaches to an existing pod or creates the resources and waits until the pod is ready. `close()` cleans them up unless `keep_runtime_alive` is set. Local development uses kind and mirrord (`make kind`, see [Build and Deploy](../operations/build-and-deploy.md#kubernetes-dev-loop-kind)).

## CLIRuntime (`impl/cli/cli_runtime.py`)

CLIRuntime extends `Runtime` directly. It runs commands with `subprocess` in the workspace directory, streams their output to shell-stream subscribers (the CLI TUI), and does file operations with the Python standard library and `OHEditor`. It supports neither browsing nor IPython, so selecting `runtime = "cli"` disables Jupyter and browsing for all agents ([Configuration](../configuration/config-system.md#load-order-and-precedence)). It talks to MCP stdio servers directly. It is the default for the [`openhands` CLI](../interfaces/cli.md).

## `[sandbox]` configuration

`SandboxConfig` (`openhands/core/config/sandbox_config.py`), with key fields:

- **Images:** `base_container_image` (default `nikolaik/python-nodejs:python3.12-nodejs22`) or a prebuilt `runtime_container_image`. Also `runtime_extra_deps`, `runtime_extra_build_args`, `force_rebuild_runtime`, `platform`.
- **Execution:** `timeout` (120s default per action), `user_id`, `runtime_startup_env_vars`, `initialize_plugins`, `browsergym_eval_env`.
- **Networking:** `use_host_network`, `additional_networks`, `runtime_binding_address`, `local_runtime_url`, `vscode_port`.
- **Lifecycle:** `keep_runtime_alive`, `pause_closed_runtimes`, `rm_all_containers`, `close_delay`.
- **Remote:** `remote_runtime_api_url`, `api_key`, `remote_runtime_init_timeout`, `remote_runtime_api_timeout`, `remote_runtime_enable_retries`, `remote_runtime_resource_factor` (1, 2, 4, or 8), `remote_runtime_class`.
- **Other:** `volumes` (`host:container[:mode]`, comma-separated), `enable_gpu`, `cuda_visible_devices`, `docker_runtime_kwargs`, `selected_repo`, `trusted_dirs`.

## Runtime image building

`build_runtime_image(base_image, runtime_builder, …)` (`openhands/runtime/utils/runtime_build.py`) turns any base image into an OpenHands sandbox image. It renders `runtime_templates/Dockerfile.j2`, which installs micromamba/Python, Poetry dependencies, Playwright/browser (optional), and the OpenHands source distribution. Images go to `OH_RUNTIME_RUNTIME_IMAGE_REPO` (default `ghcr.io/all-hands-ai/runtime`) with three tag levels:

| Tag | Format | Meaning |
| --- | --- | --- |
| source | `oh_v<ver>_<lockhash>_<sourcehash>` | Exact dependencies **and** exact source |
| lock | `oh_v<ver>_<lockhash>` | Same base image and dependency lock files (`pyproject.toml`, `poetry.lock`) |
| versioned | `oh_v<ver>_image_<repo>_tag_<tag>` | Same base image and OpenHands version |

The build reuses as much as it can:

1. If the source-tag image exists, it is used as-is.
2. Otherwise it builds **from the lock image**, which only copies the source.
3. If there is no lock image, it builds **from the versioned image**.
4. If neither exists, it builds **from scratch**. Only scratch builds also tag the versioned image, which keeps layer stacks from growing.

Long repo names are hashed to keep tags under Docker's 128-character limit. Builders are `DockerRuntimeBuilder` (buildx with a local cache, Podman-aware) and `RemoteRuntimeBuilder` (builds through the Runtime API). The same script runs from the command line to produce `containers/runtime` for CI ([Build and Deploy](../operations/build-and-deploy.md#runtime-sandbox-image)).

## Tests

`tests/runtime/` is parametrized by `TEST_RUNTIME` and runs each test against a real runtime (`conftest.py` builds or reuses the image). `test_docker_images.py`, `test_runtime_resource.py`, `test_stress_remote_runtime.py`, and `test_port_locking_fix.py` target specific implementations. `tests/unit/runtime/` covers builders, implementation helpers, and image tag computation without Docker.

## Related pages

- [Runtime Architecture](runtime-architecture.md)
- [Configuration System](../configuration/config-system.md)
- [Build, Packaging, and Deployment](../operations/build-and-deploy.md)
- [Evaluation Harness](../evaluation/benchmarks.md): remote runtime at scale
