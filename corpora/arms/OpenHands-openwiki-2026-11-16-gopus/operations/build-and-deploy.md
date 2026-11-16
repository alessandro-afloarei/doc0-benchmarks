---
type: operations
title: Build, Packaging, and Deployment
description: How OpenHands is built, run locally, packaged and released — Makefile targets, Poetry packaging with the bundled VS Code extension, the app/runtime/dev container images and their build script, docker-compose, the kind/Kubernetes dev loop, and the GitHub Actions workflows for images, releases, linting, and automation.
tags: [build, makefile, docker, packaging, ci, release, kubernetes]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:35:38.671Z
sources:
  - id: openwiki-source-0edfe5777fd02caaff32c8a8
    resource: repo://.github/workflows/ghcr-build.yml
  - id: openwiki-source-916ca2c9930fbd525c5b718f
    resource: repo://.github/workflows/pypi-release.yml
  - id: openwiki-source-9f1ffbc02a4f9ef74f2d8ea3
    resource: repo://build_vscode.py
  - id: openwiki-source-78ec4e3f6fcd64012fc1f029
    resource: repo://containers/app/Dockerfile
  - id: openwiki-source-c554f23202451dc6bd47c8a8
    resource: repo://containers/app/entrypoint.sh
  - id: openwiki-source-5407bff495e92f05d61a6617
    resource: repo://containers/build.sh
  - id: openwiki-source-9aeace746b780a904f2ff8a3
    resource: repo://containers/runtime/config.sh
  - id: openwiki-source-b7b5a71730f9e05b52bb672c
    resource: repo://containers/runtime/README.md
  - id: openwiki-source-b79fbbd921df689b4bbdc82f
    resource: repo://docker-compose.yml
  - id: openwiki-source-7fcc785ba685a33e431c32f4
    resource: repo://kind/cluster.yaml
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
generated: { by: "claude-code", at: "2026-11-16T07:35:38.671Z" }
---

# Build, Packaging, and Deployment

## Local development (`Makefile`)

| Target | What it does |
| --- | --- |
| `make build` | Check system dependencies (Python 3.12, Node.js, npm, Docker, Poetry, tmux), `poetry install --with dev,test,runtime` (or only `POETRY_GROUP`), install Playwright Chromium (skip with `INSTALL_PLAYWRIGHT=false`), install frontend dependencies, install pre-commit hooks (`dev_config/python/.pre-commit-config.yaml`) |
| `make run` | Start the backend (`uvicorn openhands.server.listen:app` on `BACKEND_HOST:BACKEND_PORT`, default `127.0.0.1:3000`), wait for it, then start the Vite frontend (default port 3001). Windows is rejected; use WSL. |
| `make start-backend` / `make start-frontend` | Run each half separately (backend with `--reload`; frontend uses `dev_wsl` under WSL) |
| `make build-frontend` | `npm run build` into `frontend/build` (served by the backend at `/`) |
| `make setup-config` | Interactive prompts that write `config.toml` (workspace, model, API key, base URL) |
| `make lint`, `lint-backend`, `lint-frontend` | pre-commit hooks (ruff, mypy, etc.) and frontend ESLint/Prettier/typecheck |
| `make test` | Frontend unit tests (Python tests run with `poetry run pytest`; see [Testing Guide](../testing/testing-guide.md)) |
| `make docker-run` | `docker compose up` with `WORKSPACE_BASE` and `SANDBOX_USER_ID` set |
| `make docker-dev` | Develop inside the `containers/dev` image (unofficial) |
| `make kind` | Kubernetes dev loop (below) |
| `make openhands-cloud-run` | `make run` bound to `0.0.0.0:12000/12001` |

The repository's own microagent `.openhands/microagents/repo.md` gives agents the same build, run, and lint instructions, e.g. `RUNTIME=local make build && make run`.

## Python packaging

- Poetry project `openhands-ai` (`pyproject.toml`, Python `^3.12,<3.14`) packages `openhands/**`, `third_party/**`, and `microagents/**`, plus a bundled VS Code extension (`openhands/integrations/vscode/openhands-vscode-0.0.1.vsix`). The console script is `openhands = "openhands.cli.entry:main"` ([CLI](../interfaces/cli.md)).
- `build_vscode.py` is Poetry's build hook. It builds the `.vsix` with Node.js 18 or later and skips the build when `SKIP_VSCODE_BUILD` is set or Node is unavailable.
- `build.sh` runs `poetry build -v`. `.github/workflows/pypi-release.yml` (manual dispatch) builds and `poetry publish`es to PyPI.
- Optional groups: `dev`, `test`, `runtime`, `evaluation`, and benchmark-specific groups such as `testgeneval`. `third_party_runtimes` is an extra (E2B, Modal, Runloop, Daytona), and the app container can install it when `INSTALL_THIRD_PARTY_RUNTIMES=true`.

## Container images

