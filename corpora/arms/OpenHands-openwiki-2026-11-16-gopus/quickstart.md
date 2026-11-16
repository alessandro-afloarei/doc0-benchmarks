---
type: overview
title: OpenHands Wiki Quickstart
description: Entry point to the OpenHands repository wiki — what OpenHands is, how the repository is organized, how to install, run, and test it, and a task-oriented map pointing to the page that covers each subsystem.
tags: [quickstart, overview, navigation, getting-started]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:35:38.671Z
sources:
  - id: openwiki-source-f1dae2c1abafd4f51485791d
    resource: repo://Development.md
  - id: openwiki-source-269fc6634b00dfcdd59e0be2
    resource: repo://enterprise/README.md
  - id: openwiki-source-47d02fca3524898d5aae2b3b
    resource: repo://LICENSE
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-ab3c6807c36a554faa63f162
    resource: repo://openhands/cli/entry.py
  - id: openwiki-source-a2c4f6dc92cf0cd76a23c3d8
    resource: repo://openhands/core/config/utils.py
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "claude-code", at: "2026-11-16T07:35:38.671Z" }
---

# OpenHands Wiki Quickstart

**OpenHands** (`openhands-ai`, v0.56.0, MIT) is a platform for AI software-development agents. An LLM-driven agent (CodeAct by default) works in a sandboxed environment where it can run shell commands, edit files, browse the web, call MCP tools, and talk to the user. You reach it through a web UI, a terminal CLI, a GitHub Action, or headless scripts. The [System Architecture Overview](architecture/overview.md) explains how the pieces fit together.

## Repository map

| Path | Contents |
| --- | --- |
| `openhands/` | Python backend: agents (`agenthub/`), `controller/`, `events/`, `llm/`, `memory/`, `microagent/`, `runtime/`, `server/`, `storage/`, `integrations/`, `mcp/`, `security/`, `resolver/`, `cli/`, `core/` (config, main loop, schema) |
| `frontend/` | React Router SPA served by the backend |
| `openhands-ui/` | `@openhands/ui` component library (published separately) |
| `microagents/` | Public microagents bundled into the package |
| `enterprise/` | Source-available SaaS server (Polyform Free Trial License, **not** MIT) |
| `evaluation/` | Benchmark harnesses (SWE-bench and many others) and integration tests |
| `tests/` | `unit/`, `runtime/` (real sandboxes), `e2e/` (Playwright) |
| `containers/`, `docker-compose.yml`, `kind/` | App, runtime, and dev images; compose; Kubernetes dev setup |
| `third_party/` | Optional runtimes (E2B, Modal, Runloop, Daytona) |
| `config.template.toml` | Annotated reference for every configuration option |
| `.openhands/microagents/` | Instructions for agents working on this repo (`repo.md`) |
| `docs/` | User documentation sources (synced to the docs site) |

## Run it

- **Packaged CLI/GUI:**
  - `uvx --python 3.12 --from openhands-ai openhands` runs the terminal UI.
  - `... openhands serve` runs the web GUI in Docker.

  See [Command-Line Interface](interfaces/cli.md).
- **Docker:** run the `openhands` app image with the Docker socket and `~/.openhands` mounted (see `README.md` and `docker-compose.yml`, or `make docker-run`). The app starts one runtime container per conversation ([Runtime Implementations](runtime/runtime-implementations.md)).
- **From source** ([Build, Packaging, and Deployment](operations/build-and-deploy.md)):
  1. Requirements: Linux, macOS, or WSL; Docker; Python 3.12; Node.js 22 or later; Poetry; tmux.
  2. `make build`
  3. `make setup-config`, or write `config.toml` with `[llm] model/api_key` ([Configuration System](configuration/config-system.md)).
  4. `make run` starts the backend on `:3000` and Vite on `:3001`. Use `RUNTIME=local` when you are already inside a container.
- **Headless single task:** `poetry run python -m openhands.core.main -t "your task"` ([CLI](interfaces/cli.md#headless-openhandscoremain)).

Configuration precedence is CLI flags, then environment variables, then `config.toml`, then defaults. In the web app, per-user settings layer on top of that.

## Test and lint

- `poetry run pytest ./tests/unit` runs backend unit tests (`asyncio_mode=auto`).
- `TEST_RUNTIME=docker poetry run pytest tests/runtime/test_bash.py` runs sandbox tests.
- `cd frontend && npm run test && npm run lint` runs frontend tests and lint.
- `pre-commit run --config ./dev_config/python/.pre-commit-config.yaml` runs backend lint.

Details are in the [Testing Guide](testing/testing-guide.md).

## Where to look

| If you need to… | Read |
| --- | --- |
| Understand the overall flow of a conversation | [System Architecture Overview](architecture/overview.md) |
| Change how events are stored, masked, or delivered | [Events and the Event Stream](architecture/event-stream.md) |
| Debug why the agent stopped, looped, or hit a limit | [Agent Controller and State](architecture/agent-controller.md) |
| Add a tool or agent, or change prompts or function calling | [Agents: CodeAct and the Agent Hub](agents/agenthub.md) |
| Add a model, or change retries, costs, or routing | [LLM Layer](architecture/llm-layer.md) |
| Control context size or summarization | [Conversation Memory and Condensers](architecture/memory-and-condensers.md) |
| Add repository or knowledge instructions | [Microagents](concepts/microagents.md) |
| Change how commands and files run in the sandbox | [Runtime Architecture](runtime/runtime-architecture.md) |
| Choose or add a sandbox backend, or build runtime images | [Runtime Implementations and Image Building](runtime/runtime-implementations.md) |
| Connect MCP servers or add PR tools | [MCP Integration](integrations/mcp.md) |
| Work on GitHub, GitLab, or Bitbucket support | [Git Provider Integrations](integrations/git-providers.md) |
| Automate fixes for issues or PRs | [Issue Resolver](integrations/issue-resolver.md) |
| Require human approval for risky actions | [Security Analyzers and Confirmation Mode](security/security-analyzers.md) |
| Add or understand config options | [Configuration System](configuration/config-system.md) |
| Work on REST or Socket.IO endpoints, sessions, or concurrency | [Web Server, Sessions, and Conversation Management](server/web-server.md) |
| Swap storage, auth, or settings backends | [Storage, Settings, Secrets, and Auth Extension Points](server/storage-and-settings.md) |
| Work on the UI | [Web Frontend and UI Component Library](frontend/web-ui.md) |
| Work on the terminal UI | [Command-Line Interface](interfaces/cli.md) |
| Understand the SaaS (OpenHands Cloud) code | [Enterprise (SaaS) Server](enterprise/saas-server.md) |
| Run or add benchmarks | [Evaluation Harness and Benchmarks](evaluation/benchmarks.md) |
| Build images, release, or understand CI | [Build, Packaging, and Deployment](operations/build-and-deploy.md) |
| Pick the right tests to run | [Testing Guide](testing/testing-guide.md) |

## Key ideas to keep in mind

- **Everything is an event.** Components coordinate only through the per-conversation `EventStream`. Every event is persisted, so conversations can be resumed and replayed.
- **The agent proposes and the runtime executes.** Agents never run code themselves. The controller publishes their actions, and the runtime returns observations.
- **Extension happens through class paths.** Agents, runtimes, stores, auth, conversation managers, git services, and MCP defaults are all resolved by name or classpath. That is how `enterprise/` customizes the open-source code without forking it.
