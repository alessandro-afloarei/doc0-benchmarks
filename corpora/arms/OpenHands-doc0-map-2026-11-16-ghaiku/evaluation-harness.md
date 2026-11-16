---
title: "Evaluation Harness"
---
## Overview

The evaluation harness runs the agent over a dataset of benchmark instances and writes one result line per instance. Each benchmark under `evaluation/benchmarks` supplies a `process_instance` function that runs one instance. The shared code in `evaluation/utils/shared.py` does the rest: it builds the run's metadata, selects the instances, runs them with retries and an optional timeout, and writes the results. The agent runs through the same controller and runtime as the server, configured by `get_openhands_config_for_eval`.

Sources: [evaluation/utils/shared.py:44-80](repo://evaluation/utils/shared.py#L44-L80) [evaluation/utils/shared.py:486-500](repo://evaluation/utils/shared.py#L486-L500) [evaluation/utils/shared.py:708-716](repo://evaluation/utils/shared.py#L708-L716)

## Run metadata

`EvalMetadata` holds the agent class, the LLM configuration, the iteration limit and the output directory for one run. `EvalOutput` is one result: the instance and its outcome. `make_metadata` builds the metadata from the run's arguments, and the GAIA runner calls it before it prepares the dataset.

Sources: [evaluation/utils/shared.py:44-80](repo://evaluation/utils/shared.py#L44-L80) [evaluation/utils/shared.py:164-175](repo://evaluation/utils/shared.py#L164-L175) [evaluation/benchmarks/gaia/run_infer.py:338-346](repo://evaluation/benchmarks/gaia/run_infer.py#L338-L346)

## Choosing instances

`prepare_dataset` asserts that the dataset has an `instance_id` column and logs the output path. When an instance limit is set, it draws that many instances at random with the fixed seed 42, which makes a limited run repeatable.

Sources: [evaluation/utils/shared.py:219-235](repo://evaluation/utils/shared.py#L219-L235) [evaluation/utils/shared.py:248-260](repo://evaluation/utils/shared.py#L248-L260)

## Running one instance

`_process_instance_wrapper` calls the benchmark's `process_instance` in a loop of `max_retries + 1` attempts. When a timeout is set, the attempt runs under a timeout that raises `EvalTimeoutException`, and that instance is recorded as timed out without further retries. On the last attempt, the wrapper records the error in an `EvalOutput`. The wrapper also checks the error text against the fatal-runtime test, which decides whether a failure is retried.

Sources: [evaluation/utils/shared.py:387-400](repo://evaluation/utils/shared.py#L387-L400) [evaluation/utils/shared.py:404-430](repo://evaluation/utils/shared.py#L404-L430) [evaluation/utils/shared.py:470-480](repo://evaluation/utils/shared.py#L470-L480)

`is_fatal_evaluation_error` and `is_fatal_runtime_error` take an error string and return whether it is one of the fatal kinds.

Sources: [evaluation/utils/shared.py:626-651](repo://evaluation/utils/shared.py#L626-L651) [evaluation/utils/shared.py:652-669](repo://evaluation/utils/shared.py#L652-L669)

## Running the batch

`run_evaluation` takes the prepared dataset and the `process_instance` function. It runs in a multiprocessing pool when more than one worker is requested, and in the calling process otherwise. It appends each result to the output file as it finishes, and it shows progress as the instances complete.

Sources: [evaluation/utils/shared.py:486-512](repo://evaluation/utils/shared.py#L486-L512) [evaluation/utils/shared.py:513-530](repo://evaluation/utils/shared.py#L513-L530)

## The GAIA example

The GAIA runner shows the pattern. `process_instance` builds a config for the instance, gives the instance its own log file under `infer_logs`, and picks a workspace path for any attached file. Its `__main__` block builds the metadata, prepares the dataset from the GAIA tests, writes to `output.jsonl` in the run's output directory, and calls `run_evaluation`.

Sources: [evaluation/benchmarks/gaia/run_infer.py:160-181](repo://evaluation/benchmarks/gaia/run_infer.py#L160-L181) [evaluation/benchmarks/gaia/run_infer.py:308-370](repo://evaluation/benchmarks/gaia/run_infer.py#L308-L370)

Other benchmarks define the same function. Among them are `swe_bench/run_infer_interact.py`, `toolqa`, `discoverybench`, `agent_bench` and `biocoder`, each with its own `process_instance` at the line where its runner begins.

Sources: [evaluation/benchmarks/swe_bench/run_infer_interact.py:118-118](repo://evaluation/benchmarks/swe_bench/run_infer_interact.py#L118-L118) [evaluation/benchmarks/toolqa/run_infer.py:83-83](repo://evaluation/benchmarks/toolqa/run_infer.py#L83-L83) [evaluation/benchmarks/discoverybench/run_infer.py:223-223](repo://evaluation/benchmarks/discoverybench/run_infer.py#L223-L223) [evaluation/benchmarks/agent_bench/run_infer.py:169-169](repo://evaluation/benchmarks/agent_bench/run_infer.py#L169-L169) [evaluation/benchmarks/biocoder/run_infer.py:237-237](repo://evaluation/benchmarks/biocoder/run_infer.py#L237-L237)
