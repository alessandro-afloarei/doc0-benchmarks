---
type: "Reference"
title: "Deployment, Containers, and Build"
openwiki_generated: true
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:30:54.023Z
sources:
  - id: openwiki-source-0edfe5777fd02caaff32c8a8
    resource: repo://.github/workflows/ghcr-build.yml
  - id: openwiki-source-916ca2c9930fbd525c5b718f
    resource: repo://.github/workflows/pypi-release.yml
  - id: openwiki-source-78ec4e3f6fcd64012fc1f029
    resource: repo://containers/app/Dockerfile
  - id: openwiki-source-c554f23202451dc6bd47c8a8
    resource: repo://containers/app/entrypoint.sh
  - id: openwiki-source-b79fbbd921df689b4bbdc82f
    resource: repo://docker-compose.yml
  - id: openwiki-source-bbc6de1f2d2625a294d4009b
    resource: repo://openhands/runtime/builder/docker.py
generated: { by: "claude-code", at: "2026-11-16T18:30:54.023Z" }
---


# Deployment, Containers, and Build

OpenHands ships in three forms: a Python package (`openhands-ai` on PyPI, built by Poetry), an application container image that serves the backend and the built frontend, and a **runtime image** that is the sandbox in which the agent's commands run. This page covers how each is built and started, and which files control them.

## Python package

<!-- openwiki: broken internal link [/openwiki/workflows/cli-and-headless.md] link "/openwiki/workflows/cli-and-headless.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`pyproject.toml` defines the `openhands-ai` package with Poetry. Its `build` hook (`build_vscode.py`) packs the VS Code extension into the wheel, and `build.sh` runs `poetry build -v`. The console script `openhands` points to `openhands.cli.entry:main` (see [CLI and Headless Execution](/openwiki/workflows/cli-and-headless.md)). `poetry.lock` pins dependencies.

The version is the single source of truth for the pieces that must match. `.github/scripts/check_version_consistency.py` scans the repository for `openhands:<major>.<minor>` and `runtime:<major>.<minor>` references and reports when they disagree, so the application and runtime image tags stay in step with the package.

## Application image

`containers/app/Dockerfile` builds the application image in stages:

1. A Node 24 stage builds the frontend.
2. A Python 3.12 base stage installs the backend, using a separate builder stage for the Python dependencies.
3. The `openhands-app` stage places the backend and the built frontend under `/app`, creates the file-store directory, and sets defaults. Among them: `FILE_STORE=local`, `FILE_STORE_PATH=/.openhands`, `WORKSPACE_BASE=/opt/workspace_base`, `RUN_AS_OPENHANDS=true`, `SANDBOX_LOCAL_RUNTIME_URL=http://host.docker.internal`, and `INIT_GIT_IN_EMPTY_WORKSPACE=1`.

The container's entrypoint is `containers/app/entrypoint.sh`. It must run as root and requires `SANDBOX_USER_ID` to be set, then performs its setup before starting the server command. Setting `NO_SETUP=true` skips that setup and runs the command directly. The default command is `uvicorn openhands.server.listen:app --host 0.0.0.0 --port 3000`.

`containers/build.sh` builds and optionally pushes the image with Docker Buildx for multiple platforms. Its `--dry` option writes the build arguments without building. Tags come from `DOCKER_IMAGE_SOURCE_TAG` and `DOCKER_IMAGE_TAG`, and it uses a build cache under the `buildcache` tag base.

## docker-compose

`docker-compose.yml` runs the application image as the `openhands` service:

- It builds from `containers/app/Dockerfile` and tags the image `openhands:latest`.
- Port `3000` is published.
- `SANDBOX_RUNTIME_CONTAINER_IMAGE` defaults to the published runtime image, and `WORKSPACE_MOUNT_PATH` points at the workspace directory.
- It mounts the host Docker socket (`/var/run/docker.sock`), so the application can start sandbox containers, and mounts `~/.openhands` for persisted state and the workspace directory.
- `host.docker.internal` is mapped to the host gateway so sandboxes can reach services on the host.

<!-- openwiki: broken internal link [/openwiki/architecture/runtime-sandbox.md] link "/openwiki/architecture/runtime-sandbox.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Because the container can create other containers through the Docker socket, the compose file gives the application container control of the host's Docker daemon. This is the default development and single-user arrangement; it should not be exposed to untrusted users without the isolation measures in [Runtime and Sandbox Execution](/openwiki/architecture/runtime-sandbox.md).

## Runtime (sandbox) image

The sandbox image is built from `containers/runtime/`, which is produced by `openhands/runtime/utils/runtime_build.py`. The script generates a `Dockerfile` for a base image (`nikolaik/python-nodejs` by default), writes an updated `config.sh`, and copies the runtime source distribution into the build folder. `containers/runtime/config.sh` names the registry (`ghcr.io`), organization, and image (`runtime`).

