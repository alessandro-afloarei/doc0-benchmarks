---
type: workflow
title: Evaluation Harness and Benchmarks
description: How the evaluation/ harness runs OpenHands agents headlessly against benchmarks such as SWE-bench, the shared run_evaluation utilities (metadata, dataset sampling, retries, multiprocessing, output JSONL), LLM and condenser selection, the nightly integration tests, and the CI eval workflows.
tags: [evaluation, benchmarks, swe-bench, integration-tests, headless]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:35:38.671Z
sources:
  - id: openwiki-source-67020df43fd1eccb40b97756
    resource: repo://.github/workflows/integration-runner.yml
  - id: openwiki-source-af7d657aaad86130df6d129c
    resource: repo://.github/workflows/run-eval.yml
  - id: openwiki-source-e9782d8a3dbab78b339d8b49
    resource: repo://evaluation/benchmarks/swe_bench/run_infer.py
  - id: openwiki-source-e1fb15fcfcaaf39ba1bd609c
    resource: repo://evaluation/integration_tests/tests/base.py
  - id: openwiki-source-d4b750c106630831a4b427d4
    resource: repo://evaluation/utils/shared.py
generated: { by: "claude-code", at: "2026-11-16T07:35:38.671Z" }
---

# Evaluation Harness and Benchmarks

