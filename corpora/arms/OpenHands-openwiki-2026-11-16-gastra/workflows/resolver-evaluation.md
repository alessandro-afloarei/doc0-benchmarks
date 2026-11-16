---
type: workflow
title: Issue resolution and evaluation workflows
description: How issue resolution and benchmark harnesses reuse the controller, collect patches and trajectories, resume work, and separate inferred success from test outcomes.
tags: [resolver, evaluation, benchmarks, headless]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T08:14:39.912Z
sources:
  - id: openwiki-source-0bf97259e526f4dc00d43ff4
    resource: repo://evaluation/integration_tests/run_infer.py
  - id: openwiki-source-d4b750c106630831a4b427d4
    resource: repo://evaluation/utils/shared.py
  - id: openwiki-source-0aa9c8cee8d147e243969427
    resource: repo://openhands/resolver/issue_resolver.py
  - id: openwiki-source-52a4a23cdc5525a9cbbefc83
    resource: repo://openhands/resolver/send_pull_request.py
generated: { by: "codex", at: "2026-11-16T08:14:39.912Z" }
---

# Issue resolution and evaluation workflows

Issue resolution and evaluation both reuse the agent/controller/runtime stack. Their orchestration differs: the resolver packages an issue or review into instructions and captures a patch; an evaluation harness prepares benchmark instances and records structured results. Neither a finished agent state nor a generated patch alone proves correctness.

## Resolver entrypoint and artifact flow

`python -m openhands.resolver.resolve_issue` parses repository, issue number, optional comment, issue/PR type, output directory, model, and runtime options, then invokes `IssueResolver.resolve_issue`. The handler factory selects GitHub, GitLab, or Bitbucket issue/PR implementations behind common service contexts.

The resolver extracts the issue, validates requested comment context, creates output/log directories, and clones the repository into `<output_dir>/repo` if that directory is absent. It records the checkout's HEAD as the base commit. An existing checkout is therefore meaningful state; reusing an output directory is not equivalent to cloning the newest remote HEAD.

It checks `output.jsonl` for a previously processed issue number and skips that issue when found. Processing copies the checkout into an issue-specific workspace, creates/connects a runtime, configures Git, and runs repository setup/hooks. The handler supplies instructions and images, and `run_controller` receives the existing runtime plus an automated user-response callback.

After execution, completion stages workspace changes and captures `git diff --cached <base_commit>`, retrying diff collection with longer timeouts. The result contains the issue, instructions, base commit, patch, serialized history, metrics, success fields, explanation, and error.

Success is assessed through the issue handler's `guess_success` using history, issue context, and patch. Treat that as the resolver's assessment, not as proof that a project's independent test suite passed.

## Publication is a separate workflow

`openhands.resolver.send_pull_request` consumes resolver output, applies patches, creates commits/branches, pushes, and may create or update a pull request. Modes distinguish branch-only, draft, and ready PR publication. Unsuccessful resolver output is skipped unless `send_on_failure` is enabled.

These operations change remote repositories and can post comments. The example automation workflow combines resolution and publication, but generating/reviewing resolver artifacts and publishing them are distinct stages. The relevant unit tests mock provider behavior and exercise patch application, issue handling, title escaping, and publication conditions.

## Evaluation data and resumability

The shared evaluation utilities define:

| Object | Purpose |
| --- | --- |
| `EvalMetadata` | Agent/model config, iteration limit, Git commit, output directory, dataset/split and optional strategy details |
| `EvalOutput` | Instance ID, test result, optional instruction/history/metrics/input, and error |
| `prepare_dataset` | Select instances and exclude IDs already recorded in output |
| `run_evaluation` | Execute instances serially or with a worker pool and append results |

Dataset preparation requires an `instance_id` column. Existing JSONL output supplies finished IDs. Explicit IDs take precedence over skip/limit selection; limit sampling uses a fixed random seed. Reusing an output file therefore resumes based on recorded IDs, not by checking whether the current model/config matches an earlier run.

Each completed result is appended as one JSON line and flushed. Multiworker results arrive through `imap_unordered`, so output order need not match dataset order. Use instance IDs for joins and comparisons.

## Retry, timeout, and failure semantics

The instance wrapper permits an initial attempt plus configured retries for exceptions, waits between failures, and tracks fatal runtime failures for callbacks that accept `runtime_failure_count`. A wrapper timeout returns an error-bearing EvalOutput. At exhausted retries, the default raises and stops evaluation; `EVAL_SKIP_MAXIMUM_RETRIES_EXCEEDED=true` instead records/skips through the dedicated helper.

There is a current call-path distinction: the multiprocess path forwards `timeout_seconds` to the wrapper, while the serial path in `run_evaluation` omits it. Do not assume the shared timeout argument bounds single-worker execution identically. Benchmark-specific timeout handling may add its own limits.

Separate environment failure, provider failure, agent failure, and benchmark verification failure when interpreting results. A retry can rerun environment setup and model interaction; it is not merely a retry of writing an output line.

## Integration tasks and benchmark extension

`evaluation/integration_tests/run_infer.py` initializes a task runtime, calls the controller, checks nonempty history, invokes the task's `verify_result`, records metrics/history, and closes the runtime in a `finally` block. Task classes define `initialize_runtime`, an instruction, and `verify_result`. Benchmarks under `evaluation/benchmarks/` provide their own adapters and scoring conventions.

For new tasks, make setup reproducible and verification explicit. Preserve the input ID, Git revision, config, history, and result fields needed to distinguish code regressions from model variation. The repository's integration runner script accepts a model config, Git version, agent, instance limit, worker count, and optional IDs; consult its current parser before automating large runs.

Focused checks live under `tests/unit/resolver/` and `tests/unit/evaluation/`. See [agent control](../architecture/agent-control.md), [runtime](../architecture/runtime.md), and [testing](../testing/validation.md) for the shared contracts and environment requirements.