`containers/build.sh -i <openhands|runtime> [-o org] [--push] [--load] [-t tag_suffix] [--dry]` wraps `docker buildx`. It reads `containers/<image>/config.sh` (registry `ghcr.io`, org `all-hands-ai`) and computes tags: git SHA, a relevant source hash, semver major/minor/`latest` for releases, the sanitized branch name, and optional suffixes. It uses registry build caches.

### App image (`containers/app/Dockerfile`)

A multi-stage build:

1. A Node 24 stage builds the frontend.
2. A Python 3.12 stage installs the Poetry environment.
3. The final stage copies the venv, `openhands/`, `microagents/`, and `frontend/build`, and creates the `openhands` user (uid 42420).

Defaults: `FILE_STORE=local`, `FILE_STORE_PATH=/.openhands`, `WORKSPACE_BASE=/opt/workspace_base`, `SANDBOX_LOCAL_RUNTIME_URL=http://host.docker.internal`, `INIT_GIT_IN_EMPTY_WORKSPACE=1`. `CMD` is `uvicorn openhands.server.listen:app --host 0.0.0.0 --port 3000`. `entrypoint.sh` must run as root. It unsets `WORKSPACE_BASE` when no `WORKSPACE_MOUNT_PATH` is given, optionally installs third-party runtimes, and either runs as root (`SANDBOX_USER_ID=0`) or creates an `enduser` with that uid, adds it to the Docker socket group, and drops privileges.

### Runtime (sandbox) image

The runtime image is **generated**, not hand-written: `openhands/runtime/utils/runtime_build.py --base_image nikolaik/python-nodejs:python3.12-nodejs22 --build_folder containers/runtime` renders a Dockerfile from templates plus a source distribution of the current commit, then `build.sh -i runtime` builds it. Images are tagged by OpenHands version and base image (e.g. `runtime:0.56-nikolaik`). The same builder runs at runtime when a conversation requests a custom base image ([Runtime Implementations](../runtime/runtime-implementations.md#runtime-image-building)).

### docker-compose

`docker-compose.yml` builds and runs the app image on port 3000, with `SANDBOX_RUNTIME_CONTAINER_IMAGE` (default `docker.all-hands.dev/all-hands-ai/runtime:0.56-nikolaik`). It mounts `/var/run/docker.sock` (the app starts sibling sandbox containers), `~/.openhands:/.openhands`, and the workspace at `/opt/workspace_base`, and maps `host.docker.internal` to the host gateway.

### Dev image

`containers/dev/` (`dev.sh`, `compose.yml`) builds `openhands:dev` with all toolchains. It mounts the source at `/app` and host git/npm credentials read-only.

## Kubernetes dev loop (`kind/`)

`make kind` creates the `local-hands` kind cluster from `kind/cluster.yaml` (maps port 80 for ingress-nginx) and applies `kind/manifests/` (an `ubuntu-dev` deployment, service, nginx ingress, role, and role binding). It then uses **mirrord** to run `make run` locally as if inside the `ubuntu-dev` pod. This is for developing the [Kubernetes runtime](../runtime/runtime-implementations.md).

## CI/CD workflows (`.github/workflows/`)

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| `ghcr-build.yml` (Docker) | push to main and tags, PRs, manual | Build and push app, runtime (per base image, multi-platform), and enterprise images to GHCR; run runtime tests in Docker as root and as the `openhands` user; update PR descriptions with image tags |
| `py-tests.yml` | push to main, PRs | Python unit tests ([Testing Guide](../testing/testing-guide.md)) |
| `fe-unit-tests.yml` | push to main, PRs touching `frontend/` | Frontend Vitest |
| `e2e-tests.yml` | PRs to main or develop, manual | Playwright end-to-end tests |
| `lint.yml` / `lint-fix.yml` | push and PRs / label | Lint, or auto-fix lint via label |
| `mdx-lint.yml`, `dispatch-to-docs.yml` | `docs/**` changes | Docs linting and syncing to the docs repo |
| `ui-build.yml`, `npm-publish-ui.yml` | `openhands-ui/**` changes | Build and publish `@openhands/ui` ([Frontend](../frontend/web-ui.md)) |
| `vscode-extension-build.yml` | VS Code extension changes, `ext-v*` tags | Build and release the extension |
| `pypi-release.yml` | manual | Publish to PyPI |
| `run-eval.yml`, `integration-runner.yml` | labels, releases, nightly | Evaluations and integration tests ([Evaluation](../evaluation/benchmarks.md)) |
| `openhands-resolver.yml` | `fix-me` label and mentions | Run the issue resolver ([Issue Resolver](../integrations/issue-resolver.md)) |
| `enterprise-preview.yml` | `deploy` label | Enterprise preview deploy ([Enterprise](../enterprise/saas-server.md)) |
| `openwiki-update.yml` | daily and manual | Refresh this wiki |
| `stale.yml`, `clean-up.yml`, `welcome-good-first-issue.yml` | schedule, manual, issue labels | Repository housekeeping |

## Related pages

- [Quickstart](../quickstart.md)
- [Runtime Implementations and Image Building](../runtime/runtime-implementations.md)
- [Testing Guide](../testing/testing-guide.md)
- [Web Server](../server/web-server.md)
