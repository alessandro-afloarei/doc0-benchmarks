---
title: "Development and Testing"
---
## Overview

Development combines a Poetry-managed Python backend, an npm-managed browser application and a separate UI package build. The Makefile supplies installation, service launch and lint targets; CI runs Python, frontend and enterprise checks independently. [[Quickstart]] covers the first task. This page explains what those targets actually execute and how to choose validation for a change without treating one successful command as coverage of every subsystem.

Sources: [Makefile:139-201](repo://Makefile#L139-L201), [Makefile:237-282](repo://Makefile#L237-L282), [.github/workflows/py-tests.yml:18-53](repo://.github/workflows/py-tests.yml#L18-L53), [.github/workflows/py-tests.yml:86-106](repo://.github/workflows/py-tests.yml#L86-L106), [.github/workflows/fe-unit-tests.yml:20-44](repo://.github/workflows/fe-unit-tests.yml#L20-L44), [.github/workflows/ui-build.yml:20-34](repo://.github/workflows/ui-build.yml#L20-L34)

## Install and build boundaries

`make build` checks dependencies, installs Python and frontend dependencies, installs pre-commit hooks and builds the frontend. The Python installation selects Python 3.12 and normally installs the `dev`, `test` and `runtime` groups. `POETRY_GROUP` changes that to an explicit group-only installation. Playwright Chromium installation is included unless `INSTALL_PLAYWRIGHT` is false or zero, and a cache marker skips repeated installation on its standard branch.

Sources: [Makefile:24-44](repo://Makefile#L24-L44), [Makefile:139-175](repo://Makefile#L139-L175)

Frontend installation checks npm and Node.js, runs the repository's Node detection script and installs packages in `frontend`. Its package declares Node 22 or newer. The build script generates translations before invoking React Router build, while the Makefile also runs the package's prepare step. Python package builds have a custom `build_vscode.py` hook that builds and includes the VS Code extension. Missing extension packaging has its own warning path when the build subprocess fails.

Sources: [Makefile:177-188](repo://Makefile#L177-L188), [Makefile:244-246](repo://Makefile#L244-L246), [frontend/package.json:6-8](repo://frontend/package.json#L6-L8), [frontend/package.json:63-79](repo://frontend/package.json#L63-L79), [pyproject.toml:21-25](repo://pyproject.toml#L21-L25), [build_vscode.py:80-105](repo://build_vscode.py#L80-L105)

The `openhands-ui` package has a separate CI build using Bun and its own pinned Bun version file. It is not the same build target as `frontend`. The enterprise directory likewise has its own Poetry project depending on the root package. Changes crossing those package boundaries should be checked against their corresponding build or test job; [[Enterprise Deployment]] explains why installing only the base server is insufficient for enterprise service imports.

Sources: [.github/workflows/ui-build.yml:20-34](repo://.github/workflows/ui-build.yml#L20-L34), [enterprise/pyproject.toml:7-25](repo://enterprise/pyproject.toml#L7-L25), [.github/workflows/py-tests.yml:86-106](repo://.github/workflows/py-tests.yml#L86-L106)

## Run services while developing

`make start-backend` runs Uvicorn against `openhands.server.listen:app` with reload enabled and excludes the workspace directory from reload watching. `make run` starts its backend through `_run_setup`, waits for the backend port and launches the frontend. Default ports are 3000 and 3001. The Makefile's frontend launcher passes the backend host and frontend port through Vite environment values and switches to the polling development script on WSL.

Sources: [Makefile:4-9](repo://Makefile#L4-L9), [Makefile:249-283](repo://Makefile#L249-L283)

| Frontend script | Behavior |
| --- | --- |
| `npm run dev` | Generates translations and starts React Router with API mocking disabled |
| `npm run dev:mock` | Starts with API mocking enabled and SaaS mocking disabled |
| `npm run dev:mock:saas` | Starts with both API and SaaS mocking enabled |
| `npm run build` | Generates translations and creates the production build |
| `npm run typecheck` | Generates route types and runs TypeScript |

Sources: [frontend/package.json:63-80](repo://frontend/package.json#L63-L80)

Use these script definitions when interpreting mocked behavior: the current `dev` script explicitly sets `VITE_MOCK_API=false`. [[Browser Conversation UI]] follows the real HTTP and socket paths, including metadata polling and runtime readiness. Model configuration for headless work and browser settings are separate, as explained in [[Configuration]].

Sources: [frontend/package.json:64-66](repo://frontend/package.json#L64-L66), [frontend/src/context/ws-client-provider.tsx:295-345](repo://frontend/src/context/ws-client-provider.tsx#L295-L345), [Development.md:70-76](repo://Development.md#L70-L76)

## Python validation

The unit-test README gives a direct command for the Python suite and shows how to select a single file or individual test. Pytest configuration enables automatic asyncio mode with function-scoped default fixture loops. CI's Linux job installs the development/test/runtime dependencies, builds the project and runs the full unit suite with forked workers; it then runs Bash runtime tests against `CLIRuntime`.

Sources: [tests/unit/README.md:3-27](repo://tests/unit/README.md#L3-L27), [pytest.ini:1-4](repo://pytest.ini#L1-L4), [.github/workflows/py-tests.yml:46-53](repo://.github/workflows/py-tests.yml#L46-L53)

```bash
poetry run pytest ./tests/unit
```

Sources: [tests/unit/README.md:5-9](repo://tests/unit/README.md#L5-L9)

Windows CI runs a targeted Windows shell unit file and Bash runtime tests with `LocalRuntime`. Enterprise CI installs its own project and runs its unit suite with the tracing pytest plugins disabled. These jobs exercise different runtime and service boundaries, so a root Python unit run does not establish that platform-specific command execution or enterprise imports work. [[Sandbox Execution]] documents those runtime implementation differences.

Sources: [.github/workflows/py-tests.yml:55-106](repo://.github/workflows/py-tests.yml#L55-L106)

## Frontend and browser validation

| Command, from `frontend` | Check |
| --- | --- |
| `npm test` | Vitest suite |
| `npm run test:coverage` | Translation generation and Vitest coverage |
| `npm run lint` | Type checking, ESLint and Prettier checks, with the prelint translation step |
| `npm run test:e2e` | Playwright browser suite |
| `npm run check-translation-completeness` | Translation completeness script |

Sources: [frontend/package.json:69-81](repo://frontend/package.json#L69-L81)

`make test` currently delegates only to `test-frontend`, which runs the frontend test script. Python tests require their separate invocation. Frontend unit CI installs with `npm ci`, builds and runs coverage. The Playwright configuration starts the mock development server on port 3001, uses Chromium, Firefox and WebKit projects, and captures a trace on the first retry. CI uses one browser worker and allows two retries.

Sources: [Makefile:237-242](repo://Makefile#L237-L242), [.github/workflows/fe-unit-tests.yml:36-44](repo://.github/workflows/fe-unit-tests.yml#L36-L44), [frontend/playwright.config.ts:14-50](repo://frontend/playwright.config.ts#L14-L50), [frontend/playwright.config.ts:73-78](repo://frontend/playwright.config.ts#L73-L78)

The repository also has a separate end-to-end workflow gated by the `end-to-end` PR label or manual dispatch. It builds the application with a Docker runtime and browser support, installs Chromium Headless Shell and starts the application before its checks. Keep that workflow distinct from the frontend Playwright configuration: one targets application-level setup and runtime integration, while the latter explicitly starts a mock server.

Sources: [.github/workflows/e2e-tests.yml:3-15](repo://.github/workflows/e2e-tests.yml#L3-L15), [.github/workflows/e2e-tests.yml:57-105](repo://.github/workflows/e2e-tests.yml#L57-L105), [frontend/playwright.config.ts:73-78](repo://frontend/playwright.config.ts#L73-L78)

## Linting and reviewing a change

Backend lint runs pre-commit across tracked files using `dev_config/python/.pre-commit-config.yaml`. That configuration includes whitespace and YAML checks, project-file validation, Ruff lint/format and mypy over `openhands/`. Several hooks exclude enterprise and third-party code; enterprise lint has its own CI invocation. The frontend lint job additionally checks translation completeness, and CI also checks version consistency across documentation.

Sources: [Makefile:191-201](repo://Makefile#L191-L201), [dev_config/python/.pre-commit-config.yaml:1-56](repo://dev_config/python/.pre-commit-config.yaml#L1-L56), [.github/workflows/lint.yml:29-38](repo://.github/workflows/lint.yml#L29-L38), [.github/workflows/lint.yml:58-87](repo://.github/workflows/lint.yml#L58-L87)

The contribution guide requests conventional PR-title prefixes and a short changelog message for user-visible changes. Core agent changes are assessed on accuracy, efficiency and complexity, with evaluation required for prompt and agent behavior changes. [[Benchmark Evaluation]] explains the experiment artifacts and scoring boundary needed to support those claims; ordinary unit-test success answers a different question from whether an agent's task performance improved.

Sources: [CONTRIBUTING.md:37-46](repo://CONTRIBUTING.md#L37-L46), [CONTRIBUTING.md:68-94](repo://CONTRIBUTING.md#L68-L94), [CONTRIBUTING.md:113-123](repo://CONTRIBUTING.md#L113-L123)
