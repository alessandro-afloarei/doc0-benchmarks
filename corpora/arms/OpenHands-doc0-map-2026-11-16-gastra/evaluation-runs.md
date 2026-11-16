---
title: "Evaluation Runs"
---
## Overview

Evaluation scripts supply benchmark-specific configuration, task preparation and scoring around a shared runner. The shared layer creates metadata, filters datasets, retries instance callbacks and appends results. GAIA provides a concrete example: it prepares question attachments, drives the agent through the headless runner, extracts a final answer and compares it with ground truth. [[CLI and Headless Runs]] owns the underlying controller lifecycle.

Sources: [evaluation/utils/shared.py:164-216](repo://evaluation/utils/shared.py#L164-L216), [evaluation/utils/shared.py:219-289](repo://evaluation/utils/shared.py#L219-L289), [evaluation/utils/shared.py:486-549](repo://evaluation/utils/shared.py#L486-L549), [evaluation/benchmarks/gaia/run_infer.py:228-305](repo://evaluation/benchmarks/gaia/run_infer.py#L228-L305)

## Configure a benchmark explicitly

Benchmark configuration is assembled by its own script. The shared factory chooses the agent and iteration limit from metadata, defaults runtime selection from `RUNTIME` when no runtime is passed, and uses a local `.eval_sessions` store under the current directory. Sandbox defaults include a 300-second action timeout and disabled runtime retention. Do not assume that every ordinary application setting is copied into an evaluation configuration.

Sources: [evaluation/README.md:20-23](repo://evaluation/README.md#L20-L23), [evaluation/README.md:73-75](repo://evaluation/README.md#L73-L75), [evaluation/utils/shared.py:692-705](repo://evaluation/utils/shared.py#L692-L705), [evaluation/utils/shared.py:743-781](repo://evaluation/utils/shared.py#L743-L781)

GAIA explicitly selects Docker and a Python/Node base image, configures per-instance completion logging, and loads routing settings. Without an explicit agent configuration it disables prompt extensions. It separately loads the search API key from TOML. Its entry point requires a named LLM configuration and turns off `modify_params`. These are benchmark choices layered over the common configuration factory.

Sources: [evaluation/benchmarks/gaia/run_infer.py:64-97](repo://evaluation/benchmarks/gaia/run_infer.py#L64-L97), [evaluation/benchmarks/gaia/run_infer.py:323-351](repo://evaluation/benchmarks/gaia/run_infer.py#L323-L351)

After preparing the development environment described in [[Quickstart]], define the named LLM group used below and arrange access to the GAIA dataset. The repository's GAIA guide requires accepting the dataset terms and authenticating before downloading it. This direct invocation selects the agent, iteration limit, level, split, worker count and sample size explicitly.

Sources: [evaluation/README.md:7-12](repo://evaluation/README.md#L7-L12), [evaluation/benchmarks/gaia/README.md:18-19](repo://evaluation/benchmarks/gaia/README.md#L18-L19), [evaluation/benchmarks/gaia/scripts/run_infer.sh:39-50](repo://evaluation/benchmarks/gaia/scripts/run_infer.sh#L39-L50)

```bash
poetry run python evaluation/benchmarks/gaia/run_infer.py \
  --agent-cls CodeActAgent \
  --llm-config eval_model \
  --max-iterations 60 \
  --level 2023_level1 \
  --data-split validation \
  --eval-num-workers 1 \
  --eval-n-limit 10 \
  --eval-note local_check
```

Sources: [evaluation/benchmarks/gaia/scripts/run_infer.sh:39-50](repo://evaluation/benchmarks/gaia/scripts/run_infer.sh#L39-L50), [openhands/core/config/arg_utils.py:49-55](repo://openhands/core/config/arg_utils.py#L49-L55), [openhands/core/config/arg_utils.py:67-93](repo://openhands/core/config/arg_utils.py#L67-L93), [evaluation/benchmarks/gaia/run_infer.py:308-334](repo://evaluation/benchmarks/gaia/run_infer.py#L308-L334)

## Record metadata and resume work

`make_metadata` places results under the output root, dataset, agent class and a model/iteration/note directory. It records the Git commit, start time, model configuration, split and optional details, then writes `metadata.json`. The directory key does not automatically include the split, level or commit. Use distinct notes or output roots when those differ, so a previous result file does not unintentionally control a new run's resume behavior.

Sources: [evaluation/utils/shared.py:164-214](repo://evaluation/utils/shared.py#L164-L214), [evaluation/benchmarks/gaia/run_infer.py:338-363](repo://evaluation/benchmarks/gaia/run_infer.py#L338-L363)

Dataset preparation requires an `instance_id` column and reads finished IDs from an existing output JSONL file. Explicit IDs take precedence over skipping and sampling. Otherwise a positive sample limit selects rows without replacement using random seed 42. Finished IDs are removed after selection, so resuming a ten-instance sample can yield fewer than ten remaining tasks. Every persisted ID counts as finished, regardless of its score or error.

Sources: [evaluation/utils/shared.py:219-289](repo://evaluation/utils/shared.py#L219-L289)

GAIA downloads its dataset and attachment snapshot, selects the requested split, and renames `task_id` to `instance_id`. It passes the sample limit to the shared preparation helper, but does not pass the parser's optional evaluation IDs through this call. A flag appearing in the common parser therefore does not guarantee that a particular benchmark wires it into dataset selection.

Sources: [evaluation/benchmarks/gaia/run_infer.py:353-371](repo://evaluation/benchmarks/gaia/run_infer.py#L353-L371), [openhands/core/config/arg_utils.py:94-99](repo://openhands/core/config/arg_utils.py#L94-L99)

## Dispatch instances and write results

With more than one worker, `run_evaluation` uses a process pool and consumes results in completion order. With one worker it invokes the wrapper sequentially. Each returned result updates progress, is serialized as one JSONL record and is flushed immediately. Resume uses those records; multiprocessing result order should not be interpreted as dataset order.

Sources: [evaluation/utils/shared.py:292-305](repo://evaluation/utils/shared.py#L292-L305), [evaluation/utils/shared.py:486-538](repo://evaluation/utils/shared.py#L486-L538)

| Result field | Purpose |
| --- | --- |
| `instance_id` | Stable identity for resume and result lookup |
| `test_result` | Benchmark-specific score and supporting values |
| `metadata`, `instruction`, `instance` | Optional run and task context |
| `history` | Event history or compatibility action/observation pairs |
| `metrics`, `error` | Usage measurements and execution diagnostics |

Sources: [evaluation/utils/shared.py:59-78](repo://evaluation/utils/shared.py#L59-L78)

The wrapper calls the instance function synchronously and expects an `EvalOutput` result. GAIA bridges into async agent execution internally with `asyncio.run`. When adding a benchmark, follow that effective calling convention rather than returning an unawaited coroutine. The shared runner's callback annotation mentions an awaitable, but the wrapper itself does not await one.

Sources: [evaluation/utils/shared.py:387-410](repo://evaluation/utils/shared.py#L387-L410), [evaluation/utils/shared.py:486-495](repo://evaluation/utils/shared.py#L486-L495), [evaluation/benchmarks/gaia/run_infer.py:232-244](repo://evaluation/benchmarks/gaia/run_infer.py#L232-L244)

## Prepare and run a GAIA question

The callback builds its instruction from the question and any attached file. Non-image files are copied into the workspace and renamed to a predictable filename; ZIP contents are extracted and copied; JPG and PNG attachments are encoded into image URLs for the initial message. The prompt requests a concise answer enclosed in solution tags, and the CodeAct-specific response callback reinforces that answer format.

Sources: [evaluation/benchmarks/gaia/run_infer.py:111-146](repo://evaluation/benchmarks/gaia/run_infer.py#L111-L146), [evaluation/benchmarks/gaia/run_infer.py:174-225](repo://evaluation/benchmarks/gaia/run_infer.py#L174-L225), [evaluation/benchmarks/gaia/run_infer.py:55-61](repo://evaluation/benchmarks/gaia/run_infer.py#L55-L61)

GAIA creates and connects a runtime, initializes the workspace, then supplies it to `run_controller` with the prepared message and fake-user callback. A missing final state is an error. On the successful return path, it constructs an evaluation output containing scoring data, compatible history and metrics, then closes the runtime. The shown runtime close is at the end of that path rather than in a surrounding finally block, which matters when debugging exceptions during scoring.

Sources: [evaluation/benchmarks/gaia/run_infer.py:228-250](repo://evaluation/benchmarks/gaia/run_infer.py#L228-L250), [evaluation/benchmarks/gaia/run_infer.py:286-305](repo://evaluation/benchmarks/gaia/run_infer.py#L286-L305)

## Understand answer scoring

The callback searches history backward for the latest eligible agent finish, shell-command thought or message. It extracts the first solution-tag match and falls back to the raw answer when none is found. The result records the raw answer, parsed answer, ground truth and boolean score. This makes answer-format errors inspectable separately from the agent's execution history.

Sources: [evaluation/benchmarks/gaia/run_infer.py:252-285](repo://evaluation/benchmarks/gaia/run_infer.py#L252-L285)

The scorer chooses comparison rules from the ground truth. Numeric answers are compared as floats after removing dollar signs, percent signs and commas from the model answer. Lists must have equal lengths and match element by element in order. Plain strings are lowercased and stripped of whitespace and punctuation; string list elements retain punctuation. This is deterministic normalization and comparison, not an LLM judgment.

Sources: [evaluation/benchmarks/gaia/scorer.py:6-25](repo://evaluation/benchmarks/gaia/scorer.py#L6-L25), [evaluation/benchmarks/gaia/scorer.py:28-102](repo://evaluation/benchmarks/gaia/scorer.py#L28-L102)

Metrics prefer combined conversation statistics, fall back to legacy state metrics and attach condenser metadata. The GAIA score-summary utility counts truthy scores in JSONL records. It assumes a nonempty file and a score in every record, so timeout or skipped-error records with empty test results require separate accounting before using that utility.

Sources: [evaluation/utils/shared.py:670-689](repo://evaluation/utils/shared.py#L670-L689), [evaluation/benchmarks/gaia/get_score.py:5-24](repo://evaluation/benchmarks/gaia/get_score.py#L5-L24), [evaluation/utils/shared.py:364-369](repo://evaluation/utils/shared.py#L364-L369), [evaluation/utils/shared.py:411-426](repo://evaluation/utils/shared.py#L411-L426)

## Retries and failure accounting

The wrapper permits one initial attempt plus `max_retries`, defaulting to five retries, and waits five seconds between failures. It tracks recognized runtime failures and passes the count only to callbacks that accept that parameter. At exhaustion, the default is to raise and stop evaluation. Setting `EVAL_SKIP_MAXIMUM_RETRIES_EXCEEDED=true` instead logs the instance in `maximum_retries_exceeded.jsonl` and returns an error result with empty test data.

Sources: [evaluation/utils/shared.py:387-409](repo://evaluation/utils/shared.py#L387-L409), [evaluation/utils/shared.py:430-478](repo://evaluation/utils/shared.py#L430-L478), [evaluation/utils/shared.py:339-369](repo://evaluation/utils/shared.py#L339-L369)

An explicit wrapper timeout uses a signal alarm and returns an error result without retrying that timeout. In this checkout, `run_evaluation` forwards `timeout_seconds` only through the multiprocessing branch; its sequential branch omits the parameter. Error records written to the main result file will also be skipped by ordinary resume. To retry them after fixing a cause, use a fresh output destination or deliberately prepare a result file that excludes those IDs.

Sources: [evaluation/utils/shared.py:89-103](repo://evaluation/utils/shared.py#L89-L103), [evaluation/utils/shared.py:405-426](repo://evaluation/utils/shared.py#L405-L426), [evaluation/utils/shared.py:512-538](repo://evaluation/utils/shared.py#L512-L538), [evaluation/utils/shared.py:231-238](repo://evaluation/utils/shared.py#L231-L238), [evaluation/utils/shared.py:280-284](repo://evaluation/utils/shared.py#L280-L284)

