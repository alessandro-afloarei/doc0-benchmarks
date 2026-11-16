---
type: operations
title: Build, Containers and Development Workflow
description: How to set up, build and run OpenHands from source (Makefile, Poetry, npm), how the app and runtime Docker images are built and tagged, docker-compose, lint tooling, and what each GitHub Actions workflow does.
tags: [build, docker, makefile, poetry, ci, release, development]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:38:52.407Z
sources:
  - id: openwiki-source-0edfe5777fd02caaff32c8a8
    resource: repo://.github/workflows/ghcr-build.yml
  - id: openwiki-source-6d4b4e707b8d60b6ccfa3425
    resource: repo://.github/workflows/openwiki-update.yml
  - id: openwiki-source-78ec4e3f6fcd64012fc1f029
    resource: repo://containers/app/Dockerfile
  - id: openwiki-source-c554f23202451dc6bd47c8a8
    resource: repo://containers/app/entrypoint.sh
  - id: openwiki-source-b79fbbd921df689b4bbdc82f
    resource: repo://docker-compose.yml
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-1526c13fed87a2dc10ce6868
    resource: repo://openhands/runtime/utils/runtime_build.py
  - id: openwiki-source-2422313521a0e34c7ebf9206
    resource: repo://openhands/runtime/utils/runtime_templates/Dockerfile.j2
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
generated: { by: "claude-code", at: "2026-11-16T09:38:52.407Z" }
---

# Build, Containers and Development Workflow

## Source layout for builds

- **Python package** `openhands-ai` (version 0.56.0 in `pyproject.toml`), built with Poetry (`poetry-core`), Python `^3.12,<3.14`. Packages included: `openhands/**`, `third_party/**`, and `microagents/**`, plus the bundled VS Code extension `.vsix`; `build_vscode.py` runs during the Poetry build to produce that extension. The console script `openhands = openhands.cli.entry:main` is what `uvx --from openhands-ai openhands` runs ([CLI](../clients/cli.md)).
- **Frontend** in `frontend/` (npm, Node ≥ 22; see [Frontend](../clients/frontend.md)); **UI library** in `openhands-ui/` (bun); **enterprise** has its own `pyproject.toml` and Dockerfile ([Enterprise](../enterprise/enterprise-saas.md)).
- Dev tooling configs: `dev_config/python/ruff.toml`, `mypy.ini` and `.pre-commit-config.yaml` (pre-commit hooks, ruff check + format, mypy on `openhands/`), `.devcontainer/`, `.vscode/`, `kind/` (local Kubernetes manifests).

## Makefile (local development)

Run `make help` for the full list. Key targets:

| Target | What it does |
|---|---|
| `make build` | `check-dependencies` (system, Python 3.12, npm, Node, Docker unless `INSTALL_DOCKER` set, Poetry, tmux) → `install-python-dependencies` → `install-frontend-dependencies` → pre-commit hooks → `build-frontend`. |
| `make run` | Starts the backend (`poetry run uvicorn openhands.server.listen:app` on `BACKEND_HOST:BACKEND_PORT`, default 127.0.0.1:3000), waits for the port, then starts the Vite dev server (default port 3001; uses `dev_wsl` under WSL). Windows is not supported (use WSL). |
| `make start-backend` / `start-frontend` | Run one side only; the backend uses `--reload` and excludes `./workspace`. |
| `make docker-run` | `docker compose up` with `WORKSPACE_BASE`, `SANDBOX_USER_ID` and a timestamp exported; no-ops inside a container. |
| `make lint` / `lint-backend` / `lint-frontend` | pre-commit on all files / `npm run lint`. |
| `make test` | Currently runs the frontend tests (`test-frontend`); backend tests are run with pytest directly ([Testing](testing-and-evaluation.md)). |
| `make setup-config` / `setup-config-basic` | Interactive or minimal `config.toml` creation ([Configuration](../configuration/configuration.md)). |
| `make kind` | Create a local `kind` cluster plus mirrord resources and run `make run` inside mirrord for Kubernetes-runtime development. |
| `make docker-dev`, `openhands-cloud-run`, `clean` | Build and run the app in Docker via `containers/dev/dev.sh`, a cloud run helper, and cleanup. |

`Development.md` is the contributor guide (prerequisites, the commands above, and notes on the runtime).

## Docker images

Two images are produced and pushed to `ghcr.io` / `docker.all-hands.dev` by `.github/workflows/ghcr-build.yml`:

