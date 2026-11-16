---
type: workflow
title: Evaluation and issue resolution workflows
description: Benchmark configuration, resumable JSONL inference, runtime isolation, separate scoring, and issue-to-patch and pull-request resolution.
tags: [evaluation, benchmarks, resolver, workflows, trajectories]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:50:03.393Z
sources:
  - id: openwiki-source-0e47ed60da864008f08a91c7
    resource: repo://.github/workflows/openhands-resolver.yml
  - id: openwiki-source-e9782d8a3dbab78b339d8b49
    resource: repo://evaluation/benchmarks/swe_bench/run_infer.py
  - id: openwiki-source-d4b750c106630831a4b427d4
    resource: repo://evaluation/utils/shared.py
  - id: openwiki-source-0aa9c8cee8d147e243969427
    resource: repo://openhands/resolver/issue_resolver.py
  - id: openwiki-source-52a4a23cdc5525a9cbbefc83
    resource: repo://openhands/resolver/send_pull_request.py
generated: { by: "codex", at: "2026-11-16T06:50:03.393Z" }
---

# Evaluation and issue resolution workflows

Benchmarks and the issue resolver reuse headless agent execution but own task preparation, environments, outputs, and result interpretation. Benchmark completion is not necessarily a passed benchmark; resolver success is an assessment attached to a generated patch.

## Benchmark lifecycle

Most benchmark implementations live under `evaluation/benchmarks/<benchmark>/`, with a local README, inference entrypoint, and scoring scripts. Shared utilities provide EvalMetadata, EvalOutput, dataset preparation, worker execution, logging, retries, and metrics.

Metadata records agent, LLM configuration, iteration limit, dataset/split, Git commit, start time, condenser, and additional details. Output records identify an instance and carry a test-result payload, instruction, metadata, history, metrics, and error. Shared metadata creation writes `metadata.json` and organizes results under dataset/agent/model-and-limit directories.

`prepare_dataset` requires `instance_id`, reads existing output JSONL, and skips already-recorded IDs. Explicit ID selection takes priority; positive limits use a fixed random seed of 42 for sampling. Each completed result is appended and flushed. Multiple workers use unordered process-pool results, so output order is not dataset order.

The common wrapper retries instance failures and tracks fatal runtime failures. After retry exhaustion, it normally raises and stops the run; `EVAL_SKIP_MAXIMUM_RETRIES_EXCEEDED=true` records a skipped/error result and a separate retry-exhaustion JSONL. Resuming from the same output treats recorded error IDs as finished too, so inspect artifacts when deliberately rerunning failed instances. The optional per-instance timeout is forwarded in the multiprocess path; the current sequential runner does not pass it to the wrapper.

## Configuration is benchmark-owned

Inference generally selects a named LLM group from TOML, but creates core/sandbox/agent configuration in code. Do not assume all interactive settings are inherited. The shared evaluation factory uses local `.eval_sessions` storage, chooses runtime from an argument or `RUNTIME`, and supplies evaluation-specific sandbox settings.

SWE-Bench is a representative flow:

1. Select an instance-specific image and resource factor.
2. Construct sandbox and agent settings, including the selected condenser, logging, and routing.
3. Create/connect a runtime and prepare the benchmark repository/environment.
4. Build the instruction and call `run_controller` with that runtime and a synthetic user-response function.
5. Extract the Git patch and close the runtime in a finally block.
6. Store patch, history, metrics, and last error in EvalOutput.

Its default agent config disables Jupyter, MCP, and prompt extensions and makes browsing explicit. A fatal evaluation error raises EvalException to trigger retry; repeated runtime failures can increase the requested resource factor.

SWE-Bench inference deliberately does not score edits in the agent-modified environment. `scripts/eval_infer.sh` and neighboring scoring tools evaluate generated patches separately. Preserve the original dataset, split, code revision, model profile, condenser, and output when comparing runs.

## Launching and inspecting a benchmark

After development setup and the required evaluation dependencies, inspect the benchmark README and script arguments. The SWE-Bench wrapper accepts model profile, commit, agent, sample limit, iteration limit, workers, dataset, split, and additional run/mode arguments. `EVAL_CONDENSER` selects a named condenser. The shell wrapper invokes revision-control helpers, so inspect it before using it in a working checkout.

For a first run, use a small explicit instance/sample set and one worker. Examine inference logs, completion logs, JSONL errors, extracted patches, and then scoring output. More workers increase concurrent runtime and provider demand. This workflow is distinct from [unit and runtime validation](../testing/validation.md).

## Issue resolver: patch generation and publication

`python -m openhands.resolver.resolve_issue --selected-repo OWNER/REPO --issue-number NUMBER` runs IssueResolver. It selects provider-specific issue/PR handlers for GitHub, GitLab, or Bitbucket, clones a source repository, records its base commit, prepares a workspace/runtime, and builds task instructions from the issue or selected comments.

The resolver calls the headless controller, extracts a patch, asks the handler to assess success from issue/history/patch, and writes ResolverOutput to `output/output.jsonl`. Records include issue, type, base commit, patch, history, metrics, success indicators, explanation, and error. An issue number already present in that output is skipped.

Publication is a separate `openhands.resolver.send_pull_request` stage. It applies the recorded patch, commits it, and either updates an existing PR or pushes a new branch and optionally creates a draft/ready PR. Failed resolution is skipped unless send-on-failure is enabled. The supported publication types are branch, draft, and ready.

The repository workflow triggers on configured labels and authorized collaborator/member/owner mentions in comments/reviews, plus reusable workflow calls. It requests repository write permissions and invokes both inference and publication, so it has external side effects beyond generating artifacts. Its standard install path selects the latest released package; testing workflow behavior does not automatically test the checked-out Python implementation.

## Extension and verification

A new benchmark needs stable instance IDs, explicit environment preparation, a result contract, deterministic scoring where possible, and runtime cleanup. New resolver behavior belongs in provider handlers, prompt construction, patch extraction/application, or publication depending on ownership.

Focused tests include `tests/unit/evaluation/`, `tests/unit/resolver/test_resolve_issue.py`, `test_issue_handler_factory.py`, `test_patch_apply.py`, and `test_patch_whitespace.py`. Trace shared execution through [architecture](../architecture/execution.md), model behavior through [agents and LLMs](../concepts/agents-llm.md), and credentials through [providers](../integrations/tools-providers.md).
