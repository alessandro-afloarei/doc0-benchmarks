---
type: workflow
title: Issue Resolver Workflow
description: The resolver pipeline that takes an issue or pull request from GitHub, GitLab, or Bitbucket, prepares a workspace, runs the agent through the headless controller, collects the git diff as a patch, records a resolver output, and then opens or updates a pull or merge request with that patch.
tags: [resolver, issues, pull-requests, github, gitlab, bitbucket, patch, automation, output-jsonl]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:30:54.023Z
sources:
  - id: openwiki-source-a7d4117117c5bc288940f3d9
    resource: repo://openhands/resolver/issue_handler_factory.py
  - id: openwiki-source-0aa9c8cee8d147e243969427
    resource: repo://openhands/resolver/issue_resolver.py
  - id: openwiki-source-52a4a23cdc5525a9cbbefc83
    resource: repo://openhands/resolver/send_pull_request.py
generated: { by: "claude-code", at: "2026-11-16T18:30:54.023Z" }
---

# Issue Resolver Workflow

The resolver is the batch pipeline that turns an issue into a proposed code change. It runs an OpenHands agent against a repository checkout for one issue, captures the result as a git patch, records everything in an output file, and then, in a separate step, opens or updates a pull request. The `openhands-resolver.yml` workflow in `.github/workflows/` is one place it is run from. The code lives in `openhands/resolver/`.

The pipeline has two programs. `openhands/resolver/resolve_issue.py` (`main`) and `IssueResolver` in `openhands/resolver/issue_resolver.py` produce the patch. `openhands/resolver/send_pull_request.py` (`main`) publishes it. Separating them lets a patch be reviewed or published later.

## Stage 1: produce a patch

### Inputs and setup

`resolve_issue.py` parses its arguments: the repository (`--selected-repo`, as `owner/repo`), the issue number (`--issue-number`), the issue type (`--issue-type`, issue or pull request), the token and username for the git provider, the LLM choice (`--llm-model`, `--llm-api-key`, `--llm-base-url`), the agent's iteration limit (`--max-iterations`), the output directory (`--output-dir`), and the runtime and its container image (`--runtime`, `--runtime-container-image`, `--base-container-image`). It can also take a custom prompt file (`--prompt-file`), a repository instruction file (`--repo-instruction-file`), and a comment ID for a pull request review.

`IssueResolver.__init__` (`issue_resolver.py` ~L55) combines these with the configuration through `update_openhands_config` (~L178) and `update_sandbox_config` (~L209). Provider access goes through the issue handler (below).

### Issue and handler

`IssueHandlerFactory` (`openhands/resolver/issue_handler_factory.py`, class at ~L15) creates the handler for the platform: `GithubIssueHandler` or `GithubPRHandler`, `GitlabIssueHandler` or `GitlabPRHandler`, and `BitbucketIssueHandler` or `BitbucketPRHandler`. The handlers are in `openhands/resolver/interfaces/` (`github.py`, `gitlab.py`, `bitbucket.py`), with the shared `Issue` and `ReviewThread` models in `issue.py` and the issue definitions in `issue_definitions.py`. `IssueResolver.extract_issue` (~L519) fetches the issue, its comments, and any review threads through the handler, and builds the instruction the agent receives.

### Per-issue run

`resolve_issue` (`issue_resolver.py` ~L535) processes one issue. `process_issue` (~L397) does the following:

1. Replaces the workspace with a fresh copy of the base checkout (`shutil.copytree` from the output directory's `repo` folder). Each issue starts from the same base commit.
<!-- openwiki: broken internal link [/openwiki/architecture/runtime-sandbox.md] link "/openwiki/architecture/runtime-sandbox.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
2. Creates a runtime and connects it (`create_runtime`, `runtime.connect`). The runtime is the sandbox the agent works in (see [Runtime and Sandbox Execution](/openwiki/architecture/runtime-sandbox.md)).
3. Calls `initialize_runtime` (~L267) to prepare the sandbox for the repository.
<!-- openwiki: broken internal link [/openwiki/workflows/cli-and-headless.md] link "/openwiki/workflows/cli-and-headless.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
4. Calls `run_controller` (`openhands/core/main.py`) with the instruction as the first user message and the `codeact_user_response` function, which answers the agent's questions automatically so the run does not wait for a person (see [CLI and Headless Execution](/openwiki/workflows/cli-and-headless.md) for the headless path). It catches `ValueError` and `RuntimeError` from the run and records the error.
5. Calls `complete_runtime` (~L309) to collect the patch. The method sets git's pager off and marks `/workspace` as a safe directory, stages all changes (`git add -A`, with `sudo` when needed), and then runs `git diff --no-color --cached <base_commit>`. It retries the diff a few times and returns the result as `git_patch`.

The patch is the product. The agent's own edits are whatever it changed in the sandbox, and the diff against the base commit is the only thing carried forward.

### Outcome and output

After the run, `process_issue` decides success. If the run produced no state, or the run ended in an error, the result is marked unsuccessful and carries the error text. The result is a `ResolverOutput` (`openhands/resolver/resolver_output.py`) with the issue, its type, the instruction, the base commit, the `git_patch`, the event history, metrics, a success flag, per-comment success flags for review follow-ups, a result explanation, and any error.

`resolve_issue` writes each result as a JSON line in `output.jsonl` under the output directory (~L603-L610), so the file holds one record per issue and can be read by later steps. The `infer_logs` directory holds per-issue logs.

## Stage 2: publish the change

`send_pull_request.py` reads the resolver output and publishes it. Its `main` parses `--output-dir`, the repository, the provider token and username, the pull request type (`--pr-type`), an optional target branch (`--target-branch`), an optional fork owner (`--fork-owner`), a reviewer, a title, git author details, and `--send-on-failure` (whether to publish results that did not succeed).

`process_single_issue` (~L502) handles one record:

1. `apply_patch` (~L28) applies the patch to a fresh clone of the repository (`initialize_repo`, ~L124), and `make_commit` (~L162) commits the change with the configured author.
2. If a pull request already exists for the issue's branch, `update_existing_pull_request` (~L393) pushes the new commit to it. Otherwise `send_pull_request` (~L233) pushes a new branch and opens the pull request through the provider's handler (`handler.create_pull_request`, ~L378). Pushes go to the fork owner when one is given.
3. The `send_on_failure` parameter of `process_single_issue` controls whether results that did not succeed are published (set by `--send-on-failure`).

The provider-specific calls use the same handler classes as the input stage, so GitHub, GitLab, and Bitbucket each get their own API flow (the pull request for GitHub, the merge request for GitLab, the pull request for Bitbucket).

## Invariants and failure behavior

- Each issue runs in a fresh copy of the base checkout, so one attempt cannot leak edits into another.
- The patch is a diff against a recorded base commit, which lets publication apply it to a clean clone.
- A run that errors still produces an output record with the error, so failures are visible rather than lost.
- Publication does not run for failed records unless explicitly requested.
- The diff step retries, which tolerates transient sandbox errors.

## Extension seams

<!-- openwiki: broken internal link [/openwiki/architecture/integrations-and-mcp.md] link "/openwiki/architecture/integrations-and-mcp.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- A new git host is an interface class in `openhands/resolver/interfaces/` and a branch in `IssueHandlerFactory`. The provider integration itself is described in [Git Provider Integrations and MCP](/openwiki/architecture/integrations-and-mcp.md).
- A different agent or prompt is selected through `--prompt-file` or the configuration.
- A different publication policy is a change to `process_single_issue`.

## Representative tests

- `tests/unit/resolver/` (24 test files) covers the handlers, the patching code, `IssueResolver`, and the publication functions.

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/agent-controller.md] link "/openwiki/architecture/agent-controller.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Agent Controller and Step Loop](/openwiki/architecture/agent-controller.md)
<!-- openwiki: broken internal link [/openwiki/architecture/integrations-and-mcp.md] link "/openwiki/architecture/integrations-and-mcp.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Git Provider Integrations and MCP](/openwiki/architecture/integrations-and-mcp.md)
<!-- openwiki: broken internal link [/openwiki/workflows/cli-and-headless.md] link "/openwiki/workflows/cli-and-headless.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [CLI and Headless Execution](/openwiki/workflows/cli-and-headless.md)
<!-- openwiki: broken internal link [/openwiki/architecture/runtime-sandbox.md] link "/openwiki/architecture/runtime-sandbox.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Runtime and Sandbox Execution](/openwiki/architecture/runtime-sandbox.md)
