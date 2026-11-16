---
type: "Reference"
title: "Evaluation Harness and Benchmarks"
openwiki_generated: true
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:30:54.023Z
sources:
  - id: openwiki-source-67020df43fd1eccb40b97756
    resource: repo://.github/workflows/integration-runner.yml
  - id: openwiki-source-e9782d8a3dbab78b339d8b49
    resource: repo://evaluation/benchmarks/swe_bench/run_infer.py
  - id: openwiki-source-7b42a6bcfc122a3b0b8f5a5e
    resource: repo://evaluation/integration_tests/README.md
  - id: openwiki-source-d4b750c106630831a4b427d4
    resource: repo://evaluation/utils/shared.py
generated: { by: "claude-code", at: "2026-11-16T18:30:54.023Z" }
---


# Evaluation Harness and Benchmarks

`evaluation/` runs OpenHands agents against benchmark datasets to measure them. It is a separate tree from the product code, but it uses the same backend. Each benchmark runs the agent through the same headless entry point the CLI and the issue resolver use, `openhands.core.main.run_controller`, so a benchmark result reflects the real agent loop, runtime, and LLM layer rather than a simplified replica.

<!-- openwiki: broken internal link [/openwiki/operations/development-and-testing.md] link "/openwiki/operations/development-and-testing.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`evaluation/README.md` documents the user workflow. Set up the development environment (see [Development, Testing, and Quality Gates](/openwiki/operations/development-and-testing.md)), configure the model in `config.toml`, and run the benchmark's `run_infer.py`. The README says only the `[llm]` section, including named LLM variants, applies during evaluation; other settings such as `save_trajectory_path` are ignored.

## Layout

<!-- openwiki: broken internal link [/openwiki/architecture/agents-and-prompting.md] link "/openwiki/architecture/agents-and-prompting.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`evaluation/benchmarks/` contains 30 benchmark directories, each with a `run_infer.py` and usually its own prompts, config, and output scripts. The largest include SWE-bench (about 57 files), TestGenEval, MINT, Multi-SWE-bench, NoCode-bench, VersiCode, DiscoveryBench, AlgoTune, WebArena, VisualWebArena, GAIA, Commit0, and Terminal-Bench. Some directories are small adapters, for example `browsing_delegation/`, which exercises the agent-to-browsing-agent delegation path (see [Agents, Prompting, and Delegation](/openwiki/architecture/agents-and-prompting.md)).

`evaluation/utils/` holds the shared code (`shared.py`) and some scripts (token-usage aggregation, remote-runtime cleanup, version control helpers). `evaluation/integration_tests/` holds the agent integration tests. `evaluation/static/` holds documentation assets.

## Shared harness

`evaluation/utils/shared.py` provides the pieces every benchmark uses:

- **`EvalMetadata`** (~L44) is the run's configuration record: the agent class, the `LLMConfig`, an optional `AgentConfig`, `max_iterations`, the output directory, start time, git commit, dataset and split, and an optional condenser config. It is written with the outputs so a result can be traced to the configuration that produced it.
- **`EvalOutput`** (~L59) is the per-instance record: the instance, the agent's history (as serialized events), its metrics, its test result, and any error.
- **`make_metadata`** (~L164) builds the metadata from the command line and `config.toml`. `prepare_dataset` (~L219) loads the instances, checks that each has an `instance_id`, and limits the set when `eval_n_limit` is given.
- **`run_evaluation`** (~L486) runs a benchmark's `process_instance` function over the dataset. It runs in a single process when `num_workers` is 1 and uses multiprocessing otherwise, with a logger reset for each child (`reset_logger_for_multiprocessing`, ~L552). It writes each finished result to the output file and skips instances already present, so an interrupted run resumes.
- **Retries and failures**: `_process_instance_wrapper` (~L387) retries an instance up to `max_retries` (default 5). `is_fatal_evaluation_error` (~L626) decides which errors are fatal and should trigger a re-run of the whole instance, and `check_maximum_retries_exceeded` (~L372) and `log_skipped_maximum_retries_exceeded` (~L317) record instances that never succeeded.
- **Timeouts**: a `timeout(seconds)` decorator (~L90) bounds an instance's wall time, and `timeout_seconds` on `run_evaluation` applies it per instance.
- **Helpers**: `codeact_user_response` (~L106) supplies a scripted user reply for agents that ask questions during a benchmark run, and `update_llm_config_for_completions_logging` (~L594) turns on completion logging for analysis.

