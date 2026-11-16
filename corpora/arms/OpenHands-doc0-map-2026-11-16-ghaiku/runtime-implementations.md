---
title: "Runtime Implementations"
---
## Overview

Each runtime class decides where the action execution server runs and how that server is reached. Four of them extend `ActionExecutionClient` and send every action over HTTP to that server: Docker, Kubernetes, remote and local. The CLI runtime is different: it runs commands in-process with `subprocess` and does not use the server at all. The choice is made in configuration, and the rest of the runtime code is the same for all of them. The protocol is described in [[Runtime and Action Execution]].

Sources: [openhands/runtime/impl/docker/docker_runtime.py:75-80](repo://openhands/runtime/impl/docker/docker_runtime.py#L75-L80) [openhands/runtime/impl/kubernetes/kubernetes_runtime.py:61-70](repo://openhands/runtime/impl/kubernetes/kubernetes_runtime.py#L61-L70) [openhands/runtime/impl/remote/remote_runtime.py:39-44](repo://openhands/runtime/impl/remote/remote_runtime.py#L39-L44) [openhands/runtime/impl/local/local_runtime.py:123-132](repo://openhands/runtime/impl/local/local_runtime.py#L123-L132) [openhands/runtime/impl/cli/cli_runtime.py:90-100](repo://openhands/runtime/impl/cli/cli_runtime.py#L90-L100)

## Selecting a runtime

The `runtime` field of `OpenHandsConfig` names the runtime and defaults to `docker`. `get_runtime_cls` first looks the name up in the built-in table, where `eventstream` is an alias for Docker. A name that is not in the table is resolved as a dotted import path to a `Runtime` subclass, so a third-party runtime can be used without changing this package. An unknown name raises a `ValueError` that lists the known names.

Sources: [openhands/core/config/openhands_config.py:71-71](repo://openhands/core/config/openhands_config.py#L71-L71) [openhands/runtime/__init__.py:90-103](repo://openhands/runtime/__init__.py#L90-L103)

| Name | Class | Page section |
| --- | --- | --- |
| `docker`, `eventstream` | `DockerRuntime` | Containers |
| `kubernetes` | `KubernetesRuntime` | Containers |
| `remote` | `RemoteRuntime` | Remote API |
| `local` | `LocalRuntime` | On the host |
| `cli` | `CLIRuntime` | On the host |

Sources: [openhands/core/config/openhands_config.py:71-71](repo://openhands/core/config/openhands_config.py#L71-L71) [openhands/runtime/__init__.py:14-21](repo://openhands/runtime/__init__.py#L14-L21) [openhands/runtime/__init__.py:90-103](repo://openhands/runtime/__init__.py#L90-L103)

## Containers

`DockerRuntime` creates the sandbox container with the Docker SDK: it runs the configured runtime image through `containers.run`, after resolving overlay mounts. Its Docker client is created in the constructor. It is the default runtime.

Sources: [openhands/runtime/impl/docker/docker_runtime.py:131-131](repo://openhands/runtime/impl/docker/docker_runtime.py#L131-L131) [openhands/runtime/impl/docker/docker_runtime.py:254-254](repo://openhands/runtime/impl/docker/docker_runtime.py#L254-L254) [openhands/runtime/impl/docker/docker_runtime.py:512-520](repo://openhands/runtime/impl/docker/docker_runtime.py#L512-L520)

`KubernetesRuntime` builds a pod specification and creates the pod in the cluster. Its docstring says it works with Kind.

Sources: [openhands/runtime/impl/kubernetes/kubernetes_runtime.py:61-70](repo://openhands/runtime/impl/kubernetes/kubernetes_runtime.py#L61-L70) [openhands/runtime/impl/kubernetes/kubernetes_runtime.py:553-560](repo://openhands/runtime/impl/kubernetes/kubernetes_runtime.py#L553-L560)

## Remote API

`RemoteRuntime` connects to a runtime API over HTTP instead of starting anything locally. On connect it checks for an existing runtime, then starts or attaches to one through the API. The API's `/start` and `/resume` endpoints are called from that path, and the connect step waits until the sandbox answers.

Sources: [openhands/runtime/impl/remote/remote_runtime.py:125-134](repo://openhands/runtime/impl/remote/remote_runtime.py#L125-L134) [openhands/runtime/impl/remote/remote_runtime.py:270-304](repo://openhands/runtime/impl/remote/remote_runtime.py#L270-L304) [openhands/runtime/impl/remote/remote_runtime.py:306-322](repo://openhands/runtime/impl/remote/remote_runtime.py#L306-L322) [openhands/runtime/impl/remote/remote_runtime.py:403-416](repo://openhands/runtime/impl/remote/remote_runtime.py#L403-L416)

## On the host

`LocalRuntime` runs the action execution server directly on the machine without Docker, as a subprocess it keeps in a module-level table keyed by session id. A second connection for the same session attaches to the running server instead of starting another. Its docstring says it sends each event to the server over HTTP.

Sources: [openhands/runtime/impl/local/local_runtime.py:1-1](repo://openhands/runtime/impl/local/local_runtime.py#L1-L1) [openhands/runtime/impl/local/local_runtime.py:123-132](repo://openhands/runtime/impl/local/local_runtime.py#L123-L132) [openhands/runtime/impl/local/local_runtime.py:217-226](repo://openhands/runtime/impl/local/local_runtime.py#L217-L226)

`CLIRuntime` runs commands with `subprocess` and does file operations with the standard library. Its docstring says it does not implement browser actions.

Sources: [openhands/runtime/impl/cli/cli_runtime.py:90-100](repo://openhands/runtime/impl/cli/cli_runtime.py#L90-L100)