1. **App image** — `containers/app/Dockerfile`, multi-stage: a Node 24 stage builds the frontend (`npm ci && npm run build`), a Python 3.12 stage installs Poetry dependencies into a venv, and the final stage creates a non-root `openhands` user (UID 42420, sudo-enabled), copies `microagents`, `openhands`, the plugin sources and `frontend/build`, and sets defaults: `FILE_STORE=local`, `FILE_STORE_PATH=/.openhands`, `SANDBOX_LOCAL_RUNTIME_URL=http://host.docker.internal`, `INIT_GIT_IN_EMPTY_WORKSPACE=1`, `WORKSPACE_BASE=/opt/workspace_base`. `containers/app/entrypoint.sh` must run as root and requires `SANDBOX_USER_ID` (unless `NO_SETUP=true`); it unsets `WORKSPACE_BASE` when no workspace is mounted, can install optional third-party runtimes, then runs the server either as root (`SANDBOX_USER_ID=0`, setting `RUN_AS_OPENHANDS=false`) or as a created `enduser` with that UID, added to the Docker socket's group so it can start sandbox containers.
2. **Runtime (sandbox) image** — the image that runs the action execution server for the Docker runtime. It is generated from `openhands/runtime/utils/runtime_templates/Dockerfile.j2` on top of a **base image** (`nikolaik/python-nodejs:python3.12-nodejs22` → tag suffix `-nikolaik`, or `ubuntu:24.04` → `-ubuntu`); the template installs system tools (git, tmux, ripgrep, Node, Python 3.12), micromamba, Poetry, Playwright/Chromium (unless browsing is disabled) and OpenVSCode Server. `containers/runtime/` documents the config.

### Runtime image build and tagging (`runtime_build.py`)

`build_runtime_image` prepares a build folder (Dockerfile + the `openhands` source and lock files) and, unless `dry_run`, builds it with a `RuntimeBuilder` (`DockerRuntimeBuilder` locally, a remote builder for `RemoteRuntime`). Images get **three tag levels** so rebuilds are cheap: a versioned tag derived from the base image name, a **lock-file hash tag** (MD5 of base image, `pyproject.toml`, `poetry.lock`, and `enable_browser` when false) and a **source hash tag** (dirhash of `openhands/` ignoring hidden dirs and bytecode). If the exact source-hash image exists it is reused; otherwise the build starts from an existing lock-hash image (only source layers change), else from the existing versioned image, else from scratch (the versioned tag is only applied on scratch builds, to avoid stacking layers); `force_rebuild_runtime` forces a from-scratch rebuild. `SANDBOX_RUNTIME_CONTAINER_IMAGE` bypasses building entirely, which is what the app image and `openhands serve` do. See [Runtime](../runtime/runtime-and-sandbox.md).

`containers/build.sh -i <image> [-o org] [--push] [--load] [-t suffix] [--dry]` wraps `docker buildx`, computing tags from `RELEVANT_SHA`, `GITHUB_REF_NAME` (semver refs additionally get major and major.minor tags) and a build cache tag.

### docker-compose

`docker-compose.yml` runs the app image on port 3000 with the Docker socket mounted (so the app can start sandbox containers), `~/.openhands` mounted at `/.openhands`, the workspace mounted at `/opt/workspace_base`, `host.docker.internal` mapped, and `SANDBOX_RUNTIME_CONTAINER_IMAGE` defaulting to the matching `runtime:<version>-nikolaik` image.

## CI/CD workflows (`.github/workflows/`)

| Workflow | Purpose |
|---|---|
| `py-tests.yml` | Python unit tests on PRs/pushes (Docker Buildx set up for runtime tests). |
| `fe-unit-tests.yml`, `e2e-tests.yml` | Frontend vitest; Playwright e2e (PRs labeled `end-to-end` or manual). |
| `lint.yml`, `lint-fix.yml`, `mdx-lint.yml` | Frontend and Python lint; auto-fix; docs MDX lint. |
| `ghcr-build.yml` | Build/test/push app and runtime images for `nikolaik` and `ubuntu` bases on `main`, tags and PRs. |
| `pypi-release.yml` | Publish the `openhands-ai` package (manual dispatch / release). |
| `npm-publish-ui.yml`, `ui-build.yml`, `vscode-extension-build.yml` | UI library and VS Code extension builds/publish. |
| `enterprise-preview.yml` | Preview images for the enterprise server. |
| `run-eval.yml`, `integration-runner.yml` | Evaluation runs on labeled PRs, releases or manually; integration tests ([Evaluation](testing-and-evaluation.md)). |
| `openhands-resolver.yml` | Issue-resolver action ([Resolver](../workflows/issue-resolver.md)). |
| `dispatch-to-docs.yml`, `clean-up.yml`, `stale.yml`, `welcome-good-first-issue.yml` | Docs sync, cleanup and repo hygiene. |
| `openwiki-update.yml` | Scheduled (daily) and manual refresh of the generated `openwiki/` pages. |

Related: [Runtime](../runtime/runtime-and-sandbox.md), [Testing and evaluation](testing-and-evaluation.md), [Overview](../architecture/overview.md).
