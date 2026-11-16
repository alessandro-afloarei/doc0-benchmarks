---
type: operations
title: Testing and Evaluation
description: Where the test suites live (Python unit, runtime, Playwright e2e, frontend vitest), how to run them locally and in CI, and how the evaluation harness in evaluation/ runs agents over benchmarks like SWE-bench with retries, workers and per-instance outputs.
tags: [testing, pytest, evaluation, benchmarks, swe-bench, ci]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:38:52.407Z
sources:
  - id: openwiki-source-748f1c2eceae5df4ffb430ce
    resource: repo://.github/workflows/py-tests.yml
  - id: openwiki-source-75309917114c0826d83dd5cf
    resource: repo://evaluation/benchmarks/swe_bench/README.md
  - id: openwiki-source-7b42a6bcfc122a3b0b8f5a5e
    resource: repo://evaluation/integration_tests/README.md
  - id: openwiki-source-b2fcefff62615b684f3fdca9
    resource: repo://evaluation/README.md
  - id: openwiki-source-d4b750c106630831a4b427d4
    resource: repo://evaluation/utils/shared.py
  - id: openwiki-source-e44eab9a26f9187df819fc2a
    resource: repo://pytest.ini
  - id: openwiki-source-76cf53525cb3c7251a79cd2b
    resource: repo://tests/runtime/conftest.py
generated: { by: "claude-code", at: "2026-11-16T09:38:52.407Z" }
---

# Testing and Evaluation

## Python tests

`pytest.ini` sets `asyncio_mode = auto` (async tests need no decorator), function-scoped event loops and `-p no:warnings`. Suites under `tests/`:

| Directory | Scope | Notes |
|---|---|---|
| `tests/unit/` | Fast, hermetic unit tests mirroring the package layout: `agenthub`, `cli`, `controller` (`test_agent_controller.py`, `test_agent_delegation.py`, `test_is_stuck.py`, `state/`), `core`, `events`, `integrations`, `llm` (`test_llm.py`, retry, `test_llm_fncall_converter.py`, `test_model_features.py`), `mcp`, `memory` (condensers), `microagent`, `resolver`, `runtime` (builders, impls, plugins, git hooks/tokens), `security`, `server`, `storage`, `utils`, plus `test_llm_registry.py`, `test_conversation_stats.py`. |
| `tests/runtime/` | Exercise a real runtime end-to-end: bash, IPython, ACI/LLM-based edit, browsing/BrowserGym, env vars, glob/grep, MCP actions, microagents, replay, resource limits, remote-runtime stress, docker image build. |
| `tests/e2e/` | Playwright UI tests (conversation, settings, resume, local runtime, browsing) with their own `pytest.ini`; need `GITHUB_TOKEN`, `LLM_MODEL`, `LLM_API_KEY` (optional `LLM_BASE_URL`). |
| `frontend/__tests__/`, `frontend/tests/` | vitest/Testing Library/MSW and Playwright ([Frontend](../clients/frontend.md)). |
| `enterprise/tests/` | Enterprise unit tests ([Enterprise](../enterprise/enterprise-saas.md)). |

Running locally (from `tests/unit/README.md`): `poetry run pytest ./tests/unit`, a single file, or a single test with `::name`; add `-v`/`-vv` for verbosity.

### Runtime tests parametrization

`tests/runtime/conftest.py` selects the runtime class from the **`TEST_RUNTIME`** environment variable: `docker` (alias `eventstream`, default → `DockerRuntime`), `local` (`LocalRuntime`), `remote` (`RemoteRuntime`) or `cli` (`CLIRuntime`); anything else raises. `RUN_AS_OPENHANDS` (default true) selects whether the sandbox user is `openhands` or root; `TEST_IN_CI` adjusts CI behavior. Module-scoped fixtures create a runtime per module and clean up workspace folders and containers (without removing all containers). This means the same test file validates every runtime implementation against the same behavior contract described in [Runtime](../runtime/runtime-and-sandbox.md).

### CI (`.github/workflows/py-tests.yml`)

On Linux: install Poetry deps (`--with dev,test,runtime`), `make build`, run unit tests with `PYTHONPATH=. poetry run pytest --forked -n auto -svv ./tests/unit` (process-isolated, parallel via xdist), then `TEST_RUNTIME=cli pytest tests/runtime/test_bash.py` against the CLI runtime. A Windows job runs the Windows bash tests (`tests/unit/runtime/utils/test_windows_bash.py`) and a few `LocalRuntime` runtime tests. Docker-dependent runtime tests are not part of this job. Frontend, e2e (label `end-to-end`), lint and image builds are in their own workflows ([Build and containers](build-and-containers.md)).

