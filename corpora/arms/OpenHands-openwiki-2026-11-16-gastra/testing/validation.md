---
type: testing
title: Testing and contributor validation
description: Choose focused Python, frontend, runtime, enterprise, and live evaluation checks using the repository's actual scripts and CI configuration.
tags: [testing, validation, ci, development]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T08:14:39.912Z
sources:
  - id: openwiki-source-0a2b7a93d2e936edbdbf375a
    resource: repo://.github/workflows/fe-unit-tests.yml
  - id: openwiki-source-748f1c2eceae5df4ffb430ce
    resource: repo://.github/workflows/py-tests.yml
  - id: openwiki-source-1047363cf615000e4c9bb694
    resource: repo://frontend/package.json
  - id: openwiki-source-2090dca405aa9c3acd6c7ff8
    resource: repo://frontend/playwright.config.ts
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-e44eab9a26f9187df819fc2a
    resource: repo://pytest.ini
  - id: openwiki-source-7ef60dc4372e1a33c7728fe6
    resource: repo://tests/e2e/README.md
  - id: openwiki-source-76cf53525cb3c7251a79cd2b
    resource: repo://tests/runtime/conftest.py
generated: { by: "codex", at: "2026-11-16T08:14:39.912Z" }
---

# Testing and contributor validation

Choose checks by the boundary changed. A component test can verify rendering; an event test can verify causality and serialization; a runtime test executes real tools. Live-agent evaluations additionally measure model behavior and may need credentials and external services.

## Focused Python checks

Install the source-development dependency groups with `poetry install --with dev,test,runtime`, or use the complete setup in the [quickstart](../quickstart.md). From the repository root:

```bash
poetry run pytest tests/unit/events/test_event_stream.py
poetry run pytest tests/unit/controller/test_agent_controller.py
poetry run pytest tests/unit/core/config/test_config_precedence.py
```

Select one test with `path/to/test.py::test_name`, or use `-k` for a behavioral subset. The root pytest configuration enables automatic asyncio mode and function-scoped default async fixture loops.

| Change | Focused test area |
| --- | --- |
| Action/observation wire format | `tests/unit/events/` |
| Scheduling, limits, delegation | `tests/unit/controller/` |
| LLM conversion/capabilities/retries | `tests/unit/llm/`, `tests/unit/test_llm_registry.py` |
| Recall, condensation, instructions | `tests/unit/memory/`, `tests/unit/microagent/` |
| Settings and config precedence | `tests/unit/core/config/` |
| HTTP metadata/auth boundaries | `tests/unit/server/` |
| MCP failures and credential behavior | `tests/unit/mcp/`, `tests/unit/integrations/` |

Useful nontrivial regressions include control-limit extension versus headless limits, event-store round trips, cause-linked MCP timeout feedback, provider immutability, and conversation ownership errors. These check contracts that cross more than one function.

## Frontend checks

From `frontend/`:

```bash
npm ci
npm run test -- __tests__/components/event-message.test.tsx
npm run typecheck
npm run lint
npm run build
```

`test` runs Vitest. The Vite config supplies jsdom and `vitest.setup.ts`, excluding the separate Playwright `tests` directory. `typecheck` generates React Router types before TypeScript checking; `lint` includes typechecking, ESLint, and Prettier. Translation generation is part of build and prelint, and translation completeness has a separate command.

The root `make test` delegates only to `test-frontend`. It does **not** run the Python suite. For all Python unit tests use `poetry run pytest tests/unit`.

Frontend CI uses Node 22, `npm ci`, a production build, and coverage. Prefer the manifest and current workflow over older frontend README statements about Node versions or mock defaults.

## Runtime integration

`tests/runtime/` exercises actual environment setup, shell commands, files, browser behavior, and Jupyter. Fixtures default `TEST_RUNTIME` to `docker`.

```bash
poetry run pytest tests/runtime/test_bash.py
TEST_RUNTIME=cli poetry run pytest tests/runtime/test_bash.py
```

The chosen adapter needs its corresponding dependencies and infrastructure. Docker runtime tests require Docker; remote/provider-backed adapters require their configured service. Fixtures own runtime cleanup, and Docker cleanup selects the test runtime rather than deliberately removing all runtime containers.

Use runtime checks for command semantics, paths, mounts, plugins, and lifecycle changes. They add evidence beyond a mocked controller test.

## Two browser-test surfaces

The JavaScript Playwright suite is `frontend/tests`, launched by `npm run test:e2e`. Its config starts `npm run dev:mock -- --port 3001`, tests Chromium/Firefox/WebKit, and enables two retries on CI. This suite uses the mocked frontend server.

The Python suite under `tests/e2e/` drives an OpenHands deployment and documents GitHub/model credentials for live conversation scenarios. Its browser fixtures support visible mode and slow motion. A representative invocation from the repository root is:

```bash
poetry run pytest tests/e2e/test_settings.py::test_github_token_configuration tests/e2e/test_conversation.py::test_conversation_start --base-url=http://localhost:3000 -v
```

These tests can configure settings and start real conversations. They are not interchangeable with the mocked frontend suite.

## CI and enterprise

The Python CI workflow installs Python 3.12 and Node 22, builds the environment, runs unit tests with forked parallel pytest workers, and runs CLI-runtime bash tests. Its Windows job is a focused subset rather than the full Linux suite.

Enterprise CI runs from `enterprise/`, installs that manifest's dev/test groups, and runs its own unit suite with selected ddtrace plugins disabled. This working directory matters because enterprise modules use top-level `server` and `storage` imports.

Backend lint uses the explicit pre-commit config at `dev_config/python/.pre-commit-config.yaml`; enterprise has its own equivalent. Frontend lint CI also checks translation completeness.

## Evaluations and documentation changes

`evaluation/integration_tests/` uses task classes with `initialize_runtime` and `verify_result`, then runs an actual agent through its evaluation harness. Benchmark artifacts and retry behavior are described in [resolver/evaluation workflows](../workflows/resolver-evaluation.md). Run the focused deterministic checks first when they cover the changed behavior.

For documentation-only changes, verify local links, source references, and documented commands against manifests/workflows. This wiki's generation validates page structure and evidence references; it does not imply application suites or live model evaluations were executed.
