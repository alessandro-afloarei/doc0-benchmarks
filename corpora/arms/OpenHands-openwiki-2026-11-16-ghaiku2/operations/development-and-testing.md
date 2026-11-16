---
type: "Reference"
title: "Development, Testing, and Quality Gates"
openwiki_generated: true
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:30:54.023Z
sources:
  - id: openwiki-source-67020df43fd1eccb40b97756
    resource: repo://.github/workflows/integration-runner.yml
  - id: openwiki-source-748f1c2eceae5df4ffb430ce
    resource: repo://.github/workflows/py-tests.yml
  - id: openwiki-source-979a0826bb171a9e4cd33365
    resource: repo://dev_config/python/.pre-commit-config.yaml
  - id: openwiki-source-0ff0db8a6c1d1d1a92bf7c45
    resource: repo://dev_config/python/mypy.ini
  - id: openwiki-source-1047363cf615000e4c9bb694
    resource: repo://frontend/package.json
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-e44eab9a26f9187df819fc2a
    resource: repo://pytest.ini
generated: { by: "claude-code", at: "2026-11-16T18:30:54.023Z" }
---


# Development, Testing, and Quality Gates

This page is the working reference for changing OpenHands and proving the change. It covers setup, the test suites and where they live, the gates a change must pass, and the CI jobs that enforce them. `Development.md` is the longer human guide; this page summarizes what the repository's own configuration enforces.

## Setup

`Development.md` lists the requirements (Python 3.12, Poetry, Node.js, and Docker for the sandbox) and walks through the steps: build and set up the environment, configure the language model, run the application, and use the Docker-based development flow.

The Makefile is the entry point for both halves of the repository:

- `make build` (see `Makefile` ~L25) installs the Python dependencies with Poetry, using the groups `dev`, `test`, and `runtime` (~L155), and the frontend dependencies.
- `make install-pre-commit-hooks` (~L185) installs the git hooks. The repository's guidance is to run it before making changes.
<!-- openwiki: broken internal link [/openwiki/operations/deployment-and-docker.md] link "/openwiki/operations/deployment-and-docker.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- `make run` (~L279) starts the application locally. `make docker-run` and `make docker-dev` use the containers described in [Deployment, Containers, and Build](/openwiki/operations/deployment-and-docker.md).
- `make lint` runs the frontend lint (`lint-frontend`, ~L195), and `lint-backend` (~L191) runs `pre-commit run --all-files` with `dev_config/python/.pre-commit-config.yaml`.
- `make test` runs the frontend tests (`test-frontend`, ~L237), which call `npm run test`.

`frontend/README.md` and `.openhands/microagents/repo.md` give the npm commands (`npm install`, `npm run dev`, `npm run build`, `npm run lint:fix`, `npm run test`, and `npm run make-i18n`).

## Backend test suites

`pytest.ini` at the repository root sets `asyncio_mode = auto`, so async tests run without a decorator, and disables warning output (`-p no:warnings`). The suites are:

- **Unit tests** in `tests/unit/`, about 170 files grouped by package: `agenthub`, `cli`, `controller`, `core`, `events`, `integrations`, `llm`, `mcp`, `memory`, `microagent`, `resolver`, `runtime`, `security`, `server`, `storage`, and `utils`, plus a few top-level files. Each file mirrors a source area. `Development.md` gives the command `poetry run pytest ./tests/unit/test_*.py`. CI runs `pytest --forked -n auto -svv ./tests/unit` with `PYTHONPATH` set to the repository root.
- **Runtime tests** in `tests/runtime/`, about 23 files (for example `test_bash.py` and `test_aci_edit.py`). They run against a real sandbox, and CI selects the runtime for them with the `TEST_RUNTIME` environment variable. CI runs `test_bash.py` with `TEST_RUNTIME=cli` on Linux and with `local` on Windows, and runs the Windows bash unit test on Windows.
- **End-to-end tests** in `tests/e2e/` use Playwright (`check_playwright.py`, `conftest.py`, `test_conversation.py`, `test_settings.py`, `test_local_runtime.py`, `test_multi_conversation_resume.py`, `test_browsing_catchphrase.py`). The `e2e-tests.yml` workflow sets up the environment and runs them.
- **Enterprise tests** in `enterprise/tests/unit/` run through the enterprise Python job in `py-tests.yml`.
<!-- openwiki: broken internal link [/openwiki/evaluation/benchmarks.md] link "/openwiki/evaluation/benchmarks.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **Evaluation integration tests** are described in [Evaluation Harness and Benchmarks](/openwiki/evaluation/benchmarks.md).

