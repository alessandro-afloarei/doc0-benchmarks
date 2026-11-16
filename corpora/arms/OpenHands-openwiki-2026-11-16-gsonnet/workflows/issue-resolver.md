---
type: workflow
title: Issue Resolver
description: The two-phase resolver that runs an OpenHands agent against a GitHub, GitLab or Bitbucket issue or PR review (resolve_issue) and then turns the resulting patch into a branch and pull request (send_pull_request) — flow, handler abstraction, success checking, output format and the GitHub Actions entry.
tags: [resolver, github-actions, pull-request, issue, automation, headless]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:38:52.407Z
sources:
  - id: openwiki-source-0e47ed60da864008f08a91c7
    resource: repo://.github/workflows/openhands-resolver.yml
  - id: openwiki-source-3a2b5746f12b8a942ba2b7cb
    resource: repo://openhands/resolver/interfaces/issue_definitions.py
  - id: openwiki-source-c736099282310f415ec08c05
    resource: repo://openhands/resolver/interfaces/issue.py
  - id: openwiki-source-a7d4117117c5bc288940f3d9
    resource: repo://openhands/resolver/issue_handler_factory.py
  - id: openwiki-source-0aa9c8cee8d147e243969427
    resource: repo://openhands/resolver/issue_resolver.py
  - id: openwiki-source-153a3dcf87bb5da30107e4b7
    resource: repo://openhands/resolver/resolver_output.py
  - id: openwiki-source-52a4a23cdc5525a9cbbefc83
    resource: repo://openhands/resolver/send_pull_request.py
generated: { by: "claude-code", at: "2026-11-16T09:38:52.407Z" }
---

# Issue Resolver

`openhands/resolver/` automates "fix this issue" and "address this PR review" using the same agent stack as the interactive product, but run **headlessly** via [`run_controller`](../clients/cli.md). It is split into two independently runnable steps so results can be inspected between them:

1. **`resolve_issue`** (`resolve_issue.py` → `IssueResolver`): produce a git patch and a success verdict, written to `output.jsonl`.
2. **`send_pull_request`** (`send_pull_request.py`): apply the patch to a fresh checkout, commit, push a branch and open (or update) a pull/merge request.

The repository ships a reusable GitHub Actions workflow (`.github/workflows/openhands-resolver.yml`, `workflow_call`) and an example caller (`resolver/examples/openhands-resolver.yml`). Its inputs include `max_iterations` (default 50), the trigger `macro` (default `@openhands-agent`), `target_branch` (default `main`), `pr_type` (`draft` or `ready`, default `draft`), `LLM_MODEL`, `base_container_image` and the runner. Typical setup per `resolver/README.md`: label an issue `fix-me` (or mention the macro), provide `LLM_API_KEY` and a PAT, and grant the workflow write permissions.

## Phase 1: `IssueResolver`

**Setup** (`IssueResolver.__init__`): parses `owner/repo`, platform (GitHub, GitLab or Bitbucket via `ProviderType`), token/username, `issue_type` (`issue` or `pr`), optional `comment_id`, loads two prompt templates (user instructions and conversation instructions, e.g. `prompts/resolve/basic.jinja` and `basic-conversation-instructions.jinja`) and optional repo instructions, and builds the app config:

- `update_openhands_config`: workspace under `<output_dir>/workspace/<type>_<number>`, `max_iterations`, and agent config `CodeActAgent` with the **`github` microagent disabled** (the resolver supplies its own credentials/behaviour) ([Microagents](../agents/microagents.md)).
- `update_sandbox_config`: you may give *either* a base or a runtime container image, not both (`ValueError`); with neither (and not experimental) it uses the published `ghcr.io/all-hands-ai/runtime:<version>-nikolaik` image. Sandbox: no auto-lint, no host network, 300 s command timeout, plus GitLab-CI-specific URL/UID handling.
- `IssueHandlerFactory` picks a handler by platform and type: `GithubIssueHandler`/`GitlabIssueHandler`/`BitbucketIssueHandler` or the `*PRHandler` variants, wrapped in `ServiceContextIssue` or `ServiceContextPR`. All handlers implement `IssueHandlerInterface` (download issues/comments, build clone/branch/compare/PR URLs, headers, `create_pull_request`, `request_reviewers`, `reply_to_comment`, `send_comment_msg`, `get_converted_issues`), which is the extension seam for another forge.

