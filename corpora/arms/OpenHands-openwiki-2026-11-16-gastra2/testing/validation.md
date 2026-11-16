---
type: testing
title: Testing and evaluation workflows
description: Selecting focused Python, runtime, frontend, browser, and benchmark checks and understanding evaluation output, resumption, and retry semantics.
tags: [testing, evaluation, pytest, vitest, benchmarks]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:43:51.947Z
sources:
  - id: openwiki-source-748f1c2eceae5df4ffb430ce
    resource: repo://.github/workflows/py-tests.yml
  - id: openwiki-source-e9782d8a3dbab78b339d8b49
    resource: repo://evaluation/benchmarks/swe_bench/run_infer.py
  - id: openwiki-source-d4b750c106630831a4b427d4
    resource: repo://evaluation/utils/shared.py
  - id: openwiki-source-2090dca405aa9c3acd6c7ff8
    resource: repo://frontend/playwright.config.ts
  - id: openwiki-source-378e3cf05ab0d05d335c68d5
    resource: repo://frontend/vite.config.ts
  - id: openwiki-source-e44eab9a26f9187df819fc2a
    resource: repo://pytest.ini
generated: { by: "codex", at: "2026-11-16T17:43:51.947Z" }
---

# Testing and evaluation workflows

Choose validation at the boundary changed. Unit tests isolate event/control/configuration behavior; runtime tests execute real tools; browser tests exercise presentation and transport; benchmarks assess agent performance on tasks. A passing unit suite does not establish that a sandbox image works or that a model solves a benchmark.

## Focused checks

After development dependencies are installed, run these from the repository root unless indicated otherwise:

| Change | Useful first check |
| --- | --- |
| Controller transitions, limits, pending actions | `poetry run pytest tests/unit/controller/test_agent_controller.py` |
| Event identity, storage, filtering, redaction | `poetry run pytest tests/unit/events/test_event_stream.py` |
| Configuration precedence | `poetry run pytest tests/unit/core/config/test_config_precedence.py` |
| Prompt history or condenser | `poetry run pytest tests/unit/memory` |
| Server startup and session lifecycle | `poetry run pytest tests/unit/server/session` |
| Real shell behavior | `poetry run pytest tests/runtime/test_bash.py` |
| Frontend component or hook | In `frontend/`: `npm test -- <test-file>` |
| Frontend types and routing | In `frontend/`: `npm run typecheck` |

Use `::test_name` for a narrower pytest case. The root `pytest.ini` sets automatic asyncio mode and function-scoped default async fixture loops. Full Python unit coverage is `poetry run pytest tests/unit`; Linux CI installs the dev/test/runtime groups and uses forked parallel pytest execution. Start serially for easier local failure diagnosis, then reproduce the relevant CI mode if concurrency is implicated.

`make lint-backend` runs the configured pre-commit checks and installs dependencies/hooks as prerequisites. Frontend `npm run lint` combines type checking, ESLint, and formatting checks. `npm run build` also generates translations before the React Router build. These commands have broader scope than a single behavioral test.

## Real runtime tests

`tests/runtime/conftest.py` selects Docker by default via `TEST_RUNTIME`. The suite covers persistent shell behavior, file operations, browser and Jupyter interaction, environment setup, and resource cleanup. Runtime prerequisites are real: Docker needs its daemon and images; remote backends need their service configuration. A local run executes with host access.

For the CLI shell path used in Linux CI:

```bash
TEST_RUNTIME=cli poetry run pytest tests/runtime/test_bash.py
```

Run relevant tests against every runtime whose implementation changed. A transport mock can verify request formation but cannot establish shell persistence, permissions, or plugin startup.

## Frontend and end-to-end layers

Frontend unit tests run Vitest with jsdom and `vitest.setup.ts`. The frontend Playwright configuration starts `npm run dev:mock` on port 3001 and exercises a mocked application; its result does not validate a live model or sandbox.

The Python suite under `tests/e2e/` targets a running OpenHands instance through Playwright. Its documented setup includes provider and model credentials and an explicit base URL. Use the existing test environment and selected scenario, for example the settings and conversation-start cases documented in that directory. These tests can create real conversation work and consume model/runtime resources.

`evaluation/integration_tests/` is another layer: task-based tests subclass `BaseIntegrationTest`, initialize a runtime, let the agent act, and verify the resulting workspace/history. These are agent evaluations rather than replacements for deterministic controller unit tests.

## Benchmark harness contract

Benchmark-specific `run_infer.py` code defines dataset loading, prompts, runtime preparation, output extraction, and scoring inputs. Shared `EvalMetadata` records model/agent settings, iteration limits, output location, source commit, and optional dataset/condenser information. `EvalOutput` carries an instance ID, test result, history, metrics, error, and optional input instance.

`prepare_dataset` reads existing output JSONL and removes instance IDs already present. It does not require those rows to represent successful resolutions. `update_progress` appends and flushes one JSON result per completed instance. Preserve the output directory and inspect error rows when resuming; otherwise a previously recorded failure can be skipped as already processed.

`run_evaluation` uses multiprocessing when worker count exceeds one. Its wrapper retries exceptions with a configurable maximum, optionally constrains wall time, and tracks runtime failures. When retries are exhausted, the default is to raise and stop. `EVAL_SKIP_MAXIMUM_RETRIES_EXCEEDED=true` instead records the skipped instance in `maximum_retries_exceeded.jsonl` and returns an error output. Do not silently treat skipped infrastructure failures as ordinary benchmark scores.

## SWE-Bench as a representative flow

SWE-Bench builds instance-specific configuration and runtime setup, invokes `run_controller`, extracts changes, and records model history and metrics. It chooses a configured condenser through `EVAL_CONDENSER`; without one, this runner uses `NoOpCondenserConfig`. Benchmark configuration is constructed by the runner and shared helpers, so arbitrary process-level settings are not guaranteed to carry through unchanged.

Use `evaluation/benchmarks/swe_bench/README.md` and its scripts for inference and subsequent benchmark grading. Begin with a small instance subset and one worker to verify dataset, image, model, and output configuration before scaling. Preserve the source revision and effective model/condenser settings for reproducibility; successful inference alone is not a passing benchmark verdict.

See [quickstart](../quickstart.md), [agent control](../concepts/agents-llms.md), and [runtime architecture](../architecture/runtime.md).