Two conventions follow from the suites. Tests for a feature live in the unit directory that matches its package, and tests that need a real sandbox or a browser belong in `tests/runtime` or `tests/e2e`, not in the unit suite.

## Frontend tests

<!-- openwiki: broken internal link [/openwiki/frontend/web-application.md] link "/openwiki/frontend/web-application.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
The frontend uses Vitest for unit and component tests (`npm run test`, which is `vitest run`), with coverage through `test:coverage`, which first regenerates translations. Playwright (`npm run test:e2e`) covers browser flows. The tests and mocks are described in [Frontend Web Application](/openwiki/frontend/web-application.md). `frontend/tests/` holds six Playwright specs.

## Lint and type-check gates

### Python

`dev_config/python/.pre-commit-config.yaml` holds the hooks:

- generic hygiene: trailing whitespace, end-of-file newline, YAML syntax, and debug statements;
- `pyproject-fmt` and `validate-pyproject` for `pyproject.toml`;
- `ruff check` with `dev_config/python/ruff.toml`, which selects the `E`, `W`, `F`, `I`, `Q`, `B`, and `ASYNC` rule sets, and `ruff format`;
- `mypy` over `openhands/` with `dev_config/python/mypy.ini`, which turns on `check_untyped_defs`, `warn_unreachable`, `no_implicit_optional`, and `strict_optional`, and ignores missing imports for third-party packages.

`.openhands/pre-commit.sh` is an additional hook for agents working in the repository. It inspects the staged file list and runs only the checks that match the changed areas: frontend files trigger the frontend lint and type-check, and backend, evaluation, or test files trigger the Python checks. It exits with the combined result without replacing the standard hooks.

### Frontend

`frontend/package.json` defines `lint` as `npm run typecheck && eslint src && prettier --check src`, where `typecheck` runs `react-router typegen` and `tsc`. `lint:fix` applies the automatic fixes. The `build` script regenerates translations first (`make-i18n`) and then builds with React Router.

## CI workflows

The workflows in `.github/workflows/` map to the gates above:

- `lint.yml` has two jobs. The frontend job installs Node 22 and runs lint, TypeScript compilation, and translation checks. The Python job installs pre-commit and runs the hooks.
- `py-tests.yml` runs the Python tests on Linux (unit tests, then the CLI runtime bash tests) and on Windows (the Windows bash unit test, then the local runtime bash tests), and has an enterprise unit job. It installs dependencies with `poetry install --with dev,test,runtime`.
- `fe-unit-tests.yml` runs `npm ci`, `npm run build`, and `npm run test:coverage`.
- `e2e-tests.yml` runs the Playwright and runtime end-to-end tests.
- `mdx-lint.yml` checks the documentation pages under `docs/`.
- `ui-build.yml` builds the `openhands-ui` package, and `vscode-extension-build.yml` builds the VS Code extension.
- `ghcr-build.yml` builds the container images after the checks.

`.github/CODEOWNERS` and `.github/pull_request_template.md` define review ownership and the pull-request checklist.

## Invariants and failure behavior

- A change is considered ready when the pre-commit hooks pass on the staged files, the relevant test suite passes, and the frontend lint and type-check pass for frontend changes.
- The pre-commit hooks change files in place on failure (formatters and fixers). Re-run them after fixing a reported issue.
- Runtime tests need a working sandbox. A failure in a runtime test that is unrelated to the change usually points to the environment, not the code.

## Extension seams

- A new Python check is a hook in `dev_config/python/.pre-commit-config.yaml`, which the Makefile's `lint-backend` target runs.
- A new unit test goes next to its package in `tests/unit/`, following the existing file naming (`test_<module>.py`).
- A new CI job is a workflow file under `.github/workflows/`.

## Related pages

<!-- openwiki: broken internal link [/openwiki/quickstart.md] link "/openwiki/quickstart.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Repository Quickstart](/openwiki/quickstart.md)
<!-- openwiki: broken internal link [/openwiki/frontend/web-application.md] link "/openwiki/frontend/web-application.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Frontend Web Application](/openwiki/frontend/web-application.md)
<!-- openwiki: broken internal link [/openwiki/operations/deployment-and-docker.md] link "/openwiki/operations/deployment-and-docker.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Deployment, Containers, and Build](/openwiki/operations/deployment-and-docker.md)
<!-- openwiki: broken internal link [/openwiki/evaluation/benchmarks.md] link "/openwiki/evaluation/benchmarks.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Evaluation Harness and Benchmarks](/openwiki/evaluation/benchmarks.md)
