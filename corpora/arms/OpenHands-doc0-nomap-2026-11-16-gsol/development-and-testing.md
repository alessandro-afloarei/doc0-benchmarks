---
title: "Development and Testing"
---
## Overview

The contributor workflow uses Poetry for Python dependencies and backend tools, npm for the browser application and Make targets to connect setup, linting, builds and development servers. [[Quickstart]] owns the first build and launch procedure. This page explains the available validation commands and extension contracts once that environment exists; dataset rollouts and benchmark outputs belong to [[Evaluation]].

Sources: [Makefile:24-45](repo://Makefile#L24-L45), [Makefile:139-197](repo://Makefile#L139-L197), [Makefile:237-263](repo://Makefile#L237-L263), [evaluation/README.md:5-18](repo://evaluation/README.md#L5-L18)

## Build and iterate locally

`make build` checks dependencies, installs Python and frontend packages, installs hooks and builds the frontend. Python setup normally includes `dev`, `test` and `runtime` groups, while `POETRY_GROUP` selects an alternative group-only install. Browser installation can be disabled with `INSTALL_PLAYWRIGHT`. Frontend installation runs the Node-version detection script before npm installation, and frontend building runs package preparation before the build script.

Sources: [Makefile:24-32](repo://Makefile#L24-L32), [Makefile:139-188](repo://Makefile#L139-L188), [Makefile:244-246](repo://Makefile#L244-L246)

For separate development loops, `make start-backend` launches Uvicorn with reload enabled and excludes the workspace from reload watching. `make start-frontend` starts the appropriate normal or WSL frontend script and supplies the backend host and frontend port. The package's ordinary dev script generates translations before starting React Router. Mock application scripts select their API and SaaS behavior through Vite environment values.

Sources: [Makefile:248-263](repo://Makefile#L248-L263), [frontend/package.json:63-74](repo://frontend/package.json#L63-L74)

The development guide also supports reusing an existing runtime container image through `SANDBOX_RUNTIME_CONTAINER_IMAGE` to reduce build time when execution-server code has not changed. That distinction follows the boundary in [[Runtime and Workspace]]: backend application iteration and runtime-image changes do not always require the same rebuild work.

Sources: [Development.md:157-162](repo://Development.md#L157-L162), [openhands/runtime/impl/docker/docker_runtime.py:170-185](repo://openhands/runtime/impl/docker/docker_runtime.py#L170-L185)

## Backend linting and type checks

`make lint-backend` runs pre-commit against all files using `dev_config/python/.pre-commit-config.yaml`. Its dependency installs the hook configuration first. Hook installation also unsets an existing `core.hooksPath` before running pre-commit installation. These targets perform environment and hook setup as well as validation, which matters when choosing an individual command in an existing checkout.

Sources: [Makefile:185-193](repo://Makefile#L185-L193)

The hook configuration includes whitespace and end-of-file checks, YAML validation, debug-statement detection, pyproject formatting and validation, Ruff linting and formatting, and mypy. Ruff linting is configured with fixes and unsafe fixes enabled. Mypy always runs against `openhands/` using the repository's mypy configuration rather than accepting only changed filenames. Several hooks exclude third-party and enterprise code, with broader exclusions on whitespace checks.

Sources: [dev_config/python/.pre-commit-config.yaml:1-56](repo://dev_config/python/.pre-commit-config.yaml#L1-L56)

## Run Python unit tests

The unit-test README gives the full local suite command:

Sources: [tests/unit/README.md:3-9](repo://tests/unit/README.md#L3-L9)

```bash
poetry run pytest ./tests/unit
```

Sources: [tests/unit/README.md:7-9](repo://tests/unit/README.md#L7-L9)

Pytest configuration disables its warnings plugin, uses automatic asyncio mode and gives asyncio fixtures function scope. Tests can also be selected by file or test name using the pytest invocation pattern documented in the unit-test README. Use paths from the actual checkout: event-stream coverage is under `tests/unit/events`, and agent behavior coverage is under `tests/unit/agenthub`.

Sources: [pytest.ini:1-4](repo://pytest.ini#L1-L4), [tests/unit/README.md:11-27](repo://tests/unit/README.md#L11-L27), [tests/unit/events/test_event_stream.py:47-88](repo://tests/unit/events/test_event_stream.py#L47-L88), [tests/unit/agenthub/test_agents.py:50-87](repo://tests/unit/agenthub/test_agents.py#L50-L87)

The event-stream suite demonstrates temporary local storage, serialized event assertions and rehydrating another stream with the same session ID. Agent fixtures demonstrate constructing an LLM registry from application configuration, parameterizing agent classes and replacing the live model with a mock. These examples provide existing seams for checking the contracts documented in [[Events and Persistence]] and [[Agent Control Loop]].

Sources: [tests/unit/events/test_event_stream.py:38-88](repo://tests/unit/events/test_event_stream.py#L38-L88), [tests/unit/agenthub/test_agents.py:50-78](repo://tests/unit/agenthub/test_agents.py#L50-L78)

## Frontend validation

| Command | Checks or behavior |
| --- | --- |
| `make lint-frontend` | Installs frontend dependencies and runs the package lint script |
| `npm run lint` in `frontend` | Type generation and TypeScript, ESLint and Prettier checks |
| `npm run test` in `frontend` | Runs Vitest |
| `npm run test:coverage` in `frontend` | Generates translations and runs Vitest coverage |
| `npm run test:e2e` in `frontend` | Runs Playwright |
| `make test` | Delegates to frontend tests |

Sources: [Makefile:195-197](repo://Makefile#L195-L197), [Makefile:237-242](repo://Makefile#L237-L242), [frontend/package.json:69-81](repo://frontend/package.json#L69-L81)

The frontend staged-file configuration runs ESLint and Prettier fixes on JavaScript and TypeScript, invokes staged type checking for TypeScript files and checks translation completeness for source changes. The normal lint script includes type checking, while `lint:fix` contains the formatter and linter fix commands. Generated translation data also participates in development, build and coverage scripts.

Sources: [frontend/package.json:63-93](repo://frontend/package.json#L63-L93)

## Extend agents and runtimes

An agent subclass implements `step(State) -> Action`, can supply its own `config_model` and declares runtime plugin requirements through `sandbox_plugins`. Agent registration rejects duplicate names; lookup rejects missing names. Configuration can register custom agents through a `classpath`, resolved as an `Agent` implementation during loading. Importing agenthub loads its built-in agent modules so those registrations can take effect.

Sources: [openhands/controller/agent.py:34-47](repo://openhands/controller/agent.py#L34-L47), [openhands/controller/agent.py:104-109](repo://openhands/controller/agent.py#L104-L109), [openhands/controller/agent.py:120-150](repo://openhands/controller/agent.py#L120-L150), [openhands/core/config/utils.py:796-816](repo://openhands/core/config/utils.py#L796-L816), [openhands/agenthub/__init__.py:6-14](repo://openhands/agenthub/__init__.py#L6-L14)

A runtime implements action execution and file-transfer methods on the shared `Runtime` interface, including command, interpreter, read, write, edit, browser and MCP operations. Runtime selection supports built-in names and implementation resolution through `get_impl`. Keep action and observation semantics aligned with [[Runtime and Workspace]] when adding a backend. Condensers have their own configuration registry and `condense` contract, described in [[Memory and Microagents]], so a context strategy can be changed independently of execution.

Sources: [openhands/runtime/base.py:1034-1085](repo://openhands/runtime/base.py#L1034-L1085), [openhands/runtime/__init__.py:90-103](repo://openhands/runtime/__init__.py#L90-L103), [openhands/memory/condenser/condenser.py:91-115](repo://openhands/memory/condenser/condenser.py#L91-L115), [openhands/memory/condenser/condenser.py:129-166](repo://openhands/memory/condenser/condenser.py#L129-L166)
