---
type: testing
title: Testing and evaluation workflows
description: Focused Python and frontend tests, runtime integration checks and benchmark execution with resumable evaluation outputs.
tags: [testing, evaluation, ci, validation]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:55:05.802Z
sources:
  - id: openwiki-source-748f1c2eceae5df4ffb430ce
    resource: repo://.github/workflows/py-tests.yml
  - id: openwiki-source-d4b750c106630831a4b427d4
    resource: repo://evaluation/utils/shared.py
  - id: openwiki-source-2090dca405aa9c3acd6c7ff8
    resource: repo://frontend/playwright.config.ts
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
generated: { by: "codex", at: "2026-11-16T16:55:05.802Z" }
---

# Testing and evaluation workflows

## Choose the behavior boundary

| Change | Focused starting point | What it establishes |
| --- | --- | --- |
| Controller sequencing, limits, delegation | `tests/unit/controller/` | State and pending-action behavior with controlled dependencies |
| Event/schema/storage changes | `tests/unit/events/`, `tests/unit/storage/` | Serialization, identity and persistence contracts |
| Model adaptation and context | `tests/unit/llm/`, `tests/unit/memory/` | Tool conversion, retries, views and recall |
| Conversation/API/auth | `tests/unit/server/` | Routes, validation, sockets and session lifecycle |
| Runtime implementation | `tests/unit/runtime/`, then `tests/runtime/` | Adapter contracts, then actual execution/environment behavior |
| Browser workflow | Frontend service/component tests, then Playwright | Client handling and browser interaction |
| Task-solving quality | Benchmark-specific evaluation | Agent performance on actual tasks under selected model/runtime settings |

From the repository root, run a focused file before expanding scope:

```bash
poetry run pytest tests/unit/controller/test_agent_controller.py
poetry run pytest tests/unit/events/test_event_stream.py
poetry run pytest tests/unit
```

The root pytest configuration enables automatic asyncio handling and function-scoped asyncio fixture loops. Linux CI installs dev, test and runtime groups, builds the environment and runs unit tests with `--forked -n auto`. It separately exercises CLI bash runtime tests. Windows CI covers selected Windows bash behavior and local runtime execution, rather than the entire suite. Enterprise tests use the enterprise Poetry environment and import path.

`make test` currently delegates only to frontend tests. It is not the entrypoint for the whole Python suite.

## Frontend and runtime checks

From `frontend/`:

```bash
npm test -- src/services/__tests__/actions.test.ts
npm run typecheck
npm run lint
npm run test:e2e
```

Vitest runs with jsdom and `vitest.setup.ts`, and excludes the Playwright `tests/` directory. Playwright starts `dev:mock` on port 3001, with Chromium, Firefox and WebKit projects. Those browser tests validate mocked application flows; they do not establish that a real model/runtime executed a task. CI frontend checks build the app and collect unit coverage; lint also checks translations and TypeScript.

Runtime tests instantiate real execution environments and can operate on files, shells, browser and notebook tools. Their fixtures choose Docker by default through `TEST_RUNTIME`; choose a configured backend explicitly:

```bash
TEST_RUNTIME=cli poetry run pytest tests/runtime/test_bash.py
```

Verify backend dependencies, image availability and fixture teardown before expanding to all runtime tests. Mocked Docker unit tests cannot establish that a daemon can start the actual execution server.

## Evaluation lifecycle

Each benchmark's `run_infer.py` or shell wrapper supplies dataset preparation, task instructions, runtime setup, agent execution and result scoring. Inspect that benchmark's configuration construction: evaluation does not simply inherit all GUI or default core settings. Shared helpers create evaluation-specific settings and use a local `.eval_sessions` event store.

`prepare_dataset` requires `instance_id`, loads already-written JSONL IDs, applies explicit IDs or seeded sampling and excludes finished instances. `run_evaluation` appends outputs as instances complete; multiple workers use unordered multiprocessing results, so output order is not dataset order. Reusing an output file can skip prior instances: use a new output location when comparing materially different configurations.

The per-instance wrapper retries failures, can count runtime failures and can return a timeout error result. Exhausted retries normally stop the evaluation unless `EVAL_SKIP_MAXIMUM_RETRIES_EXCEEDED=true` enables recording/skipping them. In current code, the multiprocessing branch forwards `timeout_seconds`; the single-worker branch omits it. Do not rely on that argument providing an identical deadline in both paths.

Agent integration evaluations under `evaluation/integration_tests/` define an instruction plus runtime initialization and result verification. They exercise model-dependent behavior and require model credentials and an execution environment. Read the benchmark's result artifacts and verifier, not only whether inference exited successfully.

## Sources and navigation

Use [Python CI](../../.github/workflows/py-tests.yml), [frontend CI](../../.github/workflows/fe-unit-tests.yml), [runtime fixtures](../../tests/runtime/conftest.py), [Playwright configuration](../../frontend/playwright.config.ts) and [evaluation helpers](../../evaluation/utils/shared.py) as executable references. [evaluation/README.md](../../evaluation/README.md) routes to benchmark instructions.

Related: [agent loop](../concepts/agent-loop.md), [runtime architecture](../architecture/runtimes.md), [browser workflow](../workflows/frontend.md), [quickstart](../quickstart.md).
