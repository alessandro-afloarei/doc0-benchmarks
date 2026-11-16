---
type: architecture
title: Testing and CI
description: How OpenHands is tested, covering the Python unit, runtime, end-to-end, and enterprise suites, the frontend unit and type checks, the Make targets that run them locally, and the GitHub Actions workflows that lint, test, build, publish, evaluate, and keep this wiki current.
tags: [testing, ci, pytest, vitest, playwright, github-actions, make, lint, release]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T11:08:31.416Z
sources:
  - id: openwiki-source-95b6dc7c567aa3f9d679b80a
    resource: repo://.github/workflows/e2e-tests.yml
  - id: openwiki-source-0a2b7a93d2e936edbdbf375a
    resource: repo://.github/workflows/fe-unit-tests.yml
  - id: openwiki-source-67020df43fd1eccb40b97756
    resource: repo://.github/workflows/integration-runner.yml
  - id: openwiki-source-6d4b4e707b8d60b6ccfa3425
    resource: repo://.github/workflows/openwiki-update.yml
  - id: openwiki-source-748f1c2eceae5df4ffb430ce
    resource: repo://.github/workflows/py-tests.yml
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-e44eab9a26f9187df819fc2a
    resource: repo://pytest.ini
generated: { by: "claude-code", at: "2026-11-16T11:08:31.416Z" }
---

# Testing and CI

OpenHands has four test surfaces: Python unit tests, runtime tests that drive a real sandbox, browser
end-to-end tests, and frontend unit tests. The enterprise package has its own suite. Continuous
integration runs most of them on every push and pull request. Some suites are slower or need secrets
and run only on demand or on a schedule. This page lists what runs where, and which command reproduces
each job on a developer machine.

## Test layout

| Location | Framework | What it covers |
| --- | --- | --- |
| `tests/unit/` | pytest (`pytest.ini` sets `asyncio_mode = auto`) | Agents, controller, events, LLM layer, runtime helpers, server, CLI, MCP, resolver, security, integrations, evaluation, and config. About 25 subfolders and modules. |
| `tests/runtime/` | pytest, with `TEST_RUNTIME` selecting the backend | Runtime integration tests: bash sessions (`test_bash.py`), ACI edits (`test_aci_edit.py`), git hooks (`test_git_hooks.py`), and GitLab microagents. |
| `tests/e2e/` | pytest with `pytest-playwright` | Browser tests against a running application, such as `test_browsing_catchphrase.py`. `check_playwright.py` verifies that the browsers are installed. |
| `tests/unit/` (utils and Windows) | pytest | Platform-specific tests, such as `tests/unit/runtime/utils/test_windows_bash.py`. |
| `enterprise/tests/unit/` | pytest | Enterprise server: clustered conversations, billing, auth, integrations, callback processors, and storage. |
| `frontend/__tests__/` and `frontend/src/**/__tests__/` | Vitest, with `vitest.setup.ts` | Frontend API clients, context providers, hooks, and services. |
| `openhands-ui/` | Vitest (`vitest.config.ts`) | Shared components. |
| `evaluation/integration_tests/tests/` | `BaseIntegrationTest` (scenario tests) | Scripted agent tasks run by the evaluation runner. See [Evaluation Harness and Benchmarks](../evaluation/benchmarks.md). |

The unit suite is the default check. Runtime tests need a working backend: Docker for the default
backend, or `TEST_RUNTIME=cli` and `TEST_RUNTIME=local` for the lighter ones.

## Make targets

The `Makefile` wraps the setup and common tasks:

- `make build` (`Makefile:25`) prepares the environment: it checks dependencies (Python, Poetry, Node,
  Docker, tmux) and installs the Python and frontend dependencies.
- `make lint` (`Makefile:199`) runs `lint-frontend` and `lint-backend`. The backend target installs the
  pre-commit hooks first (`install-pre-commit-hooks`, `Makefile:185`).
- `make test-frontend` (`Makefile:237`) runs `npm run test` in `frontend/`.
- `make test` (`Makefile:241`) runs `test-frontend`.
- `make build-frontend` (`Makefile:244`) builds the frontend bundle.
- `make run` and `make start-backend` start the backend with Uvicorn at `openhands.server.listen:app`
  (`Makefile:251`).
- `make kind` (`Makefile:203`) prepares a local Kubernetes cluster with mirrord, for working on the
  Kubernetes runtime.

The Python unit test command used by CI, and suitable locally, is:

```bash
PYTHONPATH=".:$PYTHONPATH" poetry run pytest --forked -n auto -svv ./tests/unit
```

`--forked` isolates each test process, and `-n auto` runs tests in parallel. Runtime tests use a
single backend:

```bash
PYTHONPATH=".:$PYTHONPATH" TEST_RUNTIME=cli poetry run pytest -svv tests/runtime/test_bash.py
```