`evaluation/` contains benchmark adapters that drive OpenHands headlessly and score the results. Every benchmark reuses the same building blocks: `openhands.core.main.create_runtime` / `run_controller` ([Architecture Overview](../architecture/overview.md#assembly-headless-path)) and the helpers in `evaluation/utils/shared.py`.

## Benchmarks

Each subdirectory of `evaluation/benchmarks/` is self-contained (a `README.md`, `run_infer.py`, usually `scripts/run_infer.sh`, and scoring scripts):

- **Software engineering:** `swe_bench` (incl. SWE-bench Live, SWE-Gym, SWE-rebench, SWT-bench, interactive and localization variants), `multi_swe_bench`, `visual_swe_bench`, `nocode_bench`, `humanevalfix`, `bird`, `biocoder`, `ml_bench`, `gorilla` (APIBench), `toolqa`, `aider_bench`, `commit0`, `discoverybench`, `terminal_bench`, `testgeneval`, `lca_ci_build_repair`, `versicode`, `algotune`.
- **Web browsing:** `webarena`, `visualwebarena`, `miniwob`, `browsing_delegation`.
- **Assistance/reasoning:** `gaia`, `gpqa`, `agent_bench`, `mint`, `EDA`, `logic_reasoning`, `scienceagentbench`.
- **Real world:** `the_agent_company`.

Raw data and large outputs are not stored in the repo; results are published to the OpenHands Hugging Face evaluation space.

## The shared harness (`evaluation/utils/shared.py`)

A typical `run_infer.py`:

1. Parses arguments with `openhands.core.config.arg_utils` (`--agent-cls`, `--llm-config`, `--max-iterations`, `--eval-n-limit`, `--eval-num-workers`, `--eval-ids`, `--eval-note`, `--eval-output-dir`).
2. Resolves the LLM with `get_llm_config_arg(name)` — **only `[llm.*]` sections of `config.toml` are used for evaluation**; other settings (e.g. `save_trajectory_path`) are set programmatically in each benchmark's `get_config`.
3. Builds `EvalMetadata` (agent class, LLM config, agent config, max iterations, output dir, git commit, dataset/split, condenser config, instruction template) via `make_metadata`.
4. Calls `prepare_dataset(df, output_file, eval_n_limit, eval_ids, skip_num)`: requires an `instance_id` column, **skips instances already present in the output JSONL** (resumability), filters to explicit ids, or samples `eval_n_limit` instances with a fixed random seed (42).
5. Runs `run_evaluation(dataset, metadata, output_file, num_workers, process_instance_func, max_retries=5, timeout_seconds)`, which processes instances serially or in a `multiprocessing.Pool`, appends each `EvalOutput` as a JSON line, and shows a progress bar.

`EvalOutput` records `instance_id`, `test_result` (benchmark-specific, e.g. `git_patch`), `instruction`, `metadata`, `history` (trajectory), `metrics`, `error`, and optionally the original `instance`.

Per-instance retries (`_process_instance_wrapper`): exceptions are retried up to `max_retries`, with runtime-disconnect errors counted into `runtime_failure_count` (passed to the instance function if it accepts it, e.g. to request more resources). A timeout yields an errored `EvalOutput` without retrying. After the last retry, the run aborts with `RuntimeError` unless `EVAL_SKIP_MAXIMUM_RETRIES_EXCEEDED=true`, which logs and skips the instance.

`get_openhands_config_for_eval` / `get_default_sandbox_config_for_eval` provide eval defaults: runtime from `RUNTIME` (default `docker`), browser disabled, sandbox timeout 300s, remote-runtime settings (`SANDBOX_REMOTE_RUNTIME_API_URL`, `ALLHANDS_API_KEY`, long init timeouts, retries, `sysbox` class), and `keep_runtime_alive=False`.

`codeact_user_response` is the standard `fake_user_response_fn`: whenever the agent waits for input it is told to continue, use `finish`, optionally wrap answers in `<solution>` tags, and never ask for human help — allowing unattended runs (see [Agent Controller](../architecture/agent-controller.md)).

## Example: SWE-bench flow

`evaluation/benchmarks/swe_bench/run_infer.py`:

1. `get_config` builds an `OpenHandsConfig` with an instance-specific prebuilt container image.
2. `initialize_runtime` prepares the sandbox: shell environment, instance data under `/swe_util`, the benchmark's entry script, `git reset --hard` in `/workspace/<repo>`, and removal of git remotes.
3. `get_instruction` renders the problem statement into a `MessageAction` (prompt templates under `prompts/`).
4. `run_controller(..., fake_user_response_fn=...)` runs the agent.
5. `complete_runtime` stages changes and runs `git diff --no-color --cached <base_commit>` (with retries), strips binary diffs, and returns `{'git_patch': ...}` as `test_result`.
6. `eval_infer.py` / `scripts/eval_infer.sh` later applies patches and runs the official test harness to score.

Invocation:

```bash
./evaluation/benchmarks/swe_bench/scripts/run_infer.sh \
  llm.eval_gpt4o HEAD CodeActAgent 500 100 1 princeton-nlp/SWE-bench_Verified test
#  MODEL_CONFIG  COMMIT AGENT  LIMIT MAX_ITER WORKERS DATASET SPLIT
```

`EVAL_CONDENSER=<name>` selects a `[condenser.<name>]` section from `config.toml`; without it the evaluation uses the `noop` condenser. `ENABLE_LLM_EDITOR=true` enables the LLM-based editor with `[llm.draft_editor]`.

## Integration tests

`evaluation/integration_tests/` holds end-to-end agent tests (`tests/t01_fix_simple_typo.py` … `t07_interactive_commands.py`) — typo fixing, bash, Jupyter, git staging, browsing, GitHub PR browsing, interactive commands. Each subclasses `BaseIntegrationTest` with an `INSTRUCTION`, `initialize_runtime(runtime)`, and `verify_result(runtime, histories) -> TestResult`. They require a real LLM, so they run outside unit CI via `.github/workflows/integration-runner.yml` (PR label `integration-test`, manual dispatch, or nightly at 22:30 UTC).

## CI workflows

- `.github/workflows/run-eval.yml` — runs evaluations when a PR gets a `run-eval-*` label, after releases, or on manual dispatch (branch and instance-count inputs).
- `.github/workflows/integration-runner.yml` — integration tests as above.

## Tests of the harness

`tests/unit/evaluation/` (e.g. `test_eval_file_store_path.py`) unit-tests harness helpers.

## Related pages

- [Testing Guide](../testing/testing-guide.md)
- [Command-Line Interface](../interfaces/cli.md) — headless `openhands.core.main`
- [Configuration System](../configuration/config-system.md) — `[llm.*]` and `[condenser.*]` groups
- [Runtime Implementations](../runtime/runtime-implementations.md) — remote runtime used at scale