## Evaluation harness (`evaluation/`)

`evaluation/` benchmarks agents rather than the software: each benchmark directory has a `run_infer.py` (plus shell wrappers in `scripts/`) that loads a dataset, runs an agent on every instance in a fresh runtime and writes results; many also have an `eval_infer.py` that scores the outputs. Benchmarks include SWE-bench (and variants SWE-Gym, SWE-bench-Live, SWE-rebench, SWE-Interact, multimodal), SWT-bench, Multi-SWE-bench, HumanEvalFix, Aider bench, BioCoder, GAIA, GPQA, WebArena/VisualWebArena/MiniWoB, TheAgentCompany, TerminalBench, TestGenEval, commit0, ToolQA, and others. `evaluation/integration_tests/` holds small scenario tests (`tXX_name.py`, subclasses of `BaseIntegrationTest` with `initialize_runtime` and `verify_result`) that need an LLM, so they run as scheduled/nightly evaluations instead of in regular CI.

### Shared framework (`evaluation/utils/shared.py`)

- `EvalMetadata` (agent class, LLM config, max iterations, output dir, dataset, condenser config, ...) and `EvalOutput` (instance id, instruction, history, metrics, error, `test_result`) are the common schemas; `make_metadata` builds metadata and the per-run output directory.
- `prepare_dataset` filters out already-finished instances (resumable runs) and samples `eval_n_limit`.
- `run_evaluation(dataset, metadata, output_file, num_workers, process_instance_func, max_retries=5, timeout_seconds=None)` runs instances serially, or with a `multiprocessing.Pool` (`imap_unordered`) when `num_workers > 1`, appending each `EvalOutput` as a JSON line to `output.jsonl` with a progress bar.
- `_process_instance_wrapper` retries each instance up to `max_retries` times, passing a growing `runtime_failure_count` when the benchmark accepts it, applies an optional per-instance timeout (`EvalTimeoutException` yields an error output rather than a retry), and after the final failure either raises (stopping the run) or — when `EVAL_SKIP_MAXIMUM_RETRIES_EXCEEDED=true` — logs the instance to `maximum_retries_exceeded.jsonl` and continues. Fatal runtime errors are recognized via `is_fatal_runtime_error`.
- `get_default_sandbox_config_for_eval` and `get_openhands_config_for_eval` standardize the runtime setup: 300 s command timeout, no host network, `remote_runtime_class='sysbox'`, long remote init timeouts with retries, browser off by default, runtime taken from the `RUNTIME` env var (default `docker`), agent defaulting to `CodeActAgent`. `ALLHANDS_API_KEY` and `SANDBOX_REMOTE_RUNTIME_API_URL` configure the remote runtime used for parallel runs ([Runtime](../runtime/runtime-and-sandbox.md)).
- `codeact_user_response` provides the canned "keep going, finish with the finish tool" replies used for headless runs; per-instance trajectories come from `controller.get_trajectory` / the returned `State` of [`run_controller`](../clients/cli.md).

### Configuration for evaluation

Per `evaluation/README.md`: **only the LLM sections of `config.toml` are used** by evaluation (other settings such as `save_trajectory_path` are not applied), several `[llm.<name>]` groups can be defined and selected by name, and `[condenser.<name>]` groups can be defined for benchmarks that support them (for example `type = "llm"`, `keep_first`, `max_size`, see [Memory and condensation](../agents/memory-and-condensation.md)).

### SWE-bench flow

`evaluation/benchmarks/swe_bench/` has three steps: environment setup, **inference** (`run_infer.py` / `scripts/run_infer.sh` generates a patch per GitHub issue inside the instance's Docker image, locally or on a remote runtime) and **evaluation** of patches (`eval_infer.py`, using the SWE-bench docker harness). With `ITERATIVE_EVAL_MODE=true` each instance is attempted up to three times until the agent finishes with a patch (temperature 0 is bumped to 0.1 for retries). `.github/workflows/run-eval.yml` triggers evaluations on PRs with `run-eval-*` labels, after releases, or manually.

Related: [Build and containers](build-and-containers.md), [CLI and headless](../clients/cli.md), [Agent controller](../architecture/agent-controller.md).
