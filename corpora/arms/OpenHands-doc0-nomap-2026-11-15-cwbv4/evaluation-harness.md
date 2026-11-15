---
title: "Evaluation Harness"
---
## Overview

The `evaluation/` folder measures how well OpenHands agents solve tasks. It holds about thirty benchmark integrations (SWE-bench and its variants, WebArena, GAIA, the Agent Company, Terminal-Bench, HumanEvalFix and others), a set of shared utilities that every benchmark uses to run instances in parallel and record results, and a small suite of integration tests for OpenHands itself. Each benchmark runs the real agent and runtime through the programmatic API of [[Headless Mode]], one sandbox per instance.

Sources: [evaluation/README.md:1-20](repo://evaluation/README.md#L1-L20), [evaluation/utils/shared.py:486-551](repo://evaluation/utils/shared.py#L486-L551)

## Configuring a run

Evaluation scripts read only the LLM sections of `config.toml`; everything else is set by the benchmark's own code. A run names an LLM group (for example `llm.eval_gpt4_1106_preview`) on the command line, and condenser groups such as `[condenser.summarizer_for_eval]` can be selected with `EVAL_CONDENSER`; without one, the history is not condensed.

Sources: [evaluation/README.md:22-76](repo://evaluation/README.md#L22-L76)

```toml
[llm.eval_gpt4_1106_preview_llm]
model = "gpt-4-1106-preview"
api_key = "XXX"
temperature = 0.0
```

Sources: [evaluation/README.md:30-46](repo://evaluation/README.md#L30-L46)

Common command-line options come from the evaluation parser: output directory, number of instances (`--eval-n-limit`), number of workers, a note added to the output path, and explicit instance ids.

Sources: [openhands/core/config/arg_utils.py:67-99](repo://openhands/core/config/arg_utils.py#L67-L99), [openhands/core/config/arg_utils.py:218-224](repo://openhands/core/config/arg_utils.py#L218-L224)

## Shared utilities

### Metadata and outputs

`make_metadata` creates the output folder `<output dir>/<dataset>/<agent>/<model>_maxiter_<n>[_N_<note>]` with a `logs` subfolder and writes `metadata.json`: agent class, LLM and agent configs, iteration limit, start time, git commit, dataset and split, condenser config and instruction template. Each instance produces an `EvalOutput` line in `output.jsonl` with the instance id, the benchmark-specific `test_result`, the instruction, the metadata, the history, metrics and any error.

Sources: [evaluation/utils/shared.py:44-79](repo://evaluation/utils/shared.py#L44-L79), [evaluation/utils/shared.py:164-216](repo://evaluation/utils/shared.py#L164-L216)

### Selecting instances

`prepare_dataset` requires an `instance_id` column, skips instances already present in the output file so interrupted runs resume, and then keeps the ids given with `--eval-ids`, or skips the first instances, or samples `--eval-n-limit` instances with a fixed random seed of 42 so samples are reproducible.

Sources: [evaluation/utils/shared.py:219-290](repo://evaluation/utils/shared.py#L219-L290)

### Running instances

`run_evaluation(dataset, metadata, output_file, num_workers, process_instance_func, max_retries, timeout_seconds)` runs the benchmark's `process_instance` for every instance, in a multiprocessing pool when there are several workers, appending each result to the output file as it completes.

Sources: [evaluation/utils/shared.py:486-551](repo://evaluation/utils/shared.py#L486-L551)

Each call is wrapped for robustness. A per-instance timeout uses `SIGALRM` and records a timeout error. Other exceptions are retried up to `max_retries` times, five seconds apart; runtime disconnection errors increment a `runtime_failure_count` passed to benchmarks that accept it (SWE-bench doubles the remote runtime resource factor per failure, up to 8). After the last retry the run stops, unless `EVAL_SKIP_MAXIMUM_RETRIES_EXCEEDED=true`, in which case the instance is logged and skipped.

Sources: [evaluation/utils/shared.py:85-104](repo://evaluation/utils/shared.py#L85-L104), [evaluation/utils/shared.py:387-483](repo://evaluation/utils/shared.py#L387-L483), [evaluation/utils/shared.py:317-385](repo://evaluation/utils/shared.py#L317-L385)

`is_fatal_evaluation_error` recognises runtime failures (build, timeout, unavailable, not ready, disconnected, not found, connection errors) in a state's last error, so a benchmark can raise and have the instance retried instead of recording an infrastructure failure as a wrong answer.

Sources: [evaluation/utils/shared.py:626-668](repo://evaluation/utils/shared.py#L626-L668)

### Defaults for evaluation runs

`get_default_sandbox_config_for_eval` gives generous limits: a 300-second action timeout, a 30-second no-output timeout in the shell, an hour for remote runtimes to start, the `sysbox` runtime class, and the remote API URL and key from the environment. `get_openhands_config_for_eval` builds the rest of the config from the metadata. `update_llm_config_for_completions_logging` turns on completion logging into the instance's log folder, and `get_metrics` collects metrics from the conversation stats together with the condenser's metadata.

Sources: [evaluation/utils/shared.py:692-740](repo://evaluation/utils/shared.py#L692-L740), [evaluation/utils/shared.py:594-613](repo://evaluation/utils/shared.py#L594-L613), [evaluation/utils/shared.py:670-690](repo://evaluation/utils/shared.py#L670-L690)

### The fake user

`codeact_user_response` answers the agent whenever it asks for input: keep working, use the finish tool with the final answer (optionally inside `<solution>` tags), and never ask for human help. After the agent has asked twice, it adds that the agent may give up by finishing. A benchmark can pass a parser that ends the run with `/exit` as soon as the last action contains an answer.

Sources: [evaluation/utils/shared.py:106-153](repo://evaluation/utils/shared.py#L106-L153)

## Anatomy of a benchmark

### The run_infer.py pattern

Each benchmark has a `run_infer.py` with the same parts, shown here for SWE-bench:

Sources: [evaluation/benchmarks/swe_bench/run_infer.py:606-630](repo://evaluation/benchmarks/swe_bench/run_infer.py#L606-L630)

| Function | Role in SWE-bench |
| --- | --- |
| `get_config(instance, metadata)` | uses the instance's official Docker image as `base_container_image`, the evaluation sandbox defaults, completion logging, and an agent config without Jupyter |
| `get_instruction(instance, metadata)` | renders the issue statement into the task message |
| `initialize_runtime(runtime, instance, metadata)` | exports `SWE_INSTANCE_ID`, configures git, and prepares the repository in `/workspace` |
| `complete_runtime(runtime, instance)` | collects `git diff` of the agent's changes as the patch |
| `process_instance(instance, metadata, ...)` | creates and connects the runtime, runs `run_controller`, and returns an `EvalOutput` |
| `__main__` | loads the dataset, `make_metadata`, `prepare_dataset`, `run_evaluation` |

Sources: [evaluation/benchmarks/swe_bench/run_infer.py:206-266](repo://evaluation/benchmarks/swe_bench/run_infer.py#L206-L266), [evaluation/benchmarks/swe_bench/run_infer.py:268-300](repo://evaluation/benchmarks/swe_bench/run_infer.py#L268-L300), [evaluation/benchmarks/swe_bench/run_infer.py:437-470](repo://evaluation/benchmarks/swe_bench/run_infer.py#L437-L470), [evaluation/benchmarks/swe_bench/run_infer.py:606-712](repo://evaluation/benchmarks/swe_bench/run_infer.py#L606-L712), [evaluation/benchmarks/swe_bench/run_infer.py:747-833](repo://evaluation/benchmarks/swe_bench/run_infer.py#L747-L833), [evaluation/benchmarks/swe_bench/run_infer.py:834-870](repo://evaluation/benchmarks/swe_bench/run_infer.py#L834-L870)

### Running and scoring separately

`process_instance` does not score the patch: the agent may have changed tests or the environment, so SWE-bench stores only the patch and scores it later in a clean environment with its separate evaluation script. A fatal runtime error in the final state raises so the instance is retried.

Sources: [evaluation/benchmarks/swe_bench/run_infer.py:644-690](repo://evaluation/benchmarks/swe_bench/run_infer.py#L644-L690)

### Iterative mode

SWE-bench can also run several attempts per instance, scoring each with the `AgentFinishedCritic` (see [[Stuck Detection]]) and rerunning only instances whose attempt did not finish, with temperature raised to 0.1 after the first attempt so retries differ.

Sources: [evaluation/benchmarks/swe_bench/run_infer.py:878-916](repo://evaluation/benchmarks/swe_bench/run_infer.py#L878-L916)

## Integration tests

`evaluation/integration_tests` checks end-to-end that an agent can do basic tasks: fixing a typo, writing a bash script, writing a file from Jupyter, staging with git, browsing a page, reading a GitHub PR through the browser, and handling interactive commands. Each test file defines a `BaseIntegrationTest` subclass with an `INSTRUCTION`, an `initialize_runtime` that prepares the sandbox, and a `verify_result` that inspects the runtime and history and returns a `TestResult`.

Sources: [evaluation/integration_tests/tests/base.py:9-32](repo://evaluation/integration_tests/tests/base.py#L9-L32), [evaluation/integration_tests/tests/t01_fix_simple_typo.py:1-20](repo://evaluation/integration_tests/tests/t01_fix_simple_typo.py#L1-L20)

`run_infer.py` loads every `t*.py` file as an instance, runs it through the same `run_evaluation` machinery, and calls the test's `verify_result` to fill `test_result`.

Sources: [evaluation/integration_tests/run_infer.py:69-150](repo://evaluation/integration_tests/run_infer.py#L69-L150), [evaluation/integration_tests/run_infer.py:152-180](repo://evaluation/integration_tests/run_infer.py#L152-L180)
