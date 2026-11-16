---
type: testing
title: Testing and contributor validation
description: Select focused Python, browser, runtime, enterprise, and evaluation checks and understand what each test layer proves.
tags: [testing, validation, ci, development]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:50:03.393Z
sources:
  - id: openwiki-source-0a2b7a93d2e936edbdbf375a
    resource: repo://.github/workflows/fe-unit-tests.yml
  - id: openwiki-source-748f1c2eceae5df4ffb430ce
    resource: repo://.github/workflows/py-tests.yml
  - id: openwiki-source-2090dca405aa9c3acd6c7ff8
    resource: repo://frontend/playwright.config.ts
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-76cf53525cb3c7251a79cd2b
    resource: repo://tests/runtime/conftest.py
generated: { by: "codex", at: "2026-11-16T06:50:03.393Z" }
---

# Testing and contributor validation

Choose the test boundary that changed: isolated Python logic, browser state, real tool execution, or an entire agent task. The root `make test` currently invokes frontend tests only; it is not a combined Python/frontend gate.

## Fast selection by behavior

| Change | Focused starting point |
| --- | --- |
| Action serialization/history | `tests/unit/events/`, controller tests |
| Agent tools or model transport | `tests/unit/agenthub/`, `tests/unit/llm/` |
| Recall or condensation | `tests/unit/memory/`, `tests/unit/microagent/` |
| Config/settings/secrets | `tests/unit/core/config/`, server route/store tests |
| Conversation lifecycle/replay | `tests/unit/server/session/`, manager and socket tests |
| Runtime transport/build/setup | `tests/unit/runtime/` |
| Shell/files/browser/notebook execution | `tests/runtime/` with the intended backend |
| Browser queries/live state | `frontend/__tests__/` and colocated service tests |
| Enterprise auth/ownership/stores | `enterprise/tests/unit/` in its own environment |
| Task-solving quality | Benchmark inference and scoring |

## Python checks

Install the development/test/runtime groups through the documented build or Poetry setup. From the repository root:

```bash
poetry run pytest tests/unit/events/test_event_stream.py
poetry run pytest tests/unit/controller/test_agent_controller.py
poetry run pytest tests/unit
```

Use a specific `::test_name` or `-k expression` for an affected behavior. Root pytest configuration uses automatic asyncio handling and a function-scoped default fixture loop.

Linux CI installs Python 3.12, Node 22, tmux, and Poetry dependencies, runs `make build`, then runs the Python unit suite with process isolation and parallel workers:

```bash
PYTHONPATH=. poetry run pytest --forked -n auto -svv tests/unit
```

The Windows CI lane covers Windows shell unit tests and the bash runtime suite with LocalRuntime. It does not represent a full Windows run of every test.

## Runtime integration checks

Runtime tests exercise actual commands, files, notebook/browser tools, environment setup, and cleanup. Default selection is Docker:

```bash
poetry run pytest tests/runtime/test_bash.py
TEST_RUNTIME=cli poetry run pytest tests/runtime/test_bash.py
```

The current fixture accepts `docker`/`eventstream`, `local`, `remote`, and `cli`; other values raise. This is narrower than the historical provider list in the runtime README. Remote execution needs its service configuration; local/CLI execution uses host resources. Match capability-specific tests to a backend that implements them.

CI explicitly runs the bash integration suite with CLI runtime after Linux unit tests. A passing CLI bash test does not validate Docker image construction, container mounts, Jupyter, or browsing. Use [runtime operations](../operations/runtimes.md) to identify the corresponding layer.

## Frontend checks

From `frontend/`:

```bash
npm ci
npm run typecheck
npm test -- __tests__/context/ws-client-provider.test.tsx
npm run test:coverage
npm run build
npm run lint
```

`typecheck` generates React Router types before TypeScript compilation. `build` and coverage generate i18n resources first. Lint combines type checking, ESLint, and Prettier; translation completeness also has its own script. Vitest uses jsdom and a setup file and excludes the separate browser-test directory.

Frontend CI uses Node 22, installs with `npm ci`, builds, and runs coverage. PR path filters restrict that workflow to frontend or workflow changes. Lint CI has separate frontend, backend, enterprise, and version-consistency jobs.

## Two browser-test surfaces

`frontend/tests/` uses the TypeScript Playwright runner:

```bash
npm run test:e2e -- --project=chromium
```

Its config starts `npm run dev:mock` on port 3001 and defines Chromium, Firefox, and WebKit projects. CI uses one worker and two retries. This checks browser behavior with mocked APIs.

`tests/e2e/` uses Python pytest/Playwright against a running OpenHands application. Its documented settings/conversation flow requires configured Git provider and model credentials, and accepts `--base-url`, `--no-headless`, and `--slow-mo`:

```bash
poetry run pytest tests/e2e/test_settings.py::test_github_token_configuration tests/e2e/test_conversation.py::test_conversation_start --base-url=http://localhost:3000 -v
```

These tests can start real conversations and call providers; they establish a different contract from the frontend mock suite.

## Formatting, enterprise, and evaluation

Backend pre-commit configuration lives in `dev_config/python/.pre-commit-config.yaml`; it includes Ruff and mypy plus repository hygiene checks. A direct full check is:

```bash
poetry run pre-commit run --all-files --show-diff-on-failure --config dev_config/python/.pre-commit-config.yaml
```

Some hooks modify files. Enterprise has its own Poetry environment, hook configuration, tests, and CI command; CI disables ddtrace pytest plugins for its unit run. Shared code should be checked against both affected environments.

Evaluation integration tests are agent tasks with runtime initialization and result verification. Benchmarks require model calls, datasets, and scoring setup and are not interchangeable with unit regressions. See [evaluation and resolver workflows](../workflows/evaluation-resolver.md). [Quickstart](../quickstart.md) provides setup and the task navigation map.