**Run** (`resolve_issue`):

1. `extract_issue` fetches the single issue/PR as an `Issue` model (title, body, thread comments, review comments/threads, head branch, referenced external issues); errors clearly if nothing is found or if a given `comment_id` matches nothing.
2. Clone the repo into `<output_dir>/repo`, record `base_commit` (`git rev-parse HEAD`), pick up `.openhands_instructions` if no repo instruction was passed, and **skip if the issue already appears in `output.jsonl`** (idempotent re-runs).
3. For `pr` type, fetch and check out the PR's head branch and use its HEAD as the base commit.
4. `process_issue`: copy the repo into the workspace, create a runtime (`create_runtime`), connect, `initialize_runtime` (cd `/workspace`, disable git pager, run `.openhands/setup.sh` and pre-commit hook setup — see [Runtime](../runtime/runtime-and-sandbox.md)), render the instruction (including image URLs found in the issue) and call `run_controller` with `fake_user_response_fn=codeact_user_response` so the agent never waits for a human, and the conversation instructions injected through [Memory](../agents/memory-and-condensation.md).
5. `complete_runtime`: `git add -A` then `git diff --no-color --cached <base_commit>` (retried up to 5 times with increasing hard timeouts) yields `git_patch` — the patch includes untracked files because everything is staged first.
6. **Success judgement** (`guess_success` on the service context): for issues, an LLM reads the issue, the agent's history and the patch using `prompts/guess_success/issue-success-check.jinja` and returns success plus explanation; for PRs, separate prompts check each review thread, review comment and thread comment (`pr-thread-check`, `pr-review-check`, `pr-feedback-check`), producing a per-item `comment_success` list that is logged as a checklist.
7. A `ResolverOutput` (`issue`, `issue_type`, `instruction`, `base_commit`, `git_patch`, `history`, `metrics`, `success`, `comment_success`, `result_explanation`, `error`) is appended as one JSON line to `output.jsonl`. If the agent crashes (`ValueError`/`RuntimeError`) the patch is still collected, but `success=False`, history is empty and `error` records the failure.

## Phase 2: `send_pull_request`

`process_single_issue(output_dir, resolver_output, ...)`:

- Skips unless `resolver_output.success` is true or `--send-on-failure` is set.
- Re-initializes a clean checkout at the base commit (issues) or the PR head branch (PRs), `apply_patch` (using the vendored `resolver/patching/` unified-diff applier), and `make_commit` as the configured git identity (default `openhands <openhands@all-hands.dev>`, matching `git_user_name`/`git_user_email` config).
- For **issues**: `send_pull_request` validates `pr_type` (`branch`, `draft`, `ready`), creates a uniquely named branch (`openhands-fix-issue-<n>` via `get_branch_name`), pushes it (optionally to a **fork** via `fork_owner`), and depending on `pr_type` either stops at the branch, opens a draft, or opens a ready PR against `target_branch` (default branch if unset), with optional reviewer request, custom title, and the success explanation as an additional comment.
- For **PRs**: `update_existing_pull_request` pushes to the existing head branch and posts a comment summarizing what was addressed: if no explicit message is supplied it builds one from the per-item success explanations and, when an LLM config is available, asks the LLM to summarize the changes using `pr-changes-summary.jinja`.

Unlike this headless flow, the enterprise chat and issue integrations start full conversations in the web stack instead ([Enterprise](../enterprise/enterprise-saas.md)).

## Operational notes

- Concurrency/logging: `reset_logger` supports per-issue log files under `infer_logs/` when many issues run in parallel.
- Everything is driven by files in `output_dir` (`repo/`, `workspace/`, `output.jsonl`, `infer_logs/`), which makes failed runs debuggable and resumable; `visualize_resolver_output.py` renders an output file.
- Credentials: the token must allow repo contents, issues, pull requests and workflows; provider API behaviour is shared with [Git providers](../integrations/git-providers.md) conventions but the resolver has its own REST/GraphQL handlers in `interfaces/`.
- Tests: `tests/unit/resolver/`.

Related: [CLI and headless](../clients/cli.md), [Testing and evaluation](../operations/testing-and-evaluation.md) (same headless harness style).