<!-- openwiki: broken internal link [/openwiki/architecture/configuration.md] link "/openwiki/architecture/configuration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
At run time the Docker runtime decides whether to build or pull the image. `openhands/runtime/builder/docker.py` provides `DockerRuntimeBuilder`. Its `build` (~L51) uses Docker Buildx and an optional local cache, `image_exists` (~L251) checks for an existing image and can pull it, and `_prune_old_cache_files` (~L371) removes cache entries older than seven days. The `sandbox.force_rebuild_runtime` and `sandbox.runtime_container_image` settings control which image is used (see [Configuration Model](/openwiki/architecture/configuration.md)).

## Development container

`containers/dev/` provides a development environment: a Dockerfile, a `compose.yml` with a `dev` service tagged `openhands:dev`, a `cache-data` volume, and `dev.sh`. The Makefile target `docker-dev` starts it. The `.devcontainer/` directory provides a VS Code devcontainer that runs `setup.sh`.

## Makefile targets

The top-level `Makefile` is the main developer entry point:

- `build` (~L25) installs the project dependencies (for example `poetry install --with dev,test,runtime`, ~L155).
<!-- openwiki: broken internal link [/openwiki/operations/development-and-testing.md] link "/openwiki/operations/development-and-testing.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- `install-pre-commit-hooks` (~L185) installs the git hooks described in [Development, Testing, and Quality Gates](/openwiki/operations/development-and-testing.md).
- `run` (~L279) runs the application locally.
- `docker-run` (~L287) runs the application image interactively. It prompts for the workspace directory, the LLM model, and the API key, and then starts the container.
- `docker-dev` (~L338) starts the development container.

## Kubernetes samples

`kind/` contains a kind cluster definition (`cluster.yaml`) and manifests in `kind/manifests/` (`deployment.yaml`, `service.yaml`, `nginx.yaml`, `role.yaml`, and `roleBinding.yaml`). The deployment manifest defines a single-replica Ubuntu 22.04 development pod named `ubuntu-dev`, with a role and binding for it. The Kubernetes runtime implementation is in `openhands/runtime/impl/kubernetes/` (its README is in that directory) and is configured through the `[kubernetes]` configuration section.

## Enterprise image

<!-- openwiki: broken internal link [/openwiki/enterprise/saas-platform.md] link "/openwiki/enterprise/saas-platform.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`enterprise/Dockerfile` builds the hosted image on top of a published OpenHands image (`FROM ${BASE}:${OPENHANDS_VERSION}`). Its command is `uvicorn saas_server:app --host 0.0.0.0 --port 3000`, so it serves the enterprise entry point described in [Enterprise SaaS Platform](/openwiki/enterprise/saas-platform.md).

## CI and release workflows

- `.github/workflows/ghcr-build.yml` builds and publishes the Docker images. It runs on pushes to `main`, on tags, on pull requests, and on manual dispatch.
- `.github/workflows/pypi-release.yml` publishes the Python package to PyPI and is triggered manually with a reason.
- `.github/workflows/npm-publish-ui.yml` publishes `@openhands/ui`, and `ui-build.yml` builds it.
- `.github/workflows/vscode-extension-build.yml` builds the VS Code extension.
- `.github/workflows/dispatch-to-docs.yml` and `.github/workflows/enterprise-preview.yml` are also present; their behavior is not described here.

## Invariants and failure behavior

- The application and runtime images must agree on version, which the consistency check enforces.
- The application image runs its setup as root and then drops privileges. A non-root start without `NO_SETUP` fails with a clear message.
- A runtime image that is missing is either built locally or pulled; cache entries older than seven days are pruned.

## Operational notes

- Persisted state lives under `~/.openhands` on the host, mounted into the container at `/.openhands`.
- The Docker socket mount gives the application full control of the host's Docker daemon.
- The workspace is mounted at `/opt/workspace_base` and used as the base for sandbox workspaces.

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/configuration.md] link "/openwiki/architecture/configuration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Configuration Model](/openwiki/architecture/configuration.md)
<!-- openwiki: broken internal link [/openwiki/architecture/runtime-sandbox.md] link "/openwiki/architecture/runtime-sandbox.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Runtime and Sandbox Execution](/openwiki/architecture/runtime-sandbox.md)
<!-- openwiki: broken internal link [/openwiki/operations/development-and-testing.md] link "/openwiki/operations/development-and-testing.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Development, Testing, and Quality Gates](/openwiki/operations/development-and-testing.md)
<!-- openwiki: broken internal link [/openwiki/enterprise/saas-platform.md] link "/openwiki/enterprise/saas-platform.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Enterprise SaaS Platform](/openwiki/enterprise/saas-platform.md)
