---
title: "Runtime Implementations"
---
## Overview

A runtime implementation decides where the agent's actions run. OpenHands ships five: Docker, local, remote, Kubernetes and the command-line runtime. Each one is a subclass of `Runtime`, and the server or the command line picks one by its configured name. The three that run an action server inside a sandbox share one HTTP client, and the command-line runtime runs actions in the host process with no server. This page lists them, says how the name maps to a class, and gives the case for each. The shared base is on [[Runtime Core]], and the in-sandbox server is on [[Action Execution Server]].

Sources: [openhands/runtime/base.py:90-127](repo://openhands/runtime/base.py#L90-L127), [openhands/runtime/impl/action_execution/action_execution_client.py:61-66](repo://openhands/runtime/impl/action_execution/action_execution_client.py#L61-L66)

## Choosing one

The configured `runtime` name is looked up in a table. `eventstream` and `docker` both map to `DockerRuntime`, and `remote`, `local`, `kubernetes` and `cli` map to their own classes. Any other name is treated as a dotted class path and loaded through `get_impl`, which is how a deployment adds a runtime of its own. An unknown name that cannot be loaded raises an error that lists the known names.

Sources: [openhands/runtime/__init__.py:14-24](repo://openhands/runtime/__init__.py#L14-L24), [openhands/runtime/__init__.py:90-103](repo://openhands/runtime/__init__.py#L90-L103)

The default is `docker`, so a fresh install runs the agent in a container. The runtime name is also what `create_runtime` passes to the factory, together with the plugins the agent asks for.

Sources: [openhands/core/config/openhands_config.py:71-71](repo://openhands/core/config/openhands_config.py#L71-L71), [openhands/core/setup.py:35-89](repo://openhands/core/setup.py#L35-L89)

## Catalogue

| Name | Class | Where actions run | Use it when |
| --- | --- | --- | --- |
| `docker` (and `eventstream`) | `DockerRuntime` | An action server in a Docker container that the runtime starts or attaches to | The default: isolation from the host |
| `local` | `LocalRuntime` | An action server started as a process on the host machine | Development, where no container is wanted |
| `remote` | `RemoteRuntime` | A runtime client started through a remote runtime API | A hosted service runs the sandboxes |
| `kubernetes` | `KubernetesRuntime` | A pod in a Kubernetes cluster, with a service, a volume claim and optional ingress | Running sandboxes in a cluster |
| `cli` | `CLIRuntime` | Shell commands run with subprocess, file operations in Python, no browser | The interactive command line on the user's own machine |

Sources: [openhands/runtime/impl/docker/docker_runtime.py:75-89](repo://openhands/runtime/impl/docker/docker_runtime.py#L75-L89), [openhands/runtime/impl/local/local_runtime.py:123-133](repo://openhands/runtime/impl/local/local_runtime.py#L123-L133), [openhands/runtime/impl/remote/remote_runtime.py:39-41](repo://openhands/runtime/impl/remote/remote_runtime.py#L39-L41), [openhands/runtime/impl/kubernetes/kubernetes_runtime.py:61-70](repo://openhands/runtime/impl/kubernetes/kubernetes_runtime.py#L61-L70), [openhands/runtime/impl/cli/cli_runtime.py:90-99](repo://openhands/runtime/impl/cli/cli_runtime.py#L90-L99)

## Docker

`DockerRuntime` subclasses the action-execution client and starts a container from the runtime image. `connect` first looks for the session's container and attaches to it. When none exists it runs `init_container`, which can build the image first and starts the container with the workspace mounted. It then waits until the server answers. Volumes are parsed from the sandbox configuration, including overlay mounts.

Sources: [openhands/runtime/impl/docker/docker_runtime.py:168-200](repo://openhands/runtime/impl/docker/docker_runtime.py#L168-L200), [openhands/runtime/impl/docker/docker_runtime.py:261-290](repo://openhands/runtime/impl/docker/docker_runtime.py#L261-L290), [openhands/runtime/impl/docker/docker_runtime.py:391-420](repo://openhands/runtime/impl/docker/docker_runtime.py#L391-L420), [openhands/runtime/impl/docker/docker_runtime.py:579-592](repo://openhands/runtime/impl/docker/docker_runtime.py#L579-L592)

The container is started with `containers.run`, and `close` removes it unless the caller keeps it. Port locks taken for the server and the VS Code view are released in `_release_port_locks` when the runtime closes.

Sources: [openhands/runtime/impl/docker/docker_runtime.py:517-530](repo://openhands/runtime/impl/docker/docker_runtime.py#L517-L530), [openhands/runtime/impl/docker/docker_runtime.py:593-620](repo://openhands/runtime/impl/docker/docker_runtime.py#L593-L620)

## Local

`LocalRuntime` runs the action server directly on the host, as a child process with its own ports. It is the one runtime without isolation, so it is meant for development. `execute_action` sends each action to the server over HTTP, after checking that the server process is still alive and reconnecting to a process it already started for the same session if it has one.

Sources: [openhands/runtime/impl/local/local_runtime.py:217-240](repo://openhands/runtime/impl/local/local_runtime.py#L217-L240), [openhands/runtime/impl/local/local_runtime.py:434-470](repo://openhands/runtime/impl/local/local_runtime.py#L434-L470)

## Remote

`RemoteRuntime` talks to a runtime API rather than to Docker. `connect` either attaches to a runtime that already exists for the session, resumes one that is paused, or builds and starts a new one. It requires `remote_runtime_api_url`; without it the constructor raises. The runtime's responses carry the URL of its action server, which the client then uses like any other.

Sources: [openhands/runtime/impl/remote/remote_runtime.py:51-107](repo://openhands/runtime/impl/remote/remote_runtime.py#L51-L107), [openhands/runtime/impl/remote/remote_runtime.py:125-175](repo://openhands/runtime/impl/remote/remote_runtime.py#L125-L175), [openhands/runtime/impl/remote/remote_runtime.py:358-374](repo://openhands/runtime/impl/remote/remote_runtime.py#L358-L374)

## Kubernetes

`KubernetesRuntime` creates a pod per session, with a service that routes to its action server, a persistent volume claim for the workspace, and an ingress and TLS secret for VS Code when that is enabled. Node selectors and tolerations come from the Kubernetes configuration. Its docstring says it targets Kind clusters.

Sources: [openhands/runtime/impl/kubernetes/kubernetes_runtime.py:61-70](repo://openhands/runtime/impl/kubernetes/kubernetes_runtime.py#L61-L70), [openhands/runtime/impl/kubernetes/kubernetes_runtime.py:154-200](repo://openhands/runtime/impl/kubernetes/kubernetes_runtime.py#L154-L200), [openhands/runtime/impl/kubernetes/kubernetes_runtime.py:219-240](repo://openhands/runtime/impl/kubernetes/kubernetes_runtime.py#L219-L240)

## Command-line

`CLIRuntime` does not use an action server at all. `run` executes shell commands with subprocess in the workspace, and `read` and `write` use the standard library. It has no browser, as its module docstring says. Its connect step only makes sure the workspace directory exists and sets the status.

Sources: [openhands/runtime/impl/cli/cli_runtime.py:1-4](repo://openhands/runtime/impl/cli/cli_runtime.py#L1-L4), [openhands/runtime/impl/cli/cli_runtime.py:168-193](repo://openhands/runtime/impl/cli/cli_runtime.py#L168-L193), [openhands/runtime/impl/cli/cli_runtime.py:432-495](repo://openhands/runtime/impl/cli/cli_runtime.py#L432-L495), [openhands/runtime/impl/cli/cli_runtime.py:525-590](repo://openhands/runtime/impl/cli/cli_runtime.py#L525-L590)