## How a benchmark run is structured

A benchmark's `run_infer.py` follows one pattern, shown by SWE-bench's `process_instance` (`evaluation/benchmarks/swe_bench/run_infer.py`, ~L606-L700):

1. `get_config` (~L206) builds an `OpenHandsConfig` for the instance, including the sandbox image for it (`get_instance_docker_image`, ~L178).
2. `create_runtime(config)` (`openhands/core/main.py`) creates the runtime for the instance.
3. `initialize_runtime` (~L268) prepares the sandbox for the instance before the agent runs.
4. `run_controller(config, initial_user_action=..., runtime=runtime, fake_user_response_fn=...)` (~L647) runs the agent until it reaches a terminal state, with a scripted user response function selected per agent class.
5. `complete_runtime` (~L437) collects the result inside the sandbox: a patch, test output, or the agent's final message, depending on the benchmark.
6. `runtime.close()` runs in a `finally` block, so the sandbox is released even when the agent fails.
7. The function assembles the `EvalOutput`, with the history from `state.history` (the agent's events, including delegate events) and metrics from `get_metrics(state)`.

Each benchmark's module provides the instance-specific parts (prompt text in `get_instruction`, the environment setup, and the scoring). The harness supplies everything else.

## Integration tests

`evaluation/integration_tests/` is a smaller suite of end-to-end checks. Each test is a `tXX_name.py` file with a subclass of `BaseIntegrationTest` (`tests/base.py`). The subclass implements `initialize_runtime`, which sets up the sandbox, and `verify_result`, which takes the runtime and the event history and returns a `TestResult` with `success` and an optional `reason`. The suite covers a simple typo fix, adding a bash command, Jupyter file writing, git staging, simple browsing, a GitHub pull-request browse, and interactive commands. Its README says the tests were removed from the pull-request CI because they need live LLM access, and they are intended for scheduled runs.

## CI

Two workflows drive evaluations (`.github/workflows/`):

- `run-eval.yml` triggers a remote evaluation job. It sets the evaluation parameters, triggers the remote job, and reports the result back as a comment on an issue or pull request.
- `integration-runner.yml` runs the integration tests. It is started by the `integration-test` label, by a manual dispatch, or on a schedule.

## Invariants and failure behavior

- Each instance has a fresh runtime, and `runtime.close()` runs in a `finally` block, so one instance's sandbox does not leak into another.
- A result is written once an instance finishes, and an interrupted run resumes from the output file rather than starting over.
- Fatal evaluation errors cause a retry; errors that exceed `max_retries` are recorded as skipped rather than failing the whole run.
- The per-instance timeout bounds each run, which keeps one stuck agent from blocking the rest of the dataset.

## Extension seams

- A new benchmark is a directory under `evaluation/benchmarks/` with a `run_infer.py` that provides `get_config`, `initialize_runtime`, `complete_runtime`, and `process_instance`, and calls `run_evaluation`.
- A new scripted-user behavior is a `fake_user_response_fn` for an agent class in the benchmark's mapping.
- A new integration test is a `tXX_*.py` file under `evaluation/integration_tests/tests/`.

## Related pages

<!-- openwiki: broken internal link [/openwiki/workflows/conversation-lifecycle.md] link "/openwiki/workflows/conversation-lifecycle.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Conversation Lifecycle, End to End](/openwiki/workflows/conversation-lifecycle.md)
<!-- openwiki: broken internal link [/openwiki/workflows/cli-and-headless.md] link "/openwiki/workflows/cli-and-headless.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [CLI and Headless Execution](/openwiki/workflows/cli-and-headless.md)
<!-- openwiki: broken internal link [/openwiki/architecture/agent-controller.md] link "/openwiki/architecture/agent-controller.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Agent Controller and Step Loop](/openwiki/architecture/agent-controller.md)
<!-- openwiki: broken internal link [/openwiki/operations/development-and-testing.md] link "/openwiki/operations/development-and-testing.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Development, Testing, and Quality Gates](/openwiki/operations/development-and-testing.md)
