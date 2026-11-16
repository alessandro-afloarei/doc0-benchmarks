---
type: architecture
title: Evaluation Harness and Benchmarks
description: How the evaluation/ tree runs OpenHands agents headlessly against benchmark datasets, including the shared runner with retries, timeouts, and multiprocessing, the per-benchmark run_infer and scoring scripts, LLM and condenser configuration for evaluations, and the integration test suite.
tags: [evaluation, benchmarks, swe-bench, run-infer, metrics, multiprocessing, integration-tests]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T11:08:31.416Z
sources:
  - id: openwiki-source-e9782d8a3dbab78b339d8b49
    resource: repo://evaluation/benchmarks/swe_bench/run_infer.py
  - id: openwiki-source-b2fcefff62615b684f3fdca9
    resource: repo://evaluation/README.md
  - id: openwiki-source-d4b750c106630831a4b427d4
    resource: repo://evaluation/utils/shared.py
generated: { by: "claude-code", at: "2026-11-16T11:08:31.416Z" }
---

# Evaluation Harness and Benchmarks

The `evaluation/` tree drives OpenHands without a user. Each benchmark supplies a dataset of tasks,
a way to prepare the workspace for each task, and a way to decide whether the result is correct. The
shared harness in `evaluation/utils/shared.py` runs each task through the same agent core that the
server and CLI use, then writes one record per task. The harness does not change how agents behave; it
only controls the inputs, the configuration, and the output.

The directory contains 30 benchmark folders under `evaluation/benchmarks/`. They range from software
engineering datasets such as `swe_bench`, `commit0`, and `multi_swe_bench`,
to general assistant benchmarks such as `gaia`, `webarena`, `visualwebarena`, and `miniwob`, and to
domain datasets such as `biocoder`, `bird`, and `gpqa`.

## Running a benchmark

[`evaluation/README.md`](../../evaluation/README.md) describes the workflow. Each benchmark folder has a README
and a `run_infer.py` script. The usual sequence is:

1. set up the development environment (see `Development.md`);
2. configure the LLM in `config.toml`. **For evaluation, only the `[llm]` section, including named
   variants such as `[llm.eval_...]`, is applied.** Other settings such as `save_trajectory_path`
   are not applied during evaluation;
3. optionally define named condensers (`[condenser.*]`) for benchmarks that support them;
4. run the benchmark's `run_infer.py`, passing the agent name (one of the classes registered in the
   agent registry; see [Agents, Tools, and Microagents](../architecture/agents-and-tools.md)).

Configuration for evaluations is built by `get_openhands_config_for_eval` (`shared.py:708`), which
starts from `get_default_sandbox_config_for_eval` (`shared.py:692`) and takes the runtime from the
environment (`RUNTIME`), defaulting to `docker`.

## The shared runner

### Metadata and outputs

`EvalMetadata` (`shared.py:44`) records everything needed to reproduce a run: agent class, LLM config,
optional agent config, max iterations, output directory, start time, git commit, dataset, split,
condenser config, and an instruction template name. `EvalOutput` (`shared.py:59`) is one result record.
`make_metadata` (`shared.py:164`) builds the metadata, and `prepare_dataset` (`shared.py:219`) loads and
filters the dataset.

### Per-instance execution

`_process_instance_wrapper` (`shared.py:387`) wraps a benchmark's `process_instance` function with:

- up to `max_retries` attempts (default 5), with the reason for each failure recorded;
- a timeout per instance (`timeout`, `shared.py:90`), raising `EvalTimeoutException`;
- classification of errors. `is_fatal_evaluation_error` (`shared.py:626`) and `is_fatal_runtime_error`
  (`shared.py:652`) identify failures that should not be retried.

`codeact_user_response` (`shared.py:106`) is the user-response function used by benchmarks where the
agent may ask a question mid-task.

### The run loop

`run_evaluation` (`shared.py:486`) runs every instance in the dataset:

- with `num_workers > 1` it uses a `multiprocessing` pool (`shared.py:510-520`), otherwise it runs
  serially;
- results are appended to a JSON Lines output file as each instance completes, and a progress bar is
  updated (`update_progress`, `shared.py:292`);
- logs are reset per worker so that log files do not interleave (`reset_logger_for_multiprocessing`,
  `shared.py:552`).

Records are appended as each instance finishes, so partial results survive an interrupted run.
`check_maximum_retries_exceeded` (`shared.py:372`) reports instances that have exhausted their retries.

### Metrics

`get_metrics` (`shared.py:670`) returns the run's metrics. It prefers the combined
`ConversationStats` metrics and falls back to the state's own metrics for older runs, and adds
condensation metadata to the result. These metrics include the token and cost totals reported by the
LLM layer (see [LLM Layer](../architecture/llm-layer.md)).

## A benchmark: SWE-bench

`evaluation/benchmarks/swe_bench/run_infer.py` is representative of the pattern:

- `get_config` (`run_infer.py:206`) builds the per-instance `OpenHandsConfig`, including the container
  image for the instance (`get_instance_docker_image`, `run_infer.py:178`).
- `initialize_runtime` (`run_infer.py:268`) prepares the workspace for the instance.
- `process_instance` (`run_infer.py:606`) creates the runtime, runs the agent with `run_controller`
  using the instruction from `get_instruction` (`run_infer.py:109`), and then calls
  `complete_runtime` (`run_infer.py:437`) to collect the git patch the agent produced. On a runtime
  failure it retries with a larger remote resource factor, recorded in the metadata
  (`process_instance` parameter `runtime_failure_count`).
- `evaluation/benchmarks/swe_bench/eval_infer.py` prepares the collected patches for scoring
  (`process_git_patch` at line 43, `process_instance` at line 103).

Other benchmarks follow the same shape. `gaia` adds `scorer.py` and `get_score.py` for scoring the
agent's final answers. Benchmarks with browser environments depend on the browser
runtime described in [Runtime Abstraction and Execution Backends](../architecture/runtime.md).

## Integration tests

`evaluation/integration_tests/` holds scenario tests that were previously run in continuous integration
and are now run as scheduled evaluations, because they call a real LLM. Each test is a module named
`tXX_<name>.py` under `tests/`, which subclasses `BaseIntegrationTest` (`tests/base.py`). The subclass
implements `initialize_runtime` to set up the task and `verify_result`, which receives the runtime and
the event history and returns a `TestResult` with `success` and an optional `reason`. The directory
contains numbered test modules, starting with `t01_fix_simple_typo.py`. `run_infer.py` in this
directory is the entry point for running them.

## Operational consequences

- Evaluation results depend on the LLM and condenser configuration in `config.toml` at the time of the
  run. The `EvalMetadata` record is the place to check what was used.
- Running with more workers multiplies sandbox and LLM usage. Each worker starts its own runtime.
- Retries can hide flakiness. Read `check_maximum_retries_exceeded` and the per-attempt records before
  comparing scores between runs.

## Extension seams

- New benchmark: create a folder under `evaluation/benchmarks/`, with a `get_config`, an instance
  setup, a `process_instance` that returns an `EvalOutput`, and a `run_infer.py` that calls
  `run_evaluation`.
- New scorer: add a script next to `run_infer.py` that reads the JSON Lines output.

## Tests

The harness has unit tests under `tests/unit/evaluation/`. Benchmark-specific behavior is exercised by
running the benchmark on a small dataset, as described in the benchmark's README.

## Related pages

- [Agents, Tools, and Microagents](../architecture/agents-and-tools.md)
- [Memory, Context Condensation, and Conversation Memory](../workflows/memory-and-condensation.md)
- [Testing and CI](../operations/testing-and-ci.md)
