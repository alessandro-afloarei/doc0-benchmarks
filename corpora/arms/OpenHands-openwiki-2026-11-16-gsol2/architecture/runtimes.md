---
type: architecture
title: Execution runtimes and workspaces
description: Runtime selection, workspace bootstrap, action transport and error reporting across Docker, local and remote execution environments.
tags: [runtime, docker, workspace, execution]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:55:05.802Z
sources:
  - id: openwiki-source-f38350b0cd074145e71451f8
    resource: repo://openhands/runtime/base.py
  - id: openwiki-source-8aa44ffeca89d68fc256f906
    resource: repo://openhands/runtime/impl/action_execution/action_execution_client.py
  - id: openwiki-source-a93fe2478f100d6d83bde21d
    resource: repo://openhands/runtime/impl/docker/docker_runtime.py
generated: { by: "codex", at: "2026-11-16T16:55:05.802Z" }
---

# Execution runtimes and workspaces

## Responsibility and selection

The runtime executes actions and owns access to workspace files, shells, browser sessions and runtime plugins. The controller decides when to act; the runtime produces the resulting observation. `get_runtime_cls` maps `docker` and the historical `eventstream` alias to `DockerRuntime`, alongside remote, local, Kubernetes and CLI implementations. It discovers optional third-party runtimes and can resolve a custom `Runtime` implementation by import path. Missing optional dependencies do not prevent loading the core runtime registry.

`LocalRuntime` launches the action execution server directly on the host. Docker runs it inside a container. Choose a backend with awareness of where commands and mounts execute: a local workspace has the host process's permissions, while Docker additionally depends on daemon access, image availability and mount translation.

## Action path

1. The runtime subscribes to the event stream. Its action handler supplies a default timeout, refreshes referenced provider tokens, and routes MCP actions to the MCP path or other actions through `run_action`.
2. Base dispatch handles non-runnable special cases, suppresses actions awaiting confirmation, validates the action type and returns a rejection observation for rejected actions. Implementations provide command, file, browser and notebook operations.
3. `ActionExecutionClient` serializes execution behind a semaphore and posts an action to `/execute_action`. Its HTTP deadline allows five seconds beyond the action timeout. A transport timeout becomes `AgentRuntimeTimeoutError`.
4. The execution server deserializes and executes the action, then serializes the observation. The runtime attaches the originating action ID as `cause` and preserves tool-call metadata before publishing the result.

Permission failures become `ErrorObservation` feedback. Network/disconnected-runtime failures and other unexpected exceptions instead set runtime error status and return without a normal result observation. This distinction matters when investigating a controller waiting on a pending action.

## Connection and workspace lifecycle

Docker connection first attempts to attach to the named container. If it is absent and this is an attach-only request, connection fails; a fresh request may build an image and initialize a container. Startup waits for the execution server to become alive, sets the initial environment for a fresh runtime and reports readiness. A configured runtime image bypasses building from a base image; otherwise a base image is required.

Repository setup uses the provider handler to obtain an authenticated Git URL, clones into a directory named after the repository, and checks out the selected branch or creates a random workspace branch. With no selected repository, configuration controls whether to initialize an empty Git repository. `.openhands/setup.sh`, when present, runs as a hidden setup action with a 600-second timeout. These scripts are executable repository behavior and can alter the environment.

Runtime lifetime and history lifetime differ. Docker's keep-alive setting affects whether close stops its container; event persistence does not preserve arbitrary container state. Browser, Jupyter and VS Code support also depend on installed plugins and runtime image contents.

## Implementation and verification

The actual execution server is [action_execution_server.py](../../openhands/runtime/action_execution_server.py). Trace it with [base.py](../../openhands/runtime/base.py), [action_execution_client.py](../../openhands/runtime/impl/action_execution/action_execution_client.py) and [docker_runtime.py](../../openhands/runtime/impl/docker/docker_runtime.py). Focused tests cover Docker cleanup/mounts, local startup, Git hooks/tokens and runtime import robustness under `tests/unit/runtime/`; executable environment checks live in `tests/runtime/`.

Continue with [agent control](../concepts/agent-loop.md), [MCP and Git](../integrations/tools-and-git.md), [deployment](../operations/configuration-and-deployment.md) or the [quickstart](../quickstart.md).
