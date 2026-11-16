---
title: "Runtime Implementations"
---
## Overview

Five runtimes are registered by name: `docker`, `local`, `remote`, `kubernetes` and `cli`. The first four start an action execution server somewhere and send it actions over HTTP, as [[Runtime Interface]] describes. The `cli` runtime runs commands itself, without a server. The top-level `runtime` setting names the one used, and `docker` is the default.

Sources: [openhands/runtime/__init__.py:14-21](repo://openhands/runtime/__init__.py#L14-L21), [openhands/core/config/openhands_config.py:71](repo://openhands/core/config/openhands_config.py#L71)

`get_runtime_cls` returns the registered class for a name. A name that is not registered is resolved as an import path to a `Runtime` subclass, so a custom runtime can be selected without changing this package. An unknown name that cannot be imported raises `ValueError` with the known names.

Sources: [openhands/runtime/__init__.py:90-111](repo://openhands/runtime/__init__.py#L90-L111)

## Docker

`DockerRuntime` starts a container from the runtime image on the local Docker daemon. Its docstring says it subscribes to the event stream and forwards each event to the client inside the container. It builds the runtime image when needed, and its `connect` attaches to the container, then waits for `/alive`.

Sources: [openhands/runtime/impl/docker/docker_runtime.py:75-90](repo://openhands/runtime/impl/docker/docker_runtime.py#L75-L90), [openhands/runtime/impl/docker/docker_runtime.py:170-201](repo://openhands/runtime/impl/docker/docker_runtime.py#L170-L201), [openhands/runtime/impl/docker/docker_runtime.py:579-592](repo://openhands/runtime/impl/docker/docker_runtime.py#L579-L592)

`init_container` starts the container, and the runtime maps the configured volumes and picks free host ports for it. `pause` stops the container and `resume` starts it again, so the container keeps its environment.

Sources: [openhands/runtime/impl/docker/docker_runtime.py:391-400](repo://openhands/runtime/impl/docker/docker_runtime.py#L391-L400), [openhands/runtime/impl/docker/docker_runtime.py:261-270](repo://openhands/runtime/impl/docker/docker_runtime.py#L261-L270), [openhands/runtime/impl/docker/docker_runtime.py:643-650](repo://openhands/runtime/impl/docker/docker_runtime.py#L643-L650), [openhands/runtime/impl/docker/docker_runtime.py:716-743](repo://openhands/runtime/impl/docker/docker_runtime.py#L716-L743)

## Local

`LocalRuntime` runs the action execution server directly on the host, with no container. Its docstring says it sends each event to that server over HTTP. The server is a subprocess that the runtime holds.

Sources: [openhands/runtime/impl/local/local_runtime.py:123-133](repo://openhands/runtime/impl/local/local_runtime.py#L123-L133), [openhands/runtime/impl/local/local_runtime.py:179](repo://openhands/runtime/impl/local/local_runtime.py#L179)

Because the server runs on the host, the container isolation of the Docker runtime does not apply here. The security checks in [[Security and Confirmation]] still apply to the actions this runtime receives.

Sources: [openhands/runtime/impl/local/local_runtime.py:123-133](repo://openhands/runtime/impl/local/local_runtime.py#L123-L133)

## Remote

`RemoteRuntime` runs the action execution server on a remote host, through a runtime service. Its docstring says it connects to a remote `oh-runtime-client`. It uses port 60000 by default. Its `connect` prepares a request for the service's `/start` endpoint, and the URL in the reply becomes the runtime URL that the HTTP client uses.

Sources: [openhands/runtime/impl/remote/remote_runtime.py:39-50](repo://openhands/runtime/impl/remote/remote_runtime.py#L39-L50), [openhands/runtime/impl/remote/remote_runtime.py:125-133](repo://openhands/runtime/impl/remote/remote_runtime.py#L125-L133), [openhands/runtime/impl/remote/remote_runtime.py:271-290](repo://openhands/runtime/impl/remote/remote_runtime.py#L271-L290), [openhands/runtime/impl/remote/remote_runtime.py:355-361](repo://openhands/runtime/impl/remote/remote_runtime.py#L355-L361)

## Kubernetes

`KubernetesRuntime` creates a pod that runs the action execution server, and its docstring says it works with Kind. Its pod image comes from the runtime image setting in the sandbox config. It can attach to an existing pod when `attach_to_existing` is set.

Sources: [openhands/runtime/impl/kubernetes/kubernetes_runtime.py:61-74](repo://openhands/runtime/impl/kubernetes/kubernetes_runtime.py#L61-L74), [openhands/runtime/impl/kubernetes/kubernetes_runtime.py:128](repo://openhands/runtime/impl/kubernetes/kubernetes_runtime.py#L128)

## CLI

`CLIRuntime` derives from `Runtime`, not from `ActionExecutionClient`, so it has no server. Its docstring says it runs commands with a subprocess and does file operations with the standard library. It does not implement browsing.

Sources: [openhands/runtime/impl/cli/cli_runtime.py:90-100](repo://openhands/runtime/impl/cli/cli_runtime.py#L90-L100)

The terminal program selects this runtime itself. Unless the CLI defaults are overridden, it sets the runtime to `cli`, makes confirmation mode on, uses the LLM security analyzer, and marks the agent as running in CLI mode. The confirmation step is then handled by the terminal rather than by the runtime, as [[Security and Confirmation]] describes.

Sources: [openhands/cli/main.py:664-680](repo://openhands/cli/main.py#L664-L680)
