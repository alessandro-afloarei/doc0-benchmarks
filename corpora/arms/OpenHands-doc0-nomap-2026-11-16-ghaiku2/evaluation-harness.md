---
title: "Evaluation Harness"
---
## Overview

The `evaluation` folder runs the agent over batches of tasks and records what happened, so that agents and models can be compared. It has one shared harness in `evaluation/utils/shared.py`, and about thirty benchmark folders under `evaluation/benchmarks`, each with a `run_infer.py` that describes its own tasks. A benchmark supplies a dataset, an instruction for each task, a runtime setup and a way to score the result; the harness supplies the loop, the workers, the retries and the output file. It drives the same controller and runtime as the server, which is described on [[Agent Controller]] and [[Runtime Core]].

Sources: [evaluation/README.md:1-12](repo://evaluation/README.md#L1-L12), [evaluation/utils/shared.py:1-44](repo://evaluation/utils/shared.py#L1-L44)

## Running a benchmark

A benchmark's `run_infer.py` builds the run's metadata with `make_metadata`, which records the LLM config, the dataset name, the agent class, the iteration limit and a note. It then calls `prepare_dataset`, which reads the output file if it exists, skips the instances already finished there, and limits the count to the requested number. The main call is `run_evaluation`.

Sources: [evaluation/utils/shared.py:164-218](repo://evaluation/utils/shared.py#L164-L218), [evaluation/utils/shared.py:219-291](repo://evaluation/utils/shared.py#L219-L291), [evaluation/benchmarks/swe_bench/run_infer.py:834-870](repo://evaluation/benchmarks/swe_bench/run_infer.py#L834-L870)

`run_evaluation` takes the dataset, the metadata, the output file, the number of workers, the per-instance function and the retry and timeout limits. With more than one worker it uses a process pool and passes each instance to the wrapper in another process. With one worker it runs them in a loop. Each finished result is written to the output file as it arrives, so a stopped run keeps its results.

Sources: [evaluation/utils/shared.py:486-551](repo://evaluation/utils/shared.py#L486-L551), [evaluation/utils/shared.py:292-307](repo://evaluation/utils/shared.py#L292-L307)

## Per-instance work

The wrapper calls the benchmark's per-instance function and retries it when the error is not fatal. An `EvalException` marks a failure that should be retried. After the maximum number of retries, the instance is logged as skipped with the reason, and a result is still written for it.

Sources: [evaluation/utils/shared.py:387-480](repo://evaluation/utils/shared.py#L387-L480), [evaluation/utils/shared.py:317-371](repo://evaluation/utils/shared.py#L317-L371)

The error classes are sorted by `is_fatal_evaluation_error` and `is_fatal_runtime_error`, which compare the error text with a list of known messages. A fatal error stops retries for that instance at once, because retrying would not change the outcome. The SWE-bench runner is an example of the per-instance function: it creates a runtime for the instance, starts it, and runs the controller on the instance's instruction. A runtime failure raises the sandbox's resource factor for the next attempt, up to a limit of eight.

Sources: [evaluation/utils/shared.py:626-669](repo://evaluation/utils/shared.py#L626-L669), [evaluation/benchmarks/swe_bench/run_infer.py:606-660](repo://evaluation/benchmarks/swe_bench/run_infer.py#L606-L660)

## Scoring

Scoring is a separate step per benchmark. The SWE-bench folder has `eval_infer.py`, which holds the scoring code for its output and starts with `process_git_patch` for the patches. The harness reports the metrics of the run through `get_metrics`, which prefers the conversation statistics and falls back to the metrics in the agent's state.

Sources: [evaluation/benchmarks/swe_bench/eval_infer.py:43-72](repo://evaluation/benchmarks/swe_bench/eval_infer.py#L43-L72), [evaluation/utils/shared.py:670-691](repo://evaluation/utils/shared.py#L670-L691)

## Sandbox and configuration

Every benchmark uses the same sandbox defaults, set by `get_default_sandbox_config_for_eval`, and builds its controller configuration with `get_openhands_config_for_eval`. These defaults are the place to change the runtime or the timeout for all benchmarks at once.

Sources: [evaluation/utils/shared.py:692-781](repo://evaluation/utils/shared.py#L692-L781)

## Integration tests

The `integration_tests` folder is a separate set of checks. Each test is a `tXX_name.py` file that subclasses `BaseIntegrationTest`, and `run_infer.py` in that folder runs the tests against the agent. The tests check the agent's behaviour rather than scoring a dataset.

Sources: [evaluation/integration_tests/README.md:1-20](repo://evaluation/integration_tests/README.md#L1-L20), [evaluation/integration_tests/run_infer.py:1-30](repo://evaluation/integration_tests/run_infer.py#L1-L30)

## Benchmark catalogue

The benchmark folders group by what they measure. Software tasks include `swe_bench` and its variants, `multi_swe_bench`, `commit0`, `testgeneval` and `nocode_bench`. Web and browsing tasks include `webarena`, `visualwebarena`, `miniwob` and `browsing_delegation`. Reasoning and knowledge tasks include `gaia`, `gpqa`, `logic_reasoning` and `toolqa`. The rest cover data science, biology, terminal use and a few company-task suites. The agent for each run is chosen by name, from the registry described on [[Agents and the Agent Registry]].

Sources: [evaluation/benchmarks/swe_bench/run_infer.py:1-40](repo://evaluation/benchmarks/swe_bench/run_infer.py#L1-L40), [evaluation/README.md:12-30](repo://evaluation/README.md#L12-L30)