Frontend tests run with `npm run test` in `frontend/`, which uses Vitest. The frontend build runs
`npm run make-i18n` before `react-router build`, so translation bundles must be generated first.

## Continuous integration

The workflows in `.github/workflows/` are the source of truth for what runs. The main ones are:

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `py-tests.yml` ("Run Python Tests") | push and pull request | Installs Poetry dependencies (`dev`, `test`, `runtime`), runs `make build`, runs the unit suite with `--forked -n auto` on Python 3.12, and runs `tests/runtime/test_bash.py` with `TEST_RUNTIME=cli`. A Windows job runs the Windows bash tests, and a `test-enterprise` job runs the enterprise tests from `enterprise/`. |
| `lint.yml` ("Lint") | push and pull request | Frontend lint (`npm run lint`), TypeScript compilation after `make-i18n`, and Python lint through pre-commit. |
| `fe-unit-tests.yml` ("Run Frontend Unit Tests") | push and pull request | `npm ci`, TypeScript compilation, and the Vitest suite with coverage on Node 22. |
| `mdx-lint.yml` ("MDX Lint") | push and pull request | Lints the documentation under `docs/`. |
| `ui-build.yml` ("Run UI Component Build") | push and pull request | Installs with Bun from the frozen lockfile and builds `openhands-ui`. |
| `e2e-tests.yml` ("End-to-End Tests") | pull request labeled `end-to-end`, or manual dispatch | Installs Playwright's Chromium headless shell and runs `tests/e2e`. |
| `integration-runner.yml` ("Run Integration Tests") | pull request labeled `integration-test`, manual dispatch, and a nightly schedule at 22:30 UTC | Runs the evaluation integration scenarios with a real model. |
| `run-eval.yml` ("Run Eval") | pull request and manual dispatch | Runs a benchmark evaluation on a branch with a chosen number of instances. |
| `vscode-extension-build.yml` ("VSCode Extension CI") | push and pull request | Builds and validates the VS Code extension packaged by `build_vscode.py`. |
| `enterprise-preview.yml` ("Enterprise Preview") | pull request | Asks an external workflow to deploy a preview of the enterprise server for the pull request. It needs a token secret. |
| `ghcr-build.yml` ("Docker") | push, pull request, and manual dispatch | Builds the container images (Docker workflow). |
| `pypi-release.yml` ("Publish PyPi Package") | manual dispatch | Builds and publishes the Python package. |
| `npm-publish-ui.yml` ("Publish OpenHands UI Package") | push | Publishes `@openhands/ui` when its version changes. |
| `openwiki-update.yml` ("OpenWiki Update") | nightly at 08:00 UTC and manual dispatch | Runs `openwiki code --update` to refresh this wiki, then commits the changed `openwiki/` files and `AGENTS.md`. |
| `openhands-resolver.yml` | labels, comments, and manual dispatch | Runs the issue resolver. See [Git Provider Integrations and Issue Resolver](../integrations/git-providers-and-resolver.md). |
| `stale.yml`, `clean-up.yml`, `welcome-good-first-issue.yml` | schedule and events | Housekeeping for issues and stale branches. |

The `openwiki-update` workflow is the only one that writes to the repository. It runs with
`contents: write` and `pull-requests: write` permissions, and removes the transient
`openwiki/.run.json` run file before it commits.

## Interpreting a failure

- **Unit test failure with `--forked`.** Read the first traceback; later errors are often cascades.
- **Runtime test failure.** Check the `TEST_RUNTIME` value and whether the backend (Docker or tmux) is
  available. `py-tests.yml` installs tmux explicitly for this reason.
- **Lint failure.** Run `make lint` locally. Frontend lint failures include the TypeScript step, which
  needs `make-i18n` first.
- **E2E failure.** Confirm that the Playwright browsers are installed with `tests/e2e/check_playwright.py`.

## Operational consequences

- Some tests call real LLM providers. The integration scenarios need API keys, cost money, and can be
  flaky. `integration-runner.yml` runs them nightly and on pull requests labeled `integration-test`.
- Enterprise tests and the enterprise preview depend on the `enterprise/` package, which is licensed
  differently from the rest of the repository. See [Enterprise SaaS Layer](../enterprise/saas-server.md).
- The nightly wiki update changes files that other tools read. Review its pull requests before merging
  them, and rerun it with manual dispatch after large refactors.

## Extension seams

- New Python test: add a file under the matching `tests/unit/` subfolder. It is picked up by the default
  pytest path.
- New runtime test: add it under `tests/runtime/` and make it respect `TEST_RUNTIME`.
- New workflow: add it under `.github/workflows/` and make it reuse the `make build` setup where possible.

## Related pages

- [Quickstart](../quickstart.md)
- [Evaluation Harness and Benchmarks](../evaluation/benchmarks.md)
- [Runtime Abstraction and Execution Backends](../architecture/runtime.md)
