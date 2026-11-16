---
type: workflow
title: Testing Guide
description: How OpenHands is tested — Python unit tests, runtime integration tests parametrized by TEST_RUNTIME, Playwright end-to-end tests, frontend Vitest/Playwright suites, enterprise tests, linting, and the CI workflows that run each — with commands for running them locally.
tags: [testing, pytest, runtime-tests, e2e, vitest, ci, lint]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:35:38.671Z
sources:
  - id: openwiki-source-95b6dc7c567aa3f9d679b80a
    resource: repo://.github/workflows/e2e-tests.yml
  - id: openwiki-source-0a2b7a93d2e936edbdbf375a
    resource: repo://.github/workflows/fe-unit-tests.yml
  - id: openwiki-source-0edfe5777fd02caaff32c8a8
    resource: repo://.github/workflows/ghcr-build.yml
  - id: openwiki-source-2ab88915e37908e92fe8ef01
    resource: repo://.github/workflows/lint.yml
  - id: openwiki-source-748f1c2eceae5df4ffb430ce
    resource: repo://.github/workflows/py-tests.yml
  - id: openwiki-source-fea87bbfafb0525ff9122e7a
    resource: repo://.openhands/microagents/repo.md
  - id: openwiki-source-e44eab9a26f9187df819fc2a
    resource: repo://pytest.ini
  - id: openwiki-source-7ef60dc4372e1a33c7728fe6
    resource: repo://tests/e2e/README.md
  - id: openwiki-source-76cf53525cb3c7251a79cd2b
    resource: repo://tests/runtime/conftest.py
generated: { by: "claude-code", at: "2026-11-16T07:35:38.671Z" }
---

# Testing Guide

OpenHands has several test layers. They differ in speed and in what they need from the environment:

| Suite | Location | Needs | Typical command |
| --- | --- | --- | --- |
| Python unit tests | `tests/unit/` | Python deps, tmux for some tests | `poetry run pytest ./tests/unit` |
| Runtime integration | `tests/runtime/` | A real sandbox (Docker by default) | `TEST_RUNTIME=docker poetry run pytest ./tests/runtime/test_bash.py` |
| End-to-end (app) | `tests/e2e/` | Running app, Playwright, LLM key, GitHub token | `cd tests/e2e && poetry run pytest ...` |
| Frontend unit | `frontend/__tests__/` | Node | `cd frontend && npm run test` |
| Frontend e2e | `frontend/tests/` | Node, Playwright | `cd frontend && npm run test:e2e` |
| UI library | `openhands-ui/` | Bun/Node | `vitest` via its package scripts |
| Enterprise unit | `enterprise/tests/unit/` | Enterprise Poetry env | `cd enterprise && poetry run pytest ./tests/unit` |
| Agent integration | `evaluation/integration_tests/` | Real LLM | See [Evaluation](../evaluation/benchmarks.md#integration-tests) |

## Python unit tests

- `pytest.ini` sets `asyncio_mode = auto` (async tests need no decorator), a function-scoped default loop, and disables warnings output.
- Install with `poetry install --with dev,test,runtime` (or `make build`). CI runs `PYTHONPATH=".:$PYTHONPATH" poetry run pytest --forked -n auto -svv ./tests/unit`. That is process-isolated (`pytest-forked`) and parallel (`pytest-xdist`), because many components use global state such as registries, event loops, and env vars.
- Layout mirrors the package: `agenthub/`, `cli/`, `controller/`, `core/` (config, logger, message, schema), `events/`, `integrations/`, `io/`, `llm/`, `mcp/`, `memory/`, `microagent/`, `resolver/`, `runtime/`, `security/`, `server/`, `storage/`, `utils/`, plus top-level tests for the LLM registry, conversation stats, and summaries. Each wiki page lists its focused tests.
- Conventions (from `.openhands/microagents/repo.md`): write tests with pytest, put them next to the related area, and run the narrowest relevant file, e.g. `poetry run pytest tests/unit/llm/test_llm.py::test_name`.
- Agents and LLMs are usually mocked. `DummyAgent` ([Agents](../agents/agenthub.md#derived-and-alternative-agents)) and `InMemoryFileStore` help with controller and event-stream tests that need no LLM or disk.

## Runtime tests

`tests/runtime/` tests real sandboxes ([Runtime Architecture](../runtime/runtime-architecture.md)):

- `conftest.py` reads `TEST_RUNTIME` (`docker` default, also `local`, `remote`, `cli`, `runloop`, `daytona`, …), `RUN_AS_OPENHANDS` (default `True`, else root), `TEST_IN_CI`, and `SANDBOX_BASE_CONTAINER_IMAGE`. It parametrizes fixtures by runtime class and user, creates per-test temp workspaces, and `_load_runtime(...)` builds a config, creates the runtime, and connects it.
- Coverage: `test_bash.py` (soft and hard timeouts, interactive input, multi-command rejection), `test_ipython.py`, `test_aci_edit.py`, `test_llm_based_edit.py`, `test_browsing.py`, `test_browsergym_envs.py`, `test_env_vars.py`, `test_glob_and_grep.py`, `test_mcp_action.py`, `test_microagent.py`, `test_setup.py` (setup.sh), `test_replay.py` (trajectories in `trajs/`), `test_runtime_resource.py`, `test_docker_images.py`, `test_port_locking_fix.py`, `test_stress_remote_runtime.py`.
- CI (`ghcr-build.yml`) runs them against freshly built runtime images, both as root and as the `openhands` user: `TEST_RUNTIME=docker TEST_IN_CI=true poetry run pytest -n 0 --reruns 2 ./tests/runtime` (browsergym envs are excluded). `py-tests.yml` also runs `tests/runtime/test_bash.py` with `TEST_RUNTIME=cli` on Linux and `TEST_RUNTIME=local` on Windows, plus the Windows bash unit tests.

## End-to-end tests

- `tests/e2e/` (Python Playwright) drives a running app, by default at `http://localhost:12000` (`--base-url`, `--headless/--no-headless`, `--slow-mo`). It needs `GITHUB_TOKEN`, `LLM_MODEL`, and `LLM_API_KEY`. Tests cover settings and token configuration, starting conversations, browsing, local runtime, and multi-conversation resume.
- `.github/workflows/e2e-tests.yml` runs them on PRs labeled `end-to-end` or by manual dispatch.

## Frontend

- `npm run test` (Vitest + Testing Library, MSW for API mocks) and `npm run test:coverage` (used in `fe-unit-tests.yml`, after `npm ci` and `npm run build`).
- `npm run test:e2e` runs Playwright specs in `frontend/tests/`.
- `npm run lint` covers typegen, `tsc`, ESLint, and Prettier. `npm run check-translation-completeness` checks i18n coverage. See [Frontend](../frontend/web-ui.md#testing-and-quality).

## Linting

- Backend: `pre-commit run --all-files --config ./dev_config/python/.pre-commit-config.yaml` (ruff, mypy, and more). `make lint-backend` installs the hooks and runs them. The repository's agent instructions require hooks to pass before pushing.
- `lint.yml` runs frontend lint, Python pre-commit, enterprise pre-commit, and a version-consistency check (`.github/scripts/check_version_consistency.py`). Adding the `lint-fix` label to a PR triggers automatic fixes (`lint-fix.yml`).

## CI summary

| Workflow | What runs |
| --- | --- |
| `py-tests.yml` | Unit tests (Linux, forked and parallel), CLI-runtime bash tests, Windows bash tests, enterprise unit tests |
| `ghcr-build.yml` | Image builds, then runtime tests in Docker (root and `openhands` user) |
| `fe-unit-tests.yml` | Frontend build and Vitest with coverage |
| `e2e-tests.yml` | Playwright E2E against a running app (label-gated) |
| `lint.yml` | Pre-commit and frontend lint |
| `ui-build.yml`, `vscode-extension-build.yml` | Builds and tests for the UI library and the VS Code extension |
| `integration-runner.yml`, `run-eval.yml` | LLM-backed integration tests and benchmarks |

## Choosing the narrowest check

Changes to controller, events, LLM, memory, or config logic → the matching `tests/unit/<area>/` file. Changes to sandbox behavior (bash, files, plugins) → the matching `tests/runtime/` file with `TEST_RUNTIME=docker`, or `local` when Docker isn't available. UI changes → `npm run test` and `npm run lint`. Server or route changes → `tests/unit/server/`.

## Related pages

- [Build, Packaging, and Deployment](../operations/build-and-deploy.md)
- [Evaluation Harness and Benchmarks](../evaluation/benchmarks.md)
- [Runtime Implementations](../runtime/runtime-implementations.md)
